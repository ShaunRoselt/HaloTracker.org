'use strict';

import { ACHIEVEMENTS } from './achievements.js';
import {
  achievementText, achievementTextLocale, compareNames, currentLanguage,
  formatAchievementCount, formatPercent,
  LANGUAGES, savedLanguage, setLanguage, t, translateReleaseNotes,
} from './i18n.js';

const APP_NAME = 'Halo Achievement Tracker';
const APP_VERSION = '1.3.0';
const RELEASE_DATE = '2026/11/23';
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
  Object.freeze({ value: 'Other', label: 'Other (Not Filtered Yet)' }),
]);

const compareUnlockRate = (a, b) => Number.parseFloat(a.percentAchieved) - Number.parseFloat(b.percentAchieved);
const ACHIEVEMENT_SORTS = new Map([
  ['unlock-desc', { label: 'Most unlocked', compare: (a, b) => compareUnlockRate(b, a) }],
  ['unlock-asc', { label: 'Least unlocked', compare: compareUnlockRate }],
  ['name-asc', { label: 'Name (A–Z)', compare: compareNames }],
  ['name-desc', { label: 'Name (Z–A)', compare: (a, b) => compareNames(b, a) }],
]);

const sortAchievements = (achievements, sort) => {
  return achievements.toSorted(ACHIEVEMENT_SORTS.get(sort).compare);
};

const GAME_CONFIG = new Map([
  ['halomcc', Object.freeze({
    collection: 'halomcc',
    title: 'Halo: The Master Chief Collection',
    shortTitle: 'Halo MCC (All)',
    icon: 'assets/halo-mcc.png',
    hero: 'assets/background-mcc.jpg',
  })],
  ['haloreach', Object.freeze({
    collection: 'halomcc',
    title: 'Halo: Reach',
    shortTitle: 'Halo Reach',
    icon: 'assets/halo-reach.png',
    hero: 'assets/background-mcc.jpg',
  })],
  ['haloce', Object.freeze({
    collection: 'halomcc',
    title: 'Halo: Combat Evolved',
    shortTitle: 'Halo CE',
    icon: 'assets/halo-ce.png',
    hero: 'assets/background-mcc.jpg',
  })],
  ['halo2', Object.freeze({
    collection: 'halomcc',
    title: 'Halo 2',
    shortTitle: 'Halo 2',
    icon: 'assets/halo-2.png',
    hero: 'assets/background-mcc.jpg',
  })],
  ['halo3', Object.freeze({
    collection: 'halomcc',
    title: 'Halo 3',
    shortTitle: 'Halo 3',
    icon: 'assets/halo-3.png',
    hero: 'assets/background-mcc.jpg',
  })],
  ['halo3odst', Object.freeze({
    collection: 'halomcc',
    title: 'Halo 3: ODST',
    shortTitle: 'Halo 3 ODST',
    icon: 'assets/halo-3-odst.png',
    hero: 'assets/background-mcc.jpg',
  })],
  ['halo4', Object.freeze({
    collection: 'halomcc',
    title: 'Halo 4',
    shortTitle: 'Halo 4',
    pveFilterLabel: 'Spartan Ops',
    icon: 'assets/halo-4.png',
    hero: 'assets/background-mcc.jpg',
  })],
  ['halo5', Object.freeze({
    collection: 'halo5',
    title: 'Halo 5: Guardians',
    shortTitle: 'Halo 5',
    icon: 'assets/halo-5.png',
    hero: 'assets/halo5.jpg',
  })],
  ['haloinfinite', Object.freeze({
    collection: 'haloinfinite',
    title: 'Halo Infinite',
    shortTitle: 'Halo Infinite',
    icon: 'assets/halo-infinite.png',
    hero: 'assets/background-infinite.jpg',
  })],
  ['halowarsde', Object.freeze({
    collection: 'halowarsde',
    title: 'Halo Wars: Definitive Edition',
    shortTitle: 'Halo Wars: DE',
    pveFilterLabel: 'Skirmish',
    icon: 'assets/halowarsde.png',
  })],
  ['halospartanstrike', Object.freeze({
    collection: 'halospartanstrike',
    title: 'Halo: Spartan Strike',
    shortTitle: 'Halo: Spartan Strike',
    icon: 'assets/halospartanstrike.png',
  })],
  ['halospartanassault', Object.freeze({
    collection: 'halospartanassault',
    title: 'Halo: Spartan Assault',
    shortTitle: 'Halo: Spartan Assault',
    icon: 'assets/halospartanassault.png',
  })],
  ['halocampaignevolved', Object.freeze({
    collection: 'halocampaignevolved',
    title: 'Halo: Campaign Evolved',
    shortTitle: 'Halo: Campaign Evolved',
    icon: 'assets/halocampaignevolved.png',
  })],
]);

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

