const { createPrivateKey, sign, constants, createHash } = require('node:crypto');

class KalshiError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
// Preserve sub-cent API precision. Missing or malformed values are never zero.
function decimal(value, scale = 10000) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (!/^-?\d+(\.\d+)?$/.test(String(value))) return null;
  const n = Number(value) * scale;
  return Number.isSafeInteger(Math.round(n)) ? Math.round(n) : null;
}
function money(row, name) {
  return row[name + '_dollars'] != null ? decimal(row[name + '_dollars']) : decimal(row[name], 100);
}
function normalizePosition(row, market) {
  const count = row.position_fp != null ? decimal(row.position_fp, 100) : decimal(row.position, 100);
  if (count === null || typeof row.ticker !== 'string') throw new KalshiError('Kalshi returned an invalid position. Totals are unavailable.');
  if (!count || (market && ['settled', 'finalized'].includes(market.status))) return null;
  const stakeUnits = money(row, 'market_exposure');
  const notional = market ? money(market, 'notional_value') : null;
  const potential = market?.market_type === 'binary' && notional !== null && notional > 0
    ? Math.round(Math.abs(count) * notional / 100) : null;
  const payoutUnits = Number.isSafeInteger(potential) ? potential : null;
  const validStake = stakeUnits !== null && stakeUnits >= 0 ? stakeUnits : null;
  return {
    id: `${row.exchange_index ?? 0}:${row.ticker}:${count > 0 ? 'yes' : 'no'}`,
    ticker: row.ticker, title: market?.title || row.ticker,
    side: count > 0 ? 'Yes' : 'No', contracts: Math.abs(count) / 100,
    status: market?.status || 'Unknown',
    stakeUnits: validStake, payoutUnits,
    profitUnits: payoutUnits !== null && validStake !== null ? payoutUnits - validStake : null,
    isParlay: Boolean(market?.mve_collection_ticker || market?.mve_selected_legs?.length),
    legs: (market?.mve_selected_legs || []).map(leg => ({ ticker: leg.market_ticker, side: leg.side })),
    metadataAvailable: Boolean(market)
  };
}

function createKalshi(env = process.env, fetchImpl = fetch) {
  const environment = env.KALSHI_ENVIRONMENT || 'demo';
  if (!['demo', 'production'].includes(environment)) throw new KalshiError('KALSHI_ENVIRONMENT must be demo or production.', 503);
  if (!env.KALSHI_API_KEY_ID || !env.KALSHI_PRIVATE_KEY) throw new KalshiError('Add Kalshi credentials in Railway to connect your account.', 503);
  let privateKey;
  try {
    privateKey = createPrivateKey(env.KALSHI_PRIVATE_KEY.replace(/\\n/g, '\n'));
    if (!['rsa', 'rsa-pss'].includes(privateKey.asymmetricKeyType)) throw Error();
  } catch { throw new KalshiError('The server Kalshi private key is invalid. Check Railway variables.', 503); }
  const origin = environment === 'production' ? 'https://external-api.kalshi.com' : 'https://external-api.demo.kalshi.co';
  const accountScope = createHash('sha256').update(environment + ':' + env.KALSHI_API_KEY_ID).digest('hex').slice(0, 24);
  // Deliberately no generic proxy or HTTP method argument: only these three reads exist.
  async function get(path, query = {}) {
    if (!/^\/portfolio\/(balance|positions)$/.test(path) && !/^\/markets\/[^/]+$/.test(path)) throw new KalshiError('Read endpoint not allowed.');
    const url = new URL('/trade-api/v2' + path, origin);
    url.search = new URLSearchParams(query).toString();
    for (let attempt = 0; attempt < 3; attempt++) {
      const timestamp = String(Date.now());
      const signature = sign('sha256', Buffer.from(timestamp + 'GET' + url.pathname), {
        key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32
      }).toString('base64');
      let response;
      try {
        response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(12000), headers: {
          'KALSHI-ACCESS-KEY': env.KALSHI_API_KEY_ID,
          'KALSHI-ACCESS-TIMESTAMP': timestamp, 'KALSHI-ACCESS-SIGNATURE': signature,
          Accept: 'application/json'
        }});
      } catch { throw new KalshiError('Kalshi could not be reached. Try refreshing shortly.'); }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await response.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new KalshiError([401, 403].includes(response.status)
          ? 'Kalshi rejected the server credentials. Check the key and environment in Railway.'
          : 'Kalshi data is temporarily unavailable. Try refreshing shortly.');
      }
      try { return await response.json(); } catch { throw new KalshiError('Kalshi returned an unreadable response.'); }
    }
  }
  async function positions() {
    const rows = new Map(), cursors = new Set();
    let cursor = '';
    for (let page = 0; page < 100; page++) {
      const data = await get('/portfolio/positions', { limit: '1000', count_filter: 'position', subaccount: '0', ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(data.market_positions)) throw new KalshiError('Kalshi positions are missing. Totals are unavailable.');
      for (const row of data.market_positions) rows.set(`${row.exchange_index ?? 0}:${row.ticker}`, row);
      cursor = data.cursor;
      if (!cursor) return [...rows.values()];
      if (typeof cursor !== 'string' || cursors.has(cursor)) break;
      cursors.add(cursor);
    }
    throw new KalshiError('The complete position list could not be loaded. Totals are unavailable.');
  }
  let cached, pending, retryAt = 0;
  async function snapshot() {
    if (cached && Date.now() - cached.time < 30000) return cached.data;
    if (pending) return pending;
    if (Date.now() < retryAt) throw new KalshiError('Please wait a few seconds before refreshing again.');
    pending = (async () => {
      const [balance, rows] = await Promise.all([get('/portfolio/balance', { subaccount: '0' }), positions()]);
      const output = new Array(rows.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
        while (next < rows.length) {
          const index = next++, row = rows[index];
          if (!normalizePosition(row, null)) { output[index] = null; continue; }
          let market = null;
          // Preserve position exposure if optional market metadata is unavailable.
          try { const result = await get('/markets/' + encodeURIComponent(row.ticker)); market = result.market || null; } catch {}
          output[index] = normalizePosition(row, market);
        }
      }));
      const data = { environment, accountScope, asOf: new Date().toISOString(),
        balanceUnits: money(balance, 'balance'), portfolioValueUnits: money(balance, 'portfolio_value'),
        positions: output.filter(Boolean) };
      cached = { time: Date.now(), data };
      return data;
    })();
    try { return await pending; } catch (error) { retryAt = Date.now() + 5000; throw error; }
    finally { pending = null; }
  }
  return { snapshot };
}
module.exports = { createKalshi, normalizePosition, decimal, KalshiError };
