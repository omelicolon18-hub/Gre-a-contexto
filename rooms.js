import crypto from 'crypto';
import * as db from './db.js';
import * as vocab from './vocab.js';

const rooms = new Map();
const HINT_CLOSE = 300; // si nadie baja de esta posición en la fase 1, se da una pista
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const err = (ws, error) => send(ws, { t: 'error', error });

function newCode() {
  let c;
  do { c = Array.from({ length: 5 }, () => CHARS[crypto.randomInt(CHARS.length)]).join(''); } while (rooms.has(c));
  return c;
}

function cleanSettings(s = {}, cur = {}) {
  const o = { max: 6, time: 900, difficulty: 'medium', allowContinue: false, rounds: 3, publicRanking: true, publicWords: true, ...cur };
  if (s.max != null) o.max = Math.min(10, Math.max(2, s.max | 0));
  if (s.time != null) o.time = Math.min(3600, Math.max(0, s.time | 0));
  if (['easy', 'medium', 'hard'].includes(s.difficulty)) o.difficulty = s.difficulty;
  o.allowContinue = false; // gana solo una persona: al encontrar la palabra, la ronda termina
  if (s.rounds != null) o.rounds = Math.min(15, Math.max(1, s.rounds | 0));
  if (s.publicRanking != null) o.publicRanking = !!s.publicRanking;
  if (s.publicWords != null) o.publicWords = !!s.publicWords;
  return o;
}

function resetPlayer(p) { Object.assign(p, { guesses: [], seen: new Set(), best: Infinity, bestAt: 0, found: false, foundAt: null, inRound: false }); }

function view(room) {
  const playing = room.phase === 'playing';
  const players = [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, connected: p.connected, found: p.found, inRound: p.inRound,
    attempts: p.guesses.length, score: p.score,
    best: !playing || room.settings.publicRanking ? (p.best === Infinity ? null : p.best) : null,
  }));
  return {
    code: room.code, phase: room.phase, settings: room.settings, hostId: room.hostId, round: room.round,
    stage: room.stage || 1, hint: room.stage === 2 ? room.hint || null : null, vocabSize: room.L.size, endsAt: room.endsAt, now: Date.now(), players, feed: room.settings.publicWords ? (room.feed || []).slice(0, 40) : [], result: room.result || null,
  };
}

export function broadcast(room) {
  const v = view(room);
  for (const p of room.players.values()) {
    if (p.connected) send(p.ws, { t: 'state', room: v, me: { id: p.id, guesses: p.guesses } });
  }
}

function startRound(room) {
  clearTimeout(room.timer);
  const pool = room.L.secrets[room.settings.difficulty].filter((w) => !room.used.has(w));
  const list = pool.length ? pool : room.L.secrets[room.settings.difficulty];
  const secret = list[crypto.randomInt(list.length)];
  room.used.add(secret);
  room.secret = secret;
  room.rank = vocab.makeRanking(room.L, room.L.exact.get(secret));
  room.feed = []; room.round++; room.phase = 'playing'; room.winnerId = null; room.result = null; room.startedAt = Date.now();
  const ids = [];
  for (const p of room.players.values()) { resetPlayer(p); p.inRound = p.connected; if (p.inRound) ids.push(p.id); }
  db.addGames(ids);
  room.stage = 1; room.hint = null;
  schedule(room);
}

// Fase 1 (15 min) -> si nadie está cerca, pista -> Fase 2 (15 min) -> gana el más cercano
function schedule(room) {
  clearTimeout(room.timer);
  room.endsAt = room.settings.time ? Date.now() + room.settings.time * 1000 : 0;
  if (room.endsAt) room.timer = setTimeout(() => onPhaseEnd(room), room.settings.time * 1000);
  broadcast(room);
}

function onPhaseEnd(room) {
  if (room.phase !== 'playing') return;
  if (room.stage === 1) {
    room.stage = 2;
    const bestAll = Math.min(...[...room.players.values()].filter((p) => p.inRound).map((p) => p.best));
    room.hint = bestAll > HINT_CLOSE ? makeHint(room) : null;
    schedule(room);
  } else endRound(room);
}

