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
  'Key terms': '📚',
  'Where things stand': '🧭',
  'What this could be': '🔬',
  'Worth chasing': '🧪',
  'Ask next': '❓',
  'For you': '🎯',
};

/**
 * opts: { container, kind: 'case'|'sub', id, user, onSend(text), draftContainer? }
 * `onSend` puts an approved draft into the real chat as Eric.
 * `draftContainer` (optional): an element OUTSIDE the panel that the draft
 * card renders into, so drafts live in their own section of the page.
 */
export function mountAdvisor({ container, kind, id, user, onSend, draftContainer = null }) {
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
      <div class="advisor-files" data-fchips></div>
      <div class="advisor-body" data-analysis></div>
      <div class="advisor-draft" data-draft-card hidden></div>
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
  // Drafts render into their own page section when the host provides one.
  const draftCard = draftContainer || el('[data-draft-card]');
  const chipsEl = el('[data-fchips]');
  const qaEl = el('[data-qa]');
  const errEl = el('[data-err]');
  const pauseBtn = el('[data-pause]');
  const refreshBtn = el('[data-refresh]');
  const prepBtn = el('[data-prep]');
  const qBox = el('[data-q]');

  let paused = false;
  let draftRendered = null; // the server draft the card was last built from
  let firedFor = null; // pendingAt value we already launched an analysis for
  let pageIdx = 0;      // which note page is showing
  let pagesKey = '';    // updatedAt of the analysis the pager was built for

  // Tells the chat (and the admin file list) that "send to the advisor for
  // review" has somewhere to land on this page.
  document.body.dataset.advisor = '1';

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

  function apply(d, qa, glossary = []) {
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
      const pages = splitPages(d.analysis);
      // 📚 Key terms rides as the last page: new words from the assessments,
      // each with an "I understand" checkbox. Checked = never explained again.
      if (glossary.length) pages.push({ title: 'Key terms', glossary });
      // A fresh assessment snaps back to page one — "Right now".
      if ((d.updatedAt || '') !== pagesKey) { pagesKey = d.updatedAt || ''; pageIdx = 0; }
      pageIdx = Math.max(0, Math.min(pageIdx, pages.length - 1));
      renderPager(pages);
      updatedEl.textContent = d.updatedAt
        ? `Updated ${timeAgo(toDate(d.updatedAt))}${paused ? ' · analysis paused' : ''}`
        : '';
    } else if (!running) {
      bodyEl.innerHTML = '<p class="dim small">No assessment yet. Tap <strong>Update</strong> once there are a few messages to read.</p>';
      updatedEl.textContent = '';
    }

    // The draft lives in its own box in the panel for as long as it exists:
    // copy it, edit it in place, ask for a revision, or send it as you. (It
    // used to pop an overlay and a "saved" draft had no visible home; the box
    // is that home.)
    if (d.draftStatus === 'ready' && d.draft) {
      renderDraftCard(d.draft);
    } else if (d.draftStatus !== 'ready') {
      draftRendered = null;
      draftCard.hidden = true;
      draftCard.innerHTML = '';
    }
    if (d.draftStatus === 'error' && d.draftError) {
      errEl.textContent = `Draft failed: ${d.draftError}`;
      errEl.hidden = false;
    }

    // Drafts die silently when the connection that carries them drops (screen
    // lock, app switch, 45-90s is a long time on a phone). The worker
    // heartbeats draftProgressAt while it writes; no beat for 2 minutes means
    // the run is dead, so say so instead of leaving a spinner nobody sees.
    const dStarted = d.draftStartedAt ? toDate(d.draftStartedAt).getTime() : 0;
    const dBeat = Math.max(dStarted, d.draftProgressAt ? toDate(d.draftProgressAt).getTime() : 0);
    const draftAlive = d.draftStatus === 'running' && dStarted && Date.now() - dBeat < 120_000;
    const draftStalled = d.draftStatus === 'running' && dStarted && !draftAlive;
    prepBtn.disabled = draftAlive;
    prepBtn.textContent = draftAlive ? '✍️ Drafting…' : '✍️ Prepare a response';
    if (draftStalled) {
      errEl.textContent = 'The draft was interrupted — keep the app open while it writes, and tap ✍️ Prepare a response to try again.';
      errEl.hidden = false;
    }

    lastQa = qa || [];
    renderQa(lastQa);

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
    return { ...d, running, draftAlive };
  }

  let lastQa = [];
  function renderQa(qa) {
    // Once the server row for the just-asked question exists, drop the local
    // pending copy.
    if (localQ && qa.some((q) => q.question === localQ)) localQ = null;
    const rows = qa.slice(-3).map((q) => `
      <div class="advisor-turn">
        <p class="advisor-q">${esc(q.question)}</p>
        <div class="advisor-a">${q.status === 'running'
          ? '<span class="dim small">thinking…</span>'
          : md(q.answer || '')}</div>
      </div>`);
    if (localQ) rows.push(`
      <div class="advisor-turn">
        <p class="advisor-q">${esc(localQ)}</p>
        <div class="advisor-a"><span class="dim small">thinking…</span></div>
      </div>`);
    qaEl.innerHTML = rows.join('');
  }

  /** One note page at a time, flipped with ‹ › or a sideways swipe. */
  function renderPager(pages) {
    const i = pageIdx;
    const pg = pages[i];
    bodyEl.innerHTML = `
      <div class="advisor-page">
        <div class="advisor-page-head">
          <button class="pg-btn" data-pg="-1" ${i === 0 ? 'disabled' : ''} aria-label="Previous note">‹</button>
          <h4>${SECTION_ICON[pg.title] || '•'} ${esc(pg.title)}</h4>
          <span class="pg-count">${i + 1}/${pages.length}</span>
          <button class="pg-btn" data-pg="1" ${i === pages.length - 1 ? 'disabled' : ''} aria-label="Next note">›</button>
        </div>
        <div class="advisor-page-body">${pg.glossary ? glossaryHtml(pg.glossary) : md(pg.body)}</div>
      </div>`;
    bodyEl.querySelectorAll('[data-pg]').forEach((b) =>
      b.addEventListener('click', () => { pageIdx += Number(b.dataset.pg); renderPager(pages); }));
    bodyEl.querySelectorAll('[data-term]').forEach((cb) =>
      cb.addEventListener('change', async () => {
        cb.disabled = true;
        await post({ action: 'term', termId: cb.dataset.term, learned: cb.checked });
        cb.disabled = false;
      }));

    // Swipe to flip. Same discipline as the case tabs: mostly horizontal,
    // long enough to be deliberate, never off a button.
    const body = bodyEl.querySelector('.advisor-page-body');
    let x0 = 0, y0 = 0, live = false;
    body.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { live = false; return; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; live = true;
    }, { passive: true });
    body.addEventListener('touchend', (e) => {
      if (!live) return;
      live = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0, dy = t.clientY - y0;
      if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
      const next = pageIdx + (dx < 0 ? 1 : -1);
      if (next < 0 || next >= pages.length) return;
      pageIdx = next;
      renderPager(pages);
    }, { passive: true });
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
        const d = apply(out.state || {}, out.qa || [], out.glossary || []);
        busy = d.running || d.draftAlive ||
          (out.qa || []).some((q) => q.status === 'running');
      }
    } catch { /* transient — the next tick tries again */ }
    timer = setTimeout(refresh, busy ? 2500 : 12000);
  }
  refresh();

  // ---- files staged for the next analysis ----
  // Two ways in: the 👨‍⚕️ badges on chat files and the case file list, and
  // "Add a file" right here, which reads an image or PDF from Eric's own
  // device and sends it inline with the analysis. Inline files never touch
  // the chat or the case documents, so the client can never see them.
  // Nothing is read until Analyze is pressed; the chips show exactly what
  // will be. The Map is exposed on window so the chat log and the file list
  // (separate modules, re-rendered on their own schedules) can paint their
  // badges from the same source of truth.
  const mediaSel = new Map(); // key (url or inline id) -> { name, url?, data?, contentType, size }
  window.__paMediaSel = mediaSel;
  let inlineSeq = 0;
  function syncStaged() {
    refreshBtn.textContent = mediaSel.size
      ? `🩺 Analyze ${mediaSel.size} file${mediaSel.size === 1 ? '' : 's'}`
      : 'Update';
    refreshBtn.title = mediaSel.size
      ? 'Re-read the conversation and the staged files together'
      : 'Re-read the conversation now';
    chipsEl.innerHTML = `
      ${[...mediaSel.entries()].map(([k, m]) => `
        <span class="adv-chip">${m.url ? '👨‍⚕️' : '🖼'} <span class="adv-chip-name"></span>
          <button type="button" data-unstage="${esc(k)}" aria-label="Remove">✕</button>
        </span>`).join('')}
      <label class="adv-chip adv-add">＋ Add a file
        <input type="file" hidden data-upfile accept="image/png,image/jpeg,image/webp,image/gif,application/pdf">
      </label>
      ${mediaSel.size ? '<span class="dim small" style="align-self:center;">read on Analyze, only by the advisor</span>' : ''}`;
    // Names as text, never markup — file names are user data.
    const names = chipsEl.querySelectorAll('.adv-chip-name');
    [...mediaSel.values()].forEach((m, i) => { if (names[i]) names[i].textContent = m.name; });
    chipsEl.querySelectorAll('[data-unstage]').forEach((b) =>
      b.addEventListener('click', () => {
        mediaSel.delete(b.dataset.unstage);
        syncStaged();
        document.dispatchEvent(new CustomEvent('pa-advisor-selection'));
      }));
    chipsEl.querySelector('[data-upfile]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      errEl.hidden = true;
      const isPdf = file.type === 'application/pdf';
      const cap = isPdf ? 12 * 1024 * 1024 : Math.floor(4.5 * 1024 * 1024);
      if (!isPdf && !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
        errEl.textContent = `${file.name}: the advisor reads JPEG, PNG, WebP, GIF, and PDF.`;
        errEl.hidden = false;
        return;
      }
      if (file.size > cap) {
        errEl.textContent = `${file.name} is too big to read (${isPdf ? '12' : '4.5'} MB max).`;
        errEl.hidden = false;
        return;
      }
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(new Error('read failed'));
        r.readAsDataURL(file);
      }).catch(() => '');
      if (!data) {
        errEl.textContent = `Couldn't read ${file.name} from this device.`;
        errEl.hidden = false;
        return;
      }
      mediaSel.set(`inline:${++inlineSeq}`, {
        name: file.name, data, contentType: file.type, size: file.size,
      });
      syncStaged();
    });
  }
  syncStaged();
  document.addEventListener('pa-advisor-toggle', (e) => {
    const a = e.detail?.attachment;
    if (!a?.url) return;
    if (mediaSel.has(a.url)) mediaSel.delete(a.url);
    else mediaSel.set(a.url, { name: a.name || 'file', url: a.url, contentType: a.contentType || '', size: a.size || 0 });
    syncStaged();
    document.dispatchEvent(new CustomEvent('pa-advisor-selection'));
  });

  refreshBtn.addEventListener('click', () => {
    const media = mediaSel.size
      ? [...mediaSel.values()].map((m) => ({
          name: m.name, contentType: m.contentType, size: m.size,
          ...(m.url ? { url: m.url } : {}), ...(m.data ? { data: m.data } : {}),
        }))
      : undefined;
    if (media) {
      // The selection is consumed by this analysis; badges clear with it.
      mediaSel.clear();
      syncStaged();
      document.dispatchEvent(new CustomEvent('pa-advisor-selection'));
    }
    post({ action: 'analyze', ...(media ? { media } : {}) });
  });
  pauseBtn.addEventListener('click', () => post({ action: paused ? 'resume' : 'pause' }));
  // window.prompt() silently does nothing in iOS Home-Screen apps — a real
  // overlay or the button reads as broken.
  prepBtn.addEventListener('click', () => {
    if (document.getElementById('pa-prep')) return;
    const overlay = document.createElement('div');
    overlay.id = 'pa-prep';
    overlay.className = 'settings-overlay';
    overlay.innerHTML = `
      <div class="settings-card" role="dialog" aria-modal="true" aria-label="Prepare a response">
        <div class="row"><h3 style="margin:0;">✍️ Prepare a response</h3>
          <button class="btn quiet" data-x>Cancel</button></div>
        <p class="dim small" style="margin:.2rem 0 .5rem;">Anything this reply must do? Optional — leave blank for the natural next message.</p>
        <textarea class="edit-box" data-inst rows="3" maxlength="1000" style="min-height:4rem;"></textarea>
        <div class="actions" style="margin-top:.7rem;"><button class="btn" data-go>Draft it</button></div>
      </div>`;
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-x]').addEventListener('click', close);
    overlay.querySelector('[data-go]').addEventListener('click', async () => {
      const instruction = overlay.querySelector('[data-inst]').value.trim();
      close();
      // Instant feedback; from here the state poll owns the button, so an
      // interrupted run can't leave it stuck saying "Drafting…" forever.
      prepBtn.disabled = true;
      prepBtn.textContent = '✍️ Drafting…';
      await post({ action: 'draft', instruction });
    });
    document.body.appendChild(overlay);
    overlay.querySelector('[data-inst]').focus();
  });

  const askForm = el('[data-ask]');
  const askBtn = askForm.querySelector('button');
  qBox.addEventListener('input', () => {
    qBox.style.height = 'auto';
    qBox.style.height = `${qBox.scrollHeight}px`;
  });

  // The original wiring relied on the form's submit event and returned
  // silently on an empty box — on a phone that reads as a dead button. Now the
  // button drives directly, an empty tap says so, the question appears
  // immediately as a pending row, and a failure puts the text back.
  let asking = false;
  let localQ = null;
  /** One path for both typed questions and file reviews. Returns success. */
  async function submitAsk(question, attachment = null) {
    if (asking) return false;
    asking = true;
    askBtn.disabled = true;
    askBtn.textContent = 'Asking…';
    localQ = question;
    renderQa(lastQa);
    const out = await post({
      action: 'ask', question,
      ...(attachment ? { attachment } : {}),
    });
    asking = false;
    askBtn.disabled = false;
    askBtn.textContent = 'Ask';
    if (!out) {
      // post() already showed the error; drop the pending row.
      localQ = null;
      renderQa(lastQa);
    }
    return !!out;
  }
  async function doAsk() {
    if (asking) return;
    const question = qBox.value.trim();
    if (!question) {
      errEl.textContent = 'Type a question first.';
      errEl.hidden = false;
      qBox.focus();
      return;
    }
    qBox.value = '';
    qBox.style.height = 'auto';
    const ok = await submitAsk(question);
    if (!ok) qBox.value = question; // give the question back
  }
  askBtn.type = 'button';
  askBtn.addEventListener('click', doAsk);
  askForm.addEventListener('submit', (e) => { e.preventDefault(); doAsk(); });

  // "Send to the advisor for review" — dispatched by the chat's long-press
  // menu and the file list. The file rides the ask flow as an attachment; the
  // Worker fetches and actually reads it (images and PDFs).
  document.addEventListener('pa-advisor-review', (e) => {
    const att = e.detail?.attachment;
    if (!att?.url) return;
    submitAsk(
      `Review the file "${att.name}". What do you see, what matters for this case, and what should I do with it?`,
      {
        name: att.name || 'file',
        url: att.url,
        contentType: att.contentType || '',
        size: att.size || 0,
      }
    );
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  /**
   * The draft's home: a code-box card in the panel. Edit the text in place,
   * copy it, ask for a revision, discard it, or send it as Eric. It stays
   * visible for as long as the draft exists server-side, so "where did my
   * saved draft go" has one answer: right here.
   */
  function renderDraftCard(text) {
    // Same server draft as last render: leave the card alone, protecting any
    // in-place edits from being clobbered by the poll. A NEW server draft
    // (fresh run or revision) rebuilds the box.
    if (draftRendered === text && !draftCard.hidden) return;
    draftRendered = text;
    draftCard.hidden = false;
    draftCard.innerHTML = `
      <div class="row" style="align-items:center;">
        <p class="advisor-draft-label">✍️ Draft for the client</p>
        <button class="btn quiet tiny" data-dcopy>📋 Copy</button>
      </div>
      <textarea class="draft-box" data-dtext></textarea>
      <p class="dim small" style="margin:.25rem 0 0; display:flex; justify-content:space-between; gap:.5rem;">
        <span class="error" data-derr hidden style="margin:0;"></span>
        <span data-dcount style="margin-left:auto;"></span>
      </p>
      <div class="advisor-draft-actions">
        <button class="btn quiet tiny" data-drevise>🔁 Revise…</button>
        <button class="btn quiet tiny" data-ddiscard>Discard</button>
        <button class="btn tiny" data-dsend>Send as me</button>
      </div>
      <p class="dim small" style="margin:.35rem 0 0;">Edit freely, or ask about it in the box below. Nothing sends until you press Send, and what you change before sending teaches me your voice.</p>`;

    const box = draftCard.querySelector('[data-dtext]');
    const count = draftCard.querySelector('[data-dcount]');
    const derr = draftCard.querySelector('[data-derr]');
    const sendBtn = draftCard.querySelector('[data-dsend]');
    const copyBtn = draftCard.querySelector('[data-dcopy]');
    box.value = text;

    // The chat's own rules reject messages over 2000 characters — a draft
    // that long once silently sent nothing. Count it down and refuse to send
    // over the line instead.
    const MAXLEN = 2000;
    const grow = () => { box.style.height = 'auto'; box.style.height = `${box.scrollHeight + 2}px`; };
    const tally = () => {
      const n = box.value.length;
      count.textContent = `${n.toLocaleString()} / ${MAXLEN.toLocaleString()}`;
      count.classList.toggle('over', n > MAXLEN);
      sendBtn.disabled = n === 0 || n > MAXLEN;
    };
    box.addEventListener('input', () => { grow(); tally(); });
    tally();
    requestAnimationFrame(grow);

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(box.value);
        copyBtn.textContent = '✓ Copied';
        setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1600);
      } catch {
        derr.textContent = 'Copying is blocked on this device.';
        derr.hidden = false;
      }
    });

    draftCard.querySelector('[data-ddiscard]').addEventListener('click', async () => {
      draftCard.hidden = true;
      await post({ action: 'clear-draft' });
    });

    // "Suggest edits": say what should change and the advisor rewrites the
    // draft. The box's CURRENT text goes along as the base, so revisions
    // build on any edits already made by hand.
    draftCard.querySelector('[data-drevise]').addEventListener('click', () => {
      if (document.getElementById('pa-revise')) return;
      const overlay = document.createElement('div');
      overlay.id = 'pa-revise';
      overlay.className = 'settings-overlay';
      overlay.innerHTML = `
        <div class="settings-card" role="dialog" aria-modal="true" aria-label="Revise the draft">
          <div class="row"><h3 style="margin:0;">🔁 Revise the draft</h3>
            <button class="btn quiet" data-x>Cancel</button></div>
          <p class="dim small" style="margin:.2rem 0 .5rem;">What should change? Shorter, warmer, add something, drop something — say it plainly.</p>
          <textarea class="edit-box" data-inst rows="3" maxlength="1000" style="min-height:4rem;"></textarea>
          <div class="actions" style="margin-top:.7rem;"><button class="btn" data-go>Revise it</button></div>
        </div>`;
      const closeOv = () => overlay.remove();
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOv(); });
      overlay.querySelector('[data-x]').addEventListener('click', closeOv);
      overlay.querySelector('[data-go]').addEventListener('click', async () => {
        const instruction = overlay.querySelector('[data-inst]').value.trim();
        if (!instruction) return;
        closeOv();
        prepBtn.disabled = true;
        prepBtn.textContent = '✍️ Drafting…';
        await post({ action: 'draft', instruction, revise: true, base: box.value });
      });
      document.body.appendChild(overlay);
      overlay.querySelector('[data-inst]').focus();
    });

    sendBtn.addEventListener('click', async () => {
      const body = box.value.trim();
      if (!body || body.length > MAXLEN) return;
      sendBtn.disabled = true;
      derr.hidden = true;
      try {
        await onSend(body);
        draftCard.hidden = true;
        draftRendered = null;
        // Stores (draft vs sent) as a style lesson AND clears the served
        // draft; when they differ the worker distills the profile behind
        // this request, so the next draft writes with the lesson.
        // Deliberately not awaited and deliberately quiet: the writes land
        // server-side in about a second, but the distill streams on for tens
        // of seconds, and its outcome never concerns this screen. A phone
        // locked mid-distill just means the next edit retries with the same
        // stored pair. post() would block on the stream and paint its
        // disconnect as a scary error after a perfectly successful send.
        (async () => {
          try {
            const token = await user.getIdToken();
            await fetch('/api/advisor', {
              method: 'POST',
              headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
              body: JSON.stringify({ kind, id, action: 'draft-feedback', draft: text, sent: body }),
            });
          } catch (err) { console.warn('draft feedback:', err); }
        })();
        setTimeout(refresh, 1500);
      } catch (err) {
        derr.textContent = `Didn't send: ${err.message}`;
        derr.hidden = false;
        sendBtn.disabled = false;
      }
    });
  }
}

