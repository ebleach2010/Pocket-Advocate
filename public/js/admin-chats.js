// The admin chat inbox (SPEC §D): case chats and subscriber chats in one
// list, newest activity first, with an unread hint when the last word was
// the client's. Also holds the subscriber thread view (?sub=<uid>).

import './admin-ledger.js';
import { db, collection, getDocs, doc, getDoc } from './firebase.js';
import { requireAdmin, hydrateNav, staffCasesQuery, staffSubsQuery, STAFF } from './auth.js';
import { mountChat } from './chat.js';

hydrateNav();
const user = await requireAdmin();
const subUid = new URLSearchParams(location.search).get('sub');
// A team member's view, from their shelf (2026-10-16): his to read, never to
// write in, the same as their case pages.
const asUid = STAFF.role === 'admin' ? (new URLSearchParams(location.search).get('as') || '').replace(/[^\w-]/g, '').slice(0, 64) : '';
if (user) subUid ? loadThread() : loadInbox();

// ---- subscriber thread view ----
async function loadThread() {
  const page = document.getElementById('page');
  let sub = null;
  try {
    const snapshot = await getDoc(doc(db, 'subscriptions', subUid));
    if (snapshot.exists()) sub = snapshot.data();
  } catch { /* fallthrough */ }
  if (!sub) {
    page.innerHTML = '<p class="error">No such subscriber.</p><p><a href="/admin-chats.html">← all chats</a></p>';
    return;
  }
  const end = sub.currentPeriodEnd?.toDate ? sub.currentPeriodEnd.toDate() : new Date(sub.currentPeriodEnd || 0);
  page.innerHTML = `
    ${asUid
      ? `<div class="quiet-bar" role="status"><span>Seeing what their advocate sees. They cannot tell you are here, and nothing here can be sent.</span> <a class="btn quiet" href="/admin.html?as=${encodeURIComponent(asUid)}">Back to their shelf</a></div>`
      : '<p><a href="/admin-chats.html" class="small">← all chats</a></p>'}
    <div class="row">
      <h1 style="margin:0; overflow-wrap:anywhere;">${esc(sub.name || sub.email || subUid)}</h1>
      <span class="status-pill ${end > new Date() ? '' : 'closed'}">SUBSCRIBER · ${(sub.status || '?').toUpperCase()}</span>
    </div>
    <div class="panel" id="chat" style="margin-top:.8rem;"></div>`;
  mountChat({
    container: document.getElementById('chat'),
    parentPath: ['subscriptions', subUid],
    user,
    myRole: 'admin',
    saveUid: subUid,
    // Eric can always write; the client-side gate is the one that lapses.
    // In a team member's view, nobody writes.
    disabled: !!asUid,
    notice: asUid ? 'Seeing what they see. Nothing you type here is sent.' : '',
    viewAs: asUid || '',
  });
}

// ---- inbox ----
async function loadInbox() {
  const page = document.getElementById('page');
  const threads = [];
  // Who wrote the last word (2026-10-17): "You" only for his own; a team
  // member's reply carries their first name, and on a team member's inbox a
  // word from him carries his.
  const names = new Map();
  const team = STAFF.role === 'admin'
    ? user.getIdToken().then((token) => fetch('/api/admin/advocates', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"action":"list"}',
    })).then((r) => r.json()).then((out) => {
      for (const a of out.advocates || []) if (a.uid && !a.owner) names.set(a.uid, String(a.name || a.email || '').trim().split(/\s+/)[0]);
    }).catch(() => {})
    : Promise.resolve();
  try {
    // Every thread for him, their own for an advocate (2026-10-15).
    const [cases, subs] = await Promise.all([
      getDocs(staffCasesQuery(user)),
      getDocs(staffSubsQuery(user)),
      team,
    ]);
    cases.forEach((d) => {
      const c = d.data();
      threads.push({
        kind: 'case',
        href: `/admin-case.html?id=${d.id}`,
        // His own case has no client behind it (audit, 2026-09-03): name it as his.
        who: c.self ? `${c.clientName || 'My own case'} (mine)` : (c.clientName || c.clientEmail || c.clientUid),
        // What they bought (2026-10-15), so one name on two threads reads as two purchases, not two people.
        badge: c.self ? 'MY OWN CASE' : c.fullAccess ? 'FULL-SERVICE' : 'ADVOCACY CASE',
        lm: c.lastMessage || null,
      });
    });
    subs.forEach((d) => {
      const s = d.data();
      threads.push({
        kind: 'sub',
        href: `/admin-chats.html?sub=${d.id}`,
        who: s.name || s.email || d.id,
        badge: `PRIORITY CHAT · ${(s.status || '?').toUpperCase()}`,
        lm: s.lastMessage || null,
      });
    });
  } catch (err) {
    page.innerHTML = `<p class="error">Couldn't load chats: ${esc(err.message)}</p>`;
    return;
  }

  const byLine = (lm) => {
    if (lm.role !== 'admin') return '';
    if (!lm.from || lm.from === user.uid) return 'You: ';
    const n = lm.byName || (STAFF.role === 'admin' ? names.get(lm.from) : 'Eric');
    return n ? `${esc(n)}: ` : '';
  };
  threads.sort((a, b) => lmTime(b) - lmTime(a));
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  page.innerHTML = `
    <h1>Chats</h1>
    <div id="threads">
      ${threads.length ? threads.map((t) => `
        <a class="panel" style="display:block; text-decoration:none; color:inherit;" href="${t.href}">
          <div class="row">
            <strong>${esc(t.who)}</strong>
            <span>
              ${t.lm && t.lm.role === 'client' ? '<span class="unread-hint">NEW</span> ' : ''}
              <span class="status-pill ${t.kind === 'sub' ? '' : 'closed'}">${t.badge}</span>
            </span>
          </div>
          <p class="dim small" style="margin:.3rem 0 0;">
            ${t.lm ? `${byLine(t.lm)}${esc(t.lm.text)}${lmTime(t) ? ` · ${fmt.format(lmTime(t))}` : ''}` : 'No messages yet.'}
          </p>
        </a>`).join('') : '<p class="dim">No conversations yet.</p>'}
    </div>`;

  // THE SECOND EDITOR FOR THE RESPONSE LINE USED TO LIVE HERE, writing
  // settings/subscriberChat while the "?" sheet read a different document. Two
  // stores for one promise meant a subscriber could be shown two different
  // answers about how fast a reply comes, two taps apart, both of them current
  // and neither of them wrong. The line is now edited in exactly one place,
  // beside the in/out switch, and served from exactly one place.
}

// A time that cannot be read is no time (2026-10-15): one unreadable stamp
// threw "Invalid time value" in the date formatter and left the whole inbox
// on Loading.
function lmTime(t) {
  const ts = t.lm?.ts;
  if (!ts) return 0;
  const ms = ts.toDate ? ts.toDate().getTime() : typeof ts.seconds === 'number' ? ts.seconds * 1000 : new Date(ts).getTime();
  return Number.isFinite(ms) ? ms : 0;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
