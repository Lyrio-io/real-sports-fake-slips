// Bet parser: sends a Telegram message (text or screenshot) to Claude and
// returns a structured BetSlip { skip, tipster, confidence, legs[] }.
//
// Prompted to be conservative — if Claude isn't sure, it sets skip:true and
// leaves a reason. We surface those for manual review, never auto-place them.

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are parsing sports-betting picks from a Telegram tipster group.
The user sends you one message (text and/or one screenshot).
Extract every bet into structured JSON.

Return ONLY valid JSON with this shape:
{
  "skip": boolean,           // true if the message is not a placeable pick
  "reason": string,          // one short sentence if skip=true, otherwise ""
  "tipster": string,         // the person's name if identifiable, else ""
  "confidence": "high" | "medium" | "low",
  "type": "single" | "parlay",
  "legs": [
    {
      "sport": "MLB" | "NBA" | "WNBA" | "NHL" | "NFL" | "NCAAF" | "NCAAB" | "MLS" | "EPL" | "UFC" | "PGA" | "ATP" | "WTA" | "OTHER",
      "market": "moneyline" | "spread" | "total" | "team_total" | "prop" | "first_five" | "nrfi" | "yrfi" | "other",
      "team": string,        // team name or player name
      "line": number | null, // e.g. -1.5 for spread, 8.5 for total, null for moneyline
      "side": "over" | "under" | null,  // only for totals
      "american_odds": number,          // -110, +150, etc.
      "book": string         // sportsbook name if visible, else ""
    }
  ],
  "units": number | null,    // "2u" → 2, "1 unit" → 1, null if not stated
  "reasoning": string        // 1-sentence explanation, plain English
}

Rules:
- Real picks only. "Cashed my Lakers ML!" (past result) → skip:true.
- Casual chat, memes, greetings, reactions → skip:true.
- "Fade [tipster]" or "tail [tipster]" alone → skip:true (need the actual pick).
- If odds/line unclear, set confidence:"low" and note in reason.
- Screenshots of BetMGM/DraftKings/FanDuel slips: extract each leg exactly.
- Multi-leg slips → type:"parlay". Combined odds go on the last leg only.
- Never invent numbers. If something isn't visible/stated, leave it blank.

No prose. No markdown fences. Just the JSON.`;

export async function parseMessage({ text, imageBase64, imageMediaType }) {
  const content = [];
  if (imageBase64) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imageMediaType || "image/jpeg",
        data: imageBase64,
      },
    });
  }
  const userText = text?.trim() ? text.trim() : "(no caption — parse the screenshot)";
  content.push({ type: "text", text: userText });

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  const raw = (resp.content?.[0]?.text || "").trim();
  // Strip accidental markdown fences if the model slips
  const clean = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    const parsed = JSON.parse(clean);
    return { ok: true, parsed, usage: resp.usage };
  } catch (e) {
    return { ok: false, error: "JSON parse failed", raw, usage: resp.usage };
  }
}
