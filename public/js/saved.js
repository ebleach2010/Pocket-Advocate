// Saved messages: the ones either side bookmarked, each with a note.
//
// Eric asked for this on his side and it is just as useful on theirs, so both
// get it. What matters is that it is PRIVATE: the bookmark lives under
// {parent}/{id}/private/saved/{uid}/{msgId}, which the browser cannot read or
// write in either direction, and nothing is ever written back to the message
// itself. Reacting and passing both mark the shared message and notify the
// other person; this does neither, on purpose. Saving a message tells nobody.
//
// The note is his own, typed here, and saved on a debounce with a small pill
// that says where it got to — the same pattern the notes page uses, written
// out again rather than imported, because that module is admin-only and this
// one is not.

const SAVE_DELAY_MS = 900;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

const when = (v) => {
  if (!v) return '';
  const d = v.toDate ? v.toDate() : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d);
};

/**
 * mountSaved({ container, kind, id, user, myRole })
 *
 * Repaints itself on 'pa-saved-changed', which the chat fires after a save, so
 * bookmarking a message and flipping to this page shows it without a reload.
 * Returns { refresh() }.
 */
export function mountSaved({ container, kind, id, user, myRole }) {
  if (!container) return { refresh() {} };
  container.classList.add('sv-root');
  container.innerHTML = '<p class="dim small">Loading…</p>';

  const api = async (opts) => {
    const token = await user.getIdToken();
    const res = await fetch(opts.url, {
      method: opts.method || 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(opts.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
    return data;
  };

  async function refresh() {
    let rows = [];
    try {
      const out = await api({ url: `/api/saved?kind=${kind}&id=${encodeURIComponent(id)}` });
      rows = out.saved || [];
    } catch (err) {
      container.innerHTML = `<p class="error">Couldn't load your saved messages: ${esc(err.message)}</p>`;
      return;
    }
    paint(rows);
  }

  function paint(rows) {
    if (!rows.length) {
      container.innerHTML = `
        <div class="panel">
          <h3>Saved messages</h3>
          <p class="dim small">Nothing saved yet. Press and hold any message in
            the chat and choose <strong>Save this message</strong>. It lands here
            with room for a note, and the other person is never told.</p>
        </div>`;
      return;
    }
    container.innerHTML = `
      <div class="panel">
        <h3>Saved messages</h3>
        <p class="dim small">Yours only. ${myRole === 'admin' ? 'The client' : 'Eric'} is not told what you save.</p>
      </div>
      <ul class="sv-list">
        ${rows.map((r) => `
          <li class="sv-item" data-msg="${esc(r.msgId)}">
            <div class="sv-head">
              <span class="sv-who">${r.role === 'question' ? 'Asked of you' : r.role === 'admin' ? 'Eric' : 'You'}${myRole === 'admin' && r.role === 'client' ? 'r client' : ''}</span>
              <span class="sv-when">${esc(when(r.sentAt))}</span>
              <button type="button" class="sv-drop" data-drop title="Remove from saved"
                aria-label="Remove from saved">✕</button>
            </div>
            <blockquote class="sv-text">${esc(r.text || (r.attachmentName ? `📎 ${r.attachmentName}` : '(no text)'))}</blockquote>
            <label class="sv-note-label">Your note
              <textarea class="sv-note" data-note rows="2" maxlength="2000"
                placeholder="Why this one matters">${esc(r.note || '')}</textarea>
            </label>
            <span class="sv-pill" data-pill hidden></span>
          </li>`).join('')}
      </ul>`;
    wire();
  }

  function wire() {
    for (const li of container.querySelectorAll('.sv-item')) {
      const msgId = li.dataset.msg;
      const box = li.querySelector('[data-note]');
      const pill = li.querySelector('[data-pill]');
      let timer = null;
      let last = box.value;

      const say = (text, cls = '') => {
        pill.textContent = text;
        pill.className = `sv-pill ${cls}`.trim();
        pill.hidden = !text;
      };

      const save = async () => {
        const note = box.value;
        if (note === last) return;
        say('Saving…');
        try {
          await api({
            url: '/api/saved',
            method: 'POST',
            body: { kind, id, msgId, note },
          });
          last = note;
          say('Saved', 'ok');
          setTimeout(() => { if (pill.textContent === 'Saved') say(''); }, 1600);
        } catch (err) {
          say(err.message, 'bad');
        }
      };

      box.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(save, SAVE_DELAY_MS);
      });
      // Leaving the box means he is done with it; do not make him wait out the
      // debounce to find out whether it landed.
      box.addEventListener('blur', () => { clearTimeout(timer); save(); });

      li.querySelector('[data-drop]').addEventListener('click', async () => {
        const note = box.value.trim();
        if (note && !confirm('Remove this saved message? The note goes with it.')) return;
        try {
          await api({ url: '/api/saved', method: 'POST', body: { kind, id, msgId, delete: true } });
          li.remove();
          if (!container.querySelector('.sv-item')) paint([]);
        } catch (err) {
          say(err.message, 'bad');
        }
      });
    }
  }

  // Saving from the chat repaints this page, so flipping to it shows the new
  // one. Torn down with the container, so a second mount does not stack.
  const onChanged = (e) => {
    if (e.detail?.kind === kind && e.detail?.id === id) refresh();
  };
  container.__paSaved?.();
  document.addEventListener('pa-saved-changed', onChanged);
  container.__paSaved = () => document.removeEventListener('pa-saved-changed', onChanged);

  refresh();
  return { refresh };
}
