// The 👨‍⚕️ Advisor panel: Eric's private second opinion, mounted beside the
// client chat on admin pages only. Clients cannot read the underlying
// documents at all — firestore.rules gates the whole `advisor` subtree on
// isAdmin(), so this is not merely a hidden button.
//
// Every model call runs in the Worker and lands in Firestore; this panel just
// watches the document. That's why a long Opus turn never blocks the page.

// State comes from the Worker, not a Firestore listener: rules ship by CLI and
// the advisor subtree isn't published yet, so a direct browser read fails. The
// Worker owns the admin check either way.

const SECTION_ICON = {
  'Right now': '⚡',
  'Where things stand': '🧭',
  'What this could be': '🔬',
  'Worth chasing': '🧪',
  'Ask next': '❓',
  'For you': '🎯',
};

/**
 * opts: { container, kind: 'case'|'sub', id, user, onSend(text) }
 * `onSend` puts an approved draft into the real chat as Eric.
 */
export function mountAdvisor({ container, kind, id, user, onSend }) {
  container.innerHTML = `
    <div class="advisor">
      <div class="advisor-head">
        <h3>👨‍⚕️ Advisor</h3>
        <div class="advisor-controls">
          <span class="advisor-status" data-status></span>
          <button class="btn quiet tiny" data-pause title="Pause or resume automatic analysis">Pause</button>
          <button class="btn quiet tiny" data-refresh title="Re-read the conversation now">Update</button>
        </div>
      </div>
      <p class="dim small advisor-sub" data-updated>Reading the case…</p>
      <div class="advisor-body" data-analysis></div>
      <div class="advisor-qa" data-qa></div>
      <div class="advisor-foot">
        <button class="btn" data-prep>✍️ Prepare a response</button>
        <form class="advisor-ask" data-ask>
          <textarea data-q rows="1" maxlength="2000" placeholder="Ask your advisor…"></textarea>
          <button class="btn quiet" type="submit">Ask</button>
        </form>
      </div>
      <p class="error" data-err hidden></p>
    </div>`;

  const el = (s) => container.querySelector(s);
  const statusEl = el('[data-status]');
  const updatedEl = el('[data-updated]');
  const bodyEl = el('[data-analysis]');
  const qaEl = el('[data-qa]');
  const errEl = el('[data-err]');
  const pauseBtn = el('[data-pause]');
  const qBox = el('[data-q]');

  let paused = false;
  let draftShown = null;
  let firedFor = null; // pendingAt value we already launched an analysis for

  const post = async (payload) => {
    errEl.hidden = true;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/advisor', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ kind, id, ...payload }),
      });
      const out = await res.json();
      // Long actions stream keepalive whitespace and always return HTTP 200 —
      // failure arrives as { ok: false } in the body, not as a status code.
      if (!res.ok || out.ok === false) throw new Error(out.error || `Failed (${res.status})`);
      setTimeout(refresh, 400);
      return out;
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      return null;
    }
  };

  function apply(d, qa) {
    paused = !!d.paused;
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    pauseBtn.classList.toggle('on', paused);

    // The worker heartbeats progressAt every ~8s while the model streams
    // (thinking included). No beat for 2 minutes = the run is dead — say so
    // instead of showing "thinking" forever.
    const started = d.startedAt ? toDate(d.startedAt).getTime() : 0;
    const beat = Math.max(started, d.progressAt ? toDate(d.progressAt).getTime() : 0);
    const alive = d.status === 'running' && started && Date.now() - beat < 120_000;
    const stalled = d.status === 'running' && started && !alive;
    const mins = started ? Math.floor((Date.now() - started) / 60_000) : 0;
    statusEl.textContent = alive
      ? `● thinking${mins ? ` · ${mins}m` : ''}`
      : stalled ? '⚠ stalled — tap Update' : paused ? '‖ paused' : '';
    statusEl.className = `advisor-status${alive ? ' live' : ''}`;
    const running = alive;

    if (d.status === 'error' && d.error) {
      errEl.textContent = `Analysis failed: ${d.error}`;
      errEl.hidden = false;
    }

    if (d.analysis) {
      bodyEl.innerHTML = renderAnalysis(d.analysis);
      updatedEl.textContent = d.updatedAt
        ? `Updated ${timeAgo(toDate(d.updatedAt))}${paused ? ' · analysis paused' : ''}`
        : '';
    } else if (!running) {
      bodyEl.innerHTML = '<p class="dim small">No assessment yet. Tap <strong>Update</strong> once there are a few messages to read.</p>';
      updatedEl.textContent = '';
    }

    // A finished draft opens the editor once, not on every snapshot.
    if (d.draftStatus === 'ready' && d.draft && draftShown !== d.draft) {
      draftShown = d.draft;
      openDraft(d.draft);
    }
    if (d.draftStatus === 'error' && d.draftError) {
      errEl.textContent = `Draft failed: ${d.draftError}`;
      errEl.hidden = false;
    }

    qaEl.innerHTML = (qa || []).slice(-8).map((q) => `
      <div class="advisor-turn">
        <p class="advisor-q">${esc(q.question)}</p>
        <div class="advisor-a">${q.status === 'running'
          ? '<span class="dim small">thinking…</span>'
          : md(q.answer || '')}</div>
      </div>`).join('');

    // The thread changed since the last assessment and nothing is on it yet —
    // run the analysis from here. This open panel is what holds the connection
    // alive through a long Opus turn; the cron only covers the panel being
    // closed. Fire once per pending flag, not once per poll.
    // Never auto-fire into a standing error (credits out, etc.) — that loops.
    // The error shows above; a manual Update or the cron retries it.
    if (d.pendingAt && !running && !paused && d.status !== 'error' && firedFor !== d.pendingAt) {
      firedFor = d.pendingAt;
      post({ action: 'analyze' });
    }
    return { ...d, running };
  }

  // Poll fast while something is running, slowly when it isn't — an assessment
  // that takes two minutes shouldn't cost a request a second for the rest of
  // the day.
  let timer = null;
  async function refresh() {
    clearTimeout(timer);
    let busy = false;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/advisor/state?kind=${kind}&id=${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const out = await res.json();
        const d = apply(out.state || {}, out.qa || []);
        busy = d.running || d.draftStatus === 'running' ||
          (out.qa || []).some((q) => q.status === 'running');
      }
    } catch { /* transient — the next tick tries again */ }
    timer = setTimeout(refresh, busy ? 2500 : 12000);
  }
  refresh();

  el('[data-refresh]').addEventListener('click', () => post({ action: 'analyze' }));
  pauseBtn.addEventListener('click', () => post({ action: paused ? 'resume' : 'pause' }));
  el('[data-prep]').addEventListener('click', async () => {
    const instruction = prompt('Anything this reply must do? (optional — leave blank for the natural next message)') ?? null;
    if (instruction === null) return;
    draftShown = null;
    await post({ action: 'draft', instruction });
  });

  const askForm = el('[data-ask]');
  qBox.addEventListener('input', () => {
    qBox.style.height = 'auto';
    qBox.style.height = `${qBox.scrollHeight}px`;
  });
  askForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = qBox.value.trim();
    if (!question) return;
    qBox.value = '';
    qBox.style.height = 'auto';
    await post({ action: 'ask', question });
  });

  /** The draft editor: edit, keep as a draft, or send it as me. */
  function openDraft(text) {
    if (document.getElementById('pa-draft')) return;
    const overlay = document.createElement('div');
    overlay.id = 'pa-draft';
    overlay.className = 'settings-overlay';
    overlay.innerHTML = `
      <div class="settings-card edit-card" role="dialog" aria-modal="true" aria-label="Prepared response">
        <div class="row"><h3 style="margin:0;">✍️ Prepared response</h3>
          <button class="btn quiet" data-close>Close</button></div>
        <p class="dim small" style="margin:.2rem 0 .5rem;">Written to sound like you, from how you write in this thread. Edit freely — nothing sends until you press Send.</p>
        <textarea class="edit-box" data-draft rows="9"></textarea>
        <p class="dim small" style="margin:.3rem 0 0; display:flex; justify-content:space-between;">
          <span class="error" data-derr hidden style="margin:0;"></span>
          <span data-count style="margin-left:auto;"></span>
        </p>
        <div class="actions" style="margin-top:.7rem;">
          <button class="btn quiet" data-keep>Save as draft</button>
          <button class="btn" data-send>Send as me</button>
        </div>
      </div>`;
    const box = overlay.querySelector('[data-draft]');
    const count = overlay.querySelector('[data-count]');
    const derr = overlay.querySelector('[data-derr]');
    const sendBtn = overlay.querySelector('[data-send]');
    box.value = text;
    // The chat's own rules reject messages over 2000 characters — a draft that
    // long once closed this dialog and silently sent nothing. Count it down
    // and refuse to send over the line instead.
    const MAXLEN = 2000;
    const tally = () => {
      const n = box.value.length;
      count.textContent = `${n.toLocaleString()} / ${MAXLEN.toLocaleString()}`;
      count.classList.toggle('over', n > MAXLEN);
      sendBtn.disabled = n === 0 || n > MAXLEN;
    };
    box.addEventListener('input', tally);
    tally();
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-close]').addEventListener('click', close);
    overlay.querySelector('[data-keep]').addEventListener('click', close);
    sendBtn.addEventListener('click', async () => {
      const body = box.value.trim();
      if (!body || body.length > MAXLEN) return;
      // Send FIRST, close on success — closing first is how a failed send
      // vanished without a trace.
      sendBtn.disabled = true;
      derr.hidden = true;
      try {
        await onSend(body);
        close();
        await post({ action: 'clear-draft' });
        draftShown = null;
      } catch (err) {
        derr.textContent = `Didn't send: ${err.message}`;
        derr.hidden = false;
        sendBtn.disabled = false;
      }
    });
    document.body.appendChild(overlay);
    box.focus();
  }
}

