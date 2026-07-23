// The admin month calendar: every availability slot (open / held / booked)
// on a real grid, MST like everything else. Tapping a day lists its slots
// with client names and links into the case.

import { db, collection, getDocs } from './firebase.js';
import { requireAdmin, hydrateNav } from './auth.js';

const MOUNTAIN_TZ = 'Etc/GMT+7';

hydrateNav();
const user = await requireAdmin();

let slots = []; // { id, start: Date, state, caseId }
let caseInfo = {}; // caseId -> { name, status }
let shown = new Date(); // any date inside the displayed month (MST frame)

if (user) init();

async function init() {
  try {
    const [slotSnap, caseSnap] = await Promise.all([
      getDocs(collection(db, 'availability')),
      getDocs(collection(db, 'cases')),
    ]);
    slotSnap.forEach((d) => {
      const s = d.data();
      slots.push({ id: d.id, start: toDate(s.start), state: s.state || 'open', caseId: s.caseId || null });
    });
    caseSnap.forEach((d) => {
      const c = d.data();
      caseInfo[d.id] = { name: c.clientName || c.clientEmail || 'client', status: c.status };
    });
  } catch (err) {
    document.getElementById('cal-grid').innerHTML = `<p class="error">Couldn't load: ${esc(err.message)}</p>`;
    return;
  }
  document.getElementById('cal-prev').addEventListener('click', () => shift(-1));
  document.getElementById('cal-next').addEventListener('click', () => shift(1));
  document.getElementById('cal-today').addEventListener('click', () => { shown = new Date(); render(); });
  render();
}

function shift(months) {
  const p = mtParts(shown);
  shown = new Date(Date.UTC(p.year, p.month - 1 + months, 15, 12));
  render();
}

/** Y/M/D of a date as seen from MST. */
function mtParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { year: +get('year'), month: +get('month'), day: +get('day'), weekday: get('weekday') };
}

function dayKey(date) {
  const p = mtParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function render() {
  const p = mtParts(shown);
  const title = new Intl.DateTimeFormat('en-US', { timeZone: MOUNTAIN_TZ, month: 'long', year: 'numeric' })
    .format(new Date(Date.UTC(p.year, p.month - 1, 15, 12)));
  document.getElementById('cal-title').textContent = title;

  document.getElementById('cal-head').innerHTML =
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<div class="cal-dow">${d}</div>`).join('');

  // First day of the month at noon MST (7pm UTC keeps us safely inside the day).
  const first = new Date(Date.UTC(p.year, p.month - 1, 1, 19));
  const firstDow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(mtParts(first).weekday);
  const daysInMonth = new Date(p.year, p.month, 0).getDate();
  const todayKey = dayKey(new Date());

  const byDay = {};
  for (const s of slots) {
    const k = dayKey(s.start);
    (byDay[k] = byDay[k] || []).push(s);
  }

  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: MOUNTAIN_TZ, hour: 'numeric', minute: '2-digit' });
  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += '<div class="cal-cell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const k = `${p.year}-${String(p.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const daySlots = (byDay[k] || []).sort((a, b) => a.start - b.start);
    const booked = daySlots.filter((s) => s.state === 'booked');
    const held = daySlots.filter((s) => s.state === 'held');
    const open = daySlots.filter((s) => s.state === 'open');
    const marks =
      booked.slice(0, 2).map((s) => `<div class="cal-mark booked">${timeFmt.format(s.start)} ${esc(shortName(s))}</div>`).join('') +
      (booked.length > 2 ? `<div class="cal-mark booked">+${booked.length - 2} more</div>` : '') +
      (held.length ? `<div class="cal-mark held">${held.length} pending</div>` : '') +
      (open.length ? `<div class="cal-mark open">${open.length} open</div>` : '');
    cells += `<div class="cal-cell${k === todayKey ? ' today' : ''}${daySlots.length ? ' has-events' : ''}" data-day="${k}">
      <span class="cal-date">${d}</span>${marks}</div>`;
  }
  document.getElementById('cal-grid').innerHTML = cells;
  document.getElementById('cal-day').innerHTML = '';

  document.querySelectorAll('.cal-cell.has-events').forEach((cell) =>
    cell.addEventListener('click', () => showDay(cell.dataset.day, byDay[cell.dataset.day] || [])));
}

function shortName(s) {
  const name = s.caseId ? (caseInfo[s.caseId]?.name || 'client') : '';
  return name.split(' ')[0] || name;
}

function showDay(key, daySlots) {
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric',
  });
  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: MOUNTAIN_TZ, hour: 'numeric', minute: '2-digit' });
  const rows = daySlots.sort((a, b) => a.start - b.start).map((s) => {
    const label = s.state === 'booked'
      ? `<strong style="color:var(--cyan)">${esc(caseInfo[s.caseId]?.name || 'client')}</strong> <span class="dim small">· ${(caseInfo[s.caseId]?.status || '').replace('_', ' ')}</span>`
      : s.state === 'held'
        ? '<strong style="color:var(--magenta)">held — awaiting payment</strong>'
        : '<span class="dim">open slot</span>';
    const link = s.caseId ? ` <a class="small" href="/admin-case.html?id=${s.caseId}">open case →</a>` : '';
    return `<li><span class="fname"><strong>${timeFmt.format(s.start)} MST</strong> &nbsp; ${label}</span><span class="fmeta">${link}</span></li>`;
  }).join('');
  document.getElementById('cal-day').innerHTML = `
    <div class="panel" style="margin-top:1rem;">
      <h3>${dateFmt.format(daySlots[0].start)}</h3>
      <ul class="filelist">${rows}</ul>
    </div>`;
}

function toDate(v) { return v?.toDate ? v.toDate() : new Date(v || 0); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
