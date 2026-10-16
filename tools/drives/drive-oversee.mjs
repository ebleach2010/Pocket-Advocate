// drive-oversee.mjs - his three acts in a quiet view of someone else's case (v7.59).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-oversee.mjs
//
// Eric, 2026-10-16: "I should be able to tap on the employee and see things from
// their perspective without being able to interact with their client. I can
// still delete uploads and chats for real employees if I think they're
// dangerous, as well as hit the ⚕️ icon to send them suicide prevention
// resources with the prewritten message." Driven in his demo on Ana's case
// (Priya), then read back from Ana's own side: what he removed reads "Removed
// by Eric" there too, and his crisis message carries his name.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PA_PORT || '9377';
const SHOTS = process.env.PA_SHOTS || '';
const P = `http://127.0.0.1:${PORT}`;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { if (c) { pass += 1; console.log(`  ok    ${n}${d ? ` (${d})` : ''}`); } else { fail += 1; console.log(`  FAIL  ${n}${d ? ` (${d})` : ''}`); } };
const errs = [];
const tryStep = async (fn) => { try { await fn(); return true; } catch { return false; } };
async function side(role) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'pa_demo', value: role, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`${role}: ${String(e).slice(0, 200)}`));
  return { ctx, page };
}
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const CASE = 'demo-case-ana';
const UP = `cases/${CASE}/uploads/1760000000000-echo report.pdf`;
const CF = `cases/${CASE}/chat-files/1760000000001-photo.png`;
const goTab = async (page, tab) => {
  await tryStep(() => page.click('.folder-groups button:has-text("Case")', { timeout: 3000 }));
  await tryStep(() => page.click(`.folder-tabs >> text=${tab}`, { timeout: 3000 }));
  await page.waitForTimeout(900);
};
const chatRead = (page) => page.evaluate(() => ({
  bubbles: [...document.querySelectorAll('#chat .msg')].map((m) => ({ id: m.dataset.mid, text: m.textContent.replace(/\s+/g, ' ').trim().slice(0, 90) })),
  trash: document.querySelectorAll('#chat .msg-remove').length,
  by: [...document.querySelectorAll('#chat .msg-by')].map((e) => e.textContent.trim()),
  composer: !!document.querySelector('#chat .chat-form textarea'),
}));

console.log('\n--- A. his quiet view of Ana\'s case: every message can come down, and ⚕️ is there ---');
const { ctx, page } = await side('admin');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(({ CASE, UP, CF, PNG }) => {
  for (const k of Object.keys(localStorage)) if (k.startsWith('pa-demo')) localStorage.removeItem(k);
}, { CASE, UP, CF, PNG });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
// A file Priya uploaded, and a photo she shared in the chat.
await page.evaluate(({ CASE, UP, CF, PNG }) => {
  const raw = JSON.parse(localStorage.getItem('pa-demo-store') || '{}');
  const docs = new Map(raw.docs || []);
  const files = new Map(raw.files || []);
  const at = new Date(Date.now() - 3600_000).toISOString();
  files.set(UP, { name: UP.split('/').pop(), size: 2048, type: 'application/pdf', at, url: 'data:application/pdf;base64,JVBERi0=', persisted: true });
  files.set(CF, { name: CF.split('/').pop(), size: 68, type: 'image/png', at, url: PNG, persisted: true });
  docs.set(`cases/${CASE}/chat/a900`, { from: 'demo-client-ana', role: 'client', text: '', ts: at,
    attachment: { name: 'photo.png', path: CF, url: PNG, size: 68, contentType: 'image/png' } });
  localStorage.setItem('pa-demo-store', JSON.stringify({ ...raw, docs: [...docs.entries()], files: [...files.entries()] }));
}, { CASE, UP, CF, PNG });
await page.goto(`${P}/admin-case.html?id=${CASE}&as=demo-advocate&demo=admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await goTab(page, 'Chat');
const a = await chatRead(page);
const bar = await page.evaluate(() => ({
  text: document.querySelector('.quiet-bar')?.textContent.replace(/\s+/g, ' ').trim() || '',
  duty: !!document.querySelector('.quiet-bar [data-quiet-duty]'),
}));
// NEGATIVE CONTROL (run 2026-10-16): the chat's `messageTools: asUid ? removeMessageTool : null` made `null` made this read
//   FAIL  every message with words or a file carries a remove, the bar offers ⚕️, and there is still no way to type to Priya
ok('every message with words or a file carries a remove, the bar offers ⚕️, and there is still no way to type to Priya',
  a.bubbles.length >= 4 && a.trash === a.bubbles.length && bar.duty && /Only 🗑 and ⚕️ reach anyone\./.test(bar.text) && !a.composer,
  JSON.stringify({ a, bar }));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/oversee-a-quiet-chat.png` });

