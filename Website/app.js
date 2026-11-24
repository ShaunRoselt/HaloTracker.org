'use strict';

import { APP_NAME, GAME_CONFIG, getAchievementsForGame, guidePageTitle, hasGuide, matchUnlocks } from './game-catalog.js';
import {
  achievementText, achievementTextLocale, compareNames, currentLanguage,
  formatAchievementCount, formatPercent,
  LANGUAGES, savedLanguage, setLanguage, t, translateReleaseNotes,
} from './i18n.js';

const APP_VERSION = '1.6.0';
const RELEASE_DATE = '2026/11/26';
const appVersionLabel = () => t('Version {version} | WEB | RELEASE | {date}', {
  version: APP_VERSION,
  date: RELEASE_DATE,
});
const PLAYER_ERRORS = new Map([
  ['invalid-player', 'Enter a valid Steam ID, Steam profile URL, or Xbox Gamertag.'],
  ['player-not-found', 'Steam profile not found. Check the Steam ID or profile URL.'],
  ['gamertag-not-found', 'Xbox profile not found. Check the Gamertag and include its # suffix if it has one.'],
  ['private-achievements', 'This player’s achievements are private or unavailable.'],
  ['no-game-data', 'No public achievement data is available for this player in this game.'],
  ['unsupported-game', 'This game is unavailable on the selected platform.'],
  ['rate-limited', 'Too many requests. Give it a moment and try again.'],
  ['xbox-not-configured', 'Xbox achievement lookup is not connected yet.'],
]);
const PLATFORM_NAMES = { steam: 'Steam', xbox: 'Xbox' };
const PLAYER_SESSION_KEY = 'halo-tracker-player';

const HOME_DESCRIPTION = 'Browse Halo achievements by game and game mode, and open guides where available.';

const FILTERS = Object.freeze([
  Object.freeze({ value: 'Campaign', label: 'Campaign' }),
  Object.freeze({ value: 'Co-op Campaign', label: 'Co-op Campaign' }),
  Object.freeze({ value: 'PvE Multiplayer', label: 'PvE Multiplayer' }),
  Object.freeze({ value: 'PvP Multiplayer', label: 'PvP Multiplayer' }),
  Object.freeze({ value: 'Other', label: 'Other' }),
]);

const compareUnlockRate = (a, b) => Number.parseFloat(a.percentAchieved) - Number.parseFloat(b.percentAchieved);
const ACHIEVEMENT_SORTS = new Map([
  ['unlock-desc', { label: 'Most Unlocked', compare: (a, b) => compareUnlockRate(b, a) }],
  ['unlock-asc', { label: 'Least Unlocked', compare: compareUnlockRate }],
  ['name-asc', { label: 'Name (A–Z)', compare: compareNames }],
  ['name-desc', { label: 'Name (Z–A)', compare: (a, b) => compareNames(b, a) }],
]);

const sortAchievements = (achievements, sort) => {
  return achievements.toSorted(ACHIEVEMENT_SORTS.get(sort).compare);
};

const EXTERNAL_LINKS = Object.freeze([
  Object.freeze({
    label: 'Source Code',
    description: 'Explore the project on GitHub',
    href: 'https://github.com/shaunroselt/HaloTracker.org',
    icon: 'assets/github.svg',
  }),
  Object.freeze({
    label: 'License',
    description: 'Read the project license',
    href: 'https://github.com/shaunroselt/HaloTracker.org/blob/main/LICENSE',
    icon: 'assets/asterisk.svg',
  }),
  Object.freeze({
    label: 'Download App',
    action: 'download',
    icon: 'assets/app.svg',
  }),
  Object.freeze({
    label: 'Report a problem',
    description: 'Open an issue on GitHub',
    href: 'https://github.com/shaunroselt/HaloTracker.org/issues',
    icon: 'assets/bug.svg',
  }),
]);

const state = {
  filtersByGame: new Map(),
  searchByGame: new Map(),
  achievementSort: 'unlock-desc',
  player: null,
  sidebarOpen: false,
  renderedRoute: null,
  toastTimer: null,
};

const desktopMediaQuery = window.matchMedia('(min-width: 901px)');

const elements = {
  achievementsToggle: document.querySelector('#achievements-toggle'),
  drawerBackdrop: document.querySelector('#drawer-backdrop'),
  gameNavigation: document.querySelector('#game-navigation'),
  mainContent: document.querySelector('#main-content'),
  playerLookup: document.querySelector('#player-lookup'),
  playerId: document.querySelector('#player-id'),
  playerProfile: document.querySelector('#player-profile'),
  playerAvatar: document.querySelector('#player-profile-avatar'),
  playerInitial: document.querySelector('#player-profile-initial'),
  playerProfileMenu: document.querySelector('#player-profile-menu'),
  menuToggle: document.querySelector('#menu-toggle'),
  routeView: document.querySelector('#route-view'),
  sidebar: document.querySelector('#primary-navigation'),
  toast: document.querySelector('#toast'),
};

const createElement = (tagName, options = {}) => {
  const node = document.createElement(tagName);

  if (options.className) {
    node.className = options.className;
  }
  if (options.text) {
    node.textContent = options.text;
  }
  if (options.attributes) {
    for (const [name, value] of Object.entries(options.attributes)) {
      node.setAttribute(name, value);
    }
  }

  return node;
};

const createImage = ({ source, alt = '', className = '', eager = false, fetchPriority = 'auto' }) => {
  const image = createElement('img', {
    className,
    attributes: {
      fetchpriority: fetchPriority,
      src: source,
      alt,
      decoding: 'async',
      loading: eager ? 'eager' : 'lazy',
    },
  });

  image.addEventListener('error', () => {
    if (!image.dataset.fallbackApplied) {
      image.dataset.fallbackApplied = 'true';
      image.src = 'assets/app.svg';
    }
  });

  return image;
};

const getRoute = () => {
  const url = new URL(window.location.href);
  const page = url.searchParams.get('page')?.trim().toLowerCase() || 'search';
  const requestedGame = url.searchParams.get('game')?.trim().toLowerCase();
  const game = page === 'leaderboard' && !GAME_CONFIG.has(requestedGame)
    ? 'all'
    : requestedGame || 'halomcc';

  const achievement = url.searchParams.get('achievement');
  const profile = page === 'profile' ? url.searchParams.get('player') : null;

  return Object.freeze({ page, game, achievement, profile });
};

const canonicalizeUrl = () => {
  const url = new URL(window.location.href);
  const debugKeys = [...url.searchParams.keys()]
    .filter((key) => key.toLowerCase() === 'enabledebug');

  for (const key of debugKeys) {
    url.searchParams.delete(key);
  }

  if (!url.searchParams.has('page')) {
    url.searchParams.set('page', 'search');
  }

  const canonicalUrl = `${url.pathname}?${url.searchParams.toString()}${url.hash}`;
  window.history.replaceState(window.history.state, '', canonicalUrl);
};

const getNavigationUrl = (targetUrl) => {
  const currentUrl = new URL(window.location.href);
  const nextUrl = new URL(targetUrl, currentUrl);
  const user = currentUrl.searchParams.get('user');

  if (user && !nextUrl.searchParams.has('user')) {
    nextUrl.searchParams.set('user', user);
  }

  return `${nextUrl.pathname}?${nextUrl.searchParams.toString()}${nextUrl.hash}`;
};

const setSidebarOpen = (open) => {
  state.sidebarOpen = open;
  elements.sidebar.classList.toggle('is-open', open);
  elements.drawerBackdrop.classList.toggle('is-visible', open);
  elements.menuToggle.setAttribute('aria-expanded', String(open));
  elements.menuToggle.setAttribute('aria-label', t(open ? 'Close navigation' : 'Open navigation'));
  elements.sidebar.inert = !desktopMediaQuery.matches && !open;
  elements.mainContent.inert = open;
  document.body.classList.toggle('drawer-open', open);
};

const setGamesExpanded = (expanded) => {
  elements.gameNavigation.hidden = !expanded;
  elements.achievementsToggle.setAttribute('aria-expanded', String(expanded));
  elements.achievementsToggle.querySelector('.nav-chevron').src = expanded
    ? 'assets/chevron-down.svg'
    : 'assets/chevron-up.svg';
};

const leaderboardToggle = document.querySelector('#leaderboard-toggle');
const leaderboardNavigation = document.querySelector('#leaderboard-navigation');
const setLeaderboardExpanded = (expanded) => {
  leaderboardNavigation.hidden = !expanded;
  leaderboardToggle.setAttribute('aria-expanded', String(expanded));
  leaderboardToggle.querySelector('.nav-chevron').src = expanded
    ? 'assets/chevron-up.svg' : 'assets/chevron-down.svg';
};
leaderboardToggle.addEventListener('click', () => setLeaderboardExpanded(leaderboardNavigation.hidden));

const updateActiveNavigation = ({ page, game }) => {
  for (const navigationItem of document.querySelectorAll('[data-page]')) {
    const matchesPage = navigationItem.dataset.page === page;
    const matchesGame = !['achievements', 'leaderboard'].includes(page) || navigationItem.dataset.game === game;
    const isActive = matchesPage && matchesGame;

    navigationItem.classList.toggle('is-active', isActive);
    if (isActive) {
      navigationItem.setAttribute('aria-current', 'page');
    } else {
      navigationItem.removeAttribute('aria-current');
    }
  }

  if (page === 'achievements') setGamesExpanded(true);
  if (page === 'leaderboard') setLeaderboardExpanded(true);
};

const showToast = (message) => {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove('is-visible');
  }, 3_000);
};

const pageDescription = document.querySelector('meta[name="description"]');
const englishPageDescription = pageDescription.content;

const menuItemIcon = (icon) => createElement('img', {
  className: 'menu-item-icon',
  attributes: { src: `assets/${icon}.svg`, alt: '', width: 18, height: 18 },
});

const profileHref = (account) => {
  const id = account.platform === 'steam' ? account.accountId : account.player;
  return id ? `?page=profile&${new URLSearchParams({ player: `${account.platform}:${id}` })}` : '?page=profile';
};

