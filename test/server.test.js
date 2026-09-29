const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
process.env.APP_PASSWORD = 'clave-de-prueba-123';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-'));
const { merge } = require('../merge.js');
const { server, parseFeed, privateIp } = require('../server/server.js');
let base, cookie = '';
const api = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { 'content-type': 'application/json', cookie, ...(o.headers || {}) } });
test.before(() => new Promise(r => server.listen(0, () => { base = 'http://127.0.0.1:' + server.address().port; r(); })));
test.after(() => server.close());

test('sin sesión: 401 en API, redirige a login y no filtra datos', async () => {
  assert.equal((await api('/api/state')).status, 401);
  const r = await api('/', { headers: { accept: 'text/html' } });
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/login.html');
  assert.equal((await api('/data/vocab.json')).status, 401);
  assert.equal((await api('/server/server.js')).status, 404);
  assert.equal((await api('/login.html')).status, 200);
});
test('login incorrecto y correcto', async () => {
  assert.equal((await api('/api/login', { method: 'POST', body: JSON.stringify({ password: 'x' }) })).status, 401);
  const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  const v = await api('/data/vocab.json'); assert.equal(v.status, 200);
  assert.ok(Array.isArray(await v.json()), 'los estáticos JSON deben servirse tal cual');
});
test('sincroniza y fusiona sin perder progreso', async () => {
  const a = { srs: { 'x|noun': { b: 2, t: 10 } }, gram: { g1: 50 }, devLevel: 2, stats: { days: { '2026-01-01': 3 } } };
  const b = { srs: { 'x|noun': { b: 4, t: 20 }, 'y|verb': { b: 1, t: 5 } }, gram: { g1: 80 }, devLevel: 1, stats: { days: { '2026-01-01': 5 } } };
  await api('/api/state', { method: 'PUT', body: JSON.stringify({ state: a }) });
  const j = await (await api('/api/state', { method: 'PUT', body: JSON.stringify({ state: b }) })).json();
  assert.equal(j.state.srs['x|noun'].b, 4); assert.ok(j.state.srs['y|verb']);
  assert.equal(j.state.gram.g1, 80); assert.equal(j.state.devLevel, 2); assert.equal(j.state.stats.days['2026-01-01'], 5);
  const again = await (await api('/api/state')).json(); assert.deepEqual(again.state, j.state);
});
test('CSRF: rechaza origen ajeno y cuerpo no JSON', async () => {
  assert.equal((await api('/api/state', { method: 'PUT', headers: { origin: 'https://evil.example' }, body: '{"state":{}}' })).status, 403);
  assert.equal((await api('/api/state', { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
});
test('feed: bloquea destinos internos (SSRF)', async () => {
  for (const u of ['http://127.0.0.1:1/x', 'http://169.254.169.254/latest', 'file:///etc/passwd', 'http://[::1]/'])
    assert.equal((await api('/api/feed?url=' + encodeURIComponent(u))).status, 502, u);
  assert.ok(privateIp('10.0.0.5') && privateIp('192.168.1.1') && !privateIp('8.8.8.8'));
});
test('parseFeed extrae episodios', () => {
  const f = parseFeed('<rss><channel><title>Show</title><item><title><![CDATA[Ep 1 &amp; más]]></title><enclosure url="https://a.com/1.mp3" type="audio/mpeg"/></item><item><title>Sin audio</title></item></channel></rss>');
  assert.equal(f.title, 'Show'); assert.equal(f.items.length, 1); assert.equal(f.items[0].url, 'https://a.com/1.mp3');
});
test('merge es conmutativo e idempotente', () => {
  const a = { srs: { w: { b: 1, t: 1 } }, pods: [{ id: 'p', pos: 5, del: false }], exams: [{ id: 'e1', d: '2026-01-01', p: 50, lv: 'B1.1' }] };
  const b = { srs: { w: { b: 3, t: 2 } }, pods: [{ id: 'p', pos: 2, del: true }], exams: [{ id: 'e2', d: '2026-01-02', p: 70, lv: 'B1.1' }] };
  assert.deepEqual(merge(a, b), merge(b, a));
  const m = merge(a, b); assert.deepEqual(merge(m, m), m);
  assert.equal(m.pods[0].del, true); assert.equal(m.pods[0].pos, 5); assert.equal(m.exams.length, 2);
});
