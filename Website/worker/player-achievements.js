import { clearPrivateRanking, readSteamFriendScores, saveAchievementRanking, saveSteamActivity } from './player-rankings.js';

// Steam Community app IDs and Xbox title IDs identify the versions represented by the tracker.
const steamGames = new Map([
  ['halomcc', '976730'],
  ['haloinfinite', '1240440'],
  ['halowarsde', '459220'],
  ['halospartanstrike', '324570'],
  ['halospartanassault', '277430'],
  ['halocampaignevolved', '2806050'],
]);

const xboxGames = new Map([
  ['halomcc', '1144039928'],
  ['halo5', '219630713'],
  ['haloinfinite', '2043073184'],
  ['halowarsde', '1030018025'],
  ['halospartanstrike', '2122543949'],
  ['halospartanassault', '682562723'],
  ['halocampaignevolved', '2082978535'],
]);

const steamIdBase = 76561197960265728n;
const steamId64 = /^7656\d{13}$/;
const friendRefreshInterval = 60 * 60_000;
const steamVanity = /^[a-z\d_-]{2,64}$/i;
const xboxUserId = /^\d{1,20}$/;
const gamertag = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?: [\p{L}\p{M}\p{N}]+)*(?:#\d{1,6})?$/u;

class LookupError extends Error {
  constructor(code, status, retryAfter) {
    super(code);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const invalidPlayer = () => new LookupError('invalid-player', 400);
const unavailable = () => new LookupError('provider-unavailable', 502);
const missingData = () => new LookupError('no-game-data', 404);

export function steamProfilePath(player) {
  // SteamID2 and SteamID3 both encode the same 32-bit account number.
  const legacy = /^STEAM_[01]:([01]):(\d{1,10})$/i.exec(player);
  const account = /^\[?U:1:(\d{1,10})\]?$/i.exec(player);
  if (legacy || account) {
    const number = legacy ? 2n * BigInt(legacy[2]) + BigInt(legacy[1]) : BigInt(account[1]);
    if (number > 4294967295n) throw invalidPlayer();
    player = String(steamIdBase + number);
  }

  if (steamId64.test(player)) return '/profiles/' + player;
  if (steamVanity.test(player)) return '/id/' + player;

  let url;
  try {
    url = new URL(player.startsWith('steamcommunity.com/') ? 'https://' + player : player);
  } catch {
    throw invalidPlayer();
  }
  const path = /^\/(profiles|id)\/([a-z\d_-]{2,64})\/?$/i.exec(url.pathname);
  if (
    !['http:', 'https:'].includes(url.protocol) || url.host !== 'steamcommunity.com'
    || url.username || url.password || !path
    || (path[1] === 'profiles' && !steamId64.test(path[2]))
  ) {
    throw invalidPlayer();
  }
  return `/${path[1]}/${path[2]}`;
}

export function detectPlayerPlatforms(player) {
  // A Steam ID or profile link identifies Steam directly. Only bare names can
  // overlap, so look those up on both services when they fit both formats.
  let steam = false;
  try {
    steam = Boolean(steamProfilePath(player));
  } catch {
    // An Xbox-only Gamertag does not have a Steam profile path.
  }
  if (steam && (steamId64.test(player) || !steamVanity.test(player))) return ['steam'];
  const platforms = steam ? ['steam'] : [];
  if (player.length <= 48 && gamertag.test(player)) platforms.push('xbox');
  return platforms;
}

async function readLimited(message, maxBytes) {
  if (!message.body || Number(message.headers.get('Content-Length')) > maxBytes) {
    throw new RangeError('Invalid message size');
  }
  const reader = message.body.getReader();
  const decoder = new TextDecoder();
  let count = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      count += value.byteLength;
      if (count > maxBytes) {
        await reader.cancel();
        throw new RangeError('Message exceeds size limit');
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const xmlText = (xml, tag) => {
  const pattern = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${tag}>`);
  const match = pattern.exec(xml);
  if (!match) return '';
  return (match[1] ?? match[2].replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => entities[name])).trim();
};

export function parseSteamAchievements(xml, appId, requestedPath) {
  if (!/<\/playerstats>\s*$/.test(xml)) {
    const message = xmlText(xml, 'error');
    if (/not be found|not found/i.test(message)) throw new LookupError('player-not-found', 404);
    if (/private|permission/i.test(message)) throw new LookupError('private-achievements', 403);
    if (/no (stats|game stats)|does not own|has not played/i.test(message)) throw missingData();
    throw unavailable();
  }

  if (xmlText(xml, 'privacyState') !== 'public') throw new LookupError('private-achievements', 403);
  const player = /<player>([\s\S]*?)<\/player>/.exec(xml)?.[1];
  const id = player && xmlText(player, 'steamID64');
  if (
    !id || !steamId64.test(id)
    || (requestedPath.startsWith('/profiles/') && requestedPath !== '/profiles/' + id)
    || xmlText(xml, 'gameLink') !== 'https://steamcommunity.com/app/' + appId
  ) {
    throw unavailable();
  }

  const section = /<achievements>([\s\S]*?)<\/achievements>/.exec(xml)?.[1] ?? '';
  const achievements = [];
  let firstUnlockAt = null;
  let lastUnlockAt = null;
  const rowPattern = /<achievement\s+closed="([01])"[^>]*>([\s\S]*?)<\/achievement>/g;
  for (const [, closed, row] of section.matchAll(rowPattern)) {
    const name = xmlText(row, 'name');
    if (!name) continue;
    const unlocked = closed === '1';
    achievements.push({ name, unlocked });
    const timestamp = Number(xmlText(row, 'unlockTimestamp'));
    if (unlocked && Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp < 10_000_000_000) {
      firstUnlockAt = Math.min(firstUnlockAt ?? timestamp, timestamp);
      lastUnlockAt = Math.max(lastUnlockAt ?? timestamp, timestamp);
    }
  }
  if (achievements.length === 0) throw missingData();
  return {
    accountId: id,
    player: xmlText(player, 'customURL') || id,
    profileUrl: `https://steamcommunity.com/profiles/${id}/`,
    firstUnlockAt,
    lastUnlockAt,
    achievements,
  };
}

function avatarFrom(value, allowedHosts) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && allowedHosts.includes(url.host) && !url.username && !url.password) {
      return url.href;
    }
  } catch {
    // A missing or invalid image uses the initials in the header.
  }
  return null;
}

function steamIdentity(xml, id) {
  const player = xmlText(xml, 'customURL') || id;
  const allowedHosts = [
    'avatars.fastly.steamstatic.com', 'avatars.akamai.steamstatic.com',
    'avatars.cloudflare.steamstatic.com', 'steamcdn-a.akamaihd.net',
  ];
  return {
    id,
    player,
    displayName: xmlText(xml, 'steamID') || player,
    avatarUrl: avatarFrom(xmlText(xml, 'avatarFull'), allowedHosts)
      ?? avatarFrom(xmlText(xml, 'avatarIcon'), allowedHosts),
  };
}

async function steamProfileDetails(profileUrl) {
  try {
    const response = await fetch(profileUrl + '?xml=1', {
      headers: { Accept: 'application/xml' },
      redirect: 'manual',
      signal: AbortSignal.timeout(2_500),
    });
    if (response.ok) {
      const xml = await readLimited(response, 128_000);
      const id = new URL(profileUrl).pathname.split('/')[2];
      if (xmlText(xml, 'steamID64') === id) return steamIdentity(xml, id);
    }
  } catch {
    // Achievement results remain usable if Steam's separate profile request fails.
  }
  return null;
}

// Public Steam pages use stable account IDs. Optional profile data must
// never prevent the achievement lookup from working.
async function readSteamPage(url, maxBytes) {
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(4_500),
    });
    return response.ok ? await readLimited(response, maxBytes) : '';
  } catch {
    return '';
  }
}