console.log('\n--- B. a message comes down ---');
await page.click('#chat .msg[data-mid="a001"] .msg-remove');
await page.waitForTimeout(400);
const sheet = await page.evaluate(() => ({ title: document.querySelector('dialog.ask-sheet h2')?.textContent || '', body: document.querySelector('dialog.ask-sheet p')?.textContent || '' }));
await tryStep(() => page.click('dialog.ask-sheet button[value="ok"]', { timeout: 3000 }));
await page.waitForTimeout(1200);
const b1 = await chatRead(page);
const gone = b1.bubbles.find((x) => x.id === 'a001');
// NEGATIVE CONTROL (run 2026-10-16): the quiet view's submit exception for the asking sheet taken out made this read
//   FAIL  asked first in his own sheet, the message then reads Removed by Eric and nothing it said
ok('asked first in his own sheet, the message then reads Removed by Eric and nothing it said',
  sheet.title === 'Remove this message?' && /see "Removed by Eric" in its place/.test(sheet.body)
  && gone?.text === 'Removed by Eric' && b1.trash === a.trash - 1, JSON.stringify({ sheet, gone, trash: b1.trash }));

console.log('\n--- C. files come down, the shared photo\'s message with it ---');
await goTab(page, 'Uploads');
await page.waitForTimeout(800);
const filesBefore = await page.evaluate(() => [...document.querySelectorAll('#files [data-frow]')].map((li) => li.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)));
const removeFile = async (match) => {
  const i = await page.evaluate((m) => {
    const li = [...document.querySelectorAll('#files [data-frow]')].find((x) => x.textContent.includes(m));
    return li?.querySelector('[data-oversee-file]')?.dataset.overseeFile ?? null;
  }, match);
  if (i === null) return false;
  await page.click(`#files [data-oversee-file="${i}"]`);
  await page.waitForTimeout(400);
  await tryStep(() => page.click('dialog.ask-sheet button[value="ok"]', { timeout: 3000 }));
  await page.waitForTimeout(1500);
  return true;
};
const r1 = await removeFile('echo report');
const r2 = await removeFile('photo');
const filesAfter = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('#files [data-frow]')].map((li) => li.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)),
  note: document.querySelector('#files [data-removed-files]')?.textContent.trim() || '',
}));
// NEGATIVE CONTROL (run 2026-10-16): admin-case's removedNote answering nothing made this read
//   FAIL  both files are gone from the list, which says two were removed by Eric and never their names
ok('both files are gone from the list, which says two were removed by Eric and never their names',
  r1 && r2 && filesBefore.some((x) => /echo report/.test(x)) && !filesAfter.rows.some((x) => /echo report|photo/.test(x))
  && /^🗑 Removed by Eric: 2 files, the latest on /.test(filesAfter.note) && !/echo|photo/.test(filesAfter.note),
  JSON.stringify({ filesBefore, filesAfter }));
await goTab(page, 'Chat');
const c1 = await chatRead(page);
ok('the photo\'s message in the chat reads Removed by Eric too', c1.bubbles.find((x) => x.id === 'a900')?.text === 'Removed by Eric', JSON.stringify(c1.bubbles));

