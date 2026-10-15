// rules-check.mjs - firestore.rules and storage.rules, RUN against the emulators.
//
// Eric, 2026-10-15: "Advocates must never be able to access another
// advocate's cases or data. Enforce this server-side, not just in the UI."
// And: "One advocate cannot access another advocate's data by changing IDs or
// URLs." The Worker checks every route (tools/suites/advocates.mjs); these are
// the second lock, for a browser that goes to the database or the file store
// directly, which is how every case page reads its chat.
//
// Needs Java and the Firebase emulators, so it is not in the battery. Run:
//   mkdir -p /tmp/fbtools && cd /tmp/fbtools && npm i firebase-tools@13.29.1 @firebase/rules-unit-testing@3.0.4 firebase@10.12.5
//   cp <repo>/firestore.rules <repo>/storage.rules /tmp/fbtools/ ; cp <repo>/tools/rules/firebase.json /tmp/fbtools/
//   cd /tmp/fbtools && FBTOOLS_DIR=/tmp/fbtools npx firebase emulators:exec --only firestore,storage --project demo-pa \
//     "node <repo>/tools/rules/rules-check.mjs"
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const req = createRequire(join(process.env.FBTOOLS_DIR || '/tmp/fbtools', 'package.json'));
const { initializeTestEnvironment, assertSucceeds, assertFails } = req('@firebase/rules-unit-testing');
const fs = req('firebase/firestore');
const st = req('firebase/storage');

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`PASS  ${name}`); } catch (e) { results.push(false); console.log(`FAIL  ${name}  -- ${String(e.message || e).split('\n')[0].slice(0, 160)}`); }
}

