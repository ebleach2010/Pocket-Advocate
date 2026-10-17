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
  { id: 'calm', label: 'Standard', blurb: 'Warm, or blue and purple, as chosen below.' },
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
  if (meta) meta.setAttribute('content', schemeThemeColor(id));
  // Announced so the night shift (night-shift.js) can stand down for the
  // visit: a scheme somebody just chose outranks the door sign.
  document.dispatchEvent(new CustomEvent('pa-scheme-set', { detail: { id } }));
}

/** The theme-color a scheme deserves, for anything repainting the meta: the warm ground unless this device chose Blue and purple. */
export function schemeThemeColor(id) {
  if (id === 'contrast') return THEME_COLOR.contrast;
  return currentLook() === 'cool' ? THEME_COLOR.calm : WARM_COLOR;
}

// THE LOOK (Eric, 2026-10-16: "Warm gradient we have going on should be
// default everywhere, with the blue/purple being in settings"). Warm unless
// this device chose Blue and purple. The head snippet on every page sets
// data-look="cool" from pa-look before anything paints, and warm.css (and
// landing-warm.css) stand down for it; High contrast outranks both.
const LOOK_KEY = 'pa-look';
const WARM_COLOR = '#1E1519';

export function currentLook() {
  try { return localStorage.getItem(LOOK_KEY) === 'cool' ? 'cool' : 'warm'; } catch { return 'warm'; }
}

/**
 * What Settings offers (Eric, 2026-10-17, of the color wheel: "The color
 * wheel is horrendous. Get rid of it. Have it be either the blue/green from
 * before or this warm look, or just black on white."): the warm look, the
 * black look with its cyan glow, and Black for somebody's eyes ("black
 * background white text for simplicity and those with eye sensitivity").
 */
export const APPEARANCES = [
  { id: 'warm', label: 'Warm', blurb: 'Plum, peach and rose. The standard look.' },
  { id: 'cool', label: 'Blue and green', blurb: 'Black, with the cyan glow.' },
  { id: 'contrast', label: 'Black', blurb: 'Black background, white text. Easiest on sensitive eyes.' },
];

export function currentAppearance() {
  return currentScheme() === 'contrast' ? 'contrast' : currentLook();
}

export function applyAppearance(id) {
  if (id === 'contrast') { applyScheme('contrast'); return; }
  if (id !== 'warm' && id !== 'cool') return;
  try { localStorage.setItem(LOOK_KEY, id); } catch { /* storage blocked */ }
  if (id === 'cool') document.documentElement.dataset.look = 'cool';
  else delete document.documentElement.dataset.look;
  applyScheme('calm');
}
