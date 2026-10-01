'use strict';
/* Lectura: foto a texto (OCR local), lectura en voz alta con seguimiento, preguntas por voz,
   práctica de pronunciación y corrección gramatical. Sin IA ni gasto de tokens.
   Usa globals de app.js: $, esc, ic, view, S, save, tick, VIEWS, VOCAB, PREF, setPref, micMsg. */
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const readTabs = a => `<div class="chips" role="group" aria-label="Sección"><button class="chip ${a === 't' ? 'on' : ''}" data-go="#read">Textos</button><button class="chip ${a === 'p' ? 'on' : ''}" data-go="#pods">Podcasts</button></div>`;
const TTS = 'speechSynthesis' in window;

/* ---------- voz de la profesora ---------- */
const FEMALE = /(aria|jenny|michelle|ava|emma|samantha|allison|susan|zira|joanna|salli|kendra|kimberly|ivy|nicole|amy|serena|karen|moira|tessa|libby|sonia|female|google us english)/i;
const MALE = /\b(david|mark|guy|george|daniel|james|ryan|alex|fred|tom|eric|male|christopher|brian|roger|steffan|thomas|rishi)\b/i;
const enVoices = () => TTS ? speechSynthesis.getVoices().filter(v => /^en[-_]/i.test(v.lang)) : [];
function voiceScore(v) { return (/en[-_]US/i.test(v.lang) ? 4 : 0) + (FEMALE.test(v.name) ? 3 : 0) + (/natural|neural|online/i.test(v.name) ? 3 : 0) - (MALE.test(v.name) && !FEMALE.test(v.name) ? 8 : 0); }
function teacherVoice() {
  const vs = enVoices(); if (!vs.length) return null;
  if (PREF.voice) { const v = vs.find(x => x.name === PREF.voice); if (v) return v; }
  return vs.slice().sort((a, b) => voiceScore(b) - voiceScore(a))[0];
}
const esVoice = () => TTS ? (speechSynthesis.getVoices().filter(v => /^es[-_]/i.test(v.lang)).sort((a, b) => (FEMALE.test(b.name) ? 1 : 0) - (FEMALE.test(a.name) ? 1 : 0) || (/es[-_](US|MX)/i.test(b.lang) ? 1 : 0) - (/es[-_](US|MX)/i.test(a.lang) ? 1 : 0))[0] || null) : null;
function utter(text, lang, rate) {
  const u = new SpeechSynthesisUtterance(text); u.lang = lang === 'es' ? 'es-ES' : 'en-US'; u.rate = rate || 0.92; u.pitch = lang === 'es' ? 1 : 1.02;
  const v = lang === 'es' ? esVoice() : teacherVoice(); if (v) { u.voice = v; u.lang = v.lang; } return u;
}
/* dice una lista de partes en orden; resuelve al terminar (con tope por si el navegador no emite eventos) */
function speakQueue(parts) {
  if (!TTS) return Promise.resolve();
  speechSynthesis.cancel();
  return parts.reduce((p, part) => p.then(() => new Promise(done => {
    const u = utter(part.t, part.lang, part.rate); let fin = false; const end = () => { if (!fin) { fin = true; document.body.classList.remove('speaking'); done(); } };
    u.onstart = () => document.body.classList.add('speaking'); u.onend = u.onerror = end; setTimeout(end, 4000 + part.t.length * 90);
    setTimeout(() => speechSynthesis.speak(u), 60);
  })), Promise.resolve());
}
const sayWord = (w, slow) => speakQueue([{ t: w, lang: 'en', rate: slow ? 0.6 : 0.85 }]);

/* ---------- motor de lectura con seguimiento ---------- */
function makeEngine(doc, ui) {
  const { words, sentences } = doc; let cur = 0, playing = false, tk = 0, timer = null, watchdog = null;
  const rateNow = () => Math.min(1.3, Math.max(0.6, PREF.readRate || 0.9));
  const stopTimers = () => { clearInterval(timer); clearTimeout(watchdog); };
  function speakFrom(wi, myTk) {
    const si = IERead.sentenceOf(sentences, wi), [a, b] = sentences[si], start = Math.max(a, wi);
    const base = words[start].s, text = doc.text.slice(base, words[b].e), offs = []; for (let j = start; j <= b; j++) offs.push(words[j].s - base);
    const u = utter(text, 'en', rateNow()); let gotBoundary = false, t0 = 0;
    const idxAt = ci => { let j = 0; while (j + 1 < offs.length && offs[j + 1] <= ci) j++; return start + j; };
    u.onstart = () => {
      if (myTk !== tk) return; clearTimeout(watchdog); t0 = Date.now(); document.body.classList.add('speaking'); cur = start; ui.onWord(start);
      const weights = offs.map((o, j) => (words[start + j].e - words[start + j].s) + 2), total = weights.reduce((x, y) => x + y, 0), est = text.length / (14 * rateNow()) * 1000;
      timer = setInterval(() => {                       // plan B si el navegador no envía eventos de palabra
        if (gotBoundary || myTk !== tk) return; if (Date.now() - t0 < 700) return;
        const frac = Math.min(0.98, (Date.now() - t0) / est); let acc = 0, j = 0; for (; j < weights.length - 1; j++) { acc += weights[j] / total; if (acc > frac) break; }
        if (start + j > cur) { cur = start + j; ui.onWord(cur); }
      }, 80);
    };
    u.onboundary = e => { if (myTk !== tk || (e.name && e.name !== 'word')) return; gotBoundary = true; cur = idxAt(e.charIndex); ui.onWord(cur); };
    u.onend = () => {
      if (myTk !== tk) return; stopTimers(); document.body.classList.remove('speaking'); cur = b; ui.onWord(b);
      if (playing && si + 1 < sentences.length) { cur = sentences[si + 1][0]; speakFrom(cur, myTk); } else { playing = false; cur = 0; ui.onState('done'); }
    };
    u.onerror = e => { if (myTk !== tk || e.error === 'canceled' || e.error === 'interrupted') return; stopTimers(); playing = false; ui.onState('error', e.error); };
    watchdog = setTimeout(() => { if (myTk === tk && !t0) { playing = false; stopTimers(); speechSynthesis.cancel(); ui.onState('silent'); } }, 3500);
    setTimeout(() => { if (myTk === tk) speechSynthesis.speak(u); }, 70);
  }
  const E = {
    get cur() { return cur; }, get playing() { return playing; },
    play(from) { if (!TTS) return ui.onState('silent'); tk++; stopTimers(); speechSynthesis.cancel(); playing = true; if (from != null) cur = from; ui.onState('playing'); speakFrom(cur, tk); },
    pause() { const was = playing; tk++; stopTimers(); playing = false; if (TTS) speechSynthesis.cancel(); document.body.classList.remove('speaking'); ui.onState('paused'); return was; },
    jump(d) { const si = Math.min(sentences.length - 1, Math.max(0, IERead.sentenceOf(sentences, cur) + d)); cur = sentences[si][0]; ui.onWord(cur); if (playing) E.play(cur); },
    restartSentence() { cur = sentences[IERead.sentenceOf(sentences, cur)][0]; ui.onWord(cur); E.play(cur); },
    stop() { tk++; stopTimers(); playing = false; if (TTS) speechSynthesis.cancel(); document.body.classList.remove('speaking'); },
  };
  return E;
}

