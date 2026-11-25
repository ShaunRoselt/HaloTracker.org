import { GAME_CONFIG, getAchievementsForGame, matchUnlocks } from './game-catalog.js';
import { applyVerifiedAccountLinks, backfillPlayerProfiles, isProfileId, resolvePlayerProfile } from './player-profiles.js';

export async function saveAchievementRanking(db, platform, game, profile, fetchedAt) {
  if (!db) return;
  const games = [...GAME_CONFIG].filter(([, config]) => config.collection === game).map(([id]) => id);
  const statement = db.prepare(`
    INSERT INTO player_rankings (
      platform, account_id, game, player, display_name, avatar_url, unlocked,
      reported, total, first_unlock_at, last_unlock_at, achievements_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (platform, account_id, game) DO UPDATE SET
      player = excluded.player, display_name = excluded.display_name,
      avatar_url = excluded.avatar_url, unlocked = excluded.unlocked,
      reported = excluded.reported, total = excluded.total,
      first_unlock_at = excluded.first_unlock_at, last_unlock_at = excluded.last_unlock_at,
      achievements_updated = excluded.achievements_updated
    WHERE excluded.achievements_updated >= player_rankings.achievements_updated
  `);
  const statements = games.flatMap((id) => {
    const catalog = getAchievementsForGame(id);
    const unlocks = matchUnlocks(catalog, profile.achievements);
    if (!unlocks.size) return [];
    const unlocked = [...unlocks.values()].filter(Boolean).length;
    return [statement.bind(
      platform, profile.accountId, id, profile.player, profile.displayName || profile.player,
      profile.avatarUrl, unlocked, unlocks.size, catalog.length,
      id === game ? profile.firstUnlockAt ?? null : null,
      id === game ? profile.lastUnlockAt ?? null : null, fetchedAt,
    )];
  });
  if (statements.length) await db.batch(statements);
}

export async function saveSteamActivity(db, account, games, fetchedAt) {
  if (!db || !Object.keys(games).length) return;
  const statement = db.prepare(`
    INSERT INTO player_rankings (
      platform, account_id, game, player, display_name, minutes, last_played, activity_updated
    ) VALUES ('steam', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (platform, account_id, game) DO UPDATE SET
      minutes = excluded.minutes, last_played = excluded.last_played,
      activity_updated = excluded.activity_updated
    WHERE excluded.activity_updated >= player_rankings.activity_updated
  `);
  await db.batch(Object.entries(games).map(([game, { minutes, lastPlayed }]) => statement.bind(
    account.id, game, account.player, account.displayName, minutes ?? null, lastPlayed ?? null, fetchedAt,
  )));
}

const collections = [...new Set([...GAME_CONFIG.values()].map(({ collection }) => collection))];

export async function readSavedProfile(request, db, verifiedLinks) {
  if (request.method !== 'GET') return Response.json({}, { status: 405 });
  const params = new URL(request.url).searchParams;
  const platform = params.get('platform');
  const id = params.get('id') ?? '';
  const profile = params.get('profile');
  if (profile !== null ? !isProfileId(profile) : (!['steam', 'xbox'].includes(platform) || !id || id.length > 160)) {
    return Response.json({}, { status: 400 });
  }
  try {
    await applyVerifiedAccountLinks(db, verifiedLinks);
    const profileId = await resolvePlayerProfile(db, profile, platform, id);
    const headers = { 'Cache-Control': 'no-store' };
    if (!profileId) return Response.json({ games: [], accounts: [] }, { headers });
    const [{ results: accounts }, { results: games }] = await db.batch([
      db.prepare(`
        SELECT account.platform, account.account_id AS accountId, COALESCE(ranking.player, account.account_id) AS player,
          COALESCE(ranking.display_name, account.account_id) AS displayName, ranking.avatar_url AS avatarUrl
        FROM player_profile_accounts AS account
        LEFT JOIN player_rankings AS ranking ON ranking.rowid = (
          SELECT rowid FROM player_rankings
          WHERE platform = account.platform AND account_id = account.account_id
            AND (unlocked IS NOT NULL OR minutes IS NOT NULL)
          ORDER BY achievements_updated DESC, activity_updated DESC LIMIT 1
        )
        WHERE account.profile_id = ?
        ORDER BY (account.platform = 'steam') DESC
      `).bind(profileId),
      db.prepare(`
        SELECT ranking.platform, ranking.account_id AS accountId, ranking.player,
          ranking.display_name AS displayName, ranking.avatar_url AS avatarUrl,
          game, unlocked, reported, total, minutes, last_played AS lastPlayed,
          first_unlock_at AS firstUnlockAt, last_unlock_at AS lastUnlockAt
        FROM player_profile_accounts AS account
        JOIN player_rankings AS ranking USING (platform, account_id)
        WHERE account.profile_id = ? AND game IN (${collections.map(() => '?').join(', ')})
          AND (unlocked IS NOT NULL OR minutes IS NOT NULL)
        ORDER BY achievements_updated DESC, activity_updated DESC
      `).bind(profileId, ...collections),
    ]);
    return Response.json({ profileId, accounts, games }, { headers });
  } catch (error) {
    console.error('Saved player profile lookup failed', error.message);
    return Response.json({}, { status: 503 });
  }
}

