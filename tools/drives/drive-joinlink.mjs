// drive-joinlink.mjs - the meeting link, driven end to end.
//
//   PA_PORT=8901 node tools/drives/drive-joinlink.mjs
//
// Eric, 2026-08-26: "I put meeting link in but it didn't visually confirm that
// it saved. So idk if my client is seeing it."
//
// Both halves of that sentence are checked here, because the first half alone
// is what shipped the bug. A route can accept a save and write nothing, and
// then a page that trusts the 200 will happily tell him his client can see a
// link that does not exist. `/api/admin/case-update` did exactly that in the
// demo: it fell through to ok({ok:true}). So this asserts the confirmation
// line, AND that the case really holds the link, AND that the CLIENT page
// renders a Join button pointing at it.
//
// Negative control, run 2026-08-26: with the shim handler returning
// ok({ok:true}) and writing nothing, this goes 1 ok / 3 FAIL.
import { chromium } from 'playwright';
const P = `http://127.0.0.1:${process.env.PA_PORT || 8901}`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ', n, d ? `(${d})` : ''); } else { fail++; console.log('  FAIL ', n, d ? `(${d})` : ''); } };

await page.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const LINK = 'https://meet.example.com/eric-jordan-0830';
const typed = await page.evaluate(async (link) => {
  const inp = document.getElementById('joinlink');
  if (!inp) return 'no joinlink field';
  inp.value = link;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('save-link')?.click();
  return 'clicked';
}, LINK);
ok('the meeting link field and Save button exist', typed === 'clicked', typed);
await page.waitForTimeout(2500);

// Anchored on the confirmation line ITSELF. A loose querySelectorAll walk
// matched the demo banner's "Nothing saved, charged or sent" and passed while
// proving nothing, which is the exact failure mode this whole check exists to
// catch.
const said = await page.evaluate(() => {
  const n = document.getElementById('joinlink-said');
  if (n) return n.textContent.trim().slice(0, 160);
  const inp = document.getElementById('joinlink');
  const near = inp?.closest('div, section, form');
  const hit = near && [...near.querySelectorAll('p,span,div')]
    .find((e) => !e.children.length && /saved|cleared|does not show|not saved/i.test(e.textContent || ''));
  return hit ? hit.textContent.trim().slice(0, 160) : '(nothing said beside the field)';
});
ok('it visually confirms the save', /Saved/i.test(said) && !/does not show/i.test(said), said);

// The half that matters: is it really on the case, or did the route just say yes?
const stored = await page.evaluate(() => {
  try {
    for (const k of Object.keys(localStorage)) {
      if (!/demo/i.test(k)) continue;
      const v = localStorage.getItem(k) || '';
      const m = v.match(/"joinLink":"([^"]*)"/);
      if (m) return m[1];
    }
  } catch { /* storage blocked */ }
  return '(not in the demo store)';
});
ok('and the case really holds it', stored.includes('meet.example.com'), stored);

// Now the client side, which is the question he actually asked.
await page.goto(`${P}/case.html?id=demo-case&demo=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const client = await page.evaluate(() => {
  const a = [...document.querySelectorAll('a,button')].find((e) => /join the video call|join the call/i.test(e.textContent || ''));
  return a ? (a.getAttribute('href') || 'button, no href') : '(no join control)';
});
ok('the CLIENT page shows a Join the video call button', /meet\.example\.com/.test(client), client);

await b.close();
console.log(`\n${pass} ok, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
