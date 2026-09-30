# Mi Inglés — plataforma privada (PC + móvil)

PWA sin backend ni IA en tiempo de uso: **0 tokens**. Voz con las APIs del navegador (TTS y reconocimiento).

- **Niveles** B1.1 (arranque) → C1.2, con desbloqueo al dominar ≥70 % del nivel previo.
- **Vocabulario** con repetición espaciada (cajas 0-6): tarjetas, spelling (dictado) y listening.
- **Gramática** bilingüe con ejercicios · **Examen** de 20 preguntas · **Conversación** con voz.
- **Desarrollo de software**: diálogos por niveles (1-4); avanzas al superar ≥80 %.
- **Audios largos**: añade mp3 o RSS de podcasts; guarda posición, velocidad y notas.
- **Privacidad**: PIN local, `noindex`, datos solo en tu navegador, exportar/importar backup.

## Conversaciones de escucha activa
Menú **Hablar** → conversaciones largas (8-10 minutos) por nivel y tema:
1. **Escuchas** al interlocutor (el texto está oculto; puedes ver texto/traducción, repetir o usar voz lenta).
2. **Preguntas de comprensión** sobre lo que oíste.
3. **Respondes con el micrófono** (o escribiendo). `judge.js` compara lo dicho con la respuesta modelo, sus alternativas y las *ideas clave* (con sinónimos): ✅ correcto, 🟡 casi (te dice qué idea falta), ❌ otra vez. Puedes reintentar y pedir pista.
4. Informe final por respuesta; el puntaje se guarda y se sincroniza.

El reconocimiento de voz lo hace el navegador (Chrome/Edge/Safari) y evalúa **qué dijiste**, no la calidad de tu pronunciación. Los niveles se desbloquean por conversaciones (≥60 %); la pista de software sube de nivel con ≥80 %.

**Añadir conversaciones:** edita `tools/build_talks.py` (un bloque `TALK(...)` con turnos `T` tutor, `C` comprensión, `Y` respuesta) y ejecuta `python3 tools/build_talks.py`. `npm test` valida que cada respuesta modelo se apruebe a sí misma y que el nivel exista. **Añadir niveles:** una línea en `data/levels.json`.

## Arquitectura (online + offline, solo para ti)
- **Frontend**: PWA offline-first. Todo funciona sin red; el progreso se guarda en el dispositivo y se sincroniza al volver la conexión (punto ● en la cabecera).
- **Backend** (`server/server.js`, Node ≥18, sin dependencias): sesión por contraseña única (cookie HttpOnly), sincronización `GET/PUT /api/state`, lector de RSS de podcasts con protección SSRF, copias diarias (7) y cabeceras de seguridad. Nada de la app se sirve sin sesión.
- **Fusión sin pérdidas** (`merge.js`, compartido): por palabra gana el repaso más reciente; puntajes = máximo; audios y exámenes = unión. Puedes usar teléfono y PC a la vez.
- **0 tokens**: no hay llamadas a IA en ningún punto.

## Ejecutar
```
APP_PASSWORD='tu-clave-larga' npm start        # http://localhost:8080
npm test                                        # pruebas: auth, sync, CSRF, SSRF, fusión, contenido y evaluador de voz
```
Variables: `APP_PASSWORD` (obligatoria, ≥8), `PORT`, `DATA_DIR` (por defecto `./storage`, ignorado por git), `COOKIE_SECURE=1` detrás de HTTPS.

**Despliegue en línea** (para el teléfono): cualquier VPS o servicio con Docker (`docker build -t mi-ingles . && docker run -p 8080:8080 -v ingles:/data -e APP_PASSWORD=... mi-ingles`) detrás de HTTPS (Caddy/Cloudflare Tunnel). En el móvil: abrir la URL → "Añadir a pantalla de inicio". Los datos viven en el volumen `/data`.
También funciona solo local con `python3 -m http.server` (sin sincronización ni login).

## Llegar a 9000 palabras
`data/vocab.json` trae una semilla (~100). Prepara un CSV `en,es,pos,level,example` y ejecuta:
```
python3 tools/import_vocab.py mi_lista.csv --merge
```
Niveles válidos: B1.1 B1.2 B2.1 B2.2 C1.1 C1.2 (`data/levels.json`).
El contenido de tu carpeta "ingles" de Drive puede convertirse a ese CSV una sola vez (así se gastan tokens una vez y se guarda el resultado).
