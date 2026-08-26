// The status reaction menu, opened the way Eric opens it: a MOUSE on a PC.
import { chromium } from 'playwright';
// PA_PORT overrides the default, so a drive can be pointed at a server
// serving THIS tree. A shared 8795 that another session has repointed at a
// frozen checkout is how a drive reports on code that is not the code.
const PORT = process.env.PA_PORT || 8795;
const P = `http://127.0.0.1:${PORT}`;
let pass=0, fail=0; const errs=[];
const ok=(n,c,d='')=>{ if(c){pass++;console.log('  ok   ',n,d?`— ${d}`:'');} else {fail++;console.log('  FAIL ',n,d?`— ${d}`:'');} };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport:{ width:1440, height:900 } });
await ctx.addCookies([{ name:'pa_demo', value:'1', domain:'127.0.0.1', path:'/' }]);
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(e.message));
await page.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil:'networkidle' });
await page.waitForTimeout(3500);
await page.evaluate(() => document.querySelector('.folder-tabs .ftab[data-page="chat"]')?.click());
await page.waitForTimeout(2500);

// A message FROM the client: status reactions are only offered on theirs.
// Scroll it in first - the log opens pinned to the newest message, so the
// earlier ones sit a thousand pixels above the viewport and a press aimed at
// their coordinates lands on nothing. (That cost me a false failure.)
await page.evaluate(() => {
  const m = [...document.querySelectorAll('.msg')].find(x => !x.classList.contains('mine'));
  m?.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(600);
const target = await page.evaluate(() => {
  const m = [...document.querySelectorAll('.msg')].find(x => !x.classList.contains('mine'));
  if (!m) return null; const r = m.getBoundingClientRect();
  if (r.y < 0 || r.y + r.height > window.innerHeight) return { offscreen: Math.round(r.y) };
  return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), text: m.textContent.slice(0,40) };
});
ok('found a client message, on screen', !!target && !target.offscreen, target?.text || `offscreen at y=${target?.offscreen}`);

console.log('\n--- hold the mouse, the way a hand actually holds it ---');
await page.mouse.move(target.x, target.y);
await page.mouse.down();
// A real hand wobbles. Under the old code ANY of these cancelled the press.
for (const [dx,dy] of [[1,0],[2,1],[1,2],[0,1]]) { await page.mouse.move(target.x+dx, target.y+dy); await page.waitForTimeout(60); }
await page.waitForTimeout(700);
await page.mouse.up();
await page.waitForTimeout(500);

const menu = await page.evaluate(() => {
  const o = document.querySelector('.msg-menu-overlay');
  if (!o) return null;
  return { labels: [...o.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(Boolean) };
});
ok('a held mouse press with a few px of wobble OPENS the menu', !!menu,
  menu ? `${menu.labels.length} buttons` : 'no menu appeared');
if (menu) {
  const joined = menu.labels.join(' | ');
  ok('his reaction is in it, verbatim', /Eric is prepping documents/.test(joined),
    menu.labels.filter(l=>/documents/i.test(l)).join(' / ') || 'no documents entry');
  ok('and the other five he added are there too',
    ['local resources','background checks','coordinating','writing to insurance','personal notes']
      .every(w => new RegExp(w,'i').test(joined)),
    joined.slice(0,200));
  console.log('  menu items:', menu.labels.filter(l=>/Eric (is|has)/.test(l)).join(' / '));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

console.log('\n--- a real drag must still NOT open it ---');
await page.mouse.move(target.x, target.y);
await page.mouse.down();
for (let i=1;i<=6;i++) { await page.mouse.move(target.x+i*12, target.y); await page.waitForTimeout(50); }
await page.waitForTimeout(700);
await page.mouse.up();
await page.waitForTimeout(500);
ok('dragging across the message does not open it',
  await page.evaluate(() => !document.querySelector('.msg-menu-overlay')));

console.log(`\n${pass} ok, ${fail} FAIL`);
if (errs.length) console.log('page errors:\n  ' + errs.join('\n  '));
await b.close();
process.exit(fail||errs.length ? 1 : 0);
