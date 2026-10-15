// tighten.mjs - the tighten audit, 2026-10-15.
//
// Eric, 2026-10-15, with a screenshot of the foot of the Services page:
// "There are just some redundant areas that are abysmally placed and
// confusing like this one. Send three agents to tighten things up with the
// same rules as the other agents as far as reporting back."
//
// Two finders walked every screen, a judge decided each finding, and the
// fixes pinned here are the ones the judge called. Where a rule can be lifted
// out of the page and run, it is; the rest are pinned on the source.
//
// Run: node tighten.mjs
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
const f = (p) => readFileSync(__j(__REPO, p), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
function sfn(src, name) {
  const m = src.match(new RegExp(`\\n(?:export )?function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0].replace('export ', '');
}
/** The slab of a file between two markers, or ''. */
function slab(src, from, to) {
  const a = src.indexOf(from);
  if (a < 0) return '';
  const b = src.indexOf(to, a + from.length);
  return b < 0 ? '' : src.slice(a, b);
}

const CASE = f('public/js/case.js');
const ADMINCASE = f('public/js/admin-case.js');
const ADMIN = f('public/js/admin.js');

// ---------------------------------------------------------------------------
console.log('\n--- T. nothing is sold that cannot be bought ---');
{
  const NAV = f('public/js/nav-menu.js');
  const hide = sfn(NAV, 'hideBookWhenClosed');
  const run = (open, demo, already = false) => {
    const head = [];
    const document = {
      head: { appendChild: (n) => head.push(n) },
      querySelector: (sel) => (sel === 'style[data-book-closed]' && (already || head.some((n) => 'data-book-closed' in n.attrs)) ? {} : null),
      createElement: () => ({ attrs: {}, textContent: '', setAttribute(k, v) { this.attrs[k] = v; } }),
    };
    const fn = new Function('document', `${hide}; return hideBookWhenClosed;`)(document);
    return { r: fn(open, demo), head };
  };
  const closed = run(false, false);
  // NEGATIVE CONTROL (run 2026-10-15): the `open ||` test taken out of hideBookWhenClosed made this read
  //   FAIL  T1 while cases are closed every link to the Book page is hidden, on every page, once; the demo and an open case keep them
  check('T1 while cases are closed every link to the Book page is hidden, on every page, once; the demo and an open case keep them',
    closed.r === true && closed.head.length === 1 && closed.head[0].textContent === 'a[href^="/book.html"]{display:none !important}'
    && run(true, false).r === false && run(true, false).head.length === 0
    && run(false, true).r === false && run(false, true).head.length === 0
    && run(false, false, true).r === false
    && /import\('\.\/sales\.js'\)\.then\(\(m\) => hideBookWhenClosed\(m\.packageOpen\('case'\), inDemo\(\)\)\)/.test(NAV),
    JSON.stringify(closed));

  // NEGATIVE CONTROL (run 2026-10-15): `<a href="/">Book</a>` put back in chat.html's menu made this read
  //   FAIL  T2 a client's menu has no Book, and My cases waits until there is a case to open
  const AUTH = f('public/js/auth.js');
  check('T2 a client\'s menu has no Book, and My cases waits until there is a case to open',
    ['case', 'chat', 'subscription', 'return'].every((n) => !f(`public/${n}.html`).includes('<a href="/">Book</a>'))
    && /<a href="\/case\.html" data-nav-cases hidden class=/.test(AUTH)
    && /showCases\(el, user\)\.catch\(\(\) => \{\}\);/.test(AUTH)
    && /if \(link && !snap\.empty\) link\.hidden = false;/.test(sfn(AUTH.replace('async function showCases', 'function showCases'), 'showCases')));

  // The Enhance tab's cards, lifted and run against a stand-in for each card's host.
  const SELLING = new Function(`${(CASE.match(/\nconst SELLING = [^\n]+/) || [''])[0]}; return SELLING;`)();
  const keep = new Function(`const SALES_OPEN = false; const SELLING = ${JSON.stringify(SELLING)}; ${sfn(CASE, 'keepCard')}; return keepCard;`)();
  const host = (html) => {
    const h = { innerHTML: html };
    h.querySelector = (sel) => {
      if (sel === SELLING) return /data-(th-request|buy-extend|buy-followup|buy-upgrade|ask-again)\b/.test(h.innerHTML) ? {} : null;
      if (sel === '[data-th-upcoming]') {
        const m = h.innerHTML.match(/<p[^>]*data-th-upcoming[\s\S]*?<\/p>/);
        return m ? { outerHTML: m[0] } : null;
      }
      if (sel === '[data-extend-again]') {
        return /data-extend-again/.test(h.innerHTML)
          ? { closest: () => ({ remove: () => { h.innerHTML = h.innerHTML.replace(/<p><button[^>]*data-extend-again[\s\S]*?<\/p>/, ''); } }) }
          : null;
      }
      return null;
    };
    return h;
  };
  const offer = host('<div class="followup-offer"><h3>Want to go deeper?</h3><button class="btn glow" data-buy-followup>Book a follow-up</button></div>');
  const visit = host('<div class="followup-offer"><h3>Bring me to your appointment</h3><p class="dim small" data-th-upcoming>Confirmed: Tue, Oct 20</p><button data-th-request>Pay and request</button></div>');
  const pending = host('<div class="followup-offer"><h3>Your request is with me</h3><button data-withdraw-upgrade>Withdraw my request</button></div>');
  const done = host('<div class="followup-offer is-done"><h3>Another month is on your case.</h3><p><button type="button" class="btn quiet" data-extend-again>Add another month</button></p></div>');
  const open = host('<div><button data-buy-upgrade>Ask me to take this case</button></div>');
  const r = [keep(offer), keep(visit), keep(pending), keep(done), keep(open, true)];
  // NEGATIVE CONTROL (run 2026-10-15): the kept-appointment branch in keepCard replaced with `host.innerHTML = ''` made this read
  //   FAIL  T3 while sales are closed an offer card empties, a confirmed appointment and a request under way stay, a finished month loses its buy-again button, and an open shop changes nothing
  check('T3 while sales are closed an offer card empties, a confirmed appointment and a request under way stay, a finished month loses its buy-again button, and an open shop changes nothing',
    /^\[data-th-request\],\[data-buy-extend\],\[data-buy-followup\],\[data-buy-upgrade\],\[data-ask-again\]$/.test(SELLING)
    && r.join() === 'false,true,true,true,true'
    && offer.innerHTML === ''
    && /Appointment advocacy/.test(visit.innerHTML) && /Confirmed: Tue, Oct 20/.test(visit.innerHTML) && !/data-th-request/.test(visit.innerHTML)
    && /Withdraw my request/.test(pending.innerHTML)
    && /Another month is on your case/.test(done.innerHTML) && !/data-extend-again/.test(done.innerHTML)
    && /data-buy-upgrade/.test(open.innerHTML),
    JSON.stringify({ r, visit: visit.innerHTML, done: done.innerHTML }));

  const addons = sfn(CASE, 'renderAddons');
  // NEGATIVE CONTROL (run 2026-10-15): the chat unlock panel's `&& SALES_OPEN` taken off made this read
  //   FAIL  T4 the Enhance tab drops its sales line and says the approved closed sentence when nothing is left, and the Chat tab's paid unlock is gone while closed
  check('T4 the Enhance tab drops its sales line and says the approved closed sentence when nothing is left, and the Chat tab\'s paid unlock is gone while closed',
    /import \{ SALES_OPEN, SALES_CLOSED_MESSAGE \} from '\.\/sales\.js';/.test(CASE)
    && /\$\{SALES_OPEN \? `<p class="dim small" style="margin:\.2rem 0 \.8rem;">Extras you can put on/.test(addons)
    && /if \(!SALES_OPEN && none && !\[th, ex, offer, up\]\.some\(\(h\) => h && h\.innerHTML\.trim\(\)\)\) \{\s*none\.textContent = SALES_CLOSED_MESSAGE;/.test(addons)
    && /const addAbout = \(host, topic\) => \{ if \(keepCard\(host\)\) addAboutButton\(host, topic\); \};/.test(addons)
    && /\$\{chatLocked && SALES_OPEN \? `\s*<div class="panel" data-chat-unlock/.test(CASE));

  // NEGATIVE CONTROL (run 2026-10-15): the telehealth seed set back to 45000 made this read
  //   FAIL  T5 the telehealth card quotes what Stripe charges: the live price, seeded with the Worker's own number
  const W = f('worker/index.js');
  const wTele = Number((W.match(/const TELEHEALTH_PRICE_CENTS = (\d+);/) || [])[1]);
  const seed = Number((CASE.match(/let telehealthCents = (\d+);/) || [])[1]);
  check('T5 the telehealth card quotes what Stripe charges: the live price, seeded with the Worker\'s own number',
    seed > 0 && seed === wTele && !/TELEHEALTH_PRICE_CENTS/.test(CASE)
    && /if \(Number\(d\?\.teleCents\) > 0\) telehealthCents = Number\(d\.teleCents\);/.test(CASE)
    && /<span class="price">\$\$\{\(telehealthCents \/ 100\)\.toFixed\(0\)\}<\/span>/.test(CASE),
    `case.js ${seed}, worker ${wTele}`);
}

// ---------------------------------------------------------------------------
console.log('\n--- U. one thing in one place ---');
{
  // NEGATIVE CONTROL (run 2026-10-15): the services closer ("Read the questions first") put back made this read
  //   FAIL  U1 the repeated closers and notes are gone: the Services closer, the case page's chat note, the Contact closer, About's case sections, the third US and Canada line, the doubled disclaimers, and the Reviews eyebrow
  const pages = readdirSync(__j(__REPO, 'public')).filter((n) => n.endsWith('.html'));
  check('U1 the repeated closers and notes are gone: the Services closer, the case page\'s chat note, the Contact closer, About\'s case sections, the third US and Canada line, the doubled disclaimers, and the Reviews eyebrow',
    !f('public/services.html').includes('Read the questions first')
    && !f('public/advocacy-case.html').includes('class="pkg-note"')
    && !f('public/contact.html').includes('Ready to book?')
    && !/How a case runs|What you get out of it/.test(f('public/about.html'))
    && pages.every((n) => !f(`public/${n}`).includes('class="foot-serving"'))
    && ['advocate', 'stats'].every((n) => !f(`public/${n}.html`).includes('<footer class="legal">'))
    && !f('public/reviews.html').includes('<footer class="footer-disclaimer">')
    && !f('public/reviews.html').includes('GOOGLE REVIEWS'));

  // A booked call still ahead counts even after the report (a Full-Service check-in rides on the
  // same appointment); found by drive-joinlink, whose demo case is delivered with a call in three days.
  // NEGATIVE CONTROL (run 2026-10-15): the booked-call-ahead half taken out of callAhead made this read FAIL U2, and
  // NEGATIVE CONTROL (run 2026-10-15): the "A copy is in your email" line gated on `closed` again instead of callAhead made this read
  //   FAIL  U2 the case card offers the call only while it is ahead, and names the session only when it is public
  const prog = sfn(CASE, 'renderProgress');
  check('U2 the case card offers the call only while it is ahead, and names the session only when it is public',
    /const callAhead = !closed && \(rank < STATUS_RANK\.awaiting_report\s*\|\| \(!!start && start\.getTime\(\) > Date\.now\(\) - 2 \* 3600_000\)\);/.test(prog)
    && /const joinHref = callAhead && method !== 'phone'/.test(prog)
    && /const icsHtml = callAhead && start \?/.test(prog)
    && /\$\{callAhead \? '<p class="dim small">A copy is in your email\./.test(prog)
    && /\$\{election\.choice === 'public' \? `<hr class="divide">/.test(prog) && !/'PRIVATE'/.test(prog));

  // NEGATIVE CONTROL (run 2026-10-15): the export block put back inside renderReview made this read
  //   FAIL  U3 Export as PDF sits under the files it exports, not at the foot of the review card
  const docs = sfn(CASE, 'renderDocs');
  check('U3 Export as PDF sits under the files it exports, not at the foot of the review card',
    /data-export>Export as PDF<\/button>/.test(docs) && docs.indexOf('data-files') < docs.indexOf('data-export')
    && /el\.querySelector\('\[data-export\]'\)\?\.addEventListener\('click', \(\) => openExport\(c\)\);/.test(docs)
    && !/data-export/.test(sfn(CASE, 'renderReview')));

  // NEGATIVE CONTROL (run 2026-10-15): the version line's jarHost placement put back made this read
  //   FAIL  U4 one explainer per thing: no second "?" on the telehealth card, no sign-in lesson inside the case file sheet, and the version line at the foot of every page
  const HELP = f('public/js/help.js');
  const caseHelp = slab(HELP, 'export function openCaseHelp', '\n}\n');
  const VN = f('public/js/version-note.js');
  check('U4 one explainer per thing: no second "?" on the telehealth card, no sign-in lesson inside the case file sheet, and the version line at the foot of every page',
    CASE.includes('<h3>Bring me to your appointment</h3>') && !/helpButton\(/.test(CASE)
    && caseHelp.length > 0 && !/signInBlock\(\)/.test(caseHelp)
    && !/jarHost/.test(VN) && /\n  host\.appendChild\(line\);\n\}/.test(VN) && !/pa-verline/.test(CASE));

  // NEGATIVE CONTROL (run 2026-10-15): the floor's tile loop deleted from stats.js made this read
  //   FAIL  U5 under the floor, the two tiles the server withholds wait with the rest of the ledger instead of sitting on "…"
  const STATS = f('public/js/stats.js');
  check('U5 under the floor, the two tiles the server withholds wait with the rest of the ledger instead of sitting on "…"',
    /for \(const k of \['reports', 'hours'\]\) \{\s*const tile = root\.querySelector\(`\[data-stat="\$\{k\}"\]`\)\?\.closest\('\.tile'\);\s*if \(tile\) tile\.hidden = !!s\.floor;/.test(STATS));

  // NEGATIVE CONTROL (run 2026-10-15): subscription.js's initSetupGuide call deleted made this read
  //   FAIL  U6 a new chat subscriber gets the same first-run guide as a case client, at the foot of the page, asked about notifications once
  const SUB = f('public/js/subscription.js');
  check('U6 a new chat subscriber gets the same first-run guide as a case client, at the foot of the page, asked about notifications once',
    /import \{ initSetupGuide \} from '\.\/onboarding\.js';/.test(SUB)
    && /mainEl\?\.insertBefore\(setupHost, mainEl\.querySelector\('\.footer-disclaimer'\)\);\s*initSetupGuide\(user, setupHost, \{ welcome: false \}\);/.test(SUB)
    && /initPushPrompt\(user, null\)/.test(SUB) && !/initPushPrompt\(user, page\)/.test(SUB)
    && !/beside your case title/.test(f('public/js/onboarding.js')));

  // NEGATIVE CONTROL (run 2026-10-15): the open-package removal loop deleted from waitlist.js made this read
  //   FAIL  U7 the waitlist never offers a package that is open, and opens on the package the visitor came from
  const WL = f('public/js/waitlist.js');
  check('U7 the waitlist never offers a package that is open, and opens on the package the visitor came from',
    /import \{ packageOpen \} from '\.\/sales\.js';/.test(WL)
    && /for \(const o of \[\.\.\.pick\.options\]\) if \(o\.value && packageOpen\(o\.value\)\) o\.remove\(\);/.test(WL)
    && /const wl = new URLSearchParams\(location\.search\)\.get\('wl'\);\s*if \(wl && \[\.\.\.pick\.options\]\.some\(\(o\) => o\.value === wl\)\) pick\.value = wl;/.test(WL));
}

// ---------------------------------------------------------------------------
console.log('\n--- V. the words ---');
{
  const WORDS = [
    ['public/js/sales-closed.js', "<p>Join the waitlist and I'll get back to you soon.</p>", "I'm not taking on new work right now."],
    ['public/js/chat-page.js', 'This conversation is closed. Your history stays here; subscribe to reach me.', 'book again or subscribe'],
    ['public/js/chat-page.js', "label: '24/7 Priority Chat'", 'Pocket Advocate line'],
    ['public/js/admin-settings.js', 'This device skips the home page and lands on Admin.', 'skips the booking page'],
    ['public/return.html', "'Your card is held and your case is being set up.", 'Your payment went through and'],
    ['public/return.html', "'Your card is held, but your case is taking longer than usual to open.", 'Your payment went through, but'],
    ['public/js/service-about.js', 'telehealth advocacy, or Full-Service Case Management\',', 'Full-Service Case Management at the difference'],
    ['public/js/admin-availability.js', "'🚫 <strong>Not currently offering.</strong>'", null],
  ];
  const miss = WORDS.filter(([p, now, was]) => !f(p).includes(now) || (was && f(p).includes(was))).map(([p, now]) => `${p}: ${now.slice(0, 40)}`);
  // NEGATIVE CONTROL (run 2026-10-15): "book again or " put back in chat-page.js's closed line made this read
  //   FAIL  V1 the judge's wording changes read as decided, and the old words are gone
  check('V1 the judge\'s wording changes read as decided, and the old words are gone', miss.length === 0, miss.join(' | '));

  // NEGATIVE CONTROL (run 2026-10-15): the open line on the availability page left unconditional made this read
  //   FAIL  V2 while sales are closed Eric's availability page says Not currently offering, and the line about clients booking is hidden
  const AV = f('public/js/admin-availability.js');
  check('V2 while sales are closed Eric\'s availability page says Not currently offering, and the line about clients booking is hidden',
    /import \{ SALES_OPEN \} from '\.\/sales\.js';/.test(AV)
    && /: SALES_OPEN\s*\? '✅ <strong>Open for new cases\.<\/strong> Clients can book any slot below\.'\s*: '🚫 <strong>Not currently offering\.<\/strong>';/.test(AV)
    && /for \(const el of document\.querySelectorAll\('\[data-when-sales-open\]'\)\) el\.hidden = !SALES_OPEN;/.test(AV)
    && /<span data-when-sales-open>Clients can only book slots you open here, 72\+ hours out\.<\/span>/.test(f('public/admin-availability.html')));

  // Not one em or en dash on a screen a person reads. waivers.js is frozen at
  // Eric's word and is the one file left out; its dashes are listed for him.
  const DASH = new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]|\\\\u201[34]`);
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).map((l) => l.replace(/(?<![:"'])\/\/.*$/, '')).join('\n');
  const files = [
    ...readdirSync(__j(__REPO, 'public/js')).filter((n) => n.endsWith('.js') && n !== 'waivers.js').map((n) => `public/js/${n}`),
    ...readdirSync(__j(__REPO, 'public')).filter((n) => n.endsWith('.html')).map((n) => `public/${n}`),
  ];
  const dashed = files.filter((p) => DASH.test(strip(f(p))));
  // NEGATIVE CONTROL (run 2026-10-15): "Booking request: not on your calendar" set back to an em dash in admin-case.js made this read
  //   FAIL  V3 no em or en dash on any page or in any script a person reads, the frozen waivers aside, and the Worker's Full-Service refusal is plain
  check('V3 no em or en dash on any page or in any script a person reads, the frozen waivers aside, and the Worker\'s Full-Service refusal is plain',
    files.length > 60 && dashed.length === 0
    && f('worker/index.js').includes("+ 'Book an Advocacy Case, then add it from your case page.',"),
    dashed.join(', '));
}

// ---------------------------------------------------------------------------
console.log('\n--- W. Eric\'s side ---');
{
  // NEGATIVE CONTROL (run 2026-10-15): the Response line panel put back on admin-chats.js made this read
  //   FAIL  W1 Chats opens on the threads, and the Ledger sits above Sign out
  check('W1 Chats opens on the threads, and the Ledger sits above Sign out',
    !/Response line/.test(f('public/js/admin-chats.js')) && /<h1>Chats<\/h1>\n    <div id="threads">/.test(f('public/js/admin-chats.js'))
    && /if \(auth\?\.parentNode === tabs\) tabs\.insertBefore\(a, auth\); else tabs\.appendChild\(a\);/.test(f('public/js/admin-ledger.js')));

  // The grouping on the Clients page, lifted and run.
  const group = slab(ADMIN, '  const byCase = new Map();', '  const attBlock');
  const rows = new Function('loops', `${group}; return attention;`)([
    { href: '/a', name: 'Ann', label: 'Report due in 2d', tone: 'warm' },
    { href: '/b', name: 'Bo', label: 'Check-in due', tone: 'hot' },
    { href: '/a', name: 'Ann', label: 'Check-in due', tone: 'hot' },
  ]);
  // NEGATIVE CONTROL (run 2026-10-15): the hottest-tone line taken out of the grouping made this read
  //   FAIL  W2 Needs attention shows each case once, its reasons joined, in its hottest tone, counted by case
  check('W2 Needs attention shows each case once, its reasons joined, in its hottest tone, counted by case',
    rows.length === 2 && rows[0].label === 'Report due in 2d · Check-in due' && rows[0].tone === 'hot' && rows[1].label === 'Check-in due'
    && /NEEDS ATTENTION <span class="cmd-count">\$\{attention\.length\}<\/span>/.test(ADMIN),
    JSON.stringify(rows));

  // NEGATIVE CONTROL (run 2026-10-15): doorsBlock moved back ahead of the shelf made this read
  //   FAIL  W3 the rarely used doors sit under the shelf, just above the rate
  // RE-PINNED 2026-10-15 (v7.39): the rate panel moved into the settings cog, so the doors sit just above the
  // quiet tools (the voice study and the revenue).
  // NEGATIVE CONTROL (run 2026-10-15, v7.39): doorsBlock moved back ahead of the shelf made this read
  //   FAIL  W3 the rarely used doors sit under the shelf, just above the quiet tools
  // RE-PINNED 2026-10-15 (v7.41): Eric, "It will be a + at the top of my 'all cases' screen and then a drop down".
  // The doors left the shelf for the + beside the heading; the fund queue link is all that stays under the shelf,
  // still just above the quiet tools.
  // NEGATIVE CONTROL (run 2026-10-15, v7.41): quietLinks renamed made this read
  //   FAIL  W3 the doors are the + beside the heading; under the shelf only the fund queue link stays, just above the quiet tools
  // RE-PINNED AND RENAMED 2026-10-15 (v7.51): Eric, "Remove the fund queue, one day summary". The fund queue link
  // left the shelf, for him and (as before) for an advocate; the quiet tools follow the last section directly.
  // NEGATIVE CONTROL (run 2026-10-15, v7.51): `quietLinks +` put back between the last section and the quiet tools made this read
  //   FAIL  W3 the doors are the + beside the heading, and nothing sits under the shelf but the quiet tools
  check('W3 the doors are the + beside the heading, and nothing sits under the shelf but the quiet tools',
    // RE-PINNED 2026-10-15 (v7.44): Eric, "Each advocate gets their own isolated workspace." An advocate's shelf has no fund link.
    // NEGATIVE CONTROL (run 2026-10-15, v7.44): quietLinks' `advocate ? '' :` taken out made this read FAIL W3 through the drive
    // (drive-advocates); here the pin is the line itself:
    !/admin-fund|Fund queue/.test(ADMIN)
    && /section\('FORMER CLIENTS: CLOSED'[\s\S]*?\)\)\) \+\s*`<div class="cmd-quiet">` \+ voiceBlock/.test(ADMIN)
    && !/data-open-door="|data-showcase-door>/.test(ADMIN)
    && /<div class="clients-head">\s*<h1>Clients<\/h1>\s*<div class="add-wrap">\s*<button type="button" class="add-btn" data-add-open/.test(f('public/admin.html')));

  // Recording comes after his own types: he asked for his types in his order with the picker opening on
  // Report (drive-summary), so the judge's "first" yields to his words.
  // NEGATIVE CONTROL (run 2026-10-15): Recording moved ahead of his types made this read FAIL W4, and
  // NEGATIVE CONTROL (run 2026-10-15): the doing row put back in the case head made this read
  //   FAIL  W4 the client-reads chips sit on the Chat page under Working on, the notes come before the compile card, and Uploads is one picker, his types in his order and then Recording
  const head = slab(ADMINCASE, 'head.innerHTML = `', '`;');
  const chatPane = slab(ADMINCASE, '<div class="chat-head">', '<div id="chat"></div>');
  const files = slab(ADMINCASE, 'function paintFiles(pane) {', '\nasync function api(');
  check('W4 the client-reads chips sit on the Chat page under Working on, the notes come before the compile card, and Uploads is one picker, his types in his order and then Recording',
    !/data-doing-row/.test(head) && chatPane.indexOf('data-status-pick') > 0 && chatPane.indexOf('data-doing-row') > chatPane.indexOf('data-status-pick')
    && /pane\.appendChild\(notesHost\);\s*pane\.appendChild\(compileCard\);/.test(ADMINCASE)
    && (ADMINCASE.match(/pane\.appendChild\(compileCard\)/g) || []).length === 1
    && !/up-recording/.test(files) && /<select id="up-cat"[^>]*>\s*\$\{UPLOAD_CATEGORIES\.map\([^\n]*\n\s*<option value="\$\{REC_PICK\}">Recording<\/option>\s*<\/select>/.test(files)
    && /if \(cat\.value === REC_PICK\) \{ upload\(e\.target\.files\[0\], 'recording', 'recording-uploaded'\); return; \}/.test(files)
    && /fileEl\.accept = rec \? REC_ACCEPT : DOC_ACCEPT;/.test(files));

  // The Leads columns, lifted: the screen leads with who and how to reach them; the CSV keeps its order.
  const LEADS = f('public/js/admin-leads.js');
  const cols = new Function(`${(LEADS.match(/export const COLUMNS = \[[\s\S]*?\];/) || [''])[0].replace('export ', '')}; return COLUMNS;`)();
  const screen = new Function(`${(LEADS.match(/export const SCREEN_ORDER = \[[^\]]*\];/) || [''])[0].replace('export ', '')}; return SCREEN_ORDER;`)();
  // NEGATIVE CONTROL (run 2026-10-15): SCREEN_ORDER put back date-first made this read
  //   FAIL  W5 on a phone the Leads table leads with the person and how to reach them, every column still there, and the CSV keeps its own order
  check('W5 on a phone the Leads table leads with the person and how to reach them, every column still there, and the CSV keeps its own order',
    screen.join() === 'name,interestedIn,phone,email,cameThrough,firstContact,lastContact,notes'
    && [...screen].sort().join() === cols.map(([k]) => k).sort().join()
    && cols[0][0] === 'firstContact' && /const lines = \[COLUMNS\.map/.test(LEADS)
    && /<thead><tr>\$\{SCREEN_ORDER\.map/.test(LEADS) && /\$\{SCREEN_ORDER\.map\(\(k\) => CELL\[k\]\(l\)\)/.test(LEADS),
    JSON.stringify(screen));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const r of failed) console.log(`  FAILED: ${r.name}`);
  process.exit(1);
}