const setAvatarFrame = (container, { avatarFrameUrl, avatarFrameStillUrl } = {}) => {
  container.querySelector('.profile-avatar-frame')?.remove();
  if (!avatarFrameUrl) return;
  const frame = createElement('picture', { className: 'profile-avatar-frame' });
  if (avatarFrameStillUrl) {
    frame.append(createElement('source', {
      attributes: { media: '(prefers-reduced-motion: reduce)', srcset: avatarFrameStillUrl },
    }));
  }
  const image = createElement('img', {
    attributes: { alt: '', src: avatarFrameUrl, referrerpolicy: 'no-referrer' },
  });
  image.addEventListener('error', () => frame.remove(), { once: true });
  frame.append(image);
  container.append(frame);
};

let framedHeaderAccount;
const updatePlayerHeader = () => {
  const account = state.player?.accounts.values().next().value;
  const lookupHadFocus = elements.playerLookup.contains(document.activeElement);
  elements.playerLookup.hidden = Boolean(account);
  elements.playerProfile.hidden = !account;
  const avatarUrl = account?.avatarUrl ?? null;
  if (elements.playerAvatar.getAttribute('src') !== avatarUrl) {
    elements.playerAvatar.hidden = true;
    elements.playerInitial.hidden = false;
    if (avatarUrl) elements.playerAvatar.src = avatarUrl;
    else elements.playerAvatar.removeAttribute('src');
  }
  if (framedHeaderAccount !== account) {
    framedHeaderAccount = account;
    const avatarSlot = elements.playerAvatar.parentElement;
    setAvatarFrame(avatarSlot);
    if (account?.platform === 'steam') {
      void loadSteamProfile(account, 'appearance').then((details) => {
        if (framedHeaderAccount === account) setAvatarFrame(avatarSlot, details);
      });
    }
  }
  if (!account) return;

  const displayName = account.displayName || account.player;
  const trigger = document.querySelector('#player-profile-trigger');
  trigger.setAttribute('aria-label', t('Profile for {player}', { player: displayName }));
  document.querySelector('#player-profile-name').textContent = displayName;
  elements.playerInitial.textContent = Array.from(displayName)[0].toLocaleUpperCase();
  document.querySelector('#player-sign-out span').textContent = t('Sign Out');

  const profileLink = document.querySelector('#player-profile-link');
  profileLink.href = profileHref(account);
  profileLink.querySelector('span').textContent = t('Profile');
  if (lookupHadFocus) trigger.focus({ preventScroll: true });
};

const localizeShell = () => {
  const playerLabel = t('Steam ID or Xbox Gamertag');
  document.querySelector('#player-id-label').textContent = playerLabel;
  elements.playerId.placeholder = playerLabel;
  document.querySelector('#player-submit').textContent = t('Search');
  updatePlayerHeader();
  document.querySelector('.skip-link').textContent = t('Skip to content');
  document.querySelector('.navigation').setAttribute('aria-label', t('Primary'));
  document.querySelector('[data-page="search"] span').textContent = t('Home');
  document.querySelector('[data-page="settings"] span').textContent = t('Settings');
  document.querySelector('[data-game="halomcc"] span').textContent = t('Halo MCC (All)');
  elements.achievementsToggle.querySelector('span').textContent = t('Achievements');
  leaderboardToggle.querySelector('span').textContent = t('Leaderboards');
  leaderboardNavigation.replaceChildren(...[
    ['all', { shortTitle: t('All Games'), icon: 'assets/trophy.svg' }], ...GAME_CONFIG,
  ].map(([game, config]) => {
    const item = createElement('li');
    const href = game === 'all' ? '?page=leaderboard' : `?page=leaderboard&game=${game}`;
    const link = createElement('a', {
      className: 'nav-item nav-game',
      attributes: { href, 'data-route': '', 'data-page': 'leaderboard', 'data-game': game },
    });
    link.append(createElement('img', {
      attributes: { src: config.icon, alt: '', width: 32, height: 32 },
    }), createElement('span', { text: config.shortTitle || config.title }));
    item.append(link);
    return item;
  }));
  elements.drawerBackdrop.setAttribute('aria-label', t('Close navigation'));
  pageDescription.content = t(englishPageDescription);
};

const renderHome = () => {
  const section = createElement('section', {
    className: 'home-page',
    attributes: { 'aria-labelledby': 'home-title' },
  });
  const hero = createElement('article', { className: 'home-hero surface' });
  const heroImage = createImage({
    source: 'assets/background-infinite.jpg',
    alt: t('Spartans from Halo Infinite'),
    className: 'home-hero-image',
    eager: true,
    fetchPriority: 'high',
  });
  const content = createElement('div', { className: 'home-hero-content' });
  const title = createElement('h1', {
    className: 'home-title',
    text: APP_NAME,
    attributes: { id: 'home-title' },
  });
  const description = createElement('p', {
    className: 'home-description',
    text: t(HOME_DESCRIPTION),
  });

  content.append(title, description);
  hero.append(heroImage, content);
  section.append(hero);
  elements.routeView.replaceChildren(section);
  document.title = APP_NAME;
};

const createFilterControl = ({ value, label }, checked) => {
  const wrapper = createElement('label', { className: 'filter-option' });
  const checkbox = createElement('input', {
    attributes: {
      type: 'checkbox',
      value,
      name: 'achievement-filter',
    },
  });
  checkbox.checked = checked;
  const text = createElement('span', { text: t(label) });

  wrapper.append(checkbox, text);
  return wrapper;
};

const appendUnlockStatuses = (metadata, achievementId, progress) => {
  for (const { platform, unlocks } of progress) {
    const unlocked = unlocks.get(achievementId);
    if (typeof unlocked !== 'boolean') continue;
    const label = t(unlocked ? 'Unlocked' : 'Locked');
    metadata.append(createElement('span', {
      className: 'achievement-unlock',
      attributes: { 'data-unlocked': String(unlocked), 'data-platform': platform },
      text: progress.length > 1 ? `${PLATFORM_NAMES[platform]} · ${label}` : label,
    }));
  }
};

const achievementPageHref = (game, achievement) => {
  const params = new URLSearchParams({ page: 'achievements', game });
  if (achievement) params.set('achievement', achievement);
  return `?${params}`;
};

const createAchievementCard = (achievement, { game, progress = [], eager = false, isGuide = false }) => {
  const guideAvailable = !isGuide && hasGuide(achievement);
  const card = createElement('article', {
    className: `achievement-card${guideAvailable ? ' has-guide' : ''}`,
  });

  const image = createImage({
    source: achievement.image,
    alt: '',
    className: 'achievement-image',
    eager,
  });
  image.width = 78;
  image.height = 78;

  const body = createElement('div', { className: 'achievement-body' });
  const heading = createElement(isGuide ? 'h1' : 'h3', {
    className: 'achievement-name',
    attributes: {
      lang: 'en',
      dir: 'auto',
      ...(isGuide ? { id: 'guide-title', tabindex: '-1' } : {}),
    },
  });
  if (guideAvailable) {
    heading.append(createElement('a', {
      className: 'achievement-guide-link',
      text: achievement.name,
      attributes: {
        href: achievementPageHref(game, achievement.id),
        'data-route': '',
        'data-achievement-id': achievement.id,
        'aria-label': t('Open guide for {achievement}', { achievement: achievement.name }),
      },
    }));
  } else {
    heading.textContent = achievement.name;
  }
  const description = createElement('p', {
    className: 'achievement-description',
    text: achievementText(achievement, 'description'),
    attributes: { lang: achievementTextLocale(achievement, 'description'), dir: 'auto' },
  });
  const metadata = createElement('div', { className: 'achievement-metadata' });
  const percentage = createElement('span', {
    className: 'achievement-percentage',
    text: t('{percent} of players have this achievement', { percent: formatPercent(achievement.percentAchieved) }),
  });

  metadata.append(percentage);
  appendUnlockStatuses(metadata, achievement.id, progress);
  body.append(heading, description, metadata);
  card.prepend(image, body);
  return card;
};