/* ---------- reconocimiento de voz ---------- */
function recognizeOnce(lang, h, continuous) {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition; if (!R) return null;
  const r = new R(); r.lang = lang; r.interimResults = true; r.maxAlternatives = 5; r.continuous = !!continuous;
  let alts = [], finals = [], failed = false, conf = null;
  r.onresult = e => { const res = e.results[e.results.length - 1]; if (h.interim) h.interim(res[0].transcript); if (res.isFinal) { alts = Array.from(res).map(a => a.transcript); finals.push(alts); conf = res[0].confidence; if (h.segment) h.segment(alts, conf); } };
  r.onerror = e => { failed = true; document.body.classList.remove('listening'); h.error && h.error(e.error); };
  r.onend = () => { document.body.classList.remove('listening'); if (!failed) h.done(continuous ? finals.map(f => f[0]) : alts, conf); };
  try { r.start(); document.body.classList.add('listening'); } catch { return null; }
  return r;
}

/* ---------- diccionario ---------- */
const DKEY = 'ie.dict.v1';
const dictRead = () => { try { return JSON.parse(localStorage.getItem(DKEY) || '{}'); } catch { return {}; } };
function dictStore(k, v) { try { const d = dictRead(); d[k] = v; const keys = Object.keys(d); if (keys.length > 300) delete d[keys[0]]; localStorage.setItem(DKEY, JSON.stringify(d)); } catch { } }
async function dictGet(w, from) {
  const k = from + ':' + w, c = dictRead()[k]; if (c) return c;
  try { const r = await fetch(`/api/define?word=${encodeURIComponent(w)}&from=${from}`); if (!r.ok) return null; const j = await r.json(); if (j.found || (j.es && j.es.length) || (j.en && j.en.length)) dictStore(k, j); return j; } catch { return null; }
}
function hideSheet() { const s = $('#sheet'); if (s) s.hidden = true; }
function showSheet(html, onMount) {
  let sh = $('#sheet'); if (!sh) { sh = document.createElement('div'); sh.id = 'sheet'; sh.className = 'sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-label', 'Significado'); document.body.appendChild(sh); }
  sh.hidden = false; sh.innerHTML = `<div class="sheet-in"><button class="alt close" id="sx" aria-label="Cerrar">${ic('x')}</button>${html}</div>`;
  $('#sx').onclick = hideSheet; if (onMount) onMount(sh);
}
function entryHtml(word, local, data, lang, from) {
  const es = data && data.es && data.es.length ? data.es : local ? [local.es] : [], en = data && data.en || [];
  const defs = data && data.meanings ? data.meanings.map(m => `<div class="def"><span class="pos">${esc(m.pos)}</span>${m.defs.map(d => `<div>${esc(d.d)}${d.ex ? `<div class="es">“${esc(d.ex)}”</div>` : ''}</div>`).join('')}</div>`).join('') : '';
  const tr = (from === 'es' ? en : es).map(t => `<span class="chip tr">${esc(t)}</span>`).join('');
  const trBlock = tr ? `<p><b>${from === 'es' ? 'En inglés' : 'En español'}:</b></p><div>${tr}</div>` : '';
  const defBlock = defs ? `<p><b>Definición</b></p>${defs}` : '';
  const none = !tr && !defs ? (data === null ? `<p class="mute">No pude consultar el diccionario${navigator.onLine ? ' ahora mismo. Inténtalo de nuevo en un momento' : ': no hay conexión. Las palabras que ya consultaste sí funcionan sin internet'}.</p>` : `<p class="mute">No encontré «${esc(word)}». Revisa la ortografía.</p>`) : '';
  const loc = local ? `<p class="es">De tu vocabulario: ${esc(local.ex || '')}</p>` : '';
  return `<h3>${esc(word)} <span class="mute" style="font:400 1rem 'Instrument Sans'">${esc((data && data.phonetic) || '')}</span> <button class="alt" id="hw" aria-label="Escuchar la palabra">${ic('volume')}</button> <button class="alt" id="hs" aria-label="Escuchar lento">${ic('gauge')}</button></h3>${lang === 'es' ? trBlock + defBlock : defBlock + trBlock}${none}${loc}`;
}
async function lookupWord(raw, o = {}) {
  const cands = IERead.lemmaCandidates(raw), base = cands[0]; if (!base) return;
  const from = o.toEnglish ? 'es' : 'en', lang = o.lang || 'en';
  const local = from === 'en' ? VOCAB.find(w => cands.includes(w.en.toLowerCase())) : null;
  const ctx = o.ctx || '';
  const mount = word => () => { $('#hw') && ($('#hw').onclick = () => sayWord(word)); $('#hs') && ($('#hs').onclick = () => sayWord(word, true)); $$('[data-from]').forEach(b => b.onclick = () => { hideSheet(); o.onFrom && o.onFrom(+b.dataset.from); }); const f = $('#fixq'); if (f) f.onsubmit = ev => { ev.preventDefault(); lookupWord($('#fixw').value, { ...o, speak: false }); }; $('#cont') && ($('#cont').onclick = () => { hideSheet(); o.onContinue && o.onContinue(); }); };
  const extra = (word) => `${o.voiceHeard ? `<form id="fixq" class="row" style="margin-top:10px"><label class="sr" for="fixw">Palabra buscada</label><input type="text" id="fixw" value="${esc(word)}" style="flex:1;min-width:140px"><button class="alt">Buscar otra vez</button></form><p class="es">Entendí «${esc(o.voiceHeard)}». Si no es la palabra, corrígela y busca de nuevo.</p>` : ''}<div class="row" style="margin-top:12px">${o.onFrom ? `<button data-from="${o.idx}">${ic('play')} Leer desde aquí</button>` : ''}${o.onContinue ? `<button class="alt" id="cont">${ic('play')} Continuar lectura</button>` : ''}</div>`;
  showSheet(`<h3>${esc(base)}</h3><p class="mute">Buscando…</p>${ctx}`, mount(base));
  let data = null;
  if (from === 'es') data = await dictGet(base, 'es'); else for (const c of cands.slice(0, 4)) { data = await dictGet(c, 'en'); if (data && (data.found || (data.es && data.es.length))) { break; } }
  const word = (data && data.word) || base;
  showSheet(entryHtml(word, local, data, lang, from) + extra(word), mount(word));
  if (o.speak) {
    const es = data && data.es && data.es[0] || local && local.es, en = data && data.en && data.en[0], d = data && data.meanings && data.meanings[0] && data.meanings[0].defs[0];
    const parts = [];
    if (from === 'es') { parts.push({ t: base, lang: 'es' }); if (en) parts.push({ t: en, lang: 'en', rate: 0.8 }); }
    else if (lang === 'es') { parts.push({ t: word, lang: 'en', rate: 0.8 }); if (es) parts.push({ t: 'significa ' + es, lang: 'es' }); if (d) parts.push({ t: d.d, lang: 'en' }); }
    else { parts.push({ t: word, lang: 'en', rate: 0.8 }); if (d) parts.push({ t: d.d, lang: 'en' }); if (es) parts.push({ t: 'En español: ' + es, lang: 'es' }); }
    speakQueue(parts);
  } else if (o.sayWord !== false) sayWord(word);
}

