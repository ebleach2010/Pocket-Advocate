// The copy deck: ALL of it.
//
// Born as the booking deck ("provide me the full copy for everything booking
// side in a pdf in case I want to change anything. Format it properly with
// labeled headers and descriptors of what the copy is and where it's
// located.") and widened on 2026-08-29 ("deliver me a formatted PDF of all
// the copy in the same fashion you have before for me to make changes"):
// every marketing page, the case page, the agreements a client acknowledges,
// the documents they sign, the "?" sheets, every email and every push.
//
// Every entry carries four things: what it is, where it lives (file:line),
// when a client sees it, and the copy itself, set in a face that separates his
// words from my labels so his edits are unambiguous.
//
// Extraction is from the real files, so the deck cannot drift from what ships.
//
//   node tools/copy-deck.mjs        (needs playwright-core on the path)
//
// Not in public/, so it is never served.
import fs from 'fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// THE TREE THIS SCRIPT LIVES IN, not a hardcoded one.
//
// It used to read a fixed /workspace/pocket-advocate. Run from a git worktree
// - which is how every branch is now checked out - it silently produced a
// deck of a DIFFERENT branch's copy: the labels, the file:line references and
// the words themselves would all describe code Eric was not looking at, and
// nothing about the output would say so. A copy deck that quietly documents
// the wrong tree is worse than no copy deck.
//
// PA_ROOT still overrides, for generating a deck of some other checkout on
// purpose.
const R = process.env.PA_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(`${R}/${f}`, 'utf8');
const lines = (f) => read(f).split('\n');

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** Where a piece of text lives, by searching for it. */
function at(file, needle) {
  const ls = lines(file);
  const i = ls.findIndex((l) => l.includes(needle));
  return i < 0 ? file : `${file}:${i + 1}`;
}

/** Visible text out of an HTML fragment, tags stripped, whitespace normalised. */
function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

// ---------------------------------------------------------------- the pages

/** Headings and paragraphs from an HTML page, in document order. */
function pageCopy(file) {
  const src = read(file);
  const ls = src.split('\n');
  const out = [];
  const re = /<(h1|h2|h3|h4|p|li|button|summary|a class="btn[^"]*")\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(src))) {
    const text = textOf(m[2]);
    if (!text || text.length < 3) continue;
    const upto = src.slice(0, m.index).split('\n').length;
    out.push({ tag: m[1].split(' ')[0].toLowerCase(), text, line: upto });
  }
  // De-duplicate consecutive identical strings (nav links repeat).
  return out.filter((x, i) => i === 0 || x.text !== out[i - 1].text)
    .map((x) => ({ ...x, where: `${file}:${x.line}` }));
}

