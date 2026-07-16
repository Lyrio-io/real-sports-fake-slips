# RSFS — Project State (as of last session)

> **Read this in full before responding to me. This file is the source of truth for what exists, what's running, what's broken, and what I need next. I'm tired of re-explaining — this is my "read this so I don't have to talk" file.**

---

## Who I am / how to work with me

- Jorge — I run sports-betting sandbox apps and automation projects (Lyrio, Casa Automation).
- I don't want to use Terminal unless absolutely necessary. Guide me through browser (GitHub web UI + Railway web UI) whenever possible.
- Never guess data. If you can't verify a bet or a tipster's identity from real sources, do NOT auto-place. Route to a review queue for me to eyeball.
- Explain everything at "smart friend, not a coder" level. No jargon. No walls of text. One step at a time.
- When code changes are needed, give me one exact click or one exact paste. Don't dump 20 lines and say "figure it out."

---

## Repo & hosting

- **GitHub repo:** `Lyrio-io/real-sports-fake-slips` (branch: `main`)
- **RSFS site (static web app):** `https://real-sports-fake-slips-production.up.railway.app`
- **Telegram bot service:** `https://tg-bot-production-fa2a.up.railway.app`
  - Endpoints: `GET /` (health), `GET /healthz`, `GET /inbox?token=…` (returns pending bets JSON), `POST /inbox/ack` (marks bets delivered), `GET /stats?token=…` (counters)
- **Railway workspace:** lyrio-io's Projects → project **Sports betting Mock** → two services (`real-sports-fake-slips` static site, `tg-bot` Telegram listener)
- **Odds API:** the-odds-api.com — key stored in the RSFS app's own Settings (browser localStorage)
- **Anthropic API:** Claude Haiku 4.5, used inside the tg-bot for parsing picks. Key stored in Railway env `ANTHROPIC_API_KEY`.
- **Group being watched:** `CAPPERS FREE` (private Telegram group, invite `t.me/+MSjz78jJJoQ5NzRi`). I'm a member, not admin. Bot uses my Telegram user account via gramjs (MTProto), not the Bot API.

---

## Current file layout on repo root (main branch)

```
README.md            (site's original 265-byte README — restored after an earlier delete)
index.html           (~582 KB — the entire RSFS PWA + inline JS)
manifest.json        (PWA manifest)
mocks/               (design mocks: modern-a/b/c/d, look-*, lyrio-dm-prompts, etc.)
package.json         (site's — just runs `serve .` on Railway)
sw.js                (service worker for notifications)
tg-inbox.js          (RSFS-side poller that fetches from the bot every 5 min and auto-places)
PROJECT_STATE.md     (this file)
```

The Telegram bot's own code (`tg-bot/` folder with `src/index.js`, `src/telegram.js`, `src/parser.js`, `src/storage.js`, `src/filter.js`, `src/login.js`, `package.json`) lives on my Mac at `~/Downloads/tg-bot`. It was deployed to Railway via `railway up` — NOT tied to GitHub for the bot service. If we ever need to update the bot code, I'd re-run `railway up` from that folder.

---

## Env vars set on Railway → tg-bot service

```
TG_API_ID, TG_API_HASH, TG_PHONE, TG_2FA_PASSWORD (blank), TG_GROUP=CAPPERS FREE, TG_SESSION,
ANTHROPIC_API_KEY, ANTHROPIC_MODEL=claude-haiku-4-5-20251001,
INBOX_TOKEN=rsfs-2026-tipster-inbox-9x8k4m,
PORT=8080, INBOX_PATH=/data/inbox.json, SESSION_PATH=/data/session.txt,
QUIET_OVERNIGHT=1
```

---

## What's already working

1. **Bot is live on Railway.** Logged in as Jorge, watching CAPPERS FREE, ready for messages. Last log line before the current session ended: `[tg] ready — waiting for messages`.
2. **Bot parses each new message** with Claude Haiku — text messages AND screenshots. Result: structured JSON with tipster name, confidence, legs, market, line, price, book, units.
3. **Low-confidence parses go to a skip queue** on the bot side — never auto-placed. Only high/medium confidence go to the delivery inbox.
4. **RSFS polls the bot every 5 min** via `tg-inbox.js`. Matches each parsed leg against the current Odds API cache. If it finds the game + market + outcome, it auto-places at `stake = units × bankroll × unitSize` with a `source: "TG: <TipsterName>"` tag. Places into `state.profiles[current].bets` and re-renders the Open Bets tab.
5. **Existing RSFS features already in place:**
   - Sport chips (NFL/NBA/WNBA/MLB/NHL/MLS/EPL/UCL)
   - Odds API integration with per-sport caching
   - Multi-profile support (Jorge, Ricky, Chuck) — each has its own bankroll, bets, settings
   - Weekly bankroll reset (Mondays) — profits sweep to Savings
   - Guardrails: tilt cooldown, loss-streak cooldown, big-bet warning, pre-place timer, unit size / max units per bet
   - Auto-hedge for singles when opposing side hits +threshold (default +300)
   - Auto-settle on ESPN scores + on schedule
   - Session-refresh widget, notifications (Web Push), demo mode, admin mode, Source ROI dashboard, achievement case, morning ritual card, weekly recap, discipline streak, performance score, hedge alerts
   - Categorized Settings (Money / Notifications / Safety nets / Look & feel / API keys / Sports / Profiles / Calculators / Advanced)
   - Live ticker for in-progress bets
   - Bet placement ticket (receipt-style, share as image)
   - Live activity notifications on score change
