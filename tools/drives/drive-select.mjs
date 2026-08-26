// Selecting and copying text. Eric, 2026-08-25: "Selecting and copying text in
// advisor chat and elsewhere for copying and pasting is damned near
// impossible." It was impossible on every device: .react-target is on every
// message and carried user-select:none. Now suppressed for fingers only.
import { chromium } from 'playwright';
// PA_PORT overrides the default, so a drive can be pointed at a server
// serving THIS tree. A shared 8795 that another session has repointed at a
// frozen checkout is how a drive reports on code that is not the code.
const PORT = process.env.PA_PORT || 8795;
const P = `http://127.0.0.1:${PORT}`;
let pass=0, fail=0; const errs=[];
const ok=(n,c,d='')=>{ if(c){pass++;console.log('  ok   ',n,d?`— ${d}`:'');} else {fail++;console.log('  FAIL ',n,d?`— ${d}`:'');} };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// A mouse. Text must be selectable.
const ctx = await b.newContext({ viewport:{width:1440,height:900} });
await ctx.addCookies([{name:'pa_demo',value:'1',domain:'127.0.0.1',path:'/'}]);
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(e.message));
await page.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, {waitUntil:'networkidle'});
await page.waitForTimeout(3000);
await page.evaluate(() => document.querySelector('.folder-tabs .ftab[data-page="chat"]')?.click());
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const m=[...document.querySelectorAll('.msg')].find(x=>!x.classList.contains('mine'));
  m?.scrollIntoView({block:'center'});
});
await page.waitForTimeout(500);

const computed = await page.evaluate(() => {
  const m=[...document.querySelectorAll('.msg')].find(x=>!x.classList.contains('mine'));
  return { cls: m?.className, userSelect: getComputedStyle(m).userSelect || getComputedStyle(m).webkitUserSelect };
});
ok('a chat message is still wired for the menu', /react-target/.test(computed.cls||''), computed.cls);
ok('but on a mouse its text is SELECTABLE', computed.userSelect !== 'none', `user-select: ${computed.userSelect}`);

// Actually select some, the way a person does: press and drag across words.
const sel = await page.evaluate(() => {
  const m=[...document.querySelectorAll('.msg')].find(x=>!x.classList.contains('mine'));
  // Walk to a real text node: the bubble nests its words, so looking only at
  // direct children found nothing and failed this check for the wrong reason.
  const w=document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
  let t=null;
  while (w.nextNode()) { if (w.currentNode.textContent.trim().length>20) { t=w.currentNode; break; } }
  if(!t) return null;
  const r=document.createRange(); r.setStart(t,0); r.setEnd(t,Math.min(20,t.textContent.length));
  const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
  return String(s);
});
ok('a range over a message actually selects characters', !!sel && sel.length>5, JSON.stringify(sel));

// The real gesture: press and DRAG across the words, slowly, then let go.
// (Pressing on an existing selection is not a case worth testing - a
// mousedown collapses the selection before any timer could see it.)
await page.evaluate(() => window.getSelection().removeAllRanges());
const bar = await page.evaluate(() => {
  const m=[...document.querySelectorAll('.msg')].find(x=>!x.classList.contains('mine'));
  const r=m.getBoundingClientRect();
  return { x:Math.round(r.x+14), y:Math.round(r.y+14), far:Math.round(r.x+r.width*0.7) };
});
await page.mouse.move(bar.x, bar.y);
await page.mouse.down();
for (let x=bar.x; x<=bar.far; x+=18) { await page.mouse.move(x, bar.y); await page.waitForTimeout(45); }
await page.waitForTimeout(650);          // dwell, the way a slow hand does
await page.mouse.up();
await page.waitForTimeout(400);
ok('dragging across the words does NOT open the menu',
  await page.evaluate(() => !document.querySelector('.msg-menu-overlay')));
ok('and it leaves real text selected, ready to copy',
  (await page.evaluate(() => String(window.getSelection()))).trim().length > 3,
  JSON.stringify(await page.evaluate(() => String(window.getSelection()).slice(0,40))));

// The Dx rows, the other place he copies from. They live in the drawer and
// only appear once a case has diagnoses, so rather than hunt for a toggle
// that may not be there, put the real class on a real element and let the
// real stylesheet answer. That IS the thing that changed.
const dx = await page.evaluate(() => {
  const d = document.createElement('span');
  d.className = 'folder-dx';
  d.textContent = 'Autoimmune encephalitis, anti-NMDAR';
  document.body.appendChild(d);
  const v = getComputedStyle(d).userSelect || getComputedStyle(d).webkitUserSelect;
  d.remove();
  return v;
});
ok('a diagnosis row is selectable on a mouse', dx !== 'none', `user-select: ${dx}`);

// A finger. Suppression must SURVIVE there, or iOS fights the long-press.
const ctx2 = await b.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true });
await ctx2.addCookies([{name:'pa_demo',value:'1',domain:'127.0.0.1',path:'/'}]);
const p2 = await ctx2.newPage();
await p2.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, {waitUntil:'networkidle'});
await p2.waitForTimeout(3000);
await p2.evaluate(() => document.querySelector('.folder-tabs .ftab[data-page="chat"]')?.click());
await p2.waitForTimeout(2000);
const touch = await p2.evaluate(() => {
  const m=[...document.querySelectorAll('.msg')].find(x=>!x.classList.contains('mine'));
  return m ? (getComputedStyle(m).userSelect || getComputedStyle(m).webkitUserSelect) : null;
});
ok('on a touchscreen a message is still suppressed, so iOS does not fight the press',
  touch === 'none', `user-select: ${touch}`);
const dxTouch = await p2.evaluate(() => {
  const d = document.createElement('span');
  d.className = 'folder-dx';
  document.body.appendChild(d);
  const v = getComputedStyle(d).userSelect || getComputedStyle(d).webkitUserSelect;
  d.remove();
  return v;
});
ok('and so is a diagnosis row', dxTouch === 'none', `user-select: ${dxTouch}`);

console.log(`\n${pass} ok, ${fail} FAIL`);
if (errs.length) console.log('page errors:\n  ' + errs.join('\n  '));
await b.close();
process.exit(fail||errs.length ? 1 : 0);
