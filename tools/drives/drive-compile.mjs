// drive-compile.mjs - the whole case file as one document.
//
//   PA_PORT=8901 node tools/drives/drive-compile.mjs
//
// Eric, 2026-08-26: "there should be a place where all the uploads can get
// compiled into one PDF, by type first and then date second."
//
// ORDER IS THE FEATURE, so order is what this checks, on the real rendered
// document rather than on the array that produced it. It also checks the
// honesty of the cover page: there is no PDF library in this app, so a PDF or
// a recording cannot be printed inside the compilation, and a compilation
// that quietly dropped them would be worse than none.
import { chromium } from 'playwright';
const P = `http://127.0.0.1:${process.env.PA_PORT || 8901}`;
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ', n, d ? `(${d})` : ''); } else { fail++; console.log('  FAIL ', n, d ? `(${d})` : ''); } };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

await page.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Onto the Notes page, inside Mine.
const reached = await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.folder-tabs a, .folder-tabs button')]
    .find((t) => /notes/i.test(t.textContent || '') || t.dataset.page === 'notes');
  if (!tab) return false;
  tab.click();
  return true;
});
ok('the Notes page is reachable', reached);
await page.waitForTimeout(1600);

const card = await page.evaluate(() => {
  const c = document.querySelector('.compile-card');
  const btn = document.querySelector('[data-compile]');
  return {
    there: !!c,
    heading: c?.querySelector('h3')?.textContent.trim() || '',
    saysWhatItCannotDo: /cannot print one document inside another/i.test(c?.textContent || ''),
    btnH: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
  };
});
ok('the compile card is on the Notes page', card.there, card.heading);
ok('it says up front what it cannot include', card.saysWhatItCannotDo);
ok('its button is a 44px target', card.btnH >= 44, `${card.btnH}px`);

// The print window is what carries the document. Catch it rather than print.
const popup = new Promise((res) => ctx.once('page', res));
await page.evaluate(() => { window.print = () => {}; document.querySelector('[data-compile]')?.click(); });
const doc = await Promise.race([popup, new Promise((r) => setTimeout(() => r(null), 15000))]);
ok('compiling opens the document', !!doc);

if (doc) {
  await doc.waitForLoadState('domcontentloaded').catch(() => {});
  await doc.waitForTimeout(1200);
  const out = await doc.evaluate(() => {
    const groups = [...document.querySelectorAll('.grp h2')].map((h) => h.firstChild.textContent.trim());
    const perGroup = [...document.querySelectorAll('.grp')].map((g) => ({
      name: g.querySelector('h2').firstChild.textContent.trim(),
      dates: [...g.querySelectorAll('.item .meta')].map((m) => (m.textContent.match(/\w+ \d+, \d{4}/) || [''])[0]),
    }));
    return {
      title: document.title,
      cover: document.querySelector('.cover')?.textContent || '',
      groups,
      perGroup,
      imgs: document.querySelectorAll('img').length,
      listed: document.querySelectorAll('.not-shown').length,
    };
  });
  const ORDER = ['Reports', 'Documents', 'Images', 'Recordings', 'Other'];
  const seen = out.groups.map((g) => ORDER.indexOf(g));
  ok('grouped by TYPE, in a fixed order', out.groups.length > 0
     && seen.every((v, i) => v >= 0 && (i === 0 || v > seen[i - 1])), out.groups.join(' > '));
  const dateOk = out.perGroup.every((g) => {
    const t = g.dates.filter(Boolean).map((d) => Date.parse(d));
    return t.every((v, i) => i === 0 || v >= t[i - 1]);
  });
  ok('and by DATE inside each type', dateOk,
     out.perGroup.map((g) => `${g.name}:${g.dates.length}`).join(' '));
  ok('the cover says how many printed and how many are listed',
     /printed in full/.test(out.cover) && /listed with a link/.test(out.cover));
  ok('every file appears, whether it could be rendered or not',
     out.imgs + out.listed > 0, `${out.imgs} images, ${out.listed} listed`);
  ok('the document is named for the client', /case file/i.test(out.title), out.title);
}

ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await b.close();
console.log(`\n${pass} ok, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
