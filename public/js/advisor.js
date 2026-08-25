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

/**
 * Headings are matched by name in three places, and a model does not type the
 * same apostrophe every time. Curly quotes, stray decoration and casing all
 * collapse to one key here, so "What's missing", "What’s missing" and
 * "WHAT'S MISSING" are one section rather than three, two of which are
 * invisible.
 */
export function normTitle(s) {
  return String(s || '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const SECTION_ICON_RAW = {
  'Right now': '⚡',
  'Plain English': '💬',
  'What this could be': '🔬',
  'Worth investigating': '🧪',
  'Worth asking': '❓',
  'What we know so far': '🗂',
  "What's missing": '🕳',
  'Ruled out': '🚫',
  'For you': '🎯',
  'Key terms': '📚',
  // Older assessments used these headings; keep the icons so a case that has
  // not been re-read since still paints correctly.
  'Where things stand': '🧭',
  'Worth chasing': '🧪',
  'Ask next': '❓',
};
const SECTION_ICON = new Map(
  Object.entries(SECTION_ICON_RAW).map(([k, v]) => [normTitle(k), v]));

// Sections whose bullets Eric sends to the client with one long press. Both
// are written by the advisor as ready-to-send questions in his own register,
// which is the only reason a one-press send is safe here.
const SENDABLE = new Set(['Worth asking', "What's missing", 'Ask next'].map(normTitle));

// Ten colours for the term coding. A term is painted the same colour wherever
// it appears - in the read and in its own explanation below the divider - so
// Eric's eye pairs them without reading. Ten because past that they stop being
// distinguishable at a glance, and a term index wraps rather than running out.
const TERM_COLORS = 10;

/**
 * Pull [[bracketed terms]] out of an assessment and give each distinct one a
 * colour index, in order of first appearance. Deterministic for a given
 * assessment, so the colours do not reshuffle on a poll.
 */
function termPalette(text) {
  const map = new Map();
  for (const m of String(text || '').matchAll(/\[\[([^\]]{1,80})\]\]/g)) {
    const key = m[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (key && !map.has(key)) map.set(key, map.size % TERM_COLORS);
  }
  return map;
}

/**
 * opts: { container, kind: 'case'|'sub', id, user, onSend(text), draftContainer?, diffContainer? }
 * `onSend` puts an approved draft into the real chat as Eric.
 * `draftContainer` (optional): an element OUTSIDE the panel that the draft
 * card renders into, so drafts live in their own section of the page.
 * `diffContainer` (optional): an element the differential page renders into.
 */
/**
 * The panel's "send this to the client, as you" sheet, published so another
 * page can offer the same thing. The Unanswered page uses it for "ask again",
 * and a second implementation of the same sheet would be a second thing to
 * keep in step.
 *
 * Null until a panel mounts, which on the case page is always.
 */
export let sendToClient = null;

export function mountAdvisor({ container, kind, id, user, onSend, draftContainer = null, diffContainer = null, qaContainer = null, goTo = null }) {
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
      <div class="advisor-read" data-read hidden></div>
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
  const readEl = el('[data-read]');
  const qaEl = el('[data-qa]');
  const errEl = el('[data-err]');
  const pauseBtn = el('[data-pause]');
  const refreshBtn = el('[data-refresh]');
  const prepBtn = el('[data-prep]');
  const qBox = el('[data-q]');

  // Errors used to paint only on the Read page. The buttons that cause most
  // of them now live on the Chat page (the foot moves there below), so every
  // error paints in both places and the failure is visible from wherever he
  // pressed the button. (Eric, 2026-08-21: pressed Prepare a response, the
  // draft died, and from the Chat page it looked like nothing happened.)
  let chatErr = null;
  const showErr = (msg) => {
    for (const e of [errEl, chatErr]) if (e) { e.textContent = msg; e.hidden = false; }
  };
  const hideErr = () => {
    for (const e of [errEl, chatErr]) if (e) e.hidden = true;
  };

  // The files staged for the next analysis: the 👨‍⚕️ badges on chat files and
  // the case file list, plus anything added from Eric's own device. Declared
  // here rather than beside its wiring below because the first poll can land
  // before that code runs. Key (url or inline id) -> { name, url?, data?,
  // contentType, size }.
  const mediaSel = new Map();
  window.__paMediaSel = mediaSel;

  let paused = false;
  let draftRendered = null; // the server draft the card was last built from
  // He pressed Prepare a response (or Revise) this session and is owed a
  // draft. When it lands, the panel takes him to it instead of leaving it to
  // appear silently on another page.
  let awaitingDraft = false;
  let firedFor = null; // pendingAt value we already launched an analysis for
  // Which page he is on, and it survives leaving the tab and coming back. A
  // closure variable reset him to 1 of 9 every time he looked at the chat.
  const PAGE_KEY = `pa-read-page-${kind}-${id}`;
  let pageIdx = (() => {
    try { return Math.max(0, Number(sessionStorage.getItem(PAGE_KEY)) || 0); } catch { return 0; }
  })();
  let pagesKey = '';    // updatedAt of the analysis the pager was built for
  // What the pager last drew. The poll runs every twelve seconds and used to
  // rebuild the page unconditionally, so a selection went, the scroll jumped
  // to the top, and the sentence he was reading moved, four or five times a
  // minute. Every other repaint in this file already guards on a key like
  // this; the one he reads longest did not.
  let drawnKey = '';

  // Tells the chat (and the admin file list) that "send to the advisor for
  // review" has somewhere to land on this page.
  document.body.dataset.panel = '1';

  let pingedStall = false;

  const post = async (payload) => {
    hideErr();
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
      showErr(err.message);
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
    // The one failure that looks like every other failure.
    //
    // (Eric, 2026-08-21: "Update stalled. Tapping update afterwards did
    // nothing. Are we missing a fucking api key?")
    //
    // The Worker has always sent keyConfigured on this payload and nothing
    // read it. With no key the advisor cannot start, so it sits at "stalled",
    // Update does nothing visible, and there is no way to tell a missing
    // secret from a dead run - which is exactly the wrong guess to have to
    // make. Say it plainly, and say it above everything else.
    const noKey = d.keyConfigured === false;
    // The run reports its real stage now (the worker reads it off the stream),
    // so "thinking" stops being one word for uploading, queueing, reading
    // three PDFs, and writing. The label can flip back to thinking mid-run;
    // adaptive thinking interleaves, and that is honest.
    const stageLabel = {
      starting: 'starting',
      sending: 'sending the case',
      'reading files': 'reading files',
      thinking: 'thinking',
      writing: 'writing',
    }[d.stage] || 'thinking';
    statusEl.textContent = noKey
      ? '⚠ no API key on the Worker'
      : alive
        ? `● ${stageLabel}${mins ? ` · ${mins}m` : ''}`
        : stalled ? '⚠ stalled — tap Update' : paused ? '‖ paused' : '';
    statusEl.className = `advisor-status${alive ? ' live' : ''}`;
    if (noKey) {
      showErr('ANTHROPIC_API_KEY is not set on the Worker, so the '
        + 'advisor cannot run at all. Set it with: npx wrangler secret put '
        + 'ANTHROPIC_API_KEY. Nothing else in the app is affected.');
    }
    // A stall runs its own diagnostics, once per stall: a one-token round trip
    // to the model. Either "the pipe is fine, the run died - tap Update" or
    // the provider's actual error, in its own words. No more guessing about
    // API keys from a phone. (Eric, 2026-08-21: "Send an agent to run
    // diagnostics.")
    if (stalled && !pingedStall) {
      pingedStall = true;
      (async () => {
        try {
          const token = await user.getIdToken();
          const res = await fetch('/api/advisor', {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ kind, id, action: 'ping' }),
          });
          const out = await res.json();
          showErr(out.ok
            ? `Diagnostics: the model responds normally (${out.ms}ms), so this run died on its own${d.stage && d.stage !== 'starting' ? ` while ${d.stage === 'sending' ? 'sending the case' : d.stage}` : ''} (leaving the app mid-run can do that). It restarts by itself within a few minutes, or tap Update to restart it now.`
            : `Diagnostics: ${out.error}`);
        } catch { /* the refresh loop will try again on the next stall */ }
      })();
    }
    if (!stalled) pingedStall = false;
    const running = alive;

    if (d.status === 'error' && d.error) {
      showErr(`Analysis failed: ${d.error}`);
    }

    if (d.analysis) {
      const pages = splitPages(d.analysis);
      // 📚 Key terms rides as the last page: new words from the assessments,
      // each with an "I understand" checkbox. Checked = never explained again.
      if (glossary.length) pages.push({ title: 'Key terms', glossary });
      // A fresh assessment used to snap him back to page one mid-sentence.
      // Now it stays where he is and the header says something changed; the
      // pager only jumps if the page he was on no longer exists.
      const fresh = (d.updatedAt || '') !== pagesKey;
      if (fresh) pagesKey = d.updatedAt || '';
      pageIdx = Math.max(0, Math.min(pageIdx, pages.length - 1));
      // Terms Eric has already marked learned are not painted and not
      // explained: the worker filters them out of the prompt, and this drops
      // any that slipped through from an assessment written before he ticked
      // them.
      const learned = new Set(glossary.filter((g) => g.learned)
        .map((g) => g.term.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));
      const terms = termPalette(d.analysis);
      for (const k of learned) terms.delete(k);
      // Only redraw when the content or the page actually changed. A poll that
      // changed nothing must not take his place away.
      const key = `${pagesKey}|${pageIdx}|${pages.length}|${learned.size}`;
      if (key !== drawnKey) {
        drawnKey = key;
        renderPager(pages, terms);
      }
      // A one-line digest of what the last run actually did, composed from
      // stamps the payload already carries. No model involved, so it cannot
      // lie: fileAt/diffAt landing beside updatedAt means this run read
      // files / moved the differential.
      const upT = d.updatedAt ? toDate(d.updatedAt).getTime() : 0;
      const near = (v) => v && upT && Math.abs(toDate(v).getTime() - upT) < 5000;
      const bits = [];
      const readN = near(d.mediaReport?.at) ? (d.mediaReport.read || []).length : 0;
      if (readN) bits.push(`read ${readN} file${readN === 1 ? '' : 's'}`);
      if (near(d.diffAt)) bits.push('differential moved');
      updatedEl.textContent = d.updatedAt
        ? `Updated ${timeAgo(toDate(d.updatedAt))}${bits.length ? ` · ${bits.join(', ')}` : ''}${paused ? ' · analysis paused' : ''}`
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
      // He pressed the button this session and the draft just landed: take
      // him to it. Without this the card fills in silently on Mine › Drafts,
      // which from any other page reads as "it just stopped".
      if (awaitingDraft) {
        awaitingDraft = false;
        if (goTo) goTo('drafts');
      }
    } else if (d.draftStatus !== 'ready') {
      draftRendered = null;
      draftCard.hidden = true;
      draftCard.innerHTML = '';
    }
    if (d.draftStatus === 'error' && d.draftError) {
      awaitingDraft = false;
      showErr(`Draft failed: ${d.draftError}`);
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
      // The worker's cron now re-runs a dead draft from its saved request, so
      // the honest message is "it recovers on its own", not "you broke it by
      // locking your phone".
      showErr('The draft was interrupted (leaving the app can do that). It restarts on its own within a few minutes, or tap ✍️ Prepare a response to run it again now.');
    }

    lastQa = qa || [];
    renderQa(lastQa);

    // The thread changed since the last assessment and nothing is on it yet —
    // run the analysis from here. This open panel is what holds the connection
    // alive through a long Opus turn; the cron only covers the panel being
    // closed. Fire once per pending flag, not once per poll.
    // Never auto-fire into a standing error (credits out, etc.) — that loops.
    // The error shows above; a manual Update or the cron retries it.
    // Cooldown: firedFor is a per-page-load closure, so every app re-entry
    // used to auto-fire a fresh run while the last one's corpse was still
    // warm. The per-minute cron owns retries now; the panel only volunteers
    // when nothing has even STARTED in the last three minutes.
    const anyStart = d.startedAt ? toDate(d.startedAt).getTime() : 0;
    if (d.pendingAt && !running && !paused && d.status !== 'error' && firedFor !== d.pendingAt
      && (!anyStart || Date.now() - anyStart > 3 * 60_000)) {
      firedFor = d.pendingAt;
      // auto, so the worker can take the cheap no-new-content exit when the
      // pending flag turns out to be noise; only a real tap forces a read.
      post({ action: 'analyze', auto: true });
    }
    return { ...d, running, draftAlive };
  }

  let lastQa = [];
  /**
   * A question that has been "thinking" for four minutes is not thinking.
   *
   * Unlike the analysis and the draft, the Q&A path writes no heartbeat and
   * has no cron backstop, so a Worker that died mid-answer left a spinner on
   * screen with nothing to say otherwise, forever.
   */
  const QA_STALL_MS = 4 * 60_000;
  const qaStalled = (q) => {
    const at = q.at ? toDate(q.at)?.getTime() : 0;
    return !!at && Date.now() - at > QA_STALL_MS;
  };

  function renderQa(qa) {
    // Once the server row for the just-asked question exists, drop the local
    // pending copy.
    if (localQ && qa.some((q) => q.question === localQ)) localQ = null;
    // The route hands these back newest first now, so the three to show are the
    // first three, put back into the order a conversation reads in.
    const rows = qa.slice(0, 3).slice().reverse().map((q) => `
      <div class="advisor-turn">
        <p class="advisor-q">${esc(q.question)}</p>
        <div class="advisor-a">${q.status === 'running' && qaStalled(q)
          ? '<span class="dim">No answer came back. Ask it again.</span>'
          : q.status === 'running'
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
  function renderPager(pages, terms = null) {
    const i = pageIdx;
    const pg = pages[i];
    bodyEl.innerHTML = `
      <div class="advisor-page">
        <div class="advisor-page-head">
          <button class="pg-btn" data-pg="-1" ${i === 0 ? 'disabled' : ''} aria-label="Previous note">‹</button>
          <h4>${SECTION_ICON.get(normTitle(pg.title)) || '•'} ${esc(pg.title)}</h4>
          <span class="pg-count">${i + 1}/${pages.length}</span>
          <button class="pg-btn" data-pg="1" ${i === pages.length - 1 ? 'disabled' : ''} aria-label="Next note">›</button>
        </div>
        <div class="advisor-page-body">${pg.glossary ? glossaryHtml(pg.glossary) : `
          ${md(pg.body, terms)}
          ${pg.plain ? `
            <hr class="title-rule plain-rule">
            <div class="plain-english">
              <span class="plain-tag">💬 In plain words</span>
              ${md(pg.plain, terms)}
            </div>` : ''}`}</div>
        ${SENDABLE.has(normTitle(pg.title)) ? '<p class="dim small pg-hint">Press and hold any line to send it to the client.</p>' : ''}
      </div>`;
    bodyEl.querySelectorAll('[data-pg]').forEach((b) =>
      b.addEventListener('click', () => {
        pageIdx = Math.max(0, Math.min(pageIdx + Number(b.dataset.pg), pages.length - 1));
        try { sessionStorage.setItem(PAGE_KEY, String(pageIdx)); } catch { /* blocked */ }
        drawnKey = '';               // a tap always redraws
        renderPager(pages, terms);
      }));
    if (SENDABLE.has(normTitle(pg.title))) wireSendable(bodyEl, pg.title);
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
      try { sessionStorage.setItem(PAGE_KEY, String(pageIdx)); } catch { /* blocked */ }
      drawnKey = '';
      renderPager(pages, terms);
    }, { passive: true });
  }

  /**
   * Press and hold a question and send it to the client as an ordinary message
   * from Eric. Only "Worth asking" and "What's missing" get this, because only
   * those two are written as questions ready to send as they stand.
   *
   * It always opens a sheet with the text in it first. A long press that fired
   * a message straight into the chat would be one slip away from sending the
   * client something Eric never read.
   */
  function wireSendable(root, title) {
    root.querySelectorAll('.advisor-page-body li').forEach((li) => {
      li.classList.add('askable');
      let t = null;
      const cancel = () => { clearTimeout(t); t = null; li.classList.remove('held'); };
      const start = () => {
        cancel();
        li.classList.add('held');
        t = setTimeout(() => {
          li.classList.remove('held');
          openSendSheet(li.textContent.trim(), title);
        }, 550);
      };
      li.addEventListener('touchstart', start, { passive: true });
      li.addEventListener('touchend', cancel, { passive: true });
      li.addEventListener('touchmove', cancel, { passive: true });
      li.addEventListener('touchcancel', cancel, { passive: true });
      li.addEventListener('mousedown', start);
      li.addEventListener('mouseup', cancel);
      li.addEventListener('mouseleave', cancel);
      // A keyboard has no long press; a plain Enter on a focused line does.
      li.tabIndex = 0;
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); openSendSheet(li.textContent.trim(), title); }
      });
    });
  }

  sendToClient = openSendSheet;

  function openSendSheet(text, title) {
    if (!text) return;
    const overlay = document.createElement('div');
    overlay.className = 'msg-menu-overlay';
    overlay.innerHTML = `
      <div class="msg-menu" role="dialog" aria-modal="true" aria-label="Send to the client">
        <div class="msg-menu-sheet">
          <p class="msg-menu-head">Send this to the client, as you</p>
          <textarea class="send-draft" rows="4" maxlength="2000"></textarea>
          <button class="msg-menu-row" data-act="send"><span class="react-emoji">📤</span><span>Send it</span></button>
          <button class="msg-menu-row" data-act="copy"><span class="react-emoji">📋</span><span>Copy instead</span></button>
          <button class="msg-menu-row cancel" data-act="cancel"><span>Cancel</span></button>
        </div>
      </div>`;
    // Text as a value, never as markup: this line came out of a model.
    const box = overlay.querySelector('.send-draft');
    box.value = text;
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    function onKey(e) { if (e.key === 'Escape') close(); }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelectorAll('[data-act]').forEach((b) =>
      b.addEventListener('click', async () => {
        const act = b.dataset.act;
        const out = box.value.trim();
        close();
        if (act === 'copy' && out) await navigator.clipboard?.writeText(out).catch(() => {});
        if (act === 'send' && out) {
          try { await onSend?.(out); } catch (err) {
            showErr(`Couldn't send that: ${err.message}`);
          }
        }
      }));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    setTimeout(() => box.focus(), 0);
    void title;
  }

  // ---- the 🧬 Differential page ----
  // Renders into its own folder page when the host provides one. Rebuilt only
  // when the data actually changes, so the confidence bars settle once per
  // new read instead of twitching on every poll.
  let diffKey = null;
  function renderDiff(d) {
    if (!diffContainer) return;
    const key = JSON.stringify([d.workingLine, d.dxOverride, d.differential, (d.diffHistory || []).length]);
    if (key === diffKey) return;
    diffKey = key;
    const line = (d.dxOverride && d.dxOverride.text) || d.workingLine || '';
    // Movement since the previous read that changed anything. The worker keeps
    // slim snapshots; history[0] is the current list, history[1] what it
    // replaced. Matched on flattened name, so a renamed row paints once as
    // new; that is acceptable.
    const flat = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const prevSnap = (d.diffHistory || [])[1];
    const prevPct = new Map((prevSnap?.rows || []).map((r) => [flat(r.name), Math.round(Number(r.pct) || 0)]));
    const rows = (d.differential || []).map((r, i) => {
      const pct = Math.max(0, Math.min(100, Math.round(Number(r.pct) || 0)));
      const was = prevSnap ? prevPct.get(flat(r.name)) : undefined;
      const move = was === undefined
        ? (prevSnap ? '<span class="diff-move new">new this read</span>' : '')
        : was === pct ? ''
          : `<span class="diff-move ${pct > was ? 'up' : 'down'}">${pct > was ? 'up' : 'down'} from ${was}%</span>`;
      return `
        <div class="diff-row${i === 0 ? ' diff-top' : ''}">
          <span class="diff-name">${esc(r.name || '')}</span>
          <span class="diff-pct">${pct}% ${move}</span>
          <div class="diff-bar"><div class="diff-fill" style="width:${pct}%"></div></div>
          <p class="diff-note">${esc(r.why || r.note || '')}</p>
          ${r.moves ? `<p class="diff-moves"><span>Moves on:</span> ${esc(r.moves)}</p>` : ''}
        </div>`;
    });
    diffContainer.innerHTML = `
      ${line ? `
        <div class="diff-head">
          <h3 class="diff-line">${esc(line)}${d.dxOverride ? ' <span class="dim small">(your call)</span>' : ''}</h3>
        </div>` : ''}
      ${rows.length
        ? `<div class="diff-list">${rows.join('')}</div>`
        : '<p class="dim small">No differential yet. Run an analysis with some conversation to read.</p>'}
      <p class="diff-disclaimer">These are my confidence levels, not clinical probabilities. Orientation for advocacy, not a diagnosis.</p>`;
  }

  /**
   * What the advisor did with every file it was handed. Eric shared eight
   * documents once and the advisor discussed three, with nothing on screen to
   * say why, so this panel exists to make that unmissable: read, already read,
   * queued for the next pass, or unreadable with the reason and a request for
   * screenshots.
   *
   * The bar while a run is live is deliberately indeterminate. The model reads
   * every file inside one turn, so there is no honest per-file percentage to
   * show, and inventing one would be the same lie in a nicer shape.
   */
  function renderRead(report, queuedNames, running, plan) {
    const groups = [];
    const rd = report || {};
    const list = (names, cls, label) => {
      if (!names?.length) return;
      groups.push(`<div class="rd-group ${cls}">
        <span class="rd-label">${esc(label)}</span>
        <ul>${names.map((n) => `<li>${esc(String(n))}</li>`).join('')}</ul>
      </div>`);
    };

    // The live bar keys off mediaPlan, which the WORKER stamps at dispatch, so
    // it shows for every trigger: taps, the cron, another device. The old
    // local counter only knew about taps made in this same browser session,
    // which is why cron-fired runs sat on last run's frozen "1 of 3" all
    // night.
    if (running && plan?.length) {
      readEl.hidden = false;
      readEl.innerHTML = `
        <div class="rd-head"><strong>Reading ${plan.length} file${plan.length === 1 ? '' : 's'}</strong>
          <span class="dim small">${esc(plan.slice(0, 4).join(', '))}${plan.length > 4 ? '…' : ''}</span></div>
        <div class="rd-bar rd-busy"><i></i></div>`;
      return;
    }

    const read = rd.read || [];
    const known = rd.known || [];
    const queued = rd.queued?.length ? rd.queued : (queuedNames || []);
    const deferred = rd.deferred || [];
    const bad = rd.unreadable || [];
    const total = read.length + known.length + queued.length + deferred.length + bad.length;
    if (!total) { readEl.hidden = true; readEl.innerHTML = ''; return; }

    const done = read.length + known.length;
    list(read, 'rd-ok', `Read this pass (${read.length})`);
    list(known, 'rd-known', `Already read (${known.length})`);
    list(queued, 'rd-queued', `Queued for the next pass (${queued.length})`);
    list(deferred, 'rd-queued', `Set aside after interrupted reads, retried later (${deferred.length})`);
    list(bad, 'rd-bad', `Couldn't read (${bad.length})`);

    // Open when something needs him: a file waiting on the next pass, or one
    // that needs screenshots. When every file was read there is nothing to act
    // on, so it collapses to the one line that answers the question.
    const needsHim = queued.length || bad.length;
    readEl.hidden = false;
    readEl.innerHTML = `
      <details class="rd" ${needsHim ? 'open' : ''}>
        <summary>
          <span class="rd-head">
            <strong>Files: ${done} of ${total} read</strong>
            ${rd.at ? `<span class="dim small">${esc(timeAgo(toDate(rd.at)))}</span>` : ''}
          </span>
          <span class="rd-bar"><i style="width:${total ? Math.round((done / total) * 100) : 0}%"></i></span>
        </summary>
        ${groups.join('')}
        ${queued.length ? '<p class="dim small">These are attached to the next analysis on their own. Nothing was dropped.</p>' : ''}
        ${bad.length ? '<p class="dim small">Tap ＋ Add a file to send screenshots of these.</p>' : ''}
      </details>`;
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
        // mediaReport rides along so the digest line can count what the last
        // run read without a second lookup.
        const d = apply({ ...(out.state || {}), mediaReport: out.mediaReport || null },
          out.qa || [], out.glossary || []);
        busy = d.running || d.draftAlive ||
          (out.qa || []).some((q) => q.status === 'running');
        // The folder pages (differential, notes, the header line) and the
        // chat's correction marks all feed off this one poll. This panel only
        // ever mounts on admin pages, so the event stays admin-side.
        const detail = {
          kind,
          id,
          notes: out.notes || '',
          notesUpdatedAt: out.notesUpdatedAt || null,
          corrections: out.corrections || [],
          unanswered: out.unanswered || [],
          differential: out.differential || [],
          diffHistory: out.state?.diffHistory || [],
          workingLine: out.workingLine || '',
          dxOverride: out.dxOverride || null,
          // The Education and About-you folder pages ride this same poll, so
          // the panel stays the single place that talks to the state route.
          glossary: out.glossary || [],
          about: out.about || null,
          // The prep sheet is assembled from this rather than from a second
          // model call: it is the read Eric already trusts, and asking twice
          // would give him two versions to reconcile.
          analysis: out.state?.analysis || '',
          // Activity stamps, for the dots on the tabs. The same moments the
          // shelf paints its emoji from, so both surfaces agree on what is new.
          advisorAt: out.state?.updatedAt || null,
          diffAt: out.state?.diffAt || null,
          draftAt: out.state?.draftStatus === 'ready' ? (out.state?.draftAt || null) : null,
          fileAt: out.state?.fileAt || null,
          // The Chat tab's dot reads this. It was never sent, so the one dot
          // that says "they wrote back" never lit inside a case.
          clientMsgAt: out.state?.clientMsgAt || null,
          // The appeal workbench rides this poll too, for the same reason
          // Education and About-you do: one place talks to the state route.
          // This detail object is a WHITELIST, so a field that is not named
          // here simply never reaches the page that needs it.
          appeal: out.state?.appeal || '',
          appealStatus: out.state?.appealStatus || null,
          appealAt: out.state?.appealAt || null,
          appealError: out.state?.appealError || '',
          appealMeta: out.state?.appealMeta || null,
          // The call-notes panel on the Drafts page rides the poll the same
          // way. Same whitelist rule: name the field or the page never sees it.
          callNotes: out.state?.callNotes || '',
          callNotesStatus: out.state?.callNotesStatus || null,
          callNotesAt: out.state?.callNotesAt || null,
          callNotesError: out.state?.callNotesError || '',
        };
        renderDiff(detail);
        renderRead(out.mediaReport, out.queuedFiles, d.running, out.state?.mediaPlan || []);
        document.dispatchEvent(new CustomEvent('pa-panel-state', { detail }));
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
        <input type="file" hidden multiple data-upfile accept="image/png,image/jpeg,image/webp,image/gif,application/pdf">
      </label>
      ${mediaSel.size ? '<span class="dim small" style="align-self:center;">read on Analyze, only by the advisor</span>' : ''}`;
    // Names as text, never markup — file names are user data.
    const names = chipsEl.querySelectorAll('.adv-chip-name');
    [...mediaSel.values()].forEach((m, i) => { if (names[i]) names[i].textContent = m.name; });
    chipsEl.querySelectorAll('[data-unstage]').forEach((b) =>
      b.addEventListener('click', () => {
        mediaSel.delete(b.dataset.unstage);
        syncStaged();
        document.dispatchEvent(new CustomEvent('pa-panel-select'));
      }));
    chipsEl.querySelector('[data-upfile]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      hideErr();
      const isPdf = file.type === 'application/pdf';
      const cap = isPdf ? 12 * 1024 * 1024 : Math.floor(4.5 * 1024 * 1024);
      if (!isPdf && !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
        showErr(`${file.name}: the advisor reads JPEG, PNG, WebP, GIF, and PDF.`);
        return;
      }
      if (file.size > cap) {
        showErr(`${file.name} is too big to read (${isPdf ? '12' : '4.5'} MB max).`);
        return;
      }
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(new Error('read failed'));
        r.readAsDataURL(file);
      }).catch(() => '');
      if (!data) {
        showErr(`Couldn't read ${file.name} from this device.`);
        return;
      }
      mediaSel.set(`inline:${++inlineSeq}`, {
        name: file.name, data, contentType: file.type, size: file.size,
      });
      syncStaged();
    });
  }
  syncStaged();
  document.addEventListener('pa-panel-toggle', (e) => {
    const a = e.detail?.attachment;
    if (!a?.url) return;
    if (mediaSel.has(a.url)) mediaSel.delete(a.url);
    else mediaSel.set(a.url, { name: a.name || 'file', url: a.url, contentType: a.contentType || '', size: a.size || 0 });
    syncStaged();
    document.dispatchEvent(new CustomEvent('pa-panel-select'));
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
      // (The live "reading" bar paints from the worker's mediaPlan now, so
      // nothing here needs to remember the count.)
      mediaSel.clear();
      syncStaged();
      document.dispatchEvent(new CustomEvent('pa-panel-select'));
    }
    post({ action: 'analyze', ...(media ? { media } : {}) });
    // post() resolves when the whole keepalive stream ends, minutes from now,
    // and the next idle poll could be 12 seconds out. Poll now so the status
    // line moves the moment the worker stamps the run, not a quarter minute
    // after he pressed the button.
    setTimeout(refresh, 700);
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
      awaitingDraft = true;
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
      showErr('Type a question first.');
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

  // The conversation with the advisor lives on its own Chat page when the
  // host provides one (Eric, 2026-08-21: "Do move where I talk to the advisor
  // there"). The nodes MOVE - listeners, poll references and all - so
  // everything above keeps working untouched; only the address changes. The
  // Read page keeps the analysis, the controls and the errors.
  if (qaContainer) {
    qaContainer.innerHTML = `
      <div class="panel advisor-panel">
        <div class="advisor">
          <h3>💬 Ask your advisor</h3>
          <p class="dim small">Questions and answers about this case, between you and the advisor only. The client never sees any of it.</p>
        </div>
      </div>`;
    const home = qaContainer.querySelector('.advisor');
    home.appendChild(qaEl);
    home.appendChild(container.querySelector('.advisor-foot'));
    // The Chat page's own error line, painted in lockstep with the Read
    // page's by showErr/hideErr. Without it, a failure caused by a button on
    // THIS page reported itself on a page he was not looking at.
    chatErr = document.createElement('p');
    chatErr.className = 'error';
    chatErr.hidden = true;
    home.appendChild(chatErr);
  }

  // "Send to the advisor for review" — dispatched by the chat's long-press
  // menu and the file list. The file rides the ask flow as an attachment; the
  // Worker fetches and actually reads it (images and PDFs).
  document.addEventListener('pa-panel-review', (e) => {
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

  // The chat applied a correction: tell the worker so the fix mark clears
  // and the same correction never rides back in on the next analysis.
  document.addEventListener('pa-mark-done', (e) => {
    const msgId = e.detail?.msgId;
    if (!msgId) return;
    post({ action: 'correction-dismiss', msgId });
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
        awaitingDraft = true;
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
  // The term NAME is a link to its own row in the full dictionary; the box
  // and the definition text still tick it. Interactive content inside a label
  // does not activate the label, so the two taps stay separate.
  const item = (g) => `
    <label class="gloss-item">
      <input type="checkbox" data-term="${esc(g.id)}" ${g.learned ? 'checked' : ''}>
      <span class="gloss-text"><strong><a class="term-jump" href="/admin-dictionary.html#k=${encodeURIComponent(termKey(g.term))}">${esc(g.term)}</a></strong>: ${esc(g.definition)}</span>
    </label>`;
  const fresh = glossary.filter((g) => !g.learned);
  const known = glossary.filter((g) => g.learned);
  return `
    <p class="dim small" style="margin:.1rem 0 .6rem;">Tick a term once you own it — it's never explained to you again, and the advisor pitches future notes to what you know.</p>
    ${fresh.length ? fresh.map(item).join('') : '<p class="dim small">Nothing new to learn right now.</p>'}
    ${known.length ? `<details class="gloss-known"><summary>✓ ${known.length} term${known.length === 1 ? '' : 's'} you know</summary>${known.map(item).join('')}</details>` : ''}
    <p class="small" style="margin:.6rem 0 0;"><a href="/admin-dictionary.html">📚 Full dictionary, by type and A to Z →</a></p>`;
}

/**
 * Split the assessment on its \`##\` headings into flippable pages.
 *
 * "Plain English" is the one section that does NOT get a page of its own. Eric
 * asked for the comprehensive read and then, under a divider that fades at the
 * edges, the same thing in plain words - and the colour pairing only works if
 * both are on the screen at once. So it rides under the section before it.
 */
function splitPages(text) {
  const parts = String(text).split(/^##\s+/m).filter((p) => p.trim());
  if (parts.length < 2) return [{ title: 'Notes', body: String(text) }];
  const pages = [];
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const title = (nl === -1 ? part : part.slice(0, nl)).trim();
    const body = nl === -1 ? '' : part.slice(nl + 1);
    if (normTitle(title) === 'plain english' && pages.length) {
      pages[pages.length - 1].plain = body;
      continue;
    }
    pages.push({ title, body });
  }
  return pages;
}

/**
 * Just enough markdown for what the model actually emits.
 *
 * A paragraph is a run of lines with a blank line at each end, not one line.
 * This used to wrap every single line in its own <p>, so hard-wrapped prose -
 * which is most of what comes back - was served as a column of sentence
 * fragments with a paragraph gap between them. That is the page he reads to
 * think with.
 */
function md(text, terms = null) {
  const lines = String(text).trim().split('\n');
  let html = '';
  let inList = false;
  let para = [];
  const flush = () => {
    if (!para.length) return;
    html += `<p>${inline(para.join(' '), terms)}</p>`;
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flush();
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(bullet ? bullet[1] : numbered[1], terms)}</li>`;
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    if (!line.trim()) { flush(); continue; }
    if (/^#{1,6}\s+/.test(line)) {
      flush();
      html += `<h5>${inline(line.replace(/^#{1,6}\s+/, ''), terms)}</h5>`;
      continue;
    }
    // Lines that are structure, not prose, and must not be folded into a
    // paragraph with their neighbours: a table row, a fence, a quote, a rule.
    // Joining a table gave "| Test | Value | | --- | --- | | CRP | 44 |", and
    // joining two fences paired them as inline code across the seam.
    if (/^\s*(\||```|~~~|>|-{3,}$|\*{3,}$)/.test(line)) {
      flush();
      html += `<p class="md-raw">${inline(line.trim(), terms)}</p>`;
      continue;
    }
    para.push(line.trim());
  }
  flush();
  if (inList) html += '</ul>';
  return html;
}

function inline(s, terms = null) {
  let out = esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  // [[Myasthenia gravis]] becomes a painted term. The brackets are stripped
  // either way: a term Eric has since marked learned has no colour left, but
  // it must never show as raw punctuation on his screen.
  out = out.replace(/\[\[([^\]]{1,80})\]\]/g, (_, raw) => {
    const label = raw.trim();
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const i = terms?.get(key);
    return i === undefined
      ? label
      : `<mark class="tm tm-${i}" data-tm="${esc(key)}" title="Open in your dictionary">${label}</mark>`;
  });
  return out;
}

// A painted term is a door, not just a colour: tapping it opens the full
// dictionary AT that term (Eric, 2026-08-23: "take me to the exact term in
// the index that I tapped on"). One listener for every mark this module ever
// paints, wherever its container lives.
document.addEventListener('click', (e) => {
  const m = e.target.closest?.('mark.tm[data-tm]');
  if (m) location.href = `/admin-dictionary.html#k=${encodeURIComponent(m.dataset.tm)}`;
});

/** The same normalization the paint uses, so every door finds the same room. */
function termKey(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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
