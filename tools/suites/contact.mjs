// contact.mjs - the client's phone and home address on the overview card,
// collected at booking; and the pencil on every work log entry.
//
// Eric, 2026-09-03: "patient's home address and telephone number should be
// visible on this screen by the rest of his info" and "Edit pencil top right
// of each log. I misspelled his name, for example, so need to edit to fix
// that."
//
// The Worker's cleaners and the contact branch of handleCaseUpdate are lifted
// and RUN; contactBits is lifted out of the admin page and run; the rest are
// pins on the shipped source, because a booking form and a Stripe metadata
// block are not runnable here. The pencil's run test lives in worklog.mjs
// (L63-L66), beside the harness that already drives that route.
import { readFileSync } from 'node:fs';
import { dirname as d, join as j } from 'node:path';
import { fileURLToPath as f2, pathToFileURL } from 'node:url';

const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
// Who works a case (2026-10-15): the real check, so the lifted route runs it.
const STAFF = await import(pathToFileURL(j(ROOT, 'worker/staff.js')).href);
const WORKER = f('worker/index.js');
const ADMIN = f('public/js/admin-case.js');
const BOOK = f('public/js/book.js');
const DEMO = f('public/js/demo/api.js');
const CHANGELOG = f('public/js/changelog.js');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};

/** A function lifted whole by counting braces from its opening one. */
function lift(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) return '';
  let depth = 0;
  for (let i = src.indexOf('{', start + decl.length - 1); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}
const grab = (src, re) => (src.match(re) || [''])[0];

// ---- lifts ----
const phoneRe = grab(WORKER, /const PHONE_RE = \/[^\n]*\/;/);
const cleanPhoneSrc = grab(WORKER, /const cleanPhone = \(v\) => \([\s\S]*?: ''\);/);
const cleanAddressSrc = grab(WORKER, /const cleanAddress = \(v\) => \([\s\S]*?: ''\);/);
const routeSrc = lift(WORKER, 'async function handleCaseUpdate(request, env) {');
const escSrc = lift(ADMIN, 'function esc(s) {');
const bitsSrc = lift(ADMIN, 'function contactBits(phone, address) {');

// NEGATIVE CONTROL (run 2026-09-03): renaming cleanAddress in the Worker made this read
//   FAIL  K1 the cleaners, the number rule, the route and the card's link maker lift out of the shipped code  -- cleanAddress
check('K1 the cleaners, the number rule, the route and the card\'s link maker lift out of the shipped code',
  !!phoneRe && !!cleanPhoneSrc && !!cleanAddressSrc && !!routeSrc && !!escSrc && !!bitsSrc,
  [!phoneRe && 'PHONE_RE', !cleanPhoneSrc && 'cleanPhone', !cleanAddressSrc && 'cleanAddress',
    !routeSrc && 'handleCaseUpdate', !escSrc && 'esc', !bitsSrc && 'contactBits'].filter(Boolean).join(', '));

// eslint-disable-next-line no-new-func
const tools = new Function(`${phoneRe}\n${cleanPhoneSrc}\n${cleanAddressSrc}\nreturn { PHONE_RE, cleanPhone, cleanAddress };`)();
// NEGATIVE CONTROL (run 2026-09-03): dropping the control-character strip from cleanPhone made this read
//   FAIL  K2 a phone is kept as typed minus control characters; the rule takes a real number and refuses words
check('K2 a phone is kept as typed minus control characters; the rule takes a real number and refuses words',
  tools.cleanPhone('\u0000+1 (208)\t555 0142\u001f') === '+1 (208) 555 0142'
  && tools.PHONE_RE.test('+1 208 555 0142') && !tools.PHONE_RE.test('call me')
  && tools.cleanPhone(5551234) === '',
  JSON.stringify(tools.cleanPhone('\u0000+1 (208)\t555 0142\u001f')));
// NEGATIVE CONTROL (run 2026-09-03): the address cap set to 400 made this read
//   FAIL  K3 an address is one line, 300 characters at most, and a non-string is nothing
check('K3 an address is one line, 300 characters at most, and a non-string is nothing',
  tools.cleanAddress('418 Hawthorne Ave\nBoise, ID  83702') === '418 Hawthorne Ave Boise, ID 83702'
  && tools.cleanAddress('x'.repeat(301)).length === 300 && tools.cleanAddress({}) === '');

