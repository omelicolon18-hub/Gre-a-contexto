const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const cleanName = (n) => String(n || "").replace(/[<>&"'\x60]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
const hash = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))))).map(x => x.toString(16).padStart(2, "0")).join("");

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      const checks = { roomsBinding: !!env.ROOMS, d1Binding: !!env.DB, assetsBinding: !!env.ASSETS };
      try {
        if (env.DB) {
          await env.DB.prepare("SELECT id FROM players LIMIT 1").all();
          checks.d1Ready = true;
        }
      } catch (e) { checks.d1Ready = false; checks.d1Error = String(e.message || e); }
      try {
        if (env.ASSETS) {
          const r = await env.ASSETS.fetch(new Request("https://assets.local/data/es/vocab.json"));
          checks.vocabulary = r.ok ? "available" : "missing";
          checks.vocabularyStatus = r.status;
        }
      } catch (e) { checks.vocabulary = "error"; checks.vocabularyError = String(e.message || e); }
      try {
        if (env.ROOMS) {
          const id = env.ROOMS.idFromName("global-room-router");
          const r = await env.ROOMS.get(id).fetch("https://rooms.local/__health");
          checks.durableObject = r.ok ? await r.json() : { ok: false, status: r.status };
        }
      } catch (e) { checks.durableObject = { ok: false, error: String(e.message || e) }; }
      const ok = checks.roomsBinding && checks.d1Binding && checks.assetsBinding && checks.d1Ready && checks.vocabulary === "available" && checks.durableObject?.ok;
      return json({ ok: !!ok, game: "grena-contexto", platform: "cloudflare", checks }, ok ? 200 : 503);
    }
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      try {
        if (!env.ROOMS) throw new Error("Falta el binding ROOMS en Cloudflare.");
        const id = env.ROOMS.idFromName("global-room-router");
        return await env.ROOMS.get(id).fetch(request);
      } catch (e) {
        console.error("WebSocket routing failed:", e);
        return json({ error: "No se pudo iniciar el servidor de salas.", detail: String(e.message || e) }, 503);
      }
    }
    if (url.pathname === "/api/leaderboard") {
      const { results } = await env.DB.prepare("SELECT id,name,games,wins,ROUND(100.0*wins/MAX(games,1),1) AS rate FROM players WHERE games>0 ORDER BY wins DESC,rate DESC LIMIT 50").all();
      return json(results);
    }
    const m = url.pathname.match(/^\/api\/profile\/([a-f0-9-]{36})$/i);
    if (m) {
      const p = await env.DB.prepare("SELECT id,name,games,wins,ROUND(100.0*wins/MAX(games,1),1) AS rate,created_at FROM players WHERE id=?").bind(m[1]).first();
      if (!p) return json({ error: "No existe" }, 404);
      const pos = await env.DB.prepare("SELECT COUNT(*)+1 AS n FROM players WHERE wins>?").bind(p.wins).first();
      const { results: recent } = await env.DB.prepare("SELECT word,at FROM wins WHERE player_id=? ORDER BY id DESC LIMIT 10").bind(m[1]).all();
      return json({ ...p, position: pos.n, recent });
    }
    return env.ASSETS.fetch(request);
  }
};

