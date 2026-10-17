// cancelsearch.mjs - the clear cancel, chat search, and the one look.
//
// Eric, 2026-10-15: "When they do open a case, they need a clear way to
// cancel. So that will be in a hamburger menu at the top right of their
// advocacy case screen. Remember, everywhere should have this same aesthetic
// including the chat box, the files, everything. ... With the chat case,
// there should be a search button for if they want to search the chat for key
// words. Like Facebook, the key words get highlighted in a pop-out and they
// can select them and it places them back in that spot in the chat. They can
// tap a down arrow in the chat box to return to the current position at the
// bottom of the chat. When searching, they can tap off the search anywhere on
// screen to cancel. I also get this ability."
//
// The Worker's portal route and subscription sync, the menu's renewing()
// rule, and the search's matching are lifted and RUN. The tapping itself is
// driven in a browser by drive-chatsearch.mjs.
//
// Run: node cancelsearch.mjs
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { findHits, snippet, MIN_QUERY } from '../../public/js/chat-search.js';

const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
const SRC = readFileSync(__j(__REPO, 'worker/index.js'), 'utf8');
const f = (p) => readFileSync(__j(__REPO, p), 'utf8');
const DASH = new RegExp('[\\u2013\\u2014]');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
function fn(src, name) {
  const m = src.match(new RegExp(`\\n(?:export )?async function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0].replace('export ', '');
}
function sfn(src, name) {
  const m = src.match(new RegExp(`\\n(?:export )?function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0].replace('export ', '');
}

// ---------------------------------------------------------------------------
console.log('\n--- A. the clear cancel ---');
const AUTH = f('public/js/auth.js');
{
  const renewing = new Function(`${sfn(AUTH, 'renewing')}; return renewing;`)();
  const now = Date.UTC(2026, 9, 15);
  const later = { toDate: () => new Date(now + 20 * 86_400_000) };
  // NEGATIVE CONTROL (run 2026-10-15): the `sub.cancelAtPeriodEnd` test taken out of renewing() made this read
  //   FAIL  A1 there is something to cancel only while the subscription still renews: not once cancelled, not once ended
  check('A1 there is something to cancel only while the subscription still renews: not once cancelled, not once ended',
    renewing({ status: 'active', currentPeriodEnd: later }, now) === true
    && renewing({ status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: later }, now) === false
    && renewing({ status: 'canceled', currentPeriodEnd: later }, now) === false
    && renewing({ status: 'active', currentPeriodEnd: new Date(now - 1000) }, now) === false
    && renewing(null, now) === false);
  const client = AUTH.slice(AUTH.indexOf('} else {\n      el.innerHTML =\n'), AUTH.indexOf("el.querySelector('[data-signout]')"));
  // NEGATIVE CONTROL (run 2026-10-15): the Cancel subscription link taken out of the client's menu made this read
  //   FAIL  A2 a signed-in client's menu carries Cancel subscription, shown only when there is one to cancel, and it opens the cancel step
  check('A2 a signed-in client\'s menu carries Cancel subscription, shown only when there is one to cancel, and it opens the cancel step',
    /<a href="\/subscription\.html#cancel" data-nav-cancel hidden>Cancel subscription<\/a>/.test(client)
    && /showCancel\(el, user\)/.test(client)
    && /if \(link && snap\.exists\(\) && renewing\(snap\.data\(\)\)\) link\.hidden = false;/.test(fn(AUTH, 'showCancel')));
  // NEGATIVE CONTROL (run 2026-10-15): data-always-menu taken off case.html's bar made this read
  //   FAIL  A3 the menu sits at the top right of every screen a client works in
  check('A3 the menu sits at the top right of every screen a client works in',
    ['case', 'chat', 'subscription', 'return'].every((n) => /<div class="bar-inner" data-always-menu>/.test(f(`public/${n}.html`))));
}
{
  // handlePortal, run against a Stripe that records what it is asked.
  const calls = [];
  let refuseFlow = false;
  const deps = {
    requireUser: async () => ({ uid: 'u1' }),
    getDoc: async () => ({ data: { stripeCustomerId: 'cus_1', subscriptionId: 'sub_1' } }),
    stripePost: async (env, path, params) => {
      calls.push(params);
      if (refuseFlow && params.flow_data) throw new Error('stripe: no cancel in this portal');
      return { url: params.flow_data ? 'https://stripe/cancel' : 'https://stripe/portal' };
    },
    json: (b, s = 200) => new Response(JSON.stringify(b), { status: s }),
  };
  const handlePortal = new Function(...Object.keys(deps), `${fn(SRC, 'handlePortal')}; return handlePortal;`)(...Object.values(deps));
  const env = { PUBLIC_BASE_URL: 'https://x.example' };
  const req = (body) => ({ json: async () => body });
  const cancel = await (await handlePortal(req({ flow: 'cancel' }), env)).json();
  const sent = calls[0];
  refuseFlow = true;
  const fallback = await (await handlePortal(req({ flow: 'cancel' }), env)).json();
  refuseFlow = false;
  calls.length = 0;
  const plain = await (await handlePortal(req({}), env)).json();
  // NEGATIVE CONTROL (run 2026-10-15): the flow_data block taken out of handlePortal made this read
  //   FAIL  A4 Cancel opens Stripe's own cancel step for that subscription and comes back after; if Stripe refuses, the ordinary portal opens; Manage stays the ordinary portal
  check('A4 Cancel opens Stripe\'s own cancel step for that subscription and comes back after; if Stripe refuses, the ordinary portal opens; Manage stays the ordinary portal',
    cancel.url === 'https://stripe/cancel' && sent.flow_data?.type === 'subscription_cancel'
    && sent.flow_data.subscription_cancel.subscription === 'sub_1'
    && sent.flow_data.after_completion.redirect.return_url === 'https://x.example/subscription.html'
    && fallback.url === 'https://stripe/portal' && plain.url === 'https://stripe/portal' && !calls[0].flow_data,
    JSON.stringify({ cancel, fallback, plain }));
}
{
  const patched = [];
  const deps = {
    uidForCustomer: async () => 'u1',
    patchDoc: async (env, path, fields) => { patched.push(fields); },
    getDoc: async () => ({ data: { email: 'a@b.c' } }),
    sendEmail: async () => true,
  };
  const syncSubscription = new Function(...Object.keys(deps), `${fn(SRC, 'syncSubscription')}; return syncSubscription;`)(...Object.values(deps));
  await syncSubscription({}, { metadata: { uid: 'u1' }, status: 'active', cancel_at_period_end: true, current_period_end: 1_800_000_000 });
  await syncSubscription({}, { metadata: { uid: 'u1' }, status: 'active', cancel_at_period_end: false });
  // NEGATIVE CONTROL (run 2026-10-15): cancelAtPeriodEnd taken out of syncSubscription's fields made this read
  //   FAIL  A5 a cancelled subscription that runs to its month's end is recorded as no longer renewing, and a resumed one as renewing
  check('A5 a cancelled subscription that runs to its month\'s end is recorded as no longer renewing, and a resumed one as renewing',
    patched[0]?.cancelAtPeriodEnd === true && patched[1]?.cancelAtPeriodEnd === false, JSON.stringify(patched));
}
{
  const SUB = f('public/js/subscription.js');
  // NEGATIVE CONTROL (run 2026-10-15): both #cancel openers (on load and on hashchange) deleted from subscription.js made this read
  //   FAIL  A6 the subscription page opens a plain cancel sheet on #cancel, says what happens, keeps Keep it first, and asks Stripe for the cancel step
  check('A6 the subscription page opens a plain cancel sheet on #cancel, says what happens, keeps Keep it first, and asks Stripe for the cancel step',
    /if \(location\.hash === '#cancel'\) openCancel\(\);/.test(SUB)
    && /<h2 id="cancel-title">Cancel 24\/7 Priority Chat\?<\/h2>/.test(SUB)
    && /Your subscription renews monthly unless you choose to cancel it\. If you cancel, your chat stays open until/.test(SUB)
    && /data-cancel-keep autofocus>Keep it</.test(SUB)
    && /body: JSON\.stringify\(\{ flow: 'cancel' \}\)/.test(SUB)
    && /Canceled\. Your chat stays open until/.test(SUB));
}

// ---------------------------------------------------------------------------
console.log('\n--- B. chat search ---');
{
  const msgs = [
    { id: 'm1', text: 'My MRI is on Tuesday.', who: 'You' },
    { id: 'm2', text: 'Send the MRI   report when it lands.', who: 'Eric' },
    { id: 'm3', text: 'Thanks!', who: 'You' },
    { id: 'm4', text: 'mri report uploaded', who: 'You' },
  ];
  const hits = findHits(msgs, '  mri  REPORT ');
  // NEGATIVE CONTROL (run 2026-10-15): .reverse() taken out of findHits made this read
  //   FAIL  B1 search finds every message with the words, whatever the case or spacing, newest first, and ignores a one-letter search
  check('B1 search finds every message with the words, whatever the case or spacing, newest first, and ignores a one-letter search',
    hits.map((h) => h.id).join() === 'm4,m2' && findHits(msgs, 'm').length === 0 && MIN_QUERY === 2 && findHits(msgs, 'zzz').length === 0,
    hits.map((h) => h.id).join());
  const snip = snippet('A very long opening that goes on and on before the word MRI shows up and then more words after it that keep going for a while', 'mri', 20);
  // NEGATIVE CONTROL (run 2026-10-15): the <mark> taken out of snippet() made this read
  //   FAIL  B2 the pop-out shows the words around the match with the match highlighted, and nothing typed runs as markup
  check('B2 the pop-out shows the words around the match with the match highlighted, and nothing typed runs as markup',
    /<mark>MRI<\/mark>/.test(snip) && snip.startsWith('…') && snip.endsWith('…')
    && !/<img/.test(snippet('<img src=x onerror=alert(1)> mri', 'mri')) && /&lt;img/.test(snippet('<img src=x onerror=alert(1)> mri', 'mri')),
    snip);
  const CHAT = f('public/js/chat.js');
  const S = f('public/js/chat-search.js');
  // NEGATIVE CONTROL (run 2026-10-15): the search.refresh() call taken out of paintChat made this read
  //   FAIL  B3 every chat, his and the client's, gets the search and the down arrow, kept current after every repaint
  check('B3 every chat, his and the client\'s, gets the search and the down arrow, kept current after every repaint',
    /import \{ mountChatSearch \} from '\.\/chat-search\.js';/.test(CHAT)
    // RE-PINNED 2026-10-16 (v7.56): the client's side names their own advocate (otherName), Eric when it is his.
    // NEGATIVE CONTROL (run 2026-10-16, v7.56): the search's `(otherName || 'Eric')` made `'Eric'` made B3 read FAIL.
    && /const search = mountChatSearch\(\{ container, log, otherName: myRole === 'admin' \? 'Client' : \(otherName \|\| 'Eric'\) \}\);/.test(CHAT)
    && /paintSaved\(\);\s*search\.refresh\(\);\s*\};/.test(CHAT));
  // NEGATIVE CONTROL (run 2026-10-15): the tap-off listener's `!tools.contains(e.target)` test taken out made this read
  //   FAIL  B4 a tap anywhere off the search cancels it and takes the highlights back out; Escape does too
  check('B4 a tap anywhere off the search cancels it and takes the highlights back out; Escape does too',
    /document\.addEventListener\('pointerdown', \(e\) => \{\s*if \(open && !tools\.contains\(e\.target\)\) closeSearch\(\);\s*\}, true\);/.test(S)
    && /if \(e\.key === 'Escape'\) closeSearch\(\);/.test(S) && /function closeSearch\(\) \{[\s\S]*?unmark\(log\);/.test(S));
  // NEGATIVE CONTROL (run 2026-10-15): the down arrow's scrollTo target changed to 0 made this read
  //   FAIL  B5 picking a result scrolls to that message and marks the words in it, and the down arrow appears up the thread and goes to the newest message
  check('B5 picking a result scrolls to that message and marks the words in it, and the down arrow appears up the thread and goes to the newest message',
    /function go\(id\) \{[\s\S]*?markIn\(el\.querySelector\('\.msg-text'\), input\.value\);[\s\S]*?log\.scrollTo\(/.test(S)
    && /bottom\.hidden = away < 160;/.test(S) && /log\.scrollTo\(\{ top: log\.scrollHeight, behavior: 'smooth' \}\);/.test(S));
}

// ---------------------------------------------------------------------------
console.log('\n--- C. one look ---');
{
  const pages = readdirSync(__j(__REPO, 'public')).filter((n) => n.endsWith('.html') && n !== 'fund.html');
  const bad = [];
  for (const n of pages) {
    const h = f(`public/${n}`);
    const links = [...h.matchAll(/<link rel="stylesheet" href="\/css\/([\w-]+)\.css[^"]*">/g)].map((m) => m[1]);
    const look = links.indexOf('look');
    const landing = links.indexOf('landing');
    // RE-PINNED 2026-10-15 (v7.45): Eric, "I'd like the client side to look warm and engaging", on all client
    // pages: the four a client lives in load warm.css right after the look, and no other page loads it.
    // RE-PINNED 2026-10-16 (v7.57): Eric, "Warm gradient we have going on should be default everywhere, with the
    // blue/purple being in settings". Every page but the home and the package pages (which have landing-warm.css)
    // loads warm.css right after the look; the head snippet keeps High contrast and reads Blue and purple
    // (pa-look) before paint, and the shipped theme-color is the warm ground.
    const warm = links.indexOf('warm');
    const ok = look >= 0 && (landing >= 0 ? warm === -1 && look === landing - 1 && landing === links.length - 1 : warm === look + 1 && warm === links.length - 1)
      && /<html lang="en" data-default-scheme="calm">/.test(h)
      && /localStorage\.getItem\('pa-scheme'\) === 'contrast' \? 'contrast' : 'calm';/.test(h)
      && /var cool = localStorage\.getItem\('pa-look'\) === 'cool';\n\s+if \(cool\) document\.documentElement\.dataset\.look = 'cool';/.test(h)
      && /<meta name="theme-color" content="#1E1519">/.test(h);
    if (!ok) bad.push(`${n}:${links.join('/')}`);
  }
  // NEGATIVE CONTROL (run 2026-10-15): look.css's link taken off chat.html made this read
  // NEGATIVE CONTROL (run 2026-10-15, v7.45): warm.css's link put on admin.html made this read
  //   FAIL  C1 every page but the hidden fund form loads the look last (the home's own sheet after it), paints black, and keeps High contrast
  // NEGATIVE CONTROL (run 2026-10-16, v7.57): warm.css's link taken off admin.html made C1 read FAIL.
  check('C1 every page but the hidden fund form loads the look last (the home\'s own sheet after it), paints black, and keeps High contrast',
    pages.length >= 25 && bad.length === 0, bad.join(' '));
  const tokens = (css, sel) => {
    const at = css.indexOf(`${sel} {\n  --bg:`);
    const block = css.slice(at, css.indexOf('\n}', at));
    return [...block.matchAll(/(--[\w-]+): ([^;]+);/g)].map((m) => `${m[1]}=${m[2]}`).join(';');
  };
  const LOOK = f('public/css/look.css');
  const LAND = f('public/css/landing.css');
  const a = tokens(LOOK, ':root:not([data-scheme="contrast"]) body');
  const b = tokens(LAND, ':root:not([data-scheme="contrast"]) body.landing');
  // NEGATIVE CONTROL (run 2026-10-15): look.css's --cyan changed to #3DDCF6 made this read
  //   FAIL  C2 the look's colours are the home's colours, value for value
  check('C2 the look\'s colours are the home\'s colours, value for value', a.length > 400 && a === b);
  const THEME = f('public/js/theme.js');
  // NEGATIVE CONTROL (run 2026-10-15): Daylight put back into SCHEMES made this read
  //   FAIL  C3 the scheme picker offers the look and High contrast, nothing else, and the look is the default
  // RE-PINNED 2026-10-16 (v7.57): the picker offers the two looks, Warm (the default) and Blue and purple, and
  // High contrast; the schemes underneath are still the look and High contrast, the look still the default.
  // NEGATIVE CONTROL (run 2026-10-16, v7.57): Daylight put into APPEARANCES made C3 read FAIL.
  // RE-PINNED 2026-10-17 (v7.64): Eric, "allow it to be adjusted via a color wheel in settings ... Include black":
  // the picker offers the warm look (its wheel) and Black; the schemes underneath are still the look and High contrast.
  // NEGATIVE CONTROL (run 2026-10-17, v7.64): Daylight put into APPEARANCES made C3 read FAIL.
  // RE-PINNED 2026-10-17 (v7.66): Eric, "The color wheel is horrendous. Get rid of it. Have it be either the blue/green
  // from before or this warm look, or just black on white": the picker offers Warm, Blue and green and Black; the
  // schemes underneath are still the look and High contrast, the look still the default.
  // NEGATIVE CONTROL (run 2026-10-17, v7.66): Daylight put into APPEARANCES made C3 read FAIL.
  check('C3 the scheme picker offers the look and High contrast, nothing else, and the look is the default',
    (THEME.match(/\{ id: '(\w+)'/g) || []).join() === "{ id: 'calm',{ id: 'contrast',{ id: 'warm',{ id: 'cool',{ id: 'contrast'" && /export function defaultScheme\(\) \{\s*return 'calm';\s*\}/.test(THEME)
    && /return localStorage\.getItem\(LOOK_KEY\) === 'cool' \? 'cool' : 'warm';/.test(THEME));
}

// ---------------------------------------------------------------------------
console.log('\n--- D. the look audit\'s fixes ---');
{
  // Two finders and a judge (2026-10-15). The judge's rulings that are code, not colour.
  const ADMC = f('public/js/admin-case.js');
  const FIT = f('public/js/admin-fit.js');
  const CASE = f('public/js/case.js');
  const CHAT = f('public/js/chat.js');
  const SHEET = f('public/js/sheet.js');
  const live = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  // NEGATIVE CONTROL (run 2026-10-15): the appeal letter's ask() put back to prompt() made this read
  //   FAIL  D1 nothing asks through the browser's own box any more: his amounts, reasons and links and the client's deletes go through the app's sheet
  check('D1 nothing asks through the browser\'s own box any more: his amounts, reasons and links and the client\'s deletes go through the app\'s sheet',
    !/\bprompt\(/.test(live(ADMC)) && !/\bprompt\(/.test(live(FIT))
    && !/confirm\(`Delete/.test(CASE) && !/confirm\('Withdraw this authorisation/.test(CASE) && !/confirm\(`Save "/.test(CHAT)
    && [ADMC, FIT, CASE, CHAT].every((src) => /import \{ ask \} from '\.\/sheet\.js';/.test(src))
    && /export function ask\(/.test(SHEET) && /dlg\.showModal\(\);/.test(SHEET));
  const SITE = f('public/css/site.css');
  const GLOW = f('public/css/glowup.css');
  // NEGATIVE CONTROL (run 2026-10-15): glowup.css's .btn font put back to `font: 700 var(--t-small)/1.25 inherit;` made this read
  //   FAIL  D2 buttons take the page's font: no shorthand that the browser drops is left on .btn, .cta or .pill
  check('D2 buttons take the page\'s font: no shorthand that the browser drops is left on .btn, .cta or .pill',
    !/font: 700 \.92rem\/1\.2 inherit; letter-spacing: \.01em;\n/.test(SITE.slice(SITE.indexOf('.btn {'), SITE.indexOf('.btn {') + 600))
    && !/font: [^;]*var\([^;]*\) *\/[^;]*inherit;/.test(GLOW)
    && /:where\(button, input, select, textarea\) \{ font-family: inherit; \}/.test(f('public/css/look.css')));
  const FOLDER = f('public/js/folder.js');
  // NEGATIVE CONTROL (run 2026-10-15): iconHtml's 'i-' branch made to return the text made this read
  //   FAIL  D3 the tab rails draw the home's stroke icons, on the client's case and on his
  check('D3 the tab rails draw the home\'s stroke icons, on the client\'s case and on his',
    /return \/\^i-\[a-z-\]\+\$\/\.test\(icon\)\s*\?\s*`<svg class="ico" aria-hidden="true"><use href="\/img\/icons\.svg#\$\{icon\}"\/><\/svg>`/.test(FOLDER)
    && ["icon: 'i-pin'", "icon: 'i-chat'", "icon: 'i-doc'", "icon: 'i-gem'"].every((x) => CASE.includes(x))
    // RE-PINNED 2026-10-17 (v7.65): Act is Log (Eric: "replace that whole tab with simply 'log'"), drawn with the tick.
    // NEGATIVE CONTROL (run 2026-10-17, v7.65): the Log group's icon put back to 'i-scale' made D3 read FAIL.
    && ["icon: 'i-folder'", "icon: 'i-check'", "icon: 'i-clip'"].every((x) => ADMC.includes(x)) && !ADMC.includes("icon: 'i-scale'")
    && ['i-pin', 'i-gem', 'i-bookmark', 'i-video', 'i-clip', 'i-folder', 'i-check', 'i-bolt'].every((id) => f('public/img/icons.svg').includes(`id="${id}"`)));
  // NEGATIVE CONTROL (run 2026-10-15): the manifest's theme_color put back to #EAF2FA made this read
  //   FAIL  D4 the installed app opens black too
  const MAN = JSON.parse(f('public/manifest.webmanifest'));
  check('D4 the installed app opens black too', MAN.background_color === '#0A0A0C' && MAN.theme_color === '#0A0A0C');
  // Eric, 2026-10-17, with a screenshot of it: "Pocket advocate icon reverted to old one. I want the icon to be the PA
  // one". The PA tile is the Home Screen icon, the tab icon and every icon the manifest names, each the size it says.
  const pngSize = (p) => { const b = readFileSync(__j(__REPO, p)); return b.toString('ascii', 12, 16) === 'IHDR' ? `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` : ''; };
  const iconPages = readdirSync(__j(__REPO, 'public')).filter((n) => n.endsWith('.html') && /rel="apple-touch-icon"/.test(f(`public/${n}`)));
  const oldIcon = iconPages.filter((n) => { const h = f(`public/${n}`); return !h.includes('<link rel="apple-touch-icon" href="/img/pa-icon-180.png">') || !h.includes('<link rel="icon" type="image/png" sizes="192x192" href="/img/pa-icon-192.png">'); });
  const named = (MAN.icons || []).map((i) => `${i.src}|${i.sizes}|${i.purpose}|${pngSize(`public${i.src}`)}`);
  // NEGATIVE CONTROL (run 2026-10-17): index.html's apple-touch-icon put back to /icon-180.png made this read
  //   FAIL  D5 the app icon is the PA one: on the Home Screen, in the tab and in the manifest, each image the size it says
  check('D5 the app icon is the PA one: on the Home Screen, in the tab and in the manifest, each image the size it says',
    iconPages.length >= 30 && !oldIcon.length
    && named.join(',') === '/img/pa-icon-180.png|180x180|any|180x180,/img/pa-icon-192.png|192x192|any|192x192,/img/pa-icon-512.png|512x512|any|512x512,/img/pa-icon-512-maskable.png|512x512|maskable|512x512'
    && pngSize('public/apple-touch-icon.png') === '180x180' && !DASH.test(MAN.description),
    JSON.stringify({ oldIcon, named }));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
