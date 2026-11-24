import { ACHIEVEMENTS } from './achievements.js';

export const APP_NAME = 'Halo Achievement Tracker';

export const GAME_CONFIG = new Map([
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

export const getAchievementsForGame = (game) => {
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

export const hasGuide = ({ guideDescription, guideVideos }) => (
  guideDescription.trim().length > 0 || guideVideos.length > 0
);

export const guidePageTitle = ({ name, collection }) =>
  `${name} Achievement Guide | ${GAME_CONFIG.get(collection).title} | ${APP_NAME}`;
