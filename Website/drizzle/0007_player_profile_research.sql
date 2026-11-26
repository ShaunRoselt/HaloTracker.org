CREATE TABLE player_profile_research (
  profile_id TEXT PRIMARY KEY NOT NULL,
  searched_at INTEGER NOT NULL CHECK (searched_at > 0)
);
