CREATE TABLE player_rankings (
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  game TEXT NOT NULL,
  player TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  unlocked INTEGER,
  reported INTEGER,
  total INTEGER,
  minutes INTEGER,
  first_unlock_at INTEGER,
  last_unlock_at INTEGER,
  last_played INTEGER,
  achievements_updated INTEGER NOT NULL DEFAULT 0,
  activity_updated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (platform, account_id, game)
);
--> statement-breakpoint
CREATE INDEX player_rankings_game ON player_rankings (game, platform);
