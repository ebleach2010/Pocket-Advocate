// "Name this file" — the sheet a client sees the moment they pick something to
// upload.
//
// Eric, 2026-08-21: "when they upload an image or file, prompt them to rename
// this file/photo to its closest description."
//
// The reason is worth stating, because it is not tidiness. A phone names a
// photo IMG_4127.HEIC and a hospital portal names a document
// export_20260814_final(2).pdf, and neither tells anybody what is in it. The
// person who took the photo is the only one who knows it is the rash on the
// back of their hand. Asking them, once, at the moment they still remember,
// is worth more than any amount of guessing afterwards.
//
// Skippable, always. Someone uploading six photos while exhausted should be
// able to press past this six times and still have uploaded six photos.

/** file.jpg -> { stem: 'file', ext: '.jpg' }. No extension is fine. */
function split(name) {
  const m = String(name || 'file').match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/);
  return { stem: (m?.[1] || 'file').trim(), ext: (m?.[2] || '').toLowerCase() };
}

/** A camera name says nothing, so do not prefill the box with one. */
function looksAutomatic(stem) {
  return /^(img|dsc|pxl|photo|image|scan|screenshot|download|untitled|document|export|file)[\s_-]*\d*$/i.test(stem)
    || /^\d{6,}$/.test(stem)
    || /^[0-9a-f-]{20,}$/i.test(stem);
}

/**
 * Ask for a description. Resolves to the name to store, extension included.
 * Never rejects: backing out keeps the original name, because the upload is
 * the point and the name is a bonus.
 */
export function askName(file) {
  return new Promise((resolve) => {
    const { stem } = split(file?.name);
    const original = String(file?.name || 'file');
    // A browser reports an empty type for .HEIC, which is what an iPhone
    // camera produces and the whole reason this sheet exists. Going on the
    // type alone called an iPhone photo a "file" and offered it a blood-test
    // example to copy.
    const ext = (split(file?.name).ext || '').toLowerCase();
    const isImage = /^image\//.test(file?.type || '')
      || ['.heic', '.heif', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'].includes(ext);
    const suggestion = looksAutomatic(stem) ? '' : stem;

    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    overlay.innerHTML = `
      <div class="settings-card rename-card" role="dialog" aria-modal="true" aria-label="Name this file">
        <div class="row"><h3 style="margin:0;">Name this ${isImage ? 'photo' : 'file'}</h3></div>
        <p class="dim small" style="margin:.5rem 0 .7rem;">In your own words, what is it? A few words is plenty.
          It makes this far easier to find later, and it tells me what I am looking at.</p>
        <input type="text" data-name maxlength="80" autocomplete="off" autocapitalize="sentences"
          placeholder="${isImage ? 'Rash on the back of my left hand' : 'March blood test results'}"
          style="width:100%;">
        <p class="dim small" data-was style="margin:.45rem 0 0;"></p>
        <div class="actions" style="margin-top:.8rem; display:flex; gap:.5rem; flex-wrap:wrap;">
          <button class="btn glow" data-save disabled>Use this name</button>
          <button class="btn quiet" data-skip>Keep the original</button>
        </div>
      </div>`;

    // textContent: the file name is theirs, not ours.
    overlay.querySelector('[data-was]').textContent = `Right now it is called ${original}.`;
    const input = overlay.querySelector('[data-name]');
    input.value = suggestion;
    // The filled button is the loudest thing on the sheet and it starts with an
    // empty box, because a camera name is never offered back. Tapping it did
    // exactly what skipping does, with no error and no sign anything happened.
    const saveBtn = overlay.querySelector('[data-save]');
    const syncSave = () => { saveBtn.disabled = !input.value.trim(); };
    syncSave();
    input.addEventListener('input', syncSave);

    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const save = () => {
      const typed = input.value.trim().replace(/[\\/]+/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
      // An empty box means they did not want to, which is the same as skipping.
      done(typed ? `${typed}${ext}` : original);
    };
    function onKey(e) {
      if (e.key === 'Escape') { done(original); return; }
      if (e.key === 'Enter' && document.activeElement === input) { e.preventDefault(); save(); return; }
      if (e.key !== 'Tab') return;
      // It claims aria-modal, so Tab has to stay inside it.
      const can = [...overlay.querySelectorAll('button, input, [href]')]
        .filter((el) => !el.disabled && el.offsetParent !== null);
      if (!can.length) return;
      const first = can[0];
      const last = can[can.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!overlay.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }

    overlay.querySelector('[data-save]').addEventListener('click', save);
    overlay.querySelector('[data-skip]').addEventListener('click', () => done(original));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(original); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    // Do not raise the keyboard on a short screen. It covers the two buttons,
    // and on iOS the layout viewport does not shrink, so the overlay has
    // nothing to scroll and there is no way to reach them at all. They can
    // tap the box themselves when they want to type.
    if (window.innerHeight >= 700) input.focus();
  });
}

/**
 * Safe as a Storage object name, with the description still readable in it.
 *
 * Spaces stay, because a description has spaces in it and this is meant to be
 * read by a person. Separators and leading dots do not: a name is a name, not
 * a path.
 */
export function safeName(name) {
  const out = String(name)
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/^[.\s_-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Nothing legible survived, so there is nothing to call it but a file.
  return /[a-z0-9]/i.test(out) ? out : 'file';
}
