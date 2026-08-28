// drive-forms.mjs - ticking the forms and sending them, in a real browser.
//
//   PA_PORT=8799 node tools/drives/drive-forms.mjs
//
// Eric, 2026-08-27, on a client who had already paid him outside the app: "I
// need to be able to select forms and send them, regardless of if they've
// already been sent or not. This way this client can have the signed forms in
// the uploaded documents. This is another example of what the advisor could
// do: 'send the hands-off forms to the client'."
//
// The suite proves the rules. This proves the part it cannot: that he can
// actually tick both forms on a phone-sized screen, tap once, and see them
// arrive on the CLIENT's documents list wearing the FORM SENT pill. Both
// halves are driven in one browser against one demo store, because "it
// uploaded" and "they can see it" are different claims and only the second
// one is what he asked for.
//
// Driven at 390x844 and at 320px: the picker is a new control with a tick,
// a label and a Print button on one row, in a column that was already full.
import { chromium } from 'playwright';
const P = `http://127.0.0.1:${process.env.PA_PORT || 8799}`;
const CASE = 'demo-case-full';
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

  await page.goto(`${P}/admin-case.html?id=${CASE}&demo=admin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // GET TO THE PAGE FIRST, AND PROVE IT IS ON SCREEN. Every pane is built at
  // mount and merely hidden, so reaching into `details[data-k="auth"]` from
  // wherever the folder happened to open lands on a pane he is not looking at
  // and prints ok on a screen that does not exist. On a Hands-Off case the
  // folder opens on Act/Appeals, so this is not theoretical: the first run of
  // this drive ticked and sent from behind the appeal workbench.
  const toPage = (group, id) => page.evaluate(([g, want]) => {
    [...document.querySelectorAll('[data-group]')].find((x) => x.dataset.group === g)?.click();
    const t = document.querySelector(`a[data-page="${want}"]`);
    if (t) t.click();
    return !!t;
  }, [group, id]);
  await toPage('case', 'overview');
  await page.waitForTimeout(1200);
  ok('Overview is two taps away, and it is actually on screen',
    await page.evaluate(() => {
      const pane = document.querySelector('details[data-k="auth"]')?.closest('.fpage');
      return !!pane && pane.hidden === false;
    }));

  // The panel is a <details> on the Overview page. Open it the way he does.
  const opened = await page.evaluate(() => {
    const d = document.querySelector('details[data-k="auth"]');
    if (!d) return null;
    d.open = true;
    return {
      summary: d.querySelector('summary')?.textContent.trim() || '',
      blurb: d.querySelector('.mgmt-body p')?.textContent.replace(/\s+/g, ' ').trim() || '',
      ticks: [...d.querySelectorAll('[data-form-pick]')].map((x) => ({
        id: x.dataset.formPick,
        label: x.closest('label')?.textContent.replace(/\s+/g, ' ').trim() || '',
      })),
      prints: [...d.querySelectorAll('[data-blank]')].map((x) => x.dataset.blank),
      send: d.querySelector('#forms-send')?.textContent.trim() || '',
    };
  });
  ok('the form panel is there and opens', !!opened);
  ok('and it offers a tick per form, both of them',
    opened.ticks.map((t) => `${t.id}:${t.label}`).join(' | ')
      === 'records:Records authorisation | representative:Insurance representative',
    opened.ticks.map((t) => `${t.id}:${t.label}`).join(' | '));
  ok('printing one by hand is still one tap, per form',
    opened.prints.join() === 'records,representative', opened.prints.join());
  ok('and there is one button that sends what is ticked',
    /Send the ticked forms/.test(opened.send), opened.send);
  // THE COPY THAT WENT FALSE. In-app signing is parked, so the panel must not
  // promise it, in any of its wording.
  ok('the panel no longer promises signing in the app',
    !/signing in the app|sign in the app|opens when they upgrade/i.test(opened.blurb),
    opened.blurb.slice(0, 160));
  ok('and it says plainly that signing is by hand',
    /by hand/.test(opened.blurb) && /send it back/.test(opened.blurb),
    opened.blurb.slice(0, 200));

  const overflow = await page.evaluate(() => Math.round(
    document.documentElement.scrollWidth - document.documentElement.clientWidth));
  ok('the page does not scroll sideways with the picker open', overflow <= 1,
    `${overflow}px over`);

  // TICK BOTH AND SEND. His example, in his words: "send the hands-off forms
  // to the client" - plural, one action.
  const tick = () => page.evaluate(() => {
    const d = document.querySelector('details[data-k="auth"]');
    d.open = true;
    d.querySelectorAll('[data-form-pick]').forEach((x) => { x.checked = true; });
  });
  const send = async () => {
    await tick();
    await page.evaluate(() => document.querySelector('#forms-send').click());
    await page.waitForTimeout(3000);
  };
  await tick();
  // Onto the CONTROLS, not the top of the panel: the blurb above them runs
  // six lines on a 320px phone, and a shot of the paragraph proves nothing
  // about whether the ticks and the button are reachable. Playwright's own
  // scroll, because the pane is inside a transformed flip container and
  // scrollIntoView from page script moved nothing.
  await page.locator('#forms-send').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/pa-forms-picker-${width}.png` });
  await send();
  await page.screenshot({ path: `/tmp/pa-forms-sent-${width}.png` });

  // The demo persists its file table under `pa-demo-store`; the -advocate
  // half holds only the documents a client-side tab must never load. Reading
  // the wrong one returns an empty list, and an empty list passes an `every`
  // without asserting anything, so every count below is checked as a NUMBER.
  const stored = () => page.evaluate((id) => {
    const all = JSON.parse(localStorage.getItem('pa-demo-store') || '{}');
    return (all.files || []).map(([p, v]) => ({ path: p, meta: v.meta, type: v.type }))
      .filter((x) => x.path.startsWith(`cases/${id}/`) && /\.html$/.test(x.path));
  }, CASE);

  const one = await stored();
  ok('both forms are stored, from one tap', one.length === 2,
    `${one.length}: ${one.map((x) => x.path.split('/').pop()).join(', ')}`);
  // NEGATIVE CONTROL (run 2026-08-28): dropping the customMetadata argument
  // from the send made this run read
  //   FAIL  every one of them carries paCategory formsent, on the file itself ([null,null])
  //   FAIL  his Uploads page files them under Forms sent (Reports4 | Documents1 | Images1 | Documents1)
  //   FAIL  with a FORM SENT pill on each of the four (REPORT, REPORT, REPORT, REPORT, UPLOAD, UPLOAD, UPLOAD)
  //   FAIL  the client sees all four, every one labelled FORM SENT (0: REPORT/Insurance representative 2026-08-27.html, ...)
  // which is the whole feature turning back into four anonymous reports on
  // the client's phone, and it is caught on BOTH screens rather than one.
  ok('every one of them carries paCategory formsent, on the file itself',
    one.length === 2 && one.every((x) => x.meta?.paCategory === 'formsent'),
    JSON.stringify(one.map((x) => x.meta)));
  ok('and they are in report/, because a new folder is not on the table',
    one.length === 2 && one.every((x) => /^cases\/[\w-]+\/report\//.test(x.path)),
    one.map((x) => x.path).join(' '));
  // A NAME, NOT A UUID. The form and the date, so he can tell one from the
  // other on a phone and say which one he means on a call.
  const named = one.map((x) => x.path.split('/').pop().replace(/^\d{10,}-/, '')).sort();
  ok('each file is named for its form and the day it went out',
    named.length === 2
    && /^Insurance representative \d{4}-\d{2}-\d{2}\.html$/.test(named[0])
    && /^Records authorisation \d{4}-\d{2}-\d{2}\.html$/.test(named[1]),
    named.join(' | '));
  ok('and they open as a readable document, not as bytes',
    one.length === 2 && one.every((x) => x.type === 'text/html'),
    one.map((x) => x.type).join(', '));

  const said = await page.evaluate(() =>
    document.querySelector('details[data-k="auth"] .saved-note')?.textContent
      .replace(/\s+/g, ' ').trim() || '');
  ok('the panel says what the CLIENT now has, by name',
    /Records authorisation/.test(said) && /Insurance representative/.test(said)
    && /Forms sent/.test(said) && /notified/.test(said), said);
  const reticked = await page.evaluate(() =>
    [...document.querySelectorAll('[data-form-pick]:checked')].length);
  ok('the ticks clear, so the next send is a decision', reticked === 0, `${reticked} still ticked`);

  // RESENDING. His words: "regardless of if they've already been sent or not."
  // Nothing may refuse, disable or quietly skip.
  const disabled = await page.evaluate(() =>
    !!document.querySelector('#forms-send')?.disabled);
  ok('the send button is not disabled after a send', !disabled);
  await send();
  const twice = await stored();
  // NEGATIVE CONTROL (run 2026-08-28): adding the once-only guard a future
  // reader would add (`if (sentBefore.has(form.id)) continue;`) made this run
  // read
  //   FAIL  sending the same two forms again lands TWO MORE documents, not nothing (2 of 4)
  //   FAIL  and the resent copies are labelled the same way (["formsent","formsent"])
  //   FAIL  with a FORM SENT pill on each of the four (FORM SENT, FORM SENT, UPLOAD, UPLOAD, UPLOAD)
  //   FAIL  the client sees all four, every one labelled FORM SENT (2: ...)
  // His words: "regardless of if they've already been sent or not." The suite
  // pins this too (uploads.mjs U24); this is the same claim on a real screen.
  ok('sending the same two forms again lands TWO MORE documents, not nothing',
    twice.length === 4, `${twice.length} of 4`);
  ok('and the resent copies are labelled the same way',
    twice.filter((x) => x.meta?.paCategory === 'formsent').length === 4,
    JSON.stringify(twice.map((x) => x.meta?.paCategory)));

  // HIS OWN UPLOADS PAGE. Same heading, same pill as a hand upload.
  await toPage('case', 'files');
  await page.waitForTimeout(2500);
  ok('the Uploads page is on screen too, not merely built',
    await page.evaluate(() => {
      const pane = document.getElementById('files')?.closest('.fpage');
      return !!pane && pane.hidden === false;
    }));
  const listed = await page.evaluate(() => ({
    heads: [...document.querySelectorAll('.up-kind')].map((h) => h.textContent.trim()),
    pills: [...document.querySelectorAll('#files .kind-pill')].map((x) => x.textContent.trim()),
    names: [...document.querySelectorAll('#files .fname a')].map((a) => a.textContent.trim()),
  }));
  ok('his Uploads page files them under Forms sent',
    listed.heads.some((h) => /^Forms sent/.test(h)), listed.heads.join(' | '));
  ok('with a FORM SENT pill on each of the four',
    listed.pills.filter((p) => p === 'FORM SENT').length === 4,
    listed.pills.join(', '));
  ok('and no thirteen-digit number in front of any name',
    !listed.names.some((n) => /^\d{10,}-/.test(n)), listed.names.join(', '));

  // WHAT IS ACTUALLY IN THE FILE. Read back off the link in the list, not off
  // the string that was uploaded, so a send that stored the wrong bytes fails
  // here. Read on the ADMIN page on purpose: the demo hands back an object URL
  // belonging to the document that created it, and the client tab that reloads
  // from localStorage gets the honest "no preview" placeholder instead.
  const inside = await page.evaluate(async () => {
    const a = [...document.querySelectorAll('#files .fname a')]
      .find((x) => /^Records authorisation/.test(x.textContent.trim()));
    if (!a) return 'NO LINK';
    const res = await fetch(a.href);
    return res.ok ? res.text() : `HTTP ${res.status}`;
  });
  ok('the stored document is the records authorisation itself',
    /AUTHORISATION FOR RELEASE OF PROTECTED HEALTH INFORMATION/.test(inside),
    `${inside.length} bytes: ${inside.slice(0, 60)}`);
  ok('with the client\'s own name already filled in', /Jordan Avery/.test(inside));
  ok('and ruled lines to sign by hand, with no electronic-signature claim',
    /Print name:/.test(inside) && !/Signed electronically/.test(inside));
  // It is opened on a client's phone with none of this app around it, so it
  // must give nothing away and must carry no dash a person reads.
  ok('and it gives away nothing about the advocate\'s side, and uses no dashes',
    inside.length > 500 && !/[–—]/.test(inside)
    && !/advisor|differential|\bAI\b|working diagnos/i.test(inside),
    (inside.match(/[–—]|advisor|differential|\bAI\b|working diagnos/i) || [])[0] || '');

  await page.screenshot({ path: `/tmp/pa-forms-admin-${width}.png`, fullPage: true });

  // THE CLIENT'S SIDE, which is the claim that actually matters.
  const client = await ctx.newPage();
  await client.goto(`${P}/case.html?id=${CASE}&demo=1`, { waitUntil: 'networkidle' });
  await client.waitForTimeout(2500);
  // THE TAB IS AN <a data-page>, AND THE PANE HAS TO BE ON SCREEN. Every pane
  // is built at mount and merely hidden, so a drive that hunts for a button by
  // its words finds nothing, reads a hidden pane and prints ok on a screen the
  // client is not looking at. That is a drive proving nothing. The tab is
  // 'docs' (titled "Docs": three pills have to fit across a 390px phone), and
  // the visibility of the pane is asserted before a single row is read.
  const shown = await client.evaluate(async () => {
    document.querySelector('[data-page="docs"]')?.click();
    await new Promise((r) => setTimeout(r, 2500));
    // `.filelist[data-files]`, NOT `.filelist`: the Progress page carries a
    // second list of the same class ("What is kept in this file"), it comes
    // first in the DOM, and reading it meant every row assertion below was
    // reading the wrong page's summary while the Documents pane stayed shut.
    const pane = document.querySelector('.filelist[data-files]')?.closest('.fpage');
    return !!pane && pane.hidden === false;
  });
  ok('the client\'s Documents tab is one tap away, and it is actually on screen', shown);
  const docs = await client.evaluate(async () => {
    return [...document.querySelectorAll('.filelist[data-files] li')].map((li) => ({
      pill: li.querySelector('.kind-pill')?.textContent.trim() || '',
      cls: li.querySelector('.kind-pill')?.className || '',
      name: li.querySelector('a')?.textContent.trim() || '',
      href: li.querySelector('a')?.getAttribute('href') || '',
    }));
  });
  const mine = docs.filter((r) => r.pill === 'FORM SENT');
  ok('the client sees all four, every one labelled FORM SENT', mine.length === 4,
    `${mine.length}: ${docs.map((r) => `${r.pill}/${r.name}`).join(', ')}`);
  ok('and the pill is painted by the formsent rule, not by the report rule',
    mine.every((r) => /formsent/.test(r.cls)), mine.map((r) => r.cls).join(' | '));
  ok('the names on their screen are the form and the date',
    mine.every((r) => /^(Records authorisation|Insurance representative) \d{4}-\d{2}-\d{2}\.html$/
      .test(r.name)), mine.map((r) => r.name).join(', '));
  ok('and every one of them is openable', mine.every((r) => r.href.length > 0));

  // They are HIS documents. A long-press must offer nothing.
  const deletable = await client.evaluate(() => {
    const li = [...document.querySelectorAll('.filelist[data-files] li')]
      .find((x) => /FORM SENT/.test(x.textContent || ''));
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

  await client.screenshot({ path: `/tmp/pa-forms-client-${width}.png`, fullPage: true });
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

await b.close();
console.log(`\n${pass} ok, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