function steamAvatarFrame(html) {
  const header = html.split('profile_header_badgeinfo', 1)[0];
  const frame = /<div class="profile_avatar_frame">([\s\S]*?)<\/div>/.exec(header)?.[1] ?? '';
  const hosts = ['shared.fastly.steamstatic.com', 'shared.akamai.steamstatic.com', 'shared.cloudflare.steamstatic.com'];
  const animated = /<img\b[^>]*\bsrc="([^"]+)"/i.exec(frame)?.[1];
  const countryCode = /class="header_location"[\s\S]{0,900}?\/countryflags\/([a-z]{2})\.gif/i.exec(header)?.[1];
  const still = /<source\b[^>]*prefers-reduced-motion[^>]*\bsrcset="([^"]+)"/i.exec(frame)?.[1];
  return {
    countryCode: countryCode?.toLowerCase() ?? null,
    avatarFrameUrl: avatarFrom(animated, hosts),
    avatarFrameStillUrl: avatarFrom(still, hosts),
  };
}

async function steamScreenshots(profileUrl, game, appId) {
  const galleryUrl = `${profileUrl}screenshots?appid=${appId}`;
  const html = await readSteamPage(galleryUrl, 450_000);
  const screenshots = [];
  const seen = new Set();
  const entries = html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi);
  for (const [, attributes, content] of entries) {
    if (!attributes.includes(`data-appid="${appId}"`)) continue;
    const id = /\bdata-publishedfileid="(\d{1,20})"/.exec(attributes)?.[1];
    const src = /<img\b[^>]*\bsrc="([^"]+)"/i.exec(content)?.[1]
      ?? /background-image:\s*url\('([^']+)'\)/i.exec(content)?.[1];
    const thumbnail = avatarFrom(src, ['images.steamusercontent.com', 'steamuserimages-a.akamaihd.net']);
    if (!id || !thumbnail || seen.has(id)) continue;
    const image = new URL(thumbnail);
    if (!image.pathname.startsWith('/ugc/')) continue;
    image.search = 'imw=480&ima=fit&impolicy=Letterbox&letterbox=false';
    seen.add(id);
    screenshots.push({ id, thumbnail: image.href });
    if (screenshots.length === 3) break;
  }
  return { game, galleryUrl, screenshots };
}

