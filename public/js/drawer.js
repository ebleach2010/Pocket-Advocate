// The drawer: the advocate's shelf of case folders.
//
// Split out of folder.js deliberately. That file is the page engine and the
// client's own case page loads it, so anything in it can be read by a patient
// who opens devtools. A folder card carries the working diagnosis on its front
// and long-presses to let Eric override it, and a client is meant to be blind
// to the fact any of that exists. Nothing here is ever loaded by a client page.
//
// The engine itself still lives in folder.js and is shared by both sides.

// Same press length as chat.js, so one long press feels like every other.
const LONG_PRESS_MS = 550;
const REDUCED = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/**
 * One folder on the shelf. Everything interpolated is escaped here, so callers
 * pass raw strings - except `flags`, which is markup by definition (a run of
 * small pills the caller has already built).
 */
export function folderCardHtml({
  id = '', href = '#', name = '', dx = '', dxIsMine = false,
  meta = '', badge = '', badgeClass = '', flags = '',
  // The work clock, on the card itself. Eric, 2026-08-23: "Sometimes I'm
  // working on it outside of their file and I don't want to load into chat.
  // And sometimes I'm working multiple at once." So the toggle lives where
  // every case is already visible, several can run at the same time, and
  // starting one never opens anything.
  clock = null,
} = {}) {
  const read = String(dx || '').trim();
  // An override has to carry his mark, or a line he wrote reads as the
  // advisor's read of the case.
  const pen = dxIsMine ? '<span class="dx-pen" role="img" aria-label="your read">✎</span>' : '';
  const dxCls = read ? (dxIsMine ? ' mine' : '') : ' empty';
  return `
    <a class="folder" href="${esc(href)}" data-id="${esc(id)}">
      <span class="folder-tab"><span class="folder-name">${esc(name)}</span></span>
      <span class="folder-body">
        <span class="folder-dx${dxCls}" data-dx="${esc(id)}" data-dx-text="${esc(read)}"
          >${read ? `${pen}${esc(read)}` : 'No read yet'}</span>
        ${meta ? `<span class="folder-meta">${esc(meta)}</span>` : '<span class="folder-meta"></span>'}
        ${badge ? `<span class="status-pill ${esc(badgeClass)}">${esc(badge)}</span>` : ''}
        ${flags ? `<span class="folder-flags">${flags}</span>` : ''}
      </span>
      ${clock ? `
        <span class="folder-clock${clock.running ? ' on' : ''}" data-clock="${esc(id)}"
          role="button" tabindex="0"
          aria-pressed="${clock.running ? 'true' : 'false'}"
          aria-label="${clock.running ? 'Stop' : 'Start'} the work clock for ${esc(name)}"
          title="${clock.running ? 'Working now. Tap to stop.' : 'Tap to start the clock'}"
          ><span class="fc-dot" aria-hidden="true"></span><span class="fc-t"
            data-clock-t="${esc(id)}">${esc(clock.label || '')}</span></span>` : ''}
    </a>`;
}

/** Tap a folder: it opens in the hand, then the case page loads. */
export function wireFolderOpen(root) {
  if (!root || root.__paFolderOpen) return;
  root.__paFolderOpen = true;

  root.addEventListener('click', (e) => {
    const card = e.target.closest?.('.folder');
    if (!card || !root.contains(card)) return;

    // The clock is a control ON a link. Without this the browser follows the
    // href and he lands in the case he was trying to avoid opening, which is
    // the entire reason the button is here.
    if (e.target.closest?.('[data-clock]')) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // A long press on the working-diagnosis line opens the override editor, and
    // the click that trails that fired press is not a request to open the case
    // as well. That mark is the whole test.
    //
    // It used to also swallow every click whose target was the diagnosis line,
    // pressed or not. That line is the middle third of the card and the largest
    // text on it, so the natural place to put a thumb was the one place that
    // did nothing: three taps in the middle, no response, and only a tap that
    // happened to land on the name or the date below it opened anything.
    const pressed = card.dataset.lp === '1' || !!card.querySelector('[data-lp="1"]');
    if (pressed) {
      e.preventDefault();
      delete card.dataset.lp;
      card.querySelectorAll('[data-lp]').forEach((n) => { delete n.dataset.lp; });
      return;
    }

    const href = card.getAttribute('href');
    if (!href || href === '#') return;
    e.preventDefault();
    // Open it. No animation, no delay, no class.
    //
    // (Eric, 2026-08-21: "Scrap the folder opening animation it's fucking it
    // up. Not opening until like 6 taps.")
    //
    // It added `.opening`, which carries pointer-events: none, waited out the
    // animation and then navigated. The class was never removed. Come back to
    // the shelf with the back gesture and the browser restores the page from
    // its cache with the class still on the card, so that folder is dead to
    // the touch from then on. Every folder he had opened stopped working, and
    // the only thing that revived one was a full reload.
    location.assign(href);
  });
}

