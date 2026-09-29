'use strict';
/* Mi Inglés — PWA privada, 100% local: sin servidores ni llamadas a IA (0 tokens en uso). */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rnd = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const DAY = 864e5;
const BOX_DAYS = [0, 1, 2, 4, 8, 16, 32];

/* ---------- estado ---------- */
const KEY = 'ie.state.v1';
const defaults = () => ({ pin: null, rate: 0.9, unlockAll: false, srs: {}, gram: {}, convo: {}, devLevel: 1, exams: [], pods: [], stats: { days: {} } });
let S;
try { S = { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { S = defaults(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { } };
const today = () => new Date().toISOString().slice(0, 10);
const tick = (n = 1) => { S.stats.days[today()] = (S.stats.days[today()] || 0) + n; save(); };
const streak = () => { let n = 0, d = new Date(); while (S.stats.days[d.toISOString().slice(0, 10)]) { n++; d = new Date(d - DAY); } return n; };

/* ---------- datos ---------- */
let VOCAB = [], GRAM = [], CONVO = [], LEVELS = [];
const load = f => fetch('data/' + f + '.json').then(r => r.json());
async function init() {
  [VOCAB, GRAM, CONVO, LEVELS] = await Promise.all([load('vocab'), load('grammar'), load('convo'), load('levels')]);
  VOCAB = VOCAB.map(([en, es, pos, lv, ex]) => ({ id: en + '|' + pos, en, es, pos, lv, ex }));
  addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
}

/* ---------- voz ---------- */
function speak(text, rate) {
  if (!('speechSynthesis' in window)) return alert('Tu navegador no tiene voz (TTS).');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US'; u.rate = rate || S.rate;
  const v = speechSynthesis.getVoices().find(v => v.lang.startsWith('en') && /US|GB/.test(v.lang));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}
function listen(cb) {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) return alert('Reconocimiento de voz no disponible (usa Chrome/Edge/Safari).');
  const r = new R(); r.lang = 'en-US'; r.interimResults = false;
  r.onresult = e => cb(e.results[0][0].transcript);
  r.onerror = () => cb('');
  r.start();
}
const norm = s => s.toLowerCase().replace(/[^a-z' ]/g, '').trim();
const similarity = (a, b) => { const A = norm(a).split(/\s+/), B = new Set(norm(b).split(/\s+/)); return A.filter(w => B.has(w)).length / Math.max(1, B.size); };

/* ---------- niveles / SRS ---------- */
const lvlIdx = id => LEVELS.findIndex(l => l.id === id);
const wordsOf = id => VOCAB.filter(w => w.lv === id);
const box = w => (S.srs[w.id] || { b: 0 }).b;
function levelUnlocked(i) {
  if (S.unlockAll || i === 0) return true;
  const ws = wordsOf(LEVELS[i - 1].id);
  return !ws.length || ws.filter(w => box(w) >= 2).length / ws.length >= 0.7;
}
const unlockedWords = () => VOCAB.filter(w => levelUnlocked(lvlIdx(w.lv)));
const currentLevel = () => { let c = 0; LEVELS.forEach((_, i) => { if (levelUnlocked(i)) c = i; }); return LEVELS[c]; };
function grade(w, ok) {
  const s = S.srs[w.id] || { b: 0 };
  s.b = ok ? Math.min(6, s.b + 1) : Math.max(0, s.b - 2);
  s.due = Date.now() + BOX_DAYS[s.b] * DAY; S.srs[w.id] = s; tick();
}
function queue(n = 10) {
  const pool = unlockedWords(), now = Date.now();
  const due = pool.filter(w => S.srs[w.id] && S.srs[w.id].due <= now);
  const fresh = pool.filter(w => !S.srs[w.id]);
  return [...shuffle(due), ...fresh].slice(0, n);
}
function distractors(w, key, n = 3) {
  const seen = new Set([w[key]]);
  return shuffle(VOCAB).filter(x => !seen.has(x[key]) && seen.add(x[key])).slice(0, n);
}

/* ---------- vista base ---------- */
const view = html => { const m = $('#app'); m.innerHTML = html; m.focus({ preventScroll: true }); scrollTo(0, 0); };
function route() {
  const r = (location.hash || '#home').slice(1).split('/');
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + r[0]));
  $('#lvl').textContent = LEVELS.length ? currentLevel().id : '';
  (VIEWS[r[0]] || VIEWS.home)(r[1], r[2]);
}

/* ---------- inicio ---------- */
const VIEWS = {};
VIEWS.home = () => {
  const total = VOCAB.length, learned = VOCAB.filter(w => box(w) >= 3).length;
  const due = VOCAB.filter(w => S.srs[w.id] && S.srs[w.id].due <= Date.now()).length;
  const cl = currentLevel();
  view(`<h1>¡Hola! 👋</h1>
  <div class="card"><div class="row" style="justify-content:space-between"><b>${esc(cl.name)}</b><span class="pill">🔥 racha ${streak()} d</span></div>
   <p class="es">${esc(cl.es)}</p>
   <div class="bar"><i style="width:${Math.min(100, learned / 9000 * 100 * 10)}%"></i></div>
   <p class="mute">${learned} dominadas · ${total} cargadas · meta 9000 · ${due} para repasar hoy</p></div>
  <div class="card"><h3>Hoy</h3><div class="row">
   <button onclick="location.hash='#vocab/mixed'">Estudiar vocabulario</button>
   <button class="alt" onclick="location.hash='#talk'">Conversar</button>
   <button class="alt" onclick="location.hash='#exam'">Examen</button></div></div>
  ${total < 9000 ? `<div class="card mute">Tienes ${total} de 9000 palabras cargadas. Añade más con <code>tools/import_vocab.py</code> (ver README).</div>` : ''}`);
};

/* ---------- vocabulario ---------- */
VIEWS.vocab = (mode) => {
  if (!mode) {
    const rows = LEVELS.map((l, i) => {
      const ws = wordsOf(l.id), ok = ws.filter(w => box(w) >= 3).length, un = levelUnlocked(i);
      return `<div class="card ${un ? '' : 'locked'}"><b>${esc(l.name)} ${un ? '' : '🔒'}</b> <span class="mute">(${ok}/${ws.length})</span><div class="bar"><i style="width:${ws.length ? ok / ws.length * 100 : 0}%"></i></div></div>`;
    }).join('');
    return view(`<h2>Vocabulario</h2><div class="row">
      <button onclick="location.hash='#vocab/mixed'">Mixto</button>
      <button class="alt" onclick="location.hash='#vocab/flash'">Tarjetas</button>
      <button class="alt" onclick="location.hash='#vocab/spell'">Spelling</button>
      <button class="alt" onclick="location.hash='#vocab/listen'">Listening</button></div>${rows}`);
  }
  runDrill(queue(10), mode, 'vocab');
};

function runDrill(items, mode, back, onDone) {
  let i = 0, right = 0;
  const modes = ['flash', 'listen', 'spell'];
  const next = () => {
    if (i >= items.length) {
      const res = `<h2>Sesión completa</h2><div class="card"><p class="big">${right}/${items.length}</p></div><button onclick="location.hash='#${back}'">Volver</button>`;
      if (onDone) return onDone(right, items.length, res);
      return view(res);
    }
    const w = items[i], m = mode === 'mixed' ? modes[Math.min(2, Math.floor(box(w) / 2))] : mode;
    const head = `<p class="mute">${i + 1}/${items.length} · ${esc(w.lv)} · ${esc(w.pos)}</p>`;
    const done = ok => { grade(w, ok); if (ok) right++; i++; setTimeout(next, 900); };
    const fb = (ok, extra) => `<div class="card ${ok ? '' : ''}"><b>${ok ? '✅' : '❌'} ${esc(w.en)}</b> = ${esc(w.es)}<p class="es">${esc(w.ex)}</p>${extra || ''}</div>`;
    if (m === 'flash') {
      view(`${head}<div class="card"><p class="big">${esc(w.en)}</p><button class="alt" id="sp">🔊</button> <button id="rv">Ver traducción</button></div><div id="fb"></div>`);
      $('#sp').onclick = () => speak(w.en); speak(w.en);
      $('#rv').onclick = () => { $('#rv').remove(); $('#fb').innerHTML = `<div class="card"><b>${esc(w.es)}</b><p class="es">${esc(w.ex)}</p><div class="row"><button class="bad" id="n">No la sabía</button><button class="ok" id="y">La sabía</button></div></div>`; $('#n').onclick = () => { grade(w, false); i++; next(); }; $('#y').onclick = () => { grade(w, true); right++; i++; next(); }; };
    } else if (m === 'listen') {
      const opts = shuffle([w, ...distractors(w, 'es')]);
      view(`${head}<div class="card"><p>Escucha y elige el significado</p><button id="sp">🔊 Escuchar</button> <button class="alt" id="sl">🐢 Lento</button></div><div id="o">${opts.map((o, k) => `<button class="opt" data-k="${k}">${esc(o.es)}</button>`).join('')}</div><div id="fb"></div>`);
      $('#sp').onclick = () => speak(w.en); $('#sl').onclick = () => speak(w.en, 0.5); speak(w.en);
      document.querySelectorAll('.opt').forEach(b => b.onclick = () => { const ok = opts[b.dataset.k] === w; b.classList.add(ok ? 'ok' : 'bad'); document.querySelectorAll('.opt').forEach(x => x.disabled = true); $('#fb').innerHTML = fb(ok); done(ok); });
    } else {
      view(`${head}<div class="card"><p>Escribe lo que escuchas <span class="es">(${esc(w.es)})</span></p><button id="sp">🔊 Escuchar</button> <button class="alt" id="sl">🐢 Lento</button><p><input type="text" id="in" autocomplete="off" autocapitalize="off" spellcheck="false"></p><button id="ck">Comprobar</button></div><div id="fb"></div>`);
      $('#sp').onclick = () => speak(w.en); $('#sl').onclick = () => speak(w.en, 0.5); speak(w.en);
      const check = () => { const ok = $('#in').value.trim().toLowerCase() === w.en.toLowerCase(); $('#ck').disabled = true; $('#fb').innerHTML = fb(ok, ok ? '' : `<p>Escribiste: <b>${esc($('#in').value)}</b></p>`); done(ok); };
      $('#ck').onclick = check; $('#in').onkeydown = e => { if (e.key === 'Enter' && !$('#ck').disabled) check(); }; $('#in').focus();
    }
  };
  if (!items.length) return view('<div class="card">No hay palabras disponibles. Carga vocabulario o desbloquea niveles.</div>');
  next();
}

/* ---------- gramática ---------- */
VIEWS.grammar = (id) => {
  const g = GRAM.find(x => x.id === id);
  if (!g) {
    return view(`<h2>Gramática</h2>${GRAM.map(x => `<div class="card ${levelUnlocked(lvlIdx(x.level)) ? '' : 'locked'}"><b>${esc(x.title)}</b> <span class="pill">${esc(x.level)}</span> ${S.gram[x.id] != null ? '✅ ' + S.gram[x.id] + '%' : ''}<div><button onclick="location.hash='#grammar/${x.id}'">Abrir</button></div></div>`).join('')}`);
  }
  let i = 0, ok = 0;
  const ex = g.exercises;
  const show = () => {
    if (i >= ex.length) { const p = Math.round(ok / ex.length * 100); S.gram[g.id] = Math.max(S.gram[g.id] || 0, p); tick(2); save(); return view(`<h2>${p}%</h2><button onclick="location.hash='#grammar'">Volver</button>`); }
    const q = ex[i];
    view(`<h3>${esc(g.title)}</h3><p class="mute">Pregunta ${i + 1}/${ex.length}</p><div class="card"><p class="big" style="font-size:20px">${esc(q.q)}</p>${q.o.map((o, k) => `<button class="opt" data-k="${k}">${esc(o)}</button>`).join('')}</div>`);
    document.querySelectorAll('.opt').forEach(b => b.onclick = () => { const c = +b.dataset.k === q.a; b.classList.add(c ? 'ok' : 'bad'); if (c) ok++; document.querySelectorAll('.opt').forEach(x => x.disabled = true); i++; setTimeout(show, 800); });
  };
  view(`<h2>${esc(g.title)}</h2><div class="card"><p>${esc(g.es)}</p>${g.examples.map(([e, s]) => `<p><b>${esc(e)}</b> <button class="alt" data-s="${esc(e)}">🔊</button><br><span class="es">${esc(s)}</span></p>`).join('')}</div><button id="go">Practicar (${ex.length})</button>`);
  document.querySelectorAll('[data-s]').forEach(b => b.onclick = () => speak(b.dataset.s));
  $('#go').onclick = show;
};

/* ---------- conversación ---------- */
VIEWS.talk = (id) => {
  const c = CONVO.find(x => x.id === id);
  if (!c) {
    const dev = CONVO.filter(x => x.track === 'dev'), daily = CONVO.filter(x => x.track === 'daily');
    const item = x => { const lock = x.track === 'dev' && x.level > S.devLevel; const sc = S.convo[x.id]; return `<div class="card ${lock ? 'locked' : ''}"><b>${esc(x.title)}</b> <span class="pill">nivel ${x.level}</span> ${sc != null ? '✅ ' + sc + '%' : ''} ${lock ? '🔒' : `<div><button onclick="location.hash='#talk/${x.id}'">Empezar</button></div>`}</div>`; };
    return view(`<h2>Conversación</h2><h3>💻 Desarrollo de software <span class="pill">tu nivel: ${S.devLevel}</span></h3><p class="es">La dificultad sube conforme completas cada nivel con ≥80%.</p>${dev.map(item).join('')}<h3>☕ Vida diaria</h3>${daily.map(item).join('')}`);
  }
  let i = 0, right = 0, total = c.turns.filter(t => t.y).length;
  const log = [];
  const step = () => {
    while (i < c.turns.length && c.turns[i].t) { log.push(`<div class="bubble tutor">${esc(c.turns[i].t)}<div class="es">${esc(c.turns[i].es)}</div></div>`); i++; }
    const last = log.length ? c.turns[i - 1] : null;
    if (i >= c.turns.length) return finish();
    const t = c.turns[i], opts = shuffle(t.y);
    view(`<h3>${esc(c.title)}</h3>${log.join('')}<div class="row"><button class="alt" id="sp">🔊 Escuchar</button></div><p class="mute">Elige (o di en voz alta) la mejor respuesta:</p>${opts.map((o, k) => `<div class="row"><button class="opt" style="flex:1" data-k="${k}">${esc(o[0])}</button><button class="alt" data-m="${k}" title="Decir en voz alta">🎙️</button></div>`).join('')}<div id="fb"></div>`);
    $('#sp').onclick = () => speak(last ? last.t : '');
    if (last) speak(last.t);
    const answer = (o, viaVoice) => { const ok = !!o[1]; if (ok) right++; log.push(`<div class="bubble you">${esc(o[0])}<div class="es" style="color:#04202e99">${esc(o[2])}</div></div>`); tick(2); i++; if (!ok) { const best = t.y.find(y => y[1]); $('#fb').innerHTML = `<div class="card">❌ Mejor: <b>${esc(best[0])}</b></div>`; setTimeout(step, 1800); } else step(); };
    document.querySelectorAll('.opt').forEach(b => b.onclick = () => answer(opts[b.dataset.k]));
    document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const o = opts[b.dataset.m]; listen(txt => { if (!txt) return; const s = similarity(txt, o[0]); $('#fb').innerHTML = `<div class="card">Dijiste: <i>${esc(txt)}</i> · precisión ${Math.round(s * 100)}%</div>`; if (s >= 0.7) setTimeout(() => answer(o, true), 900); }); });
  };
  const finish = () => {
    const p = Math.round(right / total * 100); S.convo[c.id] = Math.max(S.convo[c.id] || 0, p);
    if (c.track === 'dev' && c.level === S.devLevel) {
      const all = CONVO.filter(x => x.track === 'dev' && x.level === S.devLevel);
      if (all.every(x => (S.convo[x.id] || 0) >= 80) && CONVO.some(x => x.track === 'dev' && x.level > S.devLevel)) S.devLevel++;
    }
    save();
    view(`<h2>${p}%</h2>${log.join('')}<button onclick="location.hash='#talk'">Volver</button>`);
  };
  step();
};

