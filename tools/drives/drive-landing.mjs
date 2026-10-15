// The landing page in Look A, driven at 390px and 320px in the demo:
//  A. the nine slots paint in order and the two doors are where they belong.
//  B. the proof: the header count equals the cards' list, the themes are three,
//     the arrows move the strip, the stats strip is on with real figures.
//  C. every colour scheme keeps the page legible (ink on ground contrast).
//  D. nothing on the page overflows sideways at 320px.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const PORT = process.env.PA_PORT || 9380;
const P = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.PA_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ok    ${n}${d ? ' — ' + d : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };

async function open(width, scheme) {
  const ctx = await b.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await page.goto(`${P}/?demo=1`, { waitUntil: 'networkidle' });
  if (scheme) {
    await page.evaluate((s) => localStorage.setItem('pa-scheme', s), scheme);
    await page.reload({ waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(1800);
  // RE-PINNED 2026-10-12 (v7.34): the waitlist sheet carries a hidden Close button, which this used to find first
  // and click to no effect, leaving the intro over the page. Only a button on screen counts now.
  await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => e.checkVisibility() && /^(Got it|Not now|Skip|Close)$/i.test((e.textContent || '').trim())); if (x) x.click(); });
  return { ctx, page, errs };
}

console.log('\n--- A. the slots and the doors, 390px ---');
{
  const { ctx, page, errs } = await open(390);
  const shape = await page.evaluate(() => ({
    h2s: [...document.querySelectorAll('main h2')].filter((h) => !h.closest('dialog')).map((h) => h.textContent.trim()),
    h1: document.querySelector('main h1')?.textContent.trim(),
    acts: [...document.querySelectorAll('#options a.act')].map((a) => [a.className, a.getAttribute('href')]),
    live: [...document.querySelectorAll('#options .opt-live a')].map((a) => a.getAttribute('href')),
    off: [...document.querySelectorAll('#options .opt-off')].map((c) => [c.querySelector('.opt-badge')?.textContent, c.querySelectorAll('a, button').length]),
    bg: getComputedStyle(document.body).backgroundColor,
    // RE-PINNED 2026-10-12 (v7.34): Eric, "a small 'join the waitlist' that's in a shining text bubble at the top
    // right of the screen". The bubble's row and its closed sheet come first; his notice is the first thing after them.
    // RE-PINNED 2026-10-14 (v7.36): Eric, "Unlock priority chat and remove banner." / "Reorient everything so everything on the main page fits without scrolling."
    // No notice; the bubble rides the hero's first row, above the headline.
    banner: !document.querySelector('.out-banner') && !/out of remission/.test(document.body.textContent),
    // RE-PINNED 2026-10-15 (v7.42): the row holds two bubbles now; this one is the waitlist's.
    bubble: (() => { const r = document.querySelector('[data-waitlist-open]').getBoundingClientRect(); const h = document.querySelector('main h1').getBoundingClientRect(); return { right: Math.round(innerWidth - r.right), gap: Math.round(h.top - r.bottom), h: Math.round(r.height), inTop: !!document.querySelector('.hero-top .wl-bubble') }; })(),
    closing: [...document.querySelectorAll('#closing .actions a')].map((a) => a.getAttribute('href')),
    serif: getComputedStyle(document.querySelector('main h1')).fontFamily,
    scheme: document.documentElement.dataset.scheme || 'neon',
    steps: document.querySelectorAll('.steps li').length,
    needs: document.querySelectorAll('.needs-list li').length,
  }));
// RE-PINNED 2026-10-10 (v7.31): Eric, "Reorganize the landing page so all three options are at the top. Have it be a more sleek black style with some color pop", "make the chat the highlight option", "Put 'not currently offering' and gray out the two options outside of chat".
  // RE-PINNED 2026-10-11 (v7.33): Eric, "change the font to something semibold. You tend to use the same font for everything."
  ok('his headline, in Sora, on black', shape.h1 === 'Go into your next appointment with a plan.' && /^Sora/.test(shape.serif) && shape.scheme === 'calm' && shape.bg === 'rgb(10, 10, 12)', `${shape.scheme} / ${shape.bg} / ${shape.serif}`);
  // RE-PINNED 2026-10-15 (v7.38): Eric, "There are just some redundant areas that are abysmally placed and confusing like this one. Send three agents to tighten things up". How it works and Straight answers went.
  // RE-PINNED 2026-10-15 (v7.40): Eric, "put my stats at the bottom of the landing page in brief; it will be a tab with an arrow". The numbers left the screens for the pull-up sheet, outside main.
  ok('the five headings after the hero, in order, the options first',
    shape.h2s.join('|') === "What it costs|You might need an advocate if|Who you're hiring|What clients say|Ready when you are.", shape.h2s.join('|'));
// RE-PINNED 2026-10-11 (v7.32): Eric, "Mark chat out of service as well. Banner at the top that's highlighted".
  // RE-PINNED 2026-10-12 (v7.35): Eric, "Remove free call." Nothing under the cards is a door.
  // RE-PINNED 2026-10-14 (v7.36): Eric, "Unlock priority chat and remove banner." / "Reorient everything so everything on the main page fits without scrolling."
  // RE-PINNED 2026-10-15 (v7.37): the two greyed cards are each a door to their own page; nothing inside them is a separate tap.
  ok('no notice; the chat line open with Start chatting, the other two greyed with his words and nothing to tap inside, nothing under them',
    // RE-PINNED 2026-10-15 (v7.37): "What is included" opens the chat's own page.
    shape.banner && shape.live.join() === '/subscribe.html,/priority-chat.html' && shape.off.length === 2
    && shape.off.every(([t, n]) => t === 'Not currently offering' && n === 0)
    && shape.acts.length === 0, JSON.stringify({ live: shape.live, off: shape.off, acts: shape.acts }));
  // NEGATIVE CONTROL (run 2026-10-12): `justify-content: flex-end` on .wl-row turned to flex-start made this read
  //   FAIL  the waitlist bubble sits at the top right, above his notice, a full tap high
  // RE-PINNED 2026-10-14 (v7.36): Eric, "Unlock priority chat and remove banner." / "Reorient everything so everything on the main page fits without scrolling." The bubble's row is the hero's first.
  ok('the waitlist bubble sits at the top right, above the headline, a full tap high',
    shape.bubble.inTop && shape.bubble.right <= 24 && shape.bubble.gap >= 0 && shape.bubble.gap < 60 && shape.bubble.h >= 44, JSON.stringify(shape.bubble));
  // RE-PINNED 2026-10-12 (v7.35): Eric, "Remove free call." The step that promised it and its closing button went with it.
  // RE-PINNED 2026-10-15 (v7.38): Eric, "There are just some redundant areas that are abysmally placed and confusing like this one. Send three agents to tighten things up". The steps were the closed case's booking steps.
  ok('five reasons, and no booking steps for the case it is not offering', shape.needs === 5 && shape.steps === 0);
  ok('the closing: the number alone', shape.closing.join() === 'tel:+12086708608');
  // The greyed cards are meant to read as unavailable, but the words on them and everything on the chat
  // card stay legible: his badge and the chat line clear 4.5:1 on their own card.
  const legible = await page.evaluate(() => {
    const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number); const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
    const ground = 'rgb(19, 19, 23)';
    return [ratio(getComputedStyle(document.querySelector('.opt-live .svc-line')).color, ground), ratio(getComputedStyle(document.querySelector('.opt-off .opt-badge')).color, 'rgb(15, 15, 18)')];
  });
  // RE-PINNED 2026-10-11 (v7.32): Eric, "Mark chat out of service as well. Banner at the top that's highlighted".
  // RE-PINNED 2026-10-14 (v7.36): Eric, "Unlock priority chat and remove banner." / "Reorient everything so everything on the main page fits without scrolling." The notice is gone; the chat card's line takes its place in the measure.
  ok('the chat line\'s words and the "Not currently offering" badges clear 4.5:1', legible.every((r) => r >= 4.5), legible.map((r) => r.toFixed(1)).join(' / '));
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/01-hero.png` });
    // RE-PINNED 2026-10-14 (v7.36): Eric, "Unlock priority chat and remove banner." / "Reorient everything so everything on the main page fits without scrolling." Each other section is a screen of its own, opened by its anchor.
    for (const [name, id] of [['03-needs', 'needs'], ['04-how', 'how'], ['05-who', 'who'], ['06-proof', 'proof'], ['08-close', 'closing'], ['09-more', 'more']]) {
      await page.evaluate((h) => { location.hash = h; }, id);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/${name}.png` });
    }
    await page.evaluate(() => { location.hash = ''; });
  }
  console.log('\n--- B. the proof ---');
  const proof = await page.evaluate(() => ({
    avg: document.getElementById('g-avg').textContent,
    count: Number(document.getElementById('g-count').textContent),
    count2: Number(document.getElementById('g-count-2').textContent),
    cards: document.querySelectorAll('#reviews-track .review').length,
    themes: document.querySelectorAll('#themes-list li').length,
    write: document.getElementById('g-write').getAttribute('href'),
    // RE-PINNED 2026-10-15 (v7.40): the strip is the pull-up tab and its sheet now.
    // RE-PINNED 2026-10-15 (v7.42): Eric, "remove the stats tab on the landing page".
    stats: !document.querySelector('[data-stats-tab], [data-stats-sheet]'),
    figs: [...document.querySelectorAll('#stats-sheet .tile [data-stat]')].map((e) => e.textContent),
  }));
  ok('the header says 5.0 and counts the list; the cards are that list twice (the loop), minus the wordless one',
    proof.avg === '5.0' && proof.count >= 5 && proof.count === proof.count2 && proof.cards === 2 * (proof.count - 1), JSON.stringify(proof));
  ok('three theme lines, the write link on Google', proof.themes === 3 && /g\.page/.test(proof.write));
  ok('the numbers tab is gone from the home, and nothing on it still paints figures', proof.stats && proof.figs.length === 0, proof.figs.join('|'));
  // RE-PINNED 2026-10-14 (v7.36): Eric, "Unlock priority chat and remove banner." / "Reorient everything so everything on the main page fits without scrolling." The strip lives on its own screen now; open it first.
  await page.evaluate(() => { location.hash = 'proof'; });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => document.querySelector('#reviews-track').style.transform);
  await page.click('[data-nudge="1"]');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => document.querySelector('#reviews-track').style.transform);
  ok('the arrow moves the strip', before !== after, `${before} -> ${after}`);
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

