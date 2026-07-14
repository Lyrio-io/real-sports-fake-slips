// Dead-simple JSON file storage for pending bets + already-seen message IDs.
// Railway volumes persist across deploys so long as we mount /data.

import fs from "node:fs/promises";
import path from "node:path";

const INBOX_PATH = process.env.INBOX_PATH || path.join(process.cwd(), "inbox.json");

const DEFAULT_DB = {
  version: 1,
  seenMessageIds: [],        // dedupe across restarts / reprocesses
  pendingBets: [],           // bets waiting for RSFS to fetch
  deliveredBets: [],         // bets RSFS already fetched (kept for audit)
  skippedMessages: [],       // messages we chose not to auto-place (low confidence)
  stats: { messagesSeen: 0, betsParsed: 0, skips: 0, deliveries: 0 },
};

let cache = null;
let writeQueue = Promise.resolve();

async function load() {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(INBOX_PATH, "utf8");
    cache = { ...DEFAULT_DB, ...JSON.parse(raw) };
  } catch {
    cache = structuredClone(DEFAULT_DB);
    await ensureDir();
    await fs.writeFile(INBOX_PATH, JSON.stringify(cache, null, 2));
  }
  return cache;
}

async function ensureDir() {
  await fs.mkdir(path.dirname(INBOX_PATH), { recursive: true }).catch(() => {});
}

function persist() {
  // Serialize writes so we can't corrupt the file
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    await fs.writeFile(INBOX_PATH, JSON.stringify(cache, null, 2));
  });
  return writeQueue;
}

export async function hasSeen(msgId) {
  const db = await load();
  return db.seenMessageIds.includes(msgId);
}

export async function markSeen(msgId) {
  const db = await load();
  if (!db.seenMessageIds.includes(msgId)) {
    db.seenMessageIds.push(msgId);
    if (db.seenMessageIds.length > 5000) db.seenMessageIds = db.seenMessageIds.slice(-2500);
  }
  db.stats.messagesSeen++;
  await persist();
}

export async function addBet(bet) {
  const db = await load();
  const entry = { id: cryptoId(), createdAt: new Date().toISOString(), delivered: false, ...bet };
  db.pendingBets.push(entry);
  db.stats.betsParsed++;
  await persist();
  return entry;
}

export async function addSkip(record) {
  const db = await load();
  db.skippedMessages.push({ id: cryptoId(), createdAt: new Date().toISOString(), ...record });
  db.stats.skips++;
  // Cap skip log so it doesn't grow forever
  if (db.skippedMessages.length > 500) db.skippedMessages = db.skippedMessages.slice(-250);
  await persist();
}

export async function pendingSince(sinceISO) {
  const db = await load();
  const cutoff = sinceISO ? new Date(sinceISO).getTime() : 0;
  return db.pendingBets.filter(b => !b.delivered && new Date(b.createdAt).getTime() >= cutoff);
}

export async function markDelivered(ids) {
  const db = await load();
  const setIds = new Set(ids);
  for (const b of db.pendingBets) if (setIds.has(b.id)) b.delivered = true;
  // Move delivered ones to history
  const nowDelivered = db.pendingBets.filter(b => b.delivered);
  db.pendingBets = db.pendingBets.filter(b => !b.delivered);
  db.deliveredBets.push(...nowDelivered);
  if (db.deliveredBets.length > 1000) db.deliveredBets = db.deliveredBets.slice(-500);
  db.stats.deliveries += nowDelivered.length;
  await persist();
  return nowDelivered.length;
}

export async function stats() {
  const db = await load();
  return {
    ...db.stats,
    pending: db.pendingBets.filter(b => !b.delivered).length,
    inSkipQueue: db.skippedMessages.length,
    lastUpdated: new Date().toISOString(),
  };
}

function cryptoId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
