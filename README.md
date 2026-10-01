# Mi Inglés — plataforma privada (PC + móvil)

PWA sin backend ni IA en tiempo de uso: **0 tokens**. Voz con las APIs del navegador (TTS y reconocimiento).

- **Niveles** B1.1 (arranque) → C1.2, con desbloqueo al dominar ≥70 % del nivel previo.
- **Vocabulario** con repetición espaciada (cajas 0-6): tarjetas, spelling (dictado) y listening.
- **Gramática** bilingüe con ejercicios · **Examen** de 20 preguntas · **Conversación** con voz.
- **Desarrollo de software**: diálogos por niveles (1-4); avanzas al superar ≥80 %.
- **Audios largos**: añade mp3 o RSS de podcasts; guarda posición, velocidad y notas.
- **Privacidad**: PIN local, `noindex`, datos solo en tu navegador, exportar/importar backup.

## Lectura con foto
Pestaña **Leer**: sube la foto de una página (galería, cámara, arrastrar o pegar con Ctrl+V) o pega un texto.
- **OCR local**: el texto se reconoce en tu dispositivo con Tesseract (`vendor/tesseract/`, ~11 MB, se guarda para usarlo sin conexión). La imagen nunca sale de tu equipo. Revisa y corrige el texto antes de guardarlo.
- **Escuchar**: una profesora lee el texto en voz alta y la palabra actual se resalta en vivo (con respaldo por tiempo si el navegador no envía eventos). Pausa, frase anterior/siguiente y velocidad. Toca cualquier palabra para ver su significado, o pregunta con el micrófono en español o inglés: «¿qué significa neighbour?», «what does this word mean», «repite», «sigue», «más lento».
- **Leer yo**: lees una frase en voz alta y se marca cada palabra (bien, parecida, otra palabra, omitida) con su pronunciación para repasar.
- **Mi turno**: cuentas el texto con tus palabras (hablado o escrito) y se corrigen gramática y ortografía, con la versión mejorada para escuchar.

**Límites que conviene saber**
- La voz es la que traiga tu navegador. No existe acento de Boston en las voces del navegador: se elige automáticamente la voz femenina estadounidense más natural disponible (en Microsoft Edge, las voces «Natural» como Aria, Jenny o Michelle son las mejores) y puedes cambiarla en «Voz y velocidad».
- La pronunciación se evalúa con el reconocimiento de voz del navegador: detecta palabras dichas distinto o no dichas, pero no mide el acento ni la entonación con precisión.
- El OCR funciona con texto impreso (no con letra manuscrita); la foto debe estar nítida y de frente.
- **Privacidad**: el significado de las palabras usa los servicios gratuitos dictionaryapi.dev y MyMemory (se envía solo la palabra, a través de tu servidor, y se guarda en caché); la corrección gramatical usa LanguageTool (se envía el texto de «Mi turno»). Sin conexión funcionan las palabras ya consultadas, tu vocabulario y reglas básicas de gramática.

## Interfaz
Sistema visual propio ("cabina de estudio de audio"): tinta y papel frío con cobalto y una señal caléndula, modo oscuro automático, tipografías alojadas en `fonts/` (Bricolage Grotesque + Instrument Sans) para que funcionen sin conexión. Las barras de ecualizador del logo se animan cuando la app habla o te escucha. Cinco pestañas en móvil (barra lateral en escritorio), iconos SVG (sin emojis), objetivos táctiles de 44 px, foco visible y respeto de "reducir movimiento".

## Contenido
14 conversaciones largas (B1.1 a B2.2; viajes, restaurantes, redes sociales, tecnología, salud, trabajo y desarrollo de software) y 539 palabras (`data/batches/`). Los niveles de conversación se desbloquean al completar la mitad del nivel anterior con 60 % o más.

## Conversaciones de escucha activa
Menú **Hablar** → conversaciones largas (8-10 minutos) por nivel y tema:
1. **Escuchas** al interlocutor (el texto está oculto; puedes ver texto/traducción, repetir o usar voz lenta).
2. **Preguntas de comprensión** sobre lo que oíste.
3. **Respondes con el micrófono** (o escribiendo). `judge.js` compara lo dicho con la respuesta modelo, sus alternativas y las *ideas clave* (con sinónimos): ✅ correcto, 🟡 casi (te dice qué idea falta), ❌ otra vez. Puedes reintentar y pedir pista.
4. Informe final por respuesta; el puntaje se guarda y se sincroniza.

El reconocimiento de voz lo hace el navegador (Chrome/Edge/Safari) y evalúa **qué dijiste**, no la calidad de tu pronunciación. La pista de software sube de nivel con ≥80 %.

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
