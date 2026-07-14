// Main entry: connect to Telegram, watch the tipster group, parse picks with
// Claude, expose a small HTTP inbox that RSFS polls.

import "dotenv/config";
import express from "express";
import { connect, findGroup, onNewMessage, downloadPhoto } from "./telegram.js";
import { looksLikePick } from "./filter.js";
import { parseMessage } from "./parser.js";
import { hasSeen, markSeen, addBet, addSkip, pendingSince, markDelivered, stats } from "./storage.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const INBOX_TOKEN = process.env.INBOX_TOKEN || "";

function checkAuth(req, res) {
  if (!INBOX_TOKEN) return true;
  const t = (req.query.token || req.headers["x-inbox-token"] || "").toString();
  if (t !== INBOX_TOKEN) { res.status(401).json({ error: "unauthorized" }); return false; }
  return true;
}

// Health check — Railway hits this
app.get("/", (_, res) => res.type("text/plain").send("rsfs-tg-listener ok"));
app.get("/healthz", (_, res) => res.json({ ok: true }));

// RSFS polls this to fetch new bets
app.get("/inbox", async (req, res) => {
  if (!checkAuth(req, res)) return;
  const since = req.query.since?.toString();
  const bets = await pendingSince(since);
  res.json({ bets, fetchedAt: new Date().toISOString() });
});

// RSFS tells us it accepted these bets so we can retire them
app.post("/inbox/ack", async (req, res) => {
  if (!checkAuth(req, res)) return;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const n = await markDelivered(ids);
  res.json({ acknowledged: n });
});

app.get("/stats", async (req, res) => {
  if (!checkAuth(req, res)) return;
  res.json(await stats());
});

app.listen(PORT, () => console.log(`[http] inbox listening on :${PORT}`));

// --- Telegram loop ---

function inQuietHours() {
  if (process.env.QUIET_OVERNIGHT !== "1") return false;
  const h = new Date().getHours();
  return h < 10 || h >= 24;   // asleep 12am–10am
}

(async () => {
  const client = await connect({ interactive: false });
  const group = await findGroup(client, process.env.TG_GROUP);
  console.log("[tg] watching group:", group.title || group.username || group.id?.toString());

  onNewMessage(client, group, async (event) => {
    const msg = event.message;
    const id = msg.id?.toString?.() || `${msg.date}-${Math.random()}`;

    if (await hasSeen(id)) return;
    await markSeen(id);

    if (inQuietHours()) return;

    const text = msg.message || "";
    const hasPhoto = !!(msg.photo || (msg.media && msg.media.className?.toLowerCase?.().includes("photo")));

    if (!looksLikePick(text, hasPhoto)) return;

    let image = null;
    if (hasPhoto) image = await downloadPhoto(client, msg);

    let parsed;
    try {
      const r = await parseMessage({
        text,
        imageBase64: image?.base64,
        imageMediaType: image?.mediaType,
      });
      if (!r.ok) {
        await addSkip({ reason: "parser JSON error", text: text.slice(0, 200), rawSnippet: r.raw?.slice(0, 200) });
        return;
      }
      parsed = r.parsed;
    } catch (e) {
      console.error("[parser] failed:", e.message);
      return;
    }

    if (parsed.skip) {
      await addSkip({ reason: parsed.reason || "parser skip", text: text.slice(0, 200) });
      return;
    }

    // Sender name — best-effort
    let senderName = "";
    try {
      const sender = await msg.getSender();
      senderName = [sender?.firstName, sender?.lastName].filter(Boolean).join(" ") || sender?.username || "";
    } catch {}

    const tipster = parsed.tipster || senderName || "Unknown";
    const confidence = parsed.confidence || "medium";

    if (confidence === "low") {
      await addSkip({
        reason: "low confidence — needs review",
        text: text.slice(0, 200),
        parsed,
        tipster,
      });
      return;
    }

    await addBet({
      source: "telegram",
      groupTitle: group.title || "",
      tipster,
      confidence,
      messageId: id,
      messageText: text.slice(0, 500),
      hasScreenshot: hasPhoto,
      type: parsed.type,
      units: parsed.units,
      legs: parsed.legs,
      reasoning: parsed.reasoning || "",
      raw: parsed,
    });

    console.log(`[bet] ${tipster} · ${parsed.type} · ${parsed.legs?.length || 0} legs · ${confidence}`);
  });

  console.log("[tg] ready — waiting for messages");
})().catch(err => {
  console.error("[fatal]", err);
  process.exit(1);
});
