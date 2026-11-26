export const isProfileId = (value) => /^[a-f\d]{32}$/.test(value ?? '');

const bootstrapped = new WeakSet();

export async function backfillPlayerProfiles(db) {
  if (bootstrapped.has(db)) return;
  await db.prepare(`
    INSERT OR IGNORE INTO player_profile_accounts (platform, account_id)
    SELECT platform, account_id FROM (
      SELECT platform, account_id FROM player_rankings WHERE platform IN ('steam', 'xbox')
      UNION
      SELECT 'steam', account_id FROM steam_profile_details WHERE details IS NOT NULL
    ) AS known
    WHERE NOT EXISTS (
      SELECT 1 FROM player_profile_accounts AS account
      WHERE account.platform = known.platform AND account.account_id = known.account_id
    )
  `).run();
  bootstrapped.add(db);
}

export async function registerProfileAccount(db, platform, accountId) {
  if (!db || !accountId) return null;
  try {
    const lookup = db.prepare(`
      SELECT profile_id FROM player_profile_accounts WHERE platform = ? AND account_id = ?
    `).bind(platform, accountId);
    const existing = await lookup.first('profile_id');
    if (existing) return existing;
    await db.prepare(`
      INSERT OR IGNORE INTO player_profile_accounts (platform, account_id) VALUES (?, ?)
    `).bind(platform, accountId).run();
    return await lookup.first('profile_id');
  } catch (error) {
    console.error('Player profile registration failed', error.message);
    return null;
  }
}

// Only the site operator can supply this list, after verifying both accounts.
export async function applyVerifiedAccountLinks(db, configuration) {
  if (!configuration) return;
  const pairs = JSON.parse(configuration);
  if (!Array.isArray(pairs)) throw new Error('Invalid verified player links');
  const steamIds = new Set();
  const xboxIds = new Set();
  for (const pair of pairs) {
    const { steam, xbox } = pair ?? {};
    if (typeof steam !== 'string' || !/^7656\d{13}$/.test(steam) || steamIds.has(steam)
      || typeof xbox !== 'string' || !/^\d{1,20}$/.test(xbox) || xboxIds.has(xbox)) {
      throw new Error('Invalid or overlapping verified player links');
    }
    steamIds.add(steam);
    xboxIds.add(xbox);
  }
  for (const { steam, xbox } of pairs) {
    await db.batch([
      db.prepare(`
        INSERT OR IGNORE INTO player_profile_accounts (platform, account_id, profile_id)
        SELECT 'steam', ?, COALESCE(
          (SELECT profile_id FROM player_profile_accounts WHERE platform = 'xbox' AND account_id = ?
           AND profile_id NOT IN (SELECT profile_id FROM player_profile_accounts WHERE platform = 'steam')),
          lower(hex(randomblob(16)))
        )
      `).bind(steam, xbox),
      db.prepare(`
        INSERT OR IGNORE INTO player_profile_accounts (platform, account_id, profile_id)
        SELECT 'xbox', ?, profile_id FROM player_profile_accounts WHERE platform = 'steam' AND account_id = ?
      `).bind(xbox, steam),
      db.prepare(`
        INSERT OR IGNORE INTO player_profile_aliases (profile_id, canonical_id)
        SELECT xbox.profile_id, steam.profile_id
        FROM player_profile_accounts AS xbox JOIN player_profile_accounts AS steam
        WHERE xbox.platform = 'xbox' AND xbox.account_id = ?
          AND steam.platform = 'steam' AND steam.account_id = ?
          AND xbox.profile_id <> steam.profile_id
          AND NOT EXISTS (SELECT 1 FROM player_profile_accounts
            WHERE profile_id = xbox.profile_id AND platform = 'steam')
          AND NOT EXISTS (SELECT 1 FROM player_profile_accounts
            WHERE profile_id = steam.profile_id AND platform = 'xbox')
      `).bind(xbox, steam),
      db.prepare(`
        UPDATE player_profile_accounts
        SET profile_id = (SELECT canonical_id FROM player_profile_aliases WHERE profile_id = player_profile_accounts.profile_id)
        WHERE platform = 'xbox' AND account_id = ? AND profile_id IN (
          SELECT alias.profile_id FROM player_profile_aliases AS alias
          JOIN player_profile_accounts AS steam ON steam.profile_id = alias.canonical_id
          WHERE steam.platform = 'steam' AND steam.account_id = ?
        )
      `).bind(xbox, steam),
    ]);
  }
}

export async function resolvePlayerProfile(db, profileId, platform, id) {
  if (profileId) {
    return await db.prepare(`
      SELECT COALESCE(
        (SELECT canonical_id FROM player_profile_aliases WHERE profile_id = ?),
        (SELECT profile_id FROM player_profile_accounts WHERE profile_id = ? LIMIT 1)
      ) AS profile_id
    `).bind(profileId, profileId).first('profile_id');
  }
  const existing = await db.prepare(`
    SELECT profile_id FROM player_profile_accounts WHERE platform = ? AND account_id = ?
  `).bind(platform, id).first('profile_id');
  if (existing) return existing;
  const accountId = await db.prepare(`
    SELECT account_id FROM player_rankings
    WHERE platform = ? AND (account_id = ? OR player = ? COLLATE NOCASE)
      AND (unlocked IS NOT NULL OR minutes IS NOT NULL)
    GROUP BY account_id
    ORDER BY (account_id = ?) DESC, MAX(achievements_updated) DESC LIMIT 2
  `).bind(platform, id, id, id).all();
  const [match, secondMatch] = accountId.results;
  if (!match || (secondMatch && match.account_id !== id)) return null;
  return registerProfileAccount(db, platform, match.account_id);
}
