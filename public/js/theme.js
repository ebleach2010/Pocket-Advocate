// Visual theme system — four modes, choice persists per device. The initial
// theme is applied by a tiny inline <head> script (no flash); this module does
// live switching from the settings panel and the intro.
const KEY = 'pa-theme';

export const THEMES = [
  { id: 'earth', label: 'Earth' },
  { id: 'neon', label: 'Neon' },
  { id: 'dark', label: 'Dark' },
  { id: 'contrast', label: 'High contrast' },
];

// Keep these versions in sync with the inline bootstrap in each page's <head>.
const CSS = {
  earth: '/css/theme-earth.css?v=e8',
  dark: '/css/theme-dark.css?v=d1',
  contrast: '/css/theme-contrast.css?v=c1',
  // neon = base site.css, no override
};

export function currentTheme() {
  return localStorage.getItem(KEY) || 'earth';
}

export function applyTheme(name) {
  document.documentElement.setAttribute('data-theme', name);
  document.querySelectorAll('link[data-theme-css]').forEach((l) => l.remove());
  const href = CSS[name];
  if (href) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.setAttribute('data-theme-css', '1');
    document.head.appendChild(l);
  }
}

export function setTheme(name) {
  localStorage.setItem(KEY, name);
  applyTheme(name);
}
