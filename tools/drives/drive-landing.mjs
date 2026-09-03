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
  await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /^(Got it|Not now|Skip|Close)$/i.test((e.textContent || '').trim())); if (x) x.click(); });
  return { ctx, page, errs };
}

console.log('\n--- A. the slots and the doors, 390px ---');
{
  const { ctx, page, errs } = await open(390);
  const shape = await page.evaluate(() => ({
    h2s: [...document.querySelectorAll('main h2')].map((h) => h.textContent.trim()),
    h1: document.querySelector('main h1')?.textContent.trim(),
    acts: [...document.querySelectorAll('.land-sec.hero a.act')].map((a) => [a.className, a.getAttribute('href')]),
    closing: [...document.querySelectorAll('#closing .actions a')].map((a) => a.getAttribute('href')),
    serif: getComputedStyle(document.querySelector('main h1')).fontFamily,
    scheme: document.documentElement.dataset.scheme || 'neon',
    steps: document.querySelectorAll('.steps li').length,
    needs: document.querySelectorAll('.needs-list li').length,
  }));
  ok('his headline, in the serif, on Paper by default', shape.h1 === 'Go into your next appointment with a plan.' && /Fraunces/.test(shape.serif) && shape.scheme === 'paper', `${shape.scheme} / ${shape.serif}`);
  ok('the eight headings after the hero, in order',
    shape.h2s.join('|') === "You might need an advocate if|How it works|Who you're hiring|What clients say|By the numbers|What it costs|Straight answers|Ready when you are.", shape.h2s.join('|'));
  ok('the free call first at full weight, the case second', shape.acts.length === 2 && /act-c/.test(shape.acts[0][0]) && shape.acts[0][1] === '/fit.html' && /act-m/.test(shape.acts[1][0]) && shape.acts[1][1] === '/book.html');
  ok('five reasons, five steps', shape.needs === 5 && shape.steps === 5);
  ok('the closing: the free call, the case, the number', shape.closing.join() === '/fit.html,/book.html,tel:+12086708608');
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/01-hero.png` });
    for (const [name, sel] of [['02-needs', '.needs'], ['03-how', '.how'], ['04-who', '.who'], ['05-proof', '.proof'], ['06-numbers', '#numbers'], ['07-cost', '.cost'], ['08-close', '#closing']]) {
      await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'start', behavior: 'instant' }), sel);
      await page.evaluate(() => window.scrollBy(0, -70));
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOTS}/${name}.png` });
    }
  }
  console.log('\n--- B. the proof ---');
  const proof = await page.evaluate(() => ({
    avg: document.getElementById('g-avg').textContent,
    count: Number(document.getElementById('g-count').textContent),
    count2: Number(document.getElementById('g-count-2').textContent),
    cards: document.querySelectorAll('#reviews-track .review').length,
    themes: document.querySelectorAll('#themes-list li').length,
    write: document.getElementById('g-write').getAttribute('href'),
    stats: !document.querySelector('#numbers').hidden,
    figs: [...document.querySelectorAll('#numbers [data-stat]')].map((e) => e.textContent),
  }));
  ok('the header says 5.0 and counts the list; the cards are that list twice (the loop), minus the wordless one',
    proof.avg === '5.0' && proof.count >= 5 && proof.count === proof.count2 && proof.cards === 2 * (proof.count - 1), JSON.stringify(proof));
  ok('three theme lines, the write link on Google', proof.themes === 3 && /g\.page/.test(proof.write));
  ok('the stats strip is on with real figures', proof.stats && proof.figs.join('|') === '3 min|84%|4 of 4|61 hrs', proof.figs.join('|'));
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