function publicSteamHours(xml) {
  const minutes = new Map();
  for (const [, game] of xml.matchAll(/<mostPlayedGame>([\s\S]*?)<\/mostPlayedGame>/g)) {
    const appId = xmlText(game, 'gameLink').match(/\/app\/(\d+)\/?$/)?.[1];
    const hours = xmlText(game, 'hoursOnRecord').replaceAll(',', '');
    if (appId && /^\d+(?:\.\d+)?$/.test(hours)) minutes.set(appId, Math.round(Number(hours) * 60));
  }
  return minutes;
}

async function steamOwnedGames(id, key) {
  if (!key) return [];
  const url = new URL('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/');
  url.searchParams.set('key', key);
  url.searchParams.set('input_json', JSON.stringify({
    steamid: id,
    include_played_free_games: true,
    appids_filter: [...steamGames.values()].map(Number),
  }));
  try {
    const games = JSON.parse(await readSteamPage(url, 128_000)).response?.games;
    return Array.isArray(games) ? games : [];
  } catch {
    return [];
  }
}

function steamPublicUrl(xml, profileUrl) {
  const vanity = xmlText(xml, 'customURL');
  return steamVanity.test(vanity) ? `https://steamcommunity.com/id/${vanity}/` : profileUrl;
}

function decodeSteamHtml(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, value) => {
    if (value[0] !== '#') return entities[value.toLowerCase()] ?? (value === 'nbsp' ? ' ' : entity);
    const hex = value[1].toLowerCase() === 'x';
    const code = Number.parseInt(value.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

export async function lookupSteamFriends(request, db) {
  if (request.method !== 'GET') return json({ error: 'invalid-request' }, 405);
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!steamId64.test(id)) return json({ error: 'invalid-player' }, 400);
  const profileUrl = `https://steamcommunity.com/profiles/${id}/`;
  const xml = await readSteamPage(profileUrl + '?xml=1', 128_000);
  if (xmlText(xml, 'steamID64') !== id || xmlText(xml, 'privacyState') !== 'public') {
    return json({ error: 'friends-unavailable' }, 404);
  }
  const html = await readSteamPage(steamPublicUrl(xml, profileUrl) + 'friends', 8_000_000);
  if (!html.includes('id="search_results"')) return json({ error: 'friends-unavailable' }, 404);

  const friends = new Map();
  for (const block of html.split(/<div\b[^>]*class="[^"]*\bfriend_block_v2\b[^"]*"[^>]*\bdata-steamid="/i).slice(1)) {
    const accountId = /^(7656\d{13})"/.exec(block)?.[1];
    const name = /class="friend_block_content"[^>]*>([\s\S]*?)<br\s*\/?\s*>/i.exec(block)?.[1];
    if (!accountId || !name) continue;
    const displayName = decodeSteamHtml(name.replace(/<[^>]*>/g, '').trim());
    if (!displayName) continue;
    const avatar = /class="player_avatar[^"]*"[^>]*>\s*<img\b[^>]*\bsrc="([^"]+)"/i.exec(block)?.[1];
    friends.set(accountId, {
      accountId,
      displayName,
      avatarUrl: avatarFrom(avatar, ['avatars.fastly.steamstatic.com', 'avatars.akamai.steamstatic.com', 'avatars.cloudflare.steamstatic.com']),
    });
  }
  try {
    const scores = await readSteamFriendScores(db, [...friends.keys()]);
    for (const { accountId, ...score } of scores) Object.assign(friends.get(accountId), score);
  } catch (error) {
    console.error('Steam friend scores lookup failed', error.message);
  }
  return json({ friends: [...friends.values()] });
}

async function steamGameReview(profileUrl, game, appId) {
  const url = `${profileUrl}recommended/${appId}/`;
  const html = await readSteamPage(url + '?l=english', 700_000);
  const body = /<div id="ReviewText"[^>]*>([\s\S]*?)<\/div>\s*<div id="ReviewEdit"/i.exec(html)?.[1];
  const rating = /<div class="ratingSummary">\s*(Recommended|Not Recommended)\s*<\/div>/i.exec(html)?.[1];
  if (!body || !rating) return null;
  const text = decodeSteamHtml(body.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]*>/g, '').trim());
  if (!text) return null;
  const playtime = /<div class="playTime">([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? '';
  const hours = /([\d,.]+) hrs? on record/i.exec(playtime)?.[1];
  return {
    game, url, text, recommended: rating.toLowerCase() === 'recommended',
    minutes: hours ? Math.round(Number(hours.replaceAll(',', '')) * 60) : null,
  };
}

function steamPageMetadata(xml, html) {
  const hosts = ['shared.fastly.steamstatic.com', 'shared.akamai.steamstatic.com', 'shared.cloudflare.steamstatic.com'];
  const video = /<video\b[^>]*class="[^"]*\bprofile_animated_background\b[^"]*"[^>]*>[\s\S]*?<\/video>/i.exec(html)?.[0] ?? '';
  const background = /<div class="[^"]*\bhas_profile_background\b[^"]*"[^>]*background-image:\s*url\(\s*['"]([^'"]+)/i.exec(html)?.[1]
    ?? /\bposter="([^"]+)"/i.exec(video)?.[1];
  const videoUrl = /\bsrc="([^"]+\.(?:webm|mp4)(?:\?[^"]*)?)"/i.exec(video)?.[1];
  const presence = xmlText(xml, 'onlineState');
  const status = xmlText(xml, 'stateMessage');
  const inGame = /<inGameInfo>([\s\S]*?)<\/inGameInfo>/i.exec(xml)?.[1] ?? '';
  const link = xmlText(inGame, 'gameLink') || xmlText(xml, 'gameLink');
  const appId = /\/app\/(\d+)/.exec(link)?.[1];
  const playing = ['in-game', 'ingame'].includes(presence);
  const currentGame = playing
    ? [...steamGames].find(([, id]) => id === appId
      || status.includes(`/app/${id}/`) || status.includes(`/app/${id}"`))?.[0]
    : null;
  const joined = Date.parse(xmlText(xml, 'memberSince') + ' UTC');
  return {
    backgroundUrl: avatarFrom(background, hosts),
    backgroundVideoUrl: avatarFrom(videoUrl, hosts),
    presence: playing ? 'online'
      : ['away', 'snooze'].includes(presence) || /^(?:currently )?(?:away|snooze|snoozing)$/i.test(status.replace(/<[^>]*>/g, '').trim()) ? 'away'
      : ['online', 'offline'].includes(presence) ? presence : null,
    currentGame: currentGame ?? null,
    joinedAt: Number.isFinite(joined) ? joined / 1000 : null,
  };
}

export async function lookupSteamProfile(request, env) {
  if (request.method !== 'GET') return json({ error: 'invalid-request' }, 405);
  const params = new URL(request.url).searchParams;
  const id = params.get('id') ?? '';
  const activityOnly = params.get('view') === 'activity';
  const appearanceOnly = params.get('view') === 'appearance';
  const fetchedAt = Date.now();
  if (!steamId64.test(id)) return json({ error: 'invalid-player' }, 400);
  const profileUrl = `https://steamcommunity.com/profiles/${id}/`;
  const xml = await readSteamPage(profileUrl + '?xml=1', 128_000);
  if (xmlText(xml, 'steamID64') !== id) return json({});
  if (!activityOnly && !appearanceOnly && env.DB) {
    try {
      await env.DB.prepare(`
        INSERT INTO steam_friend_sync (account_id, sync_after) VALUES (?, ?)
        ON CONFLICT (account_id) DO UPDATE SET sync_after = MAX(sync_after, excluded.sync_after)
      `).bind(id, Date.now() + friendRefreshInterval).run();
    } catch (error) {
      console.error('Steam profile refresh timestamp save failed', error.message);
    }
  }
  if (xmlText(xml, 'privacyState') !== 'public') {
    if (xmlText(xml, 'privacyState') === 'private') {
      try {
        await clearPrivateRanking(env.DB, 'steam', id, fetchedAt);
      } catch (error) {
        console.error('Private Steam ranking removal failed', error.message);
      }
    }
    return json({});
  }

  const identity = steamIdentity(xml, id);
  const communityUrl = steamPublicUrl(xml, profileUrl);
  if (appearanceOnly) return json(steamAvatarFrame(await readSteamPage(communityUrl, 900_000)));
  const [html, galleries, activity] = await Promise.all([
    activityOnly ? '' : readSteamPage(communityUrl, 900_000),
    activityOnly ? [] : Promise.all([...steamGames].map(([game, appId]) => steamScreenshots(communityUrl, game, appId))),
    steamActivity(xml, id, communityUrl, env),
  ]);
  const { games, reviews } = activity;
  try {
    await saveSteamActivity(env.DB, identity, games, fetchedAt);
  } catch (error) {
    console.error('Steam activity save failed', error.message);
  }
  if (activityOnly) return json({ games });
  return json({
    account: { ...identity, accountId: id, profileUrl, platform: 'steam' },
    location: xmlText(xml, 'location'),
    ...steamPageMetadata(xml, html),
    reviews: reviews.map(({ game, url, text, recommended }) => ({ game, url, text, recommended })),
    ...steamAvatarFrame(html),
    games,
    galleries: galleries.filter(({ screenshots }) => screenshots.length),
  });
}

async function steamActivity(xml, id, communityUrl, env) {
  const [ownedGames, reviews] = await Promise.all([
    steamOwnedGames(id, env.STEAM_WEB_API_KEY),
    Promise.all([...steamGames].map(([game, appId]) => steamGameReview(communityUrl, game, appId))),
  ]);
  const publicHours = publicSteamHours(xml);
  const games = {};
  for (const [game, appId] of steamGames) {
    const owned = ownedGames.find(({ appid }) => String(appid) === appId);
    const minutes = owned?.playtime_forever ?? reviews.find(review => review?.game === game)?.minutes ?? publicHours.get(appId);
    const lastPlayed = owned?.rtime_last_played;
    if (Number.isFinite(minutes) && minutes >= 0 || Number.isFinite(lastPlayed) && lastPlayed > 0) {
      games[game] = {
        ...(Number.isFinite(minutes) && minutes >= 0 ? { minutes } : {}),
        ...(Number.isFinite(lastPlayed) && lastPlayed > 0 && lastPlayed < 10_000_000_000 ? { lastPlayed } : {}),
      };
    }
  }
  return { games, reviews: reviews.filter(Boolean) };
}

async function steamAchievements(player, appId, signal, identity) {
  const profile = steamProfilePath(player);
  const url = new URL(`${profile}/stats/${appId}/achievements/`, 'https://steamcommunity.com');
  url.search = 'xml=1&l=english';
  const response = await fetch(url, {
    headers: { Accept: 'application/xml' },
    redirect: 'manual',
    signal,
  });
  if (response.status === 429) {
    throw new LookupError('rate-limited', 429, response.headers.get('Retry-After'));
  }
  if (!response.ok) throw unavailable();
  const progress = parseSteamAchievements(await readLimited(response, 2_000_000), appId, profile);
  const details = identity ?? await steamProfileDetails(progress.profileUrl);
  return { ...progress, displayName: details?.displayName || progress.player, avatarUrl: details?.avatarUrl ?? null };
}

export async function syncSteamFriend(request, env) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'invalid-request' }, 403);
  if (request.method !== 'POST') return json({ error: 'invalid-request' }, 405);
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!steamId64.test(id)) return json({ error: 'invalid-player' }, 400);
  const { DB: db } = env;
  const now = Date.now();
  const lease = now + 120_000;
  try {
    const claimed = await db.prepare(`
      INSERT INTO steam_friend_sync (account_id, sync_after) VALUES (?, ?)
      ON CONFLICT (account_id) DO UPDATE SET sync_after = excluded.sync_after
      WHERE steam_friend_sync.sync_after <= ?
      RETURNING account_id
    `).bind(id, lease, now).first();
    if (claimed) {
      const profileUrl = `https://steamcommunity.com/profiles/${id}/`;
      const xml = await readSteamPage(profileUrl + '?xml=1', 128_000);
      const privacy = xmlText(xml, 'privacyState');
      if (xmlText(xml, 'steamID64') !== id || !privacy) throw unavailable();
      if (privacy === 'public') {
        const identity = steamIdentity(xml, id);
        const signal = AbortSignal.timeout(10_000);
        for (const [game, appId] of steamGames) {
          try {
            const progress = await steamAchievements(id, appId, signal, identity);
            await saveAchievementRanking(db, 'steam', game, progress, now);
          } catch (error) {
            if (error.message === 'rate-limited') throw error;
            if (error.message === 'private-achievements') await clearPrivateRanking(db, 'steam', id, now, game);
          }
        }
        const { games } = await steamActivity(xml, id, steamPublicUrl(xml, profileUrl), env);
        await saveSteamActivity(db, identity, games, now);
      } else if (privacy === 'private' || privacy === 'friendsonly') {
        await clearPrivateRanking(db, 'steam', id, now);
      }
      const nextSync = Date.now() + friendRefreshInterval;
      await db.prepare('UPDATE steam_friend_sync SET sync_after = ? WHERE account_id = ? AND sync_after = ?')
        .bind(nextSync, id, lease).run();
    }
    const [score] = await readSteamFriendScores(db, [id]);
    return json(score);
  } catch (error) {
    if (error instanceof LookupError) return json({ error: error.message }, error.status, error.retryAfter);
    console.error('Steam friend sync failed', error.message);
    return json({ error: 'provider-unavailable' }, 502);
  }
}

