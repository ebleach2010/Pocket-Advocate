// The blindness audit: proves a client cannot learn that the advisor exists.
//
// Not in public/, so it is never served. Run it against a local Worker:
//
//   npx wrangler dev --port 8788 --local     # in one shell
//   node tools/blindness-audit.mjs           # in another
//
// or against a deployed preview:
//
//   node tools/blindness-audit.mjs https://<hash>-pocket-advocate.workers.dev
//
// WHY IT LOOKS LIKE THIS. The previous version passed while a client could
// read 57 mentions of the advisor in the stylesheet. It was wrong four ways,
// and each one is a rule here now:
//
//   it stripped comments before searching  →  there is no build step. The
//                                             comments ARE the served bytes.
//   it exempted chat.js and msg-actions.js →  chat.js held 19 of the leaks. A
//                                             runtime gate does not stop
//                                             devtools.
//   it never opened a .css file            →  one stylesheet served both roles.
//   it read the source tree                →  /js/advisor.js was a public URL
//                                             returning 200.
//
// So: fetch real URLs, as an anonymous visitor with no cookie, and search
// exactly what comes back.

import http from 'node:http';
import https from 'node:https';

const ORIGIN = (process.argv[2] || 'http://127.0.0.1:8788').replace(/\/$/, '');

// Terms that give the game away wherever they appear, including in a comment.
const HARD = [
  /advisor/i,
  /differential/i,
  /working diagnos/i,
  /dxOverride/i,
  /workingDx/i,
  /\bAI\b/,
  /artificial intelligence/i,
  /\bLLM\b/i,
  /language model/i,
  /\bClaude\b/i,
  /Anthropic/i,
  /\bOpus\b/i,
  /\bGPT\b/i,
  /chatbot/i,
  /system prompt/i,
  /machine.generated/i,
  /auto.generated/i,
  /\bthe model\b/i,
  /\ba model\b/i,
  /from a model/i,
];

// THE ONE ALLOWANCE (Eric, 2026-08-25, his order): the AI note-taking
// consent clause in service-terms.js names AI to the client on purpose —
// "There must be a clause that they accept to AI note taking during calls."
// Scoped as tightly as it will go: that one file, the \bAI\b pattern only,
// and counted per OCCURRENCE — a line carrying one allowed mention and one
// stray would otherwise be exempted wholesale, since the clause's whole
// paragraph is a single line of the served template literal. Returns how
// many mentions on the line are allowed, or 0 if ANY of them is not —
// nothing else may lean on this.
const ALLOWED = (pathname, re, line) => {
  if (pathname !== '/js/service-terms.js' || String(re) !== String(/\bAI\b/)) return 0;
  const total = (line.match(/\bAI\b/g) || []).length;
  const okd = (line.match(/AI (note[- ]taking|tool takes notes)/g) || []).length;
  return okd >= total ? total : 0;
};

// Internal identifiers. None of these belong in a file a client downloads, and
// unlike the words above they never appear in copy, so they can be matched
// bare without drowning the run in false positives.
//
// Note what is NOT here: a plain "diagnosis". Eric's own disclaimers say "not
// diagnosis, not treatment" and his help text says "an advocacy record, not a
// diagnosis" — sentences a client is meant to read. The leak was never the
// word on its own, it was "working diagnosis" and "differential", which are
// both matched above.
const CODE_ONLY = [
  /working diagnosis/i,
  /advisorStyle/,
  /runAnalysis|runDraft|runQuestion|runStyleDistill/,
  /pendingMedia|readFiles/,
  /\bqueueAnalysis\b/,
];

// Client pages, by the URL a browser actually lands on. Cloudflare's asset
// handling serves /about.html at /about and redirects the .html spelling, so
// these are the canonical forms.
const CLIENT_PAGES = [
  '/', '/about', '/book', '/case', '/chat', '/signin', '/subscribe',
  '/subscription', '/return', '/reviews',
  // 2026-08-26: the landing split into a real site. These three are new public
  // pages, and a public page this list does not name is a page nobody ever
  // checks for leaked admin language. Added in the same commit that creates
  // them, deliberately: the gap between "shipped" and "audited" is exactly
  // where a leak would sit unnoticed.
  '/services', '/faq', '/contact',
  // 2026-09-02: the free 15-minute call. A public page with a form on it, and
  // the first page a stranger is now sent to.
  '/fit',
];

