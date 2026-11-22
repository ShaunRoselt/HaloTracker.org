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
  if (/^[a-z\d_-]{2,64}$/i.test(player)) return '/id/' + player;

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
  const rowPattern = /<achievement\s+closed="([01])"[^>]*>([\s\S]*?)<\/achievement>/g;
  for (const [, closed, row] of section.matchAll(rowPattern)) {
    const name = xmlText(row, 'name');
    if (name) achievements.push({ name, unlocked: closed === '1' });
  }
  if (achievements.length === 0) throw missingData();
  return { player: xmlText(player, 'customURL') || id, achievements };
}

async function steamAchievements(player, appId, signal) {
  const profile = steamProfilePath(player);
  const url = new URL(`${profile}/stats/${appId}/achievements/`, 'https://steamcommunity.com');
  url.search = 'xml=1&l=english';
  const response = await fetch(url, {
    headers: { Accept: 'application/xml' },
    redirect: 'error',
    signal,
  });
  if (response.status === 429) {
    throw new LookupError('rate-limited', 429, response.headers.get('Retry-After'));
  }
  if (!response.ok) throw unavailable();
  return parseSteamAchievements(await readLimited(response, 2_000_000), appId, profile);
}

async function xboxRequest(path, apiKey, signal) {
  const response = await fetch('https://api.xbl.io' + path, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'en-US',
      'X-Authorization': apiKey,
    },
    redirect: 'error',
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
  const { xuid, gamertag: name } = matches[0];
  if (typeof xuid !== 'string' || !xboxUserId.test(xuid) || typeof name !== 'string') throw unavailable();
  if (xuid === serviceId) throw new LookupError('private-achievements', 403);

  let data;
  try {
    data = await xboxRequest(`/v2/achievements/player/${xuid}/${titleId}`, apiKey, signal);
  } catch (error) {
    if (error.message === 'player-not-found') throw missingData();
    throw error;
  }
  if (!Array.isArray(data.achievements)) throw unavailable();
  const achievements = data.achievements.flatMap(({ name, progressState }) => {
    if (typeof name !== 'string' || !['Achieved', 'NotStarted', 'InProgress'].includes(progressState)) return [];
    return [{ name, unlocked: progressState === 'Achieved' }];
  });
  if (achievements.length === 0) throw missingData();
  return { player: name, achievements };
}

function json(value, status = 200, retryAfter = null) {
  const headers = { 'Cache-Control': 'no-store' };
  if (retryAfter && /^\d{1,6}$/.test(retryAfter)) headers['Retry-After'] = retryAfter;
  return Response.json(value, { status, headers });
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
  if (platform !== 'steam' && platform !== 'xbox') {
    return json({ error: 'invalid-request' }, 400);
  }
  const gameId = (platform === 'steam' ? steamGames : xboxGames).get(game);
  if (!gameId) return json({ error: 'unsupported-game' }, 404);

  try {
    const name = player.trim().normalize('NFC');
    const signal = AbortSignal.timeout(10_000);
    const progress = platform === 'steam'
      ? await steamAchievements(name, gameId, signal)
      : await xboxAchievements(name, gameId, env.OPENXBL_API_KEY, signal);
    return json(progress);
  } catch (error) {
    if (error instanceof LookupError) return json({ error: error.message }, error.status, error.retryAfter);
    return json({ error: 'provider-unavailable' }, 502);
  }
}
