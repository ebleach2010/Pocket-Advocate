// warm.mjs - the client's side, warm; his photo beside his words; the
// progress card that celebrates; and his tan folders back.
//
// Eric, 2026-10-15, looking at the preview on his phone: "fix the chat
// aesthetic so it doesn't look so black/dead. I'd like the client side to
// look warm and engaging. Right now it's cold and confusing." Asked whether
// real clients get it too: "All client pages". And: "highlight the progress
// section with a celebratory icon". And, about his own shelf: "Revert to the
// old file look in 'all cases' for admin", asked which: "Tan, keep the glow".
//
// The stylesheets are read rule by rule; the photo picker and the progress
// card are lifted out of the page code and RUN. The look itself is walked in
// a browser in drive-tour.mjs.
//
// Run: node warm.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { source as handWritten } from '../build-hue.mjs';
import { fileURLToPath as f2, pathToFileURL } from 'node:url';
import { dirname as d, join as j } from 'node:path';

const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const DASH = new RegExp('[\\u2013\\u2014]');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
/** Each rule of a stylesheet as [selector, body], comments dropped, @media blocks opened. */
function rules(css) {
  const out = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const walk = (s) => {
    let k = 0;
    while (k < s.length) {
      const open = s.indexOf('{', k);
      if (open < 0) break;
      const sel = s.slice(k, open).trim();
      let depth = 1; let m = open + 1;
      while (m < s.length && depth) { if (s[m] === '{') depth++; else if (s[m] === '}') depth--; m++; }
      const body = s.slice(open + 1, m - 1);
      if (sel.startsWith('@media')) walk(body);
      else if (!sel.startsWith('@keyframes')) out.push([sel, body]);
      k = m;
    }
  };
  walk(src);
  return out;
}

const WARM = f('public/css/warm.css');
// The warm root (2026-10-16): not High contrast, and not Blue and purple chosen in Settings.
const W = ':root:not([data-scheme="contrast"]):not([data-look="cool"])';
const CLIENT_PAGES = ['case.html', 'chat.html', 'subscription.html', 'return.html'];

