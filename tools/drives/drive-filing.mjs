// drive-filing.mjs - the long press on a file row, in a real browser.
//
//   PA_PORT=8788 node tools/drives/drive-filing.mjs
//
// Eric, 2026-08-27: "the advisor/app should take anything uploaded in the chat
// and add it to forms. I can long press and rename them." Asked whether every
// chat upload should file itself, he chose: "Filable, I choose."
//
// The suite proves the route's rules and what the two row builders render.
// This proves the part it cannot: that the press actually opens something
// under a real finger, that his two new rows are there, that a rename and a
// filing go through the Worker and come back onto BOTH lists, and that the
// sheet is reachable on a phone. Driven at 390x844 and at 320px, because a
// sheet with six document types in it is a lot of rows for the narrow one.
//
// The file it works on is a real chat attachment, put there through the chat's
// own attach control rather than written into the store, because a chat upload
// carrying nothing descriptive is the exact thing this feature is for.
import { chromium } from 'playwright';
const P = `http://127.0.0.1:${process.env.PA_PORT || 8788}`;
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => {
  if (c) { pass += 1; console.log('  ok   ', n, d ? `(${d})` : ''); }
  else { fail += 1; console.log('  FAIL ', n, d ? `(${d})` : ''); }
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

for (const width of [390, 320]) {
  console.log(`\n--- ${width}px ---`);
  const ctx = await b.newContext({
    viewport: { width, height: 844 }, deviceScaleFactor: 2, hasTouch: true,
  });
  await ctx.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const toPage = (id) => page.evaluate((want) => {
    const grp = [...document.querySelectorAll('[data-group]')].find((g) => g.dataset.group === 'case');
    if (grp) grp.click();
    const t = document.querySelector(`[data-page="${want}"]`);
    if (t) t.click();
    return !!t;
  }, id);

  // ---- put a real file into the chat ------------------------------------
  await toPage('chat');
  await page.waitForTimeout(1200);
  await page.setInputFiles('[data-attach]', {
    name: 'IMG_4127.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4 filing drive ${Date.now()}`),
  });
  await page.waitForTimeout(3000);
  const landed = await page.evaluate(() => {
    const raw = localStorage.getItem('pa-demo-store');
    const all = raw ? JSON.parse(raw) : {};
    return (all.files || []).map(([p]) => p).filter((p) => /chat-files/.test(p));
  });
  ok('a file shared in the chat lands in chat-files', landed.length === 1, landed.join(' '));
  const CHATPATH = landed[0] || '';

  // ---- it shows as a chat file, wearing no label -------------------------
  await toPage('files');
  await page.waitForTimeout(2500);
  const before = await page.evaluate(() => {
    const li = [...document.querySelectorAll('#files [data-frow]')]
      .find((x) => /IMG_4127/.test(x.textContent));
    return li ? {
      pill: li.querySelector('.kind-pill')?.textContent.trim() || '',
      name: li.querySelector('.fname a')?.textContent.trim() || '',
    } : null;
  });
  ok('it is on his Uploads page, as a chat file with no label',
    before && before.pill === 'CHAT' && before.name === 'IMG_4127.pdf',
    before ? `${before.pill} / ${before.name}` : 'row not found');

  // ---- THE LONG PRESS ----------------------------------------------------
  // A real held press with a real pointer, not a synthetic event: the whole
  // point of moving off touchstart is that the gesture works under a mouse
  // and survives a little movement, and only the browser can say so.
  const rowBox = async (match) => {
    // SCROLLED INTO VIEW FIRST, AND THEN CHECKED AGAINST THE PAGE. The Uploads
    // page is longer than a phone, so the row is usually below the fold, and a
    // mouse moved to a y outside the viewport is clamped to the edge: the
    // first version of this drive pressed whatever happened to be at the
    // bottom of the screen and then reported that the long press does not
    // work. The second version scrolled but measured while the scroll was
    // still settling, and pressed a day heading two rows above the file. So
    // the point is verified with elementFromPoint before it is pressed: if
    // what is under it is not inside the row, this is not a press worth
    // making.
    await page.evaluate((m) => {
      const li = [...document.querySelectorAll('#files [data-frow]')]
        .find((x) => new RegExp(m).test(x.textContent));
      li?.scrollIntoView({ block: 'center' });
    }, match);
    await page.waitForTimeout(700);
    return page.evaluate((m) => {
      const li = [...document.querySelectorAll('#files [data-frow]')]
        .find((x) => new RegExp(m).test(x.textContent));
      const a = li?.querySelector('.fname a');
      if (!a) return null;
      const r = a.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (y < 0 || y > window.innerHeight) return null;
      const under = document.elementFromPoint(x, y);
      if (!under || !li.contains(under)) return null;
      return { x, y };
    }, match);
  };
  const pressRow = async (match = 'IMG_4127|Signed records release') => {
    const box = await rowBox(match);
    if (!box) return false;
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    // Two pixels of drift, which is a finger resting on glass. It must NOT
    // cancel: the handler this replaces gave up on any touchmove at all.
    await page.mouse.move(box.x + 2, box.y + 1);
    await page.waitForTimeout(900);
    await page.mouse.up();
    await page.waitForTimeout(400);
    return true;
  };

  ok('the row can be pressed', await pressRow());
  const sheet = await page.evaluate(() => {
    const o = document.querySelector('.msg-menu-overlay');
    if (!o) return null;
    return {
      head: o.querySelector('.msg-menu-head')?.textContent.trim() || '',
      rows: [...o.querySelectorAll('.msg-menu-row')].map((r) => r.textContent.trim()),
      label: o.querySelector('.msg-menu')?.getAttribute('aria-label') || '',
      // The sheet must not push the page sideways at 320.
      overflow: Math.round(document.documentElement.scrollWidth
        - document.documentElement.clientWidth),
    };
  });
  ok('a held press opens a sheet, not a bare confirm', !!sheet);
  ok('and it names the file it is about', sheet?.head === 'IMG_4127.pdf', sheet?.head);
  // Pinned WORD FOR WORD and in order, emoji included, so a reordered or
  // reworded row fails here rather than quietly disagreeing with his hands.
  ok('with his three actions on it, in his order',
    sheet && sheet.rows.join(' | ') === '✏️Rename | 🗂File as... | 🗑Delete | Cancel',
    sheet?.rows.join(' | '));
  ok('announced as a file sheet, not as message actions',
    sheet?.label === 'File actions', sheet?.label);
  ok('the page does not scroll sideways', (sheet?.overflow ?? 99) <= 1,
    `${sheet?.overflow}px over`);

  // A press that MOVES is a scroll, and must open nothing.
  await page.evaluate(() => document.querySelector('.msg-menu-overlay')?.remove());
  const dragBox = await rowBox('IMG_4127');
  if (dragBox) {
    await page.mouse.move(dragBox.x, dragBox.y);
    await page.mouse.down();
    await page.mouse.move(dragBox.x, dragBox.y - 60, { steps: 6 });
    await page.waitForTimeout(900);
    await page.mouse.up();
    await page.waitForTimeout(300);
    ok('a press that turns into a scroll opens nothing',
      await page.evaluate(() => !document.querySelector('.msg-menu-overlay')));
  } else {
    ok('a press that turns into a scroll opens nothing', false, 'row not reachable');
  }

  // ---- RENAME ------------------------------------------------------------
  await pressRow();
  await page.evaluate(() => [...document.querySelectorAll('.msg-menu-row')]
    .find((r) => /Rename$/.test(r.textContent.trim()))?.click());
  await page.waitForTimeout(400);
  const box = await page.evaluate(() => {
    const i = document.querySelector('.rename-card [data-name]');
    return i ? { value: i.value } : null;
  });
  ok('Rename opens a box already holding what it is called now',
    box?.value === 'IMG_4127.pdf', box?.value);
  await page.fill('.rename-card [data-name]', 'Signed records release');
  await page.evaluate(() => document.querySelector('.rename-card [data-save]').click());
  await page.waitForTimeout(2500);

  const afterRename = await page.evaluate(() => {
    const raw = localStorage.getItem('pa-demo-store');
    const all = raw ? JSON.parse(raw) : {};
    const f = (all.files || []).find(([p]) => /chat-files/.test(p));
    const li = [...document.querySelectorAll('#files [data-frow]')]
      .find((x) => /Signed records release/.test(x.textContent));
    return {
      path: f?.[0] || '', meta: f?.[1]?.meta || null,
      row: li ? li.querySelector('.fname a')?.textContent.trim() : '',
      said: document.getElementById('up-said')?.textContent.trim() || '',
    };
  });
  ok('the new name is written onto the file itself',
    afterRename.meta?.paName === 'Signed records release',
    JSON.stringify(afterRename.meta));
  ok('AND THE FILE HAS NOT MOVED: same path, same folder',
    afterRename.path === CHATPATH && /\/chat-files\//.test(afterRename.path),
    afterRename.path);
  ok('his list reads it under the new name', afterRename.row === 'Signed records release',
    afterRename.row);
  ok('and the page says what happened', /Signed records release/.test(afterRename.said),
    afterRename.said);

  // ---- FILE AS A FILLED FORM --------------------------------------------
  await pressRow();
  await page.evaluate(() => [...document.querySelectorAll('.msg-menu-row')]
    .find((r) => /File as\.\.\.$/.test(r.textContent.trim()))?.click());
  await page.waitForTimeout(400);
  const cats = await page.evaluate(() => {
    const o = document.querySelector('.msg-menu-overlay');
    return o ? {
      head: o.querySelector('.msg-menu-head')?.textContent.trim() || '',
      rows: [...o.querySelectorAll('.msg-menu-row')].map((r) => r.textContent.trim()),
      overflow: Math.round(document.documentElement.scrollWidth
        - document.documentElement.clientWidth),
    } : null;
  });
  ok('File as... offers his own six document types, in his order',
    cats && cats.rows.map((r) => r.replace(/^\P{L}+/u, '')).join(' | ')
      === 'Report | Call summary | Visit follow-up | Appointment summary | '
        + 'Form sent to client | Filled form | Cancel',
    cats?.rows.join(' | '));
  ok('and the picker still does not push the page sideways',
    (cats?.overflow ?? 99) <= 1, `${cats?.overflow}px over`);
  await page.screenshot({ path: `/tmp/pa-filing-sheet-${width}.png` });
  await page.evaluate(() => [...document.querySelectorAll('.msg-menu-row')]
    .find((r) => /Filled form$/.test(r.textContent.trim()))?.click());
  await page.waitForTimeout(2500);

  const afterFile = await page.evaluate(() => {
    const raw = localStorage.getItem('pa-demo-store');
    const all = raw ? JSON.parse(raw) : {};
    const f = (all.files || []).find(([p]) => /chat-files/.test(p));
    const li = [...document.querySelectorAll('#files [data-frow]')]
      .find((x) => /Signed records release/.test(x.textContent));
    return {
      path: f?.[0] || '', meta: f?.[1]?.meta || null,
      pill: li?.querySelector('.kind-pill')?.textContent.trim() || '',
      cls: li?.querySelector('.kind-pill')?.className || '',
      heads: [...document.querySelectorAll('.up-kind')].map((h) => h.textContent.trim()),
      said: document.getElementById('up-said')?.textContent.trim() || '',
    };
  });
  ok('the label is written onto the file, and the name survives it',
    afterFile.meta?.paCategory === 'formfilled'
    && afterFile.meta?.paName === 'Signed records release',
    JSON.stringify(afterFile.meta));
  ok('AND IT IS STILL IN chat-files, at the same path',
    afterFile.path === CHATPATH, afterFile.path);
  ok('his row now wears the FILLED FORM pill',
    afterFile.pill === 'FILLED FORM' && /formfilled/.test(afterFile.cls),
    `${afterFile.pill} / ${afterFile.cls}`);
  ok('and it has moved under the Filled forms heading',
    afterFile.heads.some((h) => /^Filled forms/.test(h)), afterFile.heads.join(' | '));
  await page.screenshot({ path: `/tmp/pa-filing-admin-${width}.png` });

  // ---- THE CLIENT'S OWN PAGE --------------------------------------------
  const client = await ctx.newPage();
  await client.goto(`${P}/case.html?id=demo-case&demo=1`, { waitUntil: 'networkidle' });
  await client.waitForTimeout(2500);
  // THE REAL TAB, AND THE PANE HAS TO BE ON SCREEN. Every pane on this page is
  // built at mount and merely hidden, so reading `.filelist li` without
  // switching tabs reads a list nobody is looking at - which is a drive
  // proving nothing while printing ok.
  await client.evaluate(() => {
    const tab = [...document.querySelectorAll('button, a')]
      .find((x) => /^\s*📄?\s*Docs\s*$/.test(x.textContent || ''));
    tab?.click();
  });
  await client.waitForTimeout(3000);
  const theirs = await client.evaluate(() => {
    const list = document.querySelector('.filelist');
    const rows = [...document.querySelectorAll('.filelist li')].map((li) => ({
      pill: li.querySelector('.kind-pill')?.textContent.trim() || '',
      cls: li.querySelector('.kind-pill')?.className || '',
      name: li.querySelector('a')?.textContent.trim() || '',
      html: li.innerHTML,
    }));
    return { rows, onScreen: !!list && !!list.offsetParent };
  });
  ok('their Documents tab is actually on screen', theirs.onScreen);
  const mine = theirs.rows.find((r) => /Signed records release/.test(r.name));
  ok('the client sees it under the name he typed', !!mine,
    theirs.rows.map((r) => r.name).join(', '));
  ok('and it says FILLED FORM to them too, not FROM CHAT',
    mine && mine.pill === 'FILLED FORM' && /formfilled/.test(mine.cls),
    mine ? `${mine.pill} / ${mine.cls}` : '');
  ok('with no markup smuggled into their row',
    !!mine && !/<img|<script/i.test(mine.html));
  await client.screenshot({ path: `/tmp/pa-filing-client-${width}.png` });

  ok('no page errors on either side', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

await b.close();
console.log(`\n${pass} ok, ${fail} failed`);
if (fail) process.exit(1);