// ---- the route, running ----
const run = (caseData = { clientUid: 'client1', clientName: 'Dana Reyes' }, admin = true) => {
  const written = [];
  const deps = {
    requireAdmin: async () => (admin ? { uid: 'eric' } : null),
    requireStaff: async () => (admin ? { uid: 'eric', isAdmin: true, advocateId: 'eric' } : null),
    staffSees: STAFF.staffSees,
    json: (obj, code = 200) => ({ code, obj }),
    getDoc: async (env, path) => (path === 'cases/c1' ? { id: 'c1', data: caseData } : null),
    patchDoc: async (env, path, data, opts) => { written.push({ path, data, opts }); return true; },
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('deps', `
    const { requireAdmin, requireStaff, staffSees, json, getDoc, patchDoc } = deps;
    ${phoneRe}
    ${cleanPhoneSrc}
    ${cleanAddressSrc}
    ${routeSrc}
    return handleCaseUpdate;
  `)(deps);
  return { post: (b) => fn({ json: async () => b }, {}), written };
};

const A = run();
const okReply = await A.post({
  caseId: 'c1', action: 'contact', phone: ' +1 208 555 0142 ', address: ' 418 Hawthorne Ave, Boise, ID 83702 ',
});
// NEGATIVE CONTROL (run 2026-09-03): adding clientEmail to the contact branch's mask made this read
//   FAIL  K4 the contact edit writes the two fields and nothing else, under a mask that names exactly them
check('K4 the contact edit writes the two fields and nothing else, under a mask that names exactly them',
  okReply.code === 200 && okReply.obj.ok === true
  && A.written.length === 1 && A.written[0].path === 'cases/c1'
  && Object.keys(A.written[0].data).sort().join(',') === 'clientAddress,clientPhone'
  && A.written[0].data.clientPhone === '+1 208 555 0142'
  && A.written[0].data.clientAddress === '418 Hawthorne Ave, Boise, ID 83702'
  && (A.written[0].opts?.mask || []).slice().sort().join(',') === 'clientAddress,clientPhone'
  && okReply.obj.phone === '+1 208 555 0142' && okReply.obj.address === '418 Hawthorne Ave, Boise, ID 83702',
  JSON.stringify(A.written[0] || okReply));
const B = run();
const clearReply = await B.post({ caseId: 'c1', action: 'contact', phone: '', address: 'Somewhere' });
// NEGATIVE CONTROL (run 2026-09-03): writing `clientPhone: phone` (no `|| null`) made this read
//   FAIL  K5 an empty field clears the value to null rather than keeping a stale one
check('K5 an empty field clears the value to null rather than keeping a stale one',
  clearReply.code === 200 && B.written[0]?.data.clientPhone === null && B.written[0]?.data.clientAddress === 'Somewhere',
  JSON.stringify(B.written[0]?.data));
const C = run();
const badReply = await C.post({ caseId: 'c1', action: 'contact', phone: 'call me maybe', address: 'x' });
// NEGATIVE CONTROL (run 2026-09-03): removing the PHONE_RE refusal from the contact branch made this read
//   FAIL  K6 a phone that is not one is refused, and nothing is written
check('K6 a phone that is not one is refused, and nothing is written',
  badReply.code === 400 && C.written.length === 0, `${badReply.code} ${JSON.stringify(badReply.obj)}`);
const S = run(undefined, false);
const strangerReply = await S.post({ caseId: 'c1', action: 'contact', phone: '+1 208 555 0142', address: 'x' });
check('K7 a stranger gets the site\'s 404 and writes nothing',
  strangerReply.code === 404 && S.written.length === 0, `${strangerReply.code}`);

// ---- booking, pinned on the source ----
const checkoutBody = WORKER.slice(
  WORKER.indexOf('async function handleCheckout(request, env) {'),
  WORKER.indexOf('async function checkoutRequestedTime(env, o) {'),
);
// NEGATIVE CONTROL (run 2026-09-03): restoring `method === 'phone' &&` in front of the checkout refusal made this read
//   FAIL  K8 booking asks for the number whatever the method, and the address rides in both Stripe metadata blocks
check('K8 booking asks for the number whatever the method, and the address rides in both Stripe metadata blocks',
  /if \(!PHONE_RE\.test\(cleanPhone\(phone\)\)\)/.test(checkoutBody)
  && !/method === 'phone' &&/.test(checkoutBody)
  && /slotId,\n\s+method,\n\s+phone: cleanPhone\(phone\),\n\s+address,/.test(WORKER)
  && /slotId: '',\n\s+requestedStart: start\.toISOString\(\),\n\s+method,\n\s+phone: cleanPhone\(phone\),\n\s+address: cleanAddress\(o\.body\?\.address\),/.test(WORKER));
// NEGATIVE CONTROL (run 2026-09-03): dropping clientAddress from createCaseFromSession made this read
//   FAIL  K9 the webhook copies both onto the new case, beside the name and date of birth
check('K9 the webhook copies both onto the new case, beside the name and date of birth',
  /clientDob: m\.dob \|\| null,\n\s+clientTz: m\.tz \|\| null,[\s\S]{0,300}clientPhone: m\.phone \|\| null,\n\s+clientAddress: m\.address \|\| null,/.test(WORKER));
// NEGATIVE CONTROL (run 2026-09-03): restoring the `hidden` toggle on #phone-row in book.js made this read
//   FAIL  K10 the booking page asks every client for the number and offers the address line, and sends both
check('K10 the booking page asks every client for the number and offers the address line, and sends both',
  !/#phone-row'\)\.hidden/.test(BOOK)
  && /<div id="phone-row">/.test(BOOK)
  && /id="address" maxlength="300"/.test(BOOK)
  && /address: state\.address,/.test(BOOK)
  && /state\.phone = el\.querySelector\('#phone'\)\.value\.trim\(\);\n\s+if \(!\/\^\\\+\?/.test(BOOK)
  && !/if \(state\.method === 'phone'\) \{\n\s+state\.phone/.test(BOOK));

// ---- the card, running ----
// eslint-disable-next-line no-new-func
const bits = new Function(`${escSrc}\n${bitsSrc}\nreturn contactBits;`)();
const full = bits('+1 (208) 555-0142', '418 Hawthorne Ave, Boise, ID 83702');
const none = bits('', '');
// NEGATIVE CONTROL (run 2026-09-03): the tel href built from the phone as typed (no digit strip) made this read
//   FAIL  K11 the number is a tap-to-call link with the digits alone in the href, and the address opens in Maps
check('K11 the number is a tap-to-call link with the digits alone in the href, and the address opens in Maps',
  /^<a href="tel:\+12085550142" data-contact-phone>📞 \+1 \(208\) 555-0142<\/a>$/.test(full.phone)
  && /^<a href="https:\/\/maps\.apple\.com\/\?q=418%20Hawthorne%20Ave%2C%20Boise%2C%20ID%2083702" target="_blank" rel="noopener" data-contact-address>📍 418 Hawthorne Ave, Boise, ID 83702<\/a>$/.test(full.address),
  `${full.phone} | ${full.address}`);
check('K12 a missing value says so rather than leaving a blank, and is no link',
  /no number on file/.test(none.phone) && /no address on file/.test(none.address) && !/<a /.test(none.phone + none.address));
const hostile = bits('<b>1</b>', '"><script>x</script>');
// NEGATIVE CONTROL (run 2026-09-03): the address label emitted raw (no esc) made this read
//   FAIL  K13 what he typed is escaped on the way into the card
check('K13 what he typed is escaped on the way into the card',
  !/<b>/.test(hostile.phone) && !/<script>/.test(hostile.address) && !/"><script/.test(hostile.address), hostile.address);
// NEGATIVE CONTROL (run 2026-09-03): the CONTACT row's fallback to appointment.phone removed made this read
//   FAIL  K14 the overview paints a CONTACT row from contactBits, with the Edit that saves through case-update
check('K14 the overview paints a CONTACT row from contactBits, with the Edit that saves through case-update',
  /row\('CONTACT', `\$\{bits\.phone\}/.test(ADMIN)
  && /const contactPhone = c\.clientPhone \|\| c\.appointment\?\.phone \|\| '';/.test(ADMIN)
  && /data-contact-edit/.test(ADMIN) && /data-contact-save/.test(ADMIN)
  && /api\(\{ action: 'contact', phone: g\('phone'\), address: g\('address'\) \}\)/.test(ADMIN)
  && /ph\.outerHTML = bits\.phone/.test(ADMIN));

// ---- the pencil, pinned; run in worklog.mjs ----
const logRow = grab(ADMIN, /<span class="log-row">[\s\S]*?<\/span><\/summary>/);
// NEGATIVE CONTROL (run 2026-09-03): the pencil moved after the badge in the row made this read
//   FAIL  K15 the pencil sits in the entry's summary row, before the badge that takes the next line
check('K15 the pencil sits in the entry\'s summary row, before the badge that takes the next line',
  /data-call-edit="\$\{esc\(i\.id\)\}"/.test(logRow)
  && logRow.indexOf('data-call-edit=') < logRow.indexOf('class="log-seen')
  && /log-edit/.test(logRow), logRow ? '' : 'no log row');
// NEGATIVE CONTROL (run 2026-09-03): removing e.stopPropagation() from the pencil's handler made this read
//   FAIL  K16 the pencil's tap opens the entry instead of folding it, and the form carries the five fields
check('K16 the pencil\'s tap opens the entry instead of folding it, and the form carries the five fields',
  /e\.preventDefault\(\);\n\s+e\.stopPropagation\(\);\n\s+const d = b\.closest\('details'\);\n\s+if \(d\) d\.open = true;/.test(ADMIN)
  && ['kind', 'clinic', 'at', 'phone', 'parties'].every((n) => new RegExp(`data-e="${n}"`).test(ADMIN))
  && /action: 'edit', id: b\.dataset\.callEditSave, kind: g\('kind'\), clinic: g\('clinic'\)/.test(ADMIN));
const editBranch = grab(WORKER, /if \(body\?\.action === 'edit'\) \{[\s\S]*?\n  \}/);
// NEGATIVE CONTROL (run 2026-09-03): adding 'summary' to the edit branch's mask made this read
//   FAIL  K17 the Worker's edit branch masks the five fields, their stamps and the time; never the notes or the client line; and sends nothing
check('K17 the Worker\'s edit branch masks the five fields, their stamps and the time; never the notes or the client line; and sends nothing',
  editBranch.length > 0
  && /mask: \['clinic', 'phone', 'parties', 'kind', 'kindLabel', 'kindColor', 'at', 'editedAt'\]/.test(editBranch)
  && !/notifyUser/.test(editBranch) && !/logKindTold: /.test(editBranch)
  && !/summary/.test(editBranch.replace(/\/\/[^\n]*/g, '')) && !/notes: /.test(editBranch)
  && /if \(!row\) return json\(\{ error: 'That entry is gone\.' \}, 404\);/.test(editBranch));
check('K18 the demo mirrors the contact edit, the correction, and a booking that carries both',
  /body\.action === 'contact'/.test(DEMO) && /body\.action === 'edit'/.test(DEMO)
  && /clientPhone: body\.phone \|\| null,/.test(DEMO)
  && /if \(!cur\) return fail\(404, 'That entry is gone\.'\);/.test(DEMO));

// ---- copy ----
const newCopy = [
  grab(BOOK, /<div id="phone-row">[\s\S]*?<\/div>\n\s+<div id="address-row">[\s\S]*?<\/div>/),
  bitsSrc,
  grab(ADMIN, /row\('CONTACT'[\s\S]*?`\);/),
  grab(ADMIN, /<div class="log-edit-form"[\s\S]*?Save the correction<\/button><\/p>\n\s+<\/div>/),
  grab(CHANGELOG, /version: '2\.80',[\s\S]*?\n  \},/),
  editBranch,
  grab(WORKER, /\} else if \(action === 'contact'\) \{[\s\S]*?\} else if \(action === 'set-paid'\)/),
];
// NEGATIVE CONTROL (run 2026-09-03): an em dash typed into the address line's note made this read
//   FAIL  K19 not one em or en dash in anything new
check('K19 not one em or en dash in anything new',
  newCopy.every((s) => s && !/[–—]/.test(s)),
  newCopy.map((s, i) => (s ? (/[–—]/.test(s) ? `slice ${i} has a dash` : '') : `slice ${i} empty`)).filter(Boolean).join(', '));
// The two VERSION copies agree, and the 2.80 entry says to a client only what
// a client meets: the booking form. Not the exact number, which the next
// push moves (personal.mjs G5 learned that the hard way the same day).
check('K20 the version moves in both places together, and the client line names only the booking form',
  (WORKER.match(/\nconst VERSION = '([\d.]+)';/) || [])[1] === (CHANGELOG.match(/export const VERSION = '([\d.]+)';/) || [])[1]
  && /version: '2\.80',\n\s+quiet: true,\n\s+client: \[\n\s+'Booking asks for the best number to reach you/.test(CHANGELOG)
  && !/client: \[[^\]]*(overview|pencil|work log)/i.test(grab(CHANGELOG, /version: '2\.80',[\s\S]*?\n  \},/)));

const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exit(1);
