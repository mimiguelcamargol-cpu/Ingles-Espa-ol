'use strict';
/* Mi Inglés — PWA privada, 100% local: sin servidores ni llamadas a IA (0 tokens en uso). */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rnd = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const ic = (n, c = '') => `<svg class="ico ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const APP_VERSION = '1.3.0';
const DAY = 864e5;
const BOX_DAYS = [0, 1, 2, 4, 8, 16, 32];

/* ---------- estado ---------- */
const KEY = 'ie.state.v1';
const defaults = () => ({ pin: null, rate: 0.9, unlockAll: false, srs: {}, gram: {}, convo: {}, devLevel: 1, exams: [], pods: [], reads: [], stats: { days: {} }, settingsAt: 0 });
let S;
try { S = { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { S = defaults(); }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { } };
const save = () => { persist(); scheduleSync(); };
const today = () => new Date().toISOString().slice(0, 10);
const tick = (n = 1) => { S.stats.days[today()] = (S.stats.days[today()] || 0) + n; save(); };
const streak = () => { let n = 0, d = new Date(); while (S.stats.days[d.toISOString().slice(0, 10)]) { n++; d = new Date(d - DAY); } return n; };

/* ---------- datos ---------- */
let VOCAB = [], GRAM = [], CONVO = [], LEVELS = [], TALKS = [];
const load = f => fetch('data/' + f + '.json').then(r => r.json());
async function init() {
  [VOCAB, GRAM, CONVO, LEVELS] = await Promise.all([load('vocab'), load('grammar'), load('convo'), load('levels')]);
  TALKS = await fetch('data/talks/index.json').then(r => r.json()).catch(() => []);
  VOCAB = VOCAB.map(([en, es, pos, lv, ex]) => ({ id: en + '|' + pos, en, es, pos, lv, ex }));
  addEventListener('hashchange', route);
  addEventListener('online', () => sync());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) location.hash = g.dataset.go; });
  route();
  sync().then(() => { if (/^#?(home|vocab|grammar|talk|exam|pods|settings)?$/.test(location.hash.slice(0) || '#home')) route(); });
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
  u.onstart = () => document.body.classList.add('speaking');
  u.onend = u.onerror = () => document.body.classList.remove('speaking');
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
  return ws.length ? ws.filter(w => box(w) >= 2).length / ws.length >= 0.7 : levelUnlocked(i - 1);
}
const unlockedWords = () => VOCAB.filter(w => levelUnlocked(lvlIdx(w.lv)));
const currentLevel = () => { let c = 0; LEVELS.forEach((l, i) => { if (levelUnlocked(i) && wordsOf(l.id).length) c = i; }); return LEVELS[c]; };
function grade(w, ok) {
  const s = S.srs[w.id] || { b: 0 };
  s.b = ok ? Math.min(6, s.b + 1) : Math.max(0, s.b - 2);
  s.due = Date.now() + BOX_DAYS[s.b] * DAY; s.t = Date.now(); S.srs[w.id] = s; tick();
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

/* ---------- sincronización (offline-first) ---------- */
let syncStatus = 'none', serverUp = false, syncTimer = null, syncing = false;
const setSync = st => { syncStatus = st; const d = $('#sy'); if (d) { const t = { ok: 'Sincronizado', off: 'Sin conexión: se guarda en este dispositivo', auth: 'Inicia sesión para sincronizar', none: 'Solo local', busy: 'Sincronizando' }[st]; d.className = 'sync s-' + st; d.title = t; d.setAttribute('aria-label', t); } };
function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(), 3000); }
async function sync(manual) {
  if (syncing) return; syncing = true; setSync('busy');
  try {
    const { pin, ...body } = S;
    const r = await fetch('/api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ state: body }), redirect: 'error' });
    if (r.status === 401) { serverUp = true; setSync('auth'); if (manual) location.href = '/login.html'; return; }
    if (!r.ok) throw 0;
    const j = await r.json(); serverUp = true;
    S = { ...defaults(), ...IEMerge.merge(S, j.state), pin: S.pin }; persist(); setSync('ok');
  } catch { serverUp = false; setSync(navigator.onLine ? 'none' : 'off'); }
  finally { syncing = false; }
}

/* ---------- vista base ---------- */
const view = html => { const m = $('#app'); m.innerHTML = html; m.focus({ preventScroll: true }); scrollTo(0, 0); };
function route() {
  const r = (location.hash || '#home').slice(1).split('/');
  const tab = ['grammar', 'exam', 'settings', 'more'].includes(r[0]) ? 'more' : r[0] === 'pods' ? 'read' : r[0];
  document.querySelectorAll('#nav a').forEach(a => { const on = a.getAttribute('href') === '#' + tab; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('#lvl').textContent = LEVELS.length ? currentLevel().id : '';
  (VIEWS[r[0]] || VIEWS.home)(r[1], r[2]);
}

/* ---------- inicio ---------- */
const VIEWS = {};
const EQ = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>';
VIEWS.home = () => {
  const learned = VOCAB.filter(w => box(w) >= 3).length;
  const due = VOCAB.filter(w => S.srs[w.id] && S.srs[w.id].due <= Date.now()).length;
  const cl = currentLevel(), hr = new Date().getHours();
  const hi = hr < 6 ? 'Buenas noches' : hr < 13 ? 'Buenos días' : hr < 20 ? 'Buenas tardes' : 'Buenas noches';
  const nextTalk = TALKS.find(t => !talkLock(t) && (S.convo[t.id] || 0) < 80);
  const plan = due ? { h: `Repasa ${due} palabra${due > 1 ? 's' : ''}`, p: 'Lo que repasas hoy es lo que recuerdas mañana.', go: '#vocab/mixed', b: 'Repasar ahora' }
    : nextTalk ? { h: nextTalk.title, p: `Conversación de ${nextTalk.minutes} minutos en nivel ${nextTalk.level}. Escucha primero y responde con tu voz.`, go: '#talk/' + nextTalk.id, b: 'Empezar conversación' }
    : { h: 'Aprende palabras nuevas', p: 'Diez palabras con audio, dictado y repaso espaciado.', go: '#vocab/mixed', b: 'Estudiar ahora' };
  const days = [...Array(7)].map((_, k) => { const d = new Date(Date.now() - (6 - k) * DAY); return { l: 'DLMXJVS'[d.getDay()], on: !!S.stats.days[d.toISOString().slice(0, 10)] }; });
  const rungs = LEVELS.map(l => { const ws = wordsOf(l.id), m = ws.length ? ws.filter(w => box(w) >= 3).length / ws.length : 0; return `<div class="rung ${l.id === cl.id ? 'now' : m >= 0.7 ? 'done' : ''}"><i style="height:${Math.max(10, Math.round(m * 100))}%"></i>${esc(l.id)}</div>`; }).join('');
  const talksDone = TALKS.filter(t => (S.convo[t.id] || 0) >= 60).length;
  view(`<h1>${hi}.</h1><p class="mute">${esc(cl.es)}</p>
  <section class="panel">${EQ.replace('class="eq"', 'class="eq on"')}<h2>${esc(plan.h)}</h2><p>${esc(plan.p)}</p><button data-go="${plan.go}">${ic('play')} ${esc(plan.b)}</button></section>
  <div class="split"><h3>Tu semana</h3><span class="chip">${ic('flame')} racha de ${streak()} día${streak() === 1 ? '' : 's'}</span></div>
  <div class="week" role="img" aria-label="Días estudiados en la última semana">${days.map(d => `<span class="${d.on ? 'on' : ''}">${d.l}</span>`).join('')}</div>
  <h3>Tus niveles</h3><div class="ladder" role="img" aria-label="Dominio por nivel">${rungs}</div>
  <div class="list"><a class="item" href="#vocab"><div class="grow"><b>Vocabulario</b><div class="bar" style="margin-top:8px"><i style="width:${Math.min(100, learned / 90)}%"></i></div></div><span class="stat" style="font-size:1.5rem">${learned}<span class="mute" style="font-size:1rem"> / 9000</span></span></a>
   <a class="item" href="#talk"><div class="grow"><b>Conversaciones</b><div class="es">${TALKS.length} disponibles</div></div><span class="stat" style="font-size:1.5rem">${talksDone}<span class="mute" style="font-size:1rem"> / ${TALKS.length}</span></span></a></div>`);
};

VIEWS.more = () => view(`<h2>Más</h2><div class="list">
  <a class="item" href="#grammar">${ic('text')}<div class="grow"><b>Gramática</b><div class="es">Lecciones con ejercicios</div></div>${ic('chevron')}</a>
  <a class="item" href="#exam">${ic('exam')}<div class="grow"><b>Examen</b><div class="es">20 preguntas sobre tu nivel</div></div>${ic('chevron')}</a>
  <a class="item" href="#settings">${ic('sliders')}<div class="grow"><b>Ajustes</b><div class="es">Voz, acceso, sincronización y copia</div></div>${ic('chevron')}</a></div>`);

/* ---------- vocabulario ---------- */
VIEWS.vocab = (mode) => {
  if (!mode) {
    const rows = LEVELS.map((l, i) => {
      const ws = wordsOf(l.id), ok = ws.filter(w => box(w) >= 3).length, un = levelUnlocked(i);
      if (!ws.length) return `<div class="item locked"><div class="grow"><b>${esc(l.name)}</b><div class="es">Vocabulario próximamente</div></div></div>`;
      return `<div class="item ${un ? '' : 'locked'}"><div class="grow"><b>${esc(l.name)}</b><div class="bar" style="margin-top:8px"><i style="width:${ok / ws.length * 100}%"></i></div></div><span class="mute">${un ? `${ok} / ${ws.length}` : ic('lock') + '<span class="sr">Bloqueado</span>'}</span></div>`;
    }).join('');
    const total = VOCAB.length, learned = VOCAB.filter(w => box(w) >= 3).length;
    return view(`<h2>Vocabulario</h2><p class="es">${learned} dominadas de ${total} cargadas. Meta: 9000.</p><div class="row">
      <button data-go="#vocab/mixed">${ic('play')} Sesión mixta</button>
      <button class="alt" data-go="#vocab/flash">${ic('layers')} Tarjetas</button>
      <button class="alt" data-go="#vocab/spell">${ic('keyboard')} Spelling</button>
      <button class="alt" data-go="#vocab/listen">${ic('headphones')} Listening</button></div><h3>Por nivel</h3><div class="list">${rows}</div>`);
  }
  runDrill(queue(10), mode, 'vocab');
};

function runDrill(items, mode, back, onDone) {
  let i = 0, right = 0;
  const modes = ['flash', 'listen', 'spell'];
  const next = () => {
    if (i >= items.length) {
      const res = `<h2>Sesión completa</h2><div class="card"><p class="big">${right}/${items.length}</p></div><button data-go="#${back}">Volver</button>`;
      if (onDone) return onDone(right, items.length, res);
      return view(res);
    }
    const w = items[i], m = mode === 'mixed' ? modes[Math.min(2, Math.floor(box(w) / 2))] : mode;
    const head = `<p class="mute">${i + 1}/${items.length} · ${esc(w.lv)} · ${esc(w.pos)}</p>`;
    const done = ok => { grade(w, ok); if (ok) right++; i++; setTimeout(next, 900); };
    const fb = (ok, extra) => `<div class="card ${ok ? 'ok' : 'no'}"><h3>${ok ? ic('ok', 'v-ok') : ic('no', 'v-no')} ${esc(w.en)}</h3><b class="sr">${ok ? 'Correcto' : 'Incorrecto'}</b> = ${esc(w.es)}<p class="es">${esc(w.ex)}</p>${extra || ''}</div>`;
    if (m === 'flash') {
      view(`${head}<div class="card"><p class="big">${esc(w.en)}</p><button class="alt" id="sp" aria-label="Escuchar">${ic('volume')}</button> <button id="rv">Ver traducción</button></div><div id="fb"></div>`);
      $('#sp').onclick = () => speak(w.en); speak(w.en);
      $('#rv').onclick = () => { $('#rv').remove(); $('#fb').innerHTML = `<div class="card"><b>${esc(w.es)}</b><p class="es">${esc(w.ex)}</p><div class="row"><button class="bad" id="n">No la sabía</button><button class="ok" id="y">La sabía</button></div></div>`; $('#n').onclick = () => { grade(w, false); i++; next(); }; $('#y').onclick = () => { grade(w, true); right++; i++; next(); }; };
    } else if (m === 'listen') {
      const opts = shuffle([w, ...distractors(w, 'es')]);
      view(`${head}<div class="card"><p>Escucha y elige el significado</p><button id="sp">${ic('volume')} Escuchar</button> <button class="alt" id="sl">${ic('gauge')} Lento</button></div><div id="o">${opts.map((o, k) => `<button class="opt" data-k="${k}">${esc(o.es)}</button>`).join('')}</div><div id="fb"></div>`);
      $('#sp').onclick = () => speak(w.en); $('#sl').onclick = () => speak(w.en, 0.5); speak(w.en);
      document.querySelectorAll('.opt').forEach(b => b.onclick = () => { const ok = opts[b.dataset.k] === w; b.classList.add(ok ? 'ok' : 'bad'); document.querySelectorAll('.opt').forEach(x => x.disabled = true); $('#fb').innerHTML = fb(ok); done(ok); });
    } else {
      view(`${head}<div class="card"><p>Escribe lo que escuchas <span class="es">(${esc(w.es)})</span></p><button id="sp">${ic('volume')} Escuchar</button> <button class="alt" id="sl">${ic('gauge')} Lento</button><p><input type="text" id="in" autocomplete="off" autocapitalize="off" spellcheck="false"></p><button id="ck">Comprobar</button></div><div id="fb"></div>`);
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
    return view(`<h2>Gramática</h2><p class="es">Explicación breve en español y ejercicios para practicar.</p><div class="list">${GRAM.map(x => { const lk = !levelUnlocked(lvlIdx(x.level)) && !S.unlockAll; const body = `${ic('text')}<div class="grow"><b>${esc(x.title)}</b><div class="es">${esc(x.level)}</div></div>${S.gram[x.id] != null ? `<span class="pill done">${S.gram[x.id]}%</span>` : ''}${lk ? ic('lock') : ic('chevron')}`; return lk ? `<div class="item locked">${body}</div>` : `<a class="item" href="#grammar/${x.id}">${body}</a>`; }).join('')}</div>`);
  }
  let i = 0, ok = 0;
  const ex = g.exercises;
  const show = () => {
    if (i >= ex.length) { const p = Math.round(ok / ex.length * 100); S.gram[g.id] = Math.max(S.gram[g.id] || 0, p); tick(2); save(); return view(`<h2>${p}%</h2><button data-go="#grammar">Volver</button>`); }
    const q = ex[i];
    view(`<h3>${esc(g.title)}</h3><p class="mute">Pregunta ${i + 1}/${ex.length}</p><div class="card"><p class="big" style="font-size:20px">${esc(q.q)}</p>${q.o.map((o, k) => `<button class="opt" data-k="${k}">${esc(o)}</button>`).join('')}</div>`);
    document.querySelectorAll('.opt').forEach(b => b.onclick = () => { const c = +b.dataset.k === q.a; b.classList.add(c ? 'ok' : 'bad'); if (c) ok++; document.querySelectorAll('.opt').forEach(x => x.disabled = true); i++; setTimeout(show, 800); });
  };
  view(`<h2>${esc(g.title)}</h2><div class="card"><p>${esc(g.es)}</p>${g.examples.map(([e, s]) => `<p><b>${esc(e)}</b> <button class="alt" data-s="${esc(e)}" aria-label="Escuchar">${ic('volume')}</button><br><span class="es">${esc(s)}</span></p>`).join('')}</div><button id="go">Practicar (${ex.length})</button>`);
  document.querySelectorAll('[data-s]').forEach(b => b.onclick = () => speak(b.dataset.s));
  $('#go').onclick = show;
};

/* ---------- conversación (escucha activa) ---------- */
const PREF_KEY = 'ie.pref.v1';
let PREF = { showText: false, showEs: false, slow: false };
try { PREF = { ...PREF, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { }
const setPref = (k, v) => { PREF[k] = v; try { localStorage.setItem(PREF_KEY, JSON.stringify(PREF)); } catch { } };
const ICON = { ok: ic('ok', 'v-ok'), close: ic('close', 'v-close'), no: ic('no', 'v-no') };

function advanceDev() {
  const items = [...CONVO.filter(x => x.track === 'dev').map(x => ({ id: x.id, lv: x.level })), ...TALKS.filter(x => x.track === 'dev').map(x => ({ id: x.id, lv: x.dev || 1 }))];
  const cur = items.filter(x => x.lv === S.devLevel);
  if (cur.length && cur.every(x => (S.convo[x.id] || 0) >= 80) && items.some(x => x.lv > S.devLevel)) S.devLevel++;
}
function talkLock(t) {
  if (S.unlockAll) return '';
  if (t.track === 'dev' && (t.dev || 1) > S.devLevel) return `Completa el nivel ${S.devLevel} de software con ≥80 %`;
  const i = lvlIdx(t.level); if (i <= 0) return '';
  const prev = TALKS.filter(x => lvlIdx(x.level) === i - 1 && x.track === t.track);
  const need = Math.ceil(prev.length / 2), done = prev.filter(x => (S.convo[x.id] || 0) >= 60).length;
  return done >= need ? '' : `Completa ${need} conversaciones de ${LEVELS[i - 1].id} con 60 % o más (llevas ${done})`;
}
function recognize(h) {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) return null;
  const r = new R(); r.lang = 'en-US'; r.interimResults = true; r.maxAlternatives = 3; r.continuous = false;
  let alts = [], failed = false;
  r.onresult = e => { const res = e.results[e.results.length - 1]; h.interim(res[0].transcript); if (res.isFinal) alts = Array.from(res).map(a => a.transcript); };
  r.onerror = e => { failed = true; document.body.classList.remove('listening'); h.error(e.error); };
  r.onend = () => { document.body.classList.remove('listening'); if (!failed) h.done(alts); };
  try { r.start(); document.body.classList.add('listening'); } catch { return null; }
  return r;
}
const micMsg = e => e === 'not-allowed' || e === 'service-not-allowed' ? 'Permite el micrófono en el navegador (icono del candado) y vuelve a intentar.' : e === 'no-speech' ? 'No te escuché. Acércate al micrófono e inténtalo otra vez.' : e === 'network' ? 'El reconocimiento de voz necesita internet en este navegador. Usa "Escribir".' : 'No pude usar el micrófono (' + e + '). Usa "Escribir".';

VIEWS.talk = async (id) => {
  const quick = CONVO.find(x => x.id === id);
  if (quick) return playQuick(quick);
  if (id) {
    if (!/^[\w-]+$/.test(id)) return VIEWS.talk();
    let t; try { t = await (await fetch('data/talks/' + id + '.json')).json(); } catch { return view('<div class="card">No pude cargar esta conversación (¿sin conexión y sin verla antes?).</div><button data-go="#talk">Volver</button>'); }
    return talkIntro(t);
  }
  return talkHub();
};

let TF = 'all';
function talkHub() {
  const topics = [...new Set(TALKS.map(t => t.topic))];
  const shown = TALKS.filter(t => TF === 'all' || t.topic === TF);
  const by = LEVELS.map(l => ({ l, ts: shown.filter(t => t.level === l.id) })).filter(g => g.ts.length);
  const row = t => {
    const lock = talkLock(t), sc = S.convo[t.id];
    const body = `${ic(t.track === 'dev' ? 'code' : 'chat')}<div class="grow"><b>${esc(t.title)}</b><div class="es">${esc(t.es)}</div><div class="mute" style="font-size:13px">${esc(t.topic)}, ${t.turns} respuestas, unos ${t.minutes} min</div>${lock ? `<div class="mute" style="font-size:13px">${ic('lock')} ${esc(lock)}</div>` : ''}</div>${sc != null ? `<span class="pill ${sc >= 80 ? 'done' : ''}">${sc}%</span>` : ''}${lock ? '' : ic('chevron')}`;
    return lock ? `<div class="item locked">${body}</div>` : `<a class="item" href="#talk/${t.id}">${body}</a>`;
  };
  const quickRow = x => { const lock = x.track === 'dev' && x.level > S.devLevel; const sc = S.convo[x.id]; const body = `${ic('play')}<div class="grow"><b>${esc(x.title)}</b><div class="es">Nivel ${x.level}, opción múltiple</div></div>${sc != null ? `<span class="pill">${sc}%</span>` : ''}`; return lock ? `<div class="item locked">${body}</div>` : `<a class="item" href="#talk/${x.id}">${body}</a>`; };
  view(`<h2>Hablar</h2><p class="es">Escucha primero, responde con el micrófono y recibe corrección al instante. Tu nivel de software: <b>${S.devLevel}</b>.</p>
  <div class="chips" role="group" aria-label="Filtrar por tema"><button class="chip ${TF === 'all' ? 'on' : ''}" data-f="all">Todas</button>${topics.map(tp => `<button class="chip ${TF === tp ? 'on' : ''}" data-f="${esc(tp)}">${esc(tp)}</button>`).join('')}</div>
  ${by.map(g => `<h3>${esc(g.l.name)}</h3><p class="es" style="margin-top:-4px">${g.l.can ? 'Al terminar podrás: ' + esc(g.l.can.join('; ').toLowerCase()) + '.' : esc(g.l.es)}</p><div class="list">${g.ts.map(row).join('')}</div>`).join('') || '<p class="mute">No hay conversaciones para este tema.</p>'}
  <h3>Práctica rápida</h3><div class="list">${CONVO.map(quickRow).join('')}</div>`);
  document.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { TF = b.dataset.f; talkHub(); });
}

function talkIntro(t) {
  view(`<h2>${esc(t.title)}</h2><p class="es">${esc(t.es)}</p>
  <div class="card"><h3>${ic('target')} Objetivo</h3><p>${esc(t.goal)}</p><span class="pill">${esc(t.level)}</span> <span class="pill">~${t.minutes} min</span></div>
  <div class="card"><h3>${ic('chat')} Frases útiles</h3>${t.phrases.map(([e, s]) => `<p><button class="alt" data-s="${esc(e)}" aria-label="Escuchar">${ic('volume')}</button> <b>${esc(e)}</b><br><span class="es">${esc(s)}</span></p>`).join('')}</div>
  <div class="card"><h3>${ic('sliders')} Cómo practicar</h3>
   <p><label><input type="checkbox" id="p1" ${PREF.showText ? 'checked' : ''}> Mostrar el texto de lo que escucho</label></p>
   <p><label><input type="checkbox" id="p2" ${PREF.showEs ? 'checked' : ''}> Mostrar traducción al español</label></p>
   <p><label><input type="checkbox" id="p3" ${PREF.slow ? 'checked' : ''}> Voz lenta</label></p>
   <p class="es">Consejo: empieza sin texto para entrenar el oído; si te pierdes, pulsa "Ver texto".</p></div>
  <div class="row"><button id="go">Empezar</button><button class="alt" data-go="#talk">Volver</button></div>`);
  document.querySelectorAll('[data-s]').forEach(b => b.onclick = () => speak(b.dataset.s));
  $('#p1').onchange = e => setPref('showText', e.target.checked); $('#p2').onchange = e => setPref('showEs', e.target.checked); $('#p3').onchange = e => setPref('slow', e.target.checked);
  $('#go').onclick = () => playTalk(t);
}

function playTalk(t) {
  const total = t.turns.filter(x => x.y || x.c).length;
  const res = []; // {type, score, verdict, said, model}
  let i = 0, lastTutor = null;
  const say = (txt, force) => speak(txt, PREF.slow || force ? 0.65 : undefined);
  let vt = PREF.showText, ve = PREF.showEs;
  const tutorCard = turn => `<div class="card"><div class="row"><button id="sp">${ic('volume')} Escuchar</button><button class="alt" id="sl">${ic('gauge')} Lento</button><button class="alt" id="tx">${vt ? ic('eyeoff') + ' Ocultar texto' : ic('eye') + ' Ver texto'}</button><button class="alt" id="te" title="Traducción" aria-label="Mostrar traducción">${ic('translate')}</button></div>
    ${vt ? `<div class="bubble tutor">${esc(turn.t)}</div>` : '<div class="listen-hint"><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span>Escucha con atención…</span></div>'}${ve ? `<p class="es">${esc(turn.es)}</p>` : ''}</div>`;
  const wireTutor = (turn, redraw) => { $('#sp').onclick = () => say(turn.t); $('#sl').onclick = () => say(turn.t, true); $('#tx').onclick = () => { vt = !vt; redraw(); }; $('#te').onclick = () => { ve = !ve; redraw(); }; };
  const next = () => { i++; step(); };
  function step() {
    if (i >= t.turns.length) return finish();
    const turn = t.turns[i];
    if (turn.t) {
      lastTutor = turn; vt = PREF.showText; ve = PREF.showEs;
      const draw = () => { view(`<p class="mute">${res.length}/${total} · ${esc(t.title)}</p>${tutorCard(turn)}<div class="row"><button id="ok">Entendí, continuar</button><button class="alt" id="ex">Salir</button></div>`); wireTutor(turn, draw); $('#ok').onclick = next; $('#ex').onclick = () => { speechSynthesis.cancel(); location.hash = '#talk'; }; };
      draw(); say(turn.t); return;
    }
    if (turn.c) return question(turn.c);
    return respond(turn.y);
  }
  function question(c) {
    const opts = c.o.map((o, k) => ({ o, k }));
    view(`<p class="mute">${res.length + 1}/${total} · comprensión</p>${lastTutor ? tutorCard(lastTutor) : ''}<div class="card"><p><b>${esc(c.q)}</b> <button class="alt" id="qs" aria-label="Escuchar">${ic('volume')}</button></p><p class="es">${esc(c.es)}</p>${opts.map(x => `<button class="opt" data-k="${x.k}">${esc(x.o)}</button>`).join('')}</div>`);
    if (lastTutor) wireTutor(lastTutor, () => question(c));
    $('#qs').onclick = () => say(c.q);
    document.querySelectorAll('.opt').forEach(b => b.onclick = () => { const ok = +b.dataset.k === c.a; b.classList.add(ok ? 'ok' : 'bad'); document.querySelectorAll('.opt').forEach(x => x.disabled = true); res.push({ type: 'c', score: ok ? 1 : 0, verdict: ok ? 'ok' : 'no', said: c.o[+b.dataset.k], model: c.o[c.a] }); tick(); setTimeout(next, ok ? 700 : 1600); });
  }
  function respond(y) {
    let best = null, tries = 0, rec = null, typed = false;
    const draw = fb => {
      view(`<p class="mute">${res.length + 1}/${total} · tu respuesta</p>${lastTutor ? tutorCard(lastTutor) : ''}
      <div class="card"><b>Responde en inglés</b> <span class="es">(${esc(y.es)})</span>
       <p class="mute" id="hint" hidden>Pista: <i>${esc(y.hint || y.say.split(' ').slice(0, 3).join(' ') + '…')}</i></p>
       <div class="row" style="margin:10px 0">${typed ? `<input type="text" id="ti" placeholder="Escribe tu respuesta" autocomplete="off"><button id="tsend">Enviar</button>` : `<button id="mic" class="mic">${ic('mic')} Hablar</button><button class="alt" id="ty">${ic('keyboard')} Escribir</button>`}<button class="alt" id="hb">${ic('bulb')} Pista</button></div>
       <div id="live" class="live mute"></div></div>
      <div id="fb">${fb || ''}</div>`);
      if (lastTutor) wireTutor(lastTutor, () => draw(fb));
      $('#hb').onclick = () => { $('#hint').hidden = false; };
      if (typed) { $('#tsend').onclick = () => evaluate([$('#ti').value]); $('#ti').onkeydown = e => { if (e.key === 'Enter') evaluate([$('#ti').value]); }; }
      else {
        $('#ty').onclick = () => { typed = true; draw(fb); $('#ti').focus(); };
        $('#mic').onclick = () => {
          if (rec) { rec.stop(); return; }
          speechSynthesis.cancel();
          const b = $('#mic'); b.innerHTML = ic('stop') + ' Escuchando… toca para terminar'; b.classList.add('rec');
          rec = recognize({ interim: s => { $('#live').textContent = '…' + s; }, done: a => { rec = null; a.length ? evaluate(a) : draw('<div class="card">No te escuché. Inténtalo otra vez o usa "Escribir".</div>'); }, error: e => { rec = null; draw(`<div class="card">${esc(micMsg(e))}</div>`); } });
          if (!rec) draw('<div class="card">Tu navegador no permite reconocimiento de voz. Usa Chrome o Edge, o el botón "Escribir".</div>');
        };
      }
    };
    const evaluate = alts => {
      const scored = alts.filter(a => a && a.trim()).map(a => ({ a, r: IEJudge.judge(a, y) })).sort((p, q) => q.r.score - p.r.score);
      if (!scored.length) return draw('<div class="card">No recibí texto. Inténtalo de nuevo.</div>');
      const { a, r } = scored[0]; tries++;
      if (!best || r.score > best.r.score) best = { a, r };
      const msg = r.verdict === 'ok' ? '¡Correcto! Se entiende perfectamente.' : r.verdict === 'close' ? 'Casi. Falta o cambia alguna idea.' : 'Todavía no. Escucha el modelo y vuelve a intentarlo.';
      const idea = r.miss.length ? `<p>Ideas que faltan: ${r.miss.map(m => `<b>${esc(m)}</b>`).join(', ')}</p>` : '';
      draw(`<div class="card ${r.verdict}"><h3>${ICON[r.verdict]} ${msg} <span class="pill">${Math.round(r.score * 100)}%</span></h3><p>Dijiste: <i>${esc(a)}</i></p>${idea}
        <p>Modelo: <b>${esc(r.best)}</b> <button class="alt" id="ms" aria-label="Escuchar">${ic('volume')}</button></p><p class="es">${esc(y.es)}</p>
        <div class="row"><button class="alt" id="rt">${ic('refresh')} Reintentar</button><button id="nx">${r.verdict === 'no' && tries < 2 ? 'Saltar' : 'Continuar'}</button></div></div>`);
      $('#ms').onclick = () => say(r.best); $('#rt').onclick = () => { draw(''); };
      $('#fb').scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      $('#nx').onclick = () => { res.push({ type: 'y', score: best.r.verdict === 'ok' ? 1 : best.r.verdict === 'close' ? 0.5 : 0, verdict: best.r.verdict, said: best.a, model: y.say, es: y.es }); tick(2); next(); };
    };
    draw('');
  }
  function finish() {
    const p = Math.round(res.reduce((s, x) => s + x.score, 0) / total * 100);
    S.convo[t.id] = Math.max(S.convo[t.id] || 0, p);
    if (t.track === 'dev') advanceDev();
    tick(3); save();
    const rows = res.filter(x => x.type === 'y').map(x => `<div class="card">${ICON[x.verdict]} <i>${esc(x.said)}</i>${x.verdict !== 'ok' ? `<br><span class="mute">Mejor: ${esc(x.model)}</span>` : ''}<br><span class="es">${esc(x.es)}</span></div>`).join('');
    view(`<h2>${p}%</h2><p>${p >= 80 ? 'Excelente. Dominas esta conversación.' : p >= 60 ? 'Bien. Repítela para consolidar.' : 'Vuelve a escucharla sin mirar el texto y repite las frases del modelo.'}</p>${t.track === 'dev' ? `<p class="mute">Nivel de software: ${S.devLevel}</p>` : ''}<h3>Tus respuestas</h3>${rows}<div class="row"><button data-go="#talk/${esc(t.id)}">Repetir</button><button class="alt" data-go="#talk">Más conversaciones</button></div>`);
  }
  step();
}

/* práctica rápida (diálogos cortos de opción múltiple) */
function playQuick(c) {
  let i = 0, right = 0, total = c.turns.filter(t => t.y).length;
  const log = [];
  const step = () => {
    while (i < c.turns.length && c.turns[i].t) { log.push(`<div class="bubble tutor">${esc(c.turns[i].t)}<div class="es">${esc(c.turns[i].es)}</div></div>`); i++; }
    const last = log.length ? c.turns[i - 1] : null;
    if (i >= c.turns.length) return finish();
    const t = c.turns[i], opts = shuffle(t.y);
    view(`<h3>${esc(c.title)}</h3>${log.join('')}<div class="row"><button class="alt" id="sp">${ic('volume')} Escuchar</button></div><p class="mute">Elige (o di en voz alta) la mejor respuesta:</p>${opts.map((o, k) => `<div class="row"><button class="opt" style="flex:1" data-k="${k}">${esc(o[0])}</button><button class="alt" data-m="${k}" title="Decir en voz alta">🎙️</button></div>`).join('')}<div id="fb"></div>`);
    $('#sp').onclick = () => speak(last ? last.t : '');
    if (last) speak(last.t);
    const answer = o => { const ok = !!o[1]; if (ok) right++; log.push(`<div class="bubble you">${esc(o[0])}<div class="es" style="opacity:.8">${esc(o[2])}</div></div>`); tick(2); i++; if (!ok) { const best = t.y.find(y => y[1]); $('#fb').innerHTML = `<div class="card no">${ic('no', 'v-no')} Mejor: <b>${esc(best[0])}</b></div>`; setTimeout(step, 1800); } else step(); };
    document.querySelectorAll('.opt').forEach(b => b.onclick = () => answer(opts[b.dataset.k]));
    document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const o = opts[b.dataset.m]; listen(txt => { if (!txt) return; const s = IEJudge.judge(txt, { say: o[0] }).score; $('#fb').innerHTML = `<div class="card">Dijiste: <i>${esc(txt)}</i> · precisión ${Math.round(s * 100)}%</div>`; if (s >= 0.7) setTimeout(() => answer(o), 900); }); });
  };
  const finish = () => {
    const p = Math.round(right / total * 100); S.convo[c.id] = Math.max(S.convo[c.id] || 0, p);
    if (c.track === 'dev') advanceDev();
    save();
    view(`<h2>${p}%</h2>${log.join('')}<button data-go="#talk">Volver</button>`);
  };
  step();
}

/* ---------- examen ---------- */
VIEWS.exam = (m) => {
  if (m !== 'go') {
    const h = S.exams.slice(-5).reverse().map(e => `<p>${esc(e.d)} · <b>${e.p}%</b> · ${esc(e.lv)}</p>`).join('') || '<p class="mute">Sin intentos.</p>';
    return view(`<h2>Examen</h2><div class="card"><p>20 preguntas mixtas: significado, listening, spelling y gramática, sobre tu nivel actual.</p><button data-go="#exam/go">Comenzar</button></div><div class="card"><h3>Historial</h3>${h}</div>`);
  }
  const words = shuffle(unlockedWords()).slice(0, 14), g = shuffle(GRAM.filter(x => levelUnlocked(lvlIdx(x.level))).flatMap(x => x.exercises)).slice(0, 6);
  const qs = [...words.map((w, k) => ({ w, t: k % 3 === 0 ? 'listen' : k % 3 === 1 ? 'meaning' : 'spell' })), ...g.map(q => ({ q, t: 'gram' }))];
  let i = 0, ok = 0;
  const next = () => {
    if (i >= qs.length) { const p = Math.round(ok / qs.length * 100); S.exams.push({ id: Date.now().toString(36), d: today(), p, lv: currentLevel().id }); tick(3); save(); return view(`<h2>${p}%</h2><div class="card">${p >= 80 ? 'Excelente. ¡Sube de nivel!' : p >= 60 ? 'Bien, sigue repasando.' : 'Repasa vocabulario y gramática.'}</div><button data-go="#exam">Volver</button>`); }
    const x = qs[i], hd = `<p class="mute">${i + 1}/${qs.length}</p>`, adv = c => { if (c) ok++; i++; setTimeout(next, 700); };
    if (x.t === 'gram') { view(`${hd}<div class="card"><p>${esc(x.q.q)}</p>${x.q.o.map((o, k) => `<button class="opt" data-k="${k}">${esc(o)}</button>`).join('')}</div>`); document.querySelectorAll('.opt').forEach(b => b.onclick = () => { const c = +b.dataset.k === x.q.a; b.classList.add(c ? 'ok' : 'bad'); adv(c); }); }
    else if (x.t === 'spell') { view(`${hd}<div class="card"><p>Escribe: <b>${esc(x.w.es)}</b> <button class="alt" id="sp" aria-label="Escuchar">${ic('volume')}</button></p><input type="text" id="in" autocomplete="off" autocapitalize="off"><p><button id="ck">OK</button></p></div>`); $('#sp').onclick = () => speak(x.w.en); $('#ck').onclick = () => { const c = $('#in').value.trim().toLowerCase() === x.w.en.toLowerCase(); $('#ck').disabled = true; $('#ck').classList.add(c ? 'ok' : 'bad'); adv(c); }; }
    else { const opts = shuffle([x.w, ...distractors(x.w, 'es')]); view(`${hd}<div class="card"><p>${x.t === 'listen' ? `<button id="sp">${ic('volume')} Escuchar</button>` : `<span class="big">${esc(x.w.en)}</span>`}</p>${opts.map((o, k) => `<button class="opt" data-k="${k}">${esc(o.es)}</button>`).join('')}</div>`); if (x.t === 'listen') { $('#sp').onclick = () => speak(x.w.en); speak(x.w.en); } document.querySelectorAll('.opt').forEach(b => b.onclick = () => { const c = opts[b.dataset.k] === x.w; b.classList.add(c ? 'ok' : 'bad'); adv(c); }); }
  };
  next();
};

/* ---------- audios largos / podcasts ---------- */
VIEWS.pods = (id) => {
  const p = S.pods.find(x => x.id === id && !x.del);
  if (p) {
    view(`<h2>${esc(p.title)}</h2><div class="card"><audio id="au" controls preload="metadata" src="${esc(p.url)}"></audio>
      <div class="row"><button class="alt" id="b">${ic('rewind')} 15 s</button><button class="alt" id="f">15 s ${ic('forward')}</button>
      <select id="sp" style="width:auto"><option>0.75</option><option selected>1</option><option>1.25</option><option>1.5</option></select></div></div>
      <div class="card"><b>Notas / transcripción</b><textarea id="nt" rows="6" style="width:100%;background:transparent;color:inherit;border:1px solid var(--mute);border-radius:10px;padding:8px">${esc(p.notes || '')}</textarea></div>
      <button class="alt" data-go="#pods">Volver</button>`);
    const a = $('#au'); a.currentTime = p.pos || 0;
    let last = 0; a.ontimeupdate = () => { if (Date.now() - last > 4000) { p.pos = a.currentTime; last = Date.now(); save(); } };
    a.onplay = () => tick();
    $('#b').onclick = () => a.currentTime -= 15; $('#f').onclick = () => a.currentTime += 15; $('#sp').onchange = e => a.playbackRate = +e.target.value;
    $('#nt').onchange = e => { p.notes = e.target.value; p.nt = Date.now(); save(); };
    return;
  }
  view(`${typeof readTabs === 'function' ? readTabs('p') : ''}<h2>Audios largos</h2>
   <div class="card"><h3>Añadir</h3><p class="es">Pega un enlace directo a un .mp3 o el RSS de un podcast (si el sitio bloquea CORS, usa el enlace del episodio).</p>
   <input type="url" id="u" placeholder="https://…/episode.mp3 o feed.xml"><p><input type="text" id="t" placeholder="Título (opcional)"></p><button id="add">Añadir</button> <span id="st" class="mute"></span></div>
   ${S.pods.filter(x => !x.del).map(x => `<div class="card"><b>${esc(x.title)}</b> <span class="mute">${Math.round((x.pos || 0) / 60)} min</span><div class="row"><button data-go="#pods/${x.id}">Reproducir</button><button class="alt" data-del="${x.id}">Quitar</button></div></div>`).join('') || '<p class="mute">Aún no hay audios.</p>'}`);
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { const q = S.pods.find(x => x.id === b.dataset.del); if (q) q.del = true; save(); route(); });
  $('#add').onclick = async () => {
    const url = $('#u').value.trim(); if (!/^https?:\/\//.test(url)) return $('#st').textContent = 'URL no válida';
    let items = [{ title: $('#t').value.trim() || url.split('/').pop() || 'Audio', url }];
    if (!/\.(mp3|m4a|ogg|wav|aac)(\?|$)/i.test(url)) {
      $('#st').textContent = 'Leyendo feed…';
      try {
        if (serverUp) { const r = await fetch('/api/feed?url=' + encodeURIComponent(url)); if (!r.ok) throw 0; const j = await r.json(); items = j.items.slice(0, 20).map(i => ({ title: i.title, url: i.url })); if (!items.length) throw 0; }
        else {
        const x = new DOMParser().parseFromString(await (await fetch(url)).text(), 'text/xml');
        items = [...x.querySelectorAll('item')].slice(0, 20).map(it => ({ title: it.querySelector('title')?.textContent || 'Episodio', url: it.querySelector('enclosure')?.getAttribute('url') })).filter(i => i.url);
        if (!items.length) throw 0; }
      } catch { return $('#st').textContent = 'No se pudo leer el feed. Pega el enlace directo del .mp3.'; }
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
  <div class="card"><b>Sincronización</b> <span class="mute" id="ss"></span><div class="row"><button id="sn">Sincronizar ahora</button><button class="alt" id="lo">Cerrar sesión</button></div></div>
  <div class="card"><b>Copia de seguridad</b><div class="row"><button id="ex">Exportar</button><button class="alt" id="im">Importar</button></div><input type="file" id="fi" accept=".json" hidden></div>
  <p class="es">Versión ${APP_VERSION} · ${TALKS.length} conversaciones · ${VOCAB.length} palabras</p>`);
  $('#r').onchange = e => { S.rate = +e.target.value; S.settingsAt = Date.now(); save(); speak('This is my speed.'); };
  $('#ua').onchange = e => { S.unlockAll = e.target.checked; S.settingsAt = Date.now(); save(); };
  $('#sp').onclick = async () => { const v = $('#pin').value; S.pin = v ? await hash(v) : null; save(); route(); };
  $('#ex').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: 'application/json' })); a.download = 'mi-ingles-backup.json'; a.click(); };
  $('#im').onclick = () => $('#fi').click();
  $('#ss').textContent = { ok: 'al día', off: 'sin conexión', auth: 'inicia sesión', none: 'solo local', busy: 'sincronizando' }[syncStatus];
  $('#sn').onclick = () => sync(true);
  $('#lo').onclick = async () => { try { await fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); } catch { } location.href = '/login.html'; };
  $('#fi').onchange = async e => { try { S = { ...defaults(), ...IEMerge.merge(S, JSON.parse(await e.target.files[0].text())), pin: S.pin }; save(); route(); } catch { alert('Archivo inválido'); } };
};

/* ---------- bloqueo por PIN ---------- */
async function hash(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ie:' + s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
function gate() {
  const el = $('#lock');
  if (!S.pin || sessionStorage.getItem('ie.ok')) { el.hidden = true; return init(); }
  el.hidden = false; el.className = 'lock';
  el.innerHTML = '<div><span class="eq on" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><h2>Mi Inglés</h2><label class="sr" for="lp">PIN</label><input type="password" id="lp" inputmode="numeric" placeholder="PIN" autofocus><p><button id="lg">Entrar</button></p><p id="le" class="mute"></p></div>';
  const go = async () => { if (await hash($('#lp').value) === S.pin) { sessionStorage.setItem('ie.ok', '1'); el.hidden = true; init(); } else $('#le').textContent = 'PIN incorrecto'; };
  $('#lg').onclick = go; $('#lp').onkeydown = e => e.key === 'Enter' && go();
}
document.addEventListener('DOMContentLoaded', gate);