function makeHint(room) {
  const taken = new Set();
  room.players.forEach((p) => p.seen.forEach((w) => taken.add(w)));
  const c = [];
  room.rank.forEach((rk, i) => { if (rk >= 15 && rk <= 60 && !taken.has(room.L.words[i])) c.push(i); });
  if (!c.length) return null;
  const i = c[crypto.randomInt(c.length)];
  return { word: room.L.words[i], rank: room.rank[i] };
}

function endRound(room) {
  if (room.phase !== 'playing') return;
  clearTimeout(room.timer);
  let byProximity = false;
  if (!room.winnerId) { // nadie la adivinó: gana el que más se acercó (en empate, quien llegó primero)
    const c = [...room.players.values()].filter((p) => p.inRound && p.best !== Infinity).sort((a, b) => a.best - b.best || a.bestAt - b.bestAt)[0];
    if (c) { room.winnerId = c.id; c.score++; db.addWin(c.id, room.code, room.secret); byProximity = true; }
  }
  const last = room.round >= room.settings.rounds;
  room.phase = last ? 'matchEnd' : 'roundEnd';
  const rows = [...room.players.values()].filter((p) => p.inRound).map((p) => ({
    id: p.id, name: p.name, found: p.found, foundAt: p.foundAt, attempts: p.guesses.length,
    best: p.best === Infinity ? null : p.best,
    top: [...p.guesses].sort((a, b) => a.rank - b.rank).slice(0, 5),
  })).sort((a, b) => (b.found - a.found) || ((a.foundAt ?? 1e12) - (b.foundAt ?? 1e12)) || ((a.best ?? 1e9) - (b.best ?? 1e9)));
  room.result = { word: room.secret, winnerId: room.winnerId, rows, round: room.round, byProximity, matchWinners: null };
  if (last) {
    const max = Math.max(...[...room.players.values()].map((p) => p.score));
    room.result.matchWinners = max > 0 ? [...room.players.values()].filter((p) => p.score === max).map((p) => p.id) : [];
  }
  room.endsAt = 0;
  broadcast(room);
}

function checkAllDone(room) {
  if (room.phase !== 'playing') return;
  const active = [...room.players.values()].filter((p) => p.inRound && p.connected);
  if (active.length === 0 || active.every((p) => p.found)) endRound(room);
}

function toLobby(room) {
  clearTimeout(room.timer);
  room.phase = 'lobby'; room.round = 0; room.result = null; room.endsAt = 0; room.secret = null; room.rank = null; room.used.clear();
  for (const [id, p] of room.players) { if (!p.connected) room.players.delete(id); p.score = 0; resetPlayer(p); }
  broadcast(room);
}

function attach(room, ws) {
  const u = ws.user;
  let p = room.players.get(u.id);
  if (!p) {
    p = { id: u.id, name: u.name, score: 0 }; resetPlayer(p); room.players.set(u.id, p);
  }
  if (p.ws && p.ws !== ws) { p.ws.room = null; send(p.ws, { t: 'left' }); }
  p.ws = ws; p.connected = true; p.name = u.name; ws.room = room.code;
  if (!room.players.get(room.hostId)?.connected) room.hostId = p.id;
  room.lastActive = Date.now();
}

