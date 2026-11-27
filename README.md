# GREÑA CONTEXTO

Juego multijugador en tiempo real: todos buscan la misma palabra secreta y el servidor calcula posiciones por similitud semántica.

## Incluye
- Salas privadas con código e invitación.
- Partidas de 2 a 10 jugadores.
- WebSockets en tiempo real.
- Rondas, pistas, ranking, WINS y estadísticas SQLite.
- Interfaz web adaptable y modo Stream para OBS (`?stream=1`).
- Cliente de escritorio Windows (Electron).
- GitHub Actions para pruebas y creación del instalador EXE.

## Publicar online (Railway)
1. Crea un proyecto en Railway con **Deploy from GitHub Repo**.
2. Selecciona `omelicolon18-hub/Gre-a-contexto`.
3. El repositorio incluye Dockerfile y configuración Railway.
4. Añade un Volume al servicio y móntalo en `/data`.
5. Configura `DB_PATH=/data/grena.db`. Railway asigna `PORT` automáticamente.
6. La primera construcción descarga el modelo de embeddings y genera 30.000 vectores; puede tardar y consumir memoria.
7. Genera un dominio HTTPS y verifica `/api/health` devuelve `ok: true`.

El servidor necesita un proceso Node/Docker persistente, WebSockets y volumen. El repositorio no puede crear el servicio ni dominio sin conectar la cuenta de Railway. Las salas están en memoria y se pierden si el servidor se reinicia; perfiles y WINS permanecen en SQLite con volumen persistente.

## Migración a Cloudflare (en preparación)

Se añadió una base inicial de Cloudflare Workers, D1 y Durable Objects:
- `wrangler.toml`: recursos y bindings previstos.
- `cloudflare/migrations/0001_initial.sql`: tablas de jugadores y victorias.
- `cloudflare/worker.js`: endpoints de salud, perfil y clasificación.
- `cloudflare/README.md`: estado y pasos técnicos.

**Importante:** esto todavía no sustituye al servidor Node actual. La conexión WebSocket y el motor de similitud semántica siguen pendientes de migración. El Worker responde 503 a las conexiones de juego para no presentar como funcional algo que aún no está terminado. No configures todavía el EXE para usar el Worker.

Cuando se conecte una cuenta Cloudflare habrá que crear la base D1, completar la migración de salas y vocabulario, desplegar y probar partidas entre dos dispositivos.

## Crear instalador EXE
1. Abre **Actions**.
2. Ejecuta **Construir instalador de Windows** con **Run workflow**.
3. Descarga el artefacto `GRENA-CONTEXTO-WINDOWS` cuando termine.
4. El instalador se llamará `GRENA-CONTEXTO-Setup-1.0.1.exe`.

El EXE es un cliente y necesita la URL HTTPS del servidor online.

## Ejecutar localmente
Requiere Node.js 20 o superior:
```bash
npm install
npm run build-vocab
npm start
```
Abre `http://localhost:3000`. Pruebas: `npm test`.

## Modo OBS
Añade `?stream=1` a la URL; se adapta a horizontal o vertical.

## Seguridad
- No añadas tokens, contraseñas ni archivos `.env`.
- No des permisos de escritura a usuarios que solo deban ver el repositorio.
- Prueba dos dispositivos, reconexión, ranking y persistencia antes de anunciarlo.

## Tecnologías
Node.js, Express, WebSockets, SQLite, Transformers y Electron.
