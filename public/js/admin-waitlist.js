// THE WAITLIST on the dashboard (Eric, 2026-10-12). Everyone who joined it
// from the landing page's bubble: their name, the package they want, and a
// tap to call or email them. "Contacted" marks the ones he has got back to;
// "Remove" takes a row off for good. All through /api/admin/waitlist,
// because waitlist/ is Worker-only and nothing in a browser reads it direct.

const PACKAGES = { chat: '24/7 Priority Chat', case: 'Advocacy Case', full: 'Full-Service Case Management' };
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Etc/GMT+7', month: 'short', day: 'numeric' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const toDate = (v) => (v?.toDate ? v.toDate() : new Date(v || 0));

/** Paints the block into `el` and keeps it current after every action. */
export function mountWaitlist(el, { getToken }) {
  if (!el) return;
  const call = async (body) => {
    const token = await getToken();
    const res = await fetch('/api/admin/waitlist', {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
    return out;
  };

  async function paint() {
    let people = [];
    try {
      people = (await call()).people || [];
    } catch (err) {
      el.innerHTML = `<p class="error small">Couldn't load the waitlist: ${esc(err.message)}</p>`;
      return;
    }
    if (!people.length) { el.innerHTML = ''; return; }
    const waiting = people.filter((p) => p.state !== 'contacted').length;
    const rows = people.map((p) => `
      <div class="cmd-row fit-row" data-id="${esc(p.id)}">
        <strong>${esc(p.first)} ${esc(p.last)}</strong>
        <span class="cmd-what">${esc(PACKAGES[p.package] || p.package)} &#183; joined ${dayFmt.format(toDate(p.createdAt))}${
          p.state === 'contacted' ? ' &#183; contacted' : ''}<br>
          <span class="small"><a href="mailto:${esc(p.email)}">${esc(p.email)}</a> &#183; <a href="tel:${esc(String(p.phone).replace(/[^\d+]/g, ''))}">${esc(p.phone)}</a></span></span>
        <span class="fit-acts">
          ${p.state === 'contacted'
            ? '<button class="btn quiet small" data-act="waiting">Not yet</button>'
            : '<button class="btn quiet small" data-act="contacted">Contacted</button>'}
          <button class="btn quiet small" data-act="remove">Remove</button>
        </span>
      </div>`).join('');
    el.innerHTML = `
      <section class="cmd" aria-label="Waitlist">
        <h2 class="cmd-h">WAITLIST <span class="cmd-count">${waiting}</span></h2>
        ${rows}
      </section>`;

    el.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
      const id = btn.closest('[data-id]').dataset.id;
      const action = btn.dataset.act;
      if (action === 'remove' && !confirm('Take this person off the waitlist?')) return;
      btn.disabled = true;
      try {
        await call({ id, action });
      } catch (err) {
        alert(err.message);
      }
      paint();
    }));
  }

  paint();
  return { refresh: paint };
}
