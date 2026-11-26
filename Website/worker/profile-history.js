export function isPastDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value && date <= new Date();
}

export function validPublicHistory(value) {
  if (!isPastDate(value?.date) || value.date < '1990-01-01'
    || !['account-created', 'public-post', 'halo-achievement'].includes(value.kind)
    || typeof value.sourceUrl !== 'string' || value.sourceUrl.length > 2048 || !URL.canParse(value.sourceUrl)) return false;
  const url = new URL(value.sourceUrl);
  return url.protocol === 'https:' && !url.username && !url.password;
}

export function savePublicHistory(db, profileId, history, guard = '1', args = []) {
  return db.prepare(`
    INSERT INTO player_profile_history (profile_id, observed_date, source_kind, source_url)
    SELECT ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM player_profile_accounts WHERE profile_id = ?) AND ${guard}
    ON CONFLICT(profile_id) DO UPDATE SET
      observed_date = excluded.observed_date,
      source_kind = excluded.source_kind,
      source_url = excluded.source_url
    WHERE excluded.observed_date < player_profile_history.observed_date
    RETURNING observed_date AS date, source_kind AS kind, source_url AS sourceUrl
  `).bind(profileId, history.date, history.kind, new URL(history.sourceUrl).href, profileId, ...args);
}

export function readPublicHistory(db, platform, id) {
  return db.prepare(`
    WITH player AS (
      SELECT profile_id FROM player_profile_accounts WHERE platform = ? AND account_id = ?
    )
    SELECT observed_date AS date, source_kind AS kind, source_url AS sourceUrl
    FROM player_profile_history
    WHERE profile_id IN (
      SELECT profile_id FROM player
      UNION ALL
      SELECT profile_id FROM player_profile_aliases WHERE canonical_id IN (SELECT profile_id FROM player)
    )
    ORDER BY observed_date LIMIT 1
  `).bind(platform, id).first();
}
