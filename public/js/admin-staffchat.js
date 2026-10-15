// THE TEMPORARY CHAT BETWEEN ERIC AND AN ADVOCATE (Eric, 2026-10-15): "send
// them a message as admin that appears as a temporary chat box at the top of
// their screen with a white background. I can close the chat at any time and
// it removes the chat completely and deletes all messages." And: "They can
// message me through the little bottom right chat icon in their dashboard."
//
// One thread per advocate, kept by the Worker (/api/staff/chat) and read by
// asking it: no browser reads the thread directly. An advocate gets the chat
// icon at the bottom right of every working page and, whenever the thread
// has something in it, the white box at the top. He opens his side from
// employer mode. When he closes it, it is gone for both of them.

const CSS = `
  .sc-fab {
    position: fixed; right: max(16px, env(safe-area-inset-right, 0px)); bottom: max(16px, env(safe-area-inset-bottom, 0px)); z-index: 45;
    display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; border: 0; cursor: pointer;
    background: linear-gradient(110deg, #3DDCF5 0%, #9BEBFA 48%, #B9A6FF 100%); color: #02161A;
    box-shadow: 0 0 0 1px rgba(61, 220, 245, .55), 0 10px 28px rgba(0, 0, 0, .45);
  }
  .sc-fab svg { width: 26px; height: 26px; }
  .sc-fab:focus-visible { outline: 2px solid #F5F5F7; outline-offset: 3px; }
  .sc-dot { position: absolute; top: 4px; right: 4px; width: 14px; height: 14px; border-radius: 50%; background: #FF5D5D; box-shadow: 0 0 0 2px #0A0A0C; }
  .sc-box {
    position: fixed; left: 50%; transform: translateX(-50%); z-index: 46;
    top: calc(var(--demo-bar-h, 0px) + var(--bar-h, 56px) + 8px);
    width: min(30rem, calc(100vw - 24px)); max-height: min(60vh, 32rem);
    display: flex; flex-direction: column;
    background: #FFFFFF; color: #16161A; border-radius: 18px;
    box-shadow: 0 18px 50px rgba(0, 0, 0, .55), 0 0 0 1px rgba(0, 0, 0, .06);
    font: 500 .95rem/1.45 'Manrope', -apple-system, 'Segoe UI', system-ui, sans-serif;
  }
  .sc-box[hidden] { display: none; }
  .sc-head { display: flex; align-items: flex-start; gap: .6rem; padding: .8rem .9rem .5rem; border-bottom: 1px solid #ECECEF; }
  .sc-head h2 { margin: 0; font: 700 1rem/1.3 'Sora', 'Manrope', system-ui, sans-serif; color: #16161A; }
  .sc-head p { margin: .1rem 0 0; color: #5C5C66; font-size: .8rem; }
  .sc-head .sc-x { margin-left: auto; flex: none; min-width: 44px; min-height: 44px; border: 0; border-radius: 12px; background: #F2F2F5; color: #16161A; font: 700 .85rem/1 'Manrope', system-ui, sans-serif; cursor: pointer; }
  .sc-log { flex: 1; overflow-y: auto; padding: .7rem .9rem; display: flex; flex-direction: column; gap: .45rem; }
  .sc-msg { max-width: 85%; padding: .5rem .75rem; border-radius: 14px; background: #F2F2F5; color: #16161A; white-space: pre-wrap; overflow-wrap: anywhere; }
  .sc-msg.mine { align-self: flex-end; background: #16161A; color: #FFFFFF; }
  .sc-msg time { display: block; margin-top: .15rem; font-size: .7rem; opacity: .65; }
  .sc-empty { color: #5C5C66; font-size: .88rem; margin: 0; }
  .sc-form { display: flex; gap: .5rem; padding: .6rem .9rem .8rem; border-top: 1px solid #ECECEF; }
  .sc-form textarea { flex: 1; min-height: 44px; max-height: 8rem; resize: none; padding: .55rem .7rem; border: 1px solid #D8D8DE; border-radius: 12px; background: #FFFFFF; color: #16161A; font: 500 16px/1.35 'Manrope', system-ui, sans-serif; }
  .sc-form button { min-height: 44px; padding: 0 1rem; border: 0; border-radius: 12px; background: #16161A; color: #FFFFFF; font: 700 .9rem/1 'Manrope', system-ui, sans-serif; cursor: pointer; }
  .sc-close-all { margin: 0 .9rem .8rem; min-height: 44px; border: 1px solid #E3B4B4; border-radius: 12px; background: #FFF5F5; color: #8A1F1F; font: 700 .85rem/1 'Manrope', system-ui, sans-serif; cursor: pointer; }
  .sc-err { margin: 0 .9rem .6rem; color: #8A1F1F; font-size: .82rem; }
  .sc-box :focus-visible { outline: 2px solid #1E8FA3; outline-offset: 2px; }`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const timeFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
