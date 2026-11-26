import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import * as db from './db.js';
import * as vocab from './vocab.js';
import * as rooms from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try { vocab.load('es'); } catch (e) {
  console.error('\n✖ Falta el vocabulario. Ejecuta primero:  npm run build-vocab\n'); process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.get('/api/health', (_, res) => res.json({ ok: true, game: 'grena-contexto', language: 'es', vocabulary: vocab.load('es').size }));
app.get('/api/leaderboard', (_, res) => res.json(db.leaderboard()));
app.get('/api/profile/:id', (req, res) => { const p = db.profile(req.params.id); p ? res.json(p) : res.status(404).json({ error: 'No existe' }); });
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 4096 });
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const cleanName = (n) => String(n || '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);

wss.on('connection', (ws) => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  let last = 0, burst = 0;
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    const now = Date.now(); burst = now - last > 1000 ? 0 : burst + 1; last = now;
    if (burst > 15) return; // anti-flood
    if (m.t === 'auth') {
      const name = cleanName(m.name);
      let u = m.token ? db.byToken(m.token) : null, token;
      if (!u) { if (!name) return send(ws, { t: 'error', error: 'Escribe tu nombre.' }); u = db.createPlayer(name); token = u.token; }
      else if (name && name !== u.name) { db.rename(u.id, name); u.name = name; }
      ws.user = { id: u.id, name: u.name };
      return send(ws, { t: 'auth_ok', user: ws.user, token });
    }
    if (!ws.user) return send(ws, { t: 'error', error: 'No has iniciado sesión.' });
    rooms.handle(ws, m);
  });
  ws.on('close', () => rooms.disconnect(ws));
});
setInterval(() => wss.clients.forEach((ws) => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }), 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`GREÑA CONTEXTO en http://localhost:${PORT}`));
