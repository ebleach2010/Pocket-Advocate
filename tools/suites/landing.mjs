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

// RE-PINNED 2026-10-04 (v7.23): the landing this pins is parked whole as PR 1 (Eric: "take what's on the landing page and park it as PR 1; hidden from view"), so it reads admin-pr1.html; the public landing is the Community Assistance Fund alone, pinned in fund.mjs.
// RE-PINNED 2026-10-04 (v7.25): PR 1 became the hub, and the old landing moved to admin-pr1-landing.html, so it reads that
// RE-PINNED 2026-10-06 (v7.30): Eric, "Revert back to PR 1. Remove PR 420. Patient advocacy only." The landing is public at index.html again.
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
// RE-PINNED 2026-10-12 (v7.35): Eric, "Remove free call." The first step was the free call, so it went with it; his other four sentences stand, renumbered.
// NEGATIVE CONTROL (run 2026-10-12, v7.35): the free-call step put back as step 1 made this read
//   FAIL  A4 the four steps, his sentences from about.html and services.html, the free call gone
// RE-PINNED 2026-10-15 (v7.38): Eric, "There are just some redundant areas that are abysmally placed and confusing like this one. Send three agents to tighten things up". The home's How it works screen was the closed
// case's booking steps, the third copy of them, on a home that only offers the chat; it went with its menu link.
// The steps are the case's own, and the Advocacy Case page carries them (service-about.js, its approved copy).
// NEGATIVE CONTROL (run 2026-10-15, v7.38): a How it works section put back above the closing made this read
//   FAIL  A4 the home carries no booking steps for the case it is not offering: no How it works screen and no link to one; the case's own page still says what happens after the call
check('A4 the home carries no booking steps for the case it is not offering: no How it works screen and no link to one; the case\'s own page still says what happens after the call',
  !/class="land-sec ruled how"/.test(IDX) && !/href="#how"/.test(IDX)
  // RE-PINNED 2026-10-15 (v7.40): Eric, "Make the advocacy case two weeks to deliver and update that timeframe anywhere else it's noted".
  && f('public/js/service-about.js').includes('After the call you get a written report within 14 days.'));
