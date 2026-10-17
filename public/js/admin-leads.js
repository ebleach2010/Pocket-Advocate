// LEADS (Eric, 2026-10-14: "any person who has submitted their information
// through any route gets added to a 'leads' tab. This is a simple exportable
// csv that goes row by row for each potential client.")
//
// One card per person from /api/admin/leads, and a CSV with the same people.
// The file is made in the browser from the same rows and keeps its date-first
// columns for a spreadsheet. On screen each person is a card (2026-10-17):
// the table ran off the side of his phone and a lead's message with it ("It
// says my lead Rosemarie sent me a message but I don't see it ... put it in an
// expandable chat box or email like container"). Their words open under their
// name as a conversation, his replies go to their email, and anyone with
// something new sits at the top.
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

/** The card's order, by key: who and how to reach them first, then where they came from, then their words. */
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

/** When a message came, in his time (MST): Oct 14, 3:05 PM. */
export function when(iso) {
  const t = new Date(iso || 0);
  if (!iso || Number.isNaN(t.getTime()) || t.getTime() === 0) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(t);
}

/** One message in the conversation: theirs on the left, his on the right. */
export function bubble(m) {
  const how = m.from === 'me' ? 'You, by email' : (m.via === 'Question' ? 'Question box' : m.via || '');
  return `<div class="lm ${m.from === 'me' ? 'me' : 'them'}">${esc(m.text)}<span class="lm-when">${esc([when(m.at), how].filter(Boolean).join(' · '))}</span></div>`;
}

/** One person: who they are, how to reach them, and their messages to open. */
export function card(l) {
  const msgs = Array.isArray(l.messages) ? l.messages : [];
  const theirs = msgs.filter((m) => m.from !== 'me').length;
  const list2 = (v) => String(v || '').split('; ').filter(Boolean).join(', ');
  const meta = [list2(l.interestedIn), list2(l.cameThrough), l.lastContact ? `Last contact ${day(l.lastContact)}` : ''].filter(Boolean).join(' · ');
  const tel = l.phone ? `<a class="btn quiet" href="tel:${esc(String(l.phone).replace(/[^\d+]/g, ''))}">Call ${esc(l.phone)}</a>` : '';
  const app = l.appLink && /^\/admin-(case|chats)\.html\?/.test(l.appLink) ? `<a class="btn quiet" href="${esc(l.appLink)}">Their chat in the app</a>` : '';
  const convo = msgs.length ? `
      <details class="lead-msgs" data-msgs${l.unread ? ' open' : ''}>
        <summary>Messages (${theirs})${l.unread ? ' <span class="lead-pill new">New</span>' : ''}</summary>
        <div class="lead-thread" data-thread>${msgs.map(bubble).join('')}</div>
        <form class="lead-reply" data-reply>
          <label class="dim small" for="r-${esc(l.key)}">Reply to ${esc(l.name || l.email)}</label>
          <textarea class="ask-input" id="r-${esc(l.key)}" name="text" maxlength="4000" required placeholder="Write your reply"></textarea>
          <div class="row"><button type="submit" class="btn glow">Send reply</button><span class="dim small">It goes to ${esc(l.email)}. Their answer comes to your email.</span></div>
          <p class="error small" data-err hidden></p>
        </form>
      </details>` : '';
  return `<article class="lead-card${l.unread ? ' is-new' : ''}" data-lead="${esc(l.key || '')}" data-email="${esc(l.email)}">
      <div class="lead-top"><h2 class="lead-name">${esc(l.name || l.email)}</h2>${l.unread ? '<span class="lead-pill new">New message</span>' : ''}</div>
      <p class="lead-meta">${esc(meta)}</p>
      <div class="lead-acts">${tel}<a class="btn quiet" href="mailto:${esc(l.email)}">Email ${esc(l.email)}</a>${app}</div>${convo}
    </article>`;
}

/** New messages first, everyone else as the Worker sent them (newest contact first). */
export function ordered(leads) {
  return [...leads.filter((l) => l.unread), ...leads.filter((l) => !l.unread)];
}

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
  const list = ordered(leads);
  const fresh = list.filter((l) => l.unread).length;
  box.innerHTML = `${fresh ? `<p class="lead-new-head">${fresh} new ${fresh === 1 ? 'message' : 'messages'}</p>` : ''}<div class="lead-list">${list.map(card).join('')}</div>`;
  const post = async (body) => {
    const res = await fetch('/api/admin/leads', {
      method: 'POST',
      headers: { authorization: `Bearer ${await user.getIdToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `That did not work (${res.status}).`);
    return out;
  };
  // Reading their messages: opening them, or three seconds with them open on screen, tells the Worker,
  // so next time they are not New. The marks stay on this screen until a reply, so nothing jumps.
  const seen = new Set();
  const markRead = (el) => {
    if (seen.has(el) || !el.classList.contains('is-new')) return;
    seen.add(el);
    post({ action: 'seen', email: el.dataset.email }).catch(() => seen.delete(el));
  };
  const timers = new Map();
  const watch = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
    for (const en of entries) {
      const el = en.target;
      clearTimeout(timers.get(el));
      if (en.isIntersecting && el.querySelector('[data-msgs]')?.open) timers.set(el, setTimeout(() => markRead(el), 3000));
    }
  }, { threshold: 0.6 }) : null;
  for (const el of box.querySelectorAll('.lead-card')) {
    const det = el.querySelector('[data-msgs]');
    if (!det) continue;
    det.addEventListener('click', (e) => { if (e.target.closest('summary') && !det.open) markRead(el); });
    if (el.classList.contains('is-new')) watch?.observe(el);
    const form = el.querySelector('[data-reply]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const send = form.querySelector('button[type="submit"]');
      const err = form.querySelector('[data-err]');
      const text = form.elements.text.value.trim();
      if (!text) return;
      send.disabled = true;
      err.hidden = true;
      try {
        const out = await post({ action: 'reply', email: el.dataset.email, text });
        el.querySelector('[data-thread]').insertAdjacentHTML('beforeend', bubble(out.reply));
        form.elements.text.value = '';
        // Answered: the Worker marked it read with the reply.
        seen.add(el);
        el.classList.remove('is-new');
        el.querySelectorAll('.lead-pill.new').forEach((p) => p.remove());
      } catch (x) {
        err.textContent = x.message;
        err.hidden = false;
      }
      send.disabled = false;
    });
  }
  // A push about a message opens on that person, their messages open (?lead=).
  const want = new URLSearchParams(location.search).get('lead');
  const target = want && [...box.querySelectorAll('.lead-card')].find((el) => el.dataset.lead === want);
  if (target) {
    const det = target.querySelector('[data-msgs]');
    if (det) det.open = true;
    target.scrollIntoView({ block: 'start' });
  }
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
