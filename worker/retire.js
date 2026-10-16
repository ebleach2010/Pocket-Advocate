// DEMO MODE REPLACES THEM (Eric, 2026-10-16). Asked whether Joe Bloe, the
// showcase, and Maya Torres, the sample contractor, should stay now that Demo
// mode does what they did: "Remove both". With a screenshot of her invented
// clients on his shelf the same day: his real Clients and Employer mode show
// only real people.
//
// Once, from the cron: every case that says showcase (Joe Bloe, and her
// clients, which say it too) is wiped with everything under it, and her own
// three records go. Nothing real can match: a real client's case never carries
// `showcase`, and she is found by her own uid alone. A flag in config/once
// stops it running again; an isolate that has seen the flag asks no more.

import { getDoc, patchDoc, queryDocs, batchDelete } from './firestore.js';
import { wipeCase } from './showcase.js';
import { SAMPLE_UID } from './employer.js';

export const RETIRE_FLAG = 'samplesRetired';
let settled = false;

export async function retireSamples(env) {
  if (settled) return { skipped: 'settled' };
  const once = await getDoc(env, 'config/once').catch(() => undefined);
  // Unreadable is not "not done": try again on a later minute.
  if (once === undefined) return { skipped: 'unreadable' };
  if (once?.data?.[RETIRE_FLAG]) { settled = true; return { skipped: 'done' }; }
  const fakes = await queryDocs(env, 'cases', [['showcase', 'EQUAL', true]], 100).catch(() => null);
  if (!fakes) return { skipped: 'unreadable' };
  let wiped = 0;
  for (const r of fakes) {
    if (r.data?.showcase !== true) continue;
    await wipeCase(env, r.id, { adminUid: env.ADMIN_UID });
    wiped += 1;
  }
  await batchDelete(env, [`advocates/${SAMPLE_UID}`, `staffChats/${SAMPLE_UID}`, `payouts/${SAMPLE_UID}`]).catch(() => {});
  await patchDoc(env, 'config/once', { [RETIRE_FLAG]: new Date() }, { mask: [RETIRE_FLAG] });
  settled = true;
  return { wiped };
}
