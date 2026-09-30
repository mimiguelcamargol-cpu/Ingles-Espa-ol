'use strict';
/* Backend de Mi Inglés: un solo usuario, sin dependencias.
   - Sirve la PWA solo con sesión válida (cookie HttpOnly firmada).
   - GET/PUT /api/state: sincroniza el progreso (fusión sin pérdidas).
   - GET /api/feed: lee RSS de podcasts en el servidor (evita CORS, con protección SSRF).
   Variables: APP_PASSWORD (obligatoria, ≥8), PORT, DATA_DIR, COOKIE_SECURE=1 detrás de HTTPS. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { merge } = require('../merge.js');

const ROOT = path.join(__dirname, '..');
const PORT = +process.env.PORT || 8080;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'storage'));
const PASSWORD = process.env.APP_PASSWORD || '';
const SECURE = process.env.COOKIE_SECURE === '1';
const SESSION_MS = 30 * 864e5;
const MAX_BODY = 2 * 1024 * 1024;

if (require.main === module && PASSWORD.length < 8) { console.error('Define APP_PASSWORD (mínimo 8 caracteres).'); process.exit(1); }
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

/* ---------- almacenamiento ---------- */
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret');
function secret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  try { return fs.readFileSync(SECRET_FILE, 'utf8'); } catch { }
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
  return s;
}
const SECRET = secret();
let db = { rev: 0, state: {} };
try { db = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { }
function persist() {
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
  const day = path.join(DATA_DIR, `state.${new Date().toISOString().slice(0, 10)}.bak`);
  if (fs.existsSync(STATE_FILE) && !fs.existsSync(day)) fs.copyFileSync(STATE_FILE, day);
  fs.renameSync(tmp, STATE_FILE);
  fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.bak')).sort().slice(0, -7).forEach(f => fs.unlinkSync(path.join(DATA_DIR, f)));
}

/* ---------- sesión ---------- */
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cookieOf = req => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map(c => { const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)]; }));
function authed(req) {
  const v = cookieOf(req).ie_sid; if (!v) return false;
  const [exp, mac] = v.split('.');
  return !!mac && +exp > Date.now() && safeEq(mac, sign(exp));
}
const newCookie = () => { const exp = String(Date.now() + SESSION_MS); return `ie_sid=${exp}.${sign(exp)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${SECURE ? '; Secure' : ''}`; };

const fails = new Map(); // ip -> [timestamps]
function limited(ip) { const now = Date.now(), a = (fails.get(ip) || []).filter(t => now - t < 15 * 60e3); fails.set(ip, a); return a.length >= 5; }
const noteFail = ip => fails.get(ip).push(Date.now());

/* ---------- utilidades HTTP ---------- */
const HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src *; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
const send = (res, code, body, type = 'application/json', extra = {}) => { res.writeHead(code, { ...HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra }); res.end(type === 'application/json' && typeof body !== 'string' && !Buffer.isBuffer(body) ? JSON.stringify(body) : body); };
function readJson(req) {
  return new Promise((ok, no) => {
    if (!/^application\/json/.test(req.headers['content-type'] || '')) return no(Object.assign(new Error('json'), { code: 415 }));
    let n = 0; const ch = [];
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { no(Object.assign(new Error('big'), { code: 413 })); req.destroy(); } else ch.push(c); });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(ch).toString() || '{}')); } catch { no(Object.assign(new Error('bad'), { code: 400 })); } });
  });
}
const sameOrigin = req => { const o = req.headers.origin; if (!o) return true; try { return new URL(o).host === req.headers.host; } catch { return false; } };

/* ---------- estáticos (lista blanca) ---------- */
const STATIC = /^\/(index\.html|app\.js|merge\.js|judge\.js|style\.css|sw\.js|manifest\.json|login\.html|login\.js|icons\/[\w.-]+|fonts\/[\w.-]+\.woff2|data\/(vocab|grammar|convo|levels)\.json|data\/talks\/[\w-]+\.json)$/;
const PUBLIC = new Set(['/login.html', '/login.js', '/style.css', '/manifest.json', '/icons/icon.svg', '/fonts/BricolageGrotesque.woff2', '/fonts/InstrumentSans.woff2']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
function serveStatic(res, p) {
  fs.readFile(path.join(ROOT, p), (e, buf) => e ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, buf, TYPES[path.extname(p)] || 'application/octet-stream', { 'Cache-Control': 'no-cache' }));
}

