CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,
  room TEXT,
  word TEXT,
  at INTEGER NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_players_leaderboard
  ON players(wins DESC, games DESC);

CREATE INDEX IF NOT EXISTS idx_wins_player
  ON wins(player_id, id DESC);
