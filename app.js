(() => {
(() => { // Modo stream: ?stream=1 o botón 📺. Se adapta solo a horizontal (16:9) y vertical (9:16)
  const b = document.body, f = () => b.classList.toggle('stream-v', innerHeight > innerWidth);
  if (new URLSearchParams(location.search).has('stream') || localStorage.grena_stream === '1') b.classList.add('stream');
  f(); addEventListener('resize', f);
})();
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app'), overlay = $('#overlay');
let ws, user = null, room = null, me = { guesses: [] }, view = 'home', skew = 0, pending = null, lastWord = null, shownResult = null;
const ls = localStorage;

function toast(msg, ok) { const t = $('#toast'); t.textContent = msg; t.className = 'show' + (ok ? ' ok' : ''); clearTimeout(toast.h); toast.h = setTimeout(() => (t.className = ''), 2600); }
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); else toast('Sin conexión. Reintentando…'); }

function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => { $('#conn').className = 'dot'; if (ls.grena_token) send({ t: 'auth', token: ls.grena_token, name: ls.grena_name || '' }); };
  ws.onclose = () => { $('#conn').className = 'dot off'; user = null; setTimeout(connect, 1500); };
  ws.onmessage = (e) => on(JSON.parse(e.data));
}
function ensureAuth(name, cb) {
  name = name.trim();
  if (!name) return toast('Escribe tu nombre primero.');
  ls.grena_name = name;
  if (user && user.name === name) return cb();
  pending = cb; send({ t: 'auth', token: ls.grena_token || '', name });
}