async function xboxRequest(path, apiKey, signal) {
  const response = await fetch('https://api.xbl.io' + path, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'en-US',
      'X-Authorization': apiKey,
    },
    redirect: 'manual',
    signal,
  });
  const body = response.ok ? JSON.parse(await readLimited(response, 4_000_000)) : {};
  const status = Number.isInteger(body?.code) && response.ok ? body.code : response.status;
  if (status === 429) {
    throw new LookupError('rate-limited', 429, response.headers.get('Retry-After'));
  }
  if (status === 401) throw new LookupError('xbox-not-configured', 503);
  if (status === 403) throw new LookupError('private-achievements', 403);
  if (status === 404) throw new LookupError('player-not-found', 404);
  if (status !== 200) throw unavailable();
  return body.content ?? body;
}

async function xboxAchievements(player, titleId, apiKey, signal) {
  if (!gamertag.test(player) || player.length > 48) throw invalidPlayer();
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new LookupError('xbox-not-configured', 503);

  // Xbox applies privacy settings relative to the credential's account. Only use a
  // lookup account without friends, and never expose that account's own results.
  const [account, friends, search] = await Promise.all([
    xboxRequest('/v2/account', apiKey, signal),
    xboxRequest('/v2/friends', apiKey, signal),
    xboxRequest(`/v2/search/${encodeURIComponent(player)}`, apiKey, signal),
  ]);
  const serviceId = account.profileUsers?.[0]?.id;
  if (
    typeof serviceId !== 'string' || !xboxUserId.test(serviceId)
    || !Array.isArray(friends.people) || friends.people.length !== 0
    || friends.pagingInfo?.continuationToken || friends.continuationToken
  ) {
    throw new LookupError('xbox-not-configured', 503);
  }
  if (!Array.isArray(search.people)) throw unavailable();

  const identity = player.normalize('NFC').toLowerCase();
  const matches = search.people.filter(({ gamertag, uniqueModernGamertag, modernGamertag, modernGamertagSuffix }) => (
    [gamertag, uniqueModernGamertag, modernGamertagSuffix && `${modernGamertag}#${modernGamertagSuffix}`]
      .some((tag) => typeof tag === 'string' && tag.normalize('NFC').toLowerCase() === identity)
  ));
  if (matches.length !== 1) throw new LookupError('gamertag-not-found', 404);
  const { xuid, gamertag: name, uniqueModernGamertag, displayPicRaw } = matches[0];
  if (typeof xuid !== 'string' || !xboxUserId.test(xuid) || typeof name !== 'string') throw unavailable();
  if (xuid === serviceId) throw new LookupError('private-achievements', 403);

  let data;
  try {
    data = await xboxRequest(`/v2/achievements/player/${xuid}/${titleId}`, apiKey, signal);
  } catch (error) {
    if (error.message === 'player-not-found') throw missingData();
    if (error.message === 'private-achievements') error.accountId = xuid;
    throw error;
  }
  if (!Array.isArray(data.achievements)) throw unavailable();
  const achievements = data.achievements.flatMap(({ name, progressState }) => {
    if (typeof name !== 'string' || !['Achieved', 'NotStarted', 'InProgress'].includes(progressState)) return [];
    return [{ name, unlocked: progressState === 'Achieved' }];
  });
  if (achievements.length === 0) throw missingData();
  return {
    accountId: xuid,
    player: uniqueModernGamertag || name,
    displayName: name,
    profileUrl: `https://www.xbox.com/en-US/play/user/${encodeURIComponent(uniqueModernGamertag || name)}`,
    avatarUrl: avatarFrom(displayPicRaw, ['images-eds-ssl.xboxlive.com', 'images-eds.xboxlive.com']),
    achievements,
  };
}

