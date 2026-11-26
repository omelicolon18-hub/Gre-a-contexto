# GREÑA CONTEXTO

Juego multijugador en tiempo real. Todos los jugadores intentan encontrar la misma palabra secreta; el servidor calcula posiciones por similitud semántica.

## Qué contiene este proyecto
- Salas privadas con código y enlace de invitación.
- Partidas de 2 a 10 jugadores.
- WebSockets para sincronización en tiempo real.
- Rondas, pistas, ranking de sala, WINS y estadísticas guardadas en SQLite.
- Interfaz web adaptable y modo stream para OBS.
- Aplicación de escritorio para Windows (Electron) que se conecta al servidor online.
- GitHub Actions para generar el instalador `.exe` automáticamente.

## 1. Publicar el juego online (Railway)
1. Sube este proyecto a un repositorio GitHub llamado `grena-contexto`.
2. En Railway crea un proyecto nuevo y elige **Deploy from GitHub Repo**.
3. Selecciona `grena-contexto`. Railway detectará el `Dockerfile`.
4. En el servicio añade un **Volume** montado en `/data`.
5. Configura `DB_PATH=/data/grena.db` y `PORT=3000` si Railway no los detecta automáticamente.
6. Despliega y espera a que termine el build. La primera construcción genera el vocabulario y descarga el modelo semántico; puede tardar varios minutos y consumir bastante memoria.
7. Genera un dominio público HTTPS en Railway. La dirección debe abrir el juego y `/api/health` debe responder `{"ok":true}`.

**Importante:** el servicio debe mantener un proceso Node/Docker activo, admitir WebSockets y conservar el volumen `/data`. No uses un hosting estático para el servidor.

## 2. Crear el instalador EXE
Después de subir el repositorio a GitHub:
1. Abre la pestaña **Actions**.
2. Entra en **Construir instalador de Windows**.
3. Pulsa **Run workflow**.
4. Cuando termine, abre la ejecución y descarga el artefacto `GRENA-CONTEXTO-WINDOWS`.
5. Dentro estará `GRENA-CONTEXTO-Setup-1.0.0.exe`.

Al abrir el programa, pega la URL HTTPS del servidor Railway. Se guardará en ese PC.

También se construye automáticamente cuando haces cambios en `desktop/`, `package.json` o el workflow en la rama `main`.

## 3. Probar localmente (modo web)
Requiere Node.js 20 e internet en la primera instalación:
```bash
npm install
npm run build-vocab
npm start
```
Abre `http://localhost:3000`.

## 4. Modo stream
Añade `?stream=1` a la URL para usar el diseño compacto de OBS. Horizontal: 1920x1080. Vertical: 1080x1920.

## 5. Seguridad y operación
- El repositorio público permite ver y descargar el código. No añadas colaboradores con permisos de escritura si quieres ser el único editor.
- No subas tokens, contraseñas ni archivos `.env`.
- Las salas están en memoria: si Railway reinicia el servidor, las partidas activas se pierden; los perfiles y WINS permanecen en SQLite si el volumen está montado.
- El instalador de Windows es un cliente de escritorio: necesita que el servidor online esté desplegado para jugar por internet.
- Antes de abrirlo al público, prueba dos cuentas en dos dispositivos y verifica la persistencia del volumen y los WebSockets.

## Stack
Node.js, Express, WebSockets, SQLite, `@huggingface/transformers`, embeddings multilingües y Electron.
