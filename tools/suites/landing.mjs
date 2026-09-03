// landing.mjs - the landing page in Look A, "Clinic Note", on the copy deck
// Eric approved word for word.
//
// Eric, 2026-09-02: "I like A best, but the landing page copy is horrendous."
// Then, on the deck built from his own sentences: "Use it as is." So two
// things are pinned here that a drive cannot: that HIS WORDS are on the
// page unchanged, and that the page's shape is the one he picked. The rest
// is the audit's list of things that had to go, kept gone.
//
// Run: node landing.mjs
//
// ===========================================================================
// NEGATIVE CONTROLS - what was broken on purpose, and what went red
//
//   the break                                        what went red
//   ---------------------------------------------------------------------
//   one word of his sentence changed                 A1
//   the price section moved above the proof          B1
//   the first door retargeted at /book.html          B2
//   the light default put back to neon               B9
//   a fourth theme line added                        C1
//   the header count typed as a literal              C3
//   `.act.pulse { animation: none; }` put back       D1
//   the i-chev symbol deleted from the sprite        D4
//   the serif pointed at a file that is not there    D5
//   "Ready when you are." on contact.html as well    D7
//   an em dash typed into the hero-fine line         A2, E1
//
// Each break was restored byte for byte and the file read 32/32 again
// after every one (2026-09-02).
// ===========================================================================
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
const f = (p) => readFileSync(__j(__REPO, p), 'utf8');
const strip = (s) => s
  .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');
const code = (p) => strip(f(p));

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}

const IDX = f('public/index.html');
const GLOW = f('public/css/glowup.css');
const SITE = f('public/css/site.css');
// The page without its scripts and HTML comments: what a person reads.
const READ = IDX.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const main = IDX.slice(IDX.indexOf('<main>'), IDX.indexOf('</main>'));
const sectionAt = (cls) => {
  const i = main.indexOf(cls);
  return i < 0 ? '' : main.slice(i, main.indexOf('</section>', i));
};

// ---------------------------------------------------------------------------
// A. HIS WORDS, WORD FOR WORD
// ---------------------------------------------------------------------------
console.log('\n--- A. his words ---');
// NEGATIVE CONTROL (run 2026-09-02): "exactly how badly" to "just how badly"
// made this read
//   FAIL  A1 two of his sentences are on the page unchanged
check('A1 two of his sentences are on the page unchanged',
  READ.includes('<h1>Go into your next appointment with a plan.</h1>')
  && READ.includes('I became an advocate because, for three years, I learned exactly how badly I needed one.'));
check('A2 the hero is his two paragraphs, the eyebrow, and the two lines under the doors',
  READ.includes('I review your labs, imaging, records, and history, then help you sort out what deserves attention, what questions to ask next, and how to present the case clearly to your care team.')
  && READ.includes("I'm a professional patient advocate with 5 years' worth of boots on the ground experience, and an autoimmune encephalitis survivor. I know what it is like to have a complicated case that does not fit neatly into a box.")
  && READ.includes('Patient advocacy for complicated neurological conditions. US and Canada.')
  && READ.includes('No hidden fees and no surprise bills. Insurance does not cover this and I do not bill it.'));
check('A3 the five "you might need an advocate if" lines, in order',
  (() => {
    const s = sectionAt('needs');
    const lines = [...s.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1]);
    return lines.length === 5
      && lines[0] === 'You sit in front of a physician with ten important questions and leave having asked two.'
      && lines[1] === 'One abnormal result has disappeared into hundreds of pages of records.'
      && lines[2] === 'One specialist has never seen what another specialist documented six months ago.'
      && lines[3] === 'You are explaining the same history again while sick, scared, cognitively overloaded, or simply too tired to keep managing the logistics of your own care.'
      && lines[4] === 'Your symptoms are being called anxiety.';
  })());
check('A4 the five steps, his sentences from about.html and services.html',
  (() => {
    const s = sectionAt('class="land-sec ruled how"');
    return (s.match(/<li>/g) || []).length === 5
      && s.includes('You tell me what is going on and I tell you honestly whether I can help.')
      && s.includes('Choose a time for a phone or video call and give me the basics about your case. Booking takes about two minutes.')
      && s.includes('Upload the records you want me to review, including labs, imaging, visit notes, or anything else that helps me understand the case.')
      && s.includes('We go through your history together, including what has been tried, what has helped, what has not, and where you are stuck.')
      && s.includes('Within 7 days, I send you a written case report that organizes the history, the open questions, and the next steps worth discussing with your care team.');
  })());
