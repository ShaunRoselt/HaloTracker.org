CREATE TABLE player_profile_facts (
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  country_code TEXT,
  job_title TEXT,
  birth_date TEXT,
  PRIMARY KEY (platform, account_id)
);