const achievementById = new Map(
  Object.values(ACHIEVEMENTS)
    .flat()
    .map((achievement) => [achievement.id, achievement]),
);

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
  guideClose: document.querySelector('#guide-close'),
  guideContent: document.querySelector('#guide-content'),
  guideDialog: document.querySelector('#guide-dialog'),
  guideScroll: document.querySelector('#guide-scroll'),
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
  const game = url.searchParams.get('game')?.trim().toLowerCase() || 'halomcc';

  const achievement = url.searchParams.get('achievement');

  return Object.freeze({ page, game, achievement });
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

const updateActiveNavigation = ({ page, game }) => {
  for (const navigationItem of document.querySelectorAll('[data-page]')) {
    const matchesPage = navigationItem.dataset.page === page;
    const matchesGame = page !== 'achievements' || navigationItem.dataset.game === game;
    const isActive = matchesPage && matchesGame;

    navigationItem.classList.toggle('is-active', isActive);
    if (isActive) {
      navigationItem.setAttribute('aria-current', 'page');
    } else {
      navigationItem.removeAttribute('aria-current');
    }
  }

  if (page === 'achievements') {
    setGamesExpanded(true);
  }
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

const updatePlayerHeader = () => {
  const account = state.player?.accounts.values().next().value;
  elements.playerLookup.hidden = Boolean(account);
  elements.playerProfile.hidden = !account;
  const avatarUrl = account?.avatarUrl ?? null;
  if (elements.playerAvatar.getAttribute('src') !== avatarUrl) {
    elements.playerAvatar.hidden = true;
    elements.playerInitial.hidden = false;
    if (avatarUrl) elements.playerAvatar.src = avatarUrl;
    else elements.playerAvatar.removeAttribute('src');
  }
  if (!account) return;

  document.querySelector('#player-profile-trigger').setAttribute('aria-label',
    t('Profile for {player}', { player: account.player }));
  document.querySelector('#player-profile-name').textContent = account.player;
  elements.playerInitial.textContent = Array.from(account.player)[0].toLocaleUpperCase();
  document.querySelector('#player-sign-out span').textContent = t('Sign Out');

  document.querySelector('#player-profile-link span').textContent = t('Profile');
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
  elements.drawerBackdrop.setAttribute('aria-label', t('Close navigation'));
  elements.guideClose.setAttribute('aria-label', t('Close guide'));
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

const getAchievementsForGame = (game) => {
  const config = GAME_CONFIG.get(game);
  if (!config) {
    return [];
  }

  const collection = ACHIEVEMENTS[config.collection];
  if (game === 'halomcc' || config.collection !== 'halomcc') {
    return collection;
  }

  return collection.filter(({ games }) => games.includes(game));
};

const hasGuide = ({ guideDescription, guideVideos }) => (
  guideDescription.trim().length > 0 || guideVideos.length > 0
);

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

const createAchievementCard = (achievement, index, progress) => {
  const guideAvailable = hasGuide(achievement);
  const card = createElement('article', {
    className: `achievement-card${guideAvailable ? ' has-guide' : ''}`,
  });

  const image = createImage({
    source: achievement.image,
    alt: '',
    className: 'achievement-image',
    eager: index < 8,
  });
  image.width = 78;
  image.height = 78;

  const body = createElement('div', { className: 'achievement-body' });
  const heading = createElement('h3', {
    className: 'achievement-name',
    text: achievement.name,
    attributes: { lang: 'en', dir: 'auto' },
  });
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
  if (guideAvailable) {
    card.append(createElement('button', {
      className: 'achievement-guide-button',
      attributes: {
        type: 'button',
        'data-achievement-id': achievement.id,
        'aria-label': t('Open guide for {achievement}', { achievement: achievement.name }),
      },
    }));
  }

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

const renderAchievementCards = ({ achievements, activeFilters, searching, count, list, playerProgress }) => {
  const filteredAchievements = achievements.filter(({ filters }) => (
    filters.some((filter) => activeFilters.has(filter))
  ));
  const fragment = document.createDocumentFragment();

  const cards = new Map();
  filteredAchievements.forEach((achievement, index) => {
    const card = createAchievementCard(achievement, index, playerProgress);
    cards.set(achievement, card);
    fragment.append(card);
  });

  if (filteredAchievements.length === 0) {
    fragment.append(createElement('p', {
      className: 'empty-state surface',
      text: t(searching ? 'No achievements match your search and filters.' : 'No achievements match the selected filters.'),
    }));
  }

  count.textContent = formatAchievementCount(filteredAchievements.length).toLocaleUpperCase(currentLanguage());
  list.replaceChildren(fragment);
  return cards;
};

async function fetchPlayerProgress(player, collection) {
  try {
    const response = await fetch('/api/player-achievements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: player.id, game: collection }),
      signal: player.controller.signal,
    });
    return await response.json();
  } catch {
    return { error: 'provider-unavailable' };
  }
}

const createPlayer = (id) => ({
  id,
  accounts: new Map(),
  games: new Map(),
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
  void progressForGame(state.player, session.collection);
};

const progressForGame = (player, collection) => {
  if (!player.games.has(collection)) {
    const request = fetchPlayerProgress(player, collection).then((result) => {
      const reports = Array.isArray(result?.results) ? result.results : [result];
      if (state.player === player) {
        const accountCount = player.accounts.size;
        for (const report of reports) {
          if (report?.player && report.profileUrl && !player.accounts.has(report.platform)) {
            player.accounts.set(report.platform, report);
          }
        }
        if (accountCount !== player.accounts.size) {
          if (!accountCount) savePlayerSession({ id: player.id, collection });
          updatePlayerHeader();
        }
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

const achievementNameKey = (name) => name.normalize('NFC').trim().replaceAll('’', "'").toLowerCase();

const matchUnlocks = (achievements, reported) => {
  const byName = new Map();
  for (const { name, unlocked } of reported) {
    const key = achievementNameKey(name);
    byName.set(key, byName.has(key) && byName.get(key) !== unlocked ? null : unlocked);
  }

  const matches = new Map();
  for (const achievement of achievements) {
    const unlocked = byName.get(achievementNameKey(achievement.name));
    if (typeof unlocked === 'boolean') matches.set(achievement.id, unlocked);
  }
  return matches;
};

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
  const heroText = createElement('div', { className: 'game-hero-text' });
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

  const search = createElement('div', { className: 'achievement-search' });
  const searchLabel = createElement('label', {
    className: 'achievement-search-label',
    text: t('Search achievements'),
    attributes: { for: 'achievement-search' },
  });
  const searchInput = createElement('input', {
    attributes: {
      id: 'achievement-search',
      type: 'search',
      placeholder: t('Search achievements'),
      autocomplete: 'off',
      'aria-controls': 'achievement-list',
    },
  });
  searchInput.value = state.searchByGame.get(game) ?? '';
  search.append(searchLabel, searchInput);

  heroText.append(title);
  heroOverlay.append(gameIcon, heroText, search);
  hero.append(heroOverlay);

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
    ['all', 'All statuses', 'list'], ['unlocked', 'Unlocked', 'unlock'], ['locked', 'Locked', 'lock'],
  ]) {
    const option = createElement('option', { attributes: { value } });
    option.append(menuItemIcon(icon), t(label));
    unlockFilter.append(option);
  }

  if (player) {
    playerStatus.textContent = t('Looking up achievements…');
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
    text: t('Sort by'),
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
    const status = unlockFilter.value;
    const matches = achievements.filter((achievement) => (
      terms.every((term) => searchableText.get(achievement).includes(term))
      && (status === 'all' || playerProgress.some(
        ({ unlocks }) => unlocks.get(achievement.id) === (status === 'unlocked')
      ))
    ));
    return renderAchievementCards({
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
    cards = renderResults();
  });

  if (player) {
    void progressForGame(player, config.collection).then((reports) => {
      if (state.player !== player || !playerInfo.isConnected) return;
      playerProgress = matchedPlayerProgress(achievements, reports);

      playerStatus.replaceChildren();
      if (!playerProgress.length) {
        for (const report of reports) {
          const message = PLAYER_ERRORS.get(report?.error) ?? (report?.achievements
            ? 'No public achievement data is available for this player in this game.'
            : 'Could not load the player’s achievements. Try again.');
          const prefix = reports.length > 1 ? PLATFORM_NAMES[report?.platform] + ' · ' : '';
          playerStatus.append(createElement('p', { text: prefix + t(message) }));
        }
        return;
      }

      for (const { player: name, platform, unlocks } of playerProgress) {
        const result = createElement('p');
        const playerName = createElement('bdi', { className: 'player-progress-name', text: name });
        const total = createElement('span', {
          text: formatPlayerUnlocks({
            unlocked: unlockCount(unlocks),
            reported: unlocks.size,
            total: achievements.length,
          }),
        });
        result.append(PLATFORM_NAMES[platform] + ' · ', playerName, ' · ', total);
        playerStatus.append(result);
      }
      unlockFilter.hidden = false;
      for (const [achievement, card] of cards) {
        appendUnlockStatuses(card.querySelector('.achievement-metadata'), achievement.id, playerProgress);
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
  list.addEventListener('click', (event) => {
    const guideTrigger = event.target.closest('[data-achievement-id]');
    if (!guideTrigger) {
      return;
    }

    const achievement = achievementById.get(guideTrigger.dataset.achievementId);
    if (achievement) {
      const url = new URL(window.location.href);
      url.searchParams.set('achievement', achievement.id);
      window.history.pushState({ guideFromList: achievement.id }, '', url);
      syncGuide(getRoute());
    }
  });

  listRegion.append(listTitle, sortStatus, list);
  const browser = createElement('div', { className: 'achievement-browser' });
  browser.append(filterPanel, listRegion);
  page.append(hero, summary, browser);
  elements.routeView.replaceChildren(page);
  document.title = `${t('{game} Achievements', { game: t(config.shortTitle) })} | ${APP_NAME}`;
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

const openGuide = (achievement) => {
  const article = createElement('article', { className: 'guide-content' });
  const header = createElement('header', { className: 'guide-header' });
  const image = createImage({
    source: achievement.image,
    alt: '',
    className: 'guide-image',
    eager: true,
  });
  image.width = 96;
  image.height = 96;
  const headingGroup = createElement('div');
  const eyebrow = createElement('p', {
    className: 'eyebrow',
    text: t('{percent} of players have this achievement', { percent: formatPercent(achievement.percentAchieved) }),
  });
  const title = createElement('h2', {
    text: achievement.name,
    attributes: { id: 'guide-title', lang: 'en', dir: 'auto' },
  });
  const description = createElement('p', {
    className: 'guide-summary',
    text: achievementText(achievement, 'description'),
    attributes: { lang: achievementTextLocale(achievement, 'description'), dir: 'auto' },
  });
  headingGroup.append(eyebrow, title, description);
  header.append(image, headingGroup);
  article.append(header);

  if (achievement.guideDescription.trim()) {
    const guideSection = createElement('section', {
      className: 'guide-section',
      attributes: { 'aria-labelledby': 'guide-steps-title' },
    });
    const guideTitle = createElement('h3', {
      text: t('Guide'),
      attributes: { id: 'guide-steps-title' },
    });
    const guideText = createElement('p', {
      className: 'guide-description',
      text: achievementText(achievement, 'guideDescription'),
      attributes: { lang: achievementTextLocale(achievement, 'guideDescription'), dir: 'auto' },
    });
    guideSection.append(guideTitle, guideText);
    article.append(guideSection);
  }

  const validVideos = achievement.guideVideos.filter(isAllowedVideoUrl);
  if (validVideos.length > 0) {
    const videoSection = createElement('section', {
      className: 'guide-section',
      attributes: { 'aria-labelledby': 'guide-videos-title' },
    });
    const videoTitle = createElement('h3', {
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
    article.append(videoSection);
  }

  elements.guideContent.replaceChildren(article);
  elements.guideDialog.dataset.achievementId = achievement.id;
  elements.guideDialog.showModal();
  elements.guideScroll.scrollTop = 0;
};

const hideGuide = () => {
  if (elements.guideDialog.open) {
    elements.guideDialog.close();
    elements.guideContent.replaceChildren();
  }
};

const syncGuide = (route) => {
  const requestedGuide = route.page === 'achievements' && route.achievement
    ? getAchievementsForGame(route.game).find(({ id }) => id === route.achievement)
    : null;

  if (requestedGuide && hasGuide(requestedGuide)) {
    if (elements.guideDialog.open && elements.guideDialog.dataset.achievementId === requestedGuide.id) {
      return;
    }
    hideGuide();
    openGuide(requestedGuide);
    return;
  }

  hideGuide();
  if (route.achievement !== null) {
    const url = new URL(window.location.href);
    url.searchParams.delete('achievement');
    window.history.replaceState(null, '', url);
  }
};

const dismissGuide = () => {
  const url = new URL(window.location.href);
  if (!elements.guideDialog.open) {
    return;
  }
  hideGuide();

  if (window.history.state?.guideFromList === url.searchParams.get('achievement')) {
    window.history.back();
  } else {
    url.searchParams.delete('achievement');
    window.history.replaceState(null, '', url);
  }
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
  elements.routeView.replaceChildren(translateReleaseNotes(template.content.cloneNode(true)));
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

const createProfileGame = ({ game, unlocked, reported, total }, platform) => {
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
  heading.append(icon, link);

  const progress = createElement('progress', {
    className: 'profile-game-progress',
    attributes: { value: unlocked, max: total, 'aria-labelledby': headingId },
  });
  const count = createElement('p', { className: 'profile-game-count', text: formatPlayerUnlocks({ unlocked, reported, total }) });
  const item = createElement('li', { className: 'profile-game surface' });
  item.append(heading, progress, count);
  return item;
};

const createProfileProgress = ({ platform, player, games }, hasMultiplePlatforms) => {
  const headingId = `profile-progress-${platform}`;
  const section = createElement('section', {
    className: 'profile-progress',
    attributes: { 'aria-labelledby': headingId },
  });
  const heading = createElement('h2', { attributes: { id: headingId } });
  if (hasMultiplePlatforms) {
    heading.append(PLATFORM_NAMES[platform], ' · ', createElement('bdi', { text: player }));
  } else {
    heading.textContent = t('Achievements');
  }
  const totals = createElement('dl', { className: 'profile-totals surface' });
  for (const [label, value] of [
    ['Unlocked', games.reduce((sum, game) => sum + game.unlocked, 0)],
    ['Games tracked', games.length],
    ['Games completed', games.filter(({ unlocked, total }) => unlocked === total).length],
  ]) {
    const stat = createElement('div');
    stat.append(createElement('dt', { text: t(label) }), createElement('dd', { text: value.toLocaleString(currentLanguage()) }));
    totals.append(stat);
  }
  const gameList = createElement('ul', { className: 'profile-games' });
  gameList.append(...games.map((game) => createProfileGame(game, platform)));
  section.append(heading, totals, gameList);
  return section;
};

const renderPlayerProfile = async () => {
  const page = createElement('section', { className: 'profile-page', attributes: { 'aria-labelledby': 'profile-title' } });
  const hero = createElement('header', { className: 'profile-hero surface' });
  const title = createElement('h1', { text: t('Profile'), attributes: { id: 'profile-title' } });
  const identity = createElement('div');
  identity.append(title);
  hero.append(identity);
  const status = createElement('p', { className: 'profile-status', attributes: { role: 'status' } });
  identity.append(status);
  page.append(hero);
  elements.routeView.replaceChildren(page);
  document.title = `${t('Profile')} | ${APP_NAME}`;

  const player = state.player;
  if (!player) {
    status.textContent = t('Search for a player to view their profile.');
    return;
  }
  status.textContent = t('Looking up achievements…');
  // Each collection includes its subgames. Query it once and count its achievements once.
  const collections = [...new Set([...GAME_CONFIG.values()].map(({ collection }) => collection))];
  const progress = new Map();
  const errors = new Set();
  for (let offset = 0; offset < collections.length; offset += 3) {
    const batch = collections.slice(offset, offset + 3);
    const results = await Promise.all(batch.map((game) => progressForGame(player, game)));
    if (player !== state.player || !page.isConnected) return;
    for (const [index, reports] of results.entries()) {
      const game = batch[index];
      const achievements = getAchievementsForGame(game);
      for (const report of reports) {
        if (report?.error) errors.add(report.error);
      }
      for (const { platform, player: name, unlocks } of matchedPlayerProgress(achievements, reports)) {
        if (!progress.has(platform)) progress.set(platform, { platform, player: name, games: [] });
        progress.get(platform).games.push({
          game, unlocked: unlockCount(unlocks), reported: unlocks.size, total: achievements.length,
        });
      }
    }
  }

  const account = player.accounts.values().next().value;
  if (account) {
    title.replaceChildren(createElement('bdi', { text: account.player }));
    hero.prepend(createProfileAvatar(account));
    document.title = `${account.player} | ${APP_NAME}`;
  }
  if (!progress.size) {
    const error = [...errors].find((code) => code !== 'unsupported-game' && code !== 'no-game-data');
    status.textContent = t(PLAYER_ERRORS.get(error) ?? 'Could not load the player’s achievements. Try again.');
    return;
  }
  status.textContent = [...player.accounts.keys()].map((platform) => PLATFORM_NAMES[platform]).join(' · ');
  for (const platform of Object.keys(PLATFORM_NAMES)) {
    const platformProgress = progress.get(platform);
    if (platformProgress) page.append(createProfileProgress(platformProgress, progress.size > 1));
  }
};

const renderRoute = ({ focus = false, fromHistory = false } = {}) => {
  const route = getRoute();
  const previous = state.renderedRoute;
  if (fromHistory && route.page === previous?.page && route.game === previous.game) {
    syncGuide(route);
    return;
  }

  hideGuide();
  state.renderedRoute = route;
  updateActiveNavigation(route);
  setSidebarOpen(false);

  if (route.page === 'search') {
    renderHome();
  } else if (route.page === 'achievements') {
    renderAchievements(route.game);
  } else if (route.page === 'profile') {
    void renderPlayerProfile();
  } else if (route.page === 'settings') {
    renderSettings();
  } else if (route.page === 'release-notes') {
    renderReleaseNotes();
  } else {
    renderNotFound();
  }

  if (focus) {
    elements.mainContent.focus({ preventScroll: true });
  }
  elements.mainContent.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'auto' });
  syncGuide(route);
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
elements.guideClose.addEventListener('click', dismissGuide);
elements.guideDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  dismissGuide();
});
elements.guideDialog.addEventListener('click', (event) => {
  if (event.target !== elements.guideDialog) {
    return;
  }

  const { left, right, top, bottom } = elements.guideDialog.getBoundingClientRect();
  if (event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom) {
    dismissGuide();
  }
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
  state.player = createPlayer(id);

  const route = getRoute();
  if (route.page === 'profile') {
    renderRoute({ focus: true });
    return;
  }
  const game = route.page === 'achievements' && GAME_CONFIG.has(route.game) ? route.game : 'halomcc';
  if (route.page !== 'achievements' || route.game !== game || route.achievement) {
    const url = new URL(window.location.href);
    url.searchParams.set('page', 'achievements');
    url.searchParams.set('game', game);
    url.searchParams.delete('achievement');
    window.history.pushState(null, '', url);
  }
  renderRoute({ focus: true });
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