export async function readSteamFriendScores(db, accountIds) {
  if (!db || !accountIds.length) return [];
  const { results } = await db.prepare(`
    WITH friends AS (
      SELECT ids.value AS account_id, account.profile_id
      FROM json_each(?) AS ids
      LEFT JOIN player_profile_accounts AS account ON account.platform = 'steam' AND account.account_id = ids.value
    ), game_scores AS (
      SELECT friends.account_id, game, MAX(unlocked) AS unlocked, MAX(minutes) AS minutes
      FROM friends
      JOIN player_profile_accounts AS member USING (profile_id)
      JOIN player_rankings AS ranking ON ranking.platform = member.platform AND ranking.account_id = member.account_id
      WHERE game IN (${collections.map(() => '?').join(', ')})
      GROUP BY friends.account_id, game
    ), totals AS (
      SELECT account_id, SUM(unlocked) AS unlocked, SUM(minutes) AS minutes
      FROM game_scores GROUP BY account_id
    )
    SELECT friends.account_id AS accountId, friends.profile_id AS profileId, totals.unlocked, totals.minutes,
      sync.sync_after AS syncAfter
    FROM friends
    LEFT JOIN totals USING (account_id)
    LEFT JOIN steam_friend_sync AS sync USING (account_id)
  `).bind(JSON.stringify(accountIds), ...collections).all();
  return results;
}