const normalizeSearch = (value) => value
  .normalize('NFD')
  .replace(/\p{Mark}|['’]/gu, '')
  .toLowerCase()
  .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
  .trim();

const renderAchievementCards = ({ game, achievements, activeFilters, searching, count, list, playerProgress }) => {
  const filteredAchievements = achievements.filter(({ filters }) => (
    filters.some((filter) => activeFilters.has(filter))
  ));
  const fragment = document.createDocumentFragment();

  const cards = new Map();
  filteredAchievements.forEach((achievement, index) => {
    const card = createAchievementCard(achievement, { game, progress: playerProgress, eager: index < 8 });
    cards.set(achievement, card);
    fragment.append(card);
  });

  if (filteredAchievements.length === 0) {
    fragment.append(createElement('p', {
      className: 'empty-state surface',
      text: t(searching ? 'No achievements match your search and filters.' : 'No achievements match the selected filters.'),
    }));
  }

  if (!playerProgress.length) {
    count.textContent = formatAchievementCount(filteredAchievements.length).toLocaleUpperCase(currentLanguage());
  }
  list.replaceChildren(fragment);
  return cards;
};

async function fetchPlayerProgress(player, collection) {
  try {
    const response = await fetch('/api/player-achievements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: player.id, game: collection, platform: player.platform }),
      signal: player.controller.signal,
    });
    const result = await response.json();
    return player.platform ? { ...result, platform: player.platform } : result;
  } catch {
    return { error: 'provider-unavailable', platform: player.platform };
  }
}

const createPlayer = (id, platform) => ({
  id,
  platform,
  accounts: new Map(),
  games: new Map(),
  unlockFilters: new Map(),
  failedReports: null,
  controller: new AbortController(),
});

const savePlayerSession = (session) => {
  try {
    if (session) window.sessionStorage.setItem(PLAYER_SESSION_KEY, JSON.stringify(session));
    else window.sessionStorage.removeItem(PLAYER_SESSION_KEY);
  } catch {
    // Player lookup still works when storage is disabled.
  }
};

const restorePlayer = () => {
  let session;
  try {
    session = JSON.parse(window.sessionStorage.getItem(PLAYER_SESSION_KEY));
  } catch {
    return;
  }
  if (typeof session?.id !== 'string' || !GAME_CONFIG.has(session.collection)) return;
  state.player = createPlayer(session.id);
  elements.playerId.value = session.id;
  void refreshSelectedPlayer(state.player, session.collection);
};

const progressForGame = (player, collection) => {
  if (!player.games.has(collection)) {
    const request = fetchPlayerProgress(player, collection).then((result) => {
      const reports = Array.isArray(result?.results) ? result.results : [result];
      const accountCount = player.accounts.size;
      for (const report of reports) {
        if (report?.player && report.profileUrl && !player.accounts.has(report.platform)) {
          player.accounts.set(report.platform, report);
        }
      }
      if (state.player === player && accountCount !== player.accounts.size) {
        if (!accountCount) savePlayerSession({ id: player.id, collection });
        updatePlayerHeader();
      }
      if (reports.some((report) => ['provider-unavailable', 'rate-limited'].includes(report?.error))) {
        player.games.delete(collection);
      }
      return reports;
    });
    player.games.set(collection, request);
  }
  return player.games.get(collection);
};

const playerCollections = [...new Set([...GAME_CONFIG.values()].map(({ collection }) => collection))];

const refreshSelectedPlayer = async (player, firstGame) => {
  const firstReports = await progressForGame(player, firstGame);
  const remaining = playerCollections.filter((game) => game !== firstGame);
  for (let offset = 0; offset < remaining.length; offset += 3) {
    if (state.player !== player) return firstReports;
    await Promise.all(remaining.slice(offset, offset + 3).map((game) => progressForGame(player, game)));
  }
  const steam = player.accounts.get('steam');
  if (steam && state.player === player) await loadSteamProfile(steam, 'activity');
  if (state.player === player && state.renderedRoute?.page === 'leaderboard') void refreshLeaderboard?.();
  return firstReports;
};

const playerLookupErrors = (reports) => reports.map((report) => {
  const message = PLAYER_ERRORS.get(report?.error) ?? (report?.achievements
    ? 'No public achievement data is available for this player in this game.'
    : 'Could not load the player’s achievements. Try again.');
  const platform = PLATFORM_NAMES[report?.platform];
  return reports.length > 1 && platform ? `${platform} · ${t(message)}` : t(message);
});

const matchedPlayerProgress = (achievements, reports) => reports.flatMap((report) => {
  if (!Array.isArray(report?.achievements)) return [];
  const unlocks = matchUnlocks(achievements, report.achievements);
  return unlocks.size ? [{ ...report, unlocks }] : [];
});

const unlockCount = (unlocks) => [...unlocks.values()].filter(Boolean).length;

const formatPlayerUnlocks = ({ unlocked, reported, total }) => {
  const number = new Intl.NumberFormat(currentLanguage());
  return t(reported === total
    ? '{unlocked} of {total} unlocked'
    : '{unlocked} unlocked · Status available for {reported} of {total}', {
    unlocked: number.format(unlocked),
    reported: number.format(reported),
    total: number.format(total),
  });
};

const createGameHeader = (config, title, accessory) => {
  const hero = createElement('header', { className: 'game-hero surface' });
  const heroOverlay = createElement('div', { className: 'game-hero-overlay' });
  const gameIcon = createImage({
    source: config.icon,
    alt: '',
    className: 'game-hero-icon',
    eager: true,
  });
  gameIcon.width = 72;
  gameIcon.height = 72;
  if (title.matches('a')) {
    title.prepend(gameIcon);
    heroOverlay.append(title);
  } else {
    const heroText = createElement('div', { className: 'game-hero-text' });
    heroText.append(title);
    heroOverlay.append(gameIcon, heroText);
  }
  if (accessory) heroOverlay.append(accessory);
  hero.append(heroOverlay);
  return hero;
};

const createGameSearch = (id, label, controls) => {
  const search = createElement('div', { className: 'achievement-search' });
  const searchInput = createElement('input', {
    attributes: {
      id, type: 'search', placeholder: t(label), autocomplete: 'off', 'aria-controls': controls,
    },
  });
  search.append(createElement('label', {
    className: 'achievement-search-label', text: t(label), attributes: { for: id },
  }), searchInput);
  return { search, searchInput };
};

const renderAchievements = (game) => {
  const config = GAME_CONFIG.get(game);
  if (!config) {
    renderNotFound();
    return;
  }

  const achievements = getAchievementsForGame(game);
  const representedFilters = new Set(achievements.flatMap(({ filters }) => filters));
  const availableFilters = FILTERS.filter(({ value }) => representedFilters.has(value));
  const activeFilters = state.filtersByGame.get(game) ?? new Set(availableFilters.map(({ value }) => value));
  state.filtersByGame.set(game, activeFilters);
  const page = createElement('section', {
    className: 'achievements-page',
    attributes: { 'aria-labelledby': 'achievements-title' },
  });
  const title = createElement('h1', {
    text: config.title,
    attributes: { id: 'achievements-title' },
  });
  const count = createElement('p', {
    className: 'achievement-count',
    attributes: {
      id: 'achievement-count',
      'aria-live': 'polite',
    },
  });

  const { search, searchInput } = createGameSearch('achievement-search', 'Search Achievements', 'achievement-list');
  searchInput.value = state.searchByGame.get(game) ?? '';

  const hero = createGameHeader(config, title, search);

  const summary = createElement('section', {
    className: 'achievement-summary surface',
    attributes: { 'aria-label': t('Achievement count') },
  });
  summary.append(count);

  const player = state.player;
  const playerInfo = createElement('div', { className: 'player-progress-info' });
  const playerStatus = createElement('div', {
    className: 'player-progress-status',
    attributes: { role: 'status' },
  });
  const unlockFilter = createElement('select', {
    attributes: { id: 'achievement-unlock-filter', 'aria-label': t('Filter by unlock status') },
  });
  for (const [value, label, icon] of [
    ['all', 'All Statuses', 'list'], ['unlocked', 'Unlocked', 'unlock'], ['locked', 'Locked', 'lock'],
  ]) {
    const option = createElement('option', { attributes: { value } });
    option.append(menuItemIcon(icon), t(label));
    unlockFilter.append(option);
  }

  if (player) {
    playerStatus.textContent = t('Looking up achievements…');
    unlockFilter.value = player.unlockFilters.get(game) ?? 'all';
    unlockFilter.hidden = true;
    playerInfo.append(playerStatus);
    const playerActions = createElement('div', { className: 'player-progress-actions' });
    playerActions.append(unlockFilter);
    const playerPanel = createElement('div', { className: 'player-progress' });
    playerPanel.append(playerInfo, playerActions);
    summary.append(playerPanel);
  }
  let playerProgress = [];

  const filterPanel = createElement('form', {
    className: 'filter-panel',
    attributes: { 'aria-label': t('Filter achievements') },
  });
  const fieldset = createElement('fieldset');
  const legend = createElement('legend', { text: t('Filter Criteria') });
  const options = createElement('div', { className: 'filter-options' });

  for (const filter of availableFilters) {
    const label = filter.value === 'PvE Multiplayer'
      ? config.pveFilterLabel ?? filter.label
      : filter.label;
    options.append(createFilterControl({ value: filter.value, label }, activeFilters.has(filter.value)));
  }

  const sortControl = createElement('div', { className: 'achievement-sort' });
  const sortLabel = createElement('label', {
    text: t('Sort By'),
    attributes: { for: 'achievement-sort' },
  });
  const sortSelect = createElement('select', { attributes: { id: 'achievement-sort' } });
  for (const [value, { label }] of ACHIEVEMENT_SORTS) {
    sortSelect.append(createElement('option', { text: t(label), attributes: { value } }));
  }
  sortSelect.value = state.achievementSort;
  sortControl.append(sortLabel, sortSelect);

  fieldset.append(legend, options);
  filterPanel.append(fieldset, sortControl);

  const listRegion = createElement('section', {
    className: 'achievement-results',
    attributes: { 'aria-labelledby': 'achievement-results-title' },
  });
  const listTitle = createElement('h2', {
    text: t('Achievements'),
    attributes: { id: 'achievement-results-title' },
  });
  const list = createElement('div', {
    className: 'achievement-list',
    attributes: {
      id: 'achievement-list',
      'aria-describedby': 'achievement-count',
    },
  });

  const sortStatus = createElement('p', {
    className: 'achievement-sort-status',
    attributes: { role: 'status' },
  });
  const searchableText = new Map(achievements.map((achievement) => [
    achievement,
    normalizeSearch(`${achievement.name} ${achievement.description} ${achievementText(achievement, 'description')}`),
  ]));
  let searchValue = searchInput.value;
  const renderResults = () => {
    const query = normalizeSearch(searchValue);
    const terms = query ? query.split(' ') : [];
    const status = playerProgress.length ? unlockFilter.value : 'all';
    const matches = achievements.filter((achievement) => (
      terms.every((term) => searchableText.get(achievement).includes(term))
      && (status === 'all' || playerProgress.some(
        ({ unlocks }) => unlocks.get(achievement.id) === (status === 'unlocked')
      ))
    ));
    return renderAchievementCards({
      game,
      achievements: sortAchievements(matches, state.achievementSort),
      activeFilters,
      searching: terms.length > 0,
      count,
      list,
      playerProgress,
    });
  };
  let cards = renderResults();
  unlockFilter.addEventListener('change', () => {
    player?.unlockFilters.set(game, unlockFilter.value);
    cards = renderResults();
  });

  if (player) {
    void progressForGame(player, config.collection).then((reports) => {
      if (state.player !== player || !playerInfo.isConnected) return;
      playerProgress = matchedPlayerProgress(achievements, reports);

      playerStatus.replaceChildren();
      if (!playerProgress.length) {
        const visibleReports = config.collection === 'halo5'
          ? reports.filter((report) => !['unsupported-game', 'xbox-not-configured'].includes(report?.error))
          : reports;
        if (!visibleReports.length) playerInfo.parentElement.remove();
        for (const message of playerLookupErrors(visibleReports)) {
          playerStatus.append(createElement('p', { text: message }));
        }
        return;
      }

      const numberFormat = new Intl.NumberFormat(currentLanguage());
      for (const { player: name, platform, unlocks } of playerProgress) {
        const unlocked = unlockCount(unlocks);
        const total = achievements.length;
        const countText = formatPlayerUnlocks({ unlocked, reported: unlocks.size, total });
        const result = createElement('div', { className: 'player-progress-result' });
        const heading = playerStatus.childElementCount
          ? createElement('p', { className: 'achievement-count' })
          : count;
        heading.textContent = t('{unlocked} of {achievements}', {
          unlocked: numberFormat.format(unlocked),
          achievements: formatAchievementCount(total),
        }).toLocaleUpperCase(currentLanguage());
        const progress = createElement('progress', {
          className: 'player-achievement-progress',
          attributes: {
            value: unlocked,
            max: total,
            'aria-label': `${PLATFORM_NAMES[platform]} · ${name}`,
            'aria-valuetext': countText,
          },
        });
        result.append(heading, progress);
        if (unlocks.size !== total) {
          result.append(createElement('p', { text: countText }));
        }
        playerStatus.append(result);
      }
      unlockFilter.hidden = false;
      if (unlockFilter.value === 'all') {
        for (const [achievement, card] of cards) {
          appendUnlockStatuses(card.querySelector('.achievement-metadata'), achievement.id, playerProgress);
        }
      } else {
        const focusedGuide = list.contains(document.activeElement)
          ? document.activeElement.dataset.achievementId
          : null;
        cards = renderResults();
        if (focusedGuide) {
          list.querySelector(`[data-achievement-id="${CSS.escape(focusedGuide)}"]`)?.focus({ preventScroll: true });
        }
      }
    });
  }

  const updateSearch = () => {
    if (searchValue !== searchInput.value) {
      searchValue = searchInput.value;
      state.searchByGame.set(game, searchValue);
      cards = renderResults();
    }
  };
  searchInput.addEventListener('input', (event) => {
    if (!event.isComposing) {
      updateSearch();
    }
  });
  searchInput.addEventListener('compositionend', updateSearch);

  sortSelect.addEventListener('change', () => {
    const sort = sortSelect.value;
    const option = ACHIEVEMENT_SORTS.get(sort);
    if (!option) {
      return;
    }
    state.achievementSort = sort;
    const moveCard = typeof list.moveBefore === 'function'
      ? (card) => list.moveBefore(card, null)
      : (card) => list.append(card);

    for (const achievement of sortAchievements(achievements, sort)) {
      const card = cards.get(achievement);
      if (card) {
        moveCard(card);
      }
    }
    sortStatus.textContent = `${t(option.label)}. ${formatAchievementCount(cards.size)}.`;
  });

  const syncFilters = () => {
    activeFilters.clear();
    for (const checkbox of filterPanel.querySelectorAll('input[type="checkbox"]:checked')) {
      activeFilters.add(checkbox.value);
    }
    cards = renderResults();
  };

  options.addEventListener('change', syncFilters);
  listRegion.append(listTitle, sortStatus, list);
  const browser = createElement('div', { className: 'achievement-browser' });
  browser.append(filterPanel, listRegion);
  page.append(hero, summary, browser);
  elements.routeView.replaceChildren(page);
  setGamePageTitle(config);
};

const isAllowedVideoUrl = (value) => {
  try {
    const url = new URL(value);
    const allowedHosts = new Set(['www.youtube.com', 'www.youtube-nocookie.com']);
    return url.protocol === 'https:'
      && allowedHosts.has(url.hostname)
      && url.pathname.startsWith('/embed/');
  } catch (error) {
    console.error('Invalid guide video URL:', value, error);
    return false;
  }
};

const updateGuideCard = (card, achievement, player, collection) => {
  void progressForGame(player, collection).then((reports) => {
    if (state.player !== player || !card.isConnected) return;
    const progress = matchedPlayerProgress([achievement], reports);
    appendUnlockStatuses(card.querySelector('.achievement-metadata'), achievement.id, progress);
  });
};

const renderGuide = (game, achievement) => {
  const article = createElement('article', {
    className: 'guide-page',
    attributes: { 'aria-labelledby': 'guide-title' },
  });
  const content = createElement('div', { className: 'guide-content' });
  const config = GAME_CONFIG.get(game);
  const gameLink = createElement('a', {
    className: 'guide-game-link',
    text: config.title,
    attributes: {
      href: achievementPageHref(game),
      'data-route': '',
      'aria-label': t('{game} Achievements', { game: config.title }),
    },
  });
  const card = createAchievementCard(achievement, { eager: true, isGuide: true });

  if (achievement.guideDescription.trim()) {
    const guideSection = createElement('section', {
      className: 'guide-section',
      attributes: { 'aria-labelledby': 'guide-steps-title' },
    });
    const guideTitle = createElement('h2', {
      text: t('Guide'),
      attributes: { id: 'guide-steps-title' },
    });
    const guideText = createElement('p', {
      className: 'guide-description',
      text: achievementText(achievement, 'guideDescription'),
      attributes: { lang: achievementTextLocale(achievement, 'guideDescription'), dir: 'auto' },
    });
    guideSection.append(guideTitle, guideText);
    content.append(guideSection);
  }

  const validVideos = achievement.guideVideos.filter(isAllowedVideoUrl);
  if (validVideos.length > 0) {
    const videoSection = createElement('section', {
      className: 'guide-section',
      attributes: { 'aria-labelledby': 'guide-videos-title' },
    });
    const videoTitle = createElement('h2', {
      text: t(validVideos.length === 1 ? 'Video guide' : 'Video guides'),
      attributes: { id: 'guide-videos-title' },
    });
    const videoGrid = createElement('div', { className: 'video-grid' });

    validVideos.forEach((videoUrl, index) => {
      const frameWrapper = createElement('div', { className: 'video-frame' });
      const iframe = createElement('iframe', {
        attributes: {
          src: videoUrl,
          title: t('{achievement} video guide {number}', {
            achievement: achievement.name,
            number: index + 1,
          }),
          loading: 'lazy',
          allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
          referrerpolicy: 'strict-origin-when-cross-origin',
          allowfullscreen: '',
        },
      });
      frameWrapper.append(iframe);
      videoGrid.append(frameWrapper);
    });

    videoSection.append(videoTitle, videoGrid);
    content.append(videoSection);
  }

  article.append(createGameHeader(config, gameLink), card, content);
  elements.routeView.replaceChildren(article);
  document.title = guidePageTitle(achievement);
  if (state.player) updateGuideCard(card, achievement, state.player, config.collection);
};

const setGamePageTitle = (config) => {
  document.title = `${t('{game} Achievements', { game: t(config.shortTitle) })} | ${APP_NAME}`;
};

const renderSettings = () => {
  const section = createElement('section', {
    className: 'settings-page',
    attributes: { 'aria-labelledby': 'settings-title' },
  });
  const header = createElement('header', { className: 'page-heading surface' });
  const settingsIcon = createImage({
    source: 'assets/settings.svg',
    alt: '',
    className: 'page-heading-icon',
  });
  const title = createElement('h1', {
    text: t('Settings'),
    attributes: { id: 'settings-title' },
  });
  header.append(settingsIcon, title);

  const grid = createElement('div', { className: 'settings-grid' });
  const languageCard = createElement('section', {
    className: 'settings-card surface',
    attributes: { 'aria-labelledby': 'language-title' },
  });
  const languageIcon = createImage({
    source: 'assets/translate.svg',
    alt: '',
    className: 'settings-icon',
  });
  const languageBody = createElement('div', { className: 'settings-card-body' });
  const languageTitle = createElement('h2', {
    text: t('Language'),
    attributes: { id: 'language-title' },
  });
  const languageDescription = createElement('p', {
    text: t('Select which language to display'),
    attributes: { id: 'language-description' },
  });
  const languageSelect = createElement('select', {
    attributes: {
      id: 'display-language',
      dir: 'ltr',
      'aria-describedby': 'language-description',
      'aria-label': t('Display language'),
    },
  });
  for (const [code, label] of Object.entries(LANGUAGES)) {
    languageSelect.append(createElement('option', { text: label, attributes: { value: code, lang: 'en', dir: 'ltr' } }));
  }
  languageSelect.value = currentLanguage();
  languageSelect.addEventListener('change', async () => {
    languageSelect.disabled = true;
    try {
      await setLanguage(languageSelect.value);
      localizeShell();
      renderRoute();
      document.querySelector('#display-language')?.focus({ preventScroll: true });
    } catch {
      languageSelect.value = currentLanguage();
      showToast(t('Unable to load the selected language.'));
    } finally {
      languageSelect.disabled = false;
    }
  });
  languageBody.append(languageTitle, languageDescription);
  languageCard.append(languageIcon, languageBody, languageSelect);

  const appCard = createElement('section', {
    className: 'settings-card surface',
    attributes: { 'aria-labelledby': 'app-info-title' },
  });
  const appIcon = createImage({
    source: 'assets/halo-mcc.png',
    alt: '',
    className: 'settings-icon',
  });
  const appBody = createElement('div', { className: 'settings-card-body' });
  const appTitle = createElement('h2', {
    text: APP_NAME,
    attributes: { id: 'app-info-title' },
  });
  const appVersion = createElement('p', { text: appVersionLabel() });
  const appActions = createElement('div', { className: 'settings-actions' });
  const changeLogLink = createElement('a', {
    className: 'settings-icon-button',
    attributes: {
      href: '?page=release-notes',
      'data-route': '',
      'aria-label': t('View change log'),
      title: t('View change log'),
    },
  });
  changeLogLink.append(createImage({
    source: 'assets/journal-code.svg',
    alt: '',
    className: 'settings-action-icon',
  }));
  const copyButton = createElement('button', {
    className: 'settings-icon-button',
    attributes: {
      type: 'button',
      'aria-label': t('Copy app info to clipboard'),
      title: t('Copy app info to clipboard'),
    },
  });
  copyButton.append(createImage({
    source: 'assets/copy.svg',
    alt: '',
    className: 'settings-action-icon',
  }));

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${APP_NAME} (${appVersionLabel()})`);
      showToast(t('App information copied.'));
    } catch {
      showToast(t('Unable to copy app information.'));
    }
  });

  appActions.append(copyButton, changeLogLink);
  appBody.append(appTitle, appVersion);
  appCard.append(appIcon, appBody, appActions);
  grid.append(languageCard, appCard);

  const linksSection = createElement('section', {
    className: 'useful-links surface',
    attributes: { 'aria-labelledby': 'useful-links-title' },
  });
  const linksHeading = createElement('header', { className: 'useful-links-heading' });
  const linksIcon = createImage({
    source: 'assets/link.svg',
    alt: '',
    className: 'useful-links-icon',
  });
  const linksTitle = createElement('h2', {
    text: t('Useful Links'),
    attributes: { id: 'useful-links-title' },
  });
  linksHeading.append(linksIcon, linksTitle);
  const linksGrid = createElement('div', { className: 'links-grid' });

  for (const link of EXTERNAL_LINKS) {
    const linkElement = link.action
      ? createElement('button', {
        className: 'link-card',
        attributes: { type: 'button' },
      })
      : createElement('a', {
        className: 'link-card',
        attributes: {
          href: link.href,
          target: '_blank',
          rel: 'noreferrer',
        },
      });
    const icon = createImage({
      source: link.icon,
      alt: '',
      className: 'link-icon',
    });
    const label = createElement('span', { text: t(link.label) });
    linkElement.append(icon, label);
    if (link.action === 'download') {
      linkElement.addEventListener('click', () => showToast(t('Coming soon!')));
    }
    linksGrid.append(linkElement);
  }

  linksSection.append(linksHeading, linksGrid);
  section.append(header, grid, linksSection);
  elements.routeView.replaceChildren(section);
  document.title = `${t('Settings')} | ${APP_NAME}`;
};

const renderNotFound = () => {
  const section = createElement('section', {
    className: 'not-found surface',
    attributes: { 'aria-labelledby': 'not-found-title' },
  });
  const code = createElement('p', { className: 'eyebrow', text: '404' });
  const title = createElement('h1', {
    text: t('Page not found'),
    attributes: { id: 'not-found-title' },
  });
  const description = createElement('p', {
    text: t('The requested Halo Tracker page does not exist.'),
  });
  const homeLink = createElement('a', {
    className: 'button primary-button',
    text: t('Return home'),
    attributes: {
      href: '?page=search',
      'data-route': '',
    },
  });

  section.append(code, title, description, homeLink);
  elements.routeView.replaceChildren(section);
  document.title = `${t('Page not found')} | ${APP_NAME}`;
};

const renderReleaseNotes = () => {
  const template = document.querySelector('#release-notes-template');
  const content = translateReleaseNotes(template.content.cloneNode(true));
  for (const entry of content.querySelectorAll('.release-entry')) {
    const screenshotCount = entry.querySelectorAll('.release-entry-body img').length;
    if (!screenshotCount) continue;
    const label = t(screenshotCount === 1 ? 'Screenshot' : 'Screenshots');
    entry.querySelector('summary').append(createElement('img', {
      className: 'release-screenshot-icon',
      attributes: { src: 'assets/image.svg', alt: label, title: label, width: 18, height: 18 },
    }));
  }
  elements.routeView.replaceChildren(content);
  document.title = `${t('Release Notes')} | ${APP_NAME}`;
};

const createProfileAvatar = ({ player, avatarUrl }) => {
  const avatar = createElement('span', { className: 'profile-portrait', attributes: { 'aria-hidden': 'true' } });
  const initial = createElement('span', { text: Array.from(player)[0].toLocaleUpperCase() });
  avatar.append(initial);

  if (avatarUrl) {
    const image = createElement('img', {
      attributes: { alt: '', width: 88, height: 88, referrerpolicy: 'no-referrer', hidden: '' },
    });
    image.addEventListener('load', () => {
      initial.hidden = true;
      image.hidden = false;
    }, { once: true });
    image.src = avatarUrl;
    avatar.append(image);
  }
  return avatar;
};

const profileDate = (timestamp) => new Intl.DateTimeFormat(currentLanguage(), {
  dateStyle: 'medium',
}).format(timestamp * 1000);

const createProfileActivity = (game, { minutes, lastPlayed } = {}) => {
  const hours = new Intl.NumberFormat(currentLanguage(), {
    style: 'unit', unit: 'hour', maximumFractionDigits: 1,
  }).format(Number.isFinite(minutes) ? minutes / 60 : 0);
  const stats = createElement('dl', { className: 'profile-game-activity' });
  for (const [label, value] of [
    ['Time played', hours],
    ['Last played', lastPlayed && profileDate(lastPlayed)],
    ['First achievement', game.firstUnlockAt ? profileDate(game.firstUnlockAt) : t('N/A')],
    ['Latest achievement', game.lastUnlockAt ? profileDate(game.lastUnlockAt) : t('N/A')],
  ]) {
    if (value == null) continue;
    const stat = createElement('div');
    stat.append(createElement('dt', { text: t(label) }), createElement('dd', { text: value }));
    stats.append(stat);
  }
  return stats;
};

const createProfileGame = (data, platform) => {
  const { game, unlocked = 0, reported, total = getAchievementsForGame(game).length } = data;
  const config = GAME_CONFIG.get(game);
  const headingId = `profile-${platform}-${game}`;
  const link = createElement('a', {
    attributes: { href: `?page=achievements&game=${game}`, 'data-route': '', id: headingId },
    text: config.title,
  });
  const icon = createImage({ source: config.icon, className: 'profile-game-icon' });
  icon.width = 40;
  icon.height = 40;
  const heading = createElement('h3', { className: 'profile-game-heading' });
  link.prepend(icon);
  heading.append(link);

  const count = createElement('p', {
    className: 'profile-game-count',
    text: formatPlayerUnlocks({ unlocked, reported: reported ?? total, total }),
  });
  const item = createElement('li', {
    className: 'profile-game surface',
    attributes: { 'data-profile-game': game },
  });
  const progress = createElement('progress', {
    className: 'profile-game-progress',
    attributes: { value: unlocked, max: total, 'aria-labelledby': headingId },
  });
  item.append(heading, progress, count, createProfileActivity(data));
  return item;
};

const createProfileProgress = ({ platform, player, games }, hasMultiplePlatforms) => {
  const headingId = `profile-progress-${platform}`;
  const section = createElement(hasMultiplePlatforms ? 'section' : 'div', { className: 'profile-progress' });
  if (hasMultiplePlatforms) {
    const heading = createElement('h2', { attributes: { id: headingId } });
    heading.append(PLATFORM_NAMES[platform], ' · ', createElement('bdi', { text: player }));
    section.setAttribute('aria-labelledby', headingId);
    section.append(heading);
  }
  const gameList = createElement('ul', { className: 'profile-games' });
  gameList.append(...games.map((game) => createProfileGame(game, platform)));
  section.append(gameList);
  return section;
};

const steamLink = (href, label) => createElement('a', {
  text: label,
  attributes: { href, rel: 'noreferrer' },
});

const createSteamGalleries = (galleries) => {
  const section = createElement('section', {
    className: 'profile-progress',
    attributes: { 'aria-labelledby': 'profile-screenshots-title' },
  });
  section.append(createElement('h2', {
    text: t('Halo screenshots'), attributes: { id: 'profile-screenshots-title' },
  }));
  const grid = createElement('div', { className: 'profile-gallery-grid' });
  for (const { game, galleryUrl, screenshots } of galleries) {
    const gameTitle = GAME_CONFIG.get(game).title;
    const heading = createElement('h3');
    const logo = createImage({ source: GAME_CONFIG.get(game).icon });
    logo.width = 28;
    logo.height = 28;
    heading.append(logo, steamLink(galleryUrl, gameTitle));
    const gallery = createElement('section', { className: 'profile-gallery surface' });
    const images = createElement('div', { className: 'profile-screenshots' });
    for (const [index, { id, thumbnail }] of screenshots.entries()) {
      const link = steamLink(`https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`);
      const alt = t('{game} screenshot {number}', { game: gameTitle, number: index + 1 });
      link.append(createElement('img', {
        attributes: { src: thumbnail, alt, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' },
      }));
      images.append(link);
    }
    gallery.append(heading, images);
    grid.append(gallery);
  }
  section.append(grid);
  return section;
};

const loadSteamProfile = async (account, view) => {
  try {
    const id = new URL(account.profileUrl).pathname.split('/')[2];
    const params = new URLSearchParams({ id });
    if (view) params.set('view', view);
    const response = await fetch(`/api/steam-profile?${params}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (response.ok) return await response.json();
  } catch {
    // The achievement summary is usable even when profile extras are unavailable.
  }
  return {};
};

