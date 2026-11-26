import { applyVerifiedAccountLinks, backfillPlayerProfiles, isProfileId, resolvePlayerProfile } from './player-profiles.js';
import { readLimited } from './player-achievements.js';
import { isPastDate, savePublicHistory, validPublicHistory } from './profile-history.js';

const sevenDays = 7 * 24 * 60 * 60 * 1000;
const pageSize = 100;
const factColumns = new Map([
  ['countryCode', 'country_code'],
  ['jobTitle', 'job_title'],
  ['birthDate', 'birth_date'],
]);

const json = (body, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

const encoder = new TextEncoder();
function isAuthorized(request, token) {
  const authorization = request.headers.get('Authorization') ?? '';
  if (!token || authorization.length !== token.length + 7 || !authorization.startsWith('Bearer ')) return false;
  const supplied = encoder.encode(authorization.slice(7));
  const expected = encoder.encode(token);
  return supplied.length === expected.length && crypto.subtle.timingSafeEqual(supplied, expected);
}

async function listProfiles(db, verifiedAccounts, cursor, includeRecent) {
  if (cursor !== '' && !isProfileId(cursor)) return json({ error: 'invalid-cursor' }, 400);
  await backfillPlayerProfiles(db);
  await applyVerifiedAccountLinks(db, verifiedAccounts);
  const cutoff = Date.now() - sevenDays;
  const { results } = await db.prepare(`
    WITH page AS (
      SELECT DISTINCT profile_id FROM player_profile_accounts
      WHERE profile_id > ? ORDER BY profile_id LIMIT ?
    )
    SELECT page.profile_id AS profileId, (
      SELECT MAX(searched_at) FROM player_profile_research
      WHERE profile_id = page.profile_id OR profile_id IN (
        SELECT profile_id FROM player_profile_aliases WHERE canonical_id = page.profile_id
      )
    ) AS lastSearchedAt, (
      SELECT json_group_array(json_object(
        'platform', account.platform, 'accountId', account.account_id,
        'player', COALESCE(json_extract(steam.details, '$.account.player'), ranking.player, account.account_id),
        'displayName', COALESCE(json_extract(steam.details, '$.account.displayName'), ranking.display_name, account.account_id)
      ))
      FROM player_profile_accounts AS account
      LEFT JOIN player_rankings AS ranking ON ranking.rowid = (
        SELECT rowid FROM player_rankings WHERE platform = account.platform AND account_id = account.account_id
        ORDER BY achievements_updated DESC, activity_updated DESC LIMIT 1
      )
      LEFT JOIN steam_profile_details AS steam
        ON account.platform = 'steam' AND steam.account_id = account.account_id AND json_valid(steam.details)
      WHERE account.profile_id = page.profile_id
    ) AS accounts, (
      SELECT MIN(ranking.first_unlock_at)
      FROM player_profile_accounts AS account JOIN player_rankings AS ranking USING (platform, account_id)
      WHERE account.profile_id = page.profile_id AND ranking.first_unlock_at BETWEEN 1356998400 AND ?
    ) AS oldestHaloUnlockAt, (
      SELECT json_group_array(json_object('service', link.service, 'url', link.url))
      FROM player_profile_accounts AS account JOIN player_profile_links AS link USING (platform, account_id)
      WHERE account.profile_id = page.profile_id AND link.service <> 'email'
    ) AS links, EXISTS (
      SELECT 1 FROM player_profile_accounts AS account JOIN player_profile_facts AS facts USING (platform, account_id)
      WHERE account.profile_id = page.profile_id AND facts.birth_date IS NOT NULL AND facts.birth_date <> ''
    ) AS hasBirthDate
    FROM page ORDER BY page.profile_id
  `).bind(cursor, pageSize + 1, Math.floor(Date.now() / 1000)).all();
  const profiles = results.slice(0, pageSize).map(({ profileId, lastSearchedAt, accounts, oldestHaloUnlockAt, links, hasBirthDate }) => ({
    profileId,
    profileUrl: 'https://halotracker.org/?page=profile&player=' + profileId,
    lastSearchedAt,
    due: includeRecent || lastSearchedAt === null || lastSearchedAt <= cutoff,
    accounts: JSON.parse(accounts),
    links: JSON.parse(links),
    oldestHaloUnlockAt,
    hasBirthDate: Boolean(hasBirthDate),
  }));
  return json({ profiles, nextCursor: results.length > pageSize ? profiles.at(-1).profileId : null });
}

function validateUpdates(body) {
  if (!body || typeof body.profileId !== 'string' || !isProfileId(body.profileId)
    || !Array.isArray(body.links) || body.links.length > 25
    || !body.facts || typeof body.facts !== 'object' || Array.isArray(body.facts)
    || (body.publicHistory !== undefined && !validPublicHistory(body.publicHistory))) return false;

  const services = new Set();
  for (const link of body.links) {
    if (typeof link?.service !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(link.service)
      || services.has(link.service) || ['steam', 'xbox'].includes(link.service)
      || typeof link.url !== 'string' || link.url.length > 2048 || !URL.canParse(link.url)) return false;
    const url = new URL(link.url);
    if (url.username || url.password) return false;
    if (link.service === 'email') {
      const address = decodeURIComponent(url.pathname);
      if (url.protocol !== 'mailto:' || url.search || url.hash
        || !/^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/.test(address)) return false;
    } else if (url.protocol !== 'https:') return false;
    services.add(link.service);
  }
  for (const [field, value] of Object.entries(body.facts)) {
    if (field === 'countryCode' && typeof value === 'string' && /^[a-z]{2}$/.test(value)) continue;
    if (field === 'jobTitle' && typeof value === 'string' && value.trim() && value.length <= 160) continue;
    if (field === 'birthDate' && isPastDate(value)) continue;
    return false;
  }
  return true;
}

// Each write consults the same cutoff. The timestamp is written last in the
// transaction so concurrent audits can't add data or restart the cooldown.
const duePredicate = `NOT EXISTS (
  SELECT 1 FROM player_profile_research
  WHERE searched_at > ? AND profile_id IN (
    SELECT ? UNION ALL
    SELECT profile_id FROM player_profile_aliases WHERE canonical_id = ?
  )
)`;

async function completeResearch(request, db, includeRecent) {
  let updates;
  try {
    updates = JSON.parse(await readLimited(request, 64_000));
  } catch {
    return json({ error: 'invalid-json' }, 400);
  }
  if (!validateUpdates(updates)) return json({ error: 'invalid-updates' }, 400);
  const profileId = await resolvePlayerProfile(db, updates.profileId);
  if (!profileId) return json({ error: 'unknown-profile' }, 404);
  // Canonical profiles load Steam first when both accounts are linked.
  const account = await db.prepare(
    "SELECT platform, account_id FROM player_profile_accounts WHERE profile_id = ? ORDER BY platform LIMIT 1"
  ).bind(profileId).first();
  if (!account) return json({ error: 'unknown-profile' }, 404);

  const searchedAt = Date.now();
  const guard = includeRecent ? "1" : duePredicate;
  const dueArgs = includeRecent ? [] : [searchedAt - sevenDays, profileId, profileId];
  const { platform, account_id: accountId } = account;
  const normalizedLinks = updates.links.map(({ service, url }) => ({ service, url: new URL(url).href }));
  const links = db.prepare(`
    INSERT INTO player_profile_links (platform, account_id, service, url)
    SELECT ?, ?, json_extract(value, '$.service'), json_extract(value, '$.url')
    FROM json_each(?) WHERE ${guard}
    ON CONFLICT(platform, account_id, service) DO NOTHING RETURNING service, url
  `).bind(platform, accountId, JSON.stringify(normalizedLinks), ...dueArgs);
  const fields = Object.entries(updates.facts);
  const facts = fields.map(([field, value]) => {
    const column = factColumns.get(field);
    return db.prepare(`
      INSERT INTO player_profile_facts (platform, account_id, ${column})
      SELECT ?, ?, ? WHERE ${guard}
      ON CONFLICT(platform, account_id) DO UPDATE SET ${column} = excluded.${column}
      WHERE NULLIF(player_profile_facts.${column}, '') IS NULL
      RETURNING ${column} AS value
    `).bind(platform, accountId, value.trim(), ...dueArgs);
  });
  const completion = db.prepare(`
    INSERT INTO player_profile_research (profile_id, searched_at)
    SELECT ?, ? WHERE ${guard}
    ON CONFLICT(profile_id) DO UPDATE SET searched_at = excluded.searched_at
    RETURNING searched_at
  `).bind(profileId, searchedAt, ...dueArgs);
  const history = updates.publicHistory
    ? [savePublicHistory(db, profileId, updates.publicHistory, guard, dueArgs)]
    : [];
  const [addedLinks, ...otherResults] = await db.batch([links, ...facts, ...history, completion]);
  if (!otherResults.pop().results.length) return json({ profileId, status: 'skipped-recent' });
  const addedPublicHistory = history.length ? otherResults.pop().results[0] ?? null : null;
  const addedFacts = Object.fromEntries(fields.flatMap(([field], index) =>
    otherResults[index].results.map(({ value }) => [field, value])));
  return json({ profileId, status: 'completed', lastSearchedAt: searchedAt, addedLinks: addedLinks.results, addedFacts, addedPublicHistory });
}

// A history-only pass doesn't count as a complete social profile audit.
async function importPublicHistory(request, db) {
  let rows;
  try {
    rows = JSON.parse(await readLimited(request, 120_000));
  } catch {
    return json({ error: 'invalid-json' }, 400);
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > 40 || rows.some(
    row => typeof row?.profileId !== 'string' || !isProfileId(row.profileId) || !validPublicHistory(row.publicHistory),
  )) return json({ error: 'invalid-history' }, 400);
  const results = await db.batch(rows.map(({ profileId, publicHistory }) => savePublicHistory(db, profileId, publicHistory)));
  return json({ processed: rows.length, changed: results.reduce((count, result) => count + result.results.length, 0) });
}

export async function manageProfileResearch(request, env) {
  if (!isAuthorized(request, env.HALOTRACKER_PROFILE_RESEARCH_TOKEN)) return json({ error: 'unauthorized' }, 401);
  try {
    const params = new URL(request.url).searchParams;
    const includeRecent = params.get('includeRecent') === '1';
    if (request.method === 'GET') {
      const cursor = params.get('cursor') ?? '';
      return await listProfiles(env.DB, env.VERIFIED_PLAYER_ACCOUNTS, cursor, includeRecent);
    }
    if (request.method === 'POST') return await completeResearch(request, env.DB, includeRecent);
    if (request.method === 'PUT') return await importPublicHistory(request, env.DB);
    return json({ error: 'method-not-allowed' }, 405);
  } catch (error) {
    console.error('Profile research database operation failed', error.message);
    return json({ error: 'profile-research-unavailable' }, 503);
  }
}