function json(value, status = 200, retryAfter = null) {
  const headers = { 'Cache-Control': 'no-store' };
  if (retryAfter && /^\d{1,6}$/.test(retryAfter)) headers['Retry-After'] = retryAfter;
  return Response.json(value, { status, headers });
}

async function lookupPlatform(platform, game, player, env, signal) {
  const gameId = (platform === 'steam' ? steamGames : xboxGames).get(game);
  if (!gameId) throw new LookupError('unsupported-game', 404);
  const fetchedAt = Date.now();
  let profile;
  try {
    profile = await (platform === 'steam'
      ? steamAchievements(player, gameId, signal)
      : xboxAchievements(player, gameId, env.OPENXBL_API_KEY, signal));
  } catch (error) {
    if (error.message === 'private-achievements') {
      const accountId = platform === 'steam'
        ? /^\/profiles\/(\d+)$/.exec(steamProfilePath(player))?.[1]
        : error.accountId;
      try {
        await clearPrivateRanking(env.DB, platform, accountId, fetchedAt, game);
      } catch (databaseError) {
        console.error('Private ranking removal failed', databaseError.message);
      }
    }
    throw error;
  }
  try {
    await saveAchievementRanking(env.DB, platform, game, profile, fetchedAt);
  } catch (error) {
    console.error('Achievement ranking save failed', error.message);
  }
  return profile;
}

