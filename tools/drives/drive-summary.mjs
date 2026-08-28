// drive-summary.mjs - uploading a call summary, in a real browser.
//
//   PA_PORT=8799 node tools/drives/drive-summary.mjs
//
// Eric, 2026-08-27: "All SOAP notes and visit f/u summaries are done through
// uploads. I simply need an upload type to separate the category. So they're
// labeled. 'Call Summaries,' for example."
//
// The suite proves the arithmetic and the rules. This proves the part it
// cannot: that two documents with the SAME NAME both survive being uploaded
// one after the other, which is what he is about to do, and that the second
// one does not silently replace the first. Storage overwrites a repeated path
// without a word, and the report input was the only upload path in this app
// with no timestamp in front of the name.
//
// Driven at 390x844 and 320px, because the picker is a new control in a
// column that was already full.
import { chromium } from 'playwright';
const P = `http://127.0.0.1:${process.env.PA_PORT || 8799}`;
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => {
  if (c) { pass += 1; console.log('  ok   ', n, d ? `(${d})` : ''); }
  else { fail += 1; console.log('  FAIL ', n, d ? `(${d})` : ''); }
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

for (const width of [390, 320]) {
  console.log(`\n--- ${width}px ---`);
  const ctx = await b.newContext({ viewport: { width, height: 844 } });
  await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // THE TAB IS AN <a data-page>, NOT A BUTTON. The first version of this drive
  // hunted for a <button> whose text said Uploads, found the group chip or
  // nothing, and passed anyway - every pane is built at mount and merely
  // hidden, so all the DOM assertions below went on reading a pane that was
  // never on screen. That is a drive proving nothing while printing ok. It
  // clicks the real tab now and asserts the pane is genuinely visible.
  const toPage = (id) => page.evaluate((want) => {
    const grp = [...document.querySelectorAll('[data-group]')].find((g) => g.dataset.group === 'case');
    if (grp) grp.click();
    const t = document.querySelector(`[data-page="${want}"]`);
    if (t) t.click();
    return !!t;
  }, id);

  await toPage('files');
  await page.waitForTimeout(1500);
  ok('the Uploads page is two taps away, and it is actually on screen',
    await page.evaluate(() => {
      const pane = document.getElementById('files')?.closest('.fpage');
      return !!pane && pane.hidden === false;
    }));

  const picker = await page.evaluate(() => {
    const sel = document.getElementById('up-cat');
    return {
      found: !!sel,
      options: sel ? [...sel.options].map((o) => o.textContent.trim()) : [],
      note: document.getElementById('up-cat-note')?.textContent.trim() || '',
      // The new row must not push the panel sideways at 320.
      overflow: Math.round(document.documentElement.scrollWidth
        - document.documentElement.clientWidth),
    };
  });
  ok('there is a picker for what the document IS', picker.found);
  ok('with the three types he named, spelled the way he said them',
    picker.options.join(' | ') === 'Report | Call summary | Visit follow-up',
    picker.options.join(' | '));
  ok('and it starts on Report, so the common case is no taps',
    /Marks the case delivered/.test(picker.note), picker.note);
  ok('the page does not scroll sideways', picker.overflow <= 1, `${picker.overflow}px over`);

  // Switching it changes the sentence, so the consequence is on screen before
  // he picks a file rather than after.
  const noteAfter = await page.evaluate(() => {
    const sel = document.getElementById('up-cat');
    sel.value = 'callsummary';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return document.getElementById('up-cat-note').textContent.trim();
  });
  ok('choosing a call summary says the case will NOT move',
    /Nothing about the case moves/.test(noteAfter) && /tells them by name/.test(noteAfter),
    noteAfter);

  // THE COLLISION. The same file name, twice, a beat apart.
  const send = async (name) => {
    await page.setInputFiles('#up-report', {
      name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4 ${name} ${Date.now()}`),
    });
    await page.waitForTimeout(2500);
  };
  await send('Summary.pdf');
  const saidOnce = await page.evaluate(() =>
    document.getElementById('up-said')?.textContent.trim() || '');
  ok('the first one says it landed, and says what it was filed as',
    /Summary\.pdf/.test(saidOnce) && /call summary/.test(saidOnce), saidOnce);
  ok('and it says the client was told by name',
    /notified by name/.test(saidOnce), saidOnce.slice(0, 120));

  await page.evaluate(() => {
    const sel = document.getElementById('up-cat');
    sel.value = 'callsummary';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await send('Summary.pdf');
  await page.waitForTimeout(1500);

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('pa-demo-store');
    const all = raw ? JSON.parse(raw) : {};
    return (all.files || []).map(([p, v]) => ({ path: p, meta: v.meta }))
      .filter((x) => /Summary\.pdf$/.test(x.path));
  });
  // THE ONE THAT COUNTS.
  ok('BOTH files called Summary.pdf are still there', stored.length === 2,
    `${stored.length} of 2: ${stored.map((x) => x.path.split('/').pop()).join(', ')}`);
  ok('each carries the category he picked, on the file itself',
    stored.length === 2 && stored.every((x) => x.meta?.paCategory === 'callsummary'),
    JSON.stringify(stored.map((x) => x.meta)));
  ok('and both are in report/, because a new folder is not on the table',
    stored.every((x) => /\/report\//.test(x.path)),
    stored.map((x) => x.path).join(' '));

  // The advocate's own list: one heading, two rows, neither of them wearing a
  // thirteen-digit number.
  const listed = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('.up-kind')].map((h) => h.textContent.trim());
    const pills = [...document.querySelectorAll('#files .kind-pill')]
      .map((x) => ({ text: x.textContent.trim(), cls: x.className }));
    const names = [...document.querySelectorAll('#files .fname a')].map((a) => a.textContent.trim());
    return { heads, pills, names };
  });
  ok('the Uploads page files them under their own heading',
    listed.heads.some((h) => /^Call summaries/.test(h)), listed.heads.join(' | '));
  ok('the row wears a CALL SUMMARY pill, not a REPORT one',
    listed.pills.some((p) => p.text === 'CALL SUMMARY' && /callsummary/.test(p.cls)),
    listed.pills.map((p) => p.text).join(', '));
  ok('and the file name reads as he typed it, with no timestamp on the front',
    listed.names.filter((n) => n === 'Summary.pdf').length === 2
    && !listed.names.some((n) => /^\d{10,}-/.test(n)),
    listed.names.join(', '));

  await page.screenshot({ path: `/tmp/pa-summary-${width}.png` });

  // THE CLIENT'S SIDE. Same browser, same demo store.
  const client = await ctx.newPage();
  await client.goto(`${P}/case.html?id=demo-case&demo=1`, { waitUntil: 'networkidle' });
  await client.waitForTimeout(2500);
  const clientDocs = await client.evaluate(async () => {
    const tab = [...document.querySelectorAll('button, [role=tab]')]
      .find((x) => /Documents|Files/i.test(x.textContent || ''));
    if (tab) tab.click();
    await new Promise((r) => setTimeout(r, 2500));
    const rows = [...document.querySelectorAll('.filelist li')];
    return rows.map((li) => ({
      pill: li.querySelector('.kind-pill')?.textContent.trim() || '',
      cls: li.querySelector('.kind-pill')?.className || '',
      name: li.querySelector('a')?.textContent.trim() || '',
      colour: li.querySelector('.kind-pill')
        ? getComputedStyle(li.querySelector('.kind-pill')).color : '',
    }));
  });
  const mine = clientDocs.filter((r) => r.pill === 'CALL SUMMARY');
  ok('the client sees both, labelled CALL SUMMARY', mine.length === 2,
    `${mine.length}: ${clientDocs.map((r) => `${r.pill}/${r.name}`).join(', ')}`);
  ok('with the file names he gave them',
    mine.every((r) => r.name === 'Summary.pdf'), mine.map((r) => r.name).join(', '));
  ok('and a colour of their own, distinct from the report pill',
    mine.length > 0 && mine[0].colour
      !== (clientDocs.find((r) => r.pill === 'REPORT')?.colour || 'none'),
    `${mine[0]?.colour} vs ${clientDocs.find((r) => r.pill === 'REPORT')?.colour}`);
  // They are HIS documents. A long-press must offer nothing.
  const deletable = await client.evaluate(() => {
    const li = [...document.querySelectorAll('.filelist li')]
      .find((x) => /CALL SUMMARY/.test(x.textContent || ''));
    if (!li) return 'no row';
    let asked = false;
    const was = window.confirm;
    window.confirm = () => { asked = true; return false; };
    li.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    window.confirm = was;
    return asked ? 'offered a delete' : 'no delete offered';
  });
  ok('and the client is never offered a way to delete one',
    deletable === 'no delete offered', deletable);

  await client.screenshot({ path: `/tmp/pa-summary-client-${width}.png` });
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

await b.close();
console.log(`\n${pass} ok, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