/** The Key terms page: tick a box when a term is yours, untick to review it. */
function glossaryHtml(glossary) {
  const item = (g) => `
    <label class="gloss-item">
      <input type="checkbox" data-term="${esc(g.id)}" ${g.learned ? 'checked' : ''}>
      <span class="gloss-text"><strong>${esc(g.term)}</strong>: ${esc(g.definition)}</span>
    </label>`;
  const fresh = glossary.filter((g) => !g.learned);
  const known = glossary.filter((g) => g.learned);
  return `
    <p class="dim small" style="margin:.1rem 0 .6rem;">Tick a term once you own it — it's never explained to you again, and the advisor pitches future notes to what you know.</p>
    ${fresh.length ? fresh.map(item).join('') : '<p class="dim small">Nothing new to learn right now.</p>'}
    ${known.length ? `<details class="gloss-known"><summary>✓ ${known.length} term${known.length === 1 ? '' : 's'} you know</summary>${known.map(item).join('')}</details>` : ''}
    <p class="small" style="margin:.6rem 0 0;"><a href="/admin-dictionary.html">📚 Full dictionary, by type and A to Z →</a></p>`;
}

/** Split the assessment on its \`##\` headings into flippable pages. */
function splitPages(text) {
  const parts = String(text).split(/^##\s+/m).filter((p) => p.trim());
  if (parts.length < 2) return [{ title: 'Notes', body: String(text) }];
  return parts.map((part) => {
    const nl = part.indexOf('\n');
    return {
      title: (nl === -1 ? part : part.slice(0, nl)).trim(),
      body: nl === -1 ? '' : part.slice(nl + 1),
    };
  });
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
