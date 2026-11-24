import { GAME_CONFIG, getAchievementsForGame, matchUnlocks } from './game-catalog.js';

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

export async function readLeaderboard(request, db) {
  if (request.method !== 'GET') return Response.json({ error: 'invalid-request' }, { status: 405 });
  const params = new URL(request.url).searchParams;
  const game = params.get('game') ?? 'all';
  const platform = params.get('platform') ?? 'all';
  const sort = params.get('sort') ?? 'unlocked';
  const order = new Map([
    ['rank', 'scores.rank'], ['player', 'identity.display_name COLLATE NOCASE'],
    ['platform', 'scores.platform'], ['unlocked', 'scores.unlocked'], ['minutes', 'scores.minutes'],
  ]).get(sort);
  const direction = params.get('direction') ?? (sort === 'rank' ? 'asc' : 'desc');
  if ((game !== 'all' && !GAME_CONFIG.has(game))
    || !['all', 'steam', 'xbox'].includes(platform) || !order || !['asc', 'desc'].includes(direction)) {
    return Response.json({ error: 'invalid-request' }, { status: 400 });
  }

  const collections = [...new Set([...GAME_CONFIG.values()].map(({ collection }) => collection))];
  const filter = game === 'all' ? `game IN (${collections.map(() => '?').join(', ')})` : 'game = ?';
  try {
    const { results } = await db.prepare(`
      WITH totals AS (
        SELECT platform, account_id, SUM(unlocked) AS unlocked, SUM(minutes) AS minutes,
          COUNT(unlocked) AS games_tracked, COUNT(minutes) AS games_with_time, MAX(MAX(achievements_updated, activity_updated)) AS updated_at
        FROM player_rankings
        WHERE ${filter} AND (? = 'all' OR platform = ?)
        GROUP BY platform, account_id
      ), scores AS (
        SELECT *, CASE WHEN unlocked IS NOT NULL THEN RANK() OVER (ORDER BY unlocked DESC) END AS rank
        FROM totals
      )
      SELECT scores.platform, scores.account_id AS accountId, identity.player,
        identity.display_name AS displayName, identity.avatar_url AS avatarUrl,
        scores.unlocked, scores.minutes, scores.rank, scores.games_with_time AS gamesWithTime,
        scores.games_tracked AS gamesTracked, scores.updated_at AS updatedAt
      FROM scores
      JOIN player_rankings AS identity ON identity.rowid = (
        SELECT rowid FROM player_rankings
        WHERE platform = scores.platform AND account_id = scores.account_id
        ORDER BY achievements_updated DESC, activity_updated DESC LIMIT 1
      )
      WHERE scores.unlocked IS NOT NULL OR scores.minutes IS NOT NULL
      ORDER BY (${order} IS NULL), ${order} ${direction.toUpperCase()}, identity.display_name COLLATE NOCASE, scores.platform, scores.account_id
      LIMIT 100
    `).bind(...(game === 'all' ? collections : [game]), platform, platform).all();
    return Response.json({ players: results }, { headers: { 'Cache-Control': 'no-store' } });
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
