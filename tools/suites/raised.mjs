// raised.mjs - buttons that stand off the page (v7.66).
//
// Eric, 2026-10-17: "Do you notice how the buttons don't look convex at all, and don't stand out compared to
// normal text? Fix that."
//
// A button was a thin outline on the page's own fill, so it read as a boxed word. look.css's RAISED BUTTONS
// section gives everything a finger lands on a lit fill, a highlight along its top, a shade along its bottom
// and a shadow under it; pressed, it sinks. Black keeps its own plain buttons.
//
//   RB1 every kind of button and tab stands off the page (the chips, booking times, the chat's small buttons and
//       Employer mode's tabs too), and the one that acts stands furthest
//   RB2 the raise is lit on top, shaded below and casts a shadow; pressed is all inside
//   RB3 a plain button's fill is lighter than the page in both looks, with full-strength words
//   RB4 pressed, it sinks; the tab you are on, and a chosen chip or time, is pressed in, in both looks
//   RB5 the warm look keeps the raise under its own guard, the same plum on the home as everywhere else, and the
//       home's buttons that act are raised under their glow
//   RB6 Black is left alone: no raise reaches it
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (p) => readFileSync(join(ROOT, p), 'utf8');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
/** Every rule as [selector, body], @supports and @media opened. */
function rules(css) {
  const out = [];
  const walk = (s) => {
    let k = 0;
    while (k < s.length) {
      const open = s.indexOf('{', k);
      if (open < 0) break;
      const sel = s.slice(k, open).trim();
      let depth = 1; let m = open + 1;
      while (m < s.length && depth) { if (s[m] === '{') depth++; else if (s[m] === '}') depth--; m++; }
      const body = s.slice(open + 1, m - 1);
      if (/^@(media|supports)/.test(sel)) walk(body); else if (!sel.startsWith('@')) out.push([sel, body]);
      k = m;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  return out;
}
const decl = (body, prop) => (body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`)) || [])[1]?.replace(/\s+/g, ' ').trim();
/** A custom property's value, read from the rules with exactly this selector. */
const token = (R, sel, name) => R.filter(([s]) => s === sel).map(([, b]) => decl(b, name)).filter(Boolean).pop();
/** Relative luminance of #RRGGBB. */
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const LOOK = f('public/css/look.css');
const WARM = f('public/css/warm.css');
const LWARM = f('public/css/landing-warm.css');
const L = rules(LOOK);
const W = rules(WARM);
const LW = rules(LWARM);
const NOT_BLACK = ':root:not([data-scheme="contrast"])';
const WARM_ROOT = ':root:not([data-scheme="contrast"]):not([data-look="cool"])';
const KINDS = ['.btn', '.cta', '.pack-cta', '.nav-toggle', '.cog-btn', '.add-btn', '.case-folder .folder-tabs > a', '.case-folder .fgrp',
  '.chip-label', '.slot', '.chat-search-btn', '.attach-btn', '.help-dot', '.pass-flag', '.emp-tabs > button'];
/** The ones that are chosen rather than pressed once: chosen, they sit pressed in. */
const CHOSEN = ['.chip-label', '.slot', '.emp-tabs > button'];
const inner = (sel) => (sel.match(/:is\(([^)]*)\)/) || [])[1]?.split(',').map((x) => x.trim()) || [];

console.log('\n--- standing off the page ---');
{
  const lift = L.find(([s, b]) => s.startsWith(`${NOT_BLACK} :is(`) && decl(b, 'box-shadow') === 'var(--raise)');
  const cta = L.find(([s, b]) => s.startsWith(`${NOT_BLACK} :is(`) && decl(b, 'box-shadow') === 'var(--raise-cta)');
  const missing = KINDS.filter((k) => !inner(lift?.[0] || '').includes(k));
  // NEGATIVE CONTROL (run 2026-10-17): `.btn, ` taken out of the `box-shadow: var(--raise)` rule's list made this read
  //   FAIL  RB1 every kind of button and tab stands off the page, the chips, booking times, chat buttons and Employer mode's tabs too, and the ones that act stand furthest
  check('RB1 every kind of button and tab stands off the page, the chips, booking times, chat buttons and Employer mode\'s tabs too, and the ones that act stand furthest',
    !!lift && !missing.length && /:not\(:disabled, \[aria-disabled="true"\]\)$/.test(lift[0])
    && !!cta && ['.btn.glow', '.cta', '.pack-cta', '.add-btn'].every((k) => inner(cta[0]).includes(k)) && L.indexOf(cta) > L.indexOf(lift),
    JSON.stringify({ lift: lift?.[0], missing }));

  const root = (n) => token(L, NOT_BLACK, n);
  const shadows = (v) => (v || '').split(/,(?![^(]*\))/).map((x) => x.trim());
  const lit = (v) => shadows(v).some((s) => /^inset 0 1px 0 (var\(--raise-hi\)|rgba\(255, 255, 255, \.\d+\))$/.test(s));
  const shaded = (v) => shadows(v).some((s) => /^inset 0 -\d+px 0 rgba\(0, 0, 0, \.\d+\)$/.test(s));
  const casts = (v) => shadows(v).some((s) => /^0 \d+px \d+px rgba\(0, 0, 0, \.\d+\)$/.test(s) && parseFloat(s.split(' ')[2]) >= 8);
  const press = shadows(root('--press'));
  // NEGATIVE CONTROL (run 2026-10-17): --raise's `inset 0 1px 0 var(--raise-hi), ` taken out made this read
  //   FAIL  RB2 the raise is lit along its top, shaded along its bottom and casts a shadow; pressed is all inside
  check('RB2 the raise is lit along its top, shaded along its bottom and casts a shadow; pressed is all inside',
    lit(root('--raise')) && shaded(root('--raise')) && casts(root('--raise')) && lit(root('--raise-cta')) && shaded(root('--raise-cta')) && casts(root('--raise-cta'))
    && press.length >= 1 && press.every((s) => s.startsWith('inset ')),
    JSON.stringify({ raise: root('--raise'), cta: root('--raise-cta'), press }));
}

console.log('\n--- a lit fill and full-strength words ---');
{
  const plain = L.find(([s, b]) => s.startsWith(`${NOT_BLACK} :is(.btn, .nav-toggle, .cog-btn, `) && !s.endsWith(':hover') && decl(b, 'background'));
  const coolBg = token(L, ':root:not([data-scheme="contrast"]) body', '--bg') || token(L, NOT_BLACK, '--bg');
  const looks = {
    cool: { top: token(L, NOT_BLACK, '--raise-top'), bot: token(L, NOT_BLACK, '--raise-bot'), bg: coolBg },
    warm: { top: token(W, WARM_ROOT, '--raise-top'), bot: token(W, WARM_ROOT, '--raise-bot'), bg: '#1E1519' },
  };
  const lighter = Object.values(looks).every((x) => /^#[0-9A-F]{6}$/i.test(x.top || '') && /^#[0-9A-F]{6}$/i.test(x.bot || '') && /^#[0-9A-F]{6}$/i.test(x.bg || '')
    && lum(x.bot) > lum(x.bg) * 1.4 && lum(x.top) > lum(x.bot));
  // NEGATIVE CONTROL (run 2026-10-17): warm.css's `--raise-bot: #2F2229;` made `--raise-bot: #1E1519;` (the page itself) made this read
  //   FAIL  RB3 a plain button's fill is lighter than the page in both looks, lit at its top, with full-strength words
  check('RB3 a plain button\'s fill is lighter than the page in both looks, lit at its top, with full-strength words',
    !!plain && decl(plain[1], 'background') === 'linear-gradient(180deg, var(--raise-top), var(--raise-bot))' && decl(plain[1], 'color') === 'var(--ink)'
    && /:not\(\.glow, \.danger, \.secondary/.test(plain[0]) && /, \.on, \.selected, /.test(plain[0])
    && KINDS.filter((k) => !/^\.(cta|pack-cta|add-btn|case-folder)/.test(k)).every((k) => inner(plain[0]).includes(k)) && lighter,
    JSON.stringify({ plain: plain?.[0]?.slice(0, 90), looks }));
}

console.log('\n--- pressed ---');
{
  const active = L.find(([s]) => s.startsWith(`${NOT_BLACK} :is(`) && s.endsWith(':active'));
  const onLook = L.find(([s]) => s === `${NOT_BLACK} .case-folder :is(.folder-tabs > a, .fgrp).on`);
  const onWarm = W.filter(([s]) => s.startsWith(`${WARM_ROOT} .case-folder .folder-tabs > a`) && s.endsWith('.on'));
  // Chosen (.selected or .on), with the raise's own weight and after it, so it wins.
  const chosen = L.find(([s]) => s.startsWith(`${NOT_BLACK} :is(.chip-label, `) && /:is\(\.selected, \.on\):not\(:disabled\)$/.test(s));
  // NEGATIVE CONTROL (run 2026-10-17): the chosen rule's `box-shadow: var(--press), ` made `box-shadow: var(--raise), ` made RB4 read FAIL.
  // NEGATIVE CONTROL (run 2026-10-17): warm.css's peach tab you are on given `box-shadow: 0 0 0 1px rgba(255, 178, 122, .45);` without the press made this read
  //   FAIL  RB4 pressed, a button sinks; the tab you are on, and a chosen chip or time, is pressed in, in both looks
  check('RB4 pressed, a button sinks; the tab you are on, and a chosen chip or time, is pressed in, in both looks',
    !!active && decl(active[1], 'box-shadow') === 'var(--press)' && decl(active[1], 'transform') === 'translateY(1px)'
    && KINDS.every((k) => inner(active[0]).includes(k))
    && !!onLook && /^var\(--press\), /.test(decl(onLook[1], 'box-shadow') || '')
    && onWarm.length >= 2 && onWarm.every(([, b]) => /^var\(--press\), /.test(decl(b, 'box-shadow') || ''))
    && !!chosen && CHOSEN.every((k) => inner(chosen[0]).includes(k)) && /^var\(--press\)/.test(decl(chosen[1], 'box-shadow') || '')
    && L.indexOf(chosen) > L.findIndex(([s, b]) => s.startsWith(`${NOT_BLACK} :is(`) && decl(b, 'box-shadow') === 'var(--raise)'),
    JSON.stringify({ active: active?.[0]?.slice(-40), onWarm: onWarm.map(([, b]) => decl(b, 'box-shadow')), chosen: chosen?.[0] }));
}

console.log('\n--- each look ---');
{
  const glow = W.find(([s]) => s === `${WARM_ROOT} :is(.btn.glow, .btn.mag.glow)`);
  const NAMES = ['--raise-top', '--raise-bot', '--raise-edge', '--raise-hi'];
  const here = NAMES.map((n) => token(W, WARM_ROOT, n));
  const home = NAMES.map((n) => token(LW, `${WARM_ROOT}:has(body.landing)`, n));
  const homeGo = LW.find(([s]) => s === `${WARM_ROOT} body.landing :is(.btn.glow, .btn.mag.glow)`);
  // NEGATIVE CONTROL (run 2026-10-17): warm.css's acting button given `box-shadow: none;` made this read
  // NEGATIVE CONTROL (run 2026-10-17): landing-warm.css's buttons that act given `box-shadow: var(--el-cta);` alone made this read
  //   FAIL  RB5 the warm look keeps the raise on the buttons that act, under its own guard, the same plum on the home as everywhere else, and the home's are raised under their glow
  check('RB5 the warm look keeps the raise on the buttons that act, under its own guard, the same plum on the home as everywhere else, and the home\'s are raised under their glow',
    !!glow && decl(glow[1], 'box-shadow') === 'var(--raise-cta)' && decl(glow[1], 'background') === 'var(--warm-pop)'
    && here.every(Boolean) && JSON.stringify(here) === JSON.stringify(home)
    && !!homeGo && decl(homeGo[1], 'box-shadow') === 'var(--raise-cta), var(--el-cta)',
    JSON.stringify({ glow: glow && decl(glow[1], 'box-shadow'), here, home, homeGo: homeGo && decl(homeGo[1], 'box-shadow') }));

  const raiseRules = [...L, ...W, ...LW].filter(([, b]) => /var\(--(raise|press)/.test(b) || /--(raise|press)[\w-]*\s*:/.test(b));
  const reach = raiseRules.filter(([s]) => s.split(/,(?![^(]*\))/).some((x) => !x.trim().startsWith(NOT_BLACK)));
  // NEGATIVE CONTROL (run 2026-10-17): `.btn { box-shadow: var(--raise); }` added to the end of look.css made this read
  //   FAIL  RB6 Black is left alone: no raise reaches it
  check('RB6 Black is left alone: no raise reaches it', raiseRules.length >= 8 && !reach.length, reach.map(([s]) => s.slice(0, 60)).join(' | '));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
