const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, game: "grena-contexto", platform: "cloudflare", multiplayer: "migration-in-progress" });
    }

    if (url.pathname === "/api/leaderboard") {
      const { results } = await env.DB.prepare(
        "SELECT id, name, games, wins, ROUND(100.0 * wins / MAX(games, 1), 1) AS rate FROM players WHERE games > 0 ORDER BY wins DESC, rate DESC LIMIT 50"
      ).all();
      return json(results);
    }

    const profileMatch = url.pathname.match(/^\/api\/profile\/([a-f0-9-]{36})$/i);
    if (profileMatch) {
      const id = profileMatch[1];
      const player = await env.DB.prepare(
        "SELECT id, name, games, wins, ROUND(100.0 * wins / MAX(games, 1), 1) AS rate, created_at FROM players WHERE id = ?"
      ).bind(id).first();
      if (!player) return json({ error: "No existe" }, 404);
      const position = await env.DB.prepare(
        "SELECT COUNT(*) + 1 AS n FROM players WHERE wins > ?"
      ).bind(player.wins).first();
      const { results: recent } = await env.DB.prepare(
        "SELECT word, at FROM wins WHERE player_id = ? ORDER BY id DESC LIMIT 10"
      ).bind(id).all();
      return json({ ...player, position: position.n, recent });
    }

    // The current browser client opens its WebSocket at the site root.
    // Do not silently accept it until the room protocol and semantic rank data
    // have been migrated to Durable Objects.
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return json({ error: "El servidor multijugador de Cloudflare todavía no está activado." }, 503);
    }

    return env.ASSETS.fetch(request);
  }
};

export class GameRooms {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch() {
    return json({ error: "GameRooms aún no está conectado al protocolo de partidas." }, 503);
  }
}
