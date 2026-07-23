// The client's dedicated Chat tab — a focused, dark, messaging-app space,
// separate from the case dashboard. Shows the chat for their active case (and
// their subscriber line, if they have one); a small switcher appears when
// there's more than one thread.
import { db, collection, getDocs, doc, getDoc, query, where } from './firebase.js';
import { requireUser, hydrateNav } from './auth.js';
import { mountChat, watchPresence } from './chat.js';

hydrateNav();
const user = await requireUser();
if (user) load();

async function load() {
  const chatEl = document.getElementById('chat');
  watchPresence(document.querySelector('main'));

  const threads = [];
  try {
    const cases = await getDocs(query(collection(db, 'cases'), where('clientUid', '==', user.uid)));
    cases.forEach((d) => {
      const c = d.data();
      threads.push({
        key: `case:${d.id}`,
        label: c.status === 'closed' ? 'Case (closed)' : 'My case',
        parentPath: ['cases', d.id],
        closed: c.status === 'closed',
        ts: c.lastMessage?.ts ? tsMs(c.lastMessage.ts) : tsMs(c.createdAt),
      });
    });
    const sub = await getDoc(doc(db, 'subscriptions', user.uid));
    if (sub.exists()) {
      const s = sub.data();
      const end = s.currentPeriodEnd?.toDate ? s.currentPeriodEnd.toDate() : new Date(s.currentPeriodEnd || 0);
      threads.push({
        key: 'sub',
        label: 'Pocket Advocate line',
        parentPath: ['subscriptions', user.uid],
        closed: !(end > new Date()),
        ts: s.lastMessage?.ts ? tsMs(s.lastMessage.ts) : 0,
      });
    }
  } catch (err) {
    chatEl.innerHTML = `<p class="error">Couldn't load your chats: ${esc(err.message)}</p>`;
    return;
  }

  if (!threads.length) {
    chatEl.innerHTML = `<p class="dim">No conversations yet.</p>
      <p><a class="btn" href="/book.html">Book an Advocacy Case →</a> to start chatting with Eric.</p>`;
    return;
  }

  // Prefer an open thread; otherwise the most recently active one.
  threads.sort((a, b) => (a.closed - b.closed) || (b.ts - a.ts));
  let current = threads[0].key;

  const switcher = document.getElementById('switcher');
  if (threads.length > 1) {
    switcher.hidden = false;
    const paintTabs = () => {
      switcher.innerHTML = threads.map((t) =>
        `<button class="chip-label ${t.key === current ? 'selected' : ''}" data-thread="${t.key}">${esc(t.label)}</button>`
      ).join('');
      switcher.querySelectorAll('[data-thread]').forEach((b) =>
        b.addEventListener('click', () => { current = b.dataset.thread; paintTabs(); open(); }));
    };
    paintTabs();
  }

  function open() {
    const t = threads.find((x) => x.key === current);
    mountChat({
      container: chatEl,
      parentPath: t.parentPath,
      user,
      myRole: 'client',
      saveUid: user.uid,
      disabled: t.closed,
      notice: t.closed
        ? 'This conversation is closed. Your history stays here; book again or subscribe to reach Eric.'
        : '',
    });
  }
  open();
}

function tsMs(ts) {
  if (!ts) return 0;
  return ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime();
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
