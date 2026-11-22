import { ui } from './locales/ui.js';

export const LANGUAGES = {
  en: 'English',
  af: 'Afrikaans',
  zu: 'isiZulu',
};

const STORAGE_KEY = 'halo-tracker-language';
const translationIndex = { af: 0, zu: 1 };
let language = 'en';
let catalog = {};
let releaseNotes = {};
let collator = new Intl.Collator(language, { sensitivity: 'base', numeric: true });
let percentFormatter = new Intl.NumberFormat(language, {
  style: 'percent',
  maximumFractionDigits: 2,
  minimumFractionDigits: 1,
});

export const currentLanguage = () => language;

export const savedLanguage = () => {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return Object.hasOwn(LANGUAGES, saved) ? saved : 'en';
  } catch {
    return 'en';
  }
};

export const setLanguage = async (nextLanguage) => {
  if (nextLanguage === language || !Object.hasOwn(LANGUAGES, nextLanguage)) {
    return;
  }

  if (nextLanguage === 'en') {
    catalog = {};
    releaseNotes = {};
  } else {
    const resource = new URL(`./locales/${nextLanguage}.json`, import.meta.url);
    const response = await fetch(resource);
    if (!response.ok) {
      throw new Error('Unable to load language data');
    }
    ({ catalog, releaseNotes } = await response.json());
  }

  language = nextLanguage;
  document.documentElement.lang = language;
  collator = new Intl.Collator(language, { sensitivity: 'base', numeric: true });
  percentFormatter = new Intl.NumberFormat(language, {
    style: 'percent',
    maximumFractionDigits: 2,
    minimumFractionDigits: 1,
  });

  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // The selection still works in the current tab.
  }
};

export const t = (source, values = {}) => {
  const translation = ui[source]?.[translationIndex[language]] ?? source;
  return translation.replace(/\{(\w+)\}/g, (token, name) => values[name] ?? token);
};

export const achievementText = (achievement, field) => catalog[achievement.id]?.[field] ?? achievement[field];

export const compareNames = (first, second) => collator.compare(
  achievementText(first, 'name'),
  achievementText(second, 'name'),
);

export const formatPercent = (percent) => (
  language === 'en' ? percent : percentFormatter.format(Number.parseFloat(percent) / 100)
);

export const formatAchievementCount = (count) => (
  t(count === 1 ? '{count} achievement' : '{count} achievements', {
    count: count.toLocaleString(language),
  })
);

export const translateReleaseNotes = (fragment) => {
  if (language === 'en') {
    return fragment;
  }
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const source = node.data.trim().replace(/\s+/g, ' ');
    if (source) {
      const translation = source.startsWith('Version ')
        ? source.replace('Version', t('Version'))
        : releaseNotes[source] ?? t(source);
      node.data = node.data.replace(node.data.trim(), translation);
    }
  }
  for (const image of fragment.querySelectorAll('img[alt]:not([alt=""])')) {
    image.alt = releaseNotes[image.alt] ?? image.alt;
  }
  return fragment;
};
