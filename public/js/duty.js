// The duty-of-care draft.
//
// A quiet button in the folder's tools. It never suggests anything about
// anyone, never appears because of something a model noticed, and never sends
// on its own. Eric decides when he is obligated; this only saves him writing
// the same thing under pressure, at the moment he is least able to.
//
// The opening paragraph is his, verbatim, from 2026-08-20. Do not smooth it
// out. "You're not going to be swatted and put in sticky socks just because
// you're suffering" is the whole reason it works: it is a person who has been
// there talking, not a liability notice.

/**
 * Crisis lines by country. Checked 2026-08. These change rarely, but they do
 * change, and a dead number in this draft is worse than no draft at all, so
 * they are worth a look each time this file is touched.
 */
const RESOURCES = {
  US: {
    label: 'United States',
    lines: [
      ['988 Suicide & Crisis Lifeline', 'call or text 988'],
      ['Crisis Text Line', 'text HOME to 741741'],
      ['Veterans Crisis Line', 'call 988 then press 1, or text 838255'],
      ['Trevor Project (LGBTQ+ young people)', 'call 1-866-488-7386, or text START to 678678'],
      ['SAMHSA National Helpline (treatment referrals, 24/7)', '1-800-662-4357'],
    ],
  },
  CA: {
    label: 'Canada',
    lines: [
      ['9-8-8 Suicide Crisis Helpline', 'call or text 988'],
      ['Talk Suicide Canada', '1-833-456-4566 (in Quebec, 1-866-277-3553)'],
      ['Kids Help Phone', 'call 1-800-668-6868, or text CONNECT to 686868'],
      ['Hope for Wellness Helpline (First Nations, Inuit and Métis)', '1-855-242-3310'],
      ['Trans Lifeline', '1-877-330-6366'],
    ],
  },
};

const OPENING = "Based on what you said, I'm obligated to send you this. But you're not "
  + "going to be swatted and put in sticky socks just because you're suffering. I know the "
  + 'goal is treatment, not an inpatient stay. Regardless, options are available and I ALWAYS '
  + 'suggest therapy during illness. It can be invaluable. It kept me alive when I was sick.';

/** Canada if their timezone says so, otherwise the US. He can switch it. */
export function guessCountry(tz) {
  return /^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Montreal|Moncton|Whitehorse|Yellowknife|Iqaluit|Glace_Bay|Goose_Bay|Blanc-Sablon|Rankin_Inlet|Resolute|Creston|Dawson|Fort_Nelson|Inuvik|Cambridge_Bay|Atikokan|Nipigon|Rainy_River|Thunder_Bay|Swift_Current)$/.test(String(tz || ''))
    ? 'CA' : 'US';
}

export const COUNTRIES = Object.entries(RESOURCES).map(([id, r]) => ({ id, label: r.label }));

/**
 * Open the draft. `opts.tz` picks the starting country, `opts.onSend(text)`
 * sends it as an ordinary message from Eric.
 *
 * It opens editable and it does not send until he presses send. Everything
 * about this moment argues for him reading it once more before it goes.
 */
export function openDutyDraft({ tz = '', onSend } = {}) {
  let country = guessCountry(tz);
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-card duty-card" role="dialog" aria-modal="true" aria-label="Duty of care draft">
      <div class="row"><h3 style="margin:0;">Duty of care</h3><button class="btn quiet" data-close>Cancel</button></div>
      <p class="dim small">Your words. Nothing sends until you send it.</p>
      <div class="duty-where" role="group" aria-label="Where they are">
        ${COUNTRIES.map((x) => `
          <button type="button" class="chip-label" data-country="${x.id}" aria-pressed="false">${x.label}</button>`).join('')}
      </div>
      <textarea class="duty-text" data-duty rows="14"></textarea>
      <div class="actions">
        <button class="btn glow" data-send>Send it</button>
        <button class="btn quiet" data-copy>Copy instead</button>
      </div>
      <p class="error" data-duty-err hidden></p>
    </div>`;

  const box = overlay.querySelector('[data-duty]');
  const errEl = overlay.querySelector('[data-duty-err]');
  // Edits survive a country switch: only the resource block is replaced, so a
  // sentence he added for this particular person is not thrown away by a tap.
  const paint = () => {
    const typed = box.value.split('\n- ')[0];
    box.value = `${typed && typed !== OPENING ? typed : OPENING}\n\n${
      (RESOURCES[country] || RESOURCES.US).lines.map(([n, h]) => `- ${n}: ${h}`).join('\n')}`;
    overlay.querySelectorAll('[data-country]').forEach((b) => {
      const on = b.dataset.country === country;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', String(on));
    });
  };
  box.value = OPENING;
  paint();

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  function onKey(e) { if (e.key === 'Escape') close(); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.querySelectorAll('[data-country]').forEach((b) =>
    b.addEventListener('click', () => { country = b.dataset.country; paint(); }));
  overlay.querySelector('[data-copy]').addEventListener('click', async () => {
    await navigator.clipboard?.writeText(box.value).catch(() => {});
    close();
  });
  overlay.querySelector('[data-send]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const text = box.value.trim();
    if (!text) return;
    btn.disabled = true;
    try {
      await onSend?.(text);
      close();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      btn.disabled = false;
    }
  });

  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}
