// Availability editor (Phase 2, replaces the seed script): open slots in bulk
// across a date range, see what's open / held / booked, delete open slots.
// All writes go through the Worker — the browser never touches `availability`.

import { db, collection, getDocs } from './firebase.js';
import { requireAdmin, hydrateNav } from './auth.js';
import { mountOfficeControl } from './admin-hours.js';

const MOUNTAIN_TZ = 'Etc/GMT+7'; // MST = fixed UTC-7 (IANA sign is inverted)
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]; // last 60-min slot ends 7pm (CLOSE_HOUR in worker/schedule.js)
// Keep in sync with LEAD_TIME_HOURS in worker/schedule.js — slots inside the
// booking lead window are unbookable, so we neither create nor display them.
const LEAD_TIME_HOURS = 72;

hydrateNav();
const user = await requireAdmin();
if (user) init();

function init() {
  document.getElementById('hours').innerHTML = HOURS.map((h) => `
    <label class="inline" style="margin:0 .6rem .4rem 0;">
      <input type="checkbox" value="${h}" ${[9, 10, 11, 13, 14, 15, 16].includes(h) ? 'checked' : ''}>
      ${h <= 11 ? h + 'am' : h === 12 ? '12pm' : (h - 12) + 'pm'}
    </label>`).join('');
  document.getElementById('create').addEventListener('click', createSlots);
  // Eric, 2026-08-30: "make a button to clear the entire calendar." Wired
  // once; the ids it clears are whatever the latest paint found open.
  document.getElementById('clear-all').addEventListener('click', () =>
    clearSlots(openNow, 'across the whole calendar'));
  // In or out, on the page where the rest of his calendar decisions live. The
  // same control is on the shelf; both read and write the one settings doc.
  mountOfficeControl(document.getElementById('office'), { getToken: () => user.getIdToken() });
  wireClosure();
  loadCalendar();
}

/**
 * Shutting the books, from his phone.
 *
 * Eric, 2026-08-23: "close off my availability for next two weeks." The slots
 * themselves are left alone - deleting them is destructive and he has no way
 * to put them back - so this is one date that hides everything before it and
 * refuses everything before it, and Reopen restores the calendar exactly as
 * it was.
 */