export function handle(ws, m) {
  const room = ws.room ? rooms.get(ws.room) : null;
  const isHost = room && room.hostId === ws.user.id;
  switch (m.t) {
    case 'create': {
      leave(ws);
      const r = { code: newCode(), settings: cleanSettings(m.settings), players: new Map(), phase: 'lobby', round: 0,
        used: new Set(), L: vocab.load('es'), hostId: ws.user.id, endsAt: 0 };
      rooms.set(r.code, r); attach(r, ws); broadcast(r); break;
    }
    case 'join': {
      const r = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!r) return err(ws, 'Sala no encontrada. Revisa el código.');
      const already = r.players.has(ws.user.id);
      if (!already) {
        if (r.phase !== 'lobby') return err(ws, 'La partida ya empezó. Espera a la próxima.');
        if (r.players.size >= r.settings.max) return err(ws, 'La sala está llena.');
      }
      if (ws.room && ws.room !== r.code) leave(ws);
      attach(r, ws); broadcast(r); break;
    }
    case 'leave': leave(ws); send(ws, { t: 'left' }); break;
    default: {
      if (!room) return;
      if (m.t === 'guess') return guess(room, ws, m.word);
      if (!isHost) return err(ws, 'Solo el anfitrión puede hacer eso.');
      if (m.t === 'settings' && room.phase === 'lobby') {
        room.settings = cleanSettings(m.settings, room.settings);
        if (room.players.size > room.settings.max) room.settings.max = Math.min(10, room.players.size);
        broadcast(room);
      } else if (m.t === 'start' && room.phase === 'lobby') {
        if ([...room.players.values()].filter((p) => p.connected).length < 2) return err(ws, 'Se necesitan al menos 2 jugadores conectados.');
        startRound(room);
      } else if (m.t === 'next' && room.phase === 'roundEnd') startRound(room);
      else if (m.t === 'rematch' && room.phase === 'matchEnd') { room.players.forEach((p) => { p.score = 0; }); room.round = 0; room.used.clear(); startRound(room); }
      else if (m.t === 'endround') endRound(room);
      else if (m.t === 'cancel') toLobby(room);
    }
  }
}

function guess(room, ws, word) {
  const p = room.players.get(ws.user.id);
  if (room.phase !== 'playing' || !p || !p.inRound || p.found) return;
  const w = vocab.lookup(room.L, word);
  if (!w) return send(ws, { t: 'guess_error', error: 'No conozco esa palabra. Prueba con otra.' });
  if (p.seen.has(w.word)) return send(ws, { t: 'guess_error', error: 'Ya probaste esa palabra.' });
  const rank = room.rank[w.i];
  p.seen.add(w.word);
  p.guesses.push({ word: w.word, rank, n: p.guesses.length + 1 });
  if (rank < p.best) { p.best = rank; p.bestAt = Date.now(); }
  send(ws, { t: 'guess_ok', word: w.word, rank });
  room.feed.unshift({ id: p.id, name: p.name, word: w.word, rank });
  if (rank === 1) {
    p.found = true; p.foundAt = Date.now() - room.startedAt;
    if (!room.winnerId) { room.winnerId = p.id; p.score++; db.addWin(p.id, room.code, room.secret); }
    broadcast(room);
    if (!room.settings.allowContinue) endRound(room); else checkAllDone(room);
  } else broadcast(room);
}

function leave(ws) {
  const room = ws.room ? rooms.get(ws.room) : null;
  ws.room = null;
  if (!room) return;
  const p = room.players.get(ws.user.id);
  if (!p || p.ws !== ws) return;
  p.connected = false;
  if (room.phase === 'lobby') room.players.delete(p.id);
  afterLeave(room, p.id);
}

function afterLeave(room, id) {
  const conn = [...room.players.values()].filter((p) => p.connected);
  if (conn.length === 0) { room.lastActive = Date.now(); if (room.phase === 'lobby') rooms.delete(room.code); return; }
  if (room.hostId === id || !room.players.get(room.hostId)?.connected) room.hostId = conn[0].id;
  broadcast(room); checkAllDone(room);
}

export function disconnect(ws) {
  if (ws.user && ws.room) leave(ws);
}

setInterval(() => { // limpieza de salas abandonadas
  for (const [c, r] of rooms) {
    if (![...r.players.values()].some((p) => p.connected) && Date.now() - (r.lastActive || 0) > 10 * 60 * 1000) { clearTimeout(r.timer); rooms.delete(c); }
  }
}, 60 * 1000).unref();