// The pre-v7.38 form, kept as a record of what the steps said: never evaluated.
false && check('A4 (retired 2026-10-15) the four steps, his sentences from about.html and services.html, the free call gone',
  (() => {
    const s = sectionAt('class="land-sec ruled how"');
    const nums = [...s.matchAll(/<span class="num">(\d)<\/span>/g)].map((m) => m[1]).join();
    return (s.match(/<li>/g) || []).length === 4 && nums === '1,2,3,4'
      && !s.includes('A free 15-minute call.')
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
// RE-PINNED 2026-10-10 (v7.31): Eric, "Reorganize the landing page so all three options are at the top. Have it be a more sleek black style with some color pop", "make the chat the highlight option", "Put 'not currently offering' and gray out the two options outside of chat".
// The price section is the options section now, at the top; his sentences are unchanged.
check('A6 the price section: his line, the reframe, his three card sentences, the 20 included hours',
  (() => {
    const s = sectionAt('class="land-sec options cost"');
    return s.includes('Three ways to work with me, each a flat price you see before you pay.')
      && s.includes('Independent advocates typically bill $100 to $300 an hour against a retainer that runs down. Every price here is written out before you pay, and the work behind each one is spelled out.')
      // RE-PINNED 2026-10-15 (v7.40): Eric, "Make the advocacy case two weeks to deliver and update that timeframe anywhere else it's noted". His sentence, with the new timeframe.
      && s.includes('One flat price for 5-6 hours of research and reporting: our full case overview call, my review of every record you share, and a written report within 14 days.')
      // RE-PINNED 2026-10-17 (v7.63): Eric, "Yes, 'up to 20 hours'": the month's hours are a ceiling, not a target.
      // NEGATIVE CONTROL (run 2026-10-17, v7.63): index.html back to "<span data-hours=\"full\">20</span> included hours." made A6 read FAIL.
      && s.includes('Everything in a case, then I deal with the system myself, a month at a time. Up to <span data-hours="full">20</span> hours.')
      && s.includes('A private chat line to me from your phone for questions, updates, photos, and records. Cancel anytime.');
  })());
// RE-PINNED 2026-10-15 (v7.38): Eric, "There are just some redundant areas that are abysmally placed and confusing like this one. Send three agents to tighten things up". The home's Straight answers screen sat beside
// "Questions" in the same menu, the same questions twice; the questions live on faq.html, where the menu sends them.
// NEGATIVE CONTROL (run 2026-10-15, v7.38): a Straight answers section put back above the closing made this read
//   FAIL  A7 the questions are his, on the Questions page the menu sends them to, and the closing is his
check('A7 the questions are his, on the Questions page the menu sends them to, and the closing is his',
  !READ.includes('<h2>Straight answers</h2>') && /href="\/faq\.html"/.test(IDX)
  && ['Is this medical advice?', 'Can I stop?', 'Is my information private?', 'If yours is not here, ask me before you pay for anything.']
    .every((q) => f('public/faq.html').includes(q))
  && READ.includes("You don't have to navigate this alone.") && READ.includes('<h2>Ready when you are.</h2>'));

// ---------------------------------------------------------------------------
// B. THE SHAPE HE PICKED
// ---------------------------------------------------------------------------
console.log('\n--- B. the shape ---');
{
  // RE-PINNED 2026-10-10 (v7.31): Eric, "Reorganize the landing page so all three options are at the top. Have it be a more sleek black style with some color pop", "make the chat the highlight option", "Put 'not currently offering' and gray out the two options outside of chat".
  // The options come straight after the hero; the rest keeps its order.
  // NEGATIVE CONTROL (run 2026-10-10, v7.31): the options section moved back below the numbers made this read
  //   FAIL  B1 the nine slots, in the order the sweep settled on
  // RE-PINNED 2026-10-15 (v7.38): Eric, "There are just some redundant areas that are abysmally placed and confusing like this one. Send three agents to tighten things up". How it works and Straight answers went; seven slots.
  // NEGATIVE CONTROL (run 2026-10-15, v7.38): the closing's class renamed `ruled closer` made this read
  //   FAIL  B1 the seven slots, in the order the sweep settled on
  // RE-PINNED 2026-10-15 (v7.40): Eric, "put my stats at the bottom of the landing page in brief; it will be a tab with an arrow". The numbers left main for the pull-up sheet; six slots.
  // NEGATIVE CONTROL (run 2026-10-15, v7.40): the closing's class renamed `ruled closer` made this read
  //   FAIL  B1 the six slots, in the order the sweep settled on
  const order = ['land-sec hero', 'land-sec options cost', 'ruled needs', 'ruled who', 'ruled proof', 'ruled closing'];
  const idx = order.map((k) => main.indexOf(k));
  // NEGATIVE CONTROL (run 2026-09-02): moving the price section above the
  // proof made this read
  //   FAIL  B1 the nine slots, in the order the sweep settled on
  check('B1 the six slots, in the order the sweep settled on',
    idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1])), idx.join());
}
{
  const hero = sectionAt('land-sec hero');
  const opts = sectionAt('land-sec options cost');
  // RE-PINNED 2026-10-15 (v7.37): Eric, "it should go to a page dedicated to what the chat is. Same with the other two options. They should never commingle information." The closed cards are each an <a> to their own page now.
  const cards = [...opts.matchAll(/<(?:div|a) class="opt ([^"]*)"([^>]*)>([\s\S]*?)(?=<(?:div|a) class="opt |<\/div>\s*<p class="hero-fine")/g)].map((m) => [m[1], m[3], m[2]]);
  const doors = [...opts.matchAll(/<a class="act ([^"]*)" href="([^"]+)">/g)].map((m) => [m[1], m[2]]);
  // RE-PINNED 2026-10-10 (v7.31): Eric, "Reorganize the landing page so all three options are at the top. Have it be a more sleek black style with some color pop", "make the chat the highlight option", "Put 'not currently offering' and gray out the two options outside of chat".
  // The chat line is first and lit, its button to the subscribe page; the two he is not offering carry his
  // words and no link; the free call is a card-weight door under them.
  // NEGATIVE CONTROL (run 2026-10-10, v7.31): a `<a href="/book.html">Book a case</a>` added to the Advocacy Case card made this read
  //   FAIL  B2 the chat line is the first option, lit, with Start chatting; the case and the full service say Not currently offering and take no tap; the free call is a door at card weight under them
  // RE-PINNED 2026-10-11 (v7.32): Eric, "Mark chat out of service as well. Banner at the top that's highlighted".
  // All three options say Not currently offering and take no tap; his notice comes first on the page, word
  // for word; the free call is still a door at card weight under the cards.
  // NEGATIVE CONTROL (run 2026-10-11, v7.32): a `<a href="/subscribe.html">Start chatting</a>` added to the chat card made this read
  //   FAIL  B2 his notice comes first, word for word; all three options say Not currently offering and take no tap; the free call is a door at card weight under them
  // RE-PINNED 2026-10-12 (v7.35): Eric, "Remove free call." No door under the cards at all now.
  // NEGATIVE CONTROL (run 2026-10-12, v7.35): the free-call door put back under the cards made this read
  //   FAIL  B2 his notice comes first, word for word; all three options say Not currently offering and take no tap; nothing under them is a door
  // RE-PINNED 2026-10-14 (v7.36): Eric, "Unlock priority chat and remove banner."
  // His notice is gone; the chat line is first and open, ringed, with Start chatting; the case and the full
  // service still say Not currently offering and take no tap; nothing under them is a door.
  // NEGATIVE CONTROL (run 2026-10-14, v7.36): the notice put back above the hero made this read
  //   FAIL  B2 his notice is gone; the chat line is first, open and ringed with Start chatting; the case and the full service say Not currently offering and take no tap; nothing under them is a door
  // RE-PINNED 2026-10-15 (v7.37): Eric, "it should go to a page dedicated to what the chat is. Same with the other two options. They should never commingle information."
  // NEGATIVE CONTROL (run 2026-10-15, v7.37): the Advocacy Case card's door pointed at /full-service.html made this read
  //   FAIL  B2 his notice is gone; the chat line is first, open and ringed with Start chatting; the case and the full service say Not currently offering, each card a door to its own page alone; nothing under them is a door
  check('B2 his notice is gone; the chat line is first, open and ringed with Start chatting; the case and the full service say Not currently offering, each card a door to its own page alone; nothing under them is a door',
    !/class="out-banner"/.test(IDX) && !READ.includes('I am currently out of remission')
    && cards.length === 3 && /opt-live opt-gold/.test(cards[0][0]) && /24\/7 Priority Chat/.test(cards[0][1])
    && /<a class="btn glow cta opt-go" href="\/subscribe\.html">Start chatting<\/a>/.test(cards[0][1]) && !/opt-badge/.test(cards[0][1])
    && cards.slice(1).every(([c, h]) => /opt-off/.test(c) && /<span class="opt-badge">Not currently offering<\/span>/.test(h) && !/<a |<button/.test(h))
    && cards[1][2].trim() === 'href="/advocacy-case.html"' && cards[2][2].trim() === 'href="/full-service.html"'
    && /Advocacy Case/.test(cards[1][1]) && /Full-Service Case Management/.test(cards[2][1])
    && doors.length === 0 && !/class="act /.test(hero),
    JSON.stringify({ cards: cards.map(([c]) => c), doors }));
  check('B3 the tile is small at the top left of a paper card, and the halo is gone',
    /<img class="hero-logo"[^>]*width="56"/.test(hero) && !/hero-halo/.test(IDX)
    && /body\.landing \.land-sec\.hero \{[^}]*box-shadow: none;/.test(GLOW));
}
// NEGATIVE CONTROL (run 2026-10-12, v7.35): the closing's free-call button put back made this read
//   FAIL  B4 the closing carries the number to press, and nothing else
check('B4 the closing carries the number to press, and nothing else',
  (() => {
    const s = sectionAt('ruled closing');
    const hrefs = [...s.matchAll(/<a class="btn [^"]*" href="([^"]+)">/g)].map((m) => m[1]);
    // RE-PINNED 2026-10-10 (v7.31): Eric, "Reorganize the landing page so all three options are at the top. Have it be a more sleek black style with some color pop", "make the chat the highlight option", "Put 'not currently offering' and gray out the two options outside of chat". The closing leads with the chat line.
    // RE-PINNED 2026-10-11 (v7.32): Eric, "Mark chat out of service as well. Banner at the top that's highlighted". Nothing he is not offering is offered in the closing.
    // RE-PINNED 2026-10-12 (v7.35): Eric, "Remove free call." The number is all that is left.
    return hrefs.join() === 'tel:+12086708608';
  })());
// RE-PINNED 2026-10-10 (v7.31): Eric, "Reorganize the landing page so all three options are at the top. Have it be a more sleek black style with some color pop", "make the chat the highlight option", "Put 'not currently offering' and gray out the two options outside of chat".
// RE-PINNED 2026-10-11 (v7.32): Eric, "Mark chat out of service as well. Banner at the top that's highlighted". The dock carried the chat line alone, so it went with it.
// RE-PINNED 2026-10-12 (v7.35): Eric, "Remove free call." The footer lists every door but that one.
// NEGATIVE CONTROL (run 2026-10-12, v7.35): `<a href="/fit.html">Book a free call</a>` put back in the footer made this read
//   FAIL  B5 no dock offers anything, and the footer lists every door but the free call
// RE-PINNED 2026-10-15 (v7.38): Eric, "There are just some redundant areas that are abysmally placed and confusing like this one. Send three agents to tighten things up". The menu's "Reviews" sat beside "What clients say", one door twice; the reviews page is reached from that screen's "Read them all".
// NEGATIVE CONTROL (run 2026-10-15, v7.38): the Read them all link pointed at /reviews made this read
//   FAIL  B5 no dock offers anything, and every door but the free call is still reachable from the home
check('B5 no dock offers anything, and every door but the free call is still reachable from the home',
  !/id="sticky-book"/.test(IDX) && !IDX.includes('href="/fit.html"')
  && ['/book.html', '/advocate.html', '/stats.html', '/contact.html'].every((h) => IDX.includes(`<a href="${h}">`))
  && /<a class="pill" id="g-read" href="\/reviews\.html">Read them all<\/a>/.test(IDX));
// RE-PINNED 2026-10-10 (v7.31): Eric, "Reorganize the landing page so all three options are at the top. Have it be a more sleek black style with some color pop", "make the chat the highlight option", "Put 'not currently offering' and gray out the two options outside of chat".
// RE-PINNED 2026-10-11 (v7.32): Eric, "Mark chat out of service as well. Banner at the top that's highlighted".
// RE-PINNED 2026-10-14 (v7.36): Eric, "Unlock priority chat and remove banner." Only the chat card links: to the chat line and to what it includes.
// NEGATIVE CONTROL (run 2026-10-14, v7.36): an opt-acts row with `<a class="opt-more" href="/services.html#case">What is included</a>` added to the Advocacy Case card made this read
//   FAIL  B6 only the chat card links, to the chat line and its services anchor, and the services anchors still exist
// RE-PINNED 2026-10-15 (v7.37): Eric, "it should go to a page dedicated to what the chat is. Same with the other two options. They should never commingle information." Every card's information is its own page.
// NEGATIVE CONTROL (run 2026-10-15, v7.37): the chat card's "What is included" put back on /services.html#chat made this read
//   FAIL  B6 the chat card links to the chat line and its own page, each closed card to its own page, and the services anchors still exist
check('B6 the chat card links to the chat line and its own page, each closed card to its own page, and the services anchors still exist',
  (() => {
    const s = sectionAt('class="land-sec options cost"');
    const svc = f('public/services.html');
    const links = [...s.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
    return (s.match(/<div class="opt-acts">/g) || []).length === 1
      && links.join() === '/subscribe.html,/priority-chat.html,/advocacy-case.html,/full-service.html'
      && ['id="case"', 'id="full"', 'id="chat"'].every((id) => svc.includes(id));
  })());
// RE-PINNED 2026-10-10 (v7.31): Eric, "Reorganize the landing page so all three options are at the top. Have it be a more sleek black style with some color pop", "make the chat the highlight option", "Put 'not currently offering' and gray out the two options outside of chat". The sheet is the chat line's.
// The landing offers no way to buy the case it says it is not offering, apart from the shared Book tab
// that every page carries (reviewer's fix, 2026-10-10: the footer's "Book a case" went).
// NEGATIVE CONTROL (run 2026-10-10): the footer's `<a href="/book.html">Book a case</a>` put back made this read
//   FAIL  B10 the only door to booking on the landing is the shared Book tab
// RE-PINNED 2026-10-11 (v7.33): Eric, "change the font to something semibold. You tend to use the same font for everything."
// Sora for the headings at 600 and Manrope for the reading at 500, both self-hosted, both on the landing alone.
// NEGATIVE CONTROL (run 2026-10-11, v7.33): the Sora @font-face taken out of landing.css made this read
//   FAIL  B11 the landing reads in a semibold pair: Sora headings at 600, Manrope text at 500, both self-hosted
{
  const L = f('public/css/landing.css');
  check('B11 the landing reads in a semibold pair: Sora headings at 600, Manrope text at 500, both self-hosted',
    /font-family: 'Sora';[\s\S]{0,120}url\('\/fonts\/sora-latin\.woff2'\)/.test(L) && /font-family: 'Manrope';[\s\S]{0,120}url\('\/fonts\/manrope-latin\.woff2'\)/.test(L)
    && existsSync(__j(__REPO, 'public/fonts/sora-latin.woff2')) && existsSync(__j(__REPO, 'public/fonts/manrope-latin.woff2'))
    && /body\.landing \{\s*font-family: 'Manrope'[^}]*font-weight: 500;/.test(L) && /body\.landing h1,[\s\S]{0,160}font-family: 'Sora'[^}]*font-weight: 600;/.test(L)
    && !/fonts\.googleapis|fonts\.gstatic/.test(L + IDX));
}
// RE-PINNED 2026-10-14 (v7.36): Eric, "add a hamburger menu symbol at the top right where tabs for every other section appears".
// The page's own screens lead the menu; the Book tab heads its "More" half.
check('B10 the only door to booking on the landing is the shared Book tab',
  (IDX.match(/href="\/book\.html"/g) || []).length === 1 && /<span class="tabs-label">More<\/span>\s*<a href="\/book\.html">Book<\/a>/.test(IDX));
// RE-PINNED 2026-10-11 (v7.32): Eric, "Mark chat out of service as well. Banner at the top that's highlighted". With nothing offered, no About sheet is offered either; the wiring stays for when one returns.
check('B7 no About sheet is offered while nothing is, and the wiring is still there',
  !/data-about=/.test(main) && /wireAboutButtons\(\)/.test(IDX));
check('B8 "This is a web app" moved to the footer, with its explainer',
  IDX.indexOf('id="webapp-note"') > IDX.indexOf('<footer class="site-foot">') && /helpButton\('app'/.test(IDX));
// RE-PINNED 2026-10-10 (v7.31): Eric, "Reorganize the landing page so all three options are at the top. Have it be a more sleek black style with some color pop", "make the chat the highlight option", "Put 'not currently offering' and gray out the two options outside of chat".
// The page is black on every device (Night base, turned black by landing.css, which only index.html loads);
// High contrast, chosen for somebody's eyes, still wins.
// NEGATIVE CONTROL (run 2026-10-10, v7.31): the landing's `<link rel="stylesheet" href="/css/landing.css?v=b1">` taken out made this read
//   FAIL  B9 the page is black on every device and says so to theme.js; a stored High contrast still wins
check('B9 the page is black on every device and says so to theme.js; a stored High contrast still wins',
  /<html lang="en" data-default-scheme="calm">/.test(IDX)
  && /localStorage\.getItem\('pa-scheme'\) === 'contrast' \? 'contrast' : 'calm';/.test(IDX)
  && /<link rel="stylesheet" href="\/css\/landing\.css\?v=b9">/.test(IDX) // RE-PINNED 2026-10-15 (v7.42): the tab came off and the Preview bubble went on: b9. // RE-PINNED 2026-10-15 (v7.40): the pull-up tab moved the sheet to b8. // RE-PINNED 2026-10-15 (v7.38): the chat page's what-to-expect note moved the sheet to b7. // RE-PINNED 2026-10-15 (v7.37): the package pages' rules moved the sheet to b6. // RE-PINNED 2026-10-14 (v7.36): the ring, the one-screen home, the menu's screens and the question box moved the sheet to b5. // RE-PINNED 2026-10-12 (v7.34): Eric, "Create a small 'join the waitlist' that's in a shining text bubble at the top right of the screen." The bubble's rules moved the sheet to b4. // RE-PINNED 2026-10-11 (v7.33): Eric, "change the font to something semibold. You tend to use the same font for everything." The new type moved the sheet to b3. // RE-PINNED 2026-10-11 (v7.32): Eric, "Mark chat out of service as well. Banner at the top that's highlighted". The banner's rules moved the sheet to b2.
  // RE-PINNED 2026-10-15 (v7.37): Eric, "it should go to a page dedicated to what the chat is. Same with the other two options. They should never commingle information." The three package pages wear the landing's look too ("Keep the shiny blue/purple aesthetic throughout"); no other page does.
  && readdirSync(__j(__REPO, 'public')).filter((n) => n.endsWith('.html') && !['index.html', 'priority-chat.html', 'advocacy-case.html', 'full-service.html'].includes(n)).every((n) => !/landing\.css/.test(f(`public/${n}`)))
  && ['priority-chat', 'advocacy-case', 'full-service'].every((n) => /<link rel="stylesheet" href="\/css\/landing\.css\?v=b9">/.test(f(`public/${n}.html`)))
  && /:root:not\(\[data-scheme="contrast"\]\) body\.landing \{[\s\S]*?--bg: #0A0A0C;/.test(f('public/css/landing.css'))
  // RE-PINNED 2026-10-15 (v7.38): Eric, "everywhere should have this same aesthetic". theme.js no longer reads a page's
  // default: every page's default is the black look, and High contrast is the one other choice.
  // NEGATIVE CONTROL (run 2026-10-15, v7.38): defaultScheme() made to read the page's data-default-scheme again made this read
  //   FAIL  B9 the page is black on every device and says so to theme.js; a stored High contrast still wins
  && /export function defaultScheme\(\) \{\s*return 'calm';\s*\}/.test(code('public/js/theme.js')));

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
    // RE-PINNED 2026-10-15 (v7.38): the look audit added eight stroke icons for the tab rails and the case page: 20.
    // NEGATIVE CONTROL (run 2026-10-15, v7.38): the i-bolt symbol renamed x-bolt in icons.svg made this read
    //   FAIL  D4 the icons live in one cached file and every <use> on the landing resolves to a symbol in it
    ids.length === 20 && uses.length > 0 && uses.every((u) => ids.includes(u))
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
    // RE-PINNED 2026-10-04 (v7.23): the page it closes is the parked landing, PR 1.
    .filter((n) => /<h2>Ready when you are\.<\/h2>/.test(f(`public/${n}`))).join() === 'index.html' // RE-PINNED 2026-10-06 (v7.30): Eric, "Revert back to PR 1. Remove PR 420. Patient advocacy only." The landing is public at index.html again. // RE-PINNED 2026-10-04 (v7.25): PR 1 became the hub, and the old landing moved to admin-pr1-landing.html, so it reads that
  && !/<footer class="legal">/.test(f('public/about.html'))
  && (f('public/about.html').match(/<h2>The legal basics<\/h2>/g) || []).length === 1
  && (f('public/about.html').match(/If you are having a medical emergency, call 911\./g) || []).length === 1);
check('D8 services.html\'s footer meets the advocate, and the TL;DR sheet lost its dash',
    /<a href="\/advocate\.html">Meet your advocate<\/a>/.test(f('public/services.html'))
    // RE-PINNED 2026-10-15 (v7.39): Eric, "let me adjust price for each effective immediately". The TL;DR's price is
    // a live spot now, so the line runs through priced(); the colon that replaced the dash is unchanged.
    // NEGATIVE CONTROL (run 2026-10-15, v7.39): the colon after TL;DR put back to a dash made this read
    //   FAIL  D8 services.html's footer meets the advocate, and the TL;DR sheet lost its dash
    && /<strong>TL;DR:<\/strong> \$\{priced\(esc\(a\.tldr\)\)\}/.test(f('public/js/service-about.js')));
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
// RE-PINNED 2026-10-04 (v7.23): parked as PR 1, the old landing keeps its maintenance notice and loses
// the redirect, since it would send the one person who can open it away; the redirect, with its demo
// guard, stays on the public landing, which is the fund's now.
// RE-PINNED 2026-10-04 (v7.25): his device opens on the Fund queue now (Eric: everything but the fund is
// parked in PR 1), so the public landing's redirect goes to admin-fund.html.
// RE-PINNED 2026-10-06 (v7.30): Eric, "Revert back to PR 1. Remove PR 420. Patient advocacy only." The
// landing is public at index.html again, with its maintenance notice and the redirect that sends his
// device to the Clients page, guarded against the demo.
// NEGATIVE CONTROL (run 2026-10-06, v7.30): the redirect's target put back to `%2Fadmin-fund.html` made this read
//   FAIL  E3 the landing still wears the maintenance notice and the demo never redirects an admin device
check('E3 the landing still wears the maintenance notice and the demo never redirects an admin device',
  // RE-PINNED 2026-10-16 (v7.56): a contractor's device ('advocate') is sent to its workspace too.
  // NEGATIVE CONTROL (run 2026-10-16, v7.56): the redirect's `(dev === '1' || dev === 'advocate')` made `(dev === '1')` made E3 read FAIL.
  /src="\/js\/maintenance\.js"/.test(IDX) && /var dev = localStorage\.getItem\('pa-admin-device'\);\n\s+if \(\(dev === '1' \|\| dev === 'advocate'\) &&/.test(IDX)
  && /sessionStorage\.getItem\('pa-demo'\)\)\) return;/.test(IDX) && /location\.replace\('\/signin\.html\?to=%2Fadmin\.html'\);/.test(IDX));

// v7.58 (Eric, 2026-10-16: "I'm not sure it's even possible to hit the landing page"). His phone was
// sent from the home page to sign in every time, the logo included, so the home page could not be
// reached. Coming from a page of this site, it stays the home page; opened fresh, it still goes on.
// NEGATIVE CONTROL (run 2026-10-16, v7.58): the guard's `return` made `{ }` made this read
//   FAIL  E4 the home page sends his phone on only when it was opened fresh, never from a page of the site
{
  const guard = IDX.indexOf('if (from === location.origin) return;');
  const go = IDX.indexOf("location.replace('/signin.html?to=%2Fadmin.html');");
  check('E4 the home page sends his phone on only when it was opened fresh, never from a page of the site',
    guard > 0 && go > guard && /from = document\.referrer \? new URL\(document\.referrer\)\.origin : ''/.test(IDX));
}
// v7.58: the sign-in page, put back by Safari's Back exactly as it was left on "Signing you in…",
// starts again instead of sitting there with nothing running.
// NEGATIVE CONTROL (run 2026-10-16, v7.58): the pageshow listener's `location.reload()` taken out made this read
//   FAIL  E5 the sign-in page restored mid sign-in by Back starts again
check('E5 the sign-in page restored mid sign-in by Back starts again',
  /addEventListener\('pageshow', function \(e\) \{\s+var r = document\.getElementById\('resuming'\);\s+if \(e\.persisted && r && !r\.hidden\) location\.reload\(\);/.test(f('public/signin.html')));

const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exit(1);
