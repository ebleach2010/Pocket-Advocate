// CHAT SEARCH (Eric, 2026-10-15: "With the chat case, there should be a
// search button for if they want to search the chat for key words. Like
// Facebook, the key words get highlighted in a pop-out and they can select
// them and it places them back in that spot in the chat. They can tap a down
// arrow in the chat box to return to the current position at the bottom of
// the chat. When searching, they can tap off the search anywhere on screen to
// cancel. I also get this ability.")
//
// Mounted by chat.js on every thread, his and the client's alike. It reads
// the messages already painted in the log (the newest 200, the same window
// the chat shows), so a result is always somewhere it can take you.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** The shortest query worth searching for. */
export const MIN_QUERY = 2;

/**
 * Every message containing the query, newest first. `messages` is
 * [{ id, text, who, when }]; the match ignores case and runs of spaces.
 */
export function findHits(messages, query) {
  const q = String(query || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (q.length < MIN_QUERY) return [];
  return messages
    .filter((m) => String(m.text || '').replace(/\s+/g, ' ').toLowerCase().includes(q))
    .reverse();
}

/** A short stretch of the message around the first match, the match marked. */
export function snippet(text, query, span = 42) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  const q = String(query || '').trim().replace(/\s+/g, ' ');
  const at = flat.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0 || !q) return esc(flat.slice(0, span * 2));
  const from = Math.max(0, at - span);
  const to = Math.min(flat.length, at + q.length + span);
  return `${from > 0 ? '…' : ''}${esc(flat.slice(from, at))}<mark>${esc(flat.slice(at, at + q.length))}</mark>${esc(flat.slice(at + q.length, to))}${to < flat.length ? '…' : ''}`;
}

/** Wrap every match of the query inside `el`'s text in <mark class="chat-hit">. */
export function markIn(el, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!el || q.length < MIN_QUERY) return 0;
  let n = 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    const lower = text.toLowerCase();
    let at = lower.indexOf(q);
    if (at < 0) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    while (at >= 0) {
      frag.append(text.slice(last, at));
      const mark = document.createElement('mark');
      mark.className = 'chat-hit';
      mark.textContent = text.slice(at, at + q.length);
      frag.append(mark);
      n++;
      last = at + q.length;
      at = lower.indexOf(q, last);
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  return n;
}

/** Take every mark back out, leaving the text as it was. */
export function unmark(root) {
  for (const m of root.querySelectorAll('mark.chat-hit')) m.replaceWith(document.createTextNode(m.textContent));
  for (const el of root.querySelectorAll('.msg.chat-found')) el.classList.remove('chat-found');
  root.normalize?.();
}

const GLASS = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>';
const DOWN = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';

/**
 * Adds the search button, its bar and pop-out, and the down arrow, to one
 * mounted chat. Returns { refresh } for the chat to call after every repaint.
 */
export function mountChatSearch({ container, log, otherName = 'Eric' }) {
  const tools = document.createElement('div');
  tools.className = 'chat-tools';
  tools.innerHTML = `
    <button type="button" class="chat-search-btn" data-search-open aria-label="Search this chat" title="Search this chat">${GLASS}</button>
    <div class="chat-search" data-search hidden>
      <span class="chat-search-ico" aria-hidden="true">${GLASS}</span>
      <input type="search" data-search-input placeholder="Search this chat" aria-label="Search this chat" autocomplete="off" enterkeyhint="search">
      <button type="button" class="chat-search-x" data-search-x aria-label="Cancel search">&times;</button>
    </div>
    <div class="chat-results" data-results role="listbox" aria-label="Messages found" hidden></div>`;
  container.insertBefore(tools, log);
  const openBtn = tools.querySelector('[data-search-open]');
  const bar = tools.querySelector('[data-search]');
  const input = tools.querySelector('[data-search-input]');
  const results = tools.querySelector('[data-results]');

  const bottom = document.createElement('button');
  bottom.type = 'button';
  bottom.className = 'chat-bottom';
  bottom.setAttribute('aria-label', 'Back to the newest message');
  bottom.title = 'Back to the newest message';
  bottom.innerHTML = DOWN;
  bottom.hidden = true;
  container.appendChild(bottom);

  let open = false;

  const messages = () => [...log.querySelectorAll('.msg[data-mid]')].map((el) => ({
    id: el.dataset.mid,
    text: el.querySelector('.msg-text')?.textContent || '',
    who: el.classList.contains('me') ? 'You' : otherName,
    when: (el.querySelector('.msg-meta')?.textContent || '').trim(),
  }));

  function paintResults() {
    const q = input.value;
    if (q.trim().length < MIN_QUERY) { results.hidden = true; results.innerHTML = ''; return; }
    const hits = findHits(messages(), q);
    results.innerHTML = hits.length
      ? `<p class="chat-results-n">${hits.length} ${hits.length === 1 ? 'message' : 'messages'}</p>${hits.map((h) => `
        <button type="button" class="chat-result" role="option" data-go="${esc(h.id)}">
          <span class="chat-result-top"><strong>${esc(h.who)}</strong><span>${esc(h.when)}</span></span>
          <span class="chat-result-text">${snippet(h.text, q)}</span>
        </button>`).join('')}`
      : '<p class="chat-results-n">Nothing in this chat matches.</p>';
    results.hidden = false;
  }

  function go(id) {
    const el = log.querySelector(`.msg[data-mid="${CSS.escape(id)}"]`);
    if (!el) return;
    unmark(log);
    markIn(el.querySelector('.msg-text'), input.value);
    el.classList.add('chat-found');
    const lr = log.getBoundingClientRect();
    const mr = el.getBoundingClientRect();
    log.scrollTo({ top: log.scrollTop + (mr.top - lr.top) - lr.height / 3, behavior: 'smooth' });
    results.hidden = true;
  }

  function openSearch() {
    open = true;
    openBtn.hidden = true;
    bar.hidden = false;
    input.focus();
    paintResults();
  }

  function closeSearch() {
    if (!open) return;
    open = false;
    input.value = '';
    bar.hidden = true;
    results.hidden = true;
    results.innerHTML = '';
    openBtn.hidden = false;
    unmark(log);
  }

  openBtn.addEventListener('click', openSearch);
  tools.querySelector('[data-search-x]').addEventListener('click', closeSearch);
  input.addEventListener('input', paintResults);
  input.addEventListener('focus', () => { if (input.value.trim().length >= MIN_QUERY) paintResults(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
    if (e.key === 'Enter') { e.preventDefault(); results.querySelector('[data-go]')?.click(); }
  });
  results.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (b) go(b.dataset.go);
  });
  // A tap anywhere that is not the search cancels it.
  document.addEventListener('pointerdown', (e) => {
    if (open && !tools.contains(e.target)) closeSearch();
  }, true);

  // THE DOWN ARROW: shown once the reader is well up the thread, it takes
  // them back to the newest message. Placed over the bottom of the log.
  function placeBottom() {
    const away = log.scrollHeight - log.scrollTop - log.clientHeight;
    bottom.hidden = away < 160;
    if (!bottom.hidden) bottom.style.top = `${log.offsetTop + log.clientHeight - 54}px`;
  }
  log.addEventListener('scroll', placeBottom, { passive: true });
  window.addEventListener('resize', placeBottom);
  bottom.addEventListener('click', () => {
    log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
  });

  return {
    refresh() {
      placeBottom();
      if (open) paintResults();
    },
  };
}
