// Color schemes. The tokens live in site.css under :root[data-scheme="..."];
// this module owns choosing, persisting, and applying one. A tiny inline
// <head> snippet on every page applies the stored scheme BEFORE the
// stylesheet paints (no flash); this module is for the Settings picker and
// anything else that changes the scheme while a page is open.
//
// ONE LOOK (Eric, 2026-10-15: "everywhere should have this same aesthetic"):
// every page paints on the Night base, which look.css turns black. The one
// choice left is High contrast, for somebody's eyes. A Daylight or Paper
// choice stored before then reads as the standard look.

const KEY = 'pa-scheme';

// The ids are STORAGE KEYS and never change: a client who picked one in
// July keeps their choice. Only the labels moved with the restyle.
export const SCHEMES = [
  { id: 'calm', label: 'Standard', blurb: 'Black, with the cyan and violet glow.' },
  { id: 'contrast', label: 'High contrast', blurb: 'Maximum legibility.' },
];

// Keep in sync with the theme-color meta each scheme deserves.
const THEME_COLOR = {
  neon: '#0A0A0C',
  calm: '#0A0A0C',
  paper: '#0A0A0C',
  contrast: '#000000',
};

export function defaultScheme() {
  return 'calm';
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
  document.documentElement.dataset.scheme = id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[id] || THEME_COLOR.neon);
  // Announced so the night shift (night-shift.js) can stand down for the
  // visit: a scheme somebody just chose outranks the door sign.
  document.dispatchEvent(new CustomEvent('pa-scheme-set', { detail: { id } }));
}

/** The theme-color a scheme deserves, for anything repainting the meta. */
export function schemeThemeColor(id) {
  return THEME_COLOR[id] || THEME_COLOR.neon;
}