const attachProfileTabs = (page) => {
  const tabList = createElement('div', {
    className: 'profile-tabs',
    attributes: { role: 'tablist', 'aria-label': t('Profile sections') },
  });
  const entries = [];
  const addTab = (label) => {
    const index = entries.length;
    const id = `profile-tab-${label.toLowerCase()}`;
    const panelId = `${id}-panel`;
    const tab = createElement('button', {
      text: t(label),
      attributes: {
        type: 'button', role: 'tab', id, 'aria-controls': panelId,
        'aria-selected': String(index === 0), tabindex: index === 0 ? '0' : '-1',
      },
    });
    const panel = createElement('div', {
      className: 'profile-tab-panel',
      attributes: { role: 'tabpanel', id: panelId, 'aria-labelledby': id, tabindex: '0' },
    });
    panel.hidden = index !== 0;
    tabList.append(tab);
    entries.push({ tab, panel });
    page.append(panel);
    tab.addEventListener('click', () => {
      for (const entry of entries) {
        const active = entry.tab === tab;
        entry.tab.setAttribute('aria-selected', String(active));
        entry.tab.tabIndex = active ? 0 : -1;
        entry.panel.hidden = !active;
      }
      panel.dispatchEvent(new Event('profile-tab-open'));
    });
    tab.addEventListener('keydown', (event) => {
      const rtl = getComputedStyle(tabList).direction === 'rtl';
      const next = { ArrowRight: index + (rtl ? -1 : 1), ArrowLeft: index + (rtl ? 1 : -1), Home: 0, End: entries.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      const target = entries[(next + entries.length) % entries.length].tab;
      tab.tabIndex = -1;
      target.tabIndex = 0;
      target.focus();
    });
    return panel;
  };
  page.append(tabList);
  return { panels: ['Achievements', 'Screenshots', 'Friends'].map(addTab), addTab };
};

const setupProfileFriends = async (panel, steam) => {
  const status = createElement('p', { attributes: { role: 'status' } });
  panel.append(status);
  if (!steam) {
    status.textContent = t('No public Steam friends list is available.');
    return;
  }

  status.textContent = t('Loading friends…');
  let friends;
  try {
    const id = new URL(steam.profileUrl).pathname.split('/')[2];
    const response = await fetch(`/api/steam-friends?${new URLSearchParams({ id })}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Friends unavailable');
    ({ friends } = await response.json());
  } catch {
    status.textContent = t('The Steam friends list is private or unavailable.');
    return;
  }
  if (!panel.isConnected) return;

  const navigation = createElement('div', { className: 'profile-friends-pagination' });
  const previous = createElement('button', { className: 'button secondary-button', text: t('Previous'), attributes: { type: 'button' } });
  const next = createElement('button', { className: 'button secondary-button', text: t('Next'), attributes: { type: 'button' } });
  navigation.append(previous, next);

  const rankedFriends = friends.map((friend) => ({ ...friend, player: friend.displayName, platform: 'steam' }));
  const pageSize = 48;
  const format = new Intl.NumberFormat(currentLanguage());
  const names = new Intl.Collator(currentLanguage(), { sensitivity: 'base' });
  let start = 0;
  const showPage = () => {
    const end = Math.min(start + pageSize, rankedFriends.length);
    const { sort, direction } = ranking;
    const compareName = (a, b) => names.compare(a.displayName, b.displayName) || a.accountId.localeCompare(b.accountId);
    rankedFriends.sort((a, b) => (b.unlocked ?? 0) - (a.unlocked ?? 0) || compareName(a, b));
    for (const [index, friend] of rankedFriends.entries()) {
      const previousFriend = rankedFriends[index - 1];
      friend.rank = previousFriend && (friend.unlocked ?? 0) === (previousFriend.unlocked ?? 0)
        ? previousFriend.rank : index + 1;
    }

    rankedFriends.sort((a, b) => {
      if (sort === 'minutes' && (a.minutes == null || b.minutes == null)) {
        return Number(a.minutes == null) - Number(b.minutes == null) || compareName(a, b);
      }
      const difference = sort === 'player' ? names.compare(a.displayName, b.displayName)
        : sort === 'platform' ? 0 : (a[sort] ?? 0) - (b[sort] ?? 0);
      return (direction === 'asc' ? difference : -difference) || compareName(a, b);
    });
    status.textContent = rankedFriends.length ? t('Friends {first}–{last} of {total}', {
      first: format.format(start + 1), last: format.format(end), total: format.format(rankedFriends.length),
    }) : '';
    ranking.showRows(rankedFriends.slice(start, end), 'This player has no public Steam friends.');
    previous.disabled = start === 0;
    next.disabled = end === rankedFriends.length;
  };
  const ranking = createRankingTable('all', { 'aria-label': t('Steam friends') }, () => {
    start = 0;
    showPage();
  });
  navigation.hidden = rankedFriends.length <= pageSize;
  panel.append(navigation, ranking.results);
  previous.addEventListener('click', () => { start -= pageSize; showPage(); });
  next.addEventListener('click', () => { start += pageSize; showPage(); });
  showPage();
  panel.addEventListener('profile-tab-open', showPage);

  for (const friend of rankedFriends) {
    if (friend.syncAfter > Date.now()) continue;
    pendingFriendSync.set(friend.accountId, (score) => {
      const changed = score.unlocked !== friend.unlocked || score.minutes !== friend.minutes;
      Object.assign(friend, score);
      if (changed && !panel.hidden && panel.isConnected) showPage();
    });
  }
  void syncProfileFriends();
};

const pendingFriendSync = new Map();
let syncingFriends = false;
const syncProfileFriends = async () => {
  if (syncingFriends) return;
  syncingFriends = true;
  try {
    for (const [id] of pendingFriendSync) {
      let delay = 1_000;
      try {
        const response = await fetch(`/api/steam-friend-sync?${new URLSearchParams({ id })}`, {
          method: 'POST', signal: AbortSignal.timeout(25_000),
        });
        if (response.ok) {
          const score = await response.json();
          pendingFriendSync.get(id)?.(score);
        } else if ([429, 502, 503].includes(response.status)) {
          const retryAfter = Number(response.headers.get('Retry-After')) * 1_000;
          delay = Math.max(15_000, Math.min(retryAfter, 120_000));
        }
      } catch {
        delay = 15_000;
      } finally {
        pendingFriendSync.delete(id);
      }
      await new Promise((resolve) => window.setTimeout(resolve, delay));
    }
  } finally {
    syncingFriends = false;
  }
};

const loadSavedProfile = async (platform, id) => {
  try {
    const params = new URLSearchParams({ platform, id });
    const response = await fetch(`/api/saved-profile?${params}`, { signal: AbortSignal.timeout(5_000) });
    if (response.ok) return (await response.json()).games;
  } catch {
    // The live profile can still load if saved data is unavailable.
  }
  return [];
};

const profileLinkServices = new Map([
  ['website', ['Personal website', 'profile-links/globe']],
  ['github', ['GitHub', 'github']],
  ['linkedin', ['LinkedIn', 'profile-links/linkedin']],
  ['youtube', ['YouTube', 'profile-links/youtube']],
  ['instagram', ['Instagram', 'profile-links/instagram']],
  ['facebook', ['Facebook', 'profile-links/facebook']],
  ['x', ['X', 'profile-links/twitter-x']],
]);

const showExternalProfileLinks = async (container, platform, id) => {
  if (!platform || !/^\d{1,20}$/.test(id)) return;
  try {
    const params = new URLSearchParams({ platform, id });
    const response = await fetch(`/api/profile-links?${params}`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok || !container.isConnected) return;
    const { links } = await response.json();
    for (const { service, url } of links) {
      const entry = profileLinkServices.get(service);
      if (!entry || !URL.canParse(url) || new URL(url).protocol !== 'https:') continue;
      const [name, icon] = entry;
      const label = t(name);
      const link = steamLink(url);
      link.classList.add('profile-icon-link');
      link.setAttribute('aria-label', label);
      link.title = label;
      link.append(menuItemIcon(icon));
      container.append(link);
    }
  } catch {
    // External links are optional when the database is unavailable.
  }
};

const renderPlayerProfile = async (route) => {
  const page = createElement('section', { className: 'profile-page', attributes: { 'aria-labelledby': 'profile-title' } });
  const hero = createElement('header', { className: 'profile-hero surface' });
  const title = createElement('h1', { text: t('Profile'), attributes: { id: 'profile-title' } });
  const identity = createElement('div');
  const nameRow = createElement('div', { className: 'profile-name-row' });
  nameRow.append(title);
  identity.append(nameRow);
  hero.append(identity);
  const status = createElement('p', { className: 'profile-status', attributes: { role: 'status' } });
  identity.append(status);
  page.append(hero);
  elements.routeView.replaceChildren(page);
  document.title = `${t('Profile')} | ${APP_NAME}`;

  const selectedPlayer = state.player;
  const shared = route.profile?.match(/^(steam|xbox):(.+)$/u);
  if (route.profile !== null && !shared) {
    status.textContent = t('This player profile link is invalid.');
    return;
  }
  const player = shared ? createPlayer(shared[2], shared[1]) : selectedPlayer;
  if (!player) {
    status.textContent = t('Search for a player to view their profile.');
    return;
  }
  const stale = () => !page.isConnected || (!shared && player !== state.player);
  if (player.failedReports && !player.accounts.size) {
    status.textContent = playerLookupErrors(player.failedReports).join(' ');
    return;
  }
  status.textContent = t('Looking up achievements…');
  // Each collection includes its subgames. Query it once and count its achievements once.
  const collections = playerCollections;
  const progress = new Map();
  const unlockedByGame = new Map();
  const failedGames = new Map();
  let usingSavedProgress = false;
  const errors = new Set();
  const steamAccount = player.accounts.get('steam')
    ?? (shared?.[1] === 'steam' && /^7656\d{13}$/.test(player.id)
      ? { profileUrl: steamProfileUrl(player.id) } : null);
  const pendingSteamDetails = steamAccount && loadSteamProfile(steamAccount);
  const knownAccount = shared
    ? [...(selectedPlayer?.accounts.values() ?? [])].find((entry) =>
      entry.platform === shared[1] && [entry.accountId, entry.player].includes(player.id))
    : player.accounts.values().next().value;
  const savedProfile = shared ? loadSavedProfile(shared[1], player.id) : Promise.resolve([]);
  let portrait;
  const showIdentity = (account) => {
    const displayName = account.displayName || account.player;
    title.replaceChildren(createElement('bdi', { text: displayName }));
    portrait?.remove();
    portrait = createProfileAvatar({ player: displayName, avatarUrl: account.avatarUrl });
    hero.prepend(portrait);
    document.title = `${displayName} | ${APP_NAME}`;
  };
  if (knownAccount) showIdentity(knownAccount);
  void savedProfile.then(([saved]) => {
    if (!stale() && saved && !portrait) showIdentity(saved);
  });
  for (let offset = 0; offset < collections.length; offset += 3) {
    const batch = collections.slice(offset, offset + 3);
    const results = await Promise.all(batch.map((game) => progressForGame(player, game)));
    if (stale()) return;
    for (const [index, reports] of results.entries()) {
      const game = batch[index];
      const achievements = getAchievementsForGame(game);
      for (const report of reports) {
        if (!report?.error) continue;
        errors.add(report.error);
        if (['provider-unavailable', 'rate-limited', 'xbox-not-configured'].includes(report.error)) {
          if (!failedGames.has(report.platform)) failedGames.set(report.platform, new Set());
          failedGames.get(report.platform).add(game);
        }
      }
      for (const { platform, player: name, unlocks, firstUnlockAt, lastUnlockAt } of matchedPlayerProgress(achievements, reports)) {
        if (!unlockedByGame.has(game)) unlockedByGame.set(game, new Set());
        for (const [id, unlocked] of unlocks) {
          if (unlocked) unlockedByGame.get(game).add(id);
        }
        if (!progress.has(platform)) progress.set(platform, { platform, player: name, games: [] });
        progress.get(platform).games.push({
          game, unlocked: unlockCount(unlocks), reported: unlocks.size, total: achievements.length,
          firstUnlockAt, lastUnlockAt,
        });
      }
    }
  }

  const steamDetails = pendingSteamDetails ? await pendingSteamDetails : null;
  if (!player.accounts.has('steam') && steamDetails) {
    const { account } = steamDetails;
    if (stale()) return;
    if (account) player.accounts.set('steam', account);
  }
  const savedGames = shared ? await savedProfile : (
    await Promise.all([...player.accounts.values()].map(async (entry) =>
      (await loadSavedProfile(entry.platform, entry.accountId ?? entry.player))
        .map((game) => ({ ...game, platform: entry.platform }))))
  ).flat();
  if (stale()) return;
  const savedActivity = {};
  const savedUnlocks = new Map();
  for (const saved of savedGames) {
    const { game, player: name, accountId, unlocked, minutes, lastPlayed } = saved;
    const platform = saved.platform ?? shared?.[1];
    if (platform === 'steam' && steamDetails?.private) continue;
    if (platform === 'steam') savedActivity[game] = { minutes, lastPlayed };
    if (!failedGames.get(platform)?.has(game) || unlocked == null) continue;
    if (!progress.has(platform)) progress.set(platform, { platform, player: name, games: [] });
    progress.get(platform).games.push(saved);
    savedUnlocks.set(game, Math.max(savedUnlocks.get(game) ?? 0, unlocked));
    if (!player.accounts.has(platform)) {
      const profileUrl = platform === 'steam' ? steamProfileUrl(accountId)
        : `https://www.xbox.com/en-US/play/user/${encodeURIComponent(name)}`;
      player.accounts.set(platform, { ...saved, platform, profileUrl });
    }
    usingSavedProgress = true;
  }
  const account = player.accounts.values().next().value;
  if (account) {
    const savedIdentity = savedGames.find(({ accountId, platform }) =>
      accountId === account.accountId && (platform ?? shared?.[1]) === account.platform);
    const previousIdentity = knownAccount?.accountId === account.accountId && knownAccount?.platform === account.platform
      ? knownAccount : null;
    showIdentity({
      ...account,
      displayName: (account.displayName && account.displayName !== account.player)
        ? account.displayName : savedIdentity?.displayName ?? previousIdentity?.displayName ?? account.displayName,
      avatarUrl: account.avatarUrl ?? savedIdentity?.avatarUrl ?? previousIdentity?.avatarUrl,
    });
    if (!shared) window.history.replaceState(window.history.state, '', profileHref(account));
  }
  if (!progress.size && player.accounts.has('steam')) {
    progress.set('steam', { platform: 'steam', player: player.accounts.get('steam').player, games: [] });
  }
  if (!progress.size) {
    const links = createElement('div', { className: 'profile-platforms' });
    nameRow.append(links);
    void showExternalProfileLinks(links, account?.platform ?? shared?.[1], account?.accountId ?? player.id);
    const error = [...errors].find((code) => code !== 'unsupported-game' && code !== 'no-game-data');
    status.textContent = t(PLAYER_ERRORS.get(error) ?? 'Could not load the player’s achievements. Try again.');
    return;
  }
  const platforms = createElement('div', { className: 'profile-platforms' });
  for (const [platform, profile] of player.accounts) {
    const link = steamLink(profile.profileUrl, platform === 'steam' ? '' : PLATFORM_NAMES[platform]);
    if (platform === 'steam') {
      link.classList.add('profile-steam-link');
      link.setAttribute('aria-label', t('View Steam profile'));
      link.title = t('View Steam profile');
      link.prepend(menuItemIcon('steam'));
    }
    platforms.append(link);
  }
  if (usingSavedProgress) status.textContent = t('Showing saved achievement progress where the live lookup failed.');
  else status.remove();
  nameRow.append(platforms);
  void showExternalProfileLinks(platforms, account?.platform ?? shared?.[1], account?.accountId ?? player.id);

  const { panels: [achievementPanel, screenshotPanel, friendPanel], addTab } = attachProfileTabs(page);
  const screenshotStatus = createElement('p', {
    attributes: { role: 'status' }, text: t('Loading screenshots…'),
  });
  screenshotPanel.append(screenshotStatus);

  const overall = createElement('div', { className: 'profile-overall-progress surface' });
  const total = collections.reduce((sum, game) => sum + getAchievementsForGame(game).length, 0);
  const unlocked = collections.reduce((sum, game) =>
    sum + Math.max(unlockedByGame.get(game)?.size ?? 0, savedUnlocks.get(game) ?? 0), 0);
  const label = createElement('p', {
    text: formatPlayerUnlocks({ unlocked, reported: total, total }),
    attributes: { id: 'profile-overall-label' },
  });
  overall.append(label, createElement('progress', {
    className: 'profile-game-progress',
    attributes: { value: unlocked, max: total, 'aria-labelledby': label.id },
  }));
  achievementPanel.append(overall);

  let steamSection;
  let firstSection;
  for (const platform of Object.keys(PLATFORM_NAMES)) {
    const platformProgress = progress.get(platform);
    if (!platformProgress) continue;
    const section = createProfileProgress(platformProgress, progress.size > 1);
    firstSection ??= section;
    if (platform === 'steam') steamSection = section;
    achievementPanel.append(section);
  }
  if (!progress.get('xbox')?.games.some(({ game }) => game === 'halo5')) {
    firstSection.querySelector('.profile-games').append(createProfileGame({ game: 'halo5' }, 'xbox'));
  }

  const steam = player.accounts.get('steam');
  screenshotStatus.textContent = t(steam ? 'Loading screenshots…' : 'No public Halo screenshots are available.');
  void setupProfileFriends(friendPanel, steam);
  if (!steam) return;
  const details = steamDetails ?? await loadSteamProfile(steam);
  if (stale()) return;
  if (details.location && account === steam) {
    const location = createElement('p', { className: 'profile-location' });
    const flag = steamCountryFlag(details.countryCode);
    if (flag) {
      flag.alt = '';
      location.append(flag);
    }
    location.append(details.location);
    identity.append(location);
  }
  if (account === steam && portrait) {
    setAvatarFrame(portrait, details);
    if (details.backgroundUrl) {
      page.classList.add('has-steam-background');
      page.style.setProperty('--steam-profile-background', `url(${JSON.stringify(details.backgroundUrl)})`);
    }
    if (details.backgroundVideoUrl && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const video = createElement('video', {
        className: 'profile-background-video',
        attributes: { src: details.backgroundVideoUrl, autoplay: '', loop: '', muted: '', playsinline: '', 'aria-hidden': 'true' },
      });
      video.muted = true;
      page.prepend(video);
    }
    if (details.presence) {
      const currentGame = GAME_CONFIG.get(details.currentGame);
      const presence = createElement('p', {
        className: `profile-presence is-${details.presence}`,
        text: currentGame ? t('Playing {game}', { game: currentGame.title })
          : t({ online: 'Online', offline: 'Offline', away: 'Away' }[details.presence]),
      });
      identity.append(presence);
    }
    if (details.joinedAt) {
      const date = new Intl.DateTimeFormat(currentLanguage(), { dateStyle: 'medium', timeZone: 'UTC' });
      identity.append(createElement('p', {
        className: 'profile-joined',
        text: t('Account Created: {date}', { date: date.format(details.joinedAt * 1000) }),
      }));
    }
  }
  if (details.reviews?.length) {
    const panel = addTab('Reviews');
    for (const { game, url, text, recommended } of details.reviews) {
      const review = createElement('article', { className: 'profile-review surface' });
      const heading = createElement('h2');
      heading.append(steamLink(url, GAME_CONFIG.get(game).title));
      review.append(
        heading,
        createElement('p', { text: t(recommended ? 'Recommended' : 'Not recommended') }),
        createElement('p', { className: 'profile-review-text', text }),
      );
      panel.append(review);
    }
  }
  if (steamSection) {
    for (const game of progress.get('steam').games) {
      const activity = createProfileActivity(game, details.games?.[game.game] ?? savedActivity[game.game]);
      steamSection.querySelector(`[data-profile-game="${game.game}"] .profile-game-activity`).replaceWith(activity);
    }
  }
  if (details.galleries?.length) screenshotPanel.replaceChildren(createSteamGalleries(details.galleries));
  else screenshotStatus.textContent = t('No public Halo screenshots are available.');
};

const steamProfileUrl = (accountId) => `https://steamcommunity.com/profiles/${encodeURIComponent(accountId)}/`;

const steamCountryFlag = (countryCode) => {
  if (!/^[a-z]{2}$/.test(countryCode)) return null;
  const countries = new Intl.DisplayNames(currentLanguage(), { type: 'region' });
  return createElement('img', {
    attributes: {
      src: `https://community.fastly.steamstatic.com/public/images/countryflags/${countryCode}.gif`,
      alt: countries.of(countryCode.toUpperCase()), width: 16, height: 11, referrerpolicy: 'no-referrer',
    },
  });
};

// Share successful appearance lookups across the leaderboard and Friends views.
const rankingAppearance = new Map();
const appearanceQueues = [Promise.resolve(), Promise.resolve()];
let nextAppearanceQueue = 0;

const loadRankingAppearance = (accountId, target) => {
  if (rankingAppearance.has(accountId)) return rankingAppearance.get(accountId);
  const queue = nextAppearanceQueue;
  nextAppearanceQueue = (queue + 1) % appearanceQueues.length;
  const request = appearanceQueues[queue].then(async () => {
    const player = { profileUrl: steamProfileUrl(accountId) };
    let details = await loadSteamProfile(player, 'appearance');
    if (target.isConnected && !Object.hasOwn(details, 'countryCode')) {
      await new Promise((resolve) => window.setTimeout(resolve, 750));
      if (target.isConnected) details = await loadSteamProfile(player, 'appearance');
    }
    if (!Object.hasOwn(details, 'countryCode')) rankingAppearance.delete(accountId);
    return details;
  });
  appearanceQueues[queue] = request;
  rankingAppearance.set(accountId, request);
  return request;
};

const createRankingTable = (game, label, onSort) => {
  const results = createElement('div', {
    className: 'leaderboard-results surface',
    attributes: { role: 'region', tabindex: '0', ...label },
  });
  const number = new Intl.NumberFormat(currentLanguage());
  const hours = new Intl.NumberFormat(currentLanguage(), {
    style: 'unit', unit: 'hour', unitDisplay: 'long', maximumFractionDigits: 1,
  });
  const total = game === 'all'
    ? playerCollections.reduce((sum, id) => sum + getAchievementsForGame(id).length, 0)
    : getAchievementsForGame(game).length;
  const accounts = new WeakMap();
  const observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      observer.unobserve(target);
      const { accountId, avatar } = accounts.get(target);
      void loadRankingAppearance(accountId, target).then((details) => {
        if (!target.isConnected) return;
        setAvatarFrame(avatar, details);
        const flag = steamCountryFlag(details.countryCode);
        if (flag) target.append(flag);
      });
    }
  });
  const table = createElement('table');
  const header = table.createTHead().insertRow();
  const body = table.createTBody();
  const columns = [
    ['rank', 'Rank'], ['player', 'Player', 'asc'], ['platform', 'Platform', 'asc'],
    ['unlocked', 'Achievements', 'desc'], ['minutes', 'Time played', 'desc'],
  ];
  let sort = 'unlocked';
  let direction = 'desc';
  const headers = new Map();
  const showSort = () => {
    for (const [key, cell] of headers) {
      if (key === sort) cell.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
      else cell.removeAttribute('aria-sort');
    }
  };
  for (const [key, title, initialDirection] of columns) {
    const cell = createElement('th', { attributes: { scope: 'col' } });
    header.append(cell);
    if (!initialDirection) {
      cell.textContent = t(title);
      continue;
    }
    const button = createElement('button', { text: t(title), attributes: { type: 'button' } });
    const indicator = menuItemIcon('chevron-up');
    indicator.classList.add('leaderboard-sort-indicator');
    button.append(indicator);
    button.addEventListener('click', () => {
      direction = sort === key ? (direction === 'asc' ? 'desc' : 'asc') : initialDirection;
      sort = key;
      showSort();
      onSort();
    });
    cell.append(button);
    headers.set(key, cell);
  }
  showSort();
  results.append(table);

  const showRows = (players, emptyMessage) => {
    observer.disconnect();
    body.replaceChildren();
    if (!players.length) {
      const empty = body.insertRow().insertCell();
      empty.colSpan = columns.length;
      empty.textContent = t(emptyMessage);
    }

    for (const player of players) {
      const row = body.insertRow();
      row.insertCell().textContent = player.rank == null ? '—' : number.format(player.rank);
      const name = createElement('th', { attributes: { scope: 'row' } });
      const identity = createElement('span', { className: 'leaderboard-identity' });
      const link = createElement('a', {
        className: 'leaderboard-identity',
        attributes: { href: profileHref(player), 'data-route': '' },
      });
      const avatar = createProfileAvatar({ player: player.displayName, avatarUrl: player.avatarUrl });
      avatar.classList.add('leaderboard-avatar');
      link.append(avatar, createElement('bdi', { text: player.displayName }));
      identity.append(link);
      name.append(identity);
      row.append(name);
      const isSteam = player.platform === 'steam';
      if (isSteam && player.accountId) {
        accounts.set(identity, { accountId: player.accountId, avatar });
        observer.observe(identity);
      }
      const platform = steamLink(isSteam ? steamProfileUrl(player.accountId)
        : `https://www.xbox.com/en-US/play/user/${encodeURIComponent(player.player)}`);
      platform.classList.add('leaderboard-identity');
      platform.append(menuItemIcon(player.platform), PLATFORM_NAMES[player.platform]);
      row.insertCell().append(platform);
      row.insertCell().textContent = t('{unlocked} of {total}', {
        unlocked: number.format(player.unlocked ?? 0), total: number.format(total),
      });
      row.insertCell().textContent = player.minutes == null ? '—' : hours.format(player.minutes / 60);
    }
  };

  return { results, showRows, get sort() { return sort; }, get direction() { return direction; } };
};

