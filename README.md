# RSFS Telegram Listener

A tiny Node service that logs into your Telegram account, watches one tipster
group, parses every pick (text or screenshot) with Claude, and exposes an HTTP
inbox that your RSFS app polls to auto-copy plays.

## What it does

1. Logs in as **your** Telegram user (no bot admin needed)
2. Listens 24/7 for new messages in one specified group
3. Filters chatter cheaply with a keyword pass
4. Sends real pick candidates (text or image) to Claude Haiku
5. Stores structured bets in `/data/inbox.json` on Railway
6. RSFS polls `GET /inbox?token=...` every ~5 min and auto-places them, tagging
   the source with the tipster's name so your existing Source ROI dashboard
   shows who's winning

## Cost

Roughly **$5–10/month** total on Railway with a moderate-activity group
(~200 messages/day). Breakdown:

- Railway host: $0 (Hobby free tier) to $5
- Claude Haiku API: ~$4–6 (~$0.001 per text message, ~$0.005 per screenshot)

## Deploy

### 1. Get Telegram API credentials (2 min)

Go to https://my.telegram.org → **API development tools** → create a new app.
Name it anything. Copy the **App api_id** and **App api_hash**.

### 2. Get an Anthropic API key

https://console.anthropic.com → Settings → API Keys → Create Key.

### 3. Login locally to generate the session

On your laptop:

```bash
cd tg-bot
cp .env.example .env
# Edit .env — fill in TG_API_ID, TG_API_HASH, TG_PHONE, ANTHROPIC_API_KEY, TG_GROUP
npm install
npm run login
```

Telegram texts you a code. Enter it (and your 2FA password if you have one).
The script prints a long `TG_SESSION=...` string. Copy it.

### 4. Deploy to Railway

Create a new Railway service pointed at this folder (`tg-bot/`) or push the
whole repo. In Railway → your service → **Variables**, add:

| Key | Value |
|---|---|
| `TG_API_ID` | from step 1 |
| `TG_API_HASH` | from step 1 |
| `TG_PHONE` | +15551234567 |
| `TG_2FA_PASSWORD` | (only if you have 2FA) |
| `TG_GROUP` | group name, @username, or numeric id |
| `TG_SESSION` | the string from step 3 |
| `ANTHROPIC_API_KEY` | from step 2 |
| `INBOX_TOKEN` | any long random string — RSFS uses this to fetch |
| `INBOX_PATH` | `/data/inbox.json` |
| `SESSION_PATH` | `/data/session.txt` |

Also mount a **volume** at `/data` so the inbox survives redeploys.

Railway will run `npm start`. Watch the logs — you should see:

```
[tg] connected as YourName
[tg] watching group: The Tipster Group
[http] inbox listening on :8080
[tg] ready — waiting for messages
```

### 5. Wire RSFS to poll

In your RSFS app, add a poller (I can write this — say the word once you've
confirmed the listener is parsing correctly):

```js
setInterval(async () => {
  const url = `https://<your-service>.up.railway.app/inbox?token=${INBOX_TOKEN}`;
  const r = await fetch(url);
  const { bets } = await r.json();
  for (const bet of bets) {
    // …match to Odds API, place with your unit size, tag source
  }
  // ack so we don't get them again
  await fetch(`https://<your-service>.up.railway.app/inbox/ack`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-inbox-token": INBOX_TOKEN },
    body: JSON.stringify({ ids: bets.map(b => b.id) }),
  });
}, 5 * 60 * 1000);
```

## HTTP endpoints

| Method | Path | What |
|---|---|---|
| `GET` | `/` | Health text |
| `GET` | `/healthz` | `{ ok: true }` |
| `GET` | `/inbox?since=<ISO>&token=…` | Undelivered bets |
| `POST` | `/inbox/ack` | Body `{ ids: [...] }` marks them delivered |
| `GET` | `/stats?token=…` | Counters: messages seen, parsed, skipped |

## Guardrails baked in

- **Every message ID dedupes** in `seenMessageIds` so a redeploy or bug won't double-place bets
- **Cheap keyword filter** before Claude → memes and "gg" never cost API tokens
- **Low-confidence parses go to the skip queue** with the raw text, so you can eyeball them instead of auto-placing garbage
- **Read-only Telegram usage** — the service never sends messages, reacts, or forwards. From Telegram's POV it looks like you're just online.
- **All secrets stay in env vars** — nothing hardcoded

## Regenerating the session

If the session ever gets invalidated (very rare — usually password reset or
device revoke), rerun `npm run login` and push the new `TG_SESSION` value.

## Files

```
tg-bot/
├── package.json
├── .env.example
├── README.md
└── src/
    ├── index.js       — express + telegram bootstrap
    ├── telegram.js    — user-client wrapper (gramjs)
    ├── parser.js      — Claude Haiku bet parser
    ├── filter.js      — cheap keyword pre-filter
    ├── storage.js     — JSON file persistence for inbox
    └── login.js       — one-off local login helper
```
