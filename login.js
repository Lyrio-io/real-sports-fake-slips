// One-off local script: log into Telegram interactively and save the session
// string. Run this on your laptop BEFORE deploying so Railway never needs to
// prompt for a code.
//
//   cd tg-bot
//   npm install
//   cp .env.example .env  # fill in TG_API_ID, TG_API_HASH, TG_PHONE
//   npm run login
//
// It prints a long TG_SESSION= line — paste that into Railway's Variables
// and re-deploy. The listener will start silently on the server.

import "dotenv/config";
import { connect } from "./telegram.js";

const client = await connect({ interactive: true });
const s = client.session.save();
console.log("\n============================================");
console.log("SUCCESS — save this in your Railway variables:");
console.log("============================================\n");
console.log(`TG_SESSION=${s}\n`);
console.log("============================================");
console.log("Now push the same value into Railway and deploy. That's it.\n");
process.exit(0);
