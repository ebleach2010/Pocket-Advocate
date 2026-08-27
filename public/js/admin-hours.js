// IN OFFICE / OUT OF OFFICE, the advocate's half of it.
//
// Eric, 2026-08-27: scheduled hours Monday to Friday, 8:00 to 19:00 Mountain,
// and he can "manually switch himself to out of office (with his daughter,
// etc) and switch it back on", including switching ON when he is pulling
// overtime. The manual switch always beats the schedule, both directions.
//
// ONE CONTROL, TWO MOUNTS. It is on the shelf, because that is the page he
// opens, and on the availability page, because that is where the rest of his
// calendar decisions live. Two copies of this markup would be two answers to
// the same question, which is how the shelf and the chart once disagreed about
// whether a clock was running.
//
// The name matters: `admin-` puts this behind the asset gate in
// worker/index.js, so a client asking for it gets a 404 like every other
// advocate module. A file called hours.js would be served to everyone. What a
// client gets instead is public/js/office.js, which knows how to ask for the
// answer and nothing about how to change it.
//
// NOTHING IS DECIDED HERE EITHER. The Worker owns the rule (officeStatus in
// worker/schedule.js) and hands back the whole state - in or out, what the
// schedule says on its own, and whether the override is currently disagreeing
// with it - so this file paints and never computes.

/**
 * Mounts the control at the top of `root`.
 * `getToken` is passed in so this module keeps no auth import of its own.
 */
export function mountOfficeControl(root, { getToken } = {}) {
  if (!root || root.__paOffice) return;
  root.__paOffice = true;

  const box = document.createElement('div');
  box.className = 'panel office-ctl';
  box.innerHTML = `
    <h3 style="margin:.1rem 0 .5rem;">Your status</h3>
    <div class="office-state">
      <span class="office-big" data-big>CHECKING</span>
      <span class="office-why" data-why></span>
    </div>
    <div class="office-acts">
      <button class="btn quiet" type="button" data-set="in">In office</button>
      <button class="btn quiet" type="button" data-set="out">Out of office</button>
      <button class="btn quiet" type="button" data-set="">Follow my hours</button>
    </div>
    <div class="office-line">
      <input type="text" data-rt maxlength="160"
        placeholder="Response time to show clients (optional)"
        aria-label="Response time to show clients">
      <button class="btn quiet" type="button" data-save-rt>Save line</button>
    </div>
    <p class="dim small" style="margin:.5rem 0 0;">Clients see nothing about how
      long a reply takes unless you type it here. Leave it empty and no
      response time is shown anywhere.</p>
    <p class="error" data-err hidden style="margin:.5rem 0 0;"></p>`;
  root.prepend(box);

  const big = box.querySelector('[data-big]');
  const why = box.querySelector('[data-why]');
  const rt = box.querySelector('[data-rt]');
  const err = box.querySelector('[data-err]');
  // A line he is halfway through typing must survive a repaint, or saving one
  // field wipes the other in front of him.
  let touched = false;
  rt.addEventListener('input', () => { touched = true; });

  const paint = (s) => {
    big.textContent = s.inOffice ? 'IN OFFICE' : 'OUT OF OFFICE';
    big.classList.toggle('in', !!s.inOffice);
    // The override is the thing he has to remember to put back, so when it is
    // actually disagreeing with his hours it says so in words as well as in
    // colour. When it agrees, it is not worth shouting about.
    if (s.overriding) {
      why.textContent = `Set by hand. Your hours say ${s.scheduled ? 'in' : 'out'} right now.`;
      why.classList.add('overriding');
    } else if (s.manual) {
      why.textContent = 'Set by hand, and it matches your hours.';
      why.classList.remove('overriding');
    } else {
      why.textContent = 'Following your hours: Monday to Friday, 8am to 7pm MST.';
      why.classList.remove('overriding');
    }
    for (const b of box.querySelectorAll('[data-set]'))
      b.classList.toggle('on', (b.dataset.set || null) === (s.manual || null));
    if (!touched) rt.value = s.responseTime || '';
  };

  const call = async (body) => {
    err.hidden = true;
    const token = await getToken();
    const res = await fetch('/api/admin/office-hours', {
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

  const run = async (body, btn) => {
    if (btn) btn.disabled = true;
    try {
      paint(await call(body));
      if (body && 'responseTime' in body) touched = false;
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
    if (btn) btn.disabled = false;
  };

  for (const b of box.querySelectorAll('[data-set]')) {
    b.addEventListener('click', () => run({ manual: b.dataset.set || null }, b));
  }
  const saveBtn = box.querySelector('[data-save-rt]');
  saveBtn.addEventListener('click', () => run({ responseTime: rt.value }, saveBtn));

  run(null, null).catch(() => {
    big.textContent = 'UNKNOWN';
    why.textContent = 'Could not read your status.';
  });
}