/** Strings a JS module renders, pulled out of its template literals. */
function jsCopy(file, { min = 25 } = {}) {
  const ls = lines(file);
  const out = [];
  ls.forEach((l, i) => {
    // Text between > and < inside a template literal, i.e. rendered copy.
    //
    // The naive version of this printed code at him. `if (a.getTime() >= cutoff
    // && b.getTime() <= horizon)` has a > and a <, so it captured
    // "= cutoff && start.getTime()" and put it in the deck as client-facing
    // copy to review. He reasonably wrote "REMOVE FROM CLIENT UI" beside it.
    // Nobody ever saw it; this file did.
    for (const m of l.matchAll(/>([^<>{}`$]{25,})</g)) {
      const t = m[1].replace(/\s+/g, ' ').trim();
      // The > that opened this has to be closing a tag, not half of >= or =>.
      const before = l[m.index - 1] || '';
      if ('=<>!-+*/%&|'.includes(before)) continue;
      // And what came out has to read like a sentence, not like an expression.
      if (/^[=|&.,)\]]/.test(t)) continue;
      if (/&&|\|\||=>|===|!==|;\s|\(\)|\.\w+\(/.test(t)) continue;
      if (t.split(/\s+/).filter((w) => /[a-z]{2}/i.test(w)).length < 4) continue;
      if (t.length >= min && /[a-z]{3}/i.test(t)) out.push({ text: t, where: `${file}:${i + 1}` });
    }
    // Whole-line quoted strings that read as sentences.
    for (const m of l.matchAll(/(?:^|[=:(,]\s*)'([^']{30,})'/g)) {
      const t = m[1].trim();
      if (/^[A-Z]/.test(t) && /[.?!]$/.test(t)) out.push({ text: t, where: `${file}:${i + 1}` });
    }
  });
  const seen = new Set();
  return out.filter((x) => (seen.has(x.text) ? false : seen.add(x.text)));
}

/** Every email the Worker sends: subject, body, and what triggers it. */
function emails() {
  const src = read('worker/index.js');
  const ls = src.split('\n');
  const out = [];
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(/subject:\s*[`'"](.+?)[`'"],\s*$/);
    if (!m) continue;
    // The body follows; take until the closing of the html template.
    let body = '';
    for (let j = i + 1; j < Math.min(i + 40, ls.length); j++) {
      body += `${ls[j]}\n`;
      if (/^\s*\}\);?\s*$/.test(ls[j])) break;
    }
    const to = (ls.slice(Math.max(0, i - 3), i).join(' ').match(/to:\s*([^,]+),/) || [, '?'])[1].trim();
    out.push({
      subject: m[1],
      to: /ADMIN_EMAIL/.test(to) ? 'Eric' : 'the client',
      body: textOf(body.replace(/^\s*html:\s*`/m, '')).replace(/`,?\s*\}\);?$/, ''),
      where: `worker/index.js:${i + 1}`,
    });
  }
  return out;
}

// ------------------------------------------------------------ the em dashes

/**
 * He told me em dashes are an AI giveaway and the advisor must never use one.
 * His own copy is full of them. Counted here so he can decide in one pass,
 * with client-facing copy separated from code comments, because only the first
 * kind is read by anyone.
 */
function dashes() {
  const files = [
    'public/index.html', 'public/about.html', 'public/book.html', 'public/signin.html',
    'public/return.html', 'public/subscribe.html', 'public/case.html',
    'public/js/book.js', 'public/js/case.js', 'public/js/waivers.js',
    'public/js/subscribe.js', 'worker/index.js', 'worker/email.js',
  ];
  const out = [];
  for (const f of files) {
    let copy = 0;
    let comment = 0;
    const hits = [];
    lines(f).forEach((l, i) => {
      const n = (l.match(/[—–]/g) || []).length;
      if (!n) return;
      const isComment = /^\s*(\/\/|\*|\/\*)/.test(l);
      if (isComment) comment += n;
      else { copy += n; hits.push({ line: i + 1, text: l.trim().slice(0, 150) }); }
    });
    if (copy || comment) out.push({ file: f, copy, comment, hits: hits.slice(0, 8) });
  }
  return out;
}

// ------------------------------------------------------------------ the deck

const W = (s) => `<div class="copy">${esc(s)}</div>`;

const entry = (what, where, when, copy) => `
  <div class="entry">
    <div class="meta">
      <span class="what">${esc(what)}</span>
      <span class="where">${esc(where)}</span>
    </div>
    <div class="when">${esc(when)}</div>
    ${Array.isArray(copy) ? copy.map(W).join('') : W(copy)}
  </div>`;

const section = (n, title, blurb, body) => `
  <section class="sec">
    <h2><span class="num">${n}</span>${esc(title)}</h2>
    <p class="blurb">${esc(blurb)}</p>
    ${body}
  </section>`;

function pageSection(n, title, file, blurb, when) {
  const rows = pageCopy(file);
  return section(n, title, blurb, rows.map((r) =>
    entry(`${r.tag}`, r.where, when, r.text)).join(''));
}

const WAIVERS = (() => {
  const src = read('public/js/waivers.js');
  const out = [];
  const re = /\{\s*id:\s*'([^']+)',\s*title:\s*'([^']+)',\s*body:\s*`([\s\S]*?)`\s*,?\s*\}/g;
  let m;
  while ((m = re.exec(src))) {
    out.push({
      id: m[1],
      title: m[2],
      body: textOf(m[3]),
      where: at('public/js/waivers.js', `id: '${m[1]}'`),
    });
  }
  return out;
})();

/** Every push notification body the Worker sends. */
function pushes() {
  const src = read('worker/index.js');
  const ls = src.split('\n');
  const out = [];
  ls.forEach((l, i) => {
    const m = l.match(/body:\s*[`'"]([^`'"]{18,220})[`'"]/);
    if (!m) return;
    // Near a notifyUser call, not an email html body or a fetch payload.
    const around = ls.slice(Math.max(0, i - 6), i + 1).join(' ');
    if (!/notifyUser\(/.test(around)) return;
    out.push({ text: m[1].replace(/\$\{[^}]*\}/g, '[...]'), where: `worker/index.js:${i + 1}` });
  });
  // The one-per-category status lines live in their own map.
  const wl = src.match(/const WORK_LOG_NOTICES = \{[\s\S]*?\};/);
  if (wl) {
    const base = src.slice(0, src.indexOf(wl[0])).split('\n').length;
    for (const m of wl[0].matchAll(/(\w+): '([^']+)'/g))
      out.push({ text: `[Your advocate] ${m[2]}`, where: `worker/index.js:${base}` });
  }
  const seen = new Set();
  return out.filter((x) => (seen.has(x.text) ? false : seen.add(x.text)));
}

/** The two case-page agreements, whole, and the two documents clients sign. */
const CASE_AGREEMENTS = await (async () => {
  const out = [];
  try {
    const { FULL_ACCESS_TERMS } = await import(`${R}/public/js/tier-terms.js`);
    out.push({ title: FULL_ACCESS_TERMS.title, body: textOf(FULL_ACCESS_TERMS.body),
      where: 'public/js/tier-terms.js',
      when: 'Acknowledged before Hands-Off Case Management is bought, and readable from the case page after.' });
  } catch { /* keep the deck alive */ }
  try {
    const { SERVICE_TERMS } = await import(`${R}/public/js/service-terms.js`);
    out.push({ title: SERVICE_TERMS.title, body: textOf(SERVICE_TERMS.body),
      where: 'public/js/service-terms.js',
      when: 'Shown on every case page under How this service runs.' });
  } catch { /* keep the deck alive */ }
  try {
    const A = await import(`${R}/public/js/authority.js`);
    const o = { clientName: '[CLIENT NAME]', clientDob: '[DOB]', advocateName: 'Eric Bleach', blank: true };
    out.push({ title: 'Scope of work agreement (the document itself)',
      body: A.scopeOfWork({ clientName: '[CLIENT NAME]', blank: true }),
      where: 'public/js/authority.js',
      when: 'Signed on the case page when Hands-Off opens by hand; the one document the app itself signs (Eric, 2026-08-29).' });
    out.push({ title: 'Records authorisation (the document itself)',
      body: A.recordsAuthorisation(o), where: 'public/js/authority.js',
      when: 'Sent by hand from the case page, signed outside the app; placeholders shown in brackets.' });
    out.push({ title: 'Insurance representative designation (the document itself)',
      body: A.representativeDesignation(o), where: 'public/js/authority.js',
      when: 'Sent by hand from the case page, signed outside the app; placeholders shown in brackets.' });
  } catch { /* the two documents are optional in the deck, never worth failing it */ }
  return out;
})();

const ds = dashes();
const totalCopyDashes = ds.reduce((n, d) => n + d.copy, 0);

const html = `<!doctype html>
<meta charset="utf-8">
<title>Pocket Advocate, the copy deck</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  :root {
    --ink: #14181f;
    --dim: #6a7280;
    --rule: #d8dce3;
    --accent: #0b6e84;
    --paper: #fff;
    --copy-bg: #f6f4ef;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font: 10.5pt/1.5 "Helvetica Neue", Helvetica, Arial, sans-serif;
  }
  h1 { font-size: 22pt; margin: 0 0 .2rem; letter-spacing: -.01em; }
  .sub { color: var(--dim); font-size: 10pt; margin: 0 0 1.4rem; }
  .lead { font-size: 10.5pt; line-height: 1.6; margin: 0 0 1.6rem; max-width: 46em; }
  .sec { break-inside: auto; margin: 0 0 1.6rem; }
  h2 {
    font-size: 12.5pt; margin: 1.6rem 0 .3rem; padding-bottom: .25rem;
    border-bottom: 2px solid var(--accent);
    break-after: avoid;
  }
  h2 .num {
    display: inline-block; min-width: 1.6em;
    color: var(--accent); font-variant-numeric: tabular-nums;
  }
  .blurb { color: var(--dim); font-size: 9.5pt; margin: 0 0 .8rem; max-width: 44em; }
  .entry { break-inside: avoid; margin: 0 0 .7rem; padding-left: .6rem; border-left: 2px solid var(--rule); }
  .meta { display: flex; gap: .6rem; align-items: baseline; flex-wrap: wrap; }
  .what {
    font-size: 8pt; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
    color: var(--accent);
  }
  .where { font: 8pt ui-monospace, "SF Mono", Menlo, monospace; color: var(--dim); }
  .when { font-size: 8.5pt; color: var(--dim); font-style: italic; margin: .1rem 0 .3rem; }
  /* HIS WORDS. A different face, on tinted stock, so an edit is unambiguous. */
  .copy {
    font: 10.5pt/1.62 Georgia, "Times New Roman", serif;
    background: var(--copy-bg);
    padding: .45rem .6rem; margin: 0 0 .3rem;
    border-radius: 3px;
    white-space: pre-wrap;
  }
  .note {
    margin: 1rem 0; padding: .7rem .9rem;
    background: #fff8e6; border-left: 3px solid #d8a12a; border-radius: 3px;
    font-size: 9.5pt; line-height: 1.55;
  }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; margin: .5rem 0; }
  th, td { text-align: left; padding: .3rem .4rem; border-bottom: 1px solid var(--rule); }
  th { font-size: 8pt; text-transform: uppercase; letter-spacing: .08em; color: var(--dim); }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  code { font: 8.5pt ui-monospace, Menlo, monospace; }
  .toc { columns: 2; font-size: 9.5pt; color: var(--dim); margin: 0 0 1rem; }
  .toc div { break-inside: avoid; }
</style>

<h1>Pocket Advocate: all of the copy</h1>
<p class="sub">Every word a client reads from the landing page to the day their case closes.
  Generated from the source on ${new Date().toISOString().slice(0, 10)}.</p>

<p class="lead">Each entry says what the copy is, where it lives in the code, and when a client
  sees it. <strong>Your words are set in the serif face on tinted stock;</strong> everything in the
  sans-serif around them is a label. Mark up the serif and nothing is ambiguous.</p>

<div class="toc">
  <div>1. The landing page</div>
  <div>2. Services and pricing</div>
  <div>3. About</div>
  <div>4. Questions (FAQ)</div>
  <div>5. Reviews</div>
  <div>6. Contact</div>
  <div>7. Signing in</div>
  <div>8. Booking, step by step</div>
  <div>9. The booking agreements, in full</div>
  <div>10. The case-page agreements and the signed documents</div>
  <div>11. Your case page, everything a client reads</div>
  <div>12. The "?" answer sheets</div>
  <div>13. Priority Chat</div>
  <div>14. After payment</div>
  <div>15. Every email</div>
  <div>16. Every push notification</div>
  <div>17. Errors and empty states</div>
  <div>18. A finding: the dashes</div>
</div>

${pageSection(1, 'The landing page', 'public/index.html',
  'The first thing anyone sees. Everything here is read before they trust you.',
  'Before signing in, on the front page.')}

${pageSection(2, 'Services and pricing', 'public/services.html',
  'The three offers side by side. Where the prices and the promises live.',
  'Before signing in, from the nav and the landing page.')}

${pageSection(3, 'About', 'public/about.html',
  'Who you are and what you are not. Read by people deciding whether to book.',
  'Before signing in, from the nav.')}

${pageSection(4, 'Questions (FAQ)', 'public/faq.html',
  'The objections page. Read by the cautious, right before they decide.',
  'Before signing in, from the nav.')}

${pageSection(5, 'Reviews', 'public/reviews.html',
  'The wall of proof, and the page your Google reviews page is linked from.',
  'Before signing in, from the nav.')}

${pageSection(6, 'Contact', 'public/contact.html',
  'The phone number page.',
  'Before signing in, from the nav.')}

${pageSection(7, 'Signing in', 'public/signin.html',
  'The email-and-code screen. Short, and read while someone is already committed.',
  'On the way to booking, or coming back.')}

${section(8, 'Booking, step by step',
  'Three visible steps under a persistent rail. This is the copy that takes payment.',
  jsCopy('public/js/book.js').map((r) =>
    entry('booking', r.where, 'While booking, steps 1 to 3.', r.text)).join(''))}

${section(9, `The booking agreements, in full (${WAIVERS.length})`,
  'Verbatim. You have said these are settled, so they are here whole rather than summarised: nothing about them should be a surprise later. The first three are the booking agreements; the last is agreed on the subscribe screen instead.',
  WAIVERS.map((w, i) => entry(w.title, w.where,
    i < 3
      ? 'Step 2 of booking. Each has to be read to the end before it can be ticked.'
      : 'On the Priority Chat subscribe screen.',
    w.body)).join(''))}

${section(10, 'The case-page agreements, and the two documents clients sign',
  'The Hands-Off scope note, the running-of-the-service terms, and the two authority documents, whole. These changed most recently, so read them closest.',
  CASE_AGREEMENTS.map((a) => entry(a.title, a.where, a.when, a.body)).join(''))}

${section(11, 'Your case page, everything a client reads',
  'The app a paying client lives in: status lines, buttons, folds, the review card, the work log.',
  jsCopy('public/js/case.js').map((r) =>
    entry('case page', r.where, 'Signed in, on their own case.', r.text)).join(''))}

${section(12, 'The "?" answer sheets',
  'The little question-mark buttons and the sheets they open: hours, telehealth, the app itself.',
  jsCopy('public/js/help.js').map((r) =>
    entry('help sheet', r.where, 'When a client taps a "?" anywhere.', r.text)).join(''))}

${pageSection(14, 'After payment', 'public/return.html',
  'The screen that catches someone the moment their money has left.',
  'Immediately after Stripe, before the case page.')}

${section(13, 'Priority Chat',
  'The separate subscription. Sold on its own terms, and cancelled on them too.',
  [...jsCopy('public/js/subscribe.js'), ...pageCopy('public/subscribe.html').map((r) => ({ text: r.text, where: r.where }))]
    .map((r) => entry('subscription', r.where, 'On the subscribe page and in the manage screen.', r.text)).join(''))}

${section(15, 'Every email',
  `${emails().length} emails. Nobody reviews these because nobody sees them all at once, and several are read at the worst moment of someone's week.`,
  emails().map((e) => entry(`to ${e.to}`, e.where, 'Sent automatically.', [`SUBJECT: ${e.subject}`, e.body])).join(''))}

${section(16, 'Every push notification',
  'The one-line buzzes. Each is read on a lock screen with no context around it.',
  pushes().map((r) => entry('push', r.where, 'Sent automatically. Dynamic parts shown as [...].', r.text)).join(''))}

${section(17, 'Errors and empty states',
  'The copy nobody reviews, read exactly when something has gone wrong.',
  [...jsCopy('public/js/book.js'), ...jsCopy('public/js/case.js'), ...jsCopy('public/js/subscribe.js')]
    .filter((r) => /could|couldn|failed|error|sorry|try again|nothing|no |not /i.test(r.text))
    .slice(0, 40)
    .map((r) => entry('error / empty', r.where, 'When something fails or a list is empty.', r.text)).join(''))}

${section(18, 'A finding: the dashes',
  'You told me em dashes are an AI giveaway and that the advisor must never use one. Your own copy has ' + totalCopyDashes + ' of them. Code comments are separated out, because nobody reads those.',
  `<table>
     <tr><th>File</th><th class="n">In copy</th><th class="n">In comments</th></tr>
     ${ds.map((d) => `<tr><td><code>${esc(d.file)}</code></td><td class="n">${d.copy}</td><td class="n">${d.comment}</td></tr>`).join('')}
   </table>
   <div class="note"><strong>Three of them are email subject lines</strong>, which are the most
     visible strings in the whole product: they show in a notification, on a lock screen, and in
     an inbox list. If you want them gone, those three are worth doing first.</div>
   ${ds.filter((d) => d.copy).map((d) => `
     <div class="entry">
       <div class="meta"><span class="what">${esc(d.file)}</span><span class="where">${d.copy} in copy</span></div>
       ${d.hits.map((h) => `<div class="copy">${esc(`${h.line}: ${h.text}`)}</div>`).join('')}
     </div>`).join('')}`)}
`;

const OUT = process.argv[2] || '.';
fs.writeFileSync(`${OUT}/deck.html`, html);

// playwright-core is not a dependency of this repo — it is whatever happens to
// be on the machine running the tool. Take the full package if that is what is
// installed, and let PLAYWRIGHT_MODULE point at a copy somewhere else entirely.
// Failing on the import after the HTML is already written was a poor trade: the
// deck is the deliverable and the PDF is a rendering of it.
const load = async () => {
  const tries = [process.env.PLAYWRIGHT_MODULE, 'playwright-core', 'playwright'].filter(Boolean);
  for (const m of tries) {
    try { return await import(m); } catch { /* try the next one */ }
  }
  throw new Error(`no playwright module found (tried ${tries.join(', ')}); set PLAYWRIGHT_MODULE to a path`);
};
const { chromium } = await load();
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await b.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.pdf({
  path: `${OUT}/pocket-advocate-copy.pdf`,
  format: 'A4',
  printBackground: true,
  margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: '<div style="width:100%;font:8pt Helvetica;color:#8a8f98;padding:0 14mm;display:flex;justify-content:space-between;"><span>Pocket Advocate — booking copy</span><span class="pageNumber"></span></div>',
});
await b.close();

console.log(`emails: ${emails().length}`);
console.log(`agreements: ${WAIVERS.length}`);
console.log(`em/en dashes in client-facing copy: ${totalCopyDashes}`);
console.log(`written: ${OUT}/pocket-advocate-copy.pdf`);
