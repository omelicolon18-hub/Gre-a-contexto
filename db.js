import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const file = process.env.DB_PATH || path.join('data', 'grena.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new Database(file);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS wins (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL, room TEXT, word TEXT, at INTEGER NOT NULL);
`);
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

export function createPlayer(name) {
  const id = crypto.randomUUID(), token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO players (id,token_hash,name,created_at) VALUES (?,?,?,?)').run(id, hash(token), name, Date.now());
  return { id, name, token };
}
export const byToken = (t) => db.prepare('SELECT id,name FROM players WHERE token_hash=?').get(hash(t));
export const rename = (id, name) => db.prepare('UPDATE players SET name=? WHERE id=?').run(name, id);
export function addGames(ids) {
  const st = db.prepare('UPDATE players SET games=games+1 WHERE id=?');
  db.transaction(() => ids.forEach((i) => st.run(i)))();
}
export function addWin(id, room, word) {
  db.transaction(() => {
    db.prepare('UPDATE players SET wins=wins+1 WHERE id=?').run(id);
    db.prepare('INSERT INTO wins (player_id,room,word,at) VALUES (?,?,?,?)').run(id, room, word, Date.now());
  })();
}
export const leaderboard = () => db.prepare(
  `SELECT id,name,games,wins, ROUND(100.0*wins/MAX(games,1),1) AS rate FROM players
   WHERE games>0 ORDER BY wins DESC, rate DESC LIMIT 50`).all();
export function profile(id) {
  const p = db.prepare(`SELECT id,name,games,wins, ROUND(100.0*wins/MAX(games,1),1) AS rate, created_at FROM players WHERE id=?`).get(id);
  if (!p) return null;
  p.position = db.prepare('SELECT COUNT(*)+1 AS n FROM players WHERE wins>?').get(p.wins).n;
  p.recent = db.prepare('SELECT word,at FROM wins WHERE player_id=? ORDER BY id DESC LIMIT 10').all(id);
  return p;
}
