// Personal Uploads, driven in the demo at 390px:
//  A. the Clients page: the shelf is there, folded; unfold, upload, search,
//     open link, delete.
//  B. a case's Mine tab: the Personal tab, upload, listed, and the two shelves
//     do not mix.
//  C. the client's own case page never carries the word.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const PORT = process.env.PA_PORT || 9377;
const P = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.PA_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const TMP = '/tmp/pa-personal-drive';
mkdirSync(TMP, { recursive: true });
writeFileSync(`${TMP}/Tax 2025.txt`, 'private figures\n');
writeFileSync(`${TMP}/plan.txt`, 'case plan\n');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 300)));
page.on('dialog', async (d) => { if (d.type() === 'confirm') await d.accept(); else await d.dismiss(); });
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ok    ${n}${d ? ' — ' + d : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const settle = async (ms = 1500) => {
  await page.waitForTimeout(ms);
  for (let i = 0; i < 6; i++) {
    const hit = await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /^(Got it|Not now|Skip|Close)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; });
    await page.waitForTimeout(250); if (!hit) break;
  }
};
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); localStorage.removeItem('pa-demo-store-advocate'); });
await page.reload({ waitUntil: 'networkidle' });
await settle();

console.log('\n--- A. the Clients page ---');
await page.waitForSelector('#personal-uploads', { timeout: 10000 }).catch(() => {});
const head = await page.evaluate(() => {
  const h = document.querySelector('#personal-uploads .personal-head');
  return h ? { text: h.textContent.replace(/\s+/g, ' ').trim(), open: h.getAttribute('aria-expanded'), bodyHidden: document.querySelector('#personal-uploads .personal-body').hidden } : null;
});
ok('the shelf is on the Clients page, named, and folded', !!head && /Personal Uploads 🤫/.test(head.text) && head.open === 'false' && head.bodyHidden, head?.text);
await page.click('#personal-uploads .personal-head');
await settle(500);
ok('a tap unfolds it', await page.evaluate(() => !document.querySelector('#personal-uploads .personal-body').hidden));
await shot('01-clients-folded-open');
await page.setInputFiles('#personal-uploads input[type=file]', `${TMP}/Tax 2025.txt`);
await settle(800);
let rows = await page.evaluate(() => [...document.querySelectorAll('#personal-uploads .personal-list li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
ok('the upload lands on the list with its name and size', rows.length === 1 && /Tax 2025\.txt/.test(rows[0]) && /B|KB/.test(rows[0]), rows.join(' | '));
const href = await page.evaluate(() => document.querySelector('#personal-uploads .personal-list a')?.getAttribute('href'));
ok('the link opens the file (the demo hands back what he picked; the real site goes through the Worker)', !!href, href);
await page.fill('#personal-uploads .personal-search', 'zzz');
await settle(300);
ok('search filters', await page.evaluate(() => /Nothing matches/.test(document.querySelector('#personal-uploads .personal-list').textContent)));
await page.fill('#personal-uploads .personal-search', '');
await settle(300);
await shot('02-clients-listed');
await page.click('#personal-uploads .personal-del');
await settle(600);
ok('delete, confirmed, takes it off the shelf', await page.evaluate(() => document.querySelectorAll('#personal-uploads .personal-list li:not(.dim)').length === 0));

console.log('\n--- B. the case\'s Mine tab ---');
const caseId = await page.evaluate(() => (document.querySelector('a[href*="admin-case.html?id="]')?.getAttribute('href') || '').replace(/.*id=/, '').replace(/&.*/, ''));
ok('a case is on the shelf to open', !!caseId, caseId);
await page.goto(`${P}/admin-case.html?id=${caseId}`, { waitUntil: 'networkidle' });
await settle();
await page.evaluate(() => { const g = [...document.querySelectorAll('[data-group]')].find((e) => e.dataset.group === 'mine'); if (g) g.click(); });
await settle(500);
await page.evaluate(() => document.querySelector('a[data-page="personal"]')?.click());
await settle(800);
const tab = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll('.folder-tabs a[data-page]')].map((a) => a.dataset.page),
  shelf: !!document.querySelector('[data-page-pane="personal"] #personal-uploads, #personal-uploads'),
  note: document.querySelector('#personal-uploads .personal-note')?.textContent || '',
}));
ok('Mine carries a Personal tab and it opens the shelf, unfolded, for this case', tab.tabs.includes('personal') && tab.shelf && /this case/.test(tab.note), tab.tabs.join());
await shot('03-case-mine-personal');
await page.setInputFiles('#personal-uploads input[type=file]', `${TMP}/plan.txt`);
await settle(800);
rows = await page.evaluate(() => [...document.querySelectorAll('#personal-uploads .personal-list li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
ok('a case upload lists on the case shelf', rows.length === 1 && /plan\.txt/.test(rows[0]), rows.join(' | '));
await shot('04-case-listed');
await page.goto(`${P}/admin.html`, { waitUntil: 'networkidle' });
await settle();
await page.click('#personal-uploads .personal-head');
await settle(600);
rows = await page.evaluate(() => [...document.querySelectorAll('#personal-uploads .personal-list li:not(.dim)')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
ok('the case file does not appear on the all-cases shelf: two shelves, two prefixes', rows.length === 0, rows.join(' | '));

console.log('\n--- C. the client never sees it ---');
const client = await ctx.newPage();
await client.goto(`${P}/case.html?id=${caseId}&demo=1`, { waitUntil: 'networkidle' });
await client.waitForTimeout(2000);
const clientText = await client.evaluate(() => document.body.textContent + ' ' + document.body.innerHTML);
ok('the client\'s case page carries no shelf, no tab, no word of it', !/Personal Uploads|admin-personal|api\/admin\/personal|personal\//.test(clientText));
await client.close();

console.log(`\n${pass} ok, ${fail} failed${errs.length ? `\n${errs.join('\n')}` : ''}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
