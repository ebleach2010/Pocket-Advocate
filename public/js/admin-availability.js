// Availability editor (Phase 2, replaces the seed script): open slots in bulk
// across a date range, see what's open / held / booked, delete open slots.
// All writes go through the Worker — the browser never touches `availability`.

import { db, collection, getDocs } from './firebase.js';
import { requireAdmin, hydrateNav } from './auth.js';

const MOUNTAIN_TZ = 'Etc/GMT+7'; // MST = fixed UTC-7 (IANA sign is inverted)
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]; // last 60-min slot ends 6pm

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
  loadCalendar();
}

async function createSlots() {
  const errEl = document.getElementById('create-error');
  const okEl = document.getElementById('create-ok');
  errEl.hidden = okEl.hidden = true;
  const from = document.getElementById('from').value;
  const to = document.getElementById('to').value;
  const hours = [...document.querySelectorAll('#hours input:checked')].map((i) => Number(i.value));
  const weekdaysOnly = document.getElementById('weekdays').checked;
  if (!from || !to || !hours.length) {
    errEl.textContent = 'Pick a date range and at least one start time.';
    errEl.hidden = false;
    return;
  }

  // MST is fixed UTC-7: wall-clock hour h == UTC hour h+7.
  const starts = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    for (const h of hours) {
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h + 7));
      if (weekdaysOnly) {
        const wd = new Intl.DateTimeFormat('en-US', { timeZone: MOUNTAIN_TZ, weekday: 'short' }).format(start);
        if (wd === 'Sat' || wd === 'Sun') continue;
      }
      if (start.getTime() > Date.now()) starts.push(start.toISOString());
    }
  }
  if (!starts.length) {
    errEl.textContent = 'That range produces no future slots.';
    errEl.hidden = false;
    return;
  }

  try {
    const idToken = await user.getIdToken();
    const res = await fetch('/api/admin/slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ starts, durationMin: 60 }),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
    okEl.textContent = `Opened ${out.created} slots (${out.skipped} already existed).`;
    okEl.hidden = false;
    loadCalendar();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
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
  slots = slots
    .map((s) => ({ ...s, startDate: s.start?.toDate ? s.start.toDate() : new Date(s.start) }))
    .filter((s) => s.startDate.getTime() > Date.now() - 86_400_000)
    .sort((a, b) => a.startDate - b.startDate);
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
  el.innerHTML = [...byDay.entries()].map(([day, list]) => `
    <div class="day"><h3>${day}</h3><div class="slots">
      ${list.map((s) => s.state === 'open'
        ? `<button class="slot" data-del="${s.id}" title="Tap to delete">${timeFmt.format(s.startDate)} ✕</button>`
        : `<span class="slot booked">${timeFmt.format(s.startDate)} · ${s.state.toUpperCase()}</span>`).join('')}
    </div></div>`).join('');

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
