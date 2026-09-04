// The admin chat inbox (SPEC §D): case chats and subscriber chats in one
// list, newest activity first, with an unread hint when the last word was
// the client's. Also holds the subscriber thread view (?sub=<uid>).

import './admin-ledger.js';
import { db, collection, getDocs, doc, getDoc } from './firebase.js';
import { requireAdmin, hydrateNav } from './auth.js';
import { mountChat } from './chat.js';

hydrateNav();
const user = await requireAdmin();
const subUid = new URLSearchParams(location.search).get('sub');
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
    <p><a href="/admin-chats.html" class="small">← all chats</a></p>
    <div class="row">
      <h1 style="margin:0;">${esc(sub.email || subUid)}</h1>
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
    disabled: false,
  });
}

// ---- inbox ----
async function loadInbox() {
  const page = document.getElementById('page');
  const threads = [];
  try {
    const [cases, subs] = await Promise.all([
      getDocs(collection(db, 'cases')),
      getDocs(collection(db, 'subscriptions')),
    ]);
    cases.forEach((d) => {
      const c = d.data();
      threads.push({
        kind: 'case',
        href: `/admin-case.html?id=${d.id}`,
        // His own case has no client behind it (audit, 2026-09-03): name it as his.
        who: c.self ? `${c.clientName || 'My own case'} (mine)` : (c.clientEmail || c.clientUid),
        badge: `CASE · ${(c.status || '?').replace('_', ' ').toUpperCase()}`,
        lm: c.lastMessage || null,
      });
    });
    subs.forEach((d) => {
      const s = d.data();
      threads.push({
        kind: 'sub',
        href: `/admin-chats.html?sub=${d.id}`,
        who: s.email || d.id,
        badge: `SUBSCRIBER · ${(s.status || '?').toUpperCase()}`,
        lm: s.lastMessage || null,
      });
    });
  } catch (err) {
    page.innerHTML = `<p class="error">Couldn't load chats: ${esc(err.message)}</p>`;
    return;
  }

  threads.sort((a, b) => lmTime(b) - lmTime(a));
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  page.innerHTML = `
    <h1>Chats</h1>
    <div class="panel">
      <h3>Response line</h3>
      <p class="dim small">The line clients see about timing is set beside your
        in/out switch, under <strong>Your status</strong> on the shelf. One line,
        one place: it shows on the subscriber page and inside the "?" answer, and
        clearing it clears it in both.</p>
    </div>
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
            ${t.lm ? `${t.lm.role === 'admin' ? 'You: ' : ''}${esc(t.lm.text)} · ${fmt.format(lmTime(t))}` : 'No messages yet.'}
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

function lmTime(t) {
  if (!t.lm || !t.lm.ts) return 0;
  return t.lm.ts.toDate ? t.lm.ts.toDate().getTime() : new Date(t.lm.ts).getTime();
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
