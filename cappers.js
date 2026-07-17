// cappers.js — "CAPPERS FREE" page for RSFS.
// Self-contained: injects its own bottom-nav tab (replacing Parlay), a side-rail
// entry, its own panel, and its own styles. Reads the tipster bets the bot
// auto-places (source "TG: <name>"), groups them by capper, sizes performance by
// each capper's called units times an adjustable "1 unit = $X" value you control,
// tracks win/loss from the app's own settlement, and ranks the cappers.
// Loaded from index.html via a <script> tag at the bottom of body, after tg-inbox.js.
(function () {
  "use strict";

  // ---- config (persisted on the active profile's settings) ----
  const DEFAULTS = { capperUnitUSD: 10, capperFavorites: [], capperSafetyUSD: 0 };

  function cfg() {
    try {
      const s = (typeof S === "function") ? S() : null;
      if (!s) return { ...DEFAULTS };
      if (s.capperUnitUSD == null) s.capperUnitUSD = DEFAULTS.capperUnitUSD;
      if (!Array.isArray(s.capperFavorites)) s.capperFavorites = [];
      if (s.capperSafetyUSD == null) s.capperSafetyUSD = DEFAULTS.capperSafetyUSD;
      return s;
    } catch (e) { return { ...DEFAULTS }; }
  }
  function saveCfg() { try { if (typeof persistProfiles === "function") persistProfiles(); } catch (e) {} }

  // ---- data now comes from the always-on bot, not this phone ----
  const TG_BOT_URL = "https://tg-bot-production-fa2a.up.railway.app";
  const TG_TOKEN = "rsfs-2026-tipster-inbox-9x8k4m";
  let CAP = { bets: [], review: [], loaded: false, error: null };

  async function loadLeaderboard() {
    try {
      const r = await fetch(`${TG_BOT_URL}/leaderboard`, { headers: { "X-Inbox-Token": TG_TOKEN } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      CAP = { bets: Array.isArray(d.bets) ? d.bets : [], review: Array.isArray(d.review) ? d.review : [], loaded: true, error: null };
    } catch (e) { CAP = { ...CAP, loaded: true, error: e.message }; }
    render();
  }

  async function rejectBet(id) {
    try {
      await fetch(`${TG_BOT_URL}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Inbox-Token": TG_TOKEN },
        body: JSON.stringify({ id }),
      });
    } catch (e) {}
    loadLeaderboard();
  }

  // ---- helpers ----
  const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const unitsFmt = (n) => (n > 0 ? "+" : "") + n.toFixed(2) + "u";
  const pct = (n) => (n * 100).toFixed(1) + "%";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const STAR_FILLED = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#f5a623" stroke="#f5a623" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
  const STAR_EMPTY = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#b8b8bf" stroke-width="1.7"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

  const SETTLED = { won: 1, lost: 1, push: 1, void: 1 };
  const OPENISH = { pending: 1, winning: 1, losing: 1 };

  function capperName(bet) {
    if (typeof bet.source === "string" && bet.source.indexOf("TG:") === 0) return bet.source.slice(3).trim() || "Unknown";
    return "Unknown";
  }
  function isCapperBet(bet) {
    return bet && typeof bet.source === "string" && bet.source.indexOf("TG:") === 0;
  }

  // per-play units, after applying the optional per-play safety cap (in $)
  function effUnits(bet) {
    const c = cfg();
    const unitUSD = Math.max(0.01, +c.capperUnitUSD || DEFAULTS.capperUnitUSD);
    const safety = Math.max(0, +c.capperSafetyUSD || 0);
    let u = Math.max(0, +bet.units || 1);
    if (safety > 0) u = Math.min(u, safety / unitUSD);
    return u;
  }
  // units profit/loss for a settled bet (0 for open/push/void)
  function unitsPL(bet) {
    const u = effUnits(bet);
    if (bet.status === "won") return u * (Math.max(1, +bet.decimal || 1) - 1);
    if (bet.status === "lost") return -u;
    return 0;
  }

  function buildBoard() {
    const capBets = CAP.bets.filter(b => isCapperBet(b) && !b.capperMine);
    const map = new Map();
    for (const b of capBets) {
      const name = capperName(b);
      if (!map.has(name)) map.set(name, { name, bets: [], w: 0, l: 0, push: 0, open: 0, netUnits: 0, unitsRisked: 0 });
      const c = map.get(name);
      c.bets.push(b);
      if (b.status === "won") { c.w++; c.netUnits += unitsPL(b); c.unitsRisked += effUnits(b); }
      else if (b.status === "lost") { c.l++; c.netUnits += unitsPL(b); c.unitsRisked += effUnits(b); }
      else if (b.status === "push") c.push++;
      else if (OPENISH[b.status]) c.open++;
    }
    const favs = cfg().capperFavorites || [];
    const rows = [...map.values()].map((c) => {
      c.settled = c.w + c.l;
      c.winPct = c.settled ? c.w / c.settled : 0;
      c.roi = c.unitsRisked ? c.netUnits / c.unitsRisked : 0;
      c.fav = favs.indexOf(c.name) !== -1;
      return c;
    });
    rows.sort((a, b) => (b.fav - a.fav) || (b.netUnits - a.netUnits) || (b.settled - a.settled));
    return rows;
  }

  // Your 0.25u auto-parlays (tagged capperMine) — shown separately, not on capper records.
  function buildMyParlays() {
    return CAP.bets.filter(b => isCapperBet(b) && b.capperMine).slice().reverse();
  }
  // Picks the odds feed couldn't match to a line — parked for review.
  function buildReview() {
    return CAP.review.slice().reverse();
  }
  // Readable label for a raw (unmatched) parsed leg.
  function parsedLegText(leg) {
    if (!leg) return "";
    const t = leg.team || "";
    const m = leg.market;
    if (m === "total") return (t + " " + (leg.side === "under" ? "u" : "o") + (leg.line ?? "")).trim();
    if (m === "moneyline") return (t + " ML").trim();
    if (m === "spread") return (t + " " + (leg.line > 0 ? "+" : "") + (leg.line ?? "")).trim();
    if (m === "first_five") return (t + " F5").trim();
    if (m === "yrfi") return (t + " YRFI").trim();
    if (m === "draw_no_bet") return (t + " DNB").trim();
    return (t + " " + (m || "")).trim();
  }

  // "verify" link to the original Telegram post so no pick has to be trusted blind.
  function verifyLink(url) {
    return url ? ' · <a href="' + esc(url) + '" target="_blank" rel="noopener" class="cap-verify">verify ↗</a>' : "";
  }
  // "reject" a bad parse — removes it from the ledger.
  function rejectBtn(id) {
    return id ? ' · <a class="cap-reject" data-reject="' + esc(id) + '">reject</a>' : "";
  }

  // ---- rendering ----
  function legText(leg) {
    if (!leg) return "";
    if (leg.label) return leg.label;
    const side = leg.outcome || leg.team || "";
    const pt = (leg.point != null) ? " " + (leg.point > 0 ? "+" : "") + leg.point : "";
    return (side + pt).trim();
  }
  function betLine(b) {
    const legs = Array.isArray(b.legs) ? b.legs.map(legText).filter(Boolean).join("  +  ") : "";
    const c = cfg();
    const unitUSD = Math.max(0.01, +c.capperUnitUSD || 10);
    const pl = unitsPL(b) * unitUSD;
    let statusCls = "cap-open", statusTxt = "OPEN";
    if (b.status === "won") { statusCls = "cap-won"; statusTxt = "WON " + money(pl); }
    else if (b.status === "lost") { statusCls = "cap-lost"; statusTxt = "LOST " + money(pl); }
    else if (b.status === "push") { statusTxt = "PUSH"; }
    else if (b.status === "void") { statusTxt = "VOID"; }
    const when = b.placedAt ? new Date(b.placedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
    return '<div class="cap-bet">'
      + '<div class="cap-bet-main"><span class="cap-bet-pick">' + esc(legs || "(pick)") + '</span>'
      + '<span class="cap-bet-meta">' + esc(when) + ' · ' + (+b.units || 1) + 'u' + verifyLink(b.tipsterLink) + rejectBtn(b.id) + '</span></div>'
      + '<span class="cap-bet-status ' + statusCls + '">' + esc(statusTxt) + '</span></div>';
  }

  function capperCard(c) {
    const conf = cfg();
    const unitUSD = Math.max(0.01, +conf.capperUnitUSD || 10);
    const netUSD = c.netUnits * unitUSD;
    const plCls = c.netUnits > 0.0001 ? "cap-pos" : (c.netUnits < -0.0001 ? "cap-neg" : "cap-flat");
    const rec = c.w + "-" + c.l + (c.push ? "-" + c.push : "");
    let follow;
    if (c.settled === 0) follow = "No settled bets yet — " + (c.open ? c.open + " still open." : "waiting on results.");
    else follow = "Follow " + esc(c.name) + " at $" + Math.round(unitUSD) + "/unit and you'd be " + (netUSD >= 0 ? "up " : "down ") + money(Math.abs(netUSD)) + " over " + c.settled + " settled bet" + (c.settled === 1 ? "" : "s") + ".";
    return '<div class="cap-card" data-capper="' + esc(c.name) + '">'
      + '<div class="cap-card-top">'
      + '<button class="cap-star" data-star="' + esc(c.name) + '" title="Favorite">' + (c.fav ? STAR_FILLED : STAR_EMPTY) + '</button>'
      + '<div class="cap-id"><div class="cap-name">' + esc(c.name) + '</div>'
      + '<div class="cap-sub">' + rec + ' record' + (c.settled ? ' · ' + pct(c.winPct) + ' win' : '') + (c.open ? ' · ' + c.open + ' open' : '') + '</div></div>'
      + '<div class="cap-figs"><div class="cap-units ' + plCls + '">' + unitsFmt(c.netUnits) + '</div>'
      + '<div class="cap-usd ' + plCls + '">' + money(netUSD) + '</div>'
      + '<div class="cap-roi">' + (c.unitsRisked ? (c.roi >= 0 ? "+" : "") + pct(c.roi) + " ROI" : "—") + '</div></div>'
      + '<button class="cap-expand" data-expand="' + esc(c.name) + '" aria-label="Show bets">▾</button>'
      + '</div>'
      + '<div class="cap-follow">' + follow + '</div>'
      + '<div class="cap-bets" data-bets="' + esc(c.name) + '" hidden>' + c.bets.slice().reverse().map(betLine).join("") + '</div>'
      + '</div>';
  }

  function render() {
    const root = document.getElementById("cappers-root");
    if (!root) return;
    const conf = cfg();
    const unitUSD = Math.max(0.01, +conf.capperUnitUSD || 10);
    const safety = Math.max(0, +conf.capperSafetyUSD || 0);
    const rows = buildBoard();

    const totNet = rows.reduce((a, c) => a + c.netUnits, 0);
    const totSettled = rows.reduce((a, c) => a + c.settled, 0);

    let head = ''
      + '<div class="cap-head">'
      + '<div class="cap-title">CAPPERS FREE</div>'
      + '<div class="cap-tagline">Everyone posting picks in the group, ranked by how they\'d have done on your money.</div>'
      + '<div class="cap-controls">'
      + '<label class="cap-ctl">1 unit = $<input id="cap-unit" type="number" min="1" step="1" value="' + unitUSD + '"></label>'
      + '<label class="cap-ctl">Max risk / play $<input id="cap-safety" type="number" min="0" step="5" value="' + safety + '" placeholder="off"></label>'
      + '<span class="cap-ctl-note">' + (safety > 0 ? "capped at " + money(safety) + " per play" : "no cap — full unit sizes") + '</span>'
      + '</div>'
      + (rows.length ? '<div class="cap-summary">' + rows.length + ' capper' + (rows.length === 1 ? '' : 's') + ' · ' + totSettled + ' settled · net ' + unitsFmt(totNet) + ' (' + money(totNet * unitUSD) + ')</div>' : '')
      + '</div>';

    let body;
    if (!CAP.loaded) {
      body = '<div class="cap-empty"><div class="cap-empty-h">Loading…</div></div>';
    } else if (CAP.error) {
      body = '<div class="cap-empty"><div class="cap-empty-h">Couldn\'t reach the bot</div><p class="cap-empty-sub">' + esc(CAP.error) + ' — it\'ll retry automatically.</p></div>';
    } else if (!rows.length) {
      body = '<div class="cap-empty">'
        + '<div class="cap-empty-h">No capper picks yet</div>'
        + '<p>Your bot is watching the group 24/7. As cappers post picks, they get placed here automatically — even with the app closed — and this board fills in with each person\'s record.</p>'
        + '</div>';
    } else {
      body = '<div class="cap-list">' + rows.map(capperCard).join("") + '</div>';
    }

    // My Parlays — your 0.25u combos, not counted on cappers
    const mine = buildMyParlays();
    let mineHtml = "";
    if (mine.length) {
      mineHtml = '<div class="cap-section"><div class="cap-section-h">My Parlays <span class="cap-section-sub">(your ' + '0.25u combos — not counted on the cappers)</span></div>'
        + mine.map(b => {
            const pl = unitsPL(b) * unitUSD;
            let st = "cap-open", tx = "OPEN";
            if (b.status === "won") { st = "cap-won"; tx = "WON " + money(pl); }
            else if (b.status === "lost") { st = "cap-lost"; tx = "LOST " + money(pl); }
            else if (b.status === "push") { tx = "PUSH"; } else if (b.status === "void") { tx = "VOID"; }
            const legs = Array.isArray(b.legs) ? b.legs.map(legText).filter(Boolean).join("  +  ") : "";
            return '<div class="cap-bet"><div class="cap-bet-main"><span class="cap-bet-pick">' + esc(capperName(b)) + ": " + esc(legs) + '</span><span class="cap-bet-meta">' + (+b.units || 0.25) + 'u parlay' + verifyLink(b.tipsterLink) + rejectBtn(b.id) + '</span></div><span class="cap-bet-status ' + st + '">' + esc(tx) + '</span></div>';
          }).join("")
        + '</div>';
    }

    // Review — picks the odds feed couldn't match
    const review = buildReview();
    let reviewHtml = "";
    if (review.length) {
      reviewHtml = '<div class="cap-section"><div class="cap-section-h">Review <span class="cap-section-sub">(' + review.length + ' pick' + (review.length === 1 ? "" : "s") + " your odds feed couldn't match — nothing guessed)</span></div>"
        + review.map(rv => {
            const legs = Array.isArray(rv.legs) ? rv.legs.map(parsedLegText).filter(Boolean).join("  +  ") : "";
            return '<div class="cap-bet cap-review"><div class="cap-bet-main"><span class="cap-bet-pick">' + esc(rv.tipster || "Unknown") + ": " + esc(legs) + '</span><span class="cap-bet-meta">' + esc(rv.reason || "") + verifyLink(rv.link) + rejectBtn(rv.id) + '</span></div></div>';
          }).join("")
        + '</div>';
    }

    root.innerHTML = head + body + mineHtml + reviewHtml;
    wire(root);
  }

  function wire(root) {
    const unit = root.querySelector("#cap-unit");
    if (unit) unit.addEventListener("change", () => {
      const v = Math.max(1, +unit.value || 10);
      cfg().capperUnitUSD = v; saveCfg(); render();
    });
    const safety = root.querySelector("#cap-safety");
    if (safety) safety.addEventListener("change", () => {
      const v = Math.max(0, +safety.value || 0);
      cfg().capperSafetyUSD = v; saveCfg(); render();
    });
    root.querySelectorAll("[data-star]").forEach((btn) => btn.addEventListener("click", () => {
      const name = btn.getAttribute("data-star");
      const favs = cfg().capperFavorites;
      const i = favs.indexOf(name);
      if (i === -1) favs.push(name); else favs.splice(i, 1);
      saveCfg(); render();
    }));
    root.querySelectorAll("[data-expand]").forEach((btn) => btn.addEventListener("click", () => {
      const name = btn.getAttribute("data-expand");
      const list = root.querySelector('[data-bets="' + CSS.escape(name) + '"]');
      if (list) { list.hidden = !list.hidden; btn.textContent = list.hidden ? "▾" : "▴"; }
    }));
    root.querySelectorAll("[data-reject]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.preventDefault();
      const id = btn.getAttribute("data-reject");
      if (id && confirm("Remove this pick? It won't count toward the capper.")) rejectBet(id);
    }));
  }

  // ---- one-time DOM injection ----
  function injectStyles() {
    if (document.getElementById("cap-styles")) return;
    const css = ''
      + '#cappers-root{padding:16px;max-width:900px;margin:0 auto;}'
      + '.cap-head{margin-bottom:14px;}'
      + '.cap-title{font-size:26px;font-weight:800;letter-spacing:-.5px;color:#14141a;}'
      + '.cap-tagline{color:#6b6b76;font-size:14px;margin-top:2px;}'
      + '.cap-controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:12px;}'
      + '.cap-ctl{display:inline-flex;align-items:center;gap:6px;background:#f4f4f6;border:1px solid #e6e6ea;border-radius:12px;padding:8px 12px;font-size:14px;font-weight:600;color:#14141a;}'
      + '.cap-ctl input{width:64px;border:none;background:#fff;border-radius:8px;padding:4px 8px;font-size:14px;font-weight:700;color:#14141a;text-align:right;}'
      + '.cap-ctl-note{font-size:12px;color:#8a8a93;}'
      + '.cap-summary{margin-top:10px;font-size:13px;color:#6b6b76;font-weight:600;}'
      + '.cap-list{display:flex;flex-direction:column;gap:10px;}'
      + '.cap-card{background:#fff;border:1px solid #ececf0;border-radius:16px;padding:14px;box-shadow:0 1px 2px rgba(0,0,0,.03);}'
      + '.cap-card-top{display:flex;align-items:center;gap:10px;}'
      + '.cap-star{background:none;border:none;cursor:pointer;padding:2px;line-height:0;flex:none;}'
      + '.cap-id{flex:1;min-width:0;}'
      + '.cap-name{font-size:16px;font-weight:800;color:#14141a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '.cap-sub{font-size:12px;color:#8a8a93;font-weight:600;}'
      + '.cap-figs{text-align:right;flex:none;}'
      + '.cap-units{font-size:17px;font-weight:800;line-height:1.1;}'
      + '.cap-usd{font-size:13px;font-weight:700;line-height:1.2;}'
      + '.cap-roi{font-size:11px;color:#8a8a93;font-weight:600;}'
      + '.cap-pos{color:#16a34a;}.cap-neg{color:#dc2626;}.cap-flat{color:#6b6b76;}'
      + '.cap-expand{background:none;border:none;color:#b8b8bf;font-size:16px;cursor:pointer;padding:4px 6px;flex:none;}'
      + '.cap-follow{margin-top:8px;font-size:13px;color:#4b4b55;background:#f7f7f9;border-radius:10px;padding:8px 10px;}'
      + '.cap-bets{margin-top:8px;display:flex;flex-direction:column;gap:6px;}'
      + '.cap-bets[hidden]{display:none;}'
      + '.cap-bet{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#fafafb;border:1px solid #f0f0f3;border-radius:10px;}'
      + '.cap-bet-main{min-width:0;}'
      + '.cap-bet-pick{display:block;font-size:13px;font-weight:600;color:#14141a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '.cap-bet-meta{font-size:11px;color:#9a9aa2;}'
      + '.cap-bet-status{font-size:11px;font-weight:800;flex:none;white-space:nowrap;}'
      + '.cap-won{color:#16a34a;}.cap-lost{color:#dc2626;}.cap-open{color:#9a9aa2;}'
      + '.cap-empty{text-align:center;padding:36px 18px;color:#6b6b76;}'
      + '.cap-empty-h{font-size:18px;font-weight:800;color:#14141a;margin-bottom:6px;}'
      + '.cap-empty p{font-size:14px;max-width:420px;margin:6px auto;}'
      + '.cap-empty-sub{font-size:12px;color:#9a9aa2;}'
      + '.cap-section{margin-top:22px;}'
      + '.cap-section-h{font-size:15px;font-weight:800;color:#14141a;margin-bottom:8px;}'
      + '.cap-section-sub{font-weight:600;font-size:12px;color:#9a9aa2;}'
      + '.cap-review{border-left:3px solid #f5a623;}'
      + '.cap-verify{color:#16a34a;font-weight:700;text-decoration:none;}'
      + '.cap-reject{color:#dc2626;font-weight:700;text-decoration:none;cursor:pointer;}'
      // Force the light look regardless of the phone's dark-mode setting (the app
      // stays on a white background, so dark text is what stays readable).
      + '#cappers-root,#cappers-root *{color-scheme:light;}';
    const st = document.createElement("style");
    st.id = "cap-styles"; st.textContent = css;
    document.head.appendChild(st);
  }

  function injectPanel() {
    if (document.querySelector('[data-tab-content="cappers"]')) return;
    const sibling = document.querySelector('[data-tab-content="open"]') || document.querySelector('[data-tab-content]');
    if (!sibling || !sibling.parentNode) return;
    const panel = document.createElement("div");
    panel.className = "tab-content";
    panel.setAttribute("data-tab-content", "cappers");
    panel.setAttribute("data-active", "false");
    panel.innerHTML = '<div id="cappers-root"></div>';
    sibling.parentNode.appendChild(panel);
  }

  const CAP_ICON = '<svg class="bn-icon w-6 h-6 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4a2 2 0 0 1-2-2V5h4"></path><path d="M18 9h2a2 2 0 0 0 2-2V5h-4"></path><path d="M6 4h12v5a6 6 0 0 1-12 0z"></path><path d="M9 18h6M10 22h4M12 15v3"></path></svg>';
  const CAP_ICON_RAIL = '<svg class="nav-icon w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4a2 2 0 0 1-2-2V5h4"></path><path d="M18 9h2a2 2 0 0 0 2-2V5h-4"></path><path d="M6 4h12v5a6 6 0 0 1-12 0z"></path><path d="M9 18h6M10 22h4M12 15v3"></path></svg>';

  function open() { if (typeof switchTab === "function") switchTab("cappers"); }

  function injectNav() {
    // Mobile bottom nav: replace the Parlay button with a fresh Cappers button.
    const bnParlay = document.querySelector('.bottom-nav-btn[data-tab="parlay"]');
    if (bnParlay && !document.querySelector('.bottom-nav-btn[data-tab="cappers"]')) {
      const b = document.createElement("button");
      b.className = bnParlay.className;
      b.setAttribute("data-tab", "cappers");
      b.setAttribute("data-active", "false");
      b.innerHTML = CAP_ICON + '<span class="bn-label text-[10px] text-ink-400 font-semibold">Cappers</span>';
      b.addEventListener("click", open);
      bnParlay.parentNode.replaceChild(b, bnParlay);
    }
    // Desktop side rail: add a Cappers entry next to Parlay (Parlay stays).
    const railParlay = [...document.querySelectorAll(".nav-rail-btn")].find((x) => x.getAttribute("data-tab") === "parlay");
    if (railParlay && !document.querySelector('.nav-rail-btn[data-tab="cappers"]')) {
      const r = document.createElement("button");
      r.className = railParlay.className;
      r.setAttribute("data-tab", "cappers");
      r.setAttribute("data-active", "false");
      r.innerHTML = CAP_ICON_RAIL + '<span class="font-semibold">Cappers</span>';
      r.addEventListener("click", open);
      railParlay.parentNode.insertBefore(r, railParlay.nextSibling);
    }
  }

  function patchSwitchTab() {
    if (typeof switchTab !== "function" || switchTab.__capWrapped) return;
    const orig = switchTab;
    window.switchTab = function (name) {
      const r = orig.apply(this, arguments);
      if (name === "cappers") { try { loadLeaderboard(); } catch (e) { console.warn("[cappers] load", e); } }
      return r;
    };
    window.switchTab.__capWrapped = true;
  }

  function boot() {
    try {
      injectStyles();
      injectPanel();
      injectNav();
      patchSwitchTab();
      window.renderCappers = loadLeaderboard;   // external refresh hook
      render();               // paint the shell (Loading…) immediately
      loadLeaderboard();      // then pull from the bot
      // refresh from the server while the tab is open
      setInterval(() => { try { if (typeof state !== "undefined" && state.activeTab === "cappers") loadLeaderboard(); } catch (e) {} }, 60 * 1000);
      console.log("[cappers] page ready");
    } catch (e) { console.warn("[cappers] boot failed", e); }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
