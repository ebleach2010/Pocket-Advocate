// The status dropdown beside "Chat with the client". Eric, 2026-08-25: it
// "should sit to the right of 'chat with client' as a dropdown so I can have
// it be the status of what I'm working on."
import { chromium } from 'playwright';
const P='http://127.0.0.1:8795';
let pass=0, fail=0; const errs=[];
const ok=(n,c,d='')=>{ if(c){pass++;console.log('  ok   ',n,d?`— ${d}`:'');} else {fail++;console.log('  FAIL ',n,d?`— ${d}`:'');} };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport:{width:1280,height:900} });
await ctx.addCookies([{name:'pa_demo',value:'1',domain:'127.0.0.1',path:'/'}]);
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(e.message));
await page.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, {waitUntil:'networkidle'});
await page.waitForTimeout(3000);
await page.evaluate(() => document.querySelector('.folder-tabs .ftab[data-page="chat"]')?.click());
await page.waitForTimeout(2500);

const geo = await page.evaluate(() => {
  const h=[...document.querySelectorAll('h3')].find(x=>/Chat with the client/.test(x.textContent));
  const s=document.querySelector('[data-status-pick]');
  if(!h||!s) return { h:!!h, s:!!s };
  const hr=h.getBoundingClientRect(), sr=s.getBoundingClientRect();
  return { h:true, s:true, toTheRight: sr.left > hr.right, sameRow: Math.abs(sr.top-hr.top)<40,
    opts: s.options.length, first: s.options[0].textContent, minH: Math.round(sr.height) };
});
ok('the dropdown exists', geo.s, JSON.stringify(geo));
ok('it sits to the RIGHT of "Chat with the client"', geo.toTheRight);
ok('on the same row as the heading', geo.sameRow);
ok('it lists every status plus a "none"', geo.opts === 13, `${geo.opts} options`);
ok('and opens on "Nothing right now"', /Nothing right now/.test(geo.first||''), geo.first);
ok('it is a reachable size', geo.minH >= 32, `${geo.minH}px tall`);

console.log('\n--- set one ---');
await page.selectOption('[data-status-pick]', 'documents');
await page.waitForTimeout(1800);
const after = await page.evaluate(() => {
  const s=document.querySelector('[data-status-pick]');
  // .msg-react ONLY, and only inside a message. A first pass used
  // [class*="status"], which matched the dropdown itself and reported the
  // control's own option list as proof the client could see it.
  const chips=[...document.querySelectorAll('.msg .msg-react')].map(c=>c.textContent.trim());
  return { value: s.value, chip: chips[chips.length-1] || null, count: chips.length };
});
ok('the dropdown holds the pick', after.value === 'documents', after.value);
ok('and the client sees it on the thread, in your words',
  /Eric is prepping documents/.test(after.chip||''), after.chip || 'no status chip on any message');

console.log('\n--- it survives a reload, because it is a STATE ---');
await page.reload({waitUntil:'networkidle'});
await page.waitForTimeout(3000);
await page.evaluate(() => document.querySelector('.folder-tabs .ftab[data-page="chat"]')?.click());
await page.waitForTimeout(2500);
ok('reopening the case shows the status still set',
  (await page.evaluate(() => document.querySelector('[data-status-pick]')?.value)) === 'documents',
  await page.evaluate(() => document.querySelector('[data-status-pick]')?.value));

console.log('\n--- and it can be cleared ---');
await page.selectOption('[data-status-pick]', '');
await page.waitForTimeout(1800);
const cleared = await page.evaluate(() => ({
  value: document.querySelector('[data-status-pick]').value,
  still: document.querySelectorAll('.msg .msg-react').length,
}));
ok('clearing it empties the dropdown', cleared.value === '', cleared.value);
ok('and takes the status off the thread', cleared.still === 0, `${cleared.still} left`);

console.log(`\n${pass} ok, ${fail} FAIL`);
if (errs.length) console.log('page errors:\n  ' + errs.join('\n  '));
await b.close();
process.exit(fail||errs.length ? 1 : 0);