export async function readLeaderboard(request, db, verifiedLinks) {
  if (request.method !== 'GET') return Response.json({ error: 'invalid-request' }, { status: 405 });
  const params = new URL(request.url).searchParams;
  const game = params.get('game') ?? 'all';
  const platform = params.get('platform') ?? 'all';
  const search = (params.get('search') ?? '').trim().normalize('NFC');
  const sort = params.get('sort') ?? 'unlocked';
  const order = new Map([
    ['rank', 'scores.rank'], ['player', 'identity.display_name COLLATE NOCASE'],
    ['platform', 'scores.platform'], ['unlocked', 'scores.unlocked'], ['minutes', 'scores.minutes'],
  ]).get(sort);
  const direction = params.get('direction') ?? (sort === 'rank' ? 'asc' : 'desc');
  if ((game !== 'all' && !GAME_CONFIG.has(game))
    || !['all', 'steam', 'xbox'].includes(platform) || !order || !['asc', 'desc'].includes(direction)
    || search.length > 100) {
    return Response.json({ error: 'invalid-request' }, { status: 400 });
  }

  const filter = game === 'all' ? `game IN (${collections.map(() => '?').join(', ')})` : 'game = ?';
  try {
    await backfillPlayerProfiles(db);
    await applyVerifiedAccountLinks(db, verifiedLinks);
    const { results } = await db.prepare(`
      WITH game_scores AS (
        SELECT profile_id, game, MAX(unlocked) AS unlocked, MAX(minutes) AS minutes,
          MAX(MAX(achievements_updated, activity_updated)) AS updated_at
        FROM player_rankings
        JOIN player_profile_accounts USING (platform, account_id)
        WHERE ${filter} AND (? = 'all' OR platform = ?)
        GROUP BY profile_id, game
      ), totals AS (
        SELECT profile_id, SUM(unlocked) AS unlocked, SUM(minutes) AS minutes,
          COUNT(unlocked) AS games_tracked, COUNT(minutes) AS games_with_time, MAX(updated_at) AS updated_at
        FROM game_scores
        GROUP BY profile_id
      ), accounts AS (
        SELECT DISTINCT profile_id, platform, account_id
        FROM player_rankings
        JOIN player_profile_accounts USING (platform, account_id)
        WHERE (unlocked IS NOT NULL OR minutes IS NOT NULL) AND (? = 'all' OR platform = ?)
      ), profiles AS (
        SELECT profile_id, MIN(platform) AS platform
        FROM accounts GROUP BY profile_id
      ), scores AS (
        SELECT profiles.profile_id, profiles.platform, COALESCE(totals.unlocked, 0) AS unlocked,
          totals.minutes, totals.games_with_time, totals.games_tracked, totals.updated_at,
          RANK() OVER (ORDER BY COALESCE(totals.unlocked, 0) DESC) AS rank
        FROM profiles
        LEFT JOIN totals USING (profile_id)
      )
      SELECT scores.profile_id AS profileId, scores.platform, account.account_id AS accountId, identity.player,
        identity.display_name AS displayName, identity.avatar_url AS avatarUrl,
        scores.unlocked, scores.minutes, scores.rank, scores.games_with_time AS gamesWithTime,
        scores.games_tracked AS gamesTracked, scores.updated_at AS updatedAt, (
          SELECT json_group_array(json_object('platform', member.platform, 'accountId', member.account_id, 'player', label.player))
          FROM accounts AS member
          JOIN player_rankings AS label ON label.rowid = (
            SELECT rowid FROM player_rankings
            WHERE platform = member.platform AND account_id = member.account_id
              AND (unlocked IS NOT NULL OR minutes IS NOT NULL)
            ORDER BY achievements_updated DESC, activity_updated DESC LIMIT 1
          )
          WHERE member.profile_id = scores.profile_id
        ) AS platformAccounts
      FROM scores
      JOIN accounts AS account USING (profile_id, platform)
      JOIN player_rankings AS identity ON identity.rowid = (
        SELECT rowid FROM player_rankings
        WHERE platform = account.platform AND account_id = account.account_id
          AND (unlocked IS NOT NULL OR minutes IS NOT NULL)
        ORDER BY achievements_updated DESC, activity_updated DESC LIMIT 1
      )
      WHERE EXISTS (
        SELECT 1 FROM accounts AS member JOIN player_rankings AS names USING (platform, account_id)
        WHERE member.profile_id = scores.profile_id
          AND (names.unlocked IS NOT NULL OR names.minutes IS NOT NULL)
          AND (INSTR(LOWER(names.display_name), LOWER(?)) > 0 OR INSTR(LOWER(names.player), LOWER(?)) > 0)
      )
      ORDER BY (${order} IS NULL), ${order} ${direction.toUpperCase()}, identity.display_name COLLATE NOCASE, scores.profile_id
      LIMIT 100
    `).bind(...(game === 'all' ? collections : [game]), platform, platform, platform, platform, search, search).all();
    const players = results.map((result) => ({ ...result, platformAccounts: JSON.parse(result.platformAccounts) }));
    return Response.json({ players }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Leaderboard query failed', error.message);
    return Response.json({ error: 'leaderboard-unavailable' }, { status: 503 });
  }
}

export async function clearPrivateRanking(db, platform, accountId, fetchedAt, game = null) {
  if (!db || !accountId) return;
  const games = [...GAME_CONFIG].filter(([, config]) => config.collection === game).map(([id]) => id);
  const filter = game === null ? '' : `AND game IN (${games.map(() => '?').join(', ')})`;
  if (game !== null && !games.length) return;
  await db.prepare(`
    UPDATE player_rankings
    SET unlocked = NULL, reported = NULL, total = NULL,
      first_unlock_at = NULL, last_unlock_at = NULL, achievements_updated = ?
    WHERE platform = ? AND account_id = ? ${filter} AND achievements_updated <= ?
  `).bind(fetchedAt, platform, accountId, ...games, fetchedAt).run();
  if (game === null) {
    await db.prepare(`
      UPDATE player_rankings
      SET minutes = NULL, last_played = NULL, activity_updated = ?
      WHERE platform = ? AND account_id = ? AND activity_updated <= ?
    `).bind(fetchedAt, platform, accountId, fetchedAt).run();
  }
}
