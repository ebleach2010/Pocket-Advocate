// Color schemes. The tokens live in site.css under :root[data-scheme="..."];
// this module owns choosing, persisting, and applying one. A tiny inline
// <head> snippet on every page applies the stored scheme BEFORE the
// stylesheet paints (no flash); this module is for the Settings picker and
// anything else that changes the scheme while a page is open.
//
// Defaults, since the Daylight restyle (2026-08-29): a stored choice always
// wins; with nothing stored the app follows the SYSTEM setting, light to
// Daylight and dark to Night, which is what a phone user already expects.

const KEY = 'pa-scheme';

// The ids are STORAGE KEYS and never change: a client who picked one in
// July keeps their choice. Only the labels moved with the restyle.
export const SCHEMES = [
  { id: 'neon', label: 'Daylight', blurb: 'The brand look. Powder blue, white, navy.' },
  { id: 'calm', label: 'Night', blurb: 'The same brand after dark.' },
  { id: 'paper', label: 'Paper', blurb: 'Warm, light, like the folder itself.' },
  { id: 'contrast', label: 'High contrast', blurb: 'Maximum legibility.' },
];

// Keep in sync with the theme-color meta each scheme deserves.
const THEME_COLOR = {
  neon: '#EAF2FA',
  calm: '#0A1626',
  paper: '#F3EEE3',
  contrast: '#000000',
};

export function defaultScheme() {
  try {
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches
      ? 'calm' : 'neon';
  } catch {
    return 'neon';
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
