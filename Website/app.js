'use strict';

import { ACHIEVEMENTS } from './achievements.js';

const APP_NAME = 'Halo Achievement Tracker';
const APP_VERSION = 'Version 1.2.0 | WEB | RELEASE | 2026/11/22';
const HOME_DESCRIPTION = 'Browse Halo achievements by game and game mode, and open guides where available.';

const FILTERS = Object.freeze([
  Object.freeze({ value: 'Campaign', label: 'Campaign' }),
  Object.freeze({ value: 'Co-op Campaign', label: 'Co-op Campaign' }),
  Object.freeze({ value: 'PvE Multiplayer', label: 'PvE Multiplayer' }),
  Object.freeze({ value: 'PvP Multiplayer', label: 'PvP Multiplayer' }),
  Object.freeze({ value: 'Other', label: 'Other (Not Filtered Yet)' }),
]);

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
  elements.menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
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

const renderHome = () => {
  const section = createElement('section', {
    className: 'home-page',
    attributes: { 'aria-labelledby': 'home-title' },
  });
  const hero = createElement('article', { className: 'home-hero surface' });
  const heroImage = createImage({
    source: 'assets/background-infinite.jpg',
    alt: 'Spartans from Halo Infinite',
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
    text: HOME_DESCRIPTION,
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
  const text = createElement('span', { text: label });

  wrapper.append(checkbox, text);
  return wrapper;
};

const createAchievementCard = (achievement, index) => {
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
  });
  const description = createElement('p', {
    className: 'achievement-description',
    text: achievement.description,
  });
  const metadata = createElement('div', { className: 'achievement-metadata' });
  const percentage = createElement('span', {
    className: 'achievement-percentage',
    text: `${achievement.percentAchieved} of players have this achievement`,
  });

  metadata.append(percentage);
  if (guideAvailable) {
    card.append(createElement('button', {
      className: 'achievement-guide-button',
      attributes: {
        type: 'button',
        'data-achievement-id': achievement.id,
        'aria-label': `Open guide for ${achievement.name}`,
      },
    }));
  }

  body.append(heading, description, metadata);
  card.prepend(image, body);
  return card;
};