/* ---------- lector RSS con protección SSRF ---------- */
const privateIp = ip => net.isIPv6(ip)
  ? /^(::1?|f[cd]|fe[89ab])/i.test(ip) || /^::ffff:/i.test(ip)
  : /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|22[4-9]\.|2[3-5]\d\.)/.test(ip);
async function safeFetch(u, hops = 0) {
  const url = new URL(u);
  if (!/^https?:$/.test(url.protocol)) throw new Error('protocolo');
  const addrs = net.isIP(url.hostname) ? [{ address: url.hostname }] : await dns.lookup(url.hostname, { all: true });
  if (!addrs.length || addrs.some(a => privateIp(a.address))) throw new Error('destino no permitido');
  const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'MiIngles/1.0' } });
  if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { if (hops >= 3) throw new Error('redirecciones'); return safeFetch(new URL(r.headers.get('location'), url).href, hops + 1); }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 3 * 1024 * 1024) throw new Error('feed muy grande');
  return buf.toString('utf8');
}
const unxml = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
function parseFeed(xml) {
  const title = unxml((xml.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || 'Podcast');
  const items = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].slice(0, 30).map(m => {
    const it = m[0], enc = it.match(/<enclosure[^>]*\surl=["']([^"']+)["']/i);
    return { title: unxml((it.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || 'Episodio'), url: enc ? unxml(enc[1]) : '', date: unxml((it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '') };
  }).filter(i => /^https?:\/\//.test(i.url));
  return { title, items };
}

/* ---------- rutas ---------- */
async function handler(req, res) {
  const u = new URL(req.url, 'http://x'), p = u.pathname, ip = req.socket.remoteAddress;
  try {
    if (p === '/api/health') return send(res, 200, { ok: true });
    if (p === '/api/login' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, { error: 'origin' });
      if (limited(ip)) return send(res, 429, { error: 'rate' });
      const b = await readJson(req);
      if (typeof b.password === 'string' && safeEq(sign(b.password), sign(PASSWORD))) return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': newCookie() });
      noteFail(ip); return send(res, 401, { error: 'auth' });
    }
    if (p === '/api/logout' && req.method === 'POST') return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': 'ie_sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict' });

    const ok = authed(req);
    if (p.startsWith('/api/')) {
      if (!ok) return send(res, 401, { error: 'auth' });
      if (req.method !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'origin' });
      if (p === '/api/state' && req.method === 'GET') return send(res, 200, db);
      if (p === '/api/state' && req.method === 'PUT') {
        const b = await readJson(req);
        if (!b.state || typeof b.state !== 'object') return send(res, 400, { error: 'state' });
        const merged = merge(db.state, b.state);
        if (JSON.stringify(merged) !== JSON.stringify(db.state)) { db = { rev: db.rev + 1, state: merged }; persist(); }
        return send(res, 200, db);
      }
      if (p === '/api/feed' && req.method === 'GET') {
        try { return send(res, 200, parseFeed(await safeFetch(u.searchParams.get('url') || ''))); }
        catch (e) { return send(res, 502, { error: String(e.message || e) }); }
      }
      return send(res, 404, { error: 'not found' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
    const file = p === '/' ? '/index.html' : p;
    if (!STATIC.test(file)) return send(res, 404, 'Not found', 'text/plain');
    if (!ok && !PUBLIC.has(file)) {
      if ((req.headers.accept || '').includes('text/html')) return send(res, 302, '', 'text/plain', { Location: '/login.html' });
      return send(res, 401, 'Unauthorized', 'text/plain');
    }
    if (file === '/login.html' && ok) return send(res, 302, '', 'text/plain', { Location: '/' });
    serveStatic(res, file);
  } catch (e) {
    send(res, e.code >= 400 && e.code < 500 ? e.code : 500, { error: e.code ? e.message : 'server' });
  }
}

const server = http.createServer(handler);
if (require.main === module) server.listen(PORT, () => console.log(`Mi Inglés en http://localhost:${PORT}  (datos: ${DATA_DIR})`));
module.exports = { server, parseFeed, privateIp };