export async function lookupPlayerAchievements(request, env) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'invalid-request' }, 403);
  if (request.method !== 'POST') return json({ error: 'invalid-request' }, 405);
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') {
    return json({ error: 'invalid-request' }, 415);
  }

  let input;
  try {
    input = JSON.parse(await readLimited(request, 1024));
  } catch {
    return json({ error: 'invalid-request' }, 400);
  }
  const { platform, game, player } = input ?? {};
  if (typeof player !== 'string' || !player.trim() || player.length > 160) {
    return json({ error: 'invalid-player' }, 400);
  }
  const name = player.trim().normalize('NFC');
  const signal = AbortSignal.timeout(10_000);

  // Keep existing callers that already specify a platform working.
  if (platform !== undefined) {
    if (platform !== 'steam' && platform !== 'xbox') return json({ error: 'invalid-request' }, 400);
    try {
      return json(await lookupPlatform(platform, game, name, env, signal));
    } catch (error) {
      if (error instanceof LookupError) return json({ error: error.message }, error.status, error.retryAfter);
      return json({ error: 'provider-unavailable' }, 502);
    }
  }

  const candidates = detectPlayerPlatforms(name);
  if (!candidates.length) return json({ error: 'invalid-player' }, 400);
  const results = await Promise.all(candidates.map(async (candidate) => {
    try {
      return { platform: candidate, ...await lookupPlatform(candidate, game, name, env, signal) };
    } catch (error) {
      return {
        platform: candidate,
        error: error instanceof LookupError ? error.message : 'provider-unavailable',
      };
    }
  }));
  return json({ results });
}
