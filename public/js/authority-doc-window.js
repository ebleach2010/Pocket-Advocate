// Opening an authority document in its own window, once, for both halves.
//
// Eric, 2026-08-26: "The forms are fucking horrendous... Format it neatly."
// And, separately: "There's also no way to exit out of this screen."
//
// Both complaints came out of the same twenty lines, which existed TWICE:
// admin-case.js and case.js each wrote their own near-identical window, each
// dumped the document into a <pre> at 12px monospace, and each called
// win.print() on a 350ms timer with no controls anywhere on the page. Dismiss
// the print sheet on a phone and you are stranded on a bare white document
// with no back, no close, and nothing to tap.
//
// So: one implementation, a real document, and a way out.
//
//   NO AUTO-PRINT. Firing the system print sheet at somebody who tapped
//   "view" is what trapped him. Print is a button he presses.
//
//   A CONTROL BAR THAT IS ALWAYS THERE, fixed to the top, Done on the left
//   where a back button lives. It is hidden in @media print, so it never
//   reaches paper.
//
//   DONE ACTUALLY LEAVES. window.close() works on a window this script
//   opened; where a browser refuses, history.back() runs instead, and if even
//   that does nothing the bar says to close the tab rather than pretending.
//
// PRINT COLOURS ARE LITERALS ON PURPOSE, and this is the one place in the app
// where that is right. This page is paper: black ink on white stock, no
// theme, no tokens. A records department photocopies it. Reading the app's
// palette here would put a dark-mode document through a fax machine.
import { authorityHtml } from './authority.js';

const PAGE_CSS = `
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  html, body { background: #fff; color: #111; }
  body {
    margin: 0;
    font: 15px/1.6 Georgia, 'Times New Roman', 'Iowan Old Style', serif;
    -webkit-text-size-adjust: 100%;
  }
  .doc-bar {
    position: sticky; top: 0; z-index: 10;
    display: flex; gap: .5rem; align-items: center; justify-content: space-between;
    padding: .55rem .75rem;
    background: #f4f2ed; border-bottom: 1px solid #cfc9ba;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .doc-bar button {
    font: 600 15px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    min-height: 44px; padding: 0 1rem;
    border-radius: 10px; border: 1px solid #b9b1a0; background: #fff; color: #111;
    cursor: pointer;
  }
  .doc-bar button.primary { background: #111; color: #fff; border-color: #111; }
  .doc-wrap { max-width: 42rem; margin: 0 auto; padding: 1.4rem 1.1rem 3rem; }
  h1 {
    font-size: 1.22rem; line-height: 1.3; margin: 0 0 1.1rem;
    text-transform: uppercase; letter-spacing: .02em;
    border-bottom: 2px solid #111; padding-bottom: .5rem;
  }
  h2 {
    font-size: .78rem; letter-spacing: .11em; text-transform: uppercase;
    margin: 1.5rem 0 .35rem; color: #444;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  section { page-break-inside: avoid; break-inside: avoid; }
  p { margin: 0 0 .6rem; }
  .doc-line { margin: 0 0 .2rem; }
  .doc-meta { margin: 0 0 1.1rem; display: grid; grid-template-columns: auto 1fr; gap: .15rem .6rem; }
  .doc-meta dt { color: #555; font-size: .9rem; }
  .doc-meta dd { margin: 0; font-weight: 600; }
  .doc-rule { display: inline-block; min-width: 16rem; border-bottom: 1px solid #111; height: 1.1em; vertical-align: baseline; }
  .doc-checks, .doc-bullets { list-style: none; margin: .5rem 0 .6rem; padding: 0; }
  .doc-checks li { display: flex; gap: .6rem; margin: 0 0 .7rem; page-break-inside: avoid; break-inside: avoid; }
  .doc-box {
    flex: none; width: 1.05rem; height: 1.05rem; margin-top: .22rem;
    border: 1.5px solid #111; border-radius: 2px; display: block; position: relative;
  }
  .doc-box.is-on::after {
    content: ''; position: absolute; left: .28rem; top: .02rem;
    width: .32rem; height: .66rem; border: solid #111;
    border-width: 0 2px 2px 0; transform: rotate(42deg);
  }
  .doc-check-body { display: block; }
  .doc-note { display: block; color: #333; font-size: .92rem; }
  .doc-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .doc-bullets li { margin: 0 0 .25rem .2rem; }
  .doc-bullets li::before { content: '\\2022'; margin-right: .5rem; }
  .doc-rights { margin: .3rem 0 .6rem; padding-left: 1.3rem; }
  .doc-rights li { margin: 0 0 .45rem; }
  .doc-sig { margin-top: 1.8rem; border-top: 1px solid #111; padding-top: .8rem; }
  .sig-ink { margin: .9rem 0 0; page-break-inside: avoid; break-inside: avoid; }
  .sig-ink img { max-width: 78mm; max-height: 26mm; display: block; }
  .sig-ink figcaption { font-size: .8rem; color: #444; margin-top: .3rem; }
  @media print {
    .doc-bar { display: none !important; }
    .doc-wrap { max-width: none; padding: 0; }
    body { font-size: 11.5pt; }
  }
`;

/**
 * Open one authority document in its own window.
 *
 * `model` is the document model from authority.js, so this never sees the
 * words and cannot alter them.
 */
export function openAuthorityDocument({ model, title, signatureHtml = '' }) {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Your browser blocked the document window. Allow pop-ups for this site and try again.');
    return null;
  }
  const safeTitle = String(title || 'Document').replace(/[&<>"]/g, '');
  win.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<style>${PAGE_CSS}</style>
</head><body>
<div class="doc-bar">
  <button type="button" data-done>Done</button>
  <button type="button" class="primary" data-print>Print or save as PDF</button>
</div>
<div class="doc-wrap">
${authorityHtml(model)}
${signatureHtml}
</div>
<script>
  document.querySelector('[data-print]').addEventListener('click', function () { window.print(); });
  document.querySelector('[data-done]').addEventListener('click', function () {
    // A window this script opened can normally close itself. Where the
    // browser refuses, go back; where there is nowhere to go back to, say so
    // rather than leaving a dead button, which is the whole complaint.
    window.close();
    setTimeout(function () {
      if (window.history.length > 1) { window.history.back(); return; }
      var b = document.querySelector('[data-done]');
      b.textContent = 'Close this tab to go back';
      b.disabled = true;
    }, 250);
  });
<\/script>
</body></html>`);
  win.document.close();
  return win;
}