function wireClosure() {
  const stateEl = document.getElementById('closure-state');
  const errEl = document.getElementById('closure-error');
  const paint = (msg) => {
    stateEl.innerHTML = msg
      ? `🚫 <strong>${msg}</strong>`
      : '✅ <strong>Open for new cases.</strong> Clients can book any slot below.';
  };
  const call = async (body) => {
    const token = await user.getIdToken();
    const res = await fetch('/api/admin/booking-closure', {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
    return out;
  };
  call().then((o) => paint(o.message)).catch(() => {
    stateEl.textContent = "Couldn't read whether the books are open.";
  });
  for (const btn of document.querySelectorAll('[data-close-weeks]')) {
    btn.addEventListener('click', async () => {
      errEl.hidden = true;
      btn.disabled = true;
      try {
        paint((await call({ weeks: Number(btn.dataset.closeWeeks) })).message);
        // The closure changes which slots are bookable, so the calendar below
        // is stale the moment this returns.
        loadCalendar();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
      btn.disabled = false;
    });
  }
}

async function createSlots() {
  const errEl = document.getElementById('create-error');
  const okEl = document.getElementById('create-ok');
  errEl.hidden = okEl.hidden = true;
  const from = document.getElementById('from').value;
  const to = document.getElementById('to').value;
  const hours = [...document.querySelectorAll('#hours input:checked')].map((i) => Number(i.value));
  const weekdaysOnly = document.getElementById('weekdays').checked;
  // A free 15-minute call or a case hour. Same start times, different length,
  // and the Worker stamps kind:'fit' so the paid picker never shows it.
  const fit = document.querySelector('input[name="kind"]:checked')?.value === 'fit';
  if (!from || !to || !hours.length) {
    errEl.textContent = 'Pick a date range and at least one start time.';
    errEl.hidden = false;
    return;
  }

  if (from > to) {
    errEl.textContent = `The start date (${fmtDay(from)}) is after the end date (${fmtDay(to)}).`;
    errEl.hidden = false;
    return;
  }

  // MST is fixed UTC-7: wall-clock hour h == UTC hour h+7. Track WHY each
  // candidate time is dropped so a zero-slot outcome can say the reason
  // instead of a generic shrug.
  const starts = [];
  const dropped = { weekend: 0, past: 0, lead: 0 };
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    for (const h of hours) {
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h + 7));
      if (weekdaysOnly) {
        const wd = new Intl.DateTimeFormat('en-US', { timeZone: MOUNTAIN_TZ, weekday: 'short' }).format(start);
        if (wd === 'Sat' || wd === 'Sun') { dropped.weekend++; continue; }
      }
      const leadMs = start.getTime() - Date.now();
      if (leadMs <= 0) { dropped.past++; continue; }
      // Inside the booking lead window = clients can never book it. Don't
      // create dead inventory; count it so the error can explain.
      if (leadMs < LEAD_TIME_HOURS * 3600_000) { dropped.lead++; continue; }
      starts.push(start.toISOString());
    }
  }
  if (!starts.length) {
    errEl.textContent = zeroSlotReason(dropped, from, to);
    errEl.hidden = false;
    return;
  }

  try {
    const idToken = await user.getIdToken();
    const res = await fetch('/api/admin/slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
      body: JSON.stringify(fit ? { starts, kind: 'fit' } : { starts, durationMin: 60 }),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
    okEl.textContent = `Opened ${out.created} ${fit ? 'free-call' : 'case'} slots (${out.skipped} already existed).`;
    okEl.hidden = false;
    loadCalendar();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
}

/** "Aug 1" / "Aug 1 – Aug 2" for the yyyy-mm-dd inputs, read as MST days. */
function fmtDay(ymd) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
    .format(new Date(`${ymd}T12:00:00Z`));
}

/** Explain WHY a range produced zero slots — never the generic shrug. */
function zeroSlotReason(dropped, from, to) {
  const range = from === to ? fmtDay(from) : `${fmtDay(from)}–${fmtDay(to)}`;
  const reasons = [];
  if (dropped.weekend)
    reasons.push(`${range} falls on a weekend and “Weekdays only” is checked`);
  if (dropped.past)
    reasons.push(`${dropped.past} of the times are already in the past`);
  if (dropped.lead)
    reasons.push(`${dropped.lead} of the times are inside the ${LEAD_TIME_HOURS}-hour booking lead window, so clients could never book them`);
  if (!reasons.length) return 'That range produces no slots — check the dates and start times.';
  if (reasons.length === 1) {
    // Single cause: make it read as one clean sentence.
    if (dropped.weekend && !dropped.past && !dropped.lead)
      return `No slots opened: ${range} falls on a weekend and “Weekdays only” is checked. Uncheck it, or pick weekdays.`;
    if (dropped.past && !dropped.weekend && !dropped.lead)
      return `No slots opened: every time in ${range} is already in the past.`;
    return `No slots opened: every time in ${range} is inside the ${LEAD_TIME_HOURS}-hour booking lead window — clients can't book with less than ${LEAD_TIME_HOURS} hours' notice. Pick dates at least ${Math.ceil(LEAD_TIME_HOURS / 24)} days out.`;
  }
  return `No slots opened: ${reasons.join('; ')}.`;
}

/**
 * Bulk clearing (Eric, 2026-08-30: "make a button to clear the entire
 * calendar, as well as a small x by the day to clear the day").
 *
 * One confirm, one request, one repaint. The Worker fences to slots that are
 * open at that moment, so a slot a client books between paint and tap
 * survives; booked and held appointments are never in the ids to begin with.
 */
let openNow = [];

async function clearSlots(ids, where) {
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} open ${ids.length === 1 ? 'slot' : 'slots'} ${where}? Booked appointments stay.`)) return;
  try {
    const idToken = await user.getIdToken();
    const res = await fetch('/api/admin/slots-clear', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ ids }),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
  } catch (err) {
    alert(err.message);
  }
  loadCalendar();
}

async function loadCalendar() {
  const el = document.getElementById('calendar');
  let slots = [];
  try {
    const snapshot = await getDocs(collection(db, 'availability'));
    snapshot.forEach((d) => slots.push({ id: d.id, ...d.data() }));
  } catch (err) {
    el.innerHTML = `<p class="error">Couldn't load: ${err.message}</p>`;
    return;
  }
  // Open slots that are past or inside the booking lead window are unbookable
  // — hide them here (the Worker cron deletes them from the database within
  // 15 minutes). Booked and held appointments stay visible.
  const unbookableBefore = Date.now() + LEAD_TIME_HOURS * 3600_000;
  slots = slots
    .map((s) => ({ ...s, startDate: s.start?.toDate ? s.start.toDate() : new Date(s.start) }))
    .filter((s) => s.startDate.getTime() > Date.now() - 86_400_000)
    .filter((s) => s.state !== 'open' || s.startDate.getTime() >= unbookableBefore)
    .sort((a, b) => a.startDate - b.startDate);
  openNow = slots.filter((s) => s.state === 'open').map((s) => s.id);
  document.getElementById('clear-all-row').hidden = !openNow.length;
  if (!slots.length) {
    el.innerHTML = '<p class="dim">No upcoming slots. Open some above.</p>';
    return;
  }

  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: MOUNTAIN_TZ, weekday: 'short', month: 'short', day: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: MOUNTAIN_TZ, hour: 'numeric', minute: '2-digit' });
  const byDay = new Map();
  for (const s of slots) {
    const key = dayFmt.format(s.startDate);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(s);
  }
  // The small x by the day (Eric, 2026-08-30): only days with something open
  // wear one, and it takes the day's open slots only.
  const days = [...byDay.entries()];
  el.innerHTML = days.map(([day, list], di) => `
    <div class="day"><h3>${day}${list.some((s) => s.state === 'open')
      ? ` <button class="day-x" data-day-clear="${di}" title="Clear this day" style="background:none; border:0; color:var(--soft); cursor:pointer; font-size:.9rem; padding:.1rem .4rem;">✕</button>`
      : ''}</h3><div class="slots">
      ${list.map((s) => s.state === 'open'
        ? `<button class="slot" data-del="${s.id}" title="Tap to delete">${timeFmt.format(s.startDate)}${s.kind === 'fit' ? ' <span class="local">free call, 15 min</span>' : ''} ✕</button>`
        : `<span class="slot booked">${timeFmt.format(s.startDate)} · ${s.kind === 'fit' ? 'FREE CALL' : s.state.toUpperCase()}</span>`).join('')}
    </div></div>`).join('');

  el.querySelectorAll('[data-day-clear]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const [day, list] = days[Number(btn.dataset.dayClear)];
      clearSlots(list.filter((s) => s.state === 'open').map((s) => s.id), `on ${day}`);
    }));

  el.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(`/api/admin/slots/${btn.dataset.del}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${idToken}` },
        });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error || 'Delete failed');
        loadCalendar();
      } catch (err) {
        btn.disabled = false;
        alert(err.message);
      }
    }));
}