/* ---------- examen ---------- */
VIEWS.exam = (m) => {
  if (m !== 'go') {
    const h = S.exams.slice(-5).reverse().map(e => `<p>${esc(e.d)} · <b>${e.p}%</b> · ${esc(e.lv)}</p>`).join('') || '<p class="mute">Sin intentos.</p>';
    return view(`<h2>Examen</h2><div class="card"><p>20 preguntas mixtas: significado, listening, spelling y gramática, sobre tu nivel actual.</p><button onclick="location.hash='#exam/go'">Comenzar</button></div><div class="card"><h3>Historial</h3>${h}</div>`);
  }
  const words = shuffle(unlockedWords()).slice(0, 14), g = shuffle(GRAM.filter(x => levelUnlocked(lvlIdx(x.level))).flatMap(x => x.exercises)).slice(0, 6);
  const qs = [...words.map((w, k) => ({ w, t: k % 3 === 0 ? 'listen' : k % 3 === 1 ? 'meaning' : 'spell' })), ...g.map(q => ({ q, t: 'gram' }))];
  let i = 0, ok = 0;
  const next = () => {
    if (i >= qs.length) { const p = Math.round(ok / qs.length * 100); S.exams.push({ d: today(), p, lv: currentLevel().id }); tick(3); save(); return view(`<h2>${p}%</h2><div class="card">${p >= 80 ? 'Excelente. ¡Sube de nivel!' : p >= 60 ? 'Bien, sigue repasando.' : 'Repasa vocabulario y gramática.'}</div><button onclick="location.hash='#exam'">Volver</button>`); }
    const x = qs[i], hd = `<p class="mute">${i + 1}/${qs.length}</p>`, adv = c => { if (c) ok++; i++; setTimeout(next, 700); };
    if (x.t === 'gram') { view(`${hd}<div class="card"><p>${esc(x.q.q)}</p>${x.q.o.map((o, k) => `<button class="opt" data-k="${k}">${esc(o)}</button>`).join('')}</div>`); document.querySelectorAll('.opt').forEach(b => b.onclick = () => { const c = +b.dataset.k === x.q.a; b.classList.add(c ? 'ok' : 'bad'); adv(c); }); }
    else if (x.t === 'spell') { view(`${hd}<div class="card"><p>Escribe: <b>${esc(x.w.es)}</b> <button class="alt" id="sp">🔊</button></p><input type="text" id="in" autocomplete="off" autocapitalize="off"><p><button id="ck">OK</button></p></div>`); $('#sp').onclick = () => speak(x.w.en); $('#ck').onclick = () => { const c = $('#in').value.trim().toLowerCase() === x.w.en.toLowerCase(); $('#ck').disabled = true; $('#ck').classList.add(c ? 'ok' : 'bad'); adv(c); }; }
    else { const opts = shuffle([x.w, ...distractors(x.w, 'es')]); view(`${hd}<div class="card"><p>${x.t === 'listen' ? '<button id="sp">🔊 Escuchar</button>' : `<span class="big">${esc(x.w.en)}</span>`}</p>${opts.map((o, k) => `<button class="opt" data-k="${k}">${esc(o.es)}</button>`).join('')}</div>`); if (x.t === 'listen') { $('#sp').onclick = () => speak(x.w.en); speak(x.w.en); } document.querySelectorAll('.opt').forEach(b => b.onclick = () => { const c = opts[b.dataset.k] === x.w; b.classList.add(c ? 'ok' : 'bad'); adv(c); }); }
  };
  next();
};

