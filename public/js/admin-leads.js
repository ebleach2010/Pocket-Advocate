// LEADS (Eric, 2026-10-14: "any person who has submitted their information
// through any route gets added to a 'leads' tab. This is a simple exportable
// csv that goes row by row for each potential client.")
//
// One row per person from /api/admin/leads, shown as a table and saved as a
// CSV with the same columns. The file is made in the browser from the same
// rows. On screen, who and how to reach them come first (the tighten audit,
// 2026-10-15: on a phone the dates filled the first screen); the CSV keeps
// its date-first order for a spreadsheet.
import { requireAdmin, hydrateNav, STAFF } from './auth.js';

export const COLUMNS = [
  ['firstContact', 'First contact'],
  ['lastContact', 'Last contact'],
  ['name', 'Name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['interestedIn', 'Interested in'],
  ['cameThrough', 'Came through'],
  ['notes', 'Questions and notes'],
];

/** The on-screen order, by key. Every CSV column, rearranged. */
export const SCREEN_ORDER = ['name', 'interestedIn', 'phone', 'email', 'cameThrough', 'firstContact', 'lastContact', 'notes'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** A date as 2026-10-14 in his time (MST), or ''. */
export function day(iso) {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime()) || t.getTime() === 0) return '';
  return new Date(t.getTime() - 7 * 3600_000).toISOString().slice(0, 10);
}

/**
 * One CSV cell: quoted when it must be, and never a formula a spreadsheet
 * would run. Something typed into a public form that starts like a formula
 * is opened as text; a phone number like +1 208 555 0100 is left as it is.
 */
export function cell(v) {
  let s = String(v ?? '');
  const phoneLike = /^[+\-]?[\d\s().-]+$/.test(s);
  if (/^[=+\-@\t\r]/.test(s) && !phoneLike) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The whole file: a header row, then one row per person. */
export function toCsv(leads) {
  const lines = [COLUMNS.map(([, h]) => cell(h)).join(',')];
  for (const l of leads) {
    lines.push(COLUMNS.map(([k]) => cell(k === 'firstContact' || k === 'lastContact' ? day(l[k]) : l[k])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

const HEAD = Object.fromEntries(COLUMNS);
const CELL = {
  firstContact: (l) => `<td class="n">${esc(day(l.firstContact))}</td>`,
  lastContact: (l) => `<td class="n">${esc(day(l.lastContact))}</td>`,
  name: (l) => `<td>${esc(l.name)}</td>`,
  email: (l) => `<td><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></td>`,
  phone: (l) => `<td class="n">${l.phone ? `<a href="tel:${esc(String(l.phone).replace(/[^\d+]/g, ''))}">${esc(l.phone)}</a>` : ''}</td>`,
  interestedIn: (l) => `<td>${esc(l.interestedIn)}</td>`,
  cameThrough: (l) => `<td>${esc(l.cameThrough)}</td>`,
  notes: (l) => `<td class="w">${esc(l.notes)}</td>`,
};

async function main() {
  hydrateNav();
  const user = await requireAdmin();
  if (!user) return;
  // His alone (2026-10-16): a contractor who lands here by address goes back to their shelf.
  if (STAFF.role !== 'admin') { location.replace('/admin.html'); return; }
  const box = document.getElementById('leads');
  const btn = document.getElementById('leads-csv');
  const count = document.getElementById('leads-count');
  let leads = [];
  try {
    const res = await fetch('/api/admin/leads', { headers: { authorization: `Bearer ${await user.getIdToken()}` } });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
    leads = out.leads || [];
    if (out.missing?.length) {
      box.insertAdjacentHTML('beforebegin', `<p class="error small">Could not read: ${esc(out.missing.join(', '))}. Those people are missing from this list and the CSV until it loads again.</p>`);
    }
  } catch (err) {
    box.innerHTML = `<p class="error small">Couldn't load your leads: ${esc(err.message)}</p>`;
    return;
  }
  count.textContent = `${leads.length} ${leads.length === 1 ? 'person' : 'people'}`;
  if (!leads.length) {
    box.innerHTML = '<p class="dim">Nobody yet. Everyone who joins the waitlist, sends a question or books lands here.</p>';
    return;
  }
  // A word that the table runs on (2026-10-17): on a phone the phone and
  // email columns sit off to the right with nothing to say so.
  box.innerHTML = `<p class="dim small leads-hint">Swipe the table sideways for every column.</p><div class="leads-wrap"><table class="leads">
    <thead><tr>${SCREEN_ORDER.map((k) => `<th scope="col">${esc(HEAD[k])}</th>`).join('')}</tr></thead>
    <tbody>${leads.map((l) => `<tr>${SCREEN_ORDER.map((k) => CELL[k](l)).join('')}</tr>`).join('')}</tbody></table></div>`;
  btn.disabled = false;
  btn.addEventListener('click', () => {
    const blob = new Blob([toCsv(leads)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pocket-advocate-leads-${day(new Date().toISOString())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
}

if (typeof document !== 'undefined') main();
