CREATE TABLE player_profile_accounts (
  platform TEXT NOT NULL CHECK (platform IN ('steam', 'xbox')),
  account_id TEXT NOT NULL,
  profile_id TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  PRIMARY KEY (platform, account_id),
  UNIQUE (profile_id, platform)
);
--> statement-breakpoint
CREATE TABLE player_profile_aliases (
  profile_id TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL CHECK (canonical_id <> profile_id)
);
--> statement-breakpoint
CREATE TRIGGER assign_profile_to_ranked_player AFTER INSERT ON player_rankings
WHEN NEW.platform IN ('steam', 'xbox')
BEGIN
  INSERT OR IGNORE INTO player_profile_accounts (platform, account_id)
  VALUES (NEW.platform, NEW.account_id);
END;
