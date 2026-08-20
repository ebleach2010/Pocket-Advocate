// The private notebook: a sheet of lined paper Eric can format like a word
// processor. He is the only person who will ever load this page, so every
// decision below serves one goal - never lose a word he wrote - rather than
// defending the page from its author.
//
// Two things here look like bugs and are not. Read these before "fixing" them:
//
// 1. document.execCommand. It is deprecated, and it is still the only rich-text
//    API that behaves in iOS Safari, which is where he actually writes. Every
//    replacement is either a framework component (this codebase has no build
//    step) or a hand-rolled selection engine. Retiring it is a library
//    decision, not a patch.
// 2. The toolbar cancels its own pointerdown and mousedown. A button that takes
//    focus is a button that formats nothing, because the selection it was meant
//    to act on died the moment the paper blurred. That is the single most
//    common way a toolbar like this breaks.

// Long enough that a sentence saves as one write, short enough that a phone
// dying mid-thought costs a clause and not a page.
const SAVE_MS = 900;
// How long "Saved" sits before it fades back out.
const SAVED_MS = 1800;
const RETRY_MS = 5000;
// A dead network should not retry forever with a message that says "retrying".
// After this many, the next keystroke is what tries again.
const MAX_TRIES = 4;
// advisor.js polls every 2.5s and hands the result to setHtml. A poll that left
// before his save landed comes back carrying the pre-save html, so server text
// is refused for longer than one poll round after a successful write.
const SETTLE_MS = 4000;

// Exactly what the worker keeps. Anything wider gets stripped server-side on
// the way in, so pasting it would only look like it worked until the next load.
const ALLOW = new Set(['b', 'strong', 'i', 'em', 'u', 'h1', 'h2', 'h3', 'p', 'br',
  'div', 'span', 'ul', 'ol', 'li', 'blockquote', 'font', 'sup', 'sub']);
// Unwrapping these would spill script source and stylesheet text onto the page
// as visible words, so they leave with their contents instead.
const DROP = new Set(['script', 'style', 'noscript', 'iframe', 'object', 'embed',
  'svg', 'math', 'template', 'link', 'meta', 'title', 'head', 'canvas', 'audio', 'video']);

// fontSize takes the old 1-7 scale because that is what <font size> stores.
const TOOLS = [
  { cmd: 'bold', label: 'B', name: 'Bold', cls: 't-b' },
  { cmd: 'italic', label: 'I', name: 'Italic', cls: 't-i' },
  { cmd: 'underline', label: 'U', name: 'Underline', cls: 't-u' },
  { sep: true },
  { block: 'h1', label: 'H1', name: 'Heading 1', cls: 't-h1' },
  { block: 'h2', label: 'H2', name: 'Heading 2', cls: 't-h2' },
  { block: 'p', label: 'Body', name: 'Body text', cls: 't-p' },
  // Nine 44px targets do not fit one phone row. This is where the bar is meant
  // to break when it has to, so the wrap lands between two groups rather than
  // through the middle of one.
  { sep: true, brk: true },
  { size: '2', label: 'A', name: 'Small text', cls: 't-sz t-sz-s' },
  { size: '3', label: 'A', name: 'Normal text', cls: 't-sz t-sz-m' },
  { size: '5', label: 'A', name: 'Large text', cls: 't-sz t-sz-l' },
];

/**
 * mountNotes({ container, initialHtml, onSave })
 *   initialHtml: the saved html if the page already has it. Pass it when you
 *                have it - setHtml is for state that arrives later, and it
 *                deliberately refuses to overwrite work in progress.
 *   onSave(html): called ~900ms after typing stops. May return a promise and
 *                 may reject; a rejection is reported quietly and retried.
 * Returns { setHtml(html), isFocused() }.
 */
