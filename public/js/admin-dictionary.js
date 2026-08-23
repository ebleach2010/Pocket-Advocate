// Eric's medical dictionary: every key term the advisor has logged, grouped by
// type and alphabetical within, each with an "I understand" checkbox. The
// learned list is the advisor's picture of his vocabulary — visible here to
// both of them, editable only by him.

import { requireAdmin, hydrateNav } from './auth.js';

hydrateNav();
const user = await requireAdmin();
if (user) load();

async function load() {
  const el = document.getElementById('dict');
  let terms = [];
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/advisor/dictionary', {
      headers: { authorization: `Bearer ${token}` },
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
    terms = out.terms || [];
  } catch (err) {
    el.innerHTML = `<p class="error">Couldn't load: ${esc(err.message)}</p>`;
    return;
  }
  if (!terms.length) {
    el.innerHTML = '<p class="dim">Nothing yet. Terms arrive as the advisor writes assessments and answers your questions.</p>';
    return;
  }

  const learned = terms.filter((t) => t.learned).length;

  // Groups alphabetical, terms alphabetical inside each.
  const groups = new Map();
  for (const t of terms) {
    const c = t.category || 'General';
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(t);
  }
  const cats = [...groups.keys()].sort((a, b) => a.localeCompare(b));

  el.innerHTML = `
    <p class="dim small">${learned} of ${terms.length} learned.</p>
    ${cats.map((c) => `
      <div class="panel">
        <h3 class="dict-cat">${esc(c)}</h3>
        ${groups.get(c)
          .sort((a, b) => a.term.localeCompare(b.term))
          .map((t) => `
            <label class="gloss-item">
              <input type="checkbox" data-term="${esc(t.id)}" ${t.learned ? 'checked' : ''}>
              <span class="gloss-text"><strong>${esc(t.term)}</strong>: ${esc(t.definition)}
                ${t.learnedVia === 'used-in-question' ? '<span class="dim small"> · learned from how you used it</span>' : ''}</span>
            </label>`).join('')}
      </div>`).join('')}`;

  // Arrive AT the term that was tapped, not at the top of the page. Every
  // term rendered anywhere (a painted mark in an assessment, a name in Key
  // terms or Education) links here as #k=<normalized term>; the row is found
  // by the same normalization, brought to the middle of the screen, and lit
  // briefly so the eye lands with it. A term the dictionary does not hold
  // yet (the advisor logs them with a small lag) just leaves the page at the
  // top, which is the old behavior and the honest one.
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const rawHash = location.hash.replace(/^#/, '');
  const want = rawHash ? norm(decodeURIComponent(rawHash.replace(/^k=/, ''))) : '';
  if (want) {
    const hit = [...el.querySelectorAll('.gloss-item')].find(
      (row) => norm(row.querySelector('strong')?.textContent || '') === want);
    if (hit) {
      hit.classList.add('dict-hit');
      hit.scrollIntoView({ block: 'center' });
      setTimeout(() => hit.classList.remove('dict-hit'), 2600);
    }
  }

  el.querySelectorAll('[data-term]').forEach((cb) =>
    cb.addEventListener('change', async () => {
      cb.disabled = true;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/advisor/dictionary', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ termId: cb.dataset.term, learned: cb.checked }),
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      } catch (err) {
        cb.checked = !cb.checked;
        alert(`Couldn't save that: ${err.message}`);
      }
      cb.disabled = false;
    }));
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