let styled = false;
function style() {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

async function api(user, method, { uid, body } = {}) {
  const token = await user.getIdToken();
  const q = uid ? `?uid=${encodeURIComponent(uid)}` : '';
  const res = await fetch(`/api/staff/chat${q}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `That did not go through (${res.status}).`);
  return out;
}

/** The box itself: a header, the thread, a reply line. Used on both sides. */
function buildBox({ title, line, mineSide, closeLabel, onClose, onSend, onCloseAll }) {
  style();
  const box = document.createElement('section');
  box.className = 'sc-box';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', title);
  box.innerHTML = `
    <div class="sc-head">
      <div><h2>${esc(title)}</h2><p>${esc(line)}</p></div>
      <button type="button" class="sc-x" data-sc-x>${esc(closeLabel)}</button>
    </div>
    <div class="sc-log" data-sc-log aria-live="polite"><p class="sc-empty">Loading…</p></div>
    <form class="sc-form" data-sc-form>
      <textarea data-sc-input rows="1" maxlength="1000" placeholder="Write a message…" aria-label="Message"></textarea>
      <button type="submit">Send</button>
    </form>
    <p class="sc-err" data-sc-err hidden></p>
    ${onCloseAll ? '<button type="button" class="sc-close-all" data-sc-all>Close the chat and delete every message</button>' : ''}`;
  const log = box.querySelector('[data-sc-log]');
  const err = box.querySelector('[data-sc-err]');
  const input = box.querySelector('[data-sc-input]');
  box.querySelector('[data-sc-x]').addEventListener('click', onClose);
  box.querySelector('[data-sc-all]')?.addEventListener('click', onCloseAll);
  box.querySelector('[data-sc-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    err.hidden = true;
    try { await onSend(text); input.value = ''; } catch (x) { err.textContent = x.message; err.hidden = false; }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      box.querySelector('[data-sc-form]').requestSubmit();
    }
  });
  let shown = '';
  const paint = (messages, emptyText) => {
    const key = JSON.stringify(messages.map((m) => m.id));
    if (key === shown) return;
    shown = key;
    log.innerHTML = messages.length
      ? messages.map((m) => `<div class="sc-msg${m.from === mineSide ? ' mine' : ''}">${esc(m.text)}<time>${esc(timeFmt.format(new Date(m.at)))}</time></div>`).join('')
      : `<p class="sc-empty">${esc(emptyText)}</p>`;
    log.scrollTop = log.scrollHeight;
  };
  return { box, paint, input };
}

/**
 * An advocate's side: the icon at the bottom right, and the white box at the
 * top whenever the thread has something in it. Asks the Worker every fifteen
 * seconds while the page is open, and at once when it comes back into view.
 */
export function mountStaffChat(user) {
  if (!user || document.querySelector('.sc-fab')) return;
  style();
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'sc-fab';
  fab.setAttribute('aria-label', 'Message Eric');
  fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  document.body.appendChild(fab);
  let open = false;
  let thread = { open: false, messages: [], unread: 0 };
  const ui = buildBox({
    title: 'Eric',
    line: 'Only you and Eric see this. It is gone when he closes it.',
    mineSide: 'advocate',
    closeLabel: 'Hide',
    onClose: () => { open = false; ui.box.hidden = true; fab.hidden = false; },
    onSend: async (text) => { thread = await api(user, 'POST', { body: { action: 'send', text } }); show(); },
  });
  ui.box.hidden = true;
  document.body.appendChild(ui.box);
  const show = () => {
    ui.paint(thread.messages, 'Write to Eric here. He gets it straight away.');
    const dot = fab.querySelector('.sc-dot');
    if (thread.unread && !open) { if (!dot) fab.insertAdjacentHTML('beforeend', '<span class="sc-dot" aria-hidden="true"></span>'); }
    else dot?.remove();
    fab.setAttribute('aria-label', thread.unread ? `Message Eric, ${thread.unread} new` : 'Message Eric');
  };
  const markRead = () => { if (thread.unread) api(user, 'POST', { body: { action: 'read' } }).then(() => { thread.unread = 0; show(); }).catch(() => {}); };
  const openBox = () => { open = true; ui.box.hidden = false; fab.hidden = true; show(); markRead(); };
  fab.addEventListener('click', () => { openBox(); ui.input.focus(); });
  const poll = async () => {
    try {
      const was = thread;
      thread = await api(user, 'GET');
      // Something new from him opens the box at the top of the screen; when
      // he closes the chat, the box goes and the thread with it.
      if (thread.unread && thread.messages.length && (!was.messages.length || thread.messages.length > was.messages.length)) openBox();
      else if (!thread.open && was.open && open) { open = false; ui.box.hidden = true; fab.hidden = false; }
      if (open) markRead();
      show();
    } catch { /* offline, or signed out: the next beat tries again */ }
  };
  poll();
  setInterval(() => { if (document.visibilityState === 'visible') poll(); }, 15_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
}

/**
 * His side, from employer mode: the same white box, his messages dark on
 * the right, and the button that ends it. Resolves when he dismisses it.
 */
export function openStaffChat(user, { uid, name, onChange }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sc-sheet';
    let thread = { open: false, messages: [] };
    let timer = 0;
    const done = () => { clearInterval(timer); dlg.close(); dlg.remove(); resolve(); };
    const ui = buildBox({
      title: name,
      line: 'Appears at the top of their screen. Closing it deletes every message.',
      mineSide: 'admin',
      closeLabel: 'Done',
      onClose: done,
      onSend: async (text) => { thread = await api(user, 'POST', { body: { action: 'send', uid, text } }); ui.paint(thread.messages, ''); onChange?.(); },
      onCloseAll: async () => {
        await api(user, 'POST', { body: { action: 'close', uid } }).catch(() => {});
        onChange?.();
        done();
      },
    });
    ui.box.style.position = 'static';
    ui.box.style.transform = 'none';
    ui.box.style.width = '100%';
    ui.box.style.boxShadow = 'none';
    dlg.appendChild(ui.box);
    document.body.appendChild(dlg);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(); });
    dlg.showModal();
    const load = async () => {
      try {
        thread = await api(user, 'GET', { uid });
        ui.paint(thread.messages, `Nothing yet. What you write appears at the top of ${name}'s screen.`);
        if (thread.unread) { await api(user, 'POST', { body: { action: 'read', uid } }).catch(() => {}); onChange?.(); }
      } catch (x) { ui.paint([], x.message); }
    };
    load();
    timer = setInterval(load, 8_000);
    ui.input.focus();
  });
}
