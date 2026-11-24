CREATE TABLE player_profile_links (
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  service TEXT NOT NULL,
  url TEXT NOT NULL,
  PRIMARY KEY (platform, account_id, service)
);
