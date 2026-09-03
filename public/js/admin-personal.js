// PERSONAL UPLOADS 🤫 (Eric, 2026-09-03: "uploads of documents just for me...
// These uploads are ONLY visible to me.")
//
// One module, two shelves: the Clients page mounts it with scope 'all', a
// case's Mine tab mounts it with scope 'case'. Every byte goes through the
// Worker (POST /api/admin/personal) into a Storage prefix that storage.rules
// deny to every browser, and comes back the same way. Nothing here touches
// the Firebase SDK, nothing here names a case folder, and no client module
// imports this file: it is gated as an admin asset, 404 to anyone else.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const MAX_BYTES = 50 * 1024 * 1024;
const when = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const fileHref = (path) => `/api/admin/personal/file?path=${encodeURIComponent(path)}`;

/**
 * Paints the shelf into `el`. `scope` is 'all' or 'case' (with `caseId`).
 * `open` starts it unfolded; the Clients page keeps it folded because it is
 * private and the shelf below it is the work.
 */
export function mountPersonal(el, { getToken, scope = 'all', caseId = '', open = false }) {
  if (!el) return null;
  let files = [];
  let filter = '';
  let unfolded = !!open;
  const q = (scope === 'case') ? `?scope=case&caseId=${encodeURIComponent(caseId)}` : '?scope=all';

  const api = async (method, { body, headers, raw } = {}) => {
    const token = await getToken();
    const res = await fetch(`/api/admin/personal${method === 'GET' ? q : ''}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(raw ? {} : body ? { 'content-type': 'application/json' } : {}),
        ...(headers || {}),
      },
      body: raw ? raw : body ? JSON.stringify(body) : undefined,
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
    return out;
  };

  el.innerHTML = `
    <section class="panel personal-shelf" id="personal-uploads">
      <button type="button" class="personal-head" aria-expanded="${unfolded}">
        <span class="personal-title">Personal Uploads 🤫</span>
        <span class="dim small personal-count"></span>
        <span class="personal-chev" aria-hidden="true">›</span>
      </button>
      <div class="personal-body" ${unfolded ? '' : 'hidden'}>
        <p class="dim small personal-note">${scope === 'case' ? 'Documents for this case, for your eyes only.' : 'Documents for your eyes only, across every case.'} Nothing a client can open, nothing the advisor reads, nothing in any export.</p>
        <div class="personal-row">
          <input type="search" class="personal-search" placeholder="Search" aria-label="Search personal uploads">
          <label class="btn glow personal-up">Upload<input type="file" multiple hidden></label>
        </div>
        <p class="dim small personal-progress" hidden></p>
        <p class="error personal-error" hidden></p>
        <ul class="filelist personal-list"></ul>
      </div>
    </section>`;
  const head = el.querySelector('.personal-head');
  const body = el.querySelector('.personal-body');
  const list = el.querySelector('.personal-list');
  const count = el.querySelector('.personal-count');
  const progress = el.querySelector('.personal-progress');
  const errEl = el.querySelector('.personal-error');
  const showErr = (m) => { errEl.textContent = m; errEl.hidden = !m; };

  const paint = () => {
    const rows = filter
      ? files.filter((f) => f.name.toLowerCase().includes(filter))
      : files;
    count.textContent = files.length ? `${files.length} file${files.length === 1 ? '' : 's'} · only you` : 'only you';
    list.innerHTML = rows.length ? rows.map((f, i) => `
      <li data-i="${i}">
        <span class="up-text">
          <span class="fname"><a href="${f.url ? esc(f.url) : fileHref(f.path)}" target="_blank" rel="noopener">${esc(f.name)}</a></span>
          <span class="fmeta">${when.format(new Date(f.at))} · ${size(f.size)}</span>
        </span>
        <button type="button" class="btn quiet small personal-del" data-path="${esc(f.path)}" aria-label="Delete ${esc(f.name)}" title="Delete">✕</button>
      </li>`).join('')
      : `<li class="dim small">${filter ? 'Nothing matches.' : 'Nothing here yet.'}</li>`;
    list.querySelectorAll('.personal-del').forEach((b) => b.addEventListener('click', async () => {
      const f = files.find((x) => x.path === b.dataset.path);
      if (!f || !confirm(`Delete "${f.name}"? This cannot be undone.`)) return;
      b.disabled = true;
      try {
        await api('DELETE', { body: { path: f.path } });
        files = files.filter((x) => x.path !== f.path);
        paint();
      } catch (e) { showErr(e.message); b.disabled = false; }
    }));
  };

  const load = async () => {
    try {
      files = (await api('GET')).files || [];
      showErr('');
    } catch (e) { showErr(`Couldn't load: ${e.message}`); }
    paint();
  };

  head.addEventListener('click', () => {
    unfolded = !unfolded;
    body.hidden = !unfolded;
    head.setAttribute('aria-expanded', String(unfolded));
    if (unfolded && !files.length) load();
  });
  el.querySelector('.personal-search').addEventListener('input', (e) => {
    filter = e.target.value.trim().toLowerCase();
    paint();
  });
  el.querySelector('.personal-up input').addEventListener('change', async (e) => {
    const picked = [...(e.target.files || [])];
    e.target.value = '';
    showErr('');
    for (const [n, file] of picked.entries()) {
      if (file.size > MAX_BYTES) { showErr(`${file.name} is over 50 MB.`); continue; }
      progress.textContent = `Uploading ${file.name}${picked.length > 1 ? ` (${n + 1} of ${picked.length})` : ''}…`;
      progress.hidden = false;
      try {
        const out = await api('POST', {
          raw: file,
          headers: {
            'content-type': file.type || 'application/octet-stream',
            'x-pa-name': encodeURIComponent(file.name),
            'x-pa-scope': scope,
            ...(scope === 'case' ? { 'x-pa-case': caseId } : {}),
          },
        });
        if (out.file) files = [out.file, ...files];
        paint();
      } catch (err) { showErr(`${file.name}: ${err.message}`); }
    }
    progress.hidden = true;
  });

  if (unfolded) load(); else load();
  return { refresh: load };
}