export function mountNotes({ container, initialHtml = '', onSave = null } = {}) {
  if (!container) return { setHtml() {}, isFocused: () => false };

  // Opening a second case must not leave the old sheet's listeners behind,
  // still autosaving into a case he has left.
  container.__paNotes?.destroy();

  const abort = new AbortController();
  const on = { signal: abort.signal };

  container.classList.add('notes-root');

  const bar = document.createElement('div');
  bar.className = 'notes-toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Formatting');

  const specs = new Map();
  for (const t of TOOLS) {
    if (t.sep) {
      const s = document.createElement('span');
      s.className = t.brk ? 'notes-sep notes-brk' : 'notes-sep';
      s.setAttribute('aria-hidden', 'true');
      bar.appendChild(s);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button'; // never submit whatever form the page grows later
    b.className = `notes-tool ${t.cls}`;
    b.textContent = t.label;
    b.title = t.name;
    b.setAttribute('aria-label', t.name);
    b.setAttribute('aria-pressed', 'false');
    bar.appendChild(b);
    specs.set(b, t);
  }

  const saved = document.createElement('span');
  saved.className = 'notes-saved';
  saved.setAttribute('aria-live', 'polite');
  bar.appendChild(saved);

  const paper = document.createElement('div');
  paper.className = 'notes-paper';
  paper.setAttribute('contenteditable', 'true');
  paper.setAttribute('spellcheck', 'true');
  paper.setAttribute('role', 'textbox');
  paper.setAttribute('aria-multiline', 'true');
  paper.setAttribute('aria-label', 'Private notes');
  paper.setAttribute('autocapitalize', 'sentences');
  paper.setAttribute('autocorrect', 'on');

  container.append(bar, paper);

  // What we last handed to onSave, read back off the page so it is the
  // browser's serialization on both sides of every comparison.
  let sent = '';
  let timer = null;
  let saving = false;
  let queued = false;
  let tries = 0;
  let okAt = 0;
  let noteTimer = null;
  let raf = 0;
  let range = null;

  // Content goes in after the state above exists, because blankOut can reach
  // straight back into the save timer.
  paper.innerHTML = scrub(initialHtml);
  blankOut();
  sent = paper.innerHTML;

  const focused = () => {
    const a = document.activeElement;
    return a === paper || (!!a && paper.contains(a));
  };

  /* ------------------------------------------------------------- autosave */

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, SAVE_MS);
  }

  async function flush() {
    timer = null;
    if (typeof onSave !== 'function') return;
    const html = paper.innerHTML;
    if (html === sent) return;
    // One write at a time: two in flight can land out of order and the older
    // one wins, which reads as a paragraph undoing itself.
    if (saving) { queued = true; return; }
    saving = true;
    try {
      await onSave(html);
      sent = html;
      okAt = Date.now();
      tries = 0;
      say('Saved', '');
    } catch (err) {
      // The text never moves. A failed save costs him the reassurance, not
      // the writing, and the next edit tries again on its own.
      tries += 1;
      console.warn('notes save:', err);
      if (tries < MAX_TRIES) {
        say('Not saved yet. Retrying.', 'warn');
        if (!timer) timer = setTimeout(flush, RETRY_MS);
      } else {
        say('Not saved. Your writing is still here.', 'warn');
      }
    } finally {
      saving = false;
      if (queued) { queued = false; schedule(); }
    }
  }

  // iOS discards backgrounded tabs without warning, and a 900ms debounce that
  // never fires is a lost paragraph. This is best effort: the request gets to
  // start, nothing can promise it finishes.
  function flushNow() {
    if (timer) { clearTimeout(timer); timer = null; }
    flush();
  }

  function say(text, cls) {
    saved.textContent = text;
    saved.className = `notes-saved show${cls ? ` ${cls}` : ''}`;
    if (noteTimer) clearTimeout(noteTimer);
    // A warning stays up until the next successful save clears it.
    if (cls) return;
    noteTimer = setTimeout(() => saved.classList.remove('show'), SAVED_MS);
  }

  /* -------------------------------------------------- selection and tools */

  function queueSync() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; syncTools(); });
  }

  function syncTools() {
    if (!focused()) return;
    const block = value('formatBlock').replace(/[<>]/g, '');
    const size = value('fontSize');
    specs.forEach((t, b) => {
      let lit = false;
      if (t.cmd) lit = state(t.cmd);
      // A plain paragraph reports itself as p, as div, or as nothing at all,
      // depending on the browser and on what wrapped the line.
      else if (t.block) lit = t.block === 'p' ? (block === 'p' || block === 'div' || !block) : block === t.block;
      else if (t.size) lit = size ? size === t.size : t.size === '3';
      b.classList.toggle('on', lit);
      b.setAttribute('aria-pressed', lit ? 'true' : 'false');
    });
  }

  function clearTools() {
    for (const b of specs.keys()) {
      b.classList.remove('on');
      b.setAttribute('aria-pressed', 'false');
    }
  }

  function remember() {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (paper.contains(r.commonAncestorContainer)) range = r.cloneRange();
  }

  function restore() {
    paper.focus({ preventScroll: true });
    if (!range) return;
    const sel = document.getSelection();
    if (!sel) return;
    // Only reinstate the saved range when the caret has genuinely left the
    // paper. Laying a stale range over a live one collapses what he just
    // picked, which looks exactly like the toolbar formatting the wrong words.
    const cur = sel.rangeCount ? sel.getRangeAt(0) : null;
    if (cur && paper.contains(cur.commonAncestorContainer)) return;
    try { sel.removeAllRanges(); sel.addRange(range); } catch { /* range went stale */ }
  }

  // styleWithCSS off keeps bold as <b> rather than <span style>. With it on,
  // every bold he applied would be stripped by the worker's whitelist on the
  // way to the database. Both flags are document-wide and any other script can
  // flip them, so they are re-set before each command.
  function prep() {
    try { document.execCommand('styleWithCSS', false, false); } catch { /* not supported */ }
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* not supported */ }
  }

  function run(t) {
    restore();
    prep();
    try {
      if (t.cmd) document.execCommand(t.cmd, false, null);
      else if (t.block) document.execCommand('formatBlock', false, `<${t.block}>`);
      else if (t.size) document.execCommand('fontSize', false, t.size);
    } catch (err) {
      console.warn('notes format:', err);
    }
    remember();
    syncTools();
    // execCommand fires `input` in every browser we ship to, but a formatting
    // change that quietly never saves is the one failure with no symptom.
    schedule();
  }

  /* ------------------------------------------------------------- wiring */

  const keepFocus = (e) => e.preventDefault();
  bar.addEventListener('pointerdown', keepFocus, on);
  bar.addEventListener('mousedown', keepFocus, on);
  bar.addEventListener('click', (e) => {
    const b = e.target.closest?.('.notes-tool');
    const t = b && specs.get(b);
    if (!t) return;
    e.preventDefault();
    run(t);
  }, on);

  paper.addEventListener('input', () => { schedule(); queueSync(); }, on);
  paper.addEventListener('focus', () => { prep(); queueSync(); }, on);
  paper.addEventListener('blur', () => {
    blankOut();
    // Nothing is selected any more, so leaving the marks lit would be a lie
    // about what the next tap will do.
    clearTools();
  }, on);

  document.addEventListener('selectionchange', () => {
    // selectionchange fires for every caret move anywhere on the page,
    // including the chat composer one tab over.
    if (!focused()) return;
    remember();
    queueSync();
  }, on);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushNow();
  }, on);
  window.addEventListener('pagehide', flushNow, on);

  paper.addEventListener('paste', (e) => {
    const dt = e.clipboardData;
    if (!dt) return; // no clipboard access: let the browser do whatever it does
    const html = dt.getData('text/html');
    const text = dt.getData('text/plain');
    if (!html && !text) return;
    e.preventDefault();
    prep();
    try {
      const clean = html ? scrub(html) : '';
      // insertText for plain text, not insertHTML: it keeps angle brackets as
      // characters and it stays in the undo stack.
      if (clean) document.execCommand('insertHTML', false, clean);
      else if (text) document.execCommand('insertText', false, text);
    } catch (err) {
      console.warn('notes paste:', err);
    }
    schedule();
  }, on);

  /**
   * A sheet he emptied still holds <div><br></div>, which is not :empty, so the
   * placeholder never comes back and the database stores a blank paragraph as
   * though it were writing. Only ever run with the caret gone: rewriting
   * innerHTML under a live caret would drop it to the top of the page.
   */
  function blankOut() {
    if (paper.innerHTML === '') return;
    if (paper.textContent.trim() || paper.querySelector('li, img')) return;
    paper.innerHTML = '';
    schedule();
  }

  /**
   * Server state arriving from the poll. It never wins over the hand on the
   * keyboard: the advisor draft card learned this when a poll landing mid-edit
   * wiped the sentence he was in the middle of.
   *
   * Note the one-way street - html accepted here is not saved back, so a server
   * whose sanitizer trims something ours keeps cannot start a write loop.
   */
  function setHtml(html) {
    const next = scrub(html);
    const cur = paper.innerHTML;
    if (next === cur) return;
    if (focused()) return;         // he is in it right now
    if (cur !== sent) return;      // unsaved work on the page
    if (timer || saving) return;   // a save of that work is already on its way
    if (Date.now() - okAt < SETTLE_MS) return; // this poll may predate our write
    paper.innerHTML = next;
    sent = next;
  }

  container.__paNotes = {
    destroy() {
      abort.abort();
      if (timer) clearTimeout(timer);
      if (noteTimer) clearTimeout(noteTimer);
      if (raf) cancelAnimationFrame(raf);
      bar.remove();
      paper.remove();
      container.classList.remove('notes-root');
      delete container.__paNotes;
    },
  };

  return { setHtml, isFocused: focused };
}

