// tg-inbox.js — polls the Telegram bot every 5 min and auto-places parsed
// tipster picks into your RSFS Open Bets tab, tagged by tipster name.
// Loaded from index.html via a <script> tag at the bottom of body.
(function () {
  const TG_BOT_URL = "https://tg-bot-production-fa2a.up.railway.app";
  const TG_INBOX_TOKEN = "rsfs-2026-tipster-inbox-9x8k4m";
  const TG_POLL_INTERVAL_MS = 5 * 60 * 1000;

  const H = { "X-Inbox-Token": TG_INBOX_TOKEN };
  const H_JSON = { "Content-Type": "application/json", "X-Inbox-Token": TG_INBOX_TOKEN };

  async function pollInbox() {
    try {
      const r = await fetch(`${TG_BOT_URL}/inbox`, { headers: H });
      if (!r.ok) { console.warn("[tg-inbox] fetch failed:", r.status); return; }
      const data = await r.json();
      const bets = data.bets || [];
      if (!bets.length) return;
      console.log(`[tg-inbox] received ${bets.length} new bet(s) from bot`);
      const placed = [];
      const acked = [];
      for (const bet of bets) {
        acked.push(bet.id);
        try {
          if (placeTipsterBet(bet)) placed.push(bet.tipster || "Unknown");
        } catch (e) { console.warn("[tg-inbox] place failed", bet.id, e.message); }
      }
      if (acked.length) {
        await fetch(`${TG_BOT_URL}/inbox/ack`, {
          method: "POST", headers: H_JSON,
          body: JSON.stringify({ ids: acked }),
        }).catch(() => {});
      }
      if (placed.length && typeof toast === "function") {
        toast(`Auto-placed ${placed.length} tipster bet${placed.length === 1 ? "" : "s"}: ${placed.join(", ")}`);
      }
    } catch (e) {
      console.warn("[tg-inbox] poll error:", e.message);
    }
  }

  function placeTipsterBet(bet) {
    if (typeof P !== "function") { console.warn("[tg-inbox] RSFS globals not ready"); return false; }
    const p = P(); if (!p) return false;
    const s = (typeof S === "function") ? S() : { unitSize: 0.01, maxUnits: 5 };
    if (!bet.legs || !bet.legs.length) return false;
    const matched = [];
    for (const leg of bet.legs) {
      const m = matchLegToGame(leg);
      if (!m) { console.warn("[tg-inbox] no game match for", leg); return false; }
      matched.push(m);
    }
    const combinedDec = matched.reduce((a, l) => a * l.decimal, 1);
    const units = Math.min(Math.max(bet.units || 1, 0.25), s.maxUnits || 5);
    const stake = Math.min(units * p.bankroll * (s.unitSize || 0.01), p.bankroll);
    if (stake <= 0.01) { console.warn("[tg-inbox] bankroll too low"); return false; }
    const rsfsBet = {
      id: uid(),
      placedAt: nowISO(),
      type: matched.length === 1 ? "single" : "parlay",
      legs: matched.map(l => ({ ...l, status: "pending" })),
      stake: +stake.toFixed(2),
      decimal: combinedDec,
      american: matched.length === 1 ? matched[0].american : (typeof decimalToAmerican === "function" ? decimalToAmerican(combinedDec) : matched[0].american),
      toWin: +profit(stake, combinedDec).toFixed(2),
      status: "pending",
      settledAt: null,
      payout: 0,
      reason: (bet.reasoning || `Copied from ${bet.tipster}`).slice(0, 140),
      source: `TG: ${bet.tipster || "Unknown"}`,
      units,
      tipsterMessageId: bet.messageId,
      autoCopied: true,
    };
    p.bets.push(rsfsBet);
    p.bankroll -= rsfsBet.stake;
    if (typeof persistProfiles === "function") persistProfiles();
    if (typeof renderOpenBets === "function") renderOpenBets();
    if (typeof renderHeader === "function") renderHeader();
    console.log(`[tg-inbox] placed ${bet.tipster} bet:`, matched.map(l => l.outcome).join(" + "));
    return true;
  }

  function matchLegToGame(leg) {
    if (!leg || !leg.team) return null;
    if (typeof state === "undefined" || !state?.cache) return null;
    const target = leg.team.toLowerCase();
    const marketKey = leg.market === "moneyline" ? "h2h"
                    : leg.market === "spread" ? "spreads"
                    : leg.market === "total" ? "totals"
                    : null;
    if (!marketKey) return null;
    const sports = Object.keys(state.cache);
    for (const sportKey of sports) {
      const entry = state.cache[sportKey]; if (!entry) continue;
      for (const g of entry.games || []) {
        const home = (g.home_team || "").toLowerCase();
        const away = (g.away_team || "").toLowerCase();
        const teamMatches = home.includes(target) || target.includes(home) || away.includes(target) || target.includes(away);
        const isTotal = marketKey === "totals";
        if (!isTotal && !teamMatches) continue;
        for (const bm of g.bookmakers || []) {
          const market = (bm.markets || []).find(m => m.key === marketKey);
          if (!market) continue;
          for (const oc of market.outcomes || []) {
            const ocName = (oc.name || "").toLowerCase();
            let ok = false;
            if (isTotal) {
              if (leg.side === "over" && ocName === "over") ok = true;
              if (leg.side === "under" && ocName === "under") ok = true;
              if (!teamMatches) continue;
            } else {
              if (ocName.includes(target) || target.includes(ocName)) ok = true;
            }
            if (!ok) continue;
            if (leg.line != null && oc.point != null && Math.abs(oc.point - leg.line) > 0.5) continue;
            return {
              gameId: g.id,
              sportKey,
              sportTitle: g.sport_title || sportKey,
              home: g.home_team,
              away: g.away_team,
              start: g.commence_time,
              market: marketKey,
              outcome: oc.name,
              point: oc.point ?? null,
              american: oc.price,
              decimal: (typeof americanToDecimal === "function") ? americanToDecimal(oc.price) : (oc.price > 0 ? oc.price/100+1 : 100/Math.abs(oc.price)+1),
              book: bm.title,
              label: `${oc.name}${oc.point != null ? " " + (oc.point > 0 ? "+" : "") + oc.point : ""}`,
            };
          }
        }
      }
    }
    return null;
  }

  // Start the poll loop 5s after page load, then every 5 minutes.
  function boot() {
    setTimeout(pollInbox, 5000);
    setInterval(pollInbox, TG_POLL_INTERVAL_MS);
    console.log("[tg-inbox] poller started, hitting", TG_BOT_URL);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