// Reachable without any page linking to them.
const EXTRA = [
  '/manifest.webmanifest', '/push-sw.js', '/firebase-messaging-sw.js',
  '/_headers', '/_redirects', '/css/site.css',
];

// Must not be reachable without the admin cookie. Pages 404 exactly like a
// missing path (the 302-to-sign-in was an existence oracle, closed 2026-08-21);
// modules and the stylesheet 404, which is what a path that does not exist
// returns, so the gate does not confirm what is behind it.
const ADMIN_PAGES = [
  '/admin', '/admin.html', '/admin-case', '/admin-chats', '/admin-calendar',
  '/admin-availability', '/admin-dictionary',
];
const ADMIN_ASSETS = [
  '/js/admin.js', '/js/admin-case.js', '/js/admin-chats.js', '/js/admin-calendar.js',
  '/js/admin-availability.js', '/js/admin-dictionary.js', '/js/admin-settings.js',
  // Every admin- module in public/js belongs in this list, in the commit that
  // adds it. The gate in worker/index.js matches on the name and would have
  // caught these anyway; what the list is for is PROVING it did, so a change
  // to the gate's regex cannot quietly stop covering a module nobody thought
  // to re-check.
  '/js/admin-hours.js', '/js/admin-presence.js', '/js/admin-ledger.js',
  '/js/admin-fit.js',
  '/js/admin-personal.js',
  '/js/advisor.js', '/js/notes.js', '/js/duty.js', '/js/prep.js',
  '/js/drawer.js', '/js/seen.js', '/js/panel-bridge.js', '/css/admin.css',
  // The demo's fixtures are advisor output, so they are gated the same way. A
  // browser that never asked for the demo, which is what this audit is,
  // should not be able to read them either. suite.js is the demo's front
  // door and names the admin route by design — the host gate IS its
  // protection, so the audit asserts the gate holds.
  '/js/demo/store.js', '/js/demo/seed.js', '/js/demo/api.js', '/js/demo/banner.js',
  '/js/demo/suite.js',
];

let failures = 0;
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };
const cache = new Map();

async function get(path) {
  if (cache.has(path)) return cache.get(path);
  // AN ORIGIN THAT IS NOT THERE IS A FAILED AUDIT, NOT A CRASH. An unhandled
  // TypeError from fetch exits non-zero with a stack trace and no verdict,
  // which reads as "the tool is broken" rather than "nothing was checked".
  // Found 2026-08-28 pointing this at a port whose server had gone away.
  let res;
  try {
    res = await fetch(new URL(path, ORIGIN));
  } catch (e) {
    const rec = { status: 0, url: `${ORIGIN}${path}`, type: '', body: '',
      unreachable: `${e.cause?.code || e.message}` };
    cache.set(path, rec);
    return rec;
  }
  const type = res.headers.get('content-type') || '';
  // Only text is searchable. A PNG will match /\bAI\b/ by accident and mean
  // nothing by it.
  const textual = /text\/|javascript|json|xml|\+text/.test(type) || /\.(js|css|html|json|webmanifest)$/.test(path)
    || path === '/_headers' || path === '/_redirects';
  const rec = {
    status: res.status,
    url: res.url,
    type,
    body: res.ok && textual ? await res.text() : '',
    textual,
  };
  cache.set(path, rec);
  return rec;
}

