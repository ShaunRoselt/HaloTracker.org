CREATE TABLE player_profile_history (
  profile_id TEXT PRIMARY KEY NOT NULL,
  observed_date TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('account-created', 'public-post', 'halo-achievement')),
  source_url TEXT NOT NULL
);