/* ---------- OCR: foto a texto ---------- */
const loadScript = src => new Promise((ok, no) => { if ($(`script[data-src="${src}"]`)) return ok(); const s = document.createElement('script'); s.src = src; s.dataset.src = src; s.onload = ok; s.onerror = () => no(new Error('No se pudo cargar ' + src)); document.head.appendChild(s); });
async function prepImage(file) {
  if (file.size > 30e6) throw new Error('La imagen pesa más de 30 MB.');
  let bmp; try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { bmp = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('No pude abrir esa imagen.')); i.src = URL.createObjectURL(file); }); }
  const w0 = bmp.width, h0 = bmp.height, mx = Math.max(w0, h0), k = mx > 2200 ? 2200 / mx : mx < 1000 ? Math.min(2, 1400 / mx) : 1;
  const c = document.createElement('canvas'); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, c.width, c.height);
  const im = g.getImageData(0, 0, c.width, c.height), d = im.data, hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = d[i + 1] = d[i + 2] = y; hist[y]++; }
  const tot = c.width * c.height; let lo = 0, hi = 255, acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > tot * 0.02) { lo = i; break; } } acc = 0; for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > tot * 0.02) { hi = i; break; } }
  if (hi - lo > 30) { const sc = 255 / (hi - lo); for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, (d[i] - lo) * sc)); d[i] = d[i + 1] = d[i + 2] = v; } }
  g.putImageData(im, 0, 0); if (bmp.close) bmp.close(); return c;
}
async function ocrImage(file, onProgress) {
  onProgress({ status: 'preparando imagen', progress: 0 });
  const canvas = await prepImage(file);
  await loadScript('vendor/tesseract/tesseract.min.js');
  const base = new URL('vendor/tesseract/', location.href).href;
  const worker = await Tesseract.createWorker('eng', 1, { workerPath: base + 'worker.min.js', corePath: base, langPath: base + 'lang', workerBlobURL: false, logger: onProgress });
  try { const { data } = await worker.recognize(canvas); return { text: IERead.cleanOcr(data.text), conf: Math.round(data.confidence), canvas }; } finally { await worker.terminate(); }
}