console.log('\n--- D. ⚕️: his words, his name, and still nothing else leaves ---');
await page.click('.quiet-bar [data-quiet-duty]');
await page.waitForTimeout(500);
await page.click('.duty-card [data-duty]');
await page.keyboard.press('Control+End');
await page.keyboard.type(' I am here.');
const draft = await page.evaluate(() => document.querySelector('.duty-card [data-duty]')?.value || '');
await page.click('.duty-card [data-send]');
await page.waitForTimeout(1500);
const d1 = await chatRead(page);
const toast = await page.evaluate(() => document.querySelector('.quiet-toast')?.textContent || '');
const mine = await page.evaluate(() => [...document.querySelectorAll('#chat .msg')].pop()?.textContent.replace(/\s+/g, ' ').trim() || '');
// NEGATIVE CONTROL (run 2026-10-16): `.duty-card *` taken out of the quiet view's SAFE list made this read
//   FAIL  the draft is his to edit, and it arrives in Priya's chat under his name, with his words and the lines
ok('the draft is his to edit, and it arrives in Priya\'s chat under his name, with his words and the lines',
  /^Based on what you said, I'm obligated to send you this\./.test(draft) && /I am here\.$/.test(draft)
  && d1.by.includes('Eric') && /^Eric\s*Based on what you said/.test(mine) && /988/.test(mine) && /Sent, from you\./.test(toast),
  JSON.stringify({ draftEnd: draft.slice(-40), by: d1.by, mine: mine.slice(0, 80), toast }));
const refused = await page.evaluate(async () => {
  const r = await fetch('/api/chat/react', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"kind":"case","id":"demo-case-ana","msgId":"a002","reaction":"heart"}' });
  return { status: r.status, body: await r.json().catch(() => ({})) };
});
ok('any other write is still answered with the quiet view\'s one line', refused.status === 409 && /nothing here can be changed/.test(refused.body.error || ''), JSON.stringify(refused));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/oversee-d-crisis.png` });
const store = await page.evaluate(() => localStorage.getItem('pa-demo-store'));
await ctx.close();

console.log('\n--- E. Ana\'s own side ---');
{
  const { ctx: c2, page: ana } = await side('advocate');
  await ana.addInitScript((s) => { try { if (!sessionStorage.getItem('drive-copied')) { sessionStorage.setItem('drive-copied', '1'); localStorage.setItem('pa-demo-store', s); } } catch { /* none */ } }, store);
  await ana.goto(`${P}/admin-case.html?id=${CASE}&demo=advocate`, { waitUntil: 'networkidle' });
  await ana.waitForTimeout(2000);
  await goTab(ana, 'Chat');
  const e = await chatRead(ana);
  await goTab(ana, 'Uploads');
  await ana.waitForTimeout(800);
  const note = await ana.evaluate(() => document.querySelector('#files [data-removed-files]')?.textContent.trim() || '');
  // NEGATIVE CONTROL (run 2026-10-16): chat.js's `by.textContent = data.byName` made `by.textContent = ''` made this read
  //   FAIL  she sees Removed by Eric where things were, his message under his name, and no remove of her own
  ok('she sees Removed by Eric where things were, his message under his name, and no remove of her own',
    e.bubbles.find((x) => x.id === 'a001')?.text === 'Removed by Eric' && e.by.includes('Eric') && e.trash === 0
    && /^🗑 Removed by Eric: 2 files/.test(note), JSON.stringify({ e, note }));
  if (SHOTS) await ana.screenshot({ path: `${SHOTS}/oversee-e-ana.png` });
  await c2.close();
}

console.log('\n--- F. his own case, not a quiet view: no removes ---');
{
  const { ctx: c3, page: own } = await side('admin');
  await own.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
  await own.waitForTimeout(2000);
  await goTab(own, 'Chat');
  const f = await chatRead(own);
  ok('on a case he works himself there is no remove and no quiet bar', f.bubbles.length > 0 && f.trash === 0 && !(await own.$('.quiet-bar')), JSON.stringify({ n: f.bubbles.length, trash: f.trash }));
  await c3.close();
}

ok('no page errors', !errs.length, errs.join(' | '));
await b.close();
console.log(`\n${pass} ok, ${fail} failed`);
if (fail) process.exit(1);