check('A5 "Who you\'re hiring" is his about.html paragraph, his story line, and the story link',
  (() => {
    const s = sectionAt('class="land-sec ruled who"');
    return s.includes('I work with patients facing complicated neurological conditions across the US and Canada. I came to advocacy after living through autoimmune encephalitis myself and learning how hard it is to make a complicated medical story understandable to the people treating you. My role is to stay on your side of the table and help you make the strongest use of the care you already have.')
      && s.includes('My story: why I became an advocate') && s.includes('href="/advocate.html"') && s.includes('/img/advocate-eric.jpg');
  })());
check('A6 the price section: his line, the reframe, his three card sentences, the 20 included hours',
  (() => {
    const s = sectionAt('class="land-sec ruled cost"');
    return s.includes('Three ways to work with me, each a flat price you see before you pay.')
      && s.includes('Independent advocates typically bill $100 to $300 an hour against a retainer that runs down. Every price here is written out before you pay, and the work behind each one is spelled out.')
      && s.includes('One flat price for 5-6 hours of research and reporting: our full case overview call, my review of every record you share, and a written report within 7 days.')
      && s.includes('Everything in a case, then I deal with the system myself, a month at a time. <span data-hours="full">20</span> included hours.')
      && s.includes('A private chat line to me from your phone for questions, updates, photos, and records. Cancel anytime.');
  })());
check('A7 the questions and the closing are his',
  READ.includes('<h2>Straight answers</h2>') && READ.includes('Is this medical advice?') && READ.includes('Can I stop?')
  && READ.includes('Is my information private?') && READ.includes('If yours is not here, ask me before you pay for anything.')
  && READ.includes("You don't have to navigate this alone.") && READ.includes('<h2>Ready when you are.</h2>'));

