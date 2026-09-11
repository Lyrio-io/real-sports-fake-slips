const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { createHash, timingSafeEqual } = require('node:crypto');
const { createKalshi, KalshiError } = require('./kalshi-client.cjs');

const { createResearch } = require('./sports-research.cjs');
const publicFiles = new Set(['index.html', 'manifest.json', 'sw.js', 'tg-inbox.js', 'cappers.js',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'kalshi.css', 'kalshi-ui.js', 'research-ui.js', 'research.css']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
function digest(value) { return createHash('sha256').update(value).digest(); }
function createServer(env = process.env, injectedClient) {
  let client = injectedClient, research;
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    const reply = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      const privateRoute = url.pathname === '/kalshi' || url.pathname === '/kalshi/' || url.pathname.startsWith('/api/kalshi') || ['/research','/research/'].includes(url.pathname) || url.pathname.startsWith('/api/research');
      if (privateRoute) {
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        if (!env.KALSHI_VIEWER_USER || env.KALSHI_VIEWER_USER.includes(':') || (env.KALSHI_VIEWER_PASSWORD || '').length < 20) {
          return reply(503, { error: 'Set KALSHI_VIEWER_USER and a KALSHI_VIEWER_PASSWORD of at least 20 characters in Railway before opening Kalshi.' });
        }
        if (env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') return reply(403, { error: 'Use the Railway HTTPS URL.' });
        if (req.headers['sec-fetch-site'] === 'cross-site') return reply(403, { error: 'Open Kalshi from this app.' });
        const header = req.headers.authorization || '';
        const supplied = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString('utf8') : '';
        if (!timingSafeEqual(digest(supplied), digest(env.KALSHI_VIEWER_USER + ':' + env.KALSHI_VIEWER_PASSWORD))) {
          res.setHeader('WWW-Authenticate', 'Basic realm="Private Kalshi account", charset="UTF-8"');
          return reply(401, { error: 'Sign in with your private viewer username and password.' });
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/research/briefing') {
        if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, {error:'Use JSON.'});
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body)>8192) return reply(413,{error:'Research note is too large.'}); }
        let data; try { data=JSON.parse(body); } catch { return reply(400,{error:'Invalid research request.'}); }
        if (!data || typeof data !== 'object') return reply(400,{error:'Invalid research request.'});
        research ||= createResearch(env);
        return reply(200, await research.briefing(data.sport,data.id,data.note));
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return reply(405, { error: 'This integration is read-only.' });
      }
      if (url.pathname === '/healthz') return reply(200, { ok: true });
      if (url.pathname === '/api/kalshi/portfolio') {
        client ||= createKalshi(env);
        return reply(200, await client.snapshot());
      }
      if (url.pathname === '/api/research/games') { research ||= createResearch(env); return reply(200, await research.games(url.searchParams.get('sport'))); }
      if (url.pathname.startsWith('/api/')) return reply(404, { error: 'Not found.' });
      let file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (['kalshi', 'kalshi/'].includes(file)) file = 'kalshi.html';
      else if (['research','research/'].includes(file)) file = 'research.html';
      else if (file === 'mocks' || file === 'mocks/') file = 'mocks/index.html';
      if (!(privateRoute && ['kalshi.html','research.html'].includes(file)) && !publicFiles.has(file) && !/^mocks\/[a-zA-Z0-9-]+\.html$/.test(file)) return reply(404, { error: 'Not found.' });
      const content = await readFile(path.join(__dirname, file));
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      reply(error.code === 'ENOENT' ? 404 : error instanceof KalshiError ? error.status : 500,
        { error: error instanceof KalshiError ? error.message : 'This request could not be completed.' });
    }
  });
}
if (require.main === module) createServer().listen(Number(process.env.PORT) || 8080, '0.0.0.0', () => console.log('RSFS server ready'));
module.exports = { createServer };
