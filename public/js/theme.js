// Color schemes. The tokens live in site.css under :root[data-scheme="..."];
// this module owns choosing, persisting, and applying one. A tiny inline
// <head> snippet on every page applies the stored scheme BEFORE the
// stylesheet paints (no flash); this module is for the Settings picker and
// anything else that changes the scheme while a page is open.
//
// Defaults: Eric's admin device keeps Neon; everyone else gets Calm. A
// stored choice always wins.

const KEY = 'pa-scheme';

export const SCHEMES = [
  { id: 'neon', label: 'Neon', blurb: 'The original. Electric.' },
  { id: 'calm', label: 'Calm', blurb: 'Same bones, easier on the eyes.' },
  { id: 'paper', label: 'Paper', blurb: 'Warm, light, like the folder itself.' },
  { id: 'contrast', label: 'High contrast', blurb: 'Maximum legibility.' },
];

// Keep in sync with the theme-color meta each scheme deserves.
const THEME_COLOR = {
  neon: '#07090F',
  calm: '#0B0E14',
  paper: '#F3EEE3',
  contrast: '#000000',
};

export function defaultScheme() {
  try {
    return localStorage.getItem('pa-admin-device') === '1' ? 'neon' : 'calm';
  } catch {
    return 'calm';
  }
}

export function currentScheme() {
  try {
    const s = localStorage.getItem(KEY);
    if (s && SCHEMES.some((x) => x.id === s)) return s;
  } catch { /* storage blocked */ }
  return defaultScheme();
}

export function applyScheme(id) {
  if (!SCHEMES.some((x) => x.id === id)) return;
  try { localStorage.setItem(KEY, id); } catch { /* storage blocked */ }
  if (id === 'neon') delete document.documentElement.dataset.scheme;
  else document.documentElement.dataset.scheme = id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[id] || THEME_COLOR.neon);
}

/** Applies the stored scheme now - for pages whose head snippet is missing. */
export function ensureScheme() {
  const s = currentScheme();
  if (s === 'neon') delete document.documentElement.dataset.scheme;
  else document.documentElement.dataset.scheme = s;
}