/* ---------- audios largos / podcasts ---------- */
VIEWS.pods = (id) => {
  const p = S.pods.find(x => x.id === id);
  if (p) {
    view(`<h2>${esc(p.title)}</h2><div class="card"><audio id="au" controls preload="metadata" src="${esc(p.url)}"></audio>
      <div class="row"><button class="alt" id="b">⏪ 15s</button><button class="alt" id="f">15s ⏩</button>
      <select id="sp" style="width:auto"><option>0.75</option><option selected>1</option><option>1.25</option><option>1.5</option></select></div></div>
      <div class="card"><b>Notas / transcripción</b><textarea id="nt" rows="6" style="width:100%;background:transparent;color:inherit;border:1px solid var(--mute);border-radius:10px;padding:8px">${esc(p.notes || '')}</textarea></div>
      <button class="alt" onclick="location.hash='#pods'">Volver</button>`);
    const a = $('#au'); a.currentTime = p.pos || 0;
    let last = 0; a.ontimeupdate = () => { if (Date.now() - last > 4000) { p.pos = a.currentTime; last = Date.now(); save(); } };
    a.onplay = () => tick();
    $('#b').onclick = () => a.currentTime -= 15; $('#f').onclick = () => a.currentTime += 15; $('#sp').onchange = e => a.playbackRate = +e.target.value;
    $('#nt').onchange = e => { p.notes = e.target.value; save(); };
    return;
  }
  view(`<h2>Audios largos</h2>
   <div class="card"><h3>Añadir</h3><p class="es">Pega un enlace directo a un .mp3 o el RSS de un podcast (si el sitio bloquea CORS, usa el enlace del episodio).</p>
   <input type="url" id="u" placeholder="https://…/episode.mp3 o feed.xml"><p><input type="text" id="t" placeholder="Título (opcional)"></p><button id="add">Añadir</button> <span id="st" class="mute"></span></div>
   ${S.pods.map(x => `<div class="card"><b>${esc(x.title)}</b> <span class="mute">${Math.round((x.pos || 0) / 60)} min</span><div class="row"><button onclick="location.hash='#pods/${x.id}'">Reproducir</button><button class="alt" data-del="${x.id}">Quitar</button></div></div>`).join('') || '<p class="mute">Aún no hay audios.</p>'}`);
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { S.pods = S.pods.filter(x => x.id !== b.dataset.del); save(); route(); });
  $('#add').onclick = async () => {
    const url = $('#u').value.trim(); if (!/^https?:\/\//.test(url)) return $('#st').textContent = 'URL no válida';
    let items = [{ title: $('#t').value.trim() || url.split('/').pop() || 'Audio', url }];
    if (!/\.(mp3|m4a|ogg|wav|aac)(\?|$)/i.test(url)) {
      $('#st').textContent = 'Leyendo feed…';
      try {
        const x = new DOMParser().parseFromString(await (await fetch(url)).text(), 'text/xml');
        items = [...x.querySelectorAll('item')].slice(0, 20).map(it => ({ title: it.querySelector('title')?.textContent || 'Episodio', url: it.querySelector('enclosure')?.getAttribute('url') })).filter(i => i.url);
        if (!items.length) throw 0;
      } catch { return $('#st').textContent = 'No se pudo leer el feed (CORS). Pega el enlace directo del .mp3.'; }
    }
    items.forEach(i => S.pods.push({ id: Math.random().toString(36).slice(2, 9), title: i.title, url: i.url, pos: 0 }));
    save(); route();
  };
};

