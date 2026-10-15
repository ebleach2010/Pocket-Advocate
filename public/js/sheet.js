// ONE ASKING SHEET (2026-10-15, the look audit). window.prompt() and
// window.confirm() draw the browser's own grey box, and prompt() does
// nothing at all inside an app opened from the Home Screen, so a control
// that leaned on it was simply dead on Eric's phone. This draws the same
// sheet as the cancel step (look.css styles dialog.cancel-sheet), in the
// app's own words.
//
//   await ask({ title, body, okLabel, cancelLabel, danger, input })
//     with input ({ value, placeholder, type }) resolves to the text typed,
//     or null when cancelled; without it, to true or false.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function ask({ title, body = '', okLabel = 'OK', cancelLabel = 'Cancel', danger = false, input = null } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'cancel-sheet ask-sheet';
    dlg.setAttribute('aria-label', title || 'Confirm');
    dlg.innerHTML = `
      <form method="dialog" class="ask-form">
        ${title ? `<h2>${esc(title)}</h2>` : ''}
        ${body ? `<p>${esc(body)}</p>` : ''}
        ${input ? `<input class="ask-input" type="${esc(input.type || 'text')}" value="${esc(input.value ?? '')}" placeholder="${esc(input.placeholder || '')}" autocomplete="off">` : ''}
        <div class="cancel-acts">
          <button type="submit" class="btn ${danger ? 'danger' : 'glow'}" value="ok">${esc(okLabel)}</button>
          <button type="button" class="btn quiet" data-no>${esc(cancelLabel)}</button>
        </div>
      </form>`;
    const field = dlg.querySelector('.ask-input');
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      const value = field ? (ok ? field.value : null) : !!ok;
      dlg.close();
      dlg.remove();
      resolve(value);
    };
    dlg.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); finish(true); });
    dlg.querySelector('[data-no]').addEventListener('click', () => finish(false));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(false); });
    document.body.appendChild(dlg);
    dlg.showModal();
    if (field) { field.focus(); field.select(); } else dlg.querySelector('[data-no]').focus();
  });
}
