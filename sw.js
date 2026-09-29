const V = 'ie-v2';
const FILES = ['./index.html', 'style.css', 'app.js', 'merge.js', 'manifest.json', 'icons/icon.svg', 'data/vocab.json', 'data/grammar.json', 'data/convo.json', 'data/levels.json'];
// Instalación tolerante: sin sesión el servidor responde 401 y simplemente se cachea después de entrar.
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => Promise.all(FILES.map(f => fetch(f, { redirect: 'manual' }).then(r => r.ok && c.put(f, r)).catch(() => { })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && !r.redirected && r.type === 'basic' && !u.pathname.startsWith('/login')) { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request).then(m => m || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined))));
});