let refreshLeaderboard;

const renderLeaderboard = (game) => {
  const section = createElement('section', { className: 'leaderboard-page' });
  const config = GAME_CONFIG.get(game) ?? { icon: 'assets/trophy.svg', title: t('All Games') };
  const heading = createElement('h1', { text: config.title, attributes: { id: 'leaderboard-title' } });
  section.setAttribute('aria-labelledby', heading.id);
  const { search, searchInput } = createGameSearch('leaderboard-search', 'Search Leaderboard', 'leaderboard-results');
  searchInput.maxLength = 100;
  const status = createElement('p', { className: 'leaderboard-status', attributes: { role: 'status' } });
  const ranking = createRankingTable(game, { 'aria-labelledby': heading.id }, () => void update());
  ranking.results.id = 'leaderboard-results';
  section.append(createGameHeader(config, heading, search), status, ranking.results);
  elements.routeView.replaceChildren(section);
  document.title = `${config.title} | ${t('Leaderboards')} | ${APP_NAME}`;

  let controller;
  let searchTimer;
  const update = async () => {
    if (!section.isConnected) return;
    window.clearTimeout(searchTimer);
    controller?.abort();
    const request = new AbortController();
    controller = request;
    const search = searchInput.value.trim();
    const query = new URLSearchParams({ game, sort: ranking.sort, direction: ranking.direction, search });
    status.textContent = t('Loading leaderboard…');

    try {
      const response = await fetch(`/api/leaderboard?${query}`, {
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]),
      });
      if (!response.ok) throw new Error('Leaderboard unavailable');
      const { players } = await response.json();
      if (!section.isConnected || request.signal.aborted) return;
      status.textContent = '';
      ranking.showRows(players, search ? 'No matching players.' : 'No players have recorded progress for this ranking yet.');
    } catch {
      if (!request.signal.aborted && section.isConnected) {
        status.textContent = t('Could not load the leaderboard. Try again.');
      }
    }
  };
  searchInput.addEventListener('input', () => {
    controller?.abort();
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(update, 250);
  });
  refreshLeaderboard = update;
  void update();
};

