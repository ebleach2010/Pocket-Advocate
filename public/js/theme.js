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
 * What Settings offers (Eric, 2026-10-17: "Keep the whole color scheme and
 * gradient, but allow it to be adjusted via a color wheel in settings ...
 * Include black, though, which just makes things black background white text
 * for simplicity and those with eye sensitivity"): the warm look, turned to
 * any colour on the wheel, or Black. Blue and purple is a turn of the wheel
 * now; a device that chose it keeps it until it chooses again.
 */
export const APPEARANCES = [
  { id: 'warm', label: 'Colour', blurb: 'Turn the wheel to colour the whole look. The gradient comes along.' },
  { id: 'contrast', label: 'Black', blurb: 'Black background, white text. Easiest on sensitive eyes.' },
];

// THE COLOR WHEEL. A turn of the warm look round the wheel, in degrees: 0 is
// the warm look itself. warm.css and landing-warm.css end in rules that
// tools/build-hue.mjs makes from their own colours, live only while <html
// data-hue> is set, which the head snippet on every page does before paint.
const HUE_KEY = 'pa-hue';
// Where the warm look's accent (#FFB27A) sits on the wheel, in oklch degrees.
export const WARM_HUE = 56;

export function currentHue() {
  try { const n = parseInt(localStorage.getItem(HUE_KEY), 10); return n > 0 && n < 360 ? n : 0; } catch { return 0; }
}

function paintHue(turn) {
  const root = document.documentElement;
  if (turn) { root.dataset.hue = String(turn); root.style.setProperty('--pa-hue', String(turn)); }
  else { delete root.dataset.hue; root.style.removeProperty('--pa-hue'); }
}

/** The warm look turned `turn` degrees round the wheel (0 is the warm look), and out of Black. */
export function applyHue(turn) {
  const n = ((Math.round(Number(turn) || 0) % 360) + 360) % 360;
  try {
    if (n) localStorage.setItem(HUE_KEY, String(n)); else localStorage.removeItem(HUE_KEY);
    localStorage.removeItem(LOOK_KEY);
  } catch { /* storage blocked: it still applies for this visit */ }
  delete document.documentElement.dataset.look;
  paintHue(n);
  applyScheme('calm');
}

/** The turn that puts the look's accent at this hue on the wheel. */
export const turnFor = (hue) => (((Math.round(hue) - WARM_HUE) % 360) + 360) % 360;

export function currentAppearance() {
  return currentScheme() === 'contrast' ? 'contrast' : currentLook();
}

export function applyAppearance(id) {
  // Black is black: no colour turned into it.
  if (id === 'contrast') { paintHue(0); applyScheme('contrast'); return; }
  if (id !== 'warm' && id !== 'cool') return;
  try { localStorage.setItem(LOOK_KEY, id); } catch { /* storage blocked */ }
  if (id === 'cool') document.documentElement.dataset.look = 'cool';
  else delete document.documentElement.dataset.look;
  // Out of Black, back to the colour this device turned the wheel to.
  paintHue(id === 'warm' ? currentHue() : 0);
  applyScheme('calm');
}