/* ------------------------------------------------------------------ paste */

/**
 * Cut pasted markup down to the tags the worker will keep. Parsed with
 * DOMParser rather than a live element: that document is inert, so an <img
 * onerror> or a tracking pixel in the clipboard never runs or loads while we
 * are looking at it.
 */
function scrub(html) {
  const s = String(html ?? '');
  if (!s) return '';
  let doc;
  try {
    doc = new DOMParser().parseFromString(s, 'text/html');
  } catch {
    return '';
  }
  if (!doc || !doc.body) return '';
  strip(doc.body);
  const out = doc.body.innerHTML;
  // Whitespace-only html would defeat :empty and leave the placeholder hidden
  // behind a sheet that looks blank.
  return (doc.body.textContent.trim() || /<(br|img|li)\b/i.test(out)) ? out : '';
}

function strip(root) {
  for (const n of Array.from(root.childNodes)) {
    if (n.nodeType === 8) { n.remove(); continue; } // comments
    if (n.nodeType !== 1) continue;                 // text survives untouched
    const tag = n.tagName.toLowerCase();
    if (DROP.has(tag)) { n.remove(); continue; }
    strip(n);
    if (!ALLOW.has(tag)) { unwrap(n); continue; }
    for (const a of Array.from(n.attributes)) {
      const keep = tag === 'font' && a.name.toLowerCase() === 'size' && /^[1-7]$/.test(a.value.trim());
      if (!keep) n.removeAttribute(a.name);
    }
  }
}

/** Drop the tag, keep the words that were inside it. */
function unwrap(el) {
  const p = el.parentNode;
  if (!p) return;
  while (el.firstChild) p.insertBefore(el.firstChild, el);
  el.remove();
}

/* ----------------------------------------------------------------- queries */
// Both throw outright in some embeddings rather than returning a falsy value.

function state(cmd) {
  try { return !!document.queryCommandState(cmd); } catch { return false; }
}

function value(cmd) {
  try { return String(document.queryCommandValue(cmd) || '').toLowerCase(); } catch { return ''; }
}