function on(m) {
  switch (m.t) {
    case 'auth_ok':
      user = m.user; if (m.token) ls.grena_token = m.token; ls.grena_name = user.name;
      if (pending) { const p = pending; pending = null; p(); }
      else if (!room && ls.grena_room) send({ t: 'join', code: ls.grena_room });
      break;
    case 'state':
      room = m.room; me = m.me; skew = room.now - Date.now(); ls.grena_room = room.code;
      if (view !== 'ranking' && view !== 'profile') view = 'room';
      render(); break;
    case 'left': room = null; delete ls.grena_room; view = 'home'; render(); break;
    case 'guess_ok': lastWord = m.word; if (m.rank === 1) confetti(); break;
    case 'guess_error': toast(m.error); { const g = $('.gin'); if (g) { g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake'); } } break;
    case 'error': toast(m.error); if (!room) delete ls.grena_room; break;
  }
}

const temp = (r) => (r === 1 ? '🏆' : r <= 10 ? '💥' : r <= 50 ? '🔥' : r <= 300 ? '😎' : r <= 1500 ? '🙂' : r <= 5000 ? '🥶' : '🧊');
const seen = new Set();
const isNew = (k) => (seen.has(k) ? '' : (seen.add(k), 'new'));
(() => { const fx = $('#fx'), E = ['🧠', '💬', '🔤', '✨', '🔥', '🎯', '⭐']; for (let i = 0; i < 16; i++) { const e = document.createElement('i'); e.textContent = E[i % E.length]; e.style.left = Math.random() * 100 + 'vw'; e.style.fontSize = 18 + Math.random() * 30 + 'px'; e.style.animationDuration = 14 + Math.random() * 18 + 's'; e.style.animationDelay = -Math.random() * 30 + 's'; fx.appendChild(e); } })();
const cls = (r) => (r <= 300 ? 'c-g' : r <= 1500 ? 'c-b' : 'c-p');
const pct = (r, n) => Math.max(3, Math.round(100 * (1 - Math.log(r) / Math.log(n))));
const isHost = () => room && room.hostId === user?.id;
const inviteUrl = () => `${location.origin}/?sala=${room.code}`;

function render() {
  if (view === 'ranking' || view === 'profile') return;
  if (view === 'room' && room) return renderRoom();
  overlay.hidden = true; app.dataset.k = 'home';
  const sala = new URLSearchParams(location.search).get('sala') || '';
  app.innerHTML = `
  <section class="hero"><h1>GREÑA<span>CONTEXTO</span></h1>
  <p>Todos buscan la misma palabra secreta. Cada intento te dice qué tan cerca está por significado. Gana quien la encuentre primero.</p></section>
  <div class="menu card">
    <input id="name" maxlength="16" placeholder="Tu nombre" value="${esc(ls.grena_name || '')}" autocomplete="nickname">
    <button class="primary" id="create">CREAR SALA</button>
    <div class="row"><input id="code" maxlength="5" placeholder="Código" value="${esc(sala.toUpperCase())}" style="text-transform:uppercase"><button id="join">UNIRSE A SALA</button></div>
  </div>`;
  $('#create').onclick = () => ensureAuth($('#name').value, () => send({ t: 'create' }));
  $('#join').onclick = () => { const c = $('#code').value.trim(); if (c.length < 5) return toast('El código tiene 5 caracteres.'); ensureAuth($('#name').value, () => send({ t: 'join', code: c })); };
  if (sala) $('#code').focus();
}

function renderRoom() {
  const key = room.phase === 'lobby' ? 'lobby' : 'game';
  if (app.dataset.k !== key) { app.dataset.k = key; key === 'lobby' ? buildLobby() : buildGame(); }
  key === 'lobby' ? updLobby() : updGame();
}

/* ---------- LOBBY ---------- */
function playerCards(game) {
  return (game ? [...room.players].sort((x, y) => (x.best ?? 1e9) - (y.best ?? 1e9)) : room.players).map((p) => {
    const st = !p.connected ? '' : game && p.inRound ? 'play' : 'on';
    const sub = game ? `${p.attempts} intentos${p.best ? ` · mejor #${p.best}` : ''}` : p.connected ? 'Conectado' : 'Desconectado';
    return `<div class="pc ${p.id === user.id ? 'me' : ''} ${p.found ? 'found' : ''}"><span class="st ${st}"></span>
      <div class="n">${p.id === room.hostId ? '<span class="crown">♛</span> ' : ''}${esc(p.name)}</div>
      <small>${p.found ? '¡Encontró la palabra!' : !p.connected && game ? 'Desconectado' : sub}</small>
      <small>🏆 ${p.score} WIN${p.score === 1 ? '' : 'S'}</small>
      ${game && room.settings.publicRanking && p.best ? `<div class="bar"><i class="${p.found ? 'g' : ''}" style="width:${pct(p.best, room.vocabSize)}%"></i></div>` : ''}</div>`;
  }).join('');
}
function buildLobby() {
  overlay.hidden = true;
  app.innerHTML = `<div class="grid2">
  <div class="card"><p class="hint" style="margin:0 0 .3rem;text-align:center">Código de sala</p><div class="code">${room.code}</div>
    <div class="row" style="margin:.8rem 0"><button id="copyC">Copiar código</button><button id="copyL">Copiar enlace</button></div>
    <h3 id="pt"></h3><div class="players" id="pl"></div></div>
  <div class="card"><h3>Configuración</h3><div class="set">
    <label>Jugadores máximos<input id="s_max" type="number" min="2" max="10"></label>
    <label>Rondas por partida<input id="s_rounds" type="number" min="1" max="15"></label>
    <label>Minutos por fase (0 = sin límite)<input id="s_time" type="number" min="0" max="60"></label>
    <p class="hint" style="margin:0">Fase 1: 15 min. Si nadie se acerca (mejor que #300), aparece una pista. Fase 2: otros 15 min; si nadie la adivina, gana quien más se acercó.</p>
    <label>Dificultad<select id="s_difficulty"><option value="easy">Fácil</option><option value="medium">Media</option><option value="hard">Difícil</option></select></label>
    <label class="chk"><input id="s_publicRanking" type="checkbox"> Ranking público (ver quién está más cerca)</label>
    <label class="chk"><input id="s_publicWords" type="checkbox"> Mostrar las palabras que escribe cada jugador</label>
  </div><div id="act" style="margin-top:1rem;display:grid;gap:.6rem"></div></div></div>`;
  $('#copyC').onclick = () => navigator.clipboard?.writeText(room.code).then(() => toast('Código copiado', 1));
  $('#copyL').onclick = () => { const u = inviteUrl(); (navigator.share ? navigator.share({ title: 'GREÑA CONTEXTO', url: u }).catch(() => {}) : navigator.clipboard.writeText(u).then(() => toast('Enlace copiado', 1))); };
  ['max', 'rounds', 'time', 'difficulty', 'publicRanking', 'publicWords'].forEach((k) => {
    $('#s_' + k).onchange = (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; send({ t: 'settings', settings: { [k]: e.target.type === 'number' ? +v * (k === 'time' ? 60 : 1) : v } }); };
  });
}
function updLobby() {
  const s = room.settings, h = isHost();
  $('#pt').textContent = `Jugadores (${room.players.length}/${s.max})`;
  $('#pl').innerHTML = playerCards(false);
  for (const k of ['max', 'rounds', 'time', 'difficulty', 'publicRanking', 'publicWords']) {
    const el = $('#s_' + k); el.disabled = !h;
    if (document.activeElement === el) continue;
    el.type === 'checkbox' ? (el.checked = s[k]) : (el.value = k === 'time' ? s[k] / 60 : s[k]);
  }
  $('#act').innerHTML = (h ? '<button class="go" id="start">INICIAR PARTIDA</button>' : '<p class="hint">Esperando a que el anfitrión inicie…</p>') + '<button class="ghost" id="leave">Salir de la sala</button>';
  if (h) $('#start').onclick = () => send({ t: 'start' });
  $('#leave').onclick = () => send({ t: 'leave' });
}

/* ---------- JUEGO ---------- */
function buildGame() {
  app.innerHTML = `<div class="hud"><span id="rd"></span><span class="timer" id="tm"></span><span id="rc" class="hint"></span></div>
  <div class="game"><div>
    <div id="hb"></div><form class="gin" id="gf" autocomplete="off"><input id="gw" placeholder="Escribe una palabra…" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="30"><button class="go" type="submit">Probar</button></form>
    <p class="hint" id="info"></p><div id="gl"></div></div>
  <aside class="card"><h3>Jugadores</h3><div class="players" id="pl" style="grid-template-columns:1fr"></div><h3 style="margin-top:1rem" id="fh">En vivo</h3><div id="feed" style="max-height:280px;overflow-y:auto"></div><div id="hc" style="margin-top:1rem;display:grid;gap:.5rem"></div></aside></div>`;
  $('#gf').onsubmit = (e) => { e.preventDefault(); const i = $('#gw'), w = i.value.trim(); if (!w) return; send({ t: 'guess', word: w }); i.value = ''; i.focus(); };
  $('#gw').focus();
}
function gRow(g, last) { return `<div class="g ${cls(g.rank)} ${last ? 'last' : ''}"><i style="width:${pct(g.rank, room.vocabSize)}%"></i><span>${esc(g.word)}</span><span class="r">#${g.rank} <b class="${g.rank <= 50 ? 'hot' : ''}">${temp(g.rank)}</b></span></div>`; }
function updGame() {
  const playing = room.phase === 'playing', gs = me.guesses;
  $('#rd').textContent = `Ronda ${room.round}/${room.settings.rounds}` + (playing ? ` · Fase ${room.stage}/2` : '');
  $('#hb').innerHTML = !playing ? '' : room.hint ? `<div class="card" style="margin-bottom:.8rem;border-color:var(--yel)"><b>💡 Pista:</b> la palabra secreta está cerca de <b class="hot">${esc(room.hint.word)}</b> <span class="r c-g">#${room.hint.rank}</span></div>` : room.stage === 2 ? '<p class="hint">Última fase: si nadie la adivina, gana quien más se acercó.</p>' : '';
  if (room.hint && room.hint.word !== updGame.ph) { updGame.ph = room.hint.word; toast('💡 ¡Llegó una pista!', 1); }
  if (!room.hint) updGame.ph = null;
  $('#rc').textContent = `Sala ${room.code}`;
  $('#pl').innerHTML = playerCards(true);
  $('#fh').style.display = room.settings.publicWords ? '' : 'none';
  $('#feed').innerHTML = (room.feed || []).map((f) => `<div class="g ${cls(f.rank)} ${isNew(f.id + f.word)}"><i style="width:${pct(f.rank, room.vocabSize)}%"></i><span>${f.id === user.id ? '<b>Tú</b>' : esc(f.name)} · ${esc(f.word)}</span><span class="r">#${f.rank} ${temp(f.rank)}</span></div>`).join('');
  const found = gs.some((g) => g.rank === 1), best = gs.length ? Math.min(...gs.map((g) => g.rank)) : null;
  $('#gf').style.display = playing && !found ? '' : 'none';
  $('#info').textContent = found ? '¡La encontraste! Espera a que termine la ronda.' : gs.length ? `${gs.length} intentos · tu mejor posición: #${best}` : 'Cuanto menor el número, más cerca estás. #1 es la palabra secreta.';
  const sorted = [...gs].sort((a, b) => a.rank - b.rank), last = gs.find((g) => g.word === lastWord);
  $('#gl').innerHTML = (last ? gRow(last, true) : '') + sorted.filter((g) => g !== last).map((g) => gRow(g)).join('');
  const h = isHost();
  $('#hc').innerHTML = h && playing ? '<button id="er">Terminar ronda</button><button id="ca" class="ghost">Cancelar partida</button>' : (!playing && h ? '<button id="ca" class="ghost">Volver al lobby</button>' : '<button id="lv" class="ghost">Salir de la sala</button>');
  if ($('#er')) $('#er').onclick = () => send({ t: 'endround' });
  if ($('#ca')) $('#ca').onclick = () => confirm('¿Cancelar la partida y volver al lobby?') && send({ t: 'cancel' });
  if ($('#lv')) $('#lv').onclick = () => send({ t: 'leave' });
  if (!playing && room.result) showResult(); else { overlay.hidden = true; shownResult = null; }
}
function showResult() {
  const r = room.result, key = room.code + r.round + r.word;
  const winner = room.players.find((p) => p.id === r.winnerId), end = room.phase === 'matchEnd';
  const mw = end ? (r.matchWinners || []).map((id) => room.players.find((p) => p.id === id)?.name).filter(Boolean) : [];
  const rows = r.rows.map((x) => `<div class="g ${x.found ? 'c-g' : 'c-p'}"><span>${esc(x.name)}</span><span class="r">${x.found ? '✔ ' + (x.foundAt / 1000).toFixed(1) + 's · ' + x.attempts + ' int.' : x.best ? 'mejor #' + x.best : 'sin intentos'}</span></div>`).join('');
  const board = [...room.players].sort((a, b) => b.score - a.score).map((p) => `<div class="g"><span>${esc(p.name)}</span><span class="r">${p.score} WIN${p.score === 1 ? '' : 'S'}</span></div>`).join('');
  const h = isHost();
  overlay.hidden = false;
  overlay.innerHTML = `<div class="rays"></div><div class="res card">
    <div class="crownbig">${winner ? '👑' : '⌛'}</div>
    <h2 class="slam">${end ? (mw.length ? 'Campeón: ' + esc(mw.join(' y ')) : 'Partida terminada') : winner ? esc(winner.name) + (r.byProximity ? ' ganó por ser el más cercano' : ' ganó la ronda') : 'Se acabó el tiempo'}</h2>
    <p class="hint">La palabra era</p><div class="w">${esc(r.word)}</div>
    <div class="rows">${rows}</div><h3>WINS</h3><div class="rows">${board}</div>
    ${h ? (end ? '<button class="go" id="nx" style="width:100%">REVANCHA</button>' : '<button class="go" id="nx" style="width:100%">SIGUIENTE RONDA</button>') + '<button class="ghost" id="bk" style="width:100%;margin-top:.5rem">Volver al lobby</button>' : '<p class="hint">Esperando al anfitrión…</p><button class="ghost" id="lv2">Salir de la sala</button>'}</div>`;
  if (h) { $('#nx').onclick = () => send({ t: end ? 'rematch' : 'next' }); $('#bk').onclick = () => send({ t: 'cancel' }); }
  else $('#lv2').onclick = () => send({ t: 'leave' });
  if (shownResult !== key) { shownResult = key; if (winner) { confetti(); document.body.classList.add('shakescreen'); setTimeout(() => document.body.classList.remove('shakescreen'), 700); } }
}
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#b66dff', '#3dff9e', '#4cc9ff', '#ffe14d', '#ff5fa2'];
  for (let i = 0; i < 18; i++) { const d = document.createElement('i'); d.className = 'er'; d.textContent = ['🎉', '👑', '🔥', '⭐', '🏆'][i % 5]; d.style.left = Math.random() * 100 + 'vw'; d.style.animationDuration = 2.2 + Math.random() * 2 + 's'; d.style.animationDelay = Math.random() * .8 + 's'; document.body.appendChild(d); setTimeout(() => d.remove(), 5500); }
  for (let i = 0; i < 90; i++) { const d = document.createElement('i'); d.className = 'cf'; d.style.left = Math.random() * 100 + 'vw'; d.style.background = colors[i % 5]; d.style.animationDuration = 1.8 + Math.random() * 2 + 's'; d.style.animationDelay = Math.random() * .6 + 's'; document.body.appendChild(d); setTimeout(() => d.remove(), 4800); }
}
setInterval(() => {
  const t = $('#tm'); if (!t || !room) return;
  if (room.phase !== 'playing') { t.textContent = ''; return; }
  if (!room.endsAt) { t.textContent = '∞'; return; }
  const s = Math.max(0, Math.ceil((room.endsAt - skew - Date.now()) / 1000));
  t.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); t.className = 'timer' + (s <= 15 ? ' low' : '');
}, 250);