/* ---------- vistas ---------- */
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const liveReads = () => S.reads.filter(r => !r.del).sort((a, b) => (b.t || 0) - (a.t || 0));
let ENGINE = null;
function stopAll() { if (ENGINE) ENGINE.stop(); ENGINE = null; if (TTS) speechSynthesis.cancel(); hideSheet(); document.body.classList.remove('speaking', 'listening'); }
addEventListener('hashchange', () => { if (!/^#read\/[\w-]+/.test(location.hash) || location.hash === '#read/new') stopAll(); });
if (TTS) speechSynthesis.onvoiceschanged = () => { const s = $('#voice'); if (s) fillVoices(s); };

VIEWS.read = (id) => {
  if (id === 'new') return newReading();
  const rd = S.reads.find(r => r.id === id && !r.del);
  if (rd) return openReader(rd);
  const list = liveReads();
  view(`${readTabs('t')}<h2>Leer</h2><p class="es">Sube la foto de un texto, escúchalo con una profesora y practica tu lectura.</p>
  <section class="panel">${'<span class="eq on" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>'}<h2>Lee desde una foto</h2><p>Elige una imagen de tu galería o toma una foto de la página. El texto se reconoce en tu propio dispositivo.</p>
   <div class="row"><button id="pick">${ic('image')} Foto o galería</button><button class="alt" id="cam">${ic('camera')} Cámara</button><button class="alt" id="paste">${ic('pen')} Pegar texto</button></div></section>
  <input type="file" id="fi" accept="image/*" hidden><input type="file" id="fc" accept="image/*" capture="environment" hidden>
  <h3>Mis lecturas</h3>${list.length ? `<div class="list">${list.map(r => `<div class="item"><a class="grow" href="#read/${r.id}" style="color:inherit;text-decoration:none"><b>${esc(r.title)}</b><div class="es">${r.text.split(/\s+/).length} palabras${r.best ? ` · mejor lectura ${r.best}%` : ''}</div></a>${r.best >= 80 ? '<span class="pill done">' + r.best + '%</span>' : ''}<button class="alt" data-del="${r.id}" aria-label="Quitar ${esc(r.title)}">${ic('trash')}</button></div>`).join('')}</div>` : '<p class="mute">Todavía no hay lecturas. Sube una foto para empezar.</p>'}
  <div class="list" style="margin-top:20px"><a class="item" href="#pods">${ic('headphones')}<div class="grow"><b>Podcasts y audios largos</b><div class="es">Escucha episodios completos</div></div>${ic('chevron')}</a></div>`);
  const go = f => { if (f) { PENDING = f; location.hash = '#read/new'; } };
  $('#pick').onclick = () => $('#fi').click(); $('#cam').onclick = () => $('#fc').click(); $('#paste').onclick = () => { PENDING = null; location.hash = '#read/new'; };
  $('#fi').onchange = e => go(e.target.files[0]); $('#fc').onchange = e => go(e.target.files[0]);
  $$('[data-del]').forEach(b => b.onclick = () => { const r = S.reads.find(x => x.id === b.dataset.del); if (r && confirm('¿Quitar «' + r.title + '»?')) { r.del = true; r.t = Date.now(); save(); VIEWS.read(); } });
};
let PENDING = null;

function newReading() {
  view(`${readTabs('t')}<h2>Nueva lectura</h2>
  <div id="stage"><div class="dropzone" id="dz"><p><b>Arrastra una foto aquí</b> o pégala con Ctrl+V.</p><div class="row" style="justify-content:center"><button id="pick">${ic('image')} Foto o galería</button><button class="alt" id="cam">${ic('camera')} Cámara</button></div><input type="file" id="fi" accept="image/*" hidden><input type="file" id="fc" accept="image/*" capture="environment" hidden></div>
  <h3>O pega el texto</h3><textarea class="big" id="tx" placeholder="Pega aquí un texto en inglés…"></textarea><p><button id="usetext">${ic('play')} Continuar con este texto</button></p></div>`);
  const stage = $('#stage');
  const process = async file => {
    if (!file || !/^image\//.test(file.type)) return stage.insertAdjacentHTML('afterbegin', '<div class="card no">Elige un archivo de imagen (JPG, PNG, HEIC…).</div>');
    stage.innerHTML = `<div class="card progress" aria-live="polite"><b id="pt">Preparando…</b><div class="bar" style="margin-top:10px"><i id="pb" style="width:4%"></i></div><p class="es">La primera vez descarga el motor de lectura (unos 11 MB) y luego queda guardado para usarlo sin conexión.</p></div>`;
    const lab = { 'loading tesseract core': 'Cargando el motor…', 'initializing tesseract': 'Iniciando…', 'loading language traineddata': 'Cargando el idioma…', 'initializing api': 'Iniciando…', 'recognizing text': 'Leyendo el texto de la imagen…' };
    try {
      const r = await ocrImage(file, m => { const p = Math.max(4, Math.round((m.progress || 0) * 100)); if ($('#pt')) { $('#pt').textContent = lab[m.status] || 'Preparando…'; $('#pb').style.width = p + '%'; } });
      const url = r.canvas.toDataURL('image/jpeg', 0.5);
      reviewText(r.text, r.conf, url);
    } catch (e) { stage.innerHTML = `<div class="card no"><h3>${ic('no', 'v-no')} No pude leer la imagen</h3><p>${esc(e.message || e)}</p><p class="es">Prueba con una foto más nítida, bien iluminada y de frente, o pega el texto.</p><button data-go="#read/new">Intentar de nuevo</button></div>`; }
  };
  const reviewText = (text, conf, thumb) => {
    stage.innerHTML = `${thumb ? `<img class="thumb" alt="Foto procesada" src="${thumb}">` : ''}${conf != null && conf < 65 ? `<div class="card close"><b>${ic('close', 'v-close')} La foto no salió muy nítida (${conf} %).</b><p class="es">Revisa el texto antes de leerlo y corrige lo que haga falta.</p></div>` : conf != null ? `<p class="es">Lectura de imagen: ${conf} % de seguridad. Revisa el texto por si algo salió mal.</p>` : ''}
      <label for="ti"><b>Título</b></label><p><input type="text" id="ti" value="${esc((() => { const w = text.split(/\s+/); return w.length > 6 ? w.slice(0, 6).join(' ') + '…' : text.trim() || 'Lectura'; })())}" maxlength="80"></p>
      <label for="tx2"><b>Texto</b></label><textarea class="big" id="tx2">${esc(text)}</textarea>
      <div class="row" style="margin-top:12px"><button id="ok">${ic('play')} Guardar y leer</button><button class="alt" data-go="#read">Descartar</button></div>`;
    $('#ok').onclick = () => {
      const t = IERead.cleanOcr($('#tx2').value).slice(0, 20000); if (t.split(/\s+/).length < 3) { $('#tx2').focus(); return; }
      const r = { id: newId(), title: $('#ti').value.trim() || 'Lectura', text: t, t: Date.now(), best: 0 }; S.reads.push(r); save(); location.hash = '#read/' + r.id;
    };
    $('#tx2').focus();
  };
  $('#pick').onclick = () => $('#fi').click(); $('#cam').onclick = () => $('#fc').click();
  $('#fi').onchange = e => process(e.target.files[0]); $('#fc').onchange = e => process(e.target.files[0]);
  $('#usetext').onclick = () => { const t = $('#tx').value; if (t.trim()) reviewText(IERead.cleanOcr(t), null, null); else $('#tx').focus(); };
  const dz = $('#dz'); ['dragenter', 'dragover'].forEach(n => dz.addEventListener(n, e => { e.preventDefault(); dz.classList.add('over'); })); ['dragleave', 'drop'].forEach(n => dz.addEventListener(n, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => process(e.dataTransfer.files[0]));
  const onPaste = e => { const f = [...(e.clipboardData && e.clipboardData.files || [])].find(x => /^image\//.test(x.type)); if (f) { e.preventDefault(); process(f); } };
  document.addEventListener('paste', onPaste, { once: false }); addEventListener('hashchange', function off() { document.removeEventListener('paste', onPaste); removeEventListener('hashchange', off); });
  if (PENDING) { const f = PENDING; PENDING = null; process(f); }
}

function fillVoices(sel) {
  const vs = enVoices().sort((a, b) => voiceScore(b) - voiceScore(a)), cur = teacherVoice();
  sel.innerHTML = vs.length ? vs.map(v => `<option value="${esc(v.name)}" ${cur && cur.name === v.name ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('') : '<option>No hay voces en inglés en este dispositivo</option>';
}

function openReader(rd) {
  stopAll();
  const doc = IERead.tokenize(rd.text); doc.text = rd.text;
  let mode = 'listen';
  const head = () => `<p><a class="chip" href="#read">${ic('back')} Mis lecturas</a></p><h2>${esc(rd.title)}</h2>
    <div class="chips wrap" role="tablist" aria-label="Modo"><button class="chip ${mode === 'listen' ? 'on' : ''}" data-m="listen">${ic('headphones')} Escuchar</button><button class="chip ${mode === 'read' ? 'on' : ''}" data-m="read">${ic('mic')} Leer yo</button><button class="chip ${mode === 'speak' ? 'on' : ''}" data-m="speak">${ic('pen')} Mi turno</button></div>`;
  const textHtml = () => { let h = '', prevEnd = 0; doc.words.forEach((w, i) => { const gap = rd.text.slice(prevEnd, w.s); h += (i ? (/\n\s*\n/.test(gap) ? '<br><br>' : /\n/.test(gap) ? '<br>' : ' ') : '') + `<span class="w" data-i="${i}">${esc(w.t)}</span>`; prevEnd = w.e; }); return h; };
  const draw = () => { stopAll(); view(head() + '<div id="body"></div>'); $$('[data-m]').forEach(b => b.onclick = () => { mode = b.dataset.m; draw(); }); ({ listen: modeListen, read: modeRead, speak: modeSpeak })[mode](); };

  /* --- Escuchar --- */
  function modeListen() {
    $('#body').innerHTML = `<details class="card"><summary><b>${ic('sliders')} Voz y velocidad</b></summary>
      <p class="es">Voz de profesora estadounidense. El navegador no ofrece acento de Boston: elige la voz femenina más natural disponible (en Microsoft Edge, las voces «Natural» como Aria, Jenny o Michelle suenan mejor).</p>
      <label for="voice"><b>Voz</b></label><p><select id="voice"></select></p><div class="row"><button class="alt" id="tv">${ic('volume')} Probar voz</button></div></details>
      <p class="es">Toca una palabra para ver su significado, o toca «Leer desde aquí».</p><div class="reading" id="rd" aria-label="Texto: toca una palabra para ver su significado">${textHtml()}</div>
      <div class="dock" id="dock"><button class="alt" id="dprev" aria-label="Frase anterior">${ic('skipback')}</button><button class="mic" id="dplay" aria-label="Reproducir">${ic('play')}</button><button class="alt" id="dnext" aria-label="Frase siguiente">${ic('skipforward')}</button>
       <select class="rate" id="drate" aria-label="Velocidad"><option value="0.7">0.7×</option><option value="0.8">0.8×</option><option value="0.9">0.9×</option><option value="1">1×</option><option value="1.15">1.15×</option></select><span class="grow"></span>
       <button class="alt" id="aes" aria-label="Preguntar en español">${ic('mic')} ES</button><button class="alt" id="aen" aria-label="Preguntar en inglés">${ic('mic')} EN</button></div>`;
    const sel = $('#voice'); fillVoices(sel); sel.onchange = () => setPref('voice', sel.value); $('#tv').onclick = () => speakQueue([{ t: 'Hello! I am your English teacher. Let us read together.', lang: 'en' }]);
    const spans = $$('#rd .w'); let nowI = -1, sentI = -1;
    const mark = i => {
      if (nowI >= 0 && spans[nowI]) spans[nowI].classList.remove('now'); nowI = i; const sp = spans[i]; if (!sp) return; sp.classList.add('now');
      const si = IERead.sentenceOf(doc.sentences, i); if (si !== sentI) { if (sentI >= 0) { const [a, b] = doc.sentences[sentI]; for (let j = a; j <= b; j++) spans[j].classList.remove('sent'); } sentI = si; const [a, b] = doc.sentences[si]; for (let j = a; j <= b; j++) spans[j].classList.add('sent'); }
      const r = sp.getBoundingClientRect(); if (r.top < 90 || r.bottom > innerHeight - 220) sp.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    const setBtn = playing => { $('#dplay').innerHTML = ic(playing ? 'pause' : 'play'); $('#dplay').setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir'); };
    const eng = ENGINE = makeEngine(doc, { onWord: mark, onState: (st, info) => { setBtn(st === 'playing'); if (st === 'done') { tick(2); } if (st === 'silent') showSheet(`<h3>${ic('close', 'v-close')} No se escucha la voz</h3><p>Este dispositivo no produjo audio. Revisa el volumen y que el navegador tenga voces en inglés instaladas (Chrome, Edge o Safari).</p>`); if (st === 'error') showSheet(`<h3>${ic('no', 'v-no')} Error de voz</h3><p class="mute">${esc(info || '')}</p>`); } });
    $('#drate').value = String(PREF.readRate || 0.9); if ($('#drate').value !== String(PREF.readRate || 0.9)) $('#drate').value = '0.9';
    $('#drate').onchange = e => { setPref('readRate', +e.target.value); if (eng.playing) eng.play(eng.cur); };
    $('#dplay').onclick = () => { hideSheet(); eng.playing ? eng.pause() : eng.play(); };
    $('#dprev').onclick = () => eng.jump(-1); $('#dnext').onclick = () => eng.jump(1);
    $('#rd').onclick = e => { const w = e.target.closest('.w'); if (!w) return; const i = +w.dataset.i; eng.pause(); mark(i);
      lookupWord(doc.words[i].t, { lang: 'es', idx: i, ctx: '', onFrom: ix => { hideSheet(); eng.play(ix); }, onContinue: null }); };
    const ask = lang => {
      eng.pause(); showSheet(`<h3>${ic('mic')} Escuchando… <span class="eq on" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></h3><p id="heard" class="live mute"></p><p class="es">${lang === 'es' ? 'Di, por ejemplo: «¿Qué significa neighbour?», «esta palabra», «repite» o «sigue».' : 'Say, for example: “What does neighbour mean?”, “this word”, “repeat” or “continue”.'}</p>`);
      const r = recognizeOnce(lang === 'es' ? 'es-ES' : 'en-US', {
        interim: t => { const h = $('#heard'); if (h) h.textContent = '“' + t + '”'; },
        error: e => showSheet(`<h3>${ic('close', 'v-close')} No pude escucharte</h3><p>${esc(micMsg(e))}</p>`),
        done: alts => {
          const qs = (alts.length ? alts : ['']).map(a => ({ a, q: IERead.parseQuery(a, lang) })); const best = qs.find(x => x.q.intent !== 'unknown') || qs[0], q = best.q, heard = best.a;
          if (!heard) return showSheet(`<h3>${ic('close', 'v-close')} No te escuché</h3><p class="es">Acércate al micrófono e inténtalo otra vez.</p>`);
          if (q.intent === 'continue') { hideSheet(); return eng.play(); }
          if (q.intent === 'repeat') { hideSheet(); return eng.restartSentence(); }
          if (q.intent === 'slower' || q.intent === 'faster') { const n = Math.min(1.3, Math.max(0.6, +(((PREF.readRate || 0.9) + (q.intent === 'slower' ? -0.1 : 0.1))).toFixed(2))); setPref('readRate', n); $('#drate').value = String(n); if ($('#drate').value !== String(n)) $('#drate').insertAdjacentHTML('beforeend', `<option value="${n}" selected>${n}×</option>`); hideSheet(); return eng.play(eng.cur); }
          if (q.intent === 'pause') return hideSheet();
          if (q.intent === 'unknown') return showSheet(`<h3>${ic('close', 'v-close')} No entendí la pregunta</h3><p class="es">Entendí «${esc(heard)}». Escribe la palabra para buscarla:</p><form id="fixq" class="row"><label class="sr" for="fixw">Palabra</label><input type="text" id="fixw" style="flex:1;min-width:140px"><button>Buscar</button></form>`, () => { $('#fixq').onsubmit = ev => { ev.preventDefault(); lookupWord($('#fixw').value, { lang, speak: false, idx: eng.cur, onFrom: ix => { hideSheet(); eng.play(ix); }, onContinue: () => eng.play(eng.cur) }); }; $('#fixw').focus(); });
          const idx = eng.cur, word = q.word === '@current' ? doc.words[idx].t : q.word;
          const o = { lang: q.lang || lang, speak: true, idx, voiceHeard: q.word === '@current' ? '' : q.word, onFrom: ix => { hideSheet(); eng.play(ix); }, onContinue: () => eng.play(eng.cur) };
          if (q.intent === 'toEnglish') return lookupWord(word, { ...o, toEnglish: true });
          if (q.intent === 'pronounce') { sayWord(word, true); return lookupWord(word, { ...o, speak: false, sayWord: false }); }
          lookupWord(word, o);
        } });
      if (!r) showSheet(`<h3>${ic('close', 'v-close')} Micrófono no disponible</h3><p>Tu navegador no permite reconocimiento de voz. Usa Chrome, Edge o Safari, o toca las palabras del texto.</p>`);
    };
    $('#aes').onclick = () => ask('es'); $('#aen').onclick = () => ask('en');
    mark(0);
  }

  /* --- Leer yo: pronunciación frase por frase --- */
  function modeRead() {
    let si = 0; const res = {};
    const sentText = k => { const [a, b] = doc.sentences[k]; return doc.words.slice(a, b + 1); };
    const show = (k, r) => {
      const [a, b] = doc.sentences[k], map = {}; if (r) r.list.forEach(x => { map[x.wi] = x; });
      const html = sentText(k).map((w, j) => { const x = map[a + j]; return `<span class="w ${x ? 's-' + x.status : ''}" ${x && x.status !== 'ok' ? `title="${x.status === 'miss' ? 'No se escuchó' : 'Se entendió «' + esc(x.heard) + '»'}"` : ''}>${esc(w.t)}</span>`; }).join(' ');
      const problems = r ? r.list.filter(x => x.status !== 'ok') : [];
      $('#body').innerHTML = `<p class="mute">Frase ${k + 1} de ${doc.sentences.length}</p><div class="card"><div class="reading practice" style="font-size:1.35rem">${html}</div>
        <div class="row"><button class="alt" id="hear">${ic('volume')} Escuchar a la profesora</button><button class="alt" id="hear2">${ic('gauge')} Lento</button></div>
        <div class="row" style="margin-top:14px"><button class="mic" id="rec">${ic('mic')} Leer esta frase</button><span class="eq" id="eqr" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></div><p class="live mute" id="live"></p></div>
        <div id="fb">${r ? `<div class="card ${r.accuracy >= 85 ? 'ok' : r.accuracy >= 60 ? 'close' : 'no'}"><h3>${ic(r.accuracy >= 85 ? 'ok' : r.accuracy >= 60 ? 'close' : 'no', r.accuracy >= 85 ? 'v-ok' : r.accuracy >= 60 ? 'v-close' : 'v-no')} ${r.accuracy >= 85 ? 'Muy bien.' : r.accuracy >= 60 ? 'Casi.' : 'Inténtalo otra vez.'} <span class="pill">${r.accuracy}%</span></h3><p class="es">Escuché: <i>${esc(r.heard || '(nada)')}</i></p>
          ${problems.length ? `<p><b>Practica estas palabras</b></p><div class="chips wrap">${problems.map(x => `<button class="chip" data-w="${esc(doc.words[x.wi].t)}" aria-label="Escuchar ${esc(doc.words[x.wi].t)}">${ic('volume')} ${esc(doc.words[x.wi].t.replace(/[^\w']/g, ''))}${x.heard ? ` <span class="mute">(oí «${esc(x.heard)}»)</span>` : ' <span class="mute">(omitida)</span>'}</button>`).join('')}</div>` : '<p>Todas las palabras se entendieron bien.</p>'}
          ${r.clarity != null && r.clarity < 0.75 ? `<p class="es">Claridad de voz ${Math.round(r.clarity * 100)} %: habla un poco más despacio y marca cada sílaba.</p>` : ''}
          <div class="row"><button class="alt" id="again">${ic('refresh')} Reintentar</button><button id="nx">${k + 1 < doc.sentences.length ? 'Siguiente frase' : 'Terminar'}</button></div></div>` : ''}</div>`;
      const wd = $$('[data-w]'); wd.forEach(b => b.onclick = () => sayWord(b.dataset.w.replace(/[^\w']/g, ''), true));
      $('#hear').onclick = () => speakQueue([{ t: doc.text.slice(doc.words[a].s, doc.words[b].e), lang: 'en', rate: 0.88 }]); $('#hear2').onclick = () => speakQueue([{ t: doc.text.slice(doc.words[a].s, doc.words[b].e), lang: 'en', rate: 0.6 }]);
      let rec = null;
      $('#rec').onclick = () => {
        if (rec) { rec.stop(); return; } if (TTS) speechSynthesis.cancel();
        const btn = $('#rec'); btn.classList.add('rec'); btn.innerHTML = ic('stop') + ' Escuchando… toca al terminar'; $('#eqr').classList.add('on');
        rec = recognizeOnce('en-US', { interim: t => { $('#live').textContent = '“' + t + '”'; }, error: e => { rec = null; $('#fb').innerHTML = `<div class="card close">${esc(micMsg(e))}</div>`; btn.classList.remove('rec'); btn.innerHTML = ic('mic') + ' Leer esta frase'; $('#eqr').classList.remove('on'); },
          done: (alts, conf) => { rec = null; const cand = (alts || []).filter(Boolean); if (!cand.length) { $('#fb').innerHTML = '<div class="card close">No te escuché. Acércate al micrófono e inténtalo otra vez.</div>'; btn.classList.remove('rec'); btn.innerHTML = ic('mic') + ' Leer esta frase'; $('#eqr').classList.remove('on'); return; }
            let best = null; cand.forEach(c => { const s = IERead.scoreReading(doc.words, a, b, c); if (!best || s.accuracy > best.accuracy) best = { ...s, heard: c }; }); best.clarity = conf; res[k] = best.accuracy > ((res[k] || {}).accuracy || -1) ? best : res[k]; tick(); show(k, best); $('#fb').scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } });
        if (!rec) { btn.classList.remove('rec'); btn.innerHTML = ic('mic') + ' Leer esta frase'; $('#fb').innerHTML = '<div class="card close">Tu navegador no permite reconocimiento de voz. Usa Chrome, Edge o Safari.</div>'; }
      };
      if ($('#again')) { $('#again').onclick = () => show(k); $('#nx').onclick = () => { if (k + 1 < doc.sentences.length) { si = k + 1; show(si); } else summary(); }; }
    };
    const summary = () => {
      const ks = Object.keys(res), avg = ks.length ? Math.round(ks.reduce((s, k) => s + res[k].accuracy, 0) / doc.sentences.length) : 0;
      const bad = {}; ks.forEach(k => res[k].list.filter(x => x.status !== 'ok').forEach(x => { bad[doc.words[x.wi].t.replace(/[^\w']/g, '').toLowerCase()] = x.heard; }));
      rd.best = Math.max(rd.best || 0, avg); rd.t = Date.now(); tick(4); save();
      $('#body').innerHTML = `<h2>${avg}%</h2><p>${avg >= 85 ? 'Excelente lectura.' : avg >= 60 ? 'Buena lectura. Repasa las palabras marcadas.' : 'Sigue practicando: escucha a la profesora y repite frase por frase.'}</p><p class="es">Frases leídas: ${ks.length} de ${doc.sentences.length}.</p>
        ${Object.keys(bad).length ? `<h3>Palabras para practicar</h3><div class="chips wrap">${Object.keys(bad).map(w => `<button class="chip" data-w="${esc(w)}">${ic('volume')} ${esc(w)}</button>`).join('')}</div>` : ''}
        <div class="row" style="margin-top:14px"><button id="rs">${ic('refresh')} Leer otra vez</button><button class="alt" data-m="speak">${ic('pen')} Ahora cuéntalo con tus palabras</button></div>`;
      $$('[data-w]').forEach(b => b.onclick = () => sayWord(b.dataset.w, true)); $('#rs').onclick = () => modeRead(); $('[data-m="speak"]').onclick = () => { mode = 'speak'; draw(); };
    };
    show(0);
  }

  /* --- Mi turno: corrección de gramática --- */
  function modeSpeak() {
    const prompts = ['Summarize the text in two or three sentences.', 'What is the main idea? Say it in your own words.', 'Do you agree with the text? Why or why not?'];
    $('#body').innerHTML = `<p class="es">Cuenta el texto con tus propias palabras, hablando o escribiendo. Te corregiré la gramática y podrás escuchar la versión mejorada. Con internet, el texto se revisa con el corrector LanguageTool (se envía solo lo que escribes aquí); sin conexión se usan reglas básicas.</p>
      <div class="chips wrap">${prompts.map(p => `<button class="chip" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <label for="my" class="sr">Tu respuesta</label><textarea class="big" id="my" placeholder="Escribe o dicta tu respuesta en inglés…"></textarea>
      <div class="row" style="margin-top:12px"><button class="mic" id="rec">${ic('mic')} Hablar</button><button id="chk">${ic('ok')} Corregir</button><span class="eq" id="eqr" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></div><p class="live mute" id="live"></p><div id="out"></div>`;
    $$('[data-p]').forEach(b => b.onclick = () => { $('#live').textContent = 'Idea: ' + b.dataset.p; speakQueue([{ t: b.dataset.p, lang: 'en' }]); });
    let rec = null; const btn = $('#rec');
    btn.onclick = () => {
      if (rec) { rec.stop(); return; } if (TTS) speechSynthesis.cancel(); btn.classList.add('rec'); btn.innerHTML = ic('stop') + ' Detener'; $('#eqr').classList.add('on');
      rec = recognizeOnce('en-US', { interim: t => { $('#live').textContent = '“' + t + '”'; },
        segment: alts => { const t = $('#my'); t.value = (t.value.trim() + ' ' + IERead.sentenceCase(alts[0])).trim(); },
        error: e => { rec = null; btn.classList.remove('rec'); btn.innerHTML = ic('mic') + ' Hablar'; $('#eqr').classList.remove('on'); $('#out').innerHTML = `<div class="card close">${esc(micMsg(e))}</div>`; },
        done: () => { rec = null; btn.classList.remove('rec'); btn.innerHTML = ic('mic') + ' Hablar'; $('#eqr').classList.remove('on'); $('#live').textContent = ''; } }, true);
      if (!rec) { btn.classList.remove('rec'); btn.innerHTML = ic('mic') + ' Hablar'; $('#out').innerHTML = '<div class="card close">Tu navegador no permite reconocimiento de voz. Escribe tu respuesta.</div>'; }
    };
    $('#chk').onclick = async () => {
      const text = $('#my').value.trim(); if (!text) return $('#my').focus();
      $('#out').innerHTML = '<p class="mute">Revisando…</p>';
      const local = IERead.localGrammar(text); let remote = [], online = true;
      try { const r = await fetch('/api/grammar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text.slice(0, 3000) }) }); if (!r.ok) throw 0; remote = (await r.json()).matches.map(m => ({ rule: m.rule, offset: m.offset, length: m.length, message: m.message, replacement: (m.replacements || [])[0] || '', source: 'lt' })); } catch { online = false; }
      const issues = [...local]; remote.forEach(m => { if (!issues.some(i => m.offset < i.offset + i.length && i.offset < m.offset + m.length)) issues.push(m); }); issues.sort((a, b) => a.offset - b.offset);
      const fixed = IERead.applyFixes(text, issues.filter(i => i.replacement)); tick(3);
      $('#out').innerHTML = issues.length ? `<div class="card"><h3>${ic('close', 'v-close')} ${issues.length} cosa${issues.length > 1 ? 's' : ''} para mejorar</h3>${issues.map(i => `<div class="item"><div class="grow"><div>…${esc(text.slice(Math.max(0, i.offset - 24), i.offset))}<mark class="err">${esc(text.slice(i.offset, i.offset + i.length))}</mark>${esc(text.slice(i.offset + i.length, i.offset + i.length + 24))}…</div>${i.replacement ? `<div>Mejor: <mark class="fix">${esc(i.replacement)}</mark></div>` : ''}<div class="es">${esc(i.message)}</div></div></div>`).join('')}</div>
          <div class="card ok"><h3>${ic('ok', 'v-ok')} Versión corregida</h3><p id="fixed">${esc(fixed)}</p><div class="row"><button id="hf">${ic('volume')} Escucharla</button><button class="alt" id="use">${ic('pen')} Usar esta versión</button></div></div>`
        : `<div class="card ok"><h3>${ic('ok', 'v-ok')} No encontré errores.</h3><p class="es">${online ? 'Revisé con el corrector en línea y mis reglas.' : 'Revisé con las reglas básicas sin conexión; con internet la revisión es más completa.'}</p><div class="row"><button id="hf">${ic('volume')} Escucharlo</button></div></div>`;
      if (!online && issues.length) $('#out').insertAdjacentHTML('beforeend', '<p class="es">Sin conexión: solo apliqué reglas básicas. Con internet la revisión es más completa.</p>');
      $('#hf').onclick = () => speakQueue([{ t: fixed, lang: 'en', rate: 0.9 }]); if ($('#use')) $('#use').onclick = () => { $('#my').value = fixed; $('#out').innerHTML = ''; };
    };
  }
  draw();
}
