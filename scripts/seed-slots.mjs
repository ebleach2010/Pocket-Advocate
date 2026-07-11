// Creates open availability slots until the availability editor ships in
// Phase 2. Hours are validated against the same 8am–6pm Mountain window the
// Worker enforces.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=service-account.json \
//   node scripts/seed-slots.mjs 2026-07-20 2026-08-01
//
// Seeds hourly 60-minute slots (9am–4pm Mountain start times, weekdays)
// between the two dates. Edit SLOT_START_HOURS / SLOT_MINUTES to taste.

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const SLOT_START_HOURS = [9, 10, 11, 13, 14, 15, 16]; // Mountain time
const SLOT_MINUTES = 60;
const MOUNTAIN_TZ = 'America/Denver';

const [fromArg, toArg] = process.argv.slice(2);
if (!fromArg || !toArg) {
  console.error('usage: node scripts/seed-slots.mjs <from YYYY-MM-DD> <to YYYY-MM-DD>');
  process.exit(1);
}

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

// Find the UTC instant for a Mountain-time wall clock on a given date.
function mountainDate(ymd, hour) {
  const [y, m, d] = ymd.split('-').map(Number);
  // Start from a UTC guess and correct by the zone offset at that instant.
  let guess = new Date(Date.UTC(y, m - 1, d, hour + 7)); // MST offset
  for (let i = 0; i < 2; i++) {
    const wall = new Intl.DateTimeFormat('en-US', {
      timeZone: MOUNTAIN_TZ, hour: 'numeric', hour12: false,
    }).format(guess);
    const diff = hour - (Number(wall) % 24);
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff * 3600_000);
  }
  return guess;
}

let created = 0;
const from = new Date(`${fromArg}T00:00:00Z`);
const to = new Date(`${toArg}T00:00:00Z`);
for (let day = new Date(from); day <= to; day.setUTCDate(day.getUTCDate() + 1)) {
  const ymd = day.toISOString().slice(0, 10);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'short',
  }).format(mountainDate(ymd, 12));
  if (weekday === 'Sat' || weekday === 'Sun') continue;

  for (const hour of SLOT_START_HOURS) {
    const start = mountainDate(ymd, hour);
    if (start.getTime() < Date.now()) continue;
    const id = start.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 16);
    await db.doc(`availability/${id}`).set(
      { start, durationMin: SLOT_MINUTES, state: 'open' },
      { merge: false }
    );
    created++;
  }
}
console.log(`created/updated ${created} open slots between ${fromArg} and ${toArg}`);