export class GameRooms {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.rooms = new Map(); this.users = new Map(); this.vocabPromise = null; }
  async vocabulary() {
    if (!this.vocabPromise) this.vocabPromise = (async () => {
      const get = async (p) => { const r = await this.env.ASSETS.fetch(new URL(p, "https://assets.local")); if (!r.ok) throw new Error("Faltan los recursos del vocabulario (" + p + ")."); return r; };
      const [wr, vr, sr] = await Promise.all([get("/data/es/vocab.json"), get("/data/es/vocab.f32"), get("/data/es/secrets.json")]);
      const words = await wr.json(), buf = await vr.arrayBuffer(), vecs = new Float32Array(buf), secrets = await sr.json();
      const dim = vecs.length / words.length;
      if (!words.length || !Number.isInteger(dim) || dim < 1) throw new Error("El vocabulario semántico está dañado.");
      const exact = new Map(), plain = new Map();
      words.forEach((w,i) => { exact.set(w,i); const k=w.normalize("NFD").replace(/n\u0303/g,"ñ").replace(/[\u0300-\u036f]/g,""); if(!plain.has(k)) plain.set(k,i); });
      return { words, vecs, dim, secrets, exact, plain, size: words.length };
    })();
    return this.vocabPromise;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__health") return json({ ok: true, durableObject: "GameRooms" });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ error: "WebSocket requerido" }, 426);
    const pair = new WebSocketPair(), client = pair[0], server = pair[1]; server.accept();
    const conn = { ws: server, user: null, room: null, last: 0, burst: 0 };
    server.addEventListener("message", e => this.message(conn, e.data).catch(err => this.send(conn,{t:"error",error:err.message || "Error del servidor."})));
    server.addEventListener("close", () => this.disconnect(conn));
    server.addEventListener("error", () => this.disconnect(conn));
    return new Response(null, { status: 101, webSocket: client });
  }
  send(c,o) { try { if(c.ws.readyState===1) c.ws.send(JSON.stringify(o)); } catch {} }
  async message(c, raw) {
    if (typeof raw !== "string" || raw.length > 4096) return;
    const now=Date.now(); c.burst=now-c.last>1000?0:c.burst+1; c.last=now; if(c.burst>15) return;
    let m; try { m=JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t!=="string") return;
    if (m.t==="auth") return this.auth(c,m);
    if (!c.user) return this.send(c,{t:"error",error:"No has iniciado sesión."});
    return this.handle(c,m);
  }
  async auth(c,m) {
    const name=cleanName(m.name); let u=null, token=null;
    if (m.token) u=await this.env.DB.prepare("SELECT id,name FROM players WHERE token_hash=?").bind(await hash(m.token)).first();
    if (!u) {
      if (!name) return this.send(c,{t:"error",error:"Escribe tu nombre."});
      token=Array.from(crypto.getRandomValues(new Uint8Array(24))).map(x=>x.toString(16).padStart(2,"0")).join("");
      u={id:crypto.randomUUID(),name};
      await this.env.DB.prepare("INSERT INTO players(id,token_hash,name,created_at) VALUES(?,?,?,?)").bind(u.id,await hash(token),name,Date.now()).run();
    } else if(name && name!==u.name) {
      await this.env.DB.prepare("UPDATE players SET name=? WHERE id=?").bind(name,u.id).run(); u.name=name;
    }
    c.user=u; this.send(c,{t:"auth_ok",user:u,token});
  }
  async handle(c,m) {
    const room=c.room?this.rooms.get(c.room):null, host=room && room.hostId===c.user.id;
    if(m.t==="create") {
      this.leave(c); const code=this.code();
      const r={code,settings:this.settings(m.settings),players:new Map(),phase:"lobby",round:0,used:new Set(),hostId:c.user.id,endsAt:0};
      this.rooms.set(code,r); this.attach(r,c); this.broadcast(r); return;
    }
    if(m.t==="join") {
      const r=this.rooms.get(String(m.code||"").toUpperCase().trim());
      if(!r) return this.send(c,{t:"error",error:"Sala no encontrada. Revisa el código."});
      if(!r.players.has(c.user.id) && r.phase!=="lobby") return this.send(c,{t:"error",error:"La partida ya empezó. Espera a la próxima."});
      if(!r.players.has(c.user.id) && r.players.size>=r.settings.max) return this.send(c,{t:"error",error:"La sala está llena."});
      if(c.room && c.room!==r.code) this.leave(c); this.attach(r,c); this.broadcast(r); return;
    }
    if(m.t==="leave") { this.leave(c); this.send(c,{t:"left"}); return; }
    if(!room) return;
    if(m.t==="guess") return this.guess(room,c,m.word);
    if(!host) return this.send(c,{t:"error",error:"Solo el anfitrión puede hacer eso."});
    if(m.t==="settings" && room.phase==="lobby") { room.settings=this.settings(m.settings,room.settings); room.settings.max=Math.max(room.players.size,room.settings.max); this.broadcast(room); }
    else if(m.t==="start" && room.phase==="lobby") { if([...room.players.values()].filter(p=>p.connected).length<2) return this.send(c,{t:"error",error:"Se necesitan al menos 2 jugadores conectados."}); await this.start(room); }
    else if(m.t==="next" && room.phase==="roundEnd") await this.start(room);
    else if(m.t==="rematch" && room.phase==="matchEnd") { room.players.forEach(p=>p.score=0); room.round=0; room.used.clear(); await this.start(room); }
    else if(m.t==="endround") await this.end(room);
    else if(m.t==="cancel") { room.phase="lobby"; room.round=0; room.result=null; room.endsAt=0; room.secret=null; room.rank=null; room.used.clear(); room.players.forEach(p=>{p.score=0;this.reset(p);}); this.broadcast(room); }
  }
  code() { const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s; do{s=Array.from({length:5},()=>chars[crypto.getRandomValues(new Uint8Array(1))[0]%chars.length]).join("");}while(this.rooms.has(s)); return s; }
  settings(s={},cur={}) { const o={max:6,time:900,difficulty:"medium",allowContinue:false,rounds:3,publicRanking:true,publicWords:true,...cur}; if(s.max!=null)o.max=Math.min(10,Math.max(2,s.max|0)); if(s.time!=null)o.time=Math.min(3600,Math.max(0,s.time|0)); if(["easy","medium","hard"].includes(s.difficulty))o.difficulty=s.difficulty; if(s.rounds!=null)o.rounds=Math.min(15,Math.max(1,s.rounds|0)); if(s.publicRanking!=null)o.publicRanking=!!s.publicRanking; if(s.publicWords!=null)o.publicWords=!!s.publicWords; o.allowContinue=false; return o; }
  reset(p) { Object.assign(p,{guesses:[],seen:new Set(),best:Infinity,bestAt:0,found:false,foundAt:null,inRound:false}); }
  attach(r,c) { let p=r.players.get(c.user.id); if(!p){p={id:c.user.id,name:c.user.name,score:0};this.reset(p);r.players.set(p.id,p);} if(p.conn&&p.conn!==c){p.conn.room=null;this.send(p.conn,{t:"left"});} p.conn=c;p.connected=true;p.name=c.user.name;c.room=r.code;if(!r.players.get(r.hostId)?.connected)r.hostId=p.id; }
  view(r) { const playing=r.phase==="playing"; return {code:r.code,phase:r.phase,settings:r.settings,hostId:r.hostId,round:r.round,stage:r.stage||1,hint:r.stage===2?r.hint||null:null,vocabSize:r.L?.size||10000,endsAt:r.endsAt,now:Date.now(),players:[...r.players.values()].map(p=>({id:p.id,name:p.name,connected:p.connected,found:p.found,inRound:p.inRound,attempts:p.guesses.length,score:p.score,best:!playing||r.settings.publicRanking?(p.best===Infinity?null:p.best):null})),feed:r.settings.publicWords?(r.feed||[]).slice(0,40):[],result:r.result||null}; }
  broadcast(r) { const v=this.view(r); for(const p of r.players.values())if(p.connected)this.send(p.conn,{t:"state",room:v,me:{id:p.id,guesses:p.guesses}}); }
  async start(r) {
    const L=await this.vocabulary(); r.L=L;
    const pool=L.secrets[r.settings.difficulty].filter(w=>!r.used.has(w)), list=pool.length?pool:L.secrets[r.settings.difficulty];
    r.secret=list[crypto.getRandomValues(new Uint32Array(1))[0]%list.length]; r.used.add(r.secret);
    const si=L.exact.get(r.secret); if(si===undefined)throw new Error("La palabra secreta no está en el vocabulario.");
    const sims=new Float32Array(L.size), off=si*L.dim;
    for(let i=0;i<L.size;i++){let d=0,o=i*L.dim;for(let k=0;k<L.dim;k++)d+=L.vecs[o+k]*L.vecs[off+k];sims[i]=d;}
    sims[si]=10; const order=Array.from({length:L.size},(_,i)=>i).sort((a,b)=>sims[b]-sims[a]); r.rank=new Int32Array(L.size);order.forEach((i,p)=>r.rank[i]=p+1);
    r.feed=[];r.round++;r.phase="playing";r.winnerId=null;r.result=null;r.startedAt=Date.now();r.players.forEach(p=>{this.reset(p);p.inRound=p.connected;});
    const ids=[...r.players.values()].filter(p=>p.inRound).map(p=>p.id); for(const id of ids)await this.env.DB.prepare("UPDATE players SET games=games+1 WHERE id=?").bind(id).run();
    r.stage=1;r.hint=null;this.schedule(r);
  }
  schedule(r) { if(r.timer)clearTimeout(r.timer);r.endsAt=r.settings.time?Date.now()+r.settings.time*1000:0;if(r.endsAt)r.timer=setTimeout(()=>{if(r.phase!=="playing")return;if(r.stage===1){r.stage=2;const best=Math.min(...[...r.players.values()].filter(p=>p.inRound).map(p=>p.best));r.hint=best>300?this.makeHint(r):null;this.schedule(r);}else this.end(r);},r.settings.time*1000);this.broadcast(r); }
  makeHint(r) { const taken=new Set();r.players.forEach(p=>p.seen.forEach(w=>taken.add(w)));const c=[];r.rank.forEach((rk,i)=>{if(rk>=15&&rk<=60&&!taken.has(r.L.words[i]))c.push(i);});if(!c.length)return null;const i=c[crypto.getRandomValues(new Uint32Array(1))[0]%c.length];return {word:r.L.words[i],rank:r.rank[i]}; }
  async win(p,r) { p.score++;await this.env.DB.prepare("UPDATE players SET wins=wins+1 WHERE id=?").bind(p.id).run();await this.env.DB.prepare("INSERT INTO wins(player_id,room,word,at) VALUES(?,?,?,?)").bind(p.id,r.code,r.secret,Date.now()).run(); }
  async end(r) {
    if(r.phase!=="playing")return;if(r.timer)clearTimeout(r.timer);let byProximity=false;
    if(!r.winnerId){const c=[...r.players.values()].filter(p=>p.inRound&&p.best!==Infinity).sort((a,b)=>a.best-b.best||a.bestAt-b.bestAt)[0];if(c){r.winnerId=c.id;await this.win(c,r);byProximity=true;}}
    const last=r.round>=r.settings.rounds;r.phase=last?"matchEnd":"roundEnd";
    const rows=[...r.players.values()].filter(p=>p.inRound).map(p=>({id:p.id,name:p.name,found:p.found,foundAt:p.foundAt,attempts:p.guesses.length,best:p.best===Infinity?null:p.best,top:[...p.guesses].sort((a,b)=>a.rank-b.rank).slice(0,5)})).sort((a,b)=>(b.found-a.found)||((a.foundAt??1e12)-(b.foundAt??1e12))||((a.best??1e9)-(b.best??1e9)));
    r.result={word:r.secret,winnerId:r.winnerId,rows,round:r.round,byProximity,matchWinners:null};
    if(last){const max=Math.max(...[...r.players.values()].map(p=>p.score));r.result.matchWinners=max>0?[...r.players.values()].filter(p=>p.score===max).map(p=>p.id):[];}
    r.endsAt=0;this.broadcast(r);
  }
  async guess(r,c,input) {
    const p=r.players.get(c.user.id);if(r.phase!=="playing"||!p||!p.inRound||p.found)return;
    const w=String(input||"").normalize("NFC").toLowerCase().trim();if(!/^[a-záéíóúüñ]{2,30}$/.test(w))return this.send(c,{t:"guess_error",error:"No conozco esa palabra. Prueba con otra."});
    const plain=x=>x.normalize("NFD").replace(/n\u0303/g,"ñ").replace(/[\u0300-\u036f]/g,"");
    const i=r.L.exact.has(w)?r.L.exact.get(w):r.L.plain.get(plain(w));if(i===undefined)return this.send(c,{t:"guess_error",error:"No conozco esa palabra. Prueba con otra."});
    const word=r.L.words[i];if(p.seen.has(word))return this.send(c,{t:"guess_error",error:"Ya probaste esa palabra."});
    const rank=r.rank[i];p.seen.add(word);p.guesses.push({word,rank,n:p.guesses.length+1});if(rank<p.best){p.best=rank;p.bestAt=Date.now();}
    this.send(c,{t:"guess_ok",word,rank});r.feed.unshift({id:p.id,name:p.name,word,rank});
    if(rank===1){p.found=true;p.foundAt=Date.now()-r.startedAt;if(!r.winnerId){r.winnerId=p.id;await this.win(p,r);}this.broadcast(r);await this.end(r);}else this.broadcast(r);
  }
  leave(c) { const code=c.room;c.room=null;if(!code)return;const r=this.rooms.get(code),p=r?.players.get(c.user?.id);if(!p||p.conn!==c)return;p.connected=false;if(r.phase==="lobby")r.players.delete(p.id);const active=[...r.players.values()].filter(x=>x.connected);if(!active.length){if(r.phase==="lobby")this.rooms.delete(code);return;}if(r.hostId===p.id||!r.players.get(r.hostId)?.connected)r.hostId=active[0].id;this.broadcast(r); }
  disconnect(c) { this.leave(c); }
}
