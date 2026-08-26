// Tap-to-turn is gone. Eric, 2026-08-25, on a PC: "when I click on center
// screen of advisor chat it puts me back to the dx…"
//
// Driven by the CURRENT TAB (aria-selected), because `data-page` is carried by
// both the tab strip and the panels - 14 of each - which made a first pass
// read a tab and call it the open page.
import { chromium } from 'playwright';
// PA_PORT overrides the default, so a drive can be pointed at a server
// serving THIS tree. A shared 8795 that another session has repointed at a
// frozen checkout is how a drive reports on code that is not the code.
const PORT = process.env.PA_PORT || 8795;
const P = `http://127.0.0.1:${PORT}`, CASE='demo-case';
let pass=0, fail=0; const errs=[];
const ok=(n,c,d='')=>{ if(c){pass++;console.log('  ok   ',n,d?`— ${d}`:'');} else {fail++;console.log('  FAIL ',n,d?`— ${d}`:'');} };

const cur = (pg) => pg.evaluate(() =>
  document.querySelector('.folder-tabs .ftab[aria-selected="true"]')?.dataset.page || 'unknown');
const open = (pg, id) => pg.evaluate((w) => {
  const t = document.querySelector(`.folder-tabs .ftab[data-page="${w}"]`);
  if (!t) return false; t.click(); return true; }, id);
const panelBox = (pg, f) => pg.evaluate((frac) => {
  const el = [...document.querySelectorAll('[id^="fld1-pg-"]')]
    .find(e => e.offsetParent !== null && e.getBoundingClientRect().width > 40);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width*frac), y: Math.round(r.y + r.height*0.5), w: Math.round(r.width) };
}, f);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport:{ width:1440, height:900 } });     // PC, where he hit it
await ctx.addCookies([{ name:'pa_demo', value:'1', domain:'127.0.0.1', path:'/' }]);
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(e.message));
await page.goto(`${P}/admin-case.html?id=${CASE}&demo=admin`, { waitUntil:'networkidle' });
await page.waitForTimeout(3500);

const ids = await page.evaluate(() => [...document.querySelectorAll('.folder-tabs .ftab')].map(t=>t.dataset.page));
console.log('  tabs:', ids.join(' '));
ok('the advisor chat page exists', ids.includes('advisor-chat'));
ok('dx sits immediately before it, which is exactly where he landed',
  ids.indexOf('dx') === ids.indexOf('advisor-chat') - 1,
  `dx@${ids.indexOf('dx')} advisor-chat@${ids.indexOf('advisor-chat')}`);

ok('its tab opens it', await open(page,'advisor-chat') && (await page.waitForTimeout(1100), await cur(page)) === 'advisor-chat', await cur(page));
const before = await cur(page);

console.log('\n--- THE BUG: clicking the advisor chat page ---');
const bx = await panelBox(page, 0.5);
ok('found the open panel', !!bx, bx?`${bx.w}px wide`:'none');
for (const [name, f] of [['dead centre',0.5],['left third',0.25],['right third',0.75],['far left margin',0.04],['far right margin',0.96]]) {
  const pt = await panelBox(page, f);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(650);
  const after = await cur(page);
  ok(`clicking the ${name} does NOT turn the page`, after===before, `${before} -> ${after}`);
  if (after!==before) { await open(page,'advisor-chat'); await page.waitForTimeout(800); }
}

console.log('\n--- what must still work ---');
await open(page,'advisor-chat'); await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector('.folder-tabs .ftab[aria-selected="true"]')?.focus());
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(800);
const k = await cur(page);
ok('arrow keys still turn the page', k!==before, `${before} -> ${k}`);
ok('the tab strip still navigates', await open(page,'dx') && (await page.waitForTimeout(800), await cur(page))==='dx', await cur(page));

console.log('\n--- and on a phone ---');
const ctx2 = await b.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true });
await ctx2.addCookies([{ name:'pa_demo', value:'1', domain:'127.0.0.1', path:'/' }]);
const p2 = await ctx2.newPage();
p2.on('pageerror', e => errs.push('phone: '+e.message));
await p2.goto(`${P}/admin-case.html?id=${CASE}&demo=admin`, { waitUntil:'networkidle' });
await p2.waitForTimeout(3500);
await open(p2,'advisor-chat'); await p2.waitForTimeout(1100);
const b4 = await cur(p2);
const pt2 = await panelBox(p2, 0.5);
await p2.touchscreen.tap(pt2.x, pt2.y);
await p2.waitForTimeout(700);
ok('a tap does not turn the page on a phone either', (await cur(p2))===b4, `${b4} -> ${await cur(p2)}`);

console.log(`\n${pass} ok, ${fail} FAIL`);
if (errs.length) console.log('page errors:\n  ' + errs.join('\n  '));
await b.close();
process.exit(fail||errs.length ? 1 : 0);