console.log('\n--- A. the client\'s side, warm ---');
{
  const pages = readdirSync(j(ROOT, 'public')).filter((n) => n.endsWith('.html'));
  const loads = pages.filter((n) => /\/css\/warm\.css\?v=/.test(f(`public/${n}`)));
  // NEGATIVE CONTROL (run 2026-10-15): warm.css's link put on admin-case.html made this read
  //   FAIL  A1 the four pages a client lives in load the warm sheet, and no page of his, the home or a package page does
  // RE-PINNED 2026-10-16 (v7.57): Eric, "Warm gradient we have going on should be default everywhere, with the
  // blue/purple being in settings". Every page loads it now but the home and the package pages, which have their
  // own (landing-warm.css), and the hidden fund form.
  // NEGATIVE CONTROL (run 2026-10-16, v7.57): warm.css's link taken off admin-case.html made A1 read FAIL.
  const LANDING_PAGES = ['index.html', 'advocacy-case.html', 'full-service.html', 'priority-chat.html', 'fund.html'];
  check('A1 the four pages a client lives in load the warm sheet, and no page of his, the home or a package page does',
    CLIENT_PAGES.every((n) => loads.includes(n)) && loads.includes('admin.html') && loads.includes('admin-case.html') && loads.includes('signin.html')
    && JSON.stringify(loads.sort()) === JSON.stringify(pages.filter((n) => !LANDING_PAGES.includes(n)).sort()), loads.join(','));
  const R = rules(WARM);
  const tokens = R.find(([sel, body]) => sel === `${W} body` && /--bg:/.test(body))?.[1] || '';
  const tok = (k) => (tokens.match(new RegExp(`${k}: ([^;]+);`)) || [])[1];
  // NEGATIVE CONTROL (run 2026-10-15): warm.css's --bg put back to #0A0A0C made this read
  //   FAIL  A2 the ground is warm, not black: a plum brown ground, warm white ink, peach light, and the warm pop for what acts
  check('A2 the ground is warm, not black: a plum brown ground, warm white ink, peach light, and the warm pop for what acts',
    tok('--bg') === '#1E1519' && tok('--ink') === '#FFF5EE' && tok('--cyan') === '#FFB27A' && /linear-gradient\(110deg, #FFC48A/.test(tok('--warm-pop') || '')
    && R.some(([sel, body]) => /\.btn\.glow/.test(sel) && /background: var\(--warm-pop\)/.test(body)),
    JSON.stringify({ bg: tok('--bg'), ink: tok('--ink'), cyan: tok('--cyan') }));
  const meWarm = R.find(([sel]) => sel === `${W} .msg.me`)?.[1] || '';
  const themWarm = R.find(([sel]) => sel === `${W} .msg.them`)?.[1] || '';
  // NEGATIVE CONTROL (run 2026-10-15): the client's own bubble back to a faint wash made this read
  //   FAIL  A3 the chat is lit: their words in the warm pop with dark ink, his on a warm raised card, never the black look's grey
  check('A3 the chat is lit: their words in the warm pop with dark ink, his on a warm raised card, never the black look\'s grey',
    /background: linear-gradient\(135deg, #FFC08F/.test(meWarm) && /color: #2B1207;/.test(meWarm)
    && /background: linear-gradient\(180deg, #47343D, #3D2D35\);/.test(themWarm) && !/#1B1B21|#131317/.test(meWarm + themWarm),
    JSON.stringify({ meWarm, themWarm }));
  // Everything that paints colour is under the not-High-contrast root, so
  // somebody who chose High contrast for their eyes keeps it. The only rules
  // outside it lay out pieces that exist on the client's side alone.
  // RE-PINNED 2026-10-16 (v7.57): every colour rule is under the warm root (not High contrast, not Blue and
  // purple); the Settings swatches (.sc-warm, .sc-cool) paint their own fixed chips whatever is chosen.
  // NEGATIVE CONTROL (run 2026-10-16, v7.57): a bare `.add-btn { background: var(--warm-pop); }` added to warm.css made A4 read FAIL.
  const STRUCTURE = /^(\.msg-row|\.msg-ava|\.chat-day|\.chat-who|\.cheer|:root\[data-scheme="contrast"\] \.cheer|\.sc-warm|\.sc-cool)/;
  // Split a selector list on its top-level commas only (an :is(a, b) stays whole).
  const parts = (sel) => { const out = []; let depth = 0; let cur = ''; for (const ch of sel) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  // RE-PINNED 2026-10-17 (v7.64): judged on the sheet as written by hand. The color wheel's block at its end is
  // generated from these same rules, behind the same guards plus [data-hue], and hue.mjs checks it.
  // NEGATIVE CONTROL (run 2026-10-17, v7.64): a bare `.add-btn { background: var(--warm-pop); }` put just above the
  // wheel's block made A4 read FAIL.
  const loose = rules(handWritten(WARM)).filter(([sel]) => !parts(sel).every((x) => x.trim().startsWith(W) || x.trim().startsWith(`:where(${W})`) || STRUCTURE.test(x.trim())));
  // NEGATIVE CONTROL (run 2026-10-15): a bare `.msg.me { background: #FFC08F; }` added to warm.css made this read
  //   FAIL  A4 High contrast keeps its own colours: every colour rule is under the not-High-contrast root, and the rest only lay out the client's own pieces
  check('A4 High contrast keeps its own colours: every colour rule is under the not-High-contrast root, and the rest only lay out the client\'s own pieces',
    R.length > 30 && !loose.length, loose.map(([sel]) => sel).join(' | '));
  // NEGATIVE CONTROL (run 2026-10-15): an em dash put in warm.css's header made this read
  //   FAIL  A5 the warm sheet carries no dash
  check('A5 the warm sheet carries no dash', !DASH.test(WARM));
}

/** Width over height of a JPEG, read from its frame header. */
function sharpDims(p) {
  const b = readFileSync(j(ROOT, p));
  for (let k = 2; k < b.length - 9;) {
    if (b[k] !== 0xFF) { k++; continue; }
    const m = b[k + 1];
    if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) return b.readUInt16BE(k + 7) / b.readUInt16BE(k + 5);
    k += 2 + b.readUInt16BE(k + 2);
  }
  return 0;
}

console.log('\n--- B. his face, and the days ---');
{
  const CHAT = f('public/js/chat.js');
  const pick = new Function(`${(CHAT.match(/export function advocatePhoto\(advocateId\) \{[\s\S]*?\n\}/) || [''])[0].replace(/^export /, '')} return advocatePhoto;`)();
  const got = ['', 'demo-admin', 'preview-eric', 'abcDEF123', 'a b'].map(pick);
  // NEGATIVE CONTROL (run 2026-10-15): advocatePhoto answering the Worker's route for a demo uid made this read
  //   FAIL  B1 the photo is the case's own advocate's, served by the Worker; the preview and demo show his shipped photo
  check('B1 the photo is the case\'s own advocate\'s, served by the Worker; the preview and demo show his shipped photo',
    got[0] === '/img/eric-avatar.jpg' && got[1] === '/img/eric-avatar.jpg' && got[2] === '/img/eric-avatar.jpg'
    && got[3] === '/api/advocates/headshot?uid=abcDEF123' && got[4] === '/api/advocates/headshot?uid=a%20b',
    JSON.stringify(got));
  const mount = (file) => (f(file).match(/mountChat\(\{[\s\S]*?\n\s*\}\);/) || [''])[0];
  const client = ['public/js/case.js', 'public/js/chat-page.js', 'public/js/subscription.js'].map(mount);
  const his = ['public/js/admin-case.js', 'public/js/admin-chats.js'].map(mount);
  // NEGATIVE CONTROL (run 2026-10-15): `dayLines: true,` taken out of subscription.js's chat made this read
  //   FAIL  B2 every chat a client has shows his face beside his words and a line for each day; his own chats do not change
  check('B2 every chat a client has shows his face beside his words and a line for each day; his own chats do not change',
    client.every((m) => /otherAvatar: advocatePhoto\(/.test(m) && /dayLines: true,/.test(m) && /myRole: 'client'/.test(m))
    && his.every((m) => m && !/otherAvatar|dayLines/.test(m)),
    JSON.stringify({ client: client.map((m) => m.length), his: his.map((m) => m.length) }));
  // NEGATIVE CONTROL (run 2026-10-15): the avatar given to every message, his own question rows included, made this read
  //   FAIL  B3 his face rides only the first of each run of his words, never the client's own or a question row, with a name for a screen reader
  check('B3 his face rides only the first of each run of his words, never the client\'s own or a question row, with a name for a screen reader',
    // RE-PINNED 2026-10-16 (v7.59): a message he sends on someone else's case (byName) carries his name,
    // never their advocate's face.
    // NEGATIVE CONTROL (run 2026-10-16, v7.59): the avatar's `&& !data.byName` taken out made B3 read FAIL.
    /if \(otherAvatar && !mine && !isQ && !data\.byName\) \{/.test(CHAT) && /ava\.className = prevTheirs \? 'msg-ava gap' : 'msg-ava';/.test(CHAT)
    && /ava\.alt = prevTheirs \? '' : \(otherName \|\| ''\);/.test(CHAT) && /prevTheirs = !mine && !isQ;/.test(CHAT)
    && /return diff === 0 \? 'Today' : diff === 1 \? 'Yesterday' : dayFmt\.format\(d\);/.test(CHAT));
  const big = statSync(j(ROOT, 'public/img/eric-headshot.jpg')).size;
  const small = statSync(j(ROOT, 'public/img/eric-avatar.jpg')).size;
  const ADV = f('worker/advocates.js');
  // NEGATIVE CONTROL (run 2026-10-15): the Worker's OWNER_PHOTO pointed at a file that is not there made this read
  // NEGATIVE CONTROL (run 2026-10-15): eric-avatar.jpg swapped for a face crop of the same photo made this read
  //   FAIL  B4 his photo ships with the site whole, never cropped (Eric: "Don't crop my photo"), large and small, and the Worker sends his cases to it
  check('B4 his photo ships with the site whole, never cropped (Eric: "Don\'t crop my photo"), large and small, and the Worker sends his cases to it',
    big > 30_000 && big < 200_000 && small > 2_000 && small < 30_000
    // The whole frame: the upload is 1206 by 1197, so a resize keeps that shape and a crop would not.
    && Math.abs(sharpDims('public/img/eric-headshot.jpg') - 1206 / 1197) < 0.01 && Math.abs(sharpDims('public/img/eric-avatar.jpg') - 1206 / 1197) < 0.02
    && /const OWNER_PHOTO = '\/img\/eric-headshot\.jpg';/.test(ADV) && !!statSync(j(ROOT, 'public', (ADV.match(/const OWNER_PHOTO = '([^']+)';/) || [, 'x'])[1]), { throwIfNoEntry: false }),
    JSON.stringify({ big, small }));
}

console.log('\n--- C. progress, celebrated ---');
{
  const CASE = f('public/js/case.js');
  // RE-PINNED 2026-10-15 (v7.53): cheerCard counts the steps this case runs on (stepsOf: Full-Service owes no report),
  // so the harness carries FULL_STEPS and stepsOf beside STEPS.
  // NEGATIVE CONTROL (run 2026-10-15, v7.53): the paused case's `|| c.hold?.pausedAt` taken out still made C1 read FAIL.
  const src = [(CASE.match(/const STEPS = \[[\s\S]*?\n\];/) || [''])[0], (CASE.match(/const FULL_STEPS = [\s\S]*?\]\)\);/) || [''])[0],
    (CASE.match(/const stepsOf = [^\n]*;/) || [''])[0], (CASE.match(/const CHEER = \{[\s\S]*?\n\};/) || [''])[0],
    (CASE.match(/function cheerCard\(c, rank, closed\) \{[\s\S]*?\n\}/) || [''])[0]].join('\n');
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const cheer = new Function('esc', `${src}\nreturn cheerCard;`)(esc);
  const delivered = cheer({ status: 'delivered' }, 6, false);
  const paid = cheer({ status: 'paid' }, 1, false);
  const closed = cheer({ status: 'closed' }, 7, true);
  const paused = cheer({ status: 'delivered', hold: { pausedAt: 'x' } }, 6, false);
  const odd = cheer({ status: 'something-else' }, 3, false);
  // NEGATIVE CONTROL (run 2026-10-15): the paused case's `|| c.hold?.pausedAt` taken out of cheerCard made this read
  //   FAIL  C1 the progress card cheers where the case is with a party popper and the steps done, and stays away from a paused case
  check('C1 the progress card cheers where the case is with a party popper and the steps done, and stays away from a paused case',
    /🎉/.test(delivered) && /Your report is ready\./.test(delivered) && /6 of 7 steps done/.test(delivered) && /width:86%/.test(delivered)
    && /1 of 7 steps done/.test(paid) && /7 of 7 steps done/.test(closed) && /The file is yours forever/.test(closed)
    && paused === '' && odd === '' && /aria-label="6 of 7 steps done"/.test(delivered) && /aria-hidden="true">🎉/.test(delivered),
    JSON.stringify({ delivered: delivered.replace(/\s+/g, ' ').slice(0, 300), paused, odd }));
  // NEGATIVE CONTROL (run 2026-10-15): `${cheerCard(c, rank, closed)}` taken out of the Progress page made this read
  //   FAIL  C2 it sits on the Progress page under the appointment, and its confetti holds still for anyone who asked for less motion
  check('C2 it sits on the Progress page under the appointment, and its confetti holds still for anyone who asked for less motion',
    /<\/section>\n\s*\$\{cheerCard\(c, rank, closed\)\}\n\s*\$\{hoursCard\(c\)\}/.test(CASE)
    && /@media \(prefers-reduced-motion: no-preference\) \{\n\s*\.cheer-ic \{ animation: cheer-pop/.test(WARM)
    && !DASH.test(src));
}

console.log('\n--- D. his tan folders ---');
{
  const ADMIN = f('public/css/admin.css');
  const R = rules(ADMIN);
  const drawer = R.find(([sel]) => sel === ':root:not([data-scheme="contrast"]) .drawer')?.[1] || '';
  // NEGATIVE CONTROL (run 2026-10-15): the drawer's --manila put back to #1B1B21 made this read
  //   FAIL  D1 the Clients shelf is manila again, set on the shelf alone, the case page's own tabs untouched
  check('D1 the Clients shelf is manila again, set on the shelf alone, the case page\'s own tabs untouched',
    /--manila: #DEC791;/.test(drawer) && /--manila-2: #F0DFB0;/.test(drawer) && /--manila-ink: #2A2113;/.test(drawer) && /--manila-edge: #A98F5F;/.test(drawer)
    && R.some(([sel, body]) => sel === ':root:not([data-scheme="contrast"]) .drawer .folder-body' && /var\(--manila-2\), var\(--manila\) 80%/.test(body))
    && !R.some(([sel, body]) => /^:root:not\(\[data-scheme="contrast"\]\)( body)?$/.test(sel) && /--manila:/.test(body)),
    drawer);
  // NEGATIVE CONTROL (run 2026-10-15): the open rim's gradient taken out of admin.css made this read
  //   FAIL  D2 the glow stays: open cases ringed cyan to violet, paused in gold, and the clock on a lit rim reads in light ink
  check('D2 the glow stays: open cases ringed cyan to violet, paused in gold, and the clock on a lit rim reads in light ink',
    R.some(([sel, body]) => sel === ':root .drawer .folder.st-open:not(.working):not(.self)' && /linear-gradient\(135deg, #3DDCF5, #B57BFF\)/.test(body))
    && R.some(([sel, body]) => sel === ':root .drawer .folder.st-paused:not(.working):not(.self)' && /#F6D77A, #E9B949/.test(body))
    && R.some(([sel, body]) => sel === ':root .drawer .folder:is(.st-open, .st-paused):not(.working):not(.self) .folder-clock' && /color: #F5F5F7;/.test(body)));
  // NEGATIVE CONTROL (run 2026-10-15): the tan Delete's ink put back to #FFB3B3 made this read
  //   FAIL  D3 the words that were bright on black read on the stock: Delete, the alert, the family flag and the gold labels
  check('D3 the words that were bright on black read on the stock: Delete, the alert, the family flag and the gold labels',
    R.some(([sel, body]) => sel === ':root:not([data-scheme="contrast"]) .drawer .folder-del' && /color: #7A271F;/.test(body))
    && R.some(([sel, body]) => sel === ':root:not([data-scheme="contrast"]) .drawer .fld-alert' && /background: #7A271F;/.test(body) && /color: #FFFFFF;/.test(body))
    && R.some(([sel, body]) => sel === ':root:not([data-scheme="contrast"]) .drawer .folder-body' && /--orange: #7A4A00;/.test(body))
    && !DASH.test(ADMIN.slice(ADMIN.indexOf('THE TAN FOLDERS, BACK'))));
}

console.log('\n--- E. warm everywhere, blue and purple in Settings (v7.57) ---');
{
  // Eric, 2026-10-16: "Warm gradient we have going on should be default everywhere, with the blue/purple being in settings"
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const meta = { content: '#1E1519', setAttribute(k, v) { this.content = v; } };
  // RE-PINNED 2026-10-17 (v7.64): the root has a style now, for the color wheel's --pa-hue.
  const rootStyle = new Map();
  globalThis.document = { documentElement: { dataset: { scheme: 'calm' }, style: { setProperty: (k, v) => rootStyle.set(k, v), removeProperty: (k) => rootStyle.delete(k) } }, querySelector: () => meta, dispatchEvent: () => true };
  globalThis.CustomEvent = class { constructor(n, o) { this.type = n; this.detail = o?.detail; } };
  const T = await import(pathToFileURL(j(ROOT, 'public/js/theme.js')).href);
  const first = T.currentAppearance();
  T.applyAppearance('cool');
  const cool = { look: document.documentElement.dataset.look, stored: store.get('pa-look'), scheme: store.get('pa-scheme'), meta: meta.content, now: T.currentAppearance() };
  T.applyAppearance('warm');
  const warm = { look: document.documentElement.dataset.look, stored: store.get('pa-look'), meta: meta.content, now: T.currentAppearance() };
  T.applyAppearance('contrast');
  const contrast = { scheme: document.documentElement.dataset.scheme, meta: meta.content, now: T.currentAppearance() };
  const SET = f('public/js/settings.js');
  // NEGATIVE CONTROL (run 2026-10-16, v7.57): applyAppearance's `document.documentElement.dataset.look = 'cool'` taken out made this read
  //   FAIL  E1 warm is the look unless this device chooses Blue and purple in Settings: the choice is kept, takes effect at once and paints the bar; High contrast still outranks both
  check('E1 warm is the look unless this device chooses Blue and purple in Settings: the choice is kept, takes effect at once and paints the bar; High contrast still outranks both',
    first === 'warm' && cool.look === 'cool' && cool.stored === 'cool' && cool.scheme === 'calm' && cool.meta === '#0A0A0C' && cool.now === 'cool'
    && warm.look === undefined && warm.stored === 'warm' && warm.meta === '#1E1519' && warm.now === 'warm'
    && contrast.scheme === 'contrast' && contrast.meta === '#000000' && contrast.now === 'contrast'
    // RE-PINNED 2026-10-17 (v7.64): Settings offers the color wheel and Black (Eric: "allow it to be adjusted via a
    // color wheel in settings ... Include black"); a device that chose Blue and purple keeps it until it chooses again.
    // NEGATIVE CONTROL (run 2026-10-17, v7.64): applyAppearance's Blue and purple line made `if (id === 'cool') void 0;`
    // made E1 read FAIL.
    && /applyAppearance\(on \? 'contrast' : 'warm'\);/.test(SET) && /const scheme = currentAppearance\(\);/.test(SET),
    JSON.stringify({ first, cool, warm, contrast }));
  const R = rules(WARM);
  const has = (sel, re) => R.some(([s2, body]) => s2 === `${W} ${sel}` && re.test(body));
  const EMPL = f('public/admin-employer.html');
  // NEGATIVE CONTROL (run 2026-10-16, v7.57): warm.css's `.add-btn` rule taken out made this read
  //   FAIL  E2 his working pages are warm too: the +, an open case's breathing rim and the chat bubble take the warm pop, and Employer mode's money, initials and buttons follow the look
  check('E2 his working pages are warm too: the +, an open case\'s breathing rim and the chat bubble take the warm pop, and Employer mode\'s money, initials and buttons follow the look',
    has('.add-btn', /background: var\(--warm-pop\);/) && has('.drawer .folder.st-open:not(.working):not(.self)', /linear-gradient\(135deg, #FFC48A, #F59BBF\)/)
    && has('.sc-fab', /background: var\(--warm-pop\);/) && /@keyframes st-open-glow-warm/.test(WARM)
    && (EMPL.match(/var\(--warm-pop, linear-gradient/g) || []).length === 2 && /main \.btn\.quiet \{ background: color-mix\(in srgb, var\(--cyan\) 12%, transparent\);/.test(EMPL)
    && !/rgba\(61, 220, 245/.test(EMPL));
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
