// tg-inbox.js — polls the Telegram bot every 5 min and places parsed tipster
// picks into RSFS, tagged by capper. Sizing = capper's units x your "1 unit = $X"
// value (set on the Cappers page). Auto-parlays are flagged as YOUR bets. Picks
// whose market isn't in your odds feed go to the Cappers "Review" list, not placed.
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
      if (typeof window.renderCappers === "function") { try { window.renderCappers(); } catch (e) {} }
      if (placed.length && typeof toast === "function") {
        toast(`Placed ${placed.length} pick${placed.length === 1 ? "" : "s"}: ${placed.join(", ")}`);
      }
    } catch (e) {
      console.warn("[tg-inbox] poll error:", e.message);
    }
  }

  // Park a pick we couldn't match to a real line into the Cappers "Review" list.
  function queueReview(p, bet, leg) {
    if (!Array.isArray(p.capperReview)) p.capperReview = [];
    p.capperReview.push({
      id: uid(),
      at: nowISO(),
      tipster: bet.tipster || "Unknown",
      kind: bet.kind || (bet.legs && bet.legs.length > 1 ? "parlay" : "single"),
      units: (bet.units != null ? bet.units : null),
      mine: !!bet.mine,
      reason: "no line in your feed for " + ((leg && (leg.team || leg.market)) || "this pick"),
      legs: bet.legs || [],
      messageId: bet.messageId || null,
    });
    if (p.capperReview.length > 200) p.capperReview = p.capperReview.slice(-100);
    if (typeof persistProfiles === "function") persistProfiles();
  }

  function placeTipsterBet(bet) {
    if (typeof P !== "function") { console.warn("[tg-inbox] RSFS globals not ready"); return false; }
    const p = P(); if (!p) return false;
    if (!bet.legs || !bet.legs.length) return false;
    const s = (typeof S === "function") ? S() : {};
    const unitUSD = Math.max(0.5, +s.capperUnitUSD || 10);   // your "1 unit = $X" value
    const safety = Math.max(0, +s.capperSafetyUSD || 0);      // optional per-play $ cap (0 = off)

    // Match every leg to a real line. If any leg has no match -> Review, don't place.
    const matched = [];
    for (const leg of bet.legs) {
      const m = matchLegToGame(leg);
      if (!m) { queueReview(p, bet, leg); return false; }
      matched.push(m);
    }

    const combinedDec = matched.reduce((a, l) => a * l.decimal, 1);
    const units = Math.max(0.25, +bet.units || 1);           // honor the capper's units (no cap)
    let stake = units * unitUSD;
    if (safety > 0) stake = Math.min(stake, safety);
    stake = Math.min(stake, p.bankroll);
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
      reason: (bet.reasoning || `From ${bet.tipster || "Unknown"}`).slice(0, 140),
      source: `TG: ${bet.tipster || "Unknown"}`,
      units,
      capperMine: !!bet.mine,                                 // true = YOUR auto-parlay, not the capper's
      capperKind: bet.kind || (matched.length > 1 ? "parlay" : "single"),
      tipsterMessageId: bet.messageId,
      autoCopied: true,
    };
    p.bets.push(rsfsBet);
    p.bankroll -= rsfsBet.stake;
    if (typeof persistProfiles === "function") persistProfiles();
    if (typeof renderOpenBets === "function") renderOpenBets();
    if (typeof renderHeader === "function") renderHeader();
    console.log(`[tg-inbox] placed ${bet.tipster}${bet.mine ? " (my parlay)" : ""}:`, matched.map(l => l.outcome).join(" + "));
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
              decimal: (typeof americanToDecimal === "function") ? americanToDecimal(oc.price) : (oc.price > 0 ? oc.price / 100 + 1 : 100 / Math.abs(oc.price) + 1),
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