/** Split the assessment on its `##` headings so each section gets a card. */
function renderAnalysis(text) {
  const parts = String(text).split(/^##\s+/m).filter(Boolean);
  if (parts.length < 2) return md(text);
  return parts.map((part, i) => {
    const nl = part.indexOf('\n');
    const title = (nl === -1 ? part : part.slice(0, nl)).trim();
    const rest = nl === -1 ? '' : part.slice(nl + 1);
    // Bits at a time: "Right now" reads immediately; everything else folds
    // away behind its heading until tapped.
    const open = i === 0 || title === 'Right now';
    return `<details class="advisor-sec"${open ? ' open' : ''}>
      <summary><h4>${SECTION_ICON[title] || '•'} ${esc(title)}</h4></summary>
      ${md(rest)}
    </details>`;
  }).join('');
}

/** Just enough markdown for what the model actually emits. */
function md(text) {
  const lines = String(text).trim().split('\n');
  let html = '';
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(bullet ? bullet[1] : numbered[1])}</li>`;
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    if (!line.trim()) continue;
    if (/^###\s+/.test(line)) html += `<h5>${inline(line.replace(/^###\s+/, ''))}</h5>`;
    else html += `<p>${inline(line)}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function toDate(v) { return v?.toDate ? v.toDate() : new Date(v || 0); }

function timeAgo(d) {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return d.toLocaleDateString();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