const renderAchievementCards = ({ achievements, activeFilters, count, list }) => {
  const filteredAchievements = achievements.filter(({ filters }) => (
    filters.some((filter) => activeFilters.has(filter))
  ));
  const fragment = document.createDocumentFragment();

  filteredAchievements.forEach((achievement, index) => {
    fragment.append(createAchievementCard(achievement, index));
  });

  if (filteredAchievements.length === 0) {
    fragment.append(createElement('p', {
      className: 'empty-state surface',
      text: 'No achievements match the selected filters.',
    }));
  }

  count.textContent = `${filteredAchievements.length.toLocaleString()} ACHIEVEMENT${filteredAchievements.length === 1 ? '' : 'S'}`;
  list.replaceChildren(fragment);
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

  heroText.append(title);
  heroOverlay.append(gameIcon, heroText);
  hero.append(heroOverlay);

  const summary = createElement('section', {
    className: 'achievement-summary surface',
    attributes: { 'aria-label': 'Achievement count' },
  });
  summary.append(count);

  const filterPanel = createElement('form', {
    className: 'filter-panel',
    attributes: { 'aria-label': 'Filter achievements' },
  });
  const fieldset = createElement('fieldset');
  const legend = createElement('legend', { text: 'Filter Criteria' });
  const options = createElement('div', { className: 'filter-options' });

  for (const filter of availableFilters) {
    const label = filter.value === 'PvE Multiplayer'
      ? config.pveFilterLabel ?? filter.label
      : filter.label;
    options.append(createFilterControl({ value: filter.value, label }, activeFilters.has(filter.value)));
  }

  fieldset.append(legend, options);
  filterPanel.append(fieldset);

  const listRegion = createElement('section', {
    className: 'achievement-results',
    attributes: { 'aria-labelledby': 'achievement-results-title' },
  });
  const listTitle = createElement('h2', {
    text: 'Achievements',
    attributes: { id: 'achievement-results-title' },
  });
  const list = createElement('div', {
    className: 'achievement-list',
    attributes: {
      id: 'achievement-list',
      'aria-describedby': 'achievement-count',
    },
  });

  const syncFilters = () => {
    activeFilters.clear();
    for (const checkbox of filterPanel.querySelectorAll('input[type="checkbox"]:checked')) {
      activeFilters.add(checkbox.value);
    }
    renderAchievementCards({ achievements, activeFilters, count, list });
  };

  filterPanel.addEventListener('change', syncFilters);
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

  listRegion.append(listTitle, list);
  const browser = createElement('div', { className: 'achievement-browser' });
  browser.append(filterPanel, listRegion);
  page.append(hero, summary, browser);
  elements.routeView.replaceChildren(page);
  renderAchievementCards({ achievements, activeFilters, count, list });
  document.title = `${config.shortTitle} Achievements | ${APP_NAME}`;
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
    text: `${achievement.percentAchieved} of players have this achievement`,
  });
  const title = createElement('h2', {
    text: achievement.name,
    attributes: { id: 'guide-title' },
  });
  const description = createElement('p', {
    className: 'guide-summary',
    text: achievement.description,
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
      text: 'Guide',
      attributes: { id: 'guide-steps-title' },
    });
    const guideText = createElement('p', {
      className: 'guide-description',
      text: achievement.guideDescription,
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
      text: validVideos.length === 1 ? 'Video guide' : 'Video guides',
      attributes: { id: 'guide-videos-title' },
    });
    const videoGrid = createElement('div', { className: 'video-grid' });

    validVideos.forEach((videoUrl, index) => {
      const frameWrapper = createElement('div', { className: 'video-frame' });
      const iframe = createElement('iframe', {
        attributes: {
          src: videoUrl,
          title: `${achievement.name} video guide ${index + 1}`,
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
    text: 'Settings',
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
    text: 'Language',
    attributes: { id: 'language-title' },
  });
  const languageDescription = createElement('p', {
    text: 'Select which language to display',
    attributes: { id: 'language-description' },
  });
  const languageSelect = createElement('select', {
    attributes: {
      'aria-describedby': 'language-description',
      'aria-label': 'Display language',
    },
  });
  languageSelect.append(createElement('option', { text: 'English' }));
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
  const appVersion = createElement('p', { text: APP_VERSION });
  const appActions = createElement('div', { className: 'settings-actions' });
  const changeLogLink = createElement('a', {
    className: 'settings-icon-button',
    attributes: {
      href: '?page=release-notes',
      'data-route': '',
      'aria-label': 'View change log',
      title: 'View change log',
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
      'aria-label': 'Copy app info to clipboard',
      title: 'Copy app info to clipboard',
    },
  });
  copyButton.append(createImage({
    source: 'assets/copy.svg',
    alt: '',
    className: 'settings-action-icon',
  }));

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${APP_NAME} (${APP_VERSION})`);
      showToast('App information copied.');
    } catch {
      showToast('Unable to copy app information.');
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
    text: 'Useful Links',
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
    const label = createElement('span', { text: link.label });
    linkElement.append(icon, label);
    if (link.action === 'download') {
      linkElement.addEventListener('click', () => showToast('Coming soon!'));
    }
    linksGrid.append(linkElement);
  }

  linksSection.append(linksHeading, linksGrid);
  section.append(header, grid, linksSection);
  elements.routeView.replaceChildren(section);
  document.title = `Settings | ${APP_NAME}`;
};

const renderNotFound = () => {
  const section = createElement('section', {
    className: 'not-found surface',
    attributes: { 'aria-labelledby': 'not-found-title' },
  });
  const code = createElement('p', { className: 'eyebrow', text: '404' });
  const title = createElement('h1', {
    text: 'Page not found',
    attributes: { id: 'not-found-title' },
  });
  const description = createElement('p', {
    text: 'The requested Halo Tracker page does not exist.',
  });
  const homeLink = createElement('a', {
    className: 'button primary-button',
    text: 'Return home',
    attributes: {
      href: '?page=search',
      'data-route': '',
    },
  });

  section.append(code, title, description, homeLink);
  elements.routeView.replaceChildren(section);
  document.title = `Page not found | ${APP_NAME}`;
};

const renderReleaseNotes = () => {
  const template = document.querySelector('#release-notes-template');
  elements.routeView.replaceChildren(template.content.cloneNode(true));
  document.title = `Release Notes | ${APP_NAME}`;
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

canonicalizeUrl();
renderRoute();