/**
 * The override sheet. Replaces a prompt(), which does nothing at all inside an
 * iOS home-screen app: the gesture fired, the handler ran, and nothing
 * appeared, which is indistinguishable from the long press not working.
 *
 * Resolves with the new text, '' to hand the line back, or undefined if he
 * backs out. Empty and cancelled are different answers and must stay so.
 */
export function openDxSheet(current) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    overlay.innerHTML = `
      <div class="settings-card dx-card" role="dialog" aria-modal="true" aria-label="Your read">
        <div class="row"><h3 style="margin:0;">Your read</h3>
          <button class="btn quiet" data-cancel>Cancel</button></div>
        <p class="dim small" style="margin:.5rem 0 .4rem;">This goes on the front of
          the folder instead of the line that is there now. Clear it to hand the
          cover back.</p>
        <textarea class="edit-box" data-text maxlength="120" rows="2"></textarea>
        <p class="dim small" data-left style="margin:.35rem 0 0;"></p>
        <div class="actions" style="margin-top:.7rem;">
          <button class="btn" data-save>Save</button>
          <button class="btn quiet" data-clear>Clear it</button>
        </div>
      </div>`;

    const box = overlay.querySelector('[data-text]');
    const left = overlay.querySelector('[data-left]');
    box.value = current || '';
    const count = () => { left.textContent = `${120 - box.value.length} left`; };
    count();
    box.addEventListener('input', count);

    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    function onKey(e) {
      if (e.key === 'Escape') done(undefined);
      // A one-line read: Enter saves rather than adding a newline it cannot keep.
      if (e.key === 'Enter' && !e.shiftKey && document.activeElement === box) {
        e.preventDefault();
        done(box.value.trim().slice(0, 120));
      }
    }

    overlay.querySelector('[data-cancel]').addEventListener('click', () => done(undefined));
    overlay.querySelector('[data-save]').addEventListener('click', () => done(box.value.trim().slice(0, 120)));
    overlay.querySelector('[data-clear]').addEventListener('click', () => done(''));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(undefined); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    setTimeout(() => box.focus(), 30);
  });
}

/**
 * Long-press (or right-click) a folder's working-diagnosis line to override it:
 * handler(id, currentText). The stored text comes off the element, so the "No
 * read yet" placeholder never lands in the editor as if he had written it.
 */
export function wireDxLongPress(root, handler) {
  if (!root || typeof handler !== 'function' || root.__paDxPress) return;
  root.__paDxPress = true;

  let timer = null;
  let from = null;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } from = null; };
  // A finger resting on a screen for half a second moves. Cancelling on any
  // movement at all meant the press mostly did not fire; cancelling on a real
  // drag is what was actually wanted.
  const MOVE_TOLERANCE = 12;

  const fire = (el) => {
    // Marked on both the line and its folder so the click that follows the
    // press opens an editor and not the case.
    el.dataset.lp = '1';
    const card = el.closest('.folder');
    if (card) card.dataset.lp = '1';
    const id = el.dataset.dx || card?.dataset.id || '';
    const text = 'dxText' in el.dataset ? el.dataset.dxText : el.textContent.trim();
    try { handler(id, text); } catch (err) { console.warn('dx override:', err); }
  };

  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.('.folder-dx');
    if (!el || !root.contains(el)) return;
    delete el.dataset.lp;
    from = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => { timer = null; fire(el); }, LONG_PRESS_MS);
  });
  root.addEventListener('pointermove', (e) => {
    if (!timer || !from) return;
    if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > MOVE_TOLERANCE) cancel();
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) =>
    root.addEventListener(ev, cancel));
  root.addEventListener('contextmenu', (e) => {
    const el = e.target.closest?.('.folder-dx');
    if (!el || !root.contains(el)) return;
    e.preventDefault();
    cancel();
    fire(el);
  });
}