/* ---------- ajustes / privacidad ---------- */
VIEWS.settings = () => {
  view(`<h2>Ajustes</h2>
  <div class="card"><b>Velocidad de voz</b><input type="range" id="r" min="0.5" max="1.2" step="0.1" value="${S.rate}" style="width:100%"></div>
  <div class="card"><label><input type="checkbox" id="ua" ${S.unlockAll ? 'checked' : ''}> Desbloquear todos los niveles</label></div>
  <div class="card"><b>PIN de acceso</b> <span class="mute">${S.pin ? '(activo)' : '(sin PIN)'}</span><p><input type="password" id="pin" inputmode="numeric" placeholder="Nuevo PIN (vacío = quitar)"></p><button id="sp">Guardar PIN</button></div>
  <div class="card"><b>Copia de seguridad</b><div class="row"><button id="ex">Exportar</button><button class="alt" id="im">Importar</button></div><input type="file" id="fi" accept=".json" hidden></div>`);
  $('#r').onchange = e => { S.rate = +e.target.value; save(); speak('This is my speed.'); };
  $('#ua').onchange = e => { S.unlockAll = e.target.checked; save(); };
  $('#sp').onclick = async () => { const v = $('#pin').value; S.pin = v ? await hash(v) : null; save(); route(); };
  $('#ex').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: 'application/json' })); a.download = 'mi-ingles-backup.json'; a.click(); };
  $('#im').onclick = () => $('#fi').click();
  $('#fi').onchange = async e => { try { S = { ...defaults(), ...JSON.parse(await e.target.files[0].text()) }; save(); route(); } catch { alert('Archivo inválido'); } };
};

/* ---------- bloqueo por PIN ---------- */
async function hash(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ie:' + s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
function gate() {
  const el = $('#lock');
  if (!S.pin || sessionStorage.getItem('ie.ok')) { el.hidden = true; return init(); }
  el.hidden = false; el.className = 'lock';
  el.innerHTML = '<div><h2>🔒 Mi Inglés</h2><input type="password" id="lp" inputmode="numeric" placeholder="PIN" autofocus><p><button id="lg">Entrar</button></p><p id="le" class="mute"></p></div>';
  const go = async () => { if (await hash($('#lp').value) === S.pin) { sessionStorage.setItem('ie.ok', '1'); el.hidden = true; init(); } else $('#le').textContent = 'PIN incorrecto'; };
  $('#lg').onclick = go; $('#lp').onkeydown = e => e.key === 'Enter' && go();
}
gate();