const env = await initializeTestEnvironment({
  projectId: 'demo-pa',
  // RULES_DIR lets a negative control run a mutated copy; by default, the repo's own files.
  firestore: { rules: readFileSync(join(process.env.RULES_DIR || ROOT, 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8181 },
  storage: { rules: readFileSync(join(process.env.RULES_DIR || ROOT, 'storage.rules'), 'utf8'), host: '127.0.0.1', port: 9199 },
});
const FUTURE = new Date(Date.now() + 30 * 86_400_000);
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const put = (p, d) => fs.setDoc(fs.doc(db, p), d);
  await put('users/eric', { role: 'admin' });
  await put('users/advA', { role: 'advocate' });
  await put('users/advB', { role: 'advocate' });
  await put('users/advOff', { role: 'advocate' });
  await put('users/client1', { role: 'client' });
  await put('users/client2', { role: 'client' });
  await put('advocates/advA', { active: true });
  await put('advocates/advB', { active: true });
  await put('advocates/advOff', { active: false });
  await put('cases/caseA', { advocateId: 'advA', clientUid: 'client1', status: 'confirmed' });
  await put('cases/caseE', { advocateId: 'eric', clientUid: 'client2', status: 'confirmed' });
  await put('cases/caseOff', { advocateId: 'advOff', clientUid: 'client1', status: 'confirmed' });
  await put('cases/caseA/chat/m1', { from: 'client1', role: 'client', text: 'hi', ts: new Date() });
  await put('cases/caseA/advisor/state', { x: 1 });
  await put('cases/caseA/private/notes', { x: 1 });
  await put('subscriptions/client1', { advocateId: 'advA', currentPeriodEnd: FUTURE });
  await put('subscriptions/client2', { advocateId: 'eric', currentPeriodEnd: FUTURE });
  await put('staffSecrets/k1', { uid: 'advA', hash: 'x' });
  await put('staffClocks/advA', { running: [] });
  await put('settings/booking', { closedUntil: null });
  const storage = ctx.storage();
  const bytes = new Uint8Array([1, 2, 3]);
  for (const p of ['cases/caseA/uploads/u.pdf', 'cases/caseA/prep/p.pdf', 'cases/caseE/uploads/u.pdf', 'subscriptions/client1/chat-files/f.png', 'advocates/advA/headshot.jpg'])
    await st.uploadBytes(st.ref(storage, p), bytes);
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const sas = (uid) => env.authenticatedContext(uid).storage();
const get = (db, p) => fs.getDoc(fs.doc(db, p));
const msg = (from, role) => ({ from, role, text: 'hello', ts: fs.serverTimestamp() });

console.log('\n--- the case documents ---');
// NEGATIVE CONTROL (run 2026-10-15): R1 is the client's rule as it stood before advocates; the advocate
// mutations below leave it green, which is the point. (Covered by R3 to R6 for the new clauses.)
await check('R1 a client reads their own case and not another client\'s', async () => {
  await assertSucceeds(get(as('client1'), 'cases/caseA'));
  await assertFails(get(as('client2'), 'cases/caseA'));
});
// NEGATIVE CONTROL (run 2026-10-15): worksThread reduced to `isAdvocateOf(data)`, so the admin is not on the advocate side, made this read
//   FAIL  R2 Eric reads every case and lists them all
await check('R2 Eric reads every case and lists them all', async () => {
  await assertSucceeds(get(as('eric'), 'cases/caseA'));
  await assertSucceeds(get(as('eric'), 'cases/caseE'));
  await assertSucceeds(fs.getDocs(fs.collection(as('eric'), 'cases')));
});
// NEGATIVE CONTROL (run 2026-10-15): isAdvocateOf's `data.advocateId == request.auth.uid` taken out made this read
//   FAIL  R3 an advocate reads their own case and nobody else\
await check('R3 an advocate reads their own case and nobody else\'s, his included; a switched-off one reads nothing', async () => {
  await assertSucceeds(get(as('advA'), 'cases/caseA'));
  await assertFails(get(as('advA'), 'cases/caseE'));
  await assertFails(get(as('advB'), 'cases/caseA'));
  await assertFails(get(as('advOff'), 'cases/caseOff'));
});
// NEGATIVE CONTROL (run 2026-10-15): isAdvocateOf's `data.advocateId == request.auth.uid` taken out made this read
//   FAIL  R4 an advocate lists their own cases by their uid, and cannot list everyone\
await check('R4 an advocate lists their own cases by their uid, and cannot list everyone\'s or anyone else\'s', async () => {
  await assertSucceeds(fs.getDocs(fs.query(fs.collection(as('advA'), 'cases'), fs.where('advocateId', '==', 'advA'))));
  await assertFails(fs.getDocs(fs.collection(as('advA'), 'cases')));
  await assertFails(fs.getDocs(fs.query(fs.collection(as('advB'), 'cases'), fs.where('advocateId', '==', 'advA'))));
});

console.log('\n--- the chat ---');
// NEGATIVE CONTROL (run 2026-10-15): the case chat's create asking `validMessage(false)` made this read
//   FAIL  R5 an advocate reads and writes their own case\
await check('R5 an advocate reads and writes their own case\'s chat, on the advocate side only', async () => {
  await assertSucceeds(fs.getDocs(fs.collection(as('advA'), 'cases/caseA/chat')));
  await assertSucceeds(fs.addDoc(fs.collection(as('advA'), 'cases/caseA/chat'), msg('advA', 'admin')));
  await assertFails(fs.addDoc(fs.collection(as('advA'), 'cases/caseA/chat'), msg('advA', 'client')));
});
// NEGATIVE CONTROL (run 2026-10-15): isAdvocateOf's `data.advocateId == request.auth.uid` taken out made this read
//   FAIL  R6 another advocate can neither read nor write it
await check('R6 another advocate can neither read nor write it', async () => {
  await assertFails(fs.getDocs(fs.collection(as('advB'), 'cases/caseA/chat')));
  await assertFails(fs.addDoc(fs.collection(as('advB'), 'cases/caseA/chat'), msg('advB', 'admin')));
});
// NEGATIVE CONTROL (run 2026-10-15): the case chat's create asking `validMessage(true)` made this read
//   FAIL  R7 the client still writes as the client and never as the advocate side
await check('R7 the client still writes as the client and never as the advocate side', async () => {
  await assertSucceeds(fs.addDoc(fs.collection(as('client1'), 'cases/caseA/chat'), msg('client1', 'client')));
  await assertFails(fs.addDoc(fs.collection(as('client1'), 'cases/caseA/chat'), msg('client1', 'admin')));
});
// NEGATIVE CONTROL (run 2026-10-15): the case document's `&& onlyLastMessageChanged()` taken out made this read
//   FAIL  R8 the last-message pointer: their own case\
await check('R8 the last-message pointer: their own case\'s, and only that field', async () => {
  const lm = { lastMessage: { text: 'x', from: 'advA', role: 'admin', ts: fs.serverTimestamp(), emailed: false } };
  await assertSucceeds(fs.updateDoc(fs.doc(as('advA'), 'cases/caseA'), lm));
  await assertFails(fs.updateDoc(fs.doc(as('advB'), 'cases/caseA'), lm));
  await assertFails(fs.updateDoc(fs.doc(as('advA'), 'cases/caseA'), { status: 'closed' }));
  await assertFails(fs.updateDoc(fs.doc(as('advA'), 'cases/caseA'), { advocateId: 'advB' }));
});
// NEGATIVE CONTROL (run 2026-10-15): the advisor subtree's read widened to `isAdmin() || isAdvocate()` made this read
//   FAIL  R9 the private reading and the private notes stay out of every browser but his reading
await check('R9 the private reading and the private notes stay out of every browser but his reading', async () => {
  await assertFails(get(as('advA'), 'cases/caseA/advisor/state'));
  await assertSucceeds(get(as('eric'), 'cases/caseA/advisor/state'));
  await assertFails(get(as('advA'), 'cases/caseA/private/notes'));
  await assertFails(get(as('eric'), 'cases/caseA/private/notes'));
});

console.log('\n--- chat subscriptions ---');
// NEGATIVE CONTROL (run 2026-10-15): the subscription's read widened with `|| isAdvocate()` made this read
//   FAIL  R10 an advocate reads and writes their own subscribers\
await check('R10 an advocate reads and writes their own subscribers\' chat, and not another advocate\'s', async () => {
  await assertSucceeds(get(as('advA'), 'subscriptions/client1'));
  await assertFails(get(as('advA'), 'subscriptions/client2'));
  await assertFails(get(as('advB'), 'subscriptions/client1'));
  await assertSucceeds(fs.getDocs(fs.query(fs.collection(as('advA'), 'subscriptions'), fs.where('advocateId', '==', 'advA'))));
  await assertSucceeds(fs.addDoc(fs.collection(as('advA'), 'subscriptions/client1/chat'), msg('advA', 'admin')));
  await assertFails(fs.addDoc(fs.collection(as('advB'), 'subscriptions/client1/chat'), msg('advB', 'admin')));
  await assertSucceeds(get(as('client1'), 'subscriptions/client1'));
});

console.log('\n--- roles and the Worker\'s own documents ---');
// NEGATIVE CONTROL (run 2026-10-15): the users create rule's role check taken out made this read
//   FAIL  R11 nobody makes themselves an advocate or the admin
await check('R11 nobody makes themselves an advocate or the admin', async () => {
  await assertFails(fs.updateDoc(fs.doc(as('client1'), 'users/client1'), { role: 'advocate' }));
  await assertFails(fs.updateDoc(fs.doc(as('advA'), 'users/advA'), { role: 'admin' }));
  await assertFails(fs.setDoc(fs.doc(as('newbie'), 'users/newbie'), { role: 'advocate' }));
  await assertSucceeds(fs.updateDoc(fs.doc(as('advA'), 'users/advA'), { name: 'Ana' }));
});
// NEGATIVE CONTROL (run 2026-10-15): a `match /advocates/{a} { allow read: if signedIn(); }` block added made this read
//   FAIL  R12 the advocate records, passwords and clocks are the Worker\
await check('R12 the advocate records, passwords and clocks are the Worker\'s alone', async () => {
  await assertFails(get(as('advA'), 'advocates/advA'));
  await assertFails(get(as('eric'), 'staffSecrets/k1'));
  await assertFails(get(as('advA'), 'staffClocks/advA'));
  await assertFails(fs.setDoc(fs.doc(as('advA'), 'advocates/advA'), { active: true, commissionPct: 100 }));
  await assertSucceeds(get(as('client1'), 'settings/booking'));
});

console.log('\n--- the files ---');
const sget = (uid, p) => st.getMetadata(st.ref(sas(uid), p));
const sput = (uid, p) => st.uploadBytes(st.ref(sas(uid), p), new Uint8Array([7]));
// NEGATIVE CONTROL (run 2026-10-15): storage isCaseAdvocate's `caseData(caseId).advocateId == request.auth.uid` taken out made this read
//   FAIL  R13 an advocate opens every file of their own case, his working files included, and none of anyone else\
await check('R13 an advocate opens every file of their own case, his working files included, and none of anyone else\'s', async () => {
  await assertSucceeds(sget('advA', 'cases/caseA/uploads/u.pdf'));
  await assertSucceeds(sget('advA', 'cases/caseA/prep/p.pdf'));
  await assertFails(sget('advB', 'cases/caseA/uploads/u.pdf'));
  await assertFails(sget('advA', 'cases/caseE/uploads/u.pdf'));
  await assertSucceeds(sget('eric', 'cases/caseA/prep/p.pdf'));
});
// NEGATIVE CONTROL (run 2026-10-15): the chat-files write widened to any `isAdvocate()` made this read
//   FAIL  R14 an advocate places a report or a chat file on their own case and not on another\
await check('R14 an advocate places a report or a chat file on their own case and not on another\'s', async () => {
  await assertSucceeds(sput('advA', 'cases/caseA/report/r.pdf'));
  await assertSucceeds(sput('advA', 'cases/caseA/chat-files/c.png'));
  await assertFails(sput('advB', 'cases/caseA/report/r.pdf'));
  await assertFails(sput('advB', 'cases/caseA/chat-files/c.png'));
});
// NEGATIVE CONTROL (run 2026-10-15): 'prep' added to the client's four folders made this read
//   FAIL  R15 the client keeps exactly their four folders
await check('R15 the client keeps exactly their four folders', async () => {
  await assertSucceeds(sget('client1', 'cases/caseA/uploads/u.pdf'));
  await assertFails(sget('client1', 'cases/caseA/prep/p.pdf'));
  await assertSucceeds(sput('client1', 'cases/caseA/uploads/new.pdf'));
  await assertFails(sput('client1', 'cases/caseA/report/r.pdf'));
});
// NEGATIVE CONTROL (run 2026-10-15): storage isSubAdvocate's advocateId check taken out made this read
//   FAIL  R16 subscriber chat files: their advocate, the client and Eric; headshots are the Worker\
await check('R16 subscriber chat files: their advocate, the client and Eric; headshots are the Worker\'s to serve', async () => {
  await assertSucceeds(sget('advA', 'subscriptions/client1/chat-files/f.png'));
  await assertFails(sget('advB', 'subscriptions/client1/chat-files/f.png'));
  await assertSucceeds(sget('client1', 'subscriptions/client1/chat-files/f.png'));
  await assertFails(sget('advA', 'advocates/advA/headshot.jpg'));
  await assertFails(sget('eric', 'advocates/advA/headshot.jpg'));
});

await env.cleanup();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
