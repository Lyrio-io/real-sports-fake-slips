const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, verify, constants } = require('node:crypto');
const { createKalshi, normalizePosition } = require('./kalshi-client.cjs');
const { createServer } = require('./server.cjs');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = {
  KALSHI_API_KEY_ID: 'test-key', KALSHI_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  KALSHI_VIEWER_USER: 'test-user', KALSHI_VIEWER_PASSWORD: 'test-password-for-local-checks-only'
};
const market = { market_type: 'binary', notional_value_dollars: '1.0000', status: 'active', title: 'Test market' };
const row = { ticker: 'TEST-A', position_fp: '10.00', market_exposure_dollars: '4.0000' };
test('remaining stake, gross payout and before-fee profit are distinct', () => {
  assert.deepEqual([normalizePosition(row, market).stakeUnits, normalizePosition(row, market).payoutUnits, normalizePosition(row, market).profitUnits], [40000, 100000, 60000]);
  const no = normalizePosition({ ...row, position_fp: '-2.50', market_exposure_dollars: '0.7501' }, market);
  assert.equal(no.side, 'No'); assert.equal(no.contracts, 2.5); assert.equal(no.profitUnits, 17499);
  assert.equal(normalizePosition({ ...row, position_fp: '0.00' }, market), null);
  assert.equal(normalizePosition(row, { ...market, status: 'settled' }), null);
  assert.equal(normalizePosition(row, { ...market, status: 'finalized' }), null);
});
test('legacy cents, missing cost and unavailable metadata are not confused with zero', () => {
  const legacy = normalizePosition({ ticker: 'A', position: -5, market_exposure: 130 }, { market_type: 'binary', notional_value: 100 });
  assert.equal(legacy.stakeUnits, 13000); assert.equal(legacy.payoutUnits, 50000);
  assert.equal(normalizePosition(row, null).payoutUnits, null);
  assert.equal(normalizePosition({ ticker: 'A', position_fp: '1' }, market).profitUnits, null);
  assert.equal(normalizePosition(row, { ...market, market_type: 'scalar' }).payoutUnits, null);
  assert.throws(() => normalizePosition({ ticker: 'A', position_fp: 'bad' }, market));
  const parlay = normalizePosition(row, { ...market, mve_selected_legs: [{ market_ticker: 'LEG', side: 'yes' }] });
  assert.equal(parlay.isParlay, true); assert.equal(parlay.legs[0].ticker, 'LEG');
});
test('requests use RSA-PSS, GET only, query-free signature; pages and concurrent cache are complete', async () => {
  const calls = [];
  const client = createKalshi(env, async (url, options) => {
    calls.push(url);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(url.origin, 'https://external-api.demo.kalshi.co');
    assert.ok(verify('sha256', Buffer.from(options.headers['KALSHI-ACCESS-TIMESTAMP'] + 'GET' + url.pathname),
      { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(options.headers['KALSHI-ACCESS-SIGNATURE'], 'base64')));
    const data = url.pathname.endsWith('/balance') ? { balance: 12345, portfolio_value: 600 }
      : url.pathname.endsWith('/positions') ? { market_positions: [{ ...row, ticker: url.searchParams.has('cursor') ? 'TEST-B' : 'TEST-A' }], cursor: url.searchParams.has('cursor') ? '' : 'next' }
      : { market };
    return new Response(JSON.stringify(data));
  });
  const [a, b] = await Promise.all([client.snapshot(), client.snapshot()]);
  assert.equal(a, b); assert.equal(a.positions.length, 2); assert.equal(a.balanceUnits, 1234500);
  assert.equal(calls.length, 5); await client.snapshot(); assert.equal(calls.length, 5);
  assert.ok(!JSON.stringify(a).includes('test-key'));
});
test('malformed or looping pagination fails instead of returning partial totals', async () => {
  for (const positions of [{}, { market_positions: [row], cursor: 'repeat' }]) {
    const client = createKalshi(env, async url => new Response(JSON.stringify(url.pathname.endsWith('/balance') ? { balance: 1 } : positions)));
    await assert.rejects(client.snapshot());
  }
});
test('upstream auth errors are sanitized; missing market details retain exposure', async () => {
  const bad = createKalshi(env, async () => new Response('PRIVATE UPSTREAM ERROR', { status: 401 }));
  await assert.rejects(bad.snapshot(), error => !error.message.includes('PRIVATE') && /credentials/.test(error.message));
  const client = createKalshi(env, async url => url.pathname.includes('/markets/') ? new Response('missing', { status: 404 })
    : new Response(JSON.stringify(url.pathname.endsWith('/balance') ? { balance: 1 } : { market_positions: [row] })));
  const data = await client.snapshot(); assert.equal(data.positions[0].stakeUnits, 40000); assert.equal(data.positions[0].profitUnits, null);
  assert.throws(() => createKalshi({ ...env, KALSHI_ENVIRONMENT: 'https://untrusted.invalid' }));
  assert.throws(() => createKalshi({ ...env, KALSHI_PRIVATE_KEY: 'private secret error' }), error => !error.message.includes('private secret error'));
});
test('private routes require auth, block writes and never serve source or credentials', async t => {
  let count = 0;
  const server = createServer(env, { snapshot: async () => { count++; return { positions: [] }; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: 'Basic ' + Buffer.from(env.KALSHI_VIEWER_USER + ':' + env.KALSHI_VIEWER_PASSWORD).toString('base64') };
  for (const route of ['/kalshi/', '/api/kalshi/portfolio', '/research/', '/api/research/games']) assert.equal((await fetch(base + route)).status, 401);
  assert.equal(count, 0);
  const page = await fetch(base + '/kalshi/', { headers }); assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store'); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(base + '/api/kalshi/portfolio', { headers })).status, 200);
  for (const route of ['/api/kalshi/portfolio', '/api/kalshi/orders']) {
    assert.equal((await fetch(base + route, { method: 'POST', headers })).status, 405);
  }
  assert.equal(count, 1);
  for (const route of ['/.env', '/.env.example', '/server.cjs', '/kalshi-client.cjs', '/kalshi.test.cjs', '/sports-research.cjs', '/research.html', '/.git/config', '/PROJECT_STATE.md', '/kalshi.html', '/package.json']) {
    assert.equal((await fetch(base + route)).status, 404, route);
  }
  assert.equal((await fetch(base + '/api/kalshi/portfolio', { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  for (const route of ['/', '/manifest.json', '/sw.js', '/tg-inbox.js', '/mocks/']) assert.equal((await fetch(base + route)).status, 200, route);
});
test('unset viewer protection fails closed without breaking the sandbox', async t => {
  const server = createServer({}); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/kalshi/portfolio')).status, 503);
  assert.equal((await fetch(base + '/')).status, 200);
});