// ---------------------------------------------------------------------------
// B. THE SHAPE HE PICKED
// ---------------------------------------------------------------------------
console.log('\n--- B. the shape ---');
{
  const order = ['land-sec hero', 'ruled needs', 'ruled how', 'ruled who', 'ruled proof', 'id="numbers"', 'ruled cost', 'ruled faq', 'ruled closing'];
  const idx = order.map((k) => main.indexOf(k));
  // NEGATIVE CONTROL (run 2026-09-02): moving the price section above the
  // proof made this read
  //   FAIL  B1 the nine slots, in the order the sweep settled on
  check('B1 the nine slots, in the order the sweep settled on',
    idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1])), idx.join());
}
{
  const hero = sectionAt('land-sec hero');
  const acts = [...hero.matchAll(/<a class="act ([^"]*)" href="([^"]+)">/g)].map((m) => [m[1], m[2]]);
  // NEGATIVE CONTROL (run 2026-09-02): retargeting the first door at
  // /book.html made this read
  //   FAIL  B2 the free call is the first door at full weight; the case the second at card weight, with its live price
  check('B2 the free call is the first door at full weight; the case the second at card weight, with its live price',
    acts.length === 2 && /\bact-c\b/.test(acts[0][0]) && acts[0][1] === '/fit.html'
    && /\bact-m\b/.test(acts[1][0]) && acts[1][1] === '/book.html' && /data-rate="case"/.test(hero));
  check('B3 the tile is small at the top left of a paper card, and the halo is gone',
    /<img class="hero-logo"[^>]*width="56"/.test(hero) && !/hero-halo/.test(IDX)
    && /body\.landing \.land-sec\.hero \{[^}]*box-shadow: none;/.test(GLOW));
}
check('B4 the closing carries the free call, the case, and the number to press',
  (() => {
    const s = sectionAt('ruled closing');
    const hrefs = [...s.matchAll(/<a class="btn [^"]*" href="([^"]+)">/g)].map((m) => m[1]);
    return hrefs.join() === '/fit.html,/book.html,tel:+12086708608';
  })());
check('B5 the dock leads with the free call and the footer lists every door',
  /id="sticky-book"[\s\S]{0,120}href="\/fit\.html"/.test(IDX)
  && ['/fit.html', '/book.html', '/advocate.html', '/stats.html', '/reviews.html', '/contact.html'].every((h) => IDX.includes(`<a href="${h}">`)));
check('B6 the three price cards go to three different places on the services page, and the anchors exist',
  (() => {
    const s = sectionAt('class="land-sec ruled cost"');
    const hrefs = [...s.matchAll(/<a class="svc-card[^"]*" href="([^"]+)">/g)].map((m) => m[1]);
    const svc = f('public/services.html');
    return hrefs.join() === '/services.html#case,/services.html#full,/services.html#chat'
      && ['id="case"', 'id="full"', 'id="chat"'].every((id) => svc.includes(id));
  })());
check('B7 the About sheet still opens from the page',
  /data-about="case"/.test(main) && /wireAboutButtons\(\)/.test(IDX));
check('B8 "This is a web app" moved to the footer, with its explainer',
  IDX.indexOf('id="webapp-note"') > IDX.indexOf('<footer class="site-foot">') && /helpButton\('app'/.test(IDX));
check('B9 the page reads as Paper by default on a light device and says so to theme.js; a stored scheme still wins',
  /<html lang="en" data-default-scheme="paper">/.test(IDX)
  && /matches\) \? 'calm' : 'paper';/.test(IDX) && /localStorage\.getItem\('pa-scheme'\)/.test(IDX)
  && /dataset\.defaultScheme/.test(code('public/js/theme.js')));

// ---------------------------------------------------------------------------
// C. THE PROOF: one list, the header, the themes, the arrows
// ---------------------------------------------------------------------------
console.log('\n--- C. the proof ---');
{
  const cfg = code('public/js/reviews-config.js');
  const themes = [...cfg.matchAll(/\{ line: '([^']+)', from: '([^']+)' \}/g)].map((m) => [m[1], m[2]]);
  const names = [...cfg.matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
  // NEGATIVE CONTROL (run 2026-09-02): a fourth theme line added made this read
  //   FAIL  C1 exactly three theme lines, each short, each from a reviewer on the list
  check('C1 exactly three theme lines, each short, each from a reviewer on the list',
    themes.length === 3 && themes.every(([line, from]) => line.length <= 70 && names.includes(from))
    && themes[0][0] === 'Someone who understands, and who knows how to help'
    && themes[1][0] === 'Kind, respectful, and easy to talk to'
    && themes[2][0] === 'Real help for autoimmune encephalitis patients who feel lost');
  check('C2 the card is "What clients keep saying" and nothing on the page calls it generated',
    READ.includes('What clients keep saying') && !/generated|AI/.test(READ));
  // NEGATIVE CONTROL (run 2026-09-02): the header count typed as a literal
  // instead of reviewSummary made this read
  //   FAIL  C3 the header's average and count come off the same list as the cards
  check('C3 the header\'s average and count come off the same list as the cards',
    /const \{ avg, count \} = reviewSummary\(list\);/.test(IDX)
    && /getElementById\('g-avg'\)\.textContent = avg/.test(IDX)
    && /getElementById\('g-count'\)\.textContent = String\(count\)/.test(IDX)
    && /export function reviewSummary/.test(cfg));
  check('C4 the write link and the read link are the two Google links, and the arrows drive the strip',
    /id="g-write"/.test(IDX) && /GOOGLE_REVIEW_WRITE_URL\) document\.getElementById\('g-write'\)\.href/.test(IDX)
    && /read\.href = GOOGLE_REVIEWS_URL/.test(IDX)
    && (IDX.match(/data-nudge="(-1|1)"/g) || []).length === 2
    && /strip\.__paNudge = \(dir\) =>/.test(code('public/js/reviews-strip.js'))
    && /__paNudge\?\.\(Number\(b\.dataset\.nudge\)\)/.test(IDX));
  check('C5 reviews.html carries the same header and themes off the same helpers',
    (() => {
      const r = f('public/reviews.html');
      return /id="g-avg"/.test(r) && /id="themes-list"/.test(r) && /reviewSummary\(list\)/.test(r) && /REVIEW_THEMES\.map/.test(r);
    })());
}

// ---------------------------------------------------------------------------
// D. THE AUDIT'S LIST, KEPT GONE
// ---------------------------------------------------------------------------
console.log('\n--- D. the audit fixes ---');
{
  const glow = strip(GLOW);
  const site = strip(SITE);
  // NEGATIVE CONTROL (run 2026-09-02): `.act.pulse { animation: none; }` put
  // back into glowup.css made this read
  //   FAIL  D1 .pulse, .hero-art, glow-pulse, --gap-section and --r-hero are gone from both sheets
  check('D1 .pulse, .hero-art, glow-pulse, --gap-section and --r-hero are gone from both sheets',
    !/\.pulse\b/.test(glow + site) && !/\.hero-art\b/.test(glow + site) && !/glow-pulse/.test(glow + site)
    && !/--gap-section|--r-hero/.test(glow) && !/class="[^"]*\bpulse\b/.test(IDX) && !/hero-art/.test(IDX));
  check('D2 one side padding, undone exactly by the deep band and used by the footer',
    /--pad-x: 1\.1rem;/.test(glow) && /padding: var\(--s-4\) var\(--pad-x\) var\(--s-6\);/.test(glow)
    && /margin-inline: calc\(var\(--pad-x\) \* -1\);/.test(glow) && /:root \{ --pad-x: var\(--s-3\); \}/.test(glow)
    && !/margin-inline: -1\.1rem/.test(glow));
  check('D3 one desktop width for the nav, the page and the footer',
    /main,\s*\.bar-inner,\s*\.site-foot \.foot-inner \{ max-width: var\(--max-content\)/.test(glow)
    && /<div class="foot-inner">/.test(IDX));
  const sprite = f('public/img/icons.svg');
  const ids = [...sprite.matchAll(/<symbol id="(i-[a-z]+)"/g)].map((m) => m[1]);
  const uses = [...IDX.matchAll(/<use href="\/img\/icons\.svg#(i-[a-z]+)"/g)].map((m) => m[1]);
  // NEGATIVE CONTROL (run 2026-09-02): the i-chev symbol deleted from the
  // sprite made this read
  //   FAIL  D4 the icons live in one cached file and every <use> on the landing resolves to a symbol in it
  check('D4 the icons live in one cached file and every <use> on the landing resolves to a symbol in it',
    ids.length === 12 && uses.length > 0 && uses.every((u) => ids.includes(u))
    && !/<defs>/.test(IDX) && !/<defs>/.test(f('public/services.html'))
    && /\/img\/\*\n  Cache-Control: public, max-age=86400/.test(f('public/_headers')));
  check('D5 the serif and the sans are self-hosted, swapped in, and used only on the landing',
    existsSync(__j(__REPO, 'public/fonts/fraunces-latin.woff2')) && existsSync(__j(__REPO, 'public/fonts/source-sans-3-latin.woff2'))
    && /font-family: 'Fraunces';[\s\S]{0,120}font-display: swap;[\s\S]{0,80}url\('\/fonts\/fraunces-latin\.woff2'\)/.test(glow)
    && /body\.landing \{\s*font-family: 'Source Sans 3'/.test(glow)
    && !/fonts\.googleapis\.com/.test(IDX));
  check('D6 the stylesheet versions moved on every page, so nobody sees the old sheet on the new markup',
    readdirSync(__j(__REPO, 'public')).filter((n) => n.endsWith('.html'))
      .every((n) => { const t = f(`public/${n}`); return !/site\.css\?v=sp13|glowup\.css\?v=sp[56]\b/.test(t); }));
  check('D7 "Ready when you are." closes exactly one page, and about.html says the legal part once in main and once in the site footer',
  readdirSync(__j(__REPO, 'public')).filter((n) => n.endsWith('.html'))
    .filter((n) => /<h2>Ready when you are\.<\/h2>/.test(f(`public/${n}`))).join() === 'index.html'
  && !/<footer class="legal">/.test(f('public/about.html'))
  && (f('public/about.html').match(/<h2>The legal basics<\/h2>/g) || []).length === 1
  && (f('public/about.html').match(/If you are having a medical emergency, call 911\./g) || []).length === 1);
check('D8 services.html\'s footer meets the advocate, and the TL;DR sheet lost its dash',
    /<a href="\/advocate\.html">Meet your advocate<\/a>/.test(f('public/services.html'))
    && /<strong>TL;DR:<\/strong> \$\{esc\(a\.tldr\)\}/.test(f('public/js/service-about.js')));
}

// ---------------------------------------------------------------------------
// E. WHAT MUST NOT BE ON THE PAGE
// ---------------------------------------------------------------------------
console.log('\n--- E. the words that must not be here ---');
const HARD = [/advisor/i, /differential/i, /\bAI\b/, /\bLLM\b/i, /language model/i, /\bClaude\b/i, /Anthropic/i, /\bthe model\b/i, /\ba model\b/i, /chatbot/i];
// NEGATIVE CONTROL (run 2026-09-02): an em dash typed into the hero-fine
// line made this read
//   FAIL  E1 not one em or en dash in the served page, comments included
check('E1 not one em or en dash in the served page, comments included', !/[–—]/.test(IDX));
check('E2 not one term from the blindness list, in the page or the new stylesheet section',
  HARD.every((re) => !re.test(IDX)) && HARD.every((re) => !re.test(GLOW.slice(GLOW.indexOf('18. LANDING')))));
check('E3 the landing still wears the maintenance notice and the demo never redirects an admin device',
  /src="\/js\/maintenance\.js"/.test(IDX) && /sessionStorage\.getItem\('pa-demo'\)\)\) return;/.test(IDX));

const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exit(1);