function scan(path, rec) {
  const pathname = new URL(rec.url || path, ORIGIN).pathname;
  const isCode = /\.(js|css)$/.test(pathname);
  const terms = isCode ? [...HARD, ...CODE_ONLY] : HARD;
  const lines = rec.body.split('\n');
  const hits = [];
  let allowed = 0;
  for (const re of terms) {
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      const okd = ALLOWED(pathname, re, lines[i]);
      if (okd) { allowed += okd; continue; }
      hits.push({ re: String(re), n: i + 1, text: lines[i].trim().slice(0, 120) });
    }
  }
  // Say so every run: an allowance that runs silently stops being documented.
  if (allowed) console.log(`  note  ${path} — ${allowed} allowed mention${allowed === 1 ? '' : 's'} (the AI note-taking clause)`);
  if (hits.length) {
    fail(`${path} — ${hits.length} forbidden ${hits.length === 1 ? 'match' : 'matches'}`);
    for (const h of hits.slice(0, 8)) console.log(`        ${h.re} @${h.n}: ${h.text}`);
    if (hits.length > 8) console.log(`        …and ${hits.length - 8} more`);
  }
  return hits.length;
}

/** Static imports and tag references inside one file. Every matcher runs on
 *  every body: HTML pages carry inline <script type="module"> blocks whose
 *  import() calls the src/href matcher alone never followed, which is how a
 *  served file can dodge the crawl entirely. */
function referencesIn(text, isHtml) {
  const out = new Set();
  if (isHtml) for (const m of text.matchAll(/(?:src|href)="([^"]+)"/g)) out.add(m[1]);
  for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) out.add(m[1]);
  for (const m of text.matchAll(/import\(\s*['"]([^'"]+)['"]/g)) out.add(m[1]);
  return [...out];
}

