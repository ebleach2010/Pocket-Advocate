// release.mjs - the version on every push, and what outlived PR 420.
//
//   node tools/suites/release.mjs
//
// Eric, 2026-10-04: "Delete the trading desk folder and contents in code. I
// won't be using it." trade.mjs went with the desk, and it was the one suite
// that pinned the version on every push (its T36). That pin lives here now,
// with the three things trade.mjs proved that were never about trading: a
// blank system block never reaches the wire, the PDF writer the showcase
// files with makes a real PDF, and a leftover scan marker is never judged
// as a reading. And the desk itself is held gone: no file, no route, no
// cron hook, no diagnostic, no page, no demo, and the trading terms it
// saved stay out of every glossary and off the dictionary page.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath as f2 } from 'node:url';
import { dirname as d, join as j } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const has = (p) => existsSync(j(ROOT, p));
const W = f('worker/index.js');
const ADV = f('worker/advisor.js');
const CL = f('public/js/changelog.js');
const pdf = await import('../../public/js/textpdf.js');
const changelog = await import('../../public/js/changelog.js');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};
function lift(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) return '';
  let depth = 0;
  let inTpl = false;
  for (let i = src.indexOf('{', start + decl.length - 1); i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '`') { inTpl = !inTpl; continue; }
    if (inTpl) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}
const grab = (src, re) => (src.match(re) || [''])[0];
const DASH = /[\u2013\u2014]/;
const HARD = [/advisor/i, /differential/i, /\bAI\b/, /\bLLM\b/i, /language model/i, /\bClaude\b/i, /Anthropic/i, /\bOpus\b/i, /\bFable\b/i, /\bthe model\b/i, /\ba model\b/i, /chatbot/i];