const renderRoute = ({ focus = false, fromHistory = false } = {}) => {
  let route = getRoute();
  const previous = state.renderedRoute;
  const guide = route.page === 'achievements' && route.achievement
    ? getAchievementsForGame(route.game).find((entry) => entry.id === route.achievement && hasGuide(entry))
    : null;
  if (route.achievement !== null && !guide) {
    const url = new URL(window.location.href);
    url.searchParams.delete('achievement');
    window.history.replaceState(null, '', url);
    route = getRoute();
  }
  state.renderedRoute = route;
  updateActiveNavigation(route);
  setSidebarOpen(false);

  if (route.page === 'search') {
    renderHome();
  } else if (guide) {
    renderGuide(route.game, guide);
  } else if (route.page === 'achievements') {
    renderAchievements(route.game);
  } else if (route.page === 'profile') {
    void renderPlayerProfile(route);
  } else if (route.page === 'leaderboard') {
    renderLeaderboard(route.game);
  } else if (route.page === 'settings') {
    renderSettings();
  } else if (route.page === 'release-notes') {
    renderReleaseNotes();
  } else {
    renderNotFound();
  }

  const listPosition = fromHistory && route.page === 'achievements' && !guide && previous?.game === route.game
    ? window.history.state?.achievementListPosition
    : null;
  const returnLink = listPosition && elements.routeView.querySelector(
    `[data-achievement-id="${CSS.escape(listPosition.id)}"]`,
  );
  if (focus) {
    (returnLink || document.querySelector('#guide-title') || elements.mainContent).focus({ preventScroll: true });
  }
  elements.mainContent.scrollTop = listPosition?.main ?? 0;
  window.scrollTo({ top: listPosition?.window ?? 0, behavior: 'auto' });
};