console.log('\n--- C. every scheme stays legible ---');
for (const scheme of ['neon', 'calm', 'paper', 'contrast']) {
  const { ctx, page } = await open(390, scheme);
  const r = await page.evaluate(() => {
    const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number); const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
    const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
    const el = document.querySelector('.needs-list li');
    const bg = getComputedStyle(document.body).backgroundColor;
    const ink = getComputedStyle(el).color;
    const h1 = getComputedStyle(document.querySelector('main h1')).color;
    return { scheme: document.documentElement.dataset.scheme || 'neon', body: contrast(ink, bg), h1: contrast(h1, bg) };
  });
  ok(`${scheme}: body text and headline clear the ground (4.5:1)`, r.body >= 4.5 && r.h1 >= 4.5, `${r.body.toFixed(1)} / ${r.h1.toFixed(1)}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/scheme-${scheme}.png` });
  await ctx.close();
}

console.log('\n--- E. the home fits one screen ---');
{
  // Eric, 2026-10-14: "Reorient everything so everything on the main page fits without scrolling." Phones in
  // Safari with their bars showing, a big phone, a tablet and a laptop: nothing scrolls, either way.
  // NEGATIVE CONTROL (run 2026-10-14): the `(max-height: 900px)` rule that hides the hero's sentence taken out made this read
  //   FAIL  the home fits on one screen at every size, with nothing below it to scroll to
  const sizes = [[390, 664], [375, 635], [360, 640], [414, 715], [430, 740], [390, 844], [768, 1024], [1024, 700], [1440, 900]];
  const over = [];
  for (const [w, h] of sizes) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto(`${P}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(() => [document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth]);
    if (m[0] > 0 || m[1] > 0) over.push(`${w}x${h}: ${m[0]}px down, ${m[1]}px across`);
    await ctx.close();
  }
  ok('the home fits on one screen at every size, with nothing below it to scroll to', over.length === 0, over.join('; '));
  // The menu reaches every other section, and each opens as its own screen with a way back.
  const ctx = await b.newContext({ viewport: { width: 390, height: 664 } });
  const page = await ctx.newPage();
  await page.goto(`${P}/`, { waitUntil: 'networkidle' });
  await page.click('.nav-toggle');
  const hrefs = await page.$$eval('.tabs.open a[href^="#"]', (as) => as.map((a) => a.getAttribute('href')));
  const screens = [];
  for (const h of hrefs) {
    await page.evaluate((x) => { location.hash = x; }, h);
    await page.waitForTimeout(150);
    screens.push(await page.evaluate((x) => { const s = document.querySelector(x); return getComputedStyle(s).position === 'fixed' && !!s.querySelector('.panel-back'); }, h));
  }
  // NEGATIVE CONTROL (run 2026-10-14): landing-tabs.js's Back link line taken out made this read
  //   FAIL  the menu opens every other section as a screen with a Back link
  // RE-PINNED 2026-10-15 (v7.38): Eric, "There are just some redundant areas that are abysmally placed and confusing like this one. Send three agents to tighten things up". Five sections are left behind the menu.
  ok('the menu opens every other section as a screen with a Back link', hrefs.length === 5 && screens.every(Boolean), `${hrefs.join()} ${screens.join()}`);
  await ctx.close();
}

console.log('\n--- F. each card opens its own page ---');
{
  // Eric, 2026-10-15: "When you tap on 'what's included' with the chat it describes an advocacy case ... it should
  // go to a page dedicated to what the chat is. Same with the other two options." Tapped, not read from markup.
  // NEGATIVE CONTROL (run 2026-10-15): the Advocacy Case card's door pointed at /full-service.html made this read
  //   FAIL  every card's door lands on its own package's page, painted, with its own way in
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  const got = [];
  for (const [sel, pkg, h1] of [['.opt-live .opt-more', 'chat', '24/7 Priority Chat'], ['a.opt-off[href$="advocacy-case.html"]', 'case', 'Advocacy Case'], ['a.opt-off[href$="full-service.html"]', 'full', 'Full-Service Case Management']]) {
    await page.goto(`${P}/`, { waitUntil: 'networkidle' });
    const door = await page.$(`#options ${sel}`);
    if (!door) { got.push(false); continue; }
    await door.click();
    await page.waitForLoadState('networkidle');
    // RE-PINNED 2026-10-15 (v7.38): Eric, "And shorten the description:" then his letter. The chat page is his
    // letter, one section signed, with the guarantee above it, instead of the three painted sections.
    got.push(await page.evaluate(([p, h]) => document.body.dataset.package === p && document.querySelector('h1').textContent === h
      && (p === 'chat'
        ? !!document.querySelector('.pkg-letter .pkg-sign') && !!document.querySelector('.pkg-callout')
        : document.querySelectorAll('.pkg-sec').length >= 3)
      && !!document.querySelector('[data-pkg-status] a.pkg-go'), [pkg, h1]));
  }
  ok('every card\'s door lands on its own package\'s page, painted, with its own way in', got.every(Boolean) && !errs.length, `${got.join()} ${errs.join(' | ')}`);
  await ctx.close();
}

console.log('\n--- D. nothing overflows at 320px ---');
{
  const { ctx, page, errs } = await open(320);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('no sideways scroll at 320px', over <= 0, `${over}px`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/09-320.png`, fullPage: true });
  ok('no page errors at 320px', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

console.log(`\n${pass} ok, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
