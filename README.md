# Mi Inglés — plataforma privada (PC + móvil)

PWA sin backend ni IA en tiempo de uso: **0 tokens**. Voz con las APIs del navegador (TTS y reconocimiento).

- **Niveles** B1.1 (arranque) → C1.2, con desbloqueo al dominar ≥70 % del nivel previo.
- **Vocabulario** con repetición espaciada (cajas 0-6): tarjetas, spelling (dictado) y listening.
- **Gramática** bilingüe con ejercicios · **Examen** de 20 preguntas · **Conversación** con voz.
- **Desarrollo de software**: diálogos por niveles (1-4); avanzas al superar ≥80 %.
- **Audios largos**: añade mp3 o RSS de podcasts; guarda posición, velocidad y notas.
- **Privacidad**: PIN local, `noindex`, datos solo en tu navegador, exportar/importar backup.

## Usar
```
python3 -m http.server 8000   # abre http://localhost:8000 ; en el móvil: "Añadir a pantalla de inicio"
```
Para usarla en el teléfono, aloja los archivos en un sitio **privado** (p. ej. Cloudflare Pages con Access, Netlify con contraseña, o tu red local). No la publiques en un GitHub Pages público.

## Llegar a 9000 palabras
`data/vocab.json` trae una semilla (~100). Prepara un CSV `en,es,pos,level,example` y ejecuta:
```
python3 tools/import_vocab.py mi_lista.csv --merge
```
Niveles válidos: B1.1 B1.2 B2.1 B2.2 C1.1 C1.2 (`data/levels.json`).
El contenido de tu carpeta "ingles" de Drive puede convertirse a ese CSV una sola vez (así se gastan tokens una vez y se guarda el resultado).