document.addEventListener('click', (event) => {
  const routeLink = event.target.closest('a[data-route]');
  if (
    !routeLink
    || event.defaultPrevented
    || event.button !== 0
    || event.metaKey
    || event.ctrlKey
    || event.shiftKey
    || event.altKey
  ) {
    return;
  }

  const destination = new URL(routeLink.href, window.location.href);
  if (destination.origin !== window.location.origin) {
    return;
  }

  event.preventDefault();
  if (elements.playerProfileMenu.contains(routeLink)) elements.playerProfileMenu.hidePopover();
  if (routeLink.dataset.achievementId) {
    window.history.replaceState({
      ...window.history.state,
      achievementListPosition: {
        id: routeLink.dataset.achievementId,
        main: elements.mainContent.scrollTop,
        window: window.scrollY,
      },
    }, '');
  }
  window.history.pushState(null, '', getNavigationUrl(destination));
  renderRoute({ focus: true });
});

const closeSidebar = () => {
  setSidebarOpen(false);
  elements.menuToggle.focus();
};

elements.menuToggle.addEventListener('click', () => {
  if (state.sidebarOpen) {
    closeSidebar();
    return;
  }
  setSidebarOpen(true);
  elements.sidebar.querySelector('a').focus();
});
elements.drawerBackdrop.addEventListener('click', closeSidebar);
elements.achievementsToggle.addEventListener('click', () => {
  setGamesExpanded(elements.achievementsToggle.getAttribute('aria-expanded') !== 'true');
});
window.addEventListener('popstate', () => renderRoute({ focus: true, fromHistory: true }));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.sidebarOpen) {
    closeSidebar();
  }
});