function resolve(ref, fromUrl) {
  if (/^(https?:)?\/\//.test(ref) || /^(data|mailto|tel|blob):/.test(ref) || ref.startsWith('#')) return null;
  try {
    const u = new URL(ref, fromUrl);
    if (u.origin !== new URL(ORIGIN).origin) return null;
    return u.pathname;                     // cache-busts are the same file
  } catch { return null; }
}

console.log(`blindness audit — ${ORIGIN}\n`);

// ---- 0. THE SERVER IS SERVING THIS TREE ----------------------------------
//
// Added 2026-08-28, after an ALL CLEAR was reported against a Worker that
// turned out to belong to another worktree entirely. It answered on the port
// this was pointed at, it returned 200, and it served a DIFFERENT case.js:
// 127,900 bytes against this tree's 130,644, and /api/version naming a branch
// tag two releases old. The audit had no way to notice, so it scanned somebody
// else's bytes and pronounced them clean.
//
// A 200 on the origin proves a server answered. It does not prove it is YOUR
// server. This does: fetch a file a client is meant to read and compare it to
// the same file on disk, byte for byte.
//
// NOT AN ADMIN FILE. Probing /js/admin-case.js gives 404 by design, and
// reading that as a dead server is the same mistake pointed the other way.
// Client-readable only, and two of them, so a single stale cache entry cannot
// carry the check.
{
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
  console.log('0. the server under test is serving this working tree');
  let matched = 0;
  for (const rel of ['js/case.js', 'js/reviews-config.js']) {
    let disk = '';
    try { disk = readFileSync(join(REPO, 'public', rel), 'utf8'); } catch { /* not here */ }
    if (!disk) { fail(`public/${rel} is not on disk, so identity cannot be checked`); continue; }
    const rec = await get(`/${rel}`);
    if (rec.unreachable) fail(`nothing is answering at ${ORIGIN} (${rec.unreachable})`);
    else if (rec.status !== 200) fail(`/${rel} answered ${rec.status}, so identity cannot be checked`);
    else if (rec.body !== disk)
      // CHARACTERS, not bytes, and the label matters: these files carry emoji
      // and curly quotes, so `wc -c` on the same file reports ~96 more. The
      // comparison itself is the whole string, so it is exact either way; only
      // a mislabelled number sends the next reader hunting a phantom diff.
      fail(`/${rel} is not this tree: served ${rec.body.length} characters,`
        + ` on disk ${disk.length} (${Buffer.byteLength(disk)} bytes)`);
    else matched += 1;
  }
  if (matched === 2) console.log('  case.js and reviews-config.js match this tree byte for byte');
  if (failures) {
    console.log('\nSTOPPING. Whatever is on that port, it is not this tree, and a'
      + ' verdict about\nsomebody else\'s bytes is worse than no verdict at all.');
    process.exit(1);
  }
}

// ---- 1. every byte a client's browser downloads --------------------------
console.log('\n1. everything reachable from a client page');
const queue = [...CLIENT_PAGES, ...EXTRA];
const visited = new Set();
let files = 0;
let hits = 0;

while (queue.length) {
  const path = queue.shift();
  if (visited.has(path)) continue;
  visited.add(path);
  const rec = await get(path);
  if (rec.status !== 200) {
    if (CLIENT_PAGES.includes(path)) fail(`${path} — ${rec.status}, a client page must be reachable`);
    continue;
  }
  if (!rec.textual) continue;
  files++;
  hits += scan(path, rec);
  const isHtml = /html/.test(rec.type);
  for (const ref of referencesIn(rec.body, isHtml)) {
    const p = resolve(ref, rec.url || new URL(path, ORIGIN).href);
    if (p && !visited.has(p)) queue.push(p);
  }
}
console.log(`  ${files} text files scanned, ${hits} forbidden ${hits === 1 ? 'match' : 'matches'}`);

// ---- 2. the admin half, with no cookie -----------------------------------
console.log('\n2. the admin half, as a stranger');
// A STRANGER ON THE LIVE SITE, which is the only thing this section is about.
//
// Sent with the production Host header, because the Worker's DEMO_HOST regex
// deliberately treats localhost, 127.0.0.1 and *.workers.dev as demo hosts -
// so pointing this audit at a dev server and asking "is the demo gated?"
// answers a question nobody asked. Without the header, /js/demo/suite.js
// correctly answers 200 here and the audit called it a leak.
const LIVE_HOST = 'thepocketadvocates.com';
//
// Raw http, not fetch: `host` is a forbidden header name in the fetch spec
// and Node drops it silently, so the override looked applied and was not.
// This sends the real Host line while still connecting to ORIGIN.
const asStranger = (path) => new Promise((resolve, reject) => {
  const u = new URL(path, ORIGIN);
  const lib = u.protocol === 'https:' ? https : http;
  const req = lib.request({
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname + u.search,
    method: 'GET',
    headers: { host: LIVE_HOST },
    servername: u.hostname,
  }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { body += d; });
    res.on('end', () => resolve({ status: res.statusCode, text: async () => body }));
  });
  req.on('error', reject);
  req.end();
});
for (const path of ADMIN_PAGES) {
  const res = await asStranger(path);
  if (res.status !== 404) fail(`${path} — ${res.status}, expected the byte-identical 404`);
}
for (const path of ADMIN_ASSETS) {
  const res = await asStranger(path);
  if (res.status !== 404) fail(`${path} — ${res.status}, expected 404`);
  else {
    const body = await res.text();
    if (/advisor|differential/i.test(body)) fail(`${path} — 404 body leaks`);
  }
}
console.log(`  ${ADMIN_PAGES.length} pages redirect, ${ADMIN_ASSETS.length} assets 404`);

// A gate that bounces you onto a page that leaks is not a gate.
{
  const rec = await get('/signin');
  if (rec.status === 200) hits += scan('/signin (the redirect target)', rec);
}

// ---- 3. no model-derived field lands on a client-readable document -------
console.log('\n3. model-derived fields on documents a client can read');
{
  // The chat message document is the only shared one. `recap` was the breach.
  const chat = await get('/js/chat.js');
  if (chat.status !== 200) fail('/js/chat.js unreachable');
  else if (/recap/i.test(chat.body)) fail('/js/chat.js still renders a recap');
  else console.log('  chat.js renders nothing model-derived');
}

console.log(`\n${failures ? `${failures} FAILURE${failures === 1 ? '' : 'S'}` : 'ALL CLEAR'}`);
process.exit(failures ? 1 : 0);