/* ---------- RANKING / PERFIL ---------- */
async function showRanking() {
  view = 'ranking'; overlay.hidden = true; app.dataset.k = 'rank';
  app.innerHTML = '<div class="card"><h2>Ranking global</h2><p class="hint">Cargando…</p></div>';
  try {
    const rows = await (await fetch('/api/leaderboard')).json();
    app.innerHTML = `<div class="card"><h2>Ranking global</h2>${rows.length ? `<table><tr><th>#</th><th>Jugador</th><th>Victorias</th><th>Partidas</th><th>Éxito</th></tr>${rows.map((r, i) => `<tr class="link" data-id="${r.id}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.wins}</td><td>${r.games}</td><td>${r.rate}%</td></tr>`).join('')}</table>` : '<p class="hint">Aún no hay partidas jugadas. Crea una sala y sé el primero.</p>'}<button id="back" style="margin-top:1rem">Volver</button></div>`;
    app.querySelectorAll('tr.link').forEach((tr) => (tr.onclick = () => showProfile(tr.dataset.id)));
    $('#back').onclick = back;
  } catch { toast('No se pudo cargar el ranking.'); }
}
async function showProfile(id) {
  id = id || user?.id; if (!id) return toast('Entra con tu nombre para ver tu perfil.');
  view = 'profile'; overlay.hidden = true; app.dataset.k = 'prof';
  try {
    const p = await (await fetch('/api/profile/' + id)).json();
    if (p.error) throw 0;
    app.innerHTML = `<div class="card" style="max-width:560px;margin:auto"><h2>${esc(p.name)}</h2><p class="hint">Puesto #${p.position} del ranking global</p>
    <div class="stat"><div><b>${p.games}</b>partidas</div><div><b>${p.wins}</b>victorias</div><div><b>${p.rate}%</b>éxito</div></div>
    <h3>Últimas victorias</h3>${p.recent.length ? p.recent.map((w) => `<div class="g"><span>${esc(w.word)}</span><span class="hint">${new Date(w.at).toLocaleDateString()}</span></div>`).join('') : '<p class="hint">Todavía sin victorias.</p>'}
    <button id="back" style="margin-top:1rem">Volver</button></div>`;
    $('#back').onclick = back;
  } catch { toast('Perfil no encontrado.'); back(); }
}
function back() { view = room ? 'room' : 'home'; app.dataset.k = ''; render(); }

$('#goHome').onclick = back;
$('#navRank').onclick = showRanking;
$('#navStream').onclick = () => { const on = document.body.classList.toggle('stream'); localStorage.grena_stream = on ? '1' : '0'; };
$('#navProf').onclick = () => showProfile();
render(); connect();
})();
