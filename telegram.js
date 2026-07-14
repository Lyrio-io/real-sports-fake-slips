// Telegram user-client wrapper. Uses the "telegram" (gramjs) library so we
// log in as a normal user account — no bot admin needed, sees every message
// in every group the account is a member of.

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import fs from "node:fs/promises";
import input from "input";

const SESSION_PATH = process.env.SESSION_PATH || "./session.txt";

async function loadSession() {
  // Env var takes precedence (Railway secret). File is fallback.
  if (process.env.TG_SESSION) return process.env.TG_SESSION;
  try {
    return (await fs.readFile(SESSION_PATH, "utf8")).trim();
  } catch { return ""; }
}

async function saveSession(str) {
  try {
    await fs.mkdir(SESSION_PATH.substring(0, SESSION_PATH.lastIndexOf("/")), { recursive: true });
    await fs.writeFile(SESSION_PATH, str);
  } catch (e) { console.warn("[tg] could not persist session:", e.message); }
}

export async function connect({ interactive = false } = {}) {
  const apiId = parseInt(process.env.TG_API_ID, 10);
  const apiHash = process.env.TG_API_HASH;
  if (!apiId || !apiHash) throw new Error("Set TG_API_ID and TG_API_HASH in env");

  const session = new StringSession(await loadSession());
  const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });

  await client.start({
    phoneNumber: async () => process.env.TG_PHONE || (interactive ? await input.text("Phone number (+15551234567): ") : (() => { throw new Error("TG_PHONE missing"); })()),
    password:    async () => process.env.TG_2FA_PASSWORD || (interactive ? await input.text("2FA password (blank if none): ", { hidden: true }) : ""),
    phoneCode:   async () => interactive ? await input.text("Login code Telegram just texted you: ") : (() => { throw new Error("No login code available. Run `npm run login` locally first."); })(),
    onError: (err) => console.error("[tg]", err.message),
  });

  const saved = client.session.save();
  await saveSession(saved);

  console.log("[tg] connected as", (await client.getMe()).username || (await client.getMe()).firstName);
  return client;
}

// Find the tipster group by title (case-insensitive contains), username, or numeric id
export async function findGroup(client, ref) {
  if (!ref) throw new Error("TG_GROUP missing — set the group username, exact title, or numeric id");
  const dialogs = await client.getDialogs({ limit: 200 });
  const wantNumeric = /^-?\d+$/.test(ref);
  const wantUser = ref.startsWith("@");
  const lowered = ref.toLowerCase();

  for (const d of dialogs) {
    const chat = d.entity;
    if (!chat) continue;
    const id = chat.id?.toString?.() || "";
    const username = ("@" + (chat.username || "")).toLowerCase();
    const title = (chat.title || "").toLowerCase();
    if (wantNumeric && id === ref) return chat;
    if (wantUser && username === lowered) return chat;
    if (!wantNumeric && !wantUser && title.includes(lowered)) return chat;
  }
  throw new Error(`Group not found: ${ref}. Available: ${dialogs.map(d => d.entity?.title || d.entity?.username).filter(Boolean).slice(0, 10).join(", ")}`);
}

// Register a message handler. `handler` is (event) => Promise<void>
export function onNewMessage(client, chatEntity, handler) {
  client.addEventHandler(async (event) => {
    try {
      const msg = event.message;
      if (!msg) return;
      const chatId = msg.chatId?.toString?.() || msg.peerId?.channelId?.toString?.() || "";
      const targetId = chatEntity.id?.toString?.() || "";
      // gramjs sometimes prefixes IDs; match on ends-with rather than exact
      if (targetId && !chatId.endsWith(targetId)) return;
      await handler(event);
    } catch (e) {
      console.error("[tg] handler error:", e.message);
    }
  }, new NewMessage({}));
}

// Download an image attached to a message; returns { base64, mediaType } or null
export async function downloadPhoto(client, msg) {
  if (!msg.photo && !msg.media) return null;
  try {
    const buf = await client.downloadMedia(msg, {});
    if (!buf) return null;
    // gramjs returns Buffer or Uint8Array
    const b64 = Buffer.from(buf).toString("base64");
    return { base64: b64, mediaType: "image/jpeg" };
  } catch (e) {
    console.warn("[tg] downloadMedia failed:", e.message);
    return null;
  }
}