/**
 * The work clock on every card. Several may run at once, which the Worker
 * already allows: /api/work is per case and never touches another.
 *
 * `getToken` is passed in rather than imported so this module keeps its "no
 * app imports" property. `onChange(id, running, seconds)` lets the caller
 * keep its own copy of the case in step without a refetch.
 */
export function wireFolderClocks(root, { getToken, onChange } = {}) {
  if (!root || root.__paClocks) return;
  root.__paClocks = true;

  const fmt = (secs) => {
    const t = Math.max(0, Math.floor(secs));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  };

  // Live tick for whatever is running. One interval for the whole shelf, and
  // a minute is plenty: this is hours, not a stopwatch.
  const tick = () => {
    for (const el of root.querySelectorAll('.folder-clock.on')) {
      const started = Number(el.dataset.started) || 0;
      const banked = Number(el.dataset.banked) || 0;
      if (!started) continue;
      const t = el.querySelector('[data-clock-t]');
      if (t) t.textContent = fmt(banked + (Date.now() - started) / 1000);
    }
  };
  clearInterval(root.__paClockTimer);
  root.__paClockTimer = setInterval(tick, 30_000);
  tick();

  const toggle = async (el) => {
    const id = el.dataset.clock;
    const want = !el.classList.contains('on');
    el.classList.add('busy');
    try {
      const token = await getToken();
      const res = await fetch('/api/work', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        // `auto: false` says this is a deliberate tap, so the clock is PINNED:
        // it keeps running while he moves around the app, which is the whole
        // reason the control is out here rather than only inside the case.
        body: JSON.stringify({ caseId: id, on: want, auto: false }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
      el.classList.toggle('on', !!out.running);
      el.setAttribute('aria-pressed', out.running ? 'true' : 'false');
      el.dataset.banked = String(Number(out.seconds) || 0);
      // The ORIGINAL start, not now: tapping a card whose clock was already
      // running must not appear to throw the running stretch away.
      el.dataset.started = out.startedAt ? String(new Date(out.startedAt).getTime()) : '0';
      const t = el.querySelector('[data-clock-t]');
      if (t) t.textContent = fmt(Number(out.seconds) || 0);
      el.title = out.running ? 'Working now. Tap to stop.' : 'Tap to start the clock';
      onChange?.(id, !!out.running, Number(out.seconds) || 0);
    } catch (err) {
      // Say it out loud rather than leaving a button that looks like it worked.
      alert(`Couldn't change the clock: ${err.message}`);
    }
    el.classList.remove('busy');
  };

  root.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-clock]');
    if (el && root.contains(el)) toggle(el);
  });
  // A control has to be operable from the keyboard, and this one is a span on
  // a link, so it needs saying explicitly.
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest?.('[data-clock]');
    if (el && root.contains(el)) { e.preventDefault(); e.stopPropagation(); toggle(el); }
  });

  // Arriving on the shelf is what stops an automatic clock, and the Worker
  // does it while this page is painting the card from a case it read a moment
  // before. admin-presence.js announces the stop; without this the card keeps
  // a running dot on a clock that has already been banked.
  window.addEventListener('pa-clock-stopped', (e) => {
    for (const row of e.detail?.stopped || []) {
      const id = typeof row === 'string' ? row : row?.id;
      const el = id && root.querySelector(`[data-clock="${CSS.escape(id)}"]`);
      if (!el) continue;
      const secs = Number(typeof row === 'string' ? NaN : row?.seconds);
      el.classList.remove('on');
      el.setAttribute('aria-pressed', 'false');
      el.dataset.started = '0';
      if (Number.isFinite(secs)) {
        el.dataset.banked = String(secs);
        const t = el.querySelector('[data-clock-t]');
        if (t) t.textContent = fmt(secs);
      }
      el.title = 'Tap to start the clock';
      onChange?.(id, false, Number.isFinite(secs) ? secs : Number(el.dataset.banked) || 0);
    }
  });
}
