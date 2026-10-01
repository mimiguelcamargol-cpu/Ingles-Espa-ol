const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
process.env.APP_PASSWORD = 'clave-de-prueba-123';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-'));
const { merge } = require('../merge.js');
const { server, parseFeed, privateIp, setOutFetch } = require('../server/server.js');
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
  assert.equal((await api('/data/talks/neighbour.json')).status, 401);
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
  const tk = await api('/data/talks/neighbour.json'); assert.equal(tk.status, 200); assert.equal((await tk.json()).id, 'neighbour');
  assert.equal((await api('/data/talks/..%2f..%2fserver%2fserver.js')).status, 404);
  assert.equal((await api('/judge.js')).status, 200);
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

test('diccionario: define con traducción, usa caché y valida la palabra', async () => {
  let calls = 0;
  setOutFetch(async url => {
    calls++;
    const j = o => new Response(JSON.stringify(o), { status: 200 });
    if (url.includes('dictionaryapi.dev')) return j([{ word: 'neighbour', phonetic: '/ˈneɪ.bə/', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A person living next door.', example: 'My neighbour is kind.' }] }] }]);
    if (url.includes('mymemory')) return j({ responseData: { translatedText: 'vecino' }, matches: [{ translation: 'vecino' }, { translation: 'vecina' }] });
    return new Response('x', { status: 404 });
  });
  const r = await (await api('/api/define?word=neighbour')).json();
  assert.equal(r.found, true); assert.equal(r.meanings[0].defs[0].d, 'A person living next door.'); assert.deepEqual(r.es, ['vecino', 'vecina']);
  const before = calls; await (await api('/api/define?word=neighbour')).json(); assert.equal(calls, before, 'segunda consulta sale de caché');
  const es = await (await api('/api/define?word=vecino&from=es')).json(); assert.equal(es.from, 'es');
  assert.equal((await api('/api/define?word=' + encodeURIComponent('a;rm -rf'))).status, 400);
  assert.equal((await api('/api/define?word=')).status, 400);
});
test('gramática: valida entrada y mapea resultados', async () => {
  setOutFetch(async (url, o) => { assert.match(String(o.body), /language=en-US/); return new Response(JSON.stringify({ matches: [{ offset: 0, length: 3, message: 'Possible agreement error', replacements: [{ value: 'She' }], rule: { id: 'HE_VERB_AGR' } }] }), { status: 200 }); });
  const r = await (await api('/api/grammar', { method: 'POST', body: JSON.stringify({ text: 'He go home' }) })).json();
  assert.equal(r.matches[0].replacements[0], 'She'); assert.equal(r.matches[0].rule, 'HE_VERB_AGR');
  assert.equal((await api('/api/grammar', { method: 'POST', body: JSON.stringify({ text: '' }) })).status, 400);
  assert.equal((await api('/api/grammar', { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(3001) }) })).status, 400);
});
test('servicios externos exigen sesión y los archivos del OCR se sirven solo con sesión', async () => {
  const saved = cookie; cookie = '';
  assert.equal((await api('/api/define?word=hello')).status, 401);
  assert.equal((await api('/api/grammar', { method: 'POST', body: '{"text":"hi"}' })).status, 401);
  assert.equal((await api('/vendor/tesseract/worker.min.js')).status, 401);
  cookie = saved;
  const w = await api('/vendor/tesseract/worker.min.js'); assert.equal(w.status, 200);
  const g = await api('/vendor/tesseract/lang/eng.traineddata.gz'); assert.equal(g.status, 200); assert.equal(g.headers.get('content-type'), 'application/gzip');
  assert.equal((await api('/vendor/tesseract/..%2f..%2fserver%2fserver.js')).status, 404);
  assert.match((await api('/index.html')).headers.get('content-security-policy'), /wasm-unsafe-eval/);
});

test('merge: lecturas se unen, respetan borrado y conservan el mejor puntaje', () => {
  const a = { reads: [{ id: 'r1', title: 'A', text: 'old', t: 1, best: 70 }] };
  const b = { reads: [{ id: 'r1', title: 'B', text: 'new text', t: 5, best: 40, del: true }, { id: 'r2', title: 'C', text: 'x y z', t: 2, best: 0 }] };
  const m = merge(a, b); assert.deepEqual(m, merge(b, a));
  const r1 = m.reads.find(r => r.id === 'r1'); assert.equal(r1.text, 'new text'); assert.equal(r1.best, 70); assert.equal(r1.del, true); assert.equal(m.reads.length, 2);
});
