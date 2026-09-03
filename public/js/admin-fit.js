// FREE CALLS on the dashboard (Eric, 2026-09-01: the free 15-minute fit
// call). The list of people who booked one, what they said in a line, and
// the four things he does about a call: send the link, mark it done, mark a
// no-show, cancel. All of it through /api/admin/fit-calls, because the
// leads collection is Worker-only and nothing in a browser reads it direct.
//
// NEEDS A LINK is the one alarm: a video call inside the next 24 hours with
// no join link yet. A phone call needs nothing from him but to ring.

const MOUNTAIN_TZ = 'Etc/GMT+7';
const mtFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: MOUNTAIN_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const toDate = (v) => (v?.toDate ? v.toDate() : new Date(v || 0));

/** Paints the block into `el` and keeps it current after every action. */
export function mountFitCalls(el, { getToken }) {
  if (!el) return;
  el.id = el.id || 'fit-calls';
  const call = async (body) => {
    const token = await getToken();
    const res = await fetch('/api/admin/fit-calls', {
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
    let calls = [];
    try {
      calls = (await call()).calls || [];
    } catch (err) {
      el.innerHTML = `<p class="error small">Couldn't load the free calls: ${esc(err.message)}</p>`;
      return;
    }
    const now = Date.now();
    const ahead = calls.filter((c) => c.state === 'booked' && toDate(c.start).getTime() > now - 2 * 3600_000);
    const past = calls.filter((c) => !ahead.includes(c));
    const done = past.filter((c) => c.state === 'done').length;
    const noShow = past.filter((c) => c.state === 'no-show').length;
    if (!ahead.length && !past.length) { el.innerHTML = ''; return; }
    const rows = ahead.map((c) => {
      const start = toDate(c.start);
      const needsLink = c.method === 'video' && !c.joinLink && start.getTime() - now < 24 * 3600_000;
      return `
      <div class="cmd-row fit-row ${needsLink ? 'hot' : ''}" data-id="${esc(c.id)}">
        <strong>${esc(c.name)}</strong>
        <span class="cmd-what">${mtFmt.format(start)} MST &#183; ${esc(c.method)}${
          needsLink ? ' &#183; <strong class="fld-alert">NEEDS A LINK</strong>' : c.joinLink ? ' &#183; link sent' : ''
        }${c.note ? `<br><em>&ldquo;${esc(c.note)}&rdquo;</em>` : ''}<br>
          <span class="small">${esc(c.email)}${c.phone ? ` &#183; ${esc(c.phone)}` : ''}</span></span>
        <span class="fit-acts">
          ${c.method === 'video' ? `<button class="btn quiet small" data-act="join-link">${c.joinLink ? 'New link' : 'Link'}</button>` : ''}
          <button class="btn quiet small" data-act="done">Done</button>
          <button class="btn quiet small" data-act="no-show">No-show</button>
          <button class="btn quiet small" data-act="cancel">Cancel</button>
        </span>
      </div>`;
    }).join('');
    el.innerHTML = `
      <section class="cmd" aria-label="Free calls">
        <h2 class="cmd-h">FREE CALLS <span class="cmd-count">${ahead.length}</span></h2>
        ${rows || '<p class="dim small" style="margin:0;">No free calls booked ahead.</p>'}
        ${past.length ? `<p class="dim small" style="margin:.2rem 0 0;">Last two weeks: ${done} done, ${noShow} no-show${noShow === 1 ? '' : 's'}.</p>` : ''}
      </section>`;

    el.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
      const row = btn.closest('[data-id]');
      const leadId = row.dataset.id;
      const action = btn.dataset.act;
      const body = { leadId, action };
      if (action === 'join-link') {
        const joinLink = (prompt('Paste the video link (https):') || '').trim();
        if (!joinLink) return;
        body.joinLink = joinLink;
      }
      if (action === 'cancel' && !confirm('Cancel this call? The time reopens and they get an email to pick another.')) return;
      btn.disabled = true;
      try {
        await call(body);
      } catch (err) {
        alert(err.message);
      }
      paint();
    }));
  }

  paint();
  return { refresh: paint };
}