// ---- R1: the versions and the words (was trade.mjs T36) ------------------------------------
// Every push to main bumps both copies of the version and the tag, and the newest entry is
// quiet, admin-only and clean. The desk's own entries (4.6 to 7.20) stay as history, every one
// of them quiet with an empty client list, so not one ever reached a client's notes.
// NEGATIVE CONTROL (run 2026-10-04): the worker's VERSION left at '7.20' made this read
//   FAIL  R1 both versions read 7.21 with the new tag, the 7.21 entry is quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
// RE-PINNED 2026-10-04 (v7.22): both versions read 7.22 with the fund-verify tag, and the 7.22 entry
// says what was built in his words; the 7.21 entry keeps its own.
// NEGATIVE CONTROL (run 2026-10-04): `quiet: true` taken off the 6.0 entry made this read
//   FAIL  R1 both versions read 7.21 with the new tag, the 7.21 entry is quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
{
  const entry721 = (CL.match(/\{\n\s+\/\/ PR 420 DELETED \(Eric, 2026-10-04[\s\S]*?\n  \},/) || [''])[0];
  const entry722 = (CL.match(/\{\n\s+\/\/ THE COMMUNITY ASSISTANCE FUND'S VERIFICATION \(Eric, 2026-10-04[\s\S]*?\n  \},/) || [''])[0];
  const num = (v) => v.split('.').map(Number);
  const atLeast = (v, w) => { const [a, b] = num(v); const [c, e] = num(w); return a > c || (a === c && b >= e); };
  const since46 = changelog.CHANGELOG.filter((e) => atLeast(e.version, '4.6'));
  // RE-PINNED 2026-10-04 (v7.24): both versions read 7.24 with the fund-payouts tag, and the 7.24 entry
  // says what the fund gained in his words; the 7.23 entry keeps its own.
  const entry724 = (CL.match(/\{\n\s+\/\/ THE FUND, PAID OUT \(Eric, 2026-10-04[\s\S]*?\n  \},/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-04, v7.24): the worker's BUILD_TAG left at the fund-landing tag made this read
  //   FAIL  R1 both versions read 7.24 with the new tag, the 7.24 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-04 (v7.23): both versions read 7.23 with the fund-landing tag, and the 7.23 entry
  // says the landing is the fund alone; the 7.22 entry keeps its own.
  const entry723 = (CL.match(/\{\n\s+\/\/ THE LANDING, IN ISOLATION \(Eric, 2026-10-04[\s\S]*?\n  \},/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-04, v7.23): the 7.23 entry's `client: [],` given a line made this read
  //   FAIL  R1 both versions read 7.23 with the new tag, the 7.23, 7.22 and 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // NEGATIVE CONTROL (run 2026-10-04, v7.22): the 7.22 entry's `quiet: true` taken off made this read
  //   FAIL  R1 both versions read 7.22 with the new tag, the 7.22 and 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-04 (v7.25): both versions read 7.25 with the fund-home tag, and the 7.25 entry
  // says the fund is home, the rest is parked in PR 1, the alerts, Christmas Eve and the monthly checks.
  const entry725 = (CL.match(/\{\n\s+\/\/ THE FUND IS HOME \(Eric, 2026-10-04[\s\S]*?\n  \},/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-04, v7.25): the worker's BUILD_TAG left at the fund-payouts tag made this read
  //   FAIL  R1 both versions read 7.25 with the new tag, the 7.25 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-04 (v7.26): both versions read 7.26 with the fund-totals tag, and the 7.26 entry
  // says the queue takes the GoFundMe and Zazzle totals and what his post added.
  const entry726 = (CL.match(/\{\n\s+\/\/ THE FUND'S TOTALS \(Eric, 2026-10-04[\s\S]*?\n  \},/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-04, v7.26): changelog.js's VERSION left at '7.25' made this read
  //   FAIL  R1 both versions read 7.26 with the new tag, the 7.26 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-04 (v7.27): both versions read 7.27 with the fund-jan1st tag; the 7.27 entry carries
  // his sentence word for word, and no fund entry says monthly payouts any more.
  const entry727 = (CL.match(/\{\n\s+\/\/ JANUARY 1ST \(Eric, 2026-10-04[\s\S]*?\n  \},/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-04, v7.27): the 7.25 entry's monthly line put back made this read
  //   FAIL  R1 both versions read 7.27 with the new tag, the 7.27 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-04 (v7.28): both versions read 7.28 with the fund-discord tag, and the 7.28 entry says
  // the Discord username is mandatory and its publication a required tick.
  const entry728 = (CL.match(/\{\n\s+\/\/ DISCORD IS MANDATORY \(Eric, 2026-10-04[\s\S]*?\n  \},/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-04, v7.28): the worker's VERSION left at '7.27' made this read
  //   FAIL  R1 both versions read 7.28 with the new tag, the 7.28 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-05 (v7.29): both versions read 7.29 with the fund-docrule tag, and the 7.29 entry says
  // the documents' rule and the two confirmations before Verify.
  const entry729 = (CL.match(/\{\n\s+\/\/ THE DOCUMENTS' RULE \(Eric, 2026-10-05[\s\S]*?\n  \},/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-05, v7.29): the worker's BUILD_TAG left at the fund-discord tag made this read
  //   FAIL  R1 both versions read 7.29 with the new tag, the 7.29 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-06 (v7.30): both versions read 7.30 with the advocacy-only tag, and the 7.30 entry says
  // PR 1 is the live site again, the fund is hidden with its data kept, and PR 420 stays deleted.
  const entry730 = (CL.match(/\{\n\s+\/\/ PATIENT ADVOCACY ONLY \(Eric, 2026-10-06[\s\S]*?\n  \},/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-06, v7.30): changelog.js's VERSION left at '7.29' made this read
  //   FAIL  R1 both versions read 7.30 with the new tag, the 7.30 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-10 (v7.31): both versions read 7.31 with the landing-black tag, and the 7.31 entry says
  // the landing is black with the options first, chat lit and always open, the other two greyed.
  const entry731 = (CL.match(/\{\n\s+\/\/ THE LANDING, BLACK, CHAT FIRST \(Eric, 2026-10-10[\s\S]*?\n  \},/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-10, v7.31): the worker's BUILD_TAG left at the advocacy-only tag made this read
  //   FAIL  R1 both versions read 7.31 with the new tag, the 7.31 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-11 (v7.32): both versions read 7.32 with the out-of-service tag, and the 7.32 entry says
  // his notice leads the landing and the chat line is greyed too.
  const entry732 = (CL.match(/\{\n\s+\/\/ OUT OF SERVICE \(Eric, 2026-10-11[\s\S]*?\n  \},/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-11, v7.32): changelog.js's VERSION left at '7.31' made this read
  //   FAIL  R1 both versions read 7.32 with the new tag, the 7.32 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-11 (v7.33): both versions read 7.33 with the semibold-type tag, and the 7.33 entry names
  // the two new faces.
  // NEGATIVE CONTROL (run 2026-10-11, v7.33): the worker's BUILD_TAG left at the out-of-service tag made this read
  //   FAIL  R1 both versions read 7.33 with the new tag, the 7.33 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  const entry733 = (CL.match(/\{\n\s+\/\/ SEMIBOLD TYPE \(Eric, 2026-10-11[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-10-12 (v7.34): both versions read 7.34 with the waitlist tag, and the 7.34 entry says
  // where the bubble is and where its people go.
  // NEGATIVE CONTROL (run 2026-10-12, v7.34): changelog.js's VERSION left at '7.33' made this read
  //   FAIL  R1 both versions read 7.34 with the new tag, the 7.34 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  const entry734 = (CL.match(/\{\n\s+\/\/ THE WAITLIST \(Eric, 2026-10-12[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-10-12 (v7.35): both versions read 7.35 with the sales-closed tag, and the 7.35 entry says
  // nothing can be bought, the free call is gone, and what /open does.
  // NEGATIVE CONTROL (run 2026-10-12, v7.35): the worker's BUILD_TAG left at the waitlist tag made this read
  //   FAIL  R1 both versions read 7.35 with the new tag, the 7.35 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-14 (v7.36): both versions read 7.36 with the chat-open-one-screen tag, and the 7.36 entry
  // says chat is open, the home is one screen, questions reach his inbox, and Leads exports a CSV.
  // NEGATIVE CONTROL (run 2026-10-14, v7.36): changelog.js's VERSION left at '7.35' made this read
  //   FAIL  R1 both versions read 7.36 with the new tag, the 7.36 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-15 (v7.37): both versions read 7.37 with the package-pages tag, and the 7.37 entry says
  // each package has its own page and shows only its own details.
  // NEGATIVE CONTROL (run 2026-10-15, v7.37): the worker's BUILD_TAG left at the chat-open-one-screen tag made this read
  //   FAIL  R1 both versions read 7.37 with the new tag, the 7.37 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-15 (v7.40): both versions read 7.40 with the two-weeks tag, and the 7.40 entry says the report
  // is due within 14 days everywhere and the stats sit in a pull-up tab on the home.
  // NEGATIVE CONTROL (run 2026-10-15, v7.40): the worker's BUILD_TAG left at the his-prices tag made this read
  //   FAIL  R1 both versions read 7.40 with the new tag, the 7.40 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-15 (v7.41): both versions read 7.41 with the-plus tag, and the 7.41 entry says what the + opens,
  // how a lead is scheduled and pays, where Delete is, and how the cards look by state.
  // NEGATIVE CONTROL (run 2026-10-15, v7.41): the worker's BUILD_TAG left at the two-weeks tag made this read
  //   FAIL  R1 both versions read 7.41 with the new tag, the 7.41 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-15 (v7.42): both versions read 7.42 with the preview tag, and the 7.42 entry says where Preview a
  // case is, that nothing in it leaves the browser, that Exit wipes it, and that the numbers tab is gone.
  // NEGATIVE CONTROL (run 2026-10-15, v7.42): changelog.js's VERSION left at '7.41' made this read
  //   FAIL  R1 both versions read 7.42 with the new tag, the 7.42 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-15 (v7.43): both versions read 7.43 with the advocates-ground tag, and the 7.43 entry says he is
  // advocate number one, everything he has is marked his, nothing moved, and every case action is checked on the server.
  // NEGATIVE CONTROL (run 2026-10-15, v7.43): the worker's BUILD_TAG left at the preview tag made this read
  //   FAIL  R1 both versions read 7.43 with the new tag, the 7.43 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-15 (v7.44): both versions read 7.44 with the advocate-accounts tag, and the 7.44 entry says what
  // the Advocates tab does, that advocates see their own clients only, where his card is, and that the locks publish themselves.
  // NEGATIVE CONTROL (run 2026-10-15, v7.44): the worker's BUILD_TAG left at the advocates-ground tag made this read
  //   FAIL  R1 both versions read 7.44 with the new tag, the 7.44 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-15 (v7.45): both versions read 7.45 with the warm-tour tag, and the 7.45 entry says the shelf is
  // tan again with its glow, the client side is warm with his photo, Progress celebrates, and the preview has its tour.
  // NEGATIVE CONTROL (run 2026-10-15, v7.45): changelog.js's VERSION left at '7.44' made this read
  //   FAIL  R1 both versions read 7.45 with the new tag, the 7.45 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-15 (v7.50): both versions read 7.50 with the his-face tag, and the 7.50 entry says where his
  // photo is, that Employer mode is green, and that he sets a contractor's photo and bio from their card.
  // NEGATIVE CONTROL (run 2026-10-15, v7.50): the worker's BUILD_TAG left at the payroll-paid tag made this read
  //   FAIL  R1 both versions read 7.50 with the new tag, the 7.50 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-16 (v7.55): both versions read 7.55 with the one-team tag, and the 7.55 entry says Advocates is in
  // Employer mode and Availability in the Calendar.
  // NEGATIVE CONTROL (run 2026-10-16, v7.55): changelog.js's VERSION left at '7.54' made this read
  //   FAIL  R1 both versions read 7.55 with the new tag, the 7.55 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-16 (v7.56): both versions read 7.56 with the four-audits tag, and the 7.56 entry says setup comes
  // first, a reset or turn-off signs them out, their clients see their name, and what security changed.
  // NEGATIVE CONTROL (run 2026-10-16, v7.56): the worker's BUILD_TAG left at the one-team tag made this read
  //   FAIL  R1 both versions read 7.56 with the new tag, the 7.56 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-16 (v7.57): both versions read 7.57 with the warm-default tag, and the 7.57 entry says warm is
  // the look everywhere and Blue and purple is in Settings.
  // NEGATIVE CONTROL (run 2026-10-16, v7.57): changelog.js's VERSION left at '7.56' made this read
  //   FAIL  R1 both versions read 7.57 with the new tag, the 7.57 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-16 (v7.58): both versions read 7.58 with the never-stuck tag, and the 7.58 entry says signing in
  // never just sits there and the logo takes him to the home page.
  // NEGATIVE CONTROL (run 2026-10-16, v7.58): the worker's BUILD_TAG left at the warm-default tag made this read
  //   FAIL  R1 both versions read 7.58 with the new tag, the 7.58 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-16 (v7.59): both versions read 7.59 with the oversee tag, and the 7.59 entry says 🗑 leaves
  // Removed by Eric and ⚕️ sends his message from him.
  // NEGATIVE CONTROL (run 2026-10-16, v7.59): changelog.js's VERSION left at '7.58' made this read
  //   FAIL  R1 both versions read 7.59 with the new tag, the 7.59 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-16 (v7.60): both versions read 7.60 with the fakes-off tag, and the 7.60 entry says the
  // invented clients are gone, Delete is on their folders and a real case is deleted from Settings.
  // NEGATIVE CONTROL (run 2026-10-16, v7.60): the worker's VERSION left at '7.59' made this read
  //   FAIL  R1 both versions read 7.60 with the new tag, the 7.60 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-16 (v7.61): both versions read 7.61 with the demo-mode tag, and the 7.61 entry says what Demo
  // mode is, what works in it, and the practice team on its payroll.
  // NEGATIVE CONTROL (run 2026-10-16, v7.61): the worker's BUILD_TAG left at the fakes-off tag made this read
  //   FAIL  R1 both versions read 7.61 with the new tag, the 7.61 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-17 (v7.62): both versions read 7.62 with the audit-fixes tag, and the 7.62 entry says payroll
  // names Full-Service, a Full-Service case stays so, what was fixed on phones, and what Demo mode keeps.
  // NEGATIVE CONTROL (run 2026-10-17, v7.62): the worker's BUILD_TAG left at the demo-mode tag made this read
  //   FAIL  R1 both versions read 7.62 with the new tag, the 7.62 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-17 (v7.63): both versions read 7.63 with the month-end tag, and the 7.63 entry says what
  // happens at a month's end, the ask after it, the pace flags and the hours.
  // NEGATIVE CONTROL (run 2026-10-17, v7.63): changelog.js's VERSION left at '7.62' made this read
  //   FAIL  R1 both versions read 7.63 with the new tag, the 7.63 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-17 (v7.65): both versions read 7.65 with the step-ups tag, and the 7.65 entry says the chat step
  // up, the upgrade's price, the add-ons and where they are set, the month's price, Log and the voice study.
  // NEGATIVE CONTROL (run 2026-10-17, v7.65): changelog.js's VERSION left at '7.64' made this read
  //   FAIL  R1 both versions read 7.65 with the new tag, the 7.65 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-17 (v7.66): both versions read 7.66 with the raised tag, and the 7.66 entry says the wheel is
  // gone, the three looks, and the raised buttons.
  // NEGATIVE CONTROL (run 2026-10-17, v7.66): the worker's BUILD_TAG left at the step-ups tag made this read
  //   FAIL  R1 both versions read 7.66 with the new tag, the 7.66 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-17 (v7.67): both versions read 7.67 with the leads-chat tag, and the 7.67 entry says his
  // name and the lead conversations.
  // NEGATIVE CONTROL (run 2026-10-17, v7.67): changelog.js's VERSION left at '7.66' made this read
  //   FAIL  R1 both versions read 7.67 with the new tag, the 7.67 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-17 (v7.68): both versions read 7.68 with the add-wizard tag, and the 7.68 entry says the pages,
  // the switches and prices, the hours, the bank numbers and the photo.
  // NEGATIVE CONTROL (run 2026-10-17, v7.68): the worker's BUILD_TAG left at the leads-chat tag made this read
  //   FAIL  R1 both versions read 7.68 with the new tag, the 7.68 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-17 (v7.69): both versions read 7.69 with the hold-leads tag, and the 7.69 entry says hold to
  // delete or block, what each does, and the blocked list.
  // NEGATIVE CONTROL (run 2026-10-17, v7.69): changelog.js's VERSION left at '7.68' made this read
  //   FAIL  R1 both versions read 7.69 with the new tag, the 7.69 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-17 (v7.70): both versions read 7.70 with the bookable-hours tag, and the 7.70 entry says their
  // hours are bookable from their link, the buffer and where it is set, and free calls.
  // NEGATIVE CONTROL (run 2026-10-17, v7.70): the worker's BUILD_TAG left at the hold-leads tag made this read
  //   FAIL  R1 both versions read 7.70 with the new tag, the 7.70 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-17 (v7.71): both versions read 7.71 with the open tag, and the 7.71 entry says every service is
  // open, the home books a case with How it works back, and there is no free call.
  // NEGATIVE CONTROL (run 2026-10-17, v7.71): the worker's BUILD_TAG left at the bookable-hours tag made this read
  //   FAIL  R1 both versions read 7.71 with the new tag, the 7.71 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-17 (v7.72): both versions read 7.72 with the switches tag, and the 7.72 entry says each service has
  // a switch in settings, what off means, and that extras go with their service.
  // NEGATIVE CONTROL (run 2026-10-17, v7.72): changelog.js's VERSION left at '7.71' made this read
  //   FAIL  R1 both versions read 7.72 with the new tag, the 7.72 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  // RE-PINNED 2026-10-17 (v7.73): both versions read 7.73 with the their-chat tag, and the 7.73 entry says each team member
  // can have their own chat line at their price, off until he turns it on, and that a history stays with its advocate.
  // NEGATIVE CONTROL (run 2026-10-17, v7.73): the worker's VERSION left at '7.72' made this read
  //   FAIL  R1 both versions read 7.73 with the new tag, the 7.73 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  const entry773 = (CL.match(/\{\n\s+\/\/ THEIR OWN CHAT LINE \(Eric, 2026-10-17[\s\S]*?\n  \},/) || [''])[0];
  const entry772 = (CL.match(/\{\n\s+\/\/ A SWITCH FOR EACH SERVICE \(Eric, 2026-10-17[\s\S]*?\n  \},/) || [''])[0];
  const entry771 = (CL.match(/\{\n\s+\/\/ EVERY SERVICE OPEN \(Eric, 2026-10-17[\s\S]*?\n  \},/) || [''])[0];
  const entry770 = (CL.match(/\{\n\s+\/\/ BOOKABLE HOURS AND A BUFFER \(Eric, 2026-10-17[\s\S]*?\n  \},/) || [''])[0];
  const entry769 = (CL.match(/\{\n\s+\/\/ HOLD A LEAD TO DELETE OR BLOCK \(Eric, 2026-10-17[\s\S]*?\n  \},/) || [''])[0];
  const entry768 = (CL.match(/\{\n\s+\/\/ ADD AN ADVOCATE, PAGE BY PAGE \(Eric, 2026-10-17[\s\S]*?\n  \},/) || [''])[0];
  const entry767 = (CL.match(/\{\n\s+\/\/ HIS NAME, AND A LEAD'S MESSAGES BESIDE THEM \(Eric, 2026-10-17[\s\S]*?\n  \},/) || [''])[0];
  const entry766 = (CL.match(/\{\n\s+\/\/ THREE LOOKS, RAISED BUTTONS \(Eric, 2026-10-17[\s\S]*?\n  \},/) || [''])[0];
  const entry765 = (CL.match(/\{\n\s+\/\/ EVERY STEP UP AN ENHANCEMENT \(Eric, 2026-10-17[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-10-17 (v7.64): both versions read 7.64 with the color-wheel tag, and the 7.64 entry says what the
  // wheel does, what Black is, where Blue and purple went, and the duty of care check.
  // NEGATIVE CONTROL (run 2026-10-17, v7.64): the worker's BUILD_TAG left at the month-end tag made this read
  //   FAIL  R1 both versions read 7.64 with the new tag, the 7.64 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  const entry764 = (CL.match(/\{\n\s+\/\/ THE COLOR WHEEL AND BLACK \(Eric, 2026-10-17[\s\S]*?\n  \},/) || [''])[0];
  const entry763 = (CL.match(/\{\n\s+\/\/ THE END OF A MONTH, AND ITS PACE \(Eric, 2026-10-17[\s\S]*?\n  \},/) || [''])[0];
  const entry762 = (CL.match(/\{\n\s+\/\/ THE THREE AUDITS' ERRORS \(Eric, 2026-10-16[\s\S]*?\n  \},/) || [''])[0];
  const entry761 = (CL.match(/\{\n\s+\/\/ DEMO MODE \(Eric, 2026-10-16[\s\S]*?\n  \},/) || [''])[0];
  const entry760 = (CL.match(/\{\n\s+\/\/ INVENTED CLIENTS OFF HIS SHELF \(Eric, 2026-10-16[\s\S]*?\n  \},/) || [''])[0];
  const entry759 = (CL.match(/\{\n\s+\/\/ HIS THREE ACTS ON THEIR CASES \(Eric, 2026-10-16[\s\S]*?\n  \},/) || [''])[0];
  const entry758 = (CL.match(/\{\n\s+\/\/ NEVER STUCK SIGNING IN \(Eric, 2026-10-16[\s\S]*?\n  \},/) || [''])[0];
  const entry757 = (CL.match(/\{\n\s+\/\/ WARM EVERYWHERE \(Eric, 2026-10-16[\s\S]*?\n  \},/) || [''])[0];
  const entry756 = (CL.match(/\{\n\s+\/\/ FOUR AUDITS \(Eric, 2026-10-16[\s\S]*?\n  \},/) || [''])[0];
  const entry755 = (CL.match(/\{\n\s+\/\/ ONE TEAM PAGE, ONE CALENDAR \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-10-16 (v7.54): both versions read 7.54 with the doubles-cut tag, and the 7.54 entry says Track is gone,
  // the logs are one, Saved and the PDF moved, and the clock has one switch.
  // NEGATIVE CONTROL (run 2026-10-16, v7.54): the worker's BUILD_TAG left at the what-they-bought tag made this read
  //   FAIL  R1 both versions read 7.54 with the new tag, the 7.54 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  const entry754 = (CL.match(/\{\n\s+\/\/ THE DOUBLES CUT \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-10-15 (v7.53): both versions read 7.53 with the what-they-bought tag, and the 7.53 entry says Clients
  // groups by purchase, Full-Service owes the consult and no report, and an upgrade replaces the report.
  // NEGATIVE CONTROL (run 2026-10-15, v7.53): the worker's VERSION left at '7.52' made this read
  //   FAIL  R1 both versions read 7.53 with the new tag, the 7.53 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  const entry753 = (CL.match(/\{\n\s+\/\/ WHAT THEY BOUGHT \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-10-15 (v7.52): both versions read 7.52 with the wrong-today tag, and the 7.52 entry says statuses and
  // forms carry the contractor's name, a report waits for the call, and the Advisor sign-up keeps its caveat.
  // NEGATIVE CONTROL (run 2026-10-15, v7.52): changelog.js's VERSION left at '7.51' made this read
  //   FAIL  R1 both versions read 7.52 with the new tag, the 7.52 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  const entry752 = (CL.match(/\{\n\s+\/\/ WHAT WAS WRONG TODAY \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-10-15 (v7.51): both versions read 7.51 with the two-off tag, and the 7.51 entry says the Fund
  // queue is off the Clients page with the applications kept, and the Summary tab is gone.
  // NEGATIVE CONTROL (run 2026-10-15, v7.51): the worker's BUILD_TAG left at the his-face tag made this read
  //   FAIL  R1 both versions read 7.51 with the new tag, the 7.51 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  const entry751 = (CL.match(/\{\n\s+\/\/ TWO THINGS OFF \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  const entry750 = (CL.match(/\{\n\s+\/\/ HIS FACE, A GREEN DOOR, THEIR PROFILES \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-10-15 (v7.49): both versions read 7.49 with the payroll-paid tag, and the 7.49 entry says the
  // report fits his phone, Paid files it by month, and editing a paid one asks first in his words.
  // NEGATIVE CONTROL (run 2026-10-15, v7.49): the worker's VERSION left at '7.48' made this read
  //   FAIL  R1 both versions read 7.49 with the new tag, the 7.49 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  const entry749 = (CL.match(/\{\n\s+\/\/ PAYROLL, ALL OF IT, AND PAID \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-10-15 (v7.48): both versions read 7.48 with the warm-public tag, and the 7.48 entry says what
  // wears the warm look and how to undo it.
  // NEGATIVE CONTROL (run 2026-10-15, v7.48): changelog.js's VERSION left at '7.47' made this read
  //   FAIL  R1 both versions read 7.48 with the new tag, the 7.48 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  const entry748 = (CL.match(/\{\n\s+\/\/ WARM PUBLIC PAGES \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-10-15 (v7.47): both versions read 7.47 with the contractor-settings tag, and the 7.47 entry says
  // what a contractor's cog holds and that their prices and limit are theirs alone.
  // NEGATIVE CONTROL (run 2026-10-15, v7.47): the worker's BUILD_TAG left at the employer-mode tag made this read
  //   FAIL  R1 both versions read 7.47 with the new tag, the 7.47 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  const entry747 = (CL.match(/\{\n\s+\/\/ CONTRACTORS' OWN SETTINGS \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-10-15 (v7.46): both versions read 7.46 with the employer-mode tag, and the 7.46 entry says what employer
  // mode shows, how payroll runs the Mangomint way, that Clients is two columns, and what contractors get.
  // NEGATIVE CONTROL (run 2026-10-15, v7.46): the worker's BUILD_TAG left at the warm-tour tag made this read
  //   FAIL  R1 both versions read 7.46 with the new tag, the 7.46 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  const entry746 = (CL.match(/\{\n\s+\/\/ EMPLOYER MODE AND PAYROLL \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  const entry745 = (CL.match(/\{\n\s+\/\/ WARM, GUIDED, TAN \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  const entry744 = (CL.match(/\{\n\s+\/\/ ADVOCATE ACCOUNTS \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  const entry743 = (CL.match(/\{\n\s+\/\/ MANY ADVOCATES, THE GROUNDWORK \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  const entry742 = (CL.match(/\{\n\s+\/\/ PREVIEW A CASE, AND THE NUMBERS TAB OFF \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  const entry741 = (CL.match(/\{\n\s+\/\/ THE \+, AND THE CARDS BY STATE \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  const entry740 = (CL.match(/\{\n\s+\/\/ TWO WEEKS, AND THE NUMBERS PULLED UP \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-10-15 (v7.39): both versions read 7.39 with the his-prices tag, and the 7.39 entry says the case
  // is $2,100 and his prices are in Settings, live at once.
  // NEGATIVE CONTROL (run 2026-10-15, v7.39): changelog.js's VERSION left at '7.38' made this read
  //   FAIL  R1 both versions read 7.39 with the new tag, the 7.39 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  const entry739 = (CL.match(/\{\n\s+\/\/ HIS PRICES, FROM HIS SETTINGS \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-10-15 (v7.38): both versions read 7.38 with the one-look tag, and the 7.38 entry says the chat
  // page is his letter, a client can cancel from the menu, every chat has a search, and the look is everywhere.
  // NEGATIVE CONTROL (run 2026-10-15, v7.38): the worker's VERSION left at '7.37' made this read
  //   FAIL  R1 both versions read 7.38 with the new tag, the 7.38 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  const entry738 = (CL.match(/\{\n\s+\/\/ HIS LETTER, A CLEAR CANCEL, CHAT SEARCH, ONE LOOK, TIGHTENED \(Eric,[\s\S]*?\n  \},/) || [''])[0];
  const entry737 = (CL.match(/\{\n\s+\/\/ ONE PACKAGE, ONE PAGE \(Eric, 2026-10-15[\s\S]*?\n  \},/) || [''])[0];
  const entry736 = (CL.match(/\{\n\s+\/\/ CHAT OPEN, ONE SCREEN \(Eric, 2026-10-14[\s\S]*?\n  \},/) || [''])[0];
  const entry735 = (CL.match(/\{\n\s+\/\/ SALES CLOSED \(Eric, 2026-10-12[\s\S]*?\n  \},/) || [''])[0];
  check('R1 both versions read 7.73 with the new tag, the 7.73 to 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list',
    /export const VERSION = '7\.73';/.test(CL) && /const VERSION = '7\.73';/.test(W) && /const BUILD_TAG = 'v2026-10-17-their-chat';/.test(W)
    && changelog.CHANGELOG[0].version === '7.73'
    && /version: '7\.73',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry773)
    && /their own 24\/7 Priority Chat line, at their own price/.test(entry773) && /stays with the advocate it was with/.test(entry773)
    && !DASH.test(entry773) && !HARD.some((re) => re.test(entry773))
    && /version: '7\.72',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry772)
    && /Settings has a switch for each service/.test(entry772) && /Extras go with their service/.test(entry772)
    && !DASH.test(entry772) && !HARD.some((re) => re.test(entry772))
    && /version: '7\.71',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry771)
    && /All three services are open again/.test(entry771) && /There is no free call\./.test(entry771)
    && !DASH.test(entry771) && !HARD.some((re) => re.test(entry771))
    && /version: '7\.70',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry770)
    && /available hours are now the times their clients can book them/.test(entry770) && /Free calls make no buffer, but cannot be booked inside one\./.test(entry770)
    && !DASH.test(entry770) && !HARD.some((re) => re.test(entry770))
    && /version: '7\.69',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry769)
    && /Hold a card on Leads to delete or block that person\./.test(entry769) && /each with Unblock\./.test(entry769)
    && !DASH.test(entry769) && !HARD.some((re) => re.test(entry769))
    && /version: '7\.68',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry768)
    && /Add an advocate goes page by page/.test(entry768) && /Bank numbers are encrypted before they are stored\./.test(entry768)
    && !DASH.test(entry768) && !HARD.some((re) => re.test(entry768))
    && /version: '7\.67',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry767)
    && /Your name is Eric Leach everywhere/.test(entry767) && /Their messages open under their name like a chat/.test(entry767)
    && !DASH.test(entry767) && !HARD.some((re) => re.test(entry767))
    && /version: '7\.66',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry766)
    && /The color wheel is gone\. Settings offers three looks: Warm, Blue and green, and Black/.test(entry766) && /Buttons stand off the page now/.test(entry766)
    && !DASH.test(entry766) && !HARD.some((re) => re.test(entry766))
    && /version: '7\.65',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry765)
    && /with their \$50 chat month off\./.test(entry765) && /Act is now just Log/.test(entry765)
    && !DASH.test(entry765) && !HARD.some((re) => re.test(entry765))
    && /version: '7\.64',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry764)
    && /Settings has a color wheel now\./.test(entry764) && /Black is a black background with white text/.test(entry764)
    && !DASH.test(entry764) && !HARD.some((re) => re.test(entry764))
    && /version: '7\.63',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry763)
    && /the case closes on its own and the file stays theirs\./.test(entry763) && /Clients now read up to 20 hours a month\./.test(entry763)
    && !DASH.test(entry763) && !HARD.some((re) => re.test(entry763))
    && /version: '7\.62',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry762)
    && /Payroll names a Full-Service charge Full-Service, and its lines fit your phone\./.test(entry762) && /In Demo mode every client has their own read/.test(entry762)
    && !DASH.test(entry762) && !HARD.some((re) => re.test(entry762))
    && /version: '7\.61',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry761)
    && /Demo mode, on Clients: a practice copy with four clients and four team members\./.test(entry761) && /set how many clients each team member has and what kind/.test(entry761)
    && !DASH.test(entry761) && !HARD.some((re) => re.test(entry761))
    && /version: '7\.60',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry760)
    && /An invented client carries Delete on its folder\./.test(entry760) && /deleted from ⚙ Settings on their case, after you type their name\./.test(entry760)
    && !DASH.test(entry760) && !HARD.some((re) => re.test(entry760))
    && /version: '7\.59',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry759)
    && /The client and the team member see Removed by Eric where it was\./.test(entry759) && /sends your prewritten message to their client, from you\./.test(entry759)
    && !DASH.test(entry759) && !HARD.some((re) => re.test(entry759))
    && /version: '7\.58',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry758)
    && /Signing in never just sits there\./.test(entry758) && /The logo takes you to the home page now\./.test(entry758)
    && !DASH.test(entry758) && !HARD.some((re) => re.test(entry758))
    && /version: '7\.57',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry757)
    && /Warm is the look on every page now/.test(entry757) && /Blue and purple is in Settings/.test(entry757)
    && !DASH.test(entry757) && !HARD.some((re) => re.test(entry757))
    && /version: '7\.56',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry756)
    && /A new contractor sets up first/.test(entry756) && /signs them out everywhere, at once\./.test(entry756)
    && !DASH.test(entry756) && !HARD.some((re) => re.test(entry756))
    && /version: '7\.55',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry755)
    && /Advocates is part of Employer mode\./.test(entry755) && /Availability is part of the Calendar\./.test(entry755)
    && !DASH.test(entry755) && !HARD.some((re) => re.test(entry755))
    && /version: '7\.54',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry754)
    && /Track is gone\./.test(entry754) && /one Log under Act/.test(entry754)
    && /The second Start in Chat is gone/.test(entry754)
    && !DASH.test(entry754) && !HARD.some((re) => re.test(entry754))
    && /version: '7\.53',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry753)
    && /grouped by what they bought/.test(entry753) && /owes the first consult, never a report/.test(entry753)
    && /replaces the report/.test(entry753) && /Priority Chat client waiting on a reply/.test(entry753)
    && !DASH.test(entry753) && !HARD.some((re) => re.test(entry753))
    && /version: '7\.52',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry752)
    && /"Ana is reading", not yours/.test(entry752) && /name that contractor as the advocate/.test(entry752)
    && /cannot be marked delivered before the call/.test(entry752) && /only an aid, not a diagnostic tool/.test(entry752)
    && !DASH.test(entry752) && !HARD.some((re) => re.test(entry752))
    && /version: '7\.51',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry751)
    && /The Fund queue is off the Clients page\. The applications already sent are kept\./.test(entry751)
    && /The Summary tab on a case, one day read back, is gone\./.test(entry751)
    && !DASH.test(entry751) && !HARD.some((re) => re.test(entry751))
    && /version: '7\.50',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry750)
    && /just under the headline on the left, whole and uncropped/.test(entry750) && /green button with a shine/.test(entry750)
    && /Photo and bio on each card/.test(entry750)
    && !DASH.test(entry750) && !HARD.some((re) => re.test(entry750))
    && /version: '7\.49',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry749)
    && /fits your phone/.test(entry749) && /Paid puts a payroll in a folder for its month/.test(entry749)
    && /Are you sure you want to edit this paid payroll\?/.test(entry749)
    && !DASH.test(entry749) && !HARD.some((re) => re.test(entry749))
    && /version: '7\.48',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry748)
    && /wear the warm look/.test(entry748) && /turn off Warm public pages in your settings/.test(entry748)
    && !DASH.test(entry748) && !HARD.some((re) => re.test(entry748))
    && /version: '7\.47',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry747)
    && /Contractors have their own settings in the cog/.test(entry747) && /their own prices for their own clients/.test(entry747)
    && /never moves yours/.test(entry747) && /counts only your own clients/.test(entry747)
    && !DASH.test(entry747) && !HARD.some((re) => re.test(entry747))
    && /version: '7\.46',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry746)
    && /Employer mode, beside Clients/.test(entry746) && /they cannot tell/.test(entry746) && /closing it deletes every message/.test(entry746)
    && /the Mangomint way/.test(entry746) && /Pay history by month/.test(entry746) && /two column grid/.test(entry746)
    && /only schedules a case from a lead of their own/.test(entry746)
    && !DASH.test(entry746) && !HARD.some((re) => re.test(entry746))
    && /version: '7\.45',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry745)
    && /back to the tan folders/.test(entry745) && /The client side is warm now/.test(entry745) && /your photo beside them/.test(entry745)
    && /Progress has a card that celebrates/.test(entry745) && /short guided tour/.test(entry745) && /always in office/.test(entry745)
    && !DASH.test(entry745) && !HARD.some((re) => re.test(entry745))
    && /version: '7\.44',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry744)
    && /A new Advocates tab/.test(entry744) && /They see their own clients and nothing else/.test(entry744)
    && /A new My profile tab for your own card/.test(entry744) && /nothing for you to deploy/.test(entry744)
    && !DASH.test(entry744) && !HARD.some((re) => re.test(entry744))
    && /version: '7\.43',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry743)
    && /You are advocate number one/.test(entry743) && /Nothing moved, and nothing looks different/.test(entry743)
    && /checks, on the server, that whoever is asking works that case/.test(entry743)
    && !DASH.test(entry743) && !HARD.some((re) => re.test(entry743))
    && /version: '7\.42',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry742)
    && /Preview a case sits at the top left of the home/.test(entry742) && /Nothing they do leaves their browser/.test(entry742)
    && /The numbers tab at the foot of the home is gone/.test(entry742)
    && !DASH.test(entry742) && !HARD.some((re) => re.test(entry742))
    && /version: '7\.41',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry741)
    && /A \+ at the top of Clients: Showcase, My own case, Schedule a case from a lead, and Family case\./.test(entry741)
    && /paying your price then; 0 is no charge/.test(entry741) && /Delete is on your own cases/.test(entry741) && /paused ones gold/.test(entry741)
    && !DASH.test(entry741) && !HARD.some((re) => re.test(entry741))
    && /version: '7\.40',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry740)
    && /due within 14 days of the call/.test(entry740) && /keep the 7 days they were promised/.test(entry740) && /Pull it up, or tap it/.test(entry740)
    && !DASH.test(entry740) && !HARD.some((re) => re.test(entry740))
    && /version: '7\.39',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry739)
    && /An Advocacy Case is \$2,100/.test(entry739) && /in Settings now, under Prices/.test(entry739) && /live at once/.test(entry739)
    && !DASH.test(entry739) && !HARD.some((re) => re.test(entry739))
    && /version: '7\.38',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry738)
    && /your letter, word for word/.test(entry738) && /cancel 24\/7 Priority Chat from the menu/.test(entry738)
    && /has a search/.test(entry738) && /same black look/.test(entry738)
    && !DASH.test(entry738) && !HARD.some((re) => re.test(entry738))
    && /version: '7\.37',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry737)
    && /Each package has its own page/.test(entry737) && /shows only its own details/.test(entry737)
    && !DASH.test(entry737) && !HARD.some((re) => re.test(entry737))
    && /version: '7\.36',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry736)
    && /Priority Chat is open again/.test(entry736) && /fits on one screen/.test(entry736) && /Leads tab/.test(entry736)
    && !DASH.test(entry736) && !HARD.some((re) => re.test(entry736))
    && /version: '7\.35',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry735)
    && /Nothing can be bought anywhere/.test(entry735) && /free 15-minute call is gone/.test(entry735) && /Send \/open/.test(entry735)
    && !DASH.test(entry735) && !HARD.some((re) => re.test(entry735))
    && /version: '7\.34',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry734)
    && /Join the waitlist bubble/.test(entry734) && /lists everyone on the waitlist/.test(entry734) && !DASH.test(entry734) && !HARD.some((re) => re.test(entry734))
    && /version: '7\.33',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry733)
    && /Sora for the headings and Manrope for the text/.test(entry733) && !DASH.test(entry733) && !HARD.some((re) => re.test(entry733))
    && /version: '7\.32',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry732)
    && /Your notice is the first thing/.test(entry732) && !DASH.test(entry732) && !HARD.some((re) => re.test(entry732))
    && /version: '7\.31',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry731)
    && /Not currently offering/.test(entry731) && /Chat can always be started/.test(entry731)
    && !DASH.test(entry731) && !HARD.some((re) => re.test(entry731))
    && /version: '7\.30',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry730)
    && /PR 1 is back as the live site/.test(entry730) && /The Community Assistance Fund is hidden\./.test(entry730) && /PR 420 stays deleted\./.test(entry730)
    && !DASH.test(entry730) && !HARD.some((re) => re.test(entry730))
    && /version: '7\.29',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry729)
    && /disability due to illness/.test(entry729) && /Before Verify or Reverify goes through/.test(entry729)
    && !DASH.test(entry729) && !HARD.some((re) => re.test(entry729))
    && /version: '7\.28',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry728)
    && /Discord username, not a display name/.test(entry728) && /Nobody can submit without it/.test(entry728)
    && !DASH.test(entry728) && !HARD.some((re) => re.test(entry728))
    && /version: '7\.27',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry727)
    && entry727.includes('Verified applicants will receive payouts via Mercury Business Check on January 1st, 2027.')
    && !DASH.test(entry727) && !HARD.some((re) => re.test(entry727))
    && !changelog.CHANGELOG.filter((e) => ['7.25', '7.26', '7.27'].includes(e.version)).some((e) => e.admin.some((l) => /Distributions are monthly|each month|November 1/.test(l)))
    && /version: '7\.26',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry726)
    && /Net GoFundMe proceeds so far/.test(entry726) && /Zazzle creator earnings being added/.test(entry726) && /The GoFundMe button is live/.test(entry726)
    && !DASH.test(entry726) && !HARD.some((re) => re.test(entry726))
    && /version: '7\.25',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry725)
    && /parked in PR 1/.test(entry725) && /pocketadvocate\.eric@gmail\.com/.test(entry725) && /by check only/.test(entry725)
    && !DASH.test(entry725) && !HARD.some((re) => re.test(entry725))
    && /version: '7\.24',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry724)
    && /Checks come from Mercury and take 7 to 10 business days\./.test(entry724) && /You are never in the split\./.test(entry724)
    && !DASH.test(entry724) && !HARD.some((re) => re.test(entry724))
    && /version: '7\.23',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry723)
    && /The landing is now the Community Assistance Fund alone/.test(entry723) && /parked as PR 1/.test(entry723)
    && !DASH.test(entry723) && !HARD.some((re) => re.test(entry723))
    && /version: '7\.22',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry722)
    && /Community Assistance Fund verification is built/.test(entry722) && /You cannot verify your own application\./.test(entry722)
    && !DASH.test(entry722) && !HARD.some((re) => re.test(entry722))
    && /version: '7\.21',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry721)
    && /PR 420 is gone\./.test(entry721) && /no longer show in your dictionary or on any case/.test(entry721)
    && !DASH.test(entry721) && !HARD.some((re) => re.test(entry721))
    && since46.length >= 40 && since46.every((e) => e.quiet === true && Array.isArray(e.client) && e.client.length === 0),
    JSON.stringify({ newest: changelog.CHANGELOG[0].version, loud: since46.filter((e) => !e.quiet || e.client.length).map((e) => e.version) }));
}

// ---- the engine's seams, lifted and run --------------------------------------------------
const withPolicy = lift(ADV, 'export async function withCasePolicy(env, kind, id, fn) {');
const harness = () => {
  const store = new Map();
  const deps = {
    AsyncLocalStorage,
    getDoc: async (env2, path) => (store.has(path) ? { id: path.split('/').pop(), data: store.get(path) } : null),
    statePath: (kind, id) => `${kind === 'case' ? 'cases' : 'subscriptions'}/${id}/advisor/state`,
    listDocs: async () => store.get('advisorKnowledge') || [],
  };
  const api = new Function('deps', `
    const { AsyncLocalStorage, getDoc, statePath, listDocs } = deps;
    const READ_FAILED = Symbol('read failed'); const tryGet = async (env, p) => { try { return await getDoc(env, p); } catch { return READ_FAILED; } };
    const readFailedError = (m) => new Error(m);
    ${grab(ADV, /export const LEGACY_TRADE_CATEGORIES = \[[^\]]*\];/).replace('export const', 'const')}
    ${lift(ADV, 'function withCacheBp(system) {')}
    ${grab(ADV, /const MODEL = '[^']+';/)}
    ${grab(ADV, /const SELF_MODEL = '[^']+';/)}
    ${grab(ADV, /const SELF_EFFORT = '[^']+';/)}
    ${grab(ADV, /const CASE_EFFORT = '[^']+';/)}
    ${grab(ADV, /const turnPolicy = new AsyncLocalStorage\(\);/)}
    ${withPolicy.replace('export async function', 'async function')}
    ${lift(ADV, 'function selfBlock() {')}
    ${lift(ADV, 'function todayBlock() {')}
    ${lift(ADV, 'function turnRequest({ system, messages, effort, maxTokens = 64000, tools }) {')}
    ${lift(ADV, 'async function loadKnowledge(env) {')}
    return { withCasePolicy, turnRequest, loadKnowledge, turnPolicy, MODEL, SELF_MODEL };
  `)(deps);
  return { api, store };
};

{
  const H = harness();
  // An old desk document still in the database is just his own case to the engine now.
  H.store.set('cases/desk', { self: true, trade: true, clientName: 'PR 420' });
  H.store.set('cases/mine', { self: true, clientName: 'Eric Leach' });
  H.store.set('cases/client', { clientName: 'Jane' });
  const seen = (id) => H.api.withCasePolicy({}, 'case', id, async () => H.api.turnPolicy.getStore());
  const desk = await seen('desk');
  const mine = await seen('mine');
  const build = () => H.api.turnRequest({ system: 'SYS', messages: [], effort: 'medium', maxTokens: 1000, tools: [{ name: 'set_price' }] });
  const onMine = await H.api.withCasePolicy({}, 'case', 'mine', async () => build());
  const onClient = await H.api.withCasePolicy({}, 'case', 'client', async () => build());
  // NEGATIVE CONTROL (run 2026-10-04): `policy = { ...policy, tools: [{ type: 'web_search_20260209' }] }` added after the self branch made this read
  //   FAIL  R2 the engine has no trade policy left: an old desk document reads as his own case with his own model, no extra tools and no trade flag; his own case gets the self block and the caller's tools; a client case gets neither the block nor a policy
  check('R2 the engine has no trade policy left: an old desk document reads as his own case with his own model, no extra tools and no trade flag; his own case gets the self block and the caller\'s tools; a client case gets neither the block nor a policy',
    withPolicy.length > 200 && desk?.self === true && desk.trade === undefined && desk.model === H.api.SELF_MODEL && !desk.tools
    && mine?.self === true && !mine.tools
    && onMine.tools.length === 1 && onMine.tools[0].name === 'set_price' && onMine.system.some((b) => /HIS OWN CASE/.test(b.text))
    && onClient.tools[0].name === 'set_price' && !onClient.system.some((b) => /HIS OWN CASE/.test(b.text))
    && !/TRADE_|\.trade\b|trade:/.test(ADV.replace(/LEGACY_TRADE_CATEGORIES/g, '')),
    JSON.stringify({ desk, mine: mine?.model }));

  // ERIC, 2026-09-22: "Analysis failed: system: text content blocks must contain non-whitespace
  // text". Seven callers fall back to one space when a note has nothing to say, and the API
  // refuses a whitespace-only block. Was trade.mjs T38; nothing about it was ever the desk's.
  const blanks = () => H.api.turnRequest({ system: [{ type: 'text', text: 'SYS', cache: true }, { type: 'text', text: ' ' }, { type: 'text', text: '' }], messages: [], effort: 'medium', maxTokens: 1000 });
  const blankMine = await H.api.withCasePolicy({}, 'case', 'mine', async () => blanks());
  const blankClient = await H.api.withCasePolicy({}, 'case', 'client', async () => blanks());
  const blankNone = blanks();
  const noBlank = (t) => t.system.every((b) => b.type !== 'text' || /\S/.test(b.text));
  // NEGATIVE CONTROL (run 2026-09-22, as trade.mjs T38): the filter's test loosened to `/[\s\S]*/` (a space passes) made this read
  //   FAIL  T38 a blank system block never rides ...
  // NEGATIVE CONTROL (run 2026-10-04, moved here as R3): the same loosening made this read
  //   FAIL  R3 a blank system block never rides: a one-space block and an empty block are dropped on his own case, on a client case and outside any policy, the caller's flagged block keeps its breakpoint, the today block is still last with the trailing breakpoint, and the drop sits in turnRequest where every request is built
  check('R3 a blank system block never rides: a one-space block and an empty block are dropped on his own case, on a client case and outside any policy, the caller\'s flagged block keeps its breakpoint, the today block is still last with the trailing breakpoint, and the drop sits in turnRequest where every request is built',
    noBlank(blankMine) && noBlank(blankClient) && noBlank(blankNone)
    && blankClient.system.length === 2 && blankClient.system[0].text === 'SYS' && blankClient.system[0].cache_control?.type === 'ephemeral'
    && /^Today is /.test(blankClient.system[1].text) && blankClient.system[1].cache_control?.type === 'ephemeral'
    && blankMine.system.length === 3 && /HIS OWN CASE/.test(blankMine.system[2].text) && blankNone.system.length === 2
    && /const kept = sys\.filter\(\(b\) => b\.type !== 'text' \|\| \/\\S\/\.test\(String\(b\.text \?\? ''\)\)\);/.test(ADV)
    && /system: withCacheBp\(kept\),/.test(ADV),
    JSON.stringify({ client: blankClient.system.map((b) => b.text.slice(0, 12)), mine: blankMine.system.length }));

  // The trading terms the desk saved are still in his dictionary collection. No turn is handed
  // one: not his own case, not a client's, not a turn outside any run.
  H.store.set('advisorKnowledge', [
    { id: 'vwap', data: { term: 'VWAP', category: 'Indicator', learnedAt: null } },
    { id: 'orb', data: { term: 'Opening range', category: 'Setup', learnedAt: '2026-09-23' } },
    { id: 'ferritin', data: { term: 'Ferritin', category: 'Test or lab', learnedAt: '2026-09-01' } },
    { id: 'plain', data: { term: 'Plain', learnedAt: null } },
  ]);
  const deskTerms = await H.api.withCasePolicy({}, 'case', 'desk', async () => H.api.loadKnowledge({}));
  const mineTerms = await H.api.withCasePolicy({}, 'case', 'mine', async () => H.api.loadKnowledge({}));
  const noneTerms = await H.api.loadKnowledge({});
  const medical = (t) => t.learned.join() === 'Ferritin' && t.pending.join() === 'Plain';
  // NEGATIVE CONTROL (run 2026-10-04): loadKnowledge's filter removed (`const rows = all;`) made this read
  //   FAIL  R4 the trading terms the desk saved never reach a turn: an old desk document, his own case and a turn outside any run all get the medical half only, and the same eight categories are kept out of the panel's glossary, the dictionary page and the demo
  check('R4 the trading terms the desk saved never reach a turn: an old desk document, his own case and a turn outside any run all get the medical half only, and the same eight categories are kept out of the panel\'s glossary, the dictionary page and the demo',
    medical(deskTerms) && medical(mineTerms) && medical(noneTerms)
    && /export const LEGACY_TRADE_CATEGORIES = \['Setup', 'Indicator', 'Level', 'Order', 'Risk', 'Options', 'Market', 'Instrument'\];/.test(ADV)
    && /const LEGACY_TRADE_CATS = \['Setup', 'Indicator', 'Level', 'Order', 'Risk', 'Options', 'Market', 'Instrument'\];/.test(f('public/js/demo/api.js'))
    && /const terms = knowledge\.filter\(\(r\) => !LEGACY_TRADE_CATEGORIES\.includes\(String\(r\.data\.category \|\| ''\)\)\);/.test(W)
    && /\.filter\(\(r\) => !LEGACY_TRADE_CATEGORIES\.includes\(String\(r\.data\.category \|\| ''\)\)\);\n\s+return json\(\{\n\s+terms: rows\.map/.test(W)
    && /!LEGACY_TRADE_CATS\.includes\(d\.category \|\| 'General'\)/.test(f('public/js/demo/api.js')),
    JSON.stringify({ desk: deskTerms, none: noneTerms }));
}

// ---- R5: the PDF writer (was trade.mjs T40) ----------------------------------------------
// The showcase files its documents with it and the demo builds the same file in the browser.
{
  const e9 = String.fromCharCode(0xE9);
  const rq = String.fromCharCode(0x2019);
  const mid = String.fromCharCode(0xB7);
  const em = String.fromCharCode(0x2014);
  const bullet = String.fromCharCode(0x95);
  const bytes = pdf.textPdf(['Intro line.', '', '# Next steps', `- Caf${e9} ${rq}quote${rq} ${mid} and ${em} dash and an emoji ${String.fromCodePoint(0x1F4C8)} gone`,
    ...Array.from({ length: 90 }, (_, i) => `Line ${i} ` + 'word '.repeat(28))], { title: 'Call notes', footer: `Pocket Advocate ${mid} 2026-10-04 ${mid} For your records.` });
  const s = Buffer.from(bytes).toString('latin1');
  const xrefAt = Number((s.match(/startxref\n(\d+)\n/) || [])[1]);
  const entries = [...s.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)].map((x) => Number(x[1]));
  const offsetsOk = entries.length > 0 && entries.every((off, i) => s.slice(off).startsWith(`${i + 1} 0 obj`));
  const count = Number((s.match(/\/Count (\d+)/) || [])[1]);
  const lengthsOk = [...s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)].every((m) => s.indexOf('\nendstream', m.index + m[0].length) - (m.index + m[0].length) === Number(m[1]));
  const PDFSRC = f('public/js/textpdf.js');
  // NEGATIVE CONTROL (run 2026-09-22, as trade.mjs T40): every xref offset written one byte off (`offsets.push(out.length + 1)`) made this read
  //   FAIL  T40 the PDF writer RUNS ...
  // NEGATIVE CONTROL (run 2026-10-04, moved here as R5): the same one-byte slip made this read
  //   FAIL  R5 the PDF writer RUNS: header to trailer with every object at the offset the table says and every stream as long as it claims, the title at 16 bold, a heading at 10.5 bold, a bullet glyph with the text indented, Latin-1 and the curly quote kept as WinAnsi bytes, the dash a hyphen and the emoji dropped, the footer and Page n of N on every page, and the served module carries no word from the blindness list and no dash
  check('R5 the PDF writer RUNS: header to trailer with every object at the offset the table says and every stream as long as it claims, the title at 16 bold, a heading at 10.5 bold, a bullet glyph with the text indented, Latin-1 and the curly quote kept as WinAnsi bytes, the dash a hyphen and the emoji dropped, the footer and Page n of N on every page, and the served module carries no word from the blindness list and no dash',
    s.startsWith('%PDF-1.4\n') && s.endsWith('%%EOF\n') && offsetsOk && lengthsOk && count >= 2 && (s.match(/\/Type \/Page\b/g) || []).length === count
    && /\/F2 16 Tf [^\n]*\(Call notes\) Tj/.test(s) && /\/F2 10\.5 Tf [^\n]*\(Next steps\) Tj/.test(s)
    && s.includes(`(${bullet}) Tj`) && /1 0 0 1 66 [\d.]+ Tm \(Caf/.test(s)
    && s.includes(`Caf${e9} ${String.fromCharCode(0x92)}quote${String.fromCharCode(0x92)} ${mid} and - dash and an emoji gone`)
    && !/[\x96\x97]/.test(s) && !s.includes('?')
    && (s.match(/\(Page \d+ of \d+\) Tj/g) || []).length === count && s.includes(`(Page 1 of ${count}) Tj`) && (s.match(/For your records\.\) Tj/g) || []).length === count
    && HARD.every((re) => !re.test(PDFSRC)) && !DASH.test(PDFSRC),
    `offsets ${offsetsOk}, lengths ${lengthsOk}, count ${count}, objects ${entries.length}`);
}

// ---- R6: a leftover scan marker (was trade.mjs T56) --------------------------------------
// No scan has written a marker since 2026-09-23, but one left in the queue must still never
// reach the claim that would count it as a reading that will not start.
// NEGATIVE CONTROL (run 2026-09-23, as trade.mjs T56): the drain's scan branch's deleteDoc replaced with `void 0;` made this read
//   FAIL  T56 a leftover scan marker ...
// NEGATIVE CONTROL (run 2026-10-04, moved here as R6): the poller's scan branch removed made this read
//   FAIL  R6 a leftover scan marker is never mistaken for a reading: both sweepers delete it before anything else can judge it, the drain above the draft rescue and the claim, the poller above the case poll, and neither reaches for a scan flight
{
  const drain = lift(ADV, 'export async function runQueuedAnalyses(env, deadlineAt = 0) {');
  const now2 = lift(ADV, 'export async function pollFlightsNow(env) {');
  const del = 'await deleteDoc(env, `advisorQueue/${row.id}`).catch(() => {});';
  check('R6 a leftover scan marker is never mistaken for a reading: both sweepers delete it before anything else can judge it, the drain above the draft rescue and the claim, the poller above the case poll, and neither reaches for a scan flight',
    drain.length > 500 && now2.length > 100
    && /if \(row\.data\.scan\) \{\n\s+await deleteDoc\(env, `advisorQueue\/\$\{row\.id\}`\)\.catch\(\(\) => \{\}\);\n\s+continue;\n\s+\}/.test(drain)
    && drain.indexOf('if (row.data.scan) {') < drain.indexOf('if (row.data.draft)')
    && /if \(row\.data\.scan\) \{\n\s+await deleteDoc\(env, `advisorQueue\/\$\{row\.id\}`\)\.catch\(\(\) => \{\}\);\n\s+continue;\n\s+\}\n\s+await pollCaseFlight\(env, kind, id, \{ minAgeMs: 45_000 \}\)/.test(now2)
    && drain.includes(del) && now2.includes(del) && !/pollScanFlight|SCAN_MARKER/.test(drain + now2 + ADV),
    JSON.stringify({ drain: drain.length, now2: now2.length }));
}

// ---- R7: PR 420 is gone ------------------------------------------------------------------
// Eric, 2026-10-04: "Delete the trading desk folder and contents in code." Every file it had is
// gone, nothing imports or routes to it, the cron drains his queued reads on every firing with
// no desk gate, the diagnostics lost its two desk modes, the shelf and the folder never show an
// old desk document, the demo has no desk, and no list still names its page.
// NEGATIVE CONTROL (run 2026-10-04): `if (url.pathname.startsWith('/api/admin/trade/')) return json({ error: 'Not found' }, 404);` put back in the router made this read
//   FAIL  R7 PR 420 is gone: ...
// NEGATIVE CONTROL (run 2026-10-04): the shelf's `if (!d.data().trade)` dropped (every case pushed) made this read
//   FAIL  R7 PR 420 is gone: ...
{
  const files = ['worker/trade.js', 'worker/trade-desk.js', 'worker/desk-run.js', 'public/admin-desk.html', 'public/js/admin-desk.js',
    'public/js/admin-deskapp.js', 'public/js/admin-deskfx.js', 'public/js/trade-math.js', 'tools/suites/desk.mjs', 'tools/suites/trade.mjs',
    'tools/drives/drive-trade.mjs'];
  const cron = (W.match(/async scheduled\(event, env, ctx\) \{[\s\S]*?\n  \},\n/) || [''])[0];
  const ADMIN = f('public/js/admin.js');
  const CASE = f('public/js/admin-case.js');
  const DEMO = f('public/js/demo/api.js');
  const SEED = f('public/js/demo/seed.js');
  const CSS = f('public/css/admin.css');
  const lists = ['tools/blindness-audit.mjs', 'tools/drives/drive-nosideways.mjs', 'tools/sweeps/contrast.mjs'].map(f).join('\n');
  const left = files.filter(has);
  check('R7 PR 420 is gone: every file it had is deleted; nothing in the Worker imports, routes or diagnoses it; the cron drains his queued reads on every firing with no desk gate and still runs the clock nudges and the booking close; the shelf drops an old desk document before any shelf sees it and an old link to one lands on the shelf; the demo and its seed have no desk; the stylesheet has no desk rules; and no list names its page',
    left.length === 0
    && !/trade\.js|trade-desk\.js|desk-run\.js|handleTrade|tradeRoute|TradeError|tradePanelBlock|maybeRunDesk|peekDesk|TRADE_SAY|resolveBars|fetchBars|\/api\/admin\/trade\/|'bars-probe'|do'\) === 'desk'|tradeStanding/.test(W)
    && cron.length > 500 && /\n    await runQueuedAnalyses\(env, deadlineAt\);\n/.test(cron) && !/deskDoc|ranDesk/.test(cron)
    && /\n    ctx\.waitUntil\(runWorkClockNudges\(env\)\);\n/.test(cron) && /\n    ctx\.waitUntil\(closeBookingsAug2026\(env\)\);\n/.test(cron)
    && /snapshot\.forEach\(\(d\) => \{ if \(!d\.data\(\)\.trade\) cases\.push\(\{ id: d\.id, \.\.\.d\.data\(\) \}\); \}\);/.test(ADMIN)
    && !/admin-desk|PR 420'|data-open-trade|\/api\/admin\/trade/.test(ADMIN)
    && /if \(data\.trade\) \{\n\s+location\.replace\('\/admin\.html'\);\n\s+return;\n\s+\}/.test(CASE) && !/admin-desk/.test(CASE)
    && !/\/api\/admin\/trade\/|trade-math|DEMO_QUOTES|deskPanelBlock|trade\/settings/.test(DEMO) && !/TRADE_ID|trade\//.test(SEED)
    && !/data-desk|--trade|\.trade-|THE TRADE DESK/.test(CSS)
    && !/admin-desk|demo-case-trade/.test(lists),
    JSON.stringify({ left }));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