6. **The bot has CORS enabled** so `tg-inbox.js` can fetch from a browser without being blocked.

---

## What I need next (the actual work)

### 1. "Tipster Inbox" review area in RSFS

Add a new tab or section (I'd suggest a subsection under Open Bets or a new "Inbox" tab) that shows:
- **Every parsed pick from the bot**, whether it was auto-placed or not
- Grouped by tipster name
- Each row shows: tipster's real name (parsed from the group), timestamp, the raw text/screenshot of what they posted, what the bot parsed (team, market, line, price, units, confidence), and whether RSFS auto-placed it (with the matched game) OR skipped it (with the reason: no matching game, low confidence, bankroll too low, etc.)
- **Give me a "Verify" button per row** so I can confirm the parse matches the tipster's screenshot. If I flag something as wrong-parse, mark that bet and add it to a "needs review" bucket. Never auto-hedge/auto-settle a flagged bet.

The bot already stores parsed picks + raw text + screenshot (base64) — extend the bot to expose an `GET /all` endpoint that returns everything, not just pending. Add the UI in RSFS.

### 2. Manual pick upload (my direct entry)

Sometimes I'll want to verify what the bot SHOULD have parsed by uploading a screenshot myself and pasting the tipster's name. So build a small form in the Tipster Inbox area with:
- Tipster name (dropdown of known tipsters + free text)
- Upload/paste screenshot
- Optional caption / text version of the pick

Send that to the same Claude Haiku parse endpoint and show me the result side-by-side with what the bot would have parsed. This is how I verify the bot is doing the right thing.

### 3. Tipster scoreboard

New card in the Stats tab, ranked by a composite score. Columns:
- Rank
- Tipster name
- Total picks tracked (must have 50+ before the number "counts")
- W-L
- Win rate %
- ROI %
- CLV (closing line value) — average cents better/worse than closing line
- Max drawdown in units
- Composite score (my chosen weighting: **CLV 40 + ROI 30 + Sample-size 15 + Max-drawdown 10 + Uncorrelation 5**, normalized 0-100)
- Status: Paper / Real / Cold-streak demoted

Auto-refresh after each settle. Top 5-6 by composite = candidates to graduate to real money (per rules I'll share when we get there).

### 4. Half-unit sizing per tipster

For every bet the bot auto-places, the stake should be capped at 0.5 units by default. With my $1,000 bankroll and 1% unit size, that's **$5 per tipster pick**. Do NOT go over $5 per pick unless I explicitly override in Settings. Add a per-tipster override in the scoreboard if I want a specific tipster to bet more (or less).

Reasonable defaults:
- Default per-pick stake: 0.5 units (~$5 on my current bankroll)
- Max per-pick stake: 1 unit (~$10 on my current bankroll)
- Total daily exposure across all tipsters: cap at 3% of bankroll (~$30)

If the daily cap is hit, remaining picks go to the review queue instead of being auto-placed. Show me a chip in the Inbox area that says "Daily cap hit — X picks pending manual approval."

### 5. Auto-hedge on tipster picks

Existing RSFS already has auto-hedge for singles. Extend it so:
- **All tipster-copied picks are eligible for auto-hedge by default.** No opt-out per pick.
- Same +300 threshold (or whatever I have set) — when the opposing side hits that price, RSFS auto-places the break-even hedge.
- Show me in the Tipster Inbox area, per row, whether that pick was hedged. If yes, show the guaranteed profit locked.
- **Never hedge parlays.** (Only singles, per existing rules.)

### 6. Cross-referencing / verification workflow

- Whenever the bot parses a pick, hash the raw message text + screenshot bytes and store the hash on the bet.
- When I later see the screenshot in Telegram again, or the tipster posts a result/screenshot with the same content, RSFS matches on that hash to prove "yes, this was posted, we captured it, we parsed it."
- On the Inbox review page, add a filter: "Show only picks where I haven't verified yet." Aim for me to be verifying 10-20 picks a day, not 200.

### 7. Alerts I want when things are happening

- Small toast when a tipster pick lands in the Inbox: "New pick from [tipster] — auto-placed at 0.5u"
- Push notification (via existing Web Push) when a tipster pick is auto-hedged: "Profit locked: +$X on [tipster]'s [team] pick"
- Weekly summary email/push (existing summary machinery): include the tipster scoreboard so I can watch trends without opening the app.

---

## Before you start responding

1. Read this whole doc.
2. Then check the repo file list via GitHub API to confirm current state.
3. Then tell me: (a) which piece of the above you'd tackle first for max impact, (b) whether it needs a code push (I'll do the GitHub click), a Railway env-var change, or purely a `tg-inbox.js` / `index.html` edit.
4. Wait for me to say "go" before writing code.

---

## Known constraints

- I don't have Claude with write access to my GitHub repo. Claude in every session says its writes get 403. So all commits must be done by me clicking on GitHub's web UI. Give me exact URLs + copy-paste code.
- The `tg-bot` Railway service is not linked to a GitHub repo. Any bot code change requires me to re-run `railway up` from `~/Downloads/tg-bot` on my Mac. Try to avoid bot-side changes if you can — prefer `tg-inbox.js` and `index.html` (both editable via GitHub web).
- `index.html` is huge (~582 KB). Prefer standalone JS files loaded via `<script src>` when adding features rather than editing index.html directly.
- Never touch: `mocks/` (design references only), `manifest.json`, `sw.js` unless absolutely needed.

---

*End of PROJECT_STATE.md*