desktopMediaQuery.addEventListener('change', () => {
  const focusWasInSidebar = elements.sidebar.contains(document.activeElement);
  setSidebarOpen(false);
  if (focusWasInSidebar && !desktopMediaQuery.matches) {
    elements.menuToggle.focus();
  }
});

elements.playerLookup.addEventListener('submit', (event) => {
  event.preventDefault();
  const id = elements.playerId.value.trim();
  if (!id) {
    elements.playerId.value = '';
    elements.playerId.reportValidity();
    return;
  }

  state.player?.controller.abort();
  savePlayerSession(null);
  const player = createPlayer(id);
  state.player = player;

  const route = state.renderedRoute;
  if (route.page === 'profile') {
    window.history.pushState(null, '', '?page=profile');
    void refreshSelectedPlayer(player, 'halomcc');
    renderRoute();
    return;
  }
  const game = route.page === 'achievements' ? GAME_CONFIG.get(route.game) : undefined;
  if (game) {
    if (route.achievement) {
      const card = elements.routeView.querySelector('.guide-page > .achievement-card');
      const achievement = getAchievementsForGame(route.game).find(({ id }) => id === route.achievement);
      if (card && achievement) updateGuideCard(card, achievement, player, game.collection);
    } else {
      renderAchievements(route.game);
    }
  }
  void refreshSelectedPlayer(player, game?.collection ?? 'halomcc').then((reports) => {
    if (state.player !== player || player.accounts.size || state.renderedRoute !== route) return;
    player.failedReports = reports;
    window.history.pushState(null, '', getNavigationUrl('?page=profile'));
    renderRoute({ focus: true });
  });
});

elements.playerAvatar.addEventListener('load', () => {
  elements.playerAvatar.hidden = false;
  elements.playerInitial.hidden = true;
});

document.querySelector('#player-sign-out').addEventListener('click', () => {
  elements.playerProfileMenu.hidePopover();
  state.player?.controller.abort();
  state.player = null;
  savePlayerSession(null);
  elements.playerId.value = '';
  updatePlayerHeader();
  renderRoute();
  elements.playerId.focus({ preventScroll: true });
});

const header = document.querySelector('.app-header');
const updateHeaderOffset = () => {
  document.documentElement.style.setProperty('--header-offset', `${header.offsetHeight}px`);
};
new ResizeObserver(updateHeaderOffset).observe(header);

canonicalizeUrl();
try {
  await setLanguage(savedLanguage());
} catch {
  showToast(t('Unable to load the selected language.'));
}
localizeShell();
updateHeaderOffset();
restorePlayer();
renderRoute();
