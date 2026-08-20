// The video prep sheet.
//
// Everything Eric needs in front of him on the call, on one printable page:
// what to lead with, the questions in order, the differential, and a drawn
// decision chart — if they say this, then that; if the panel came back
// negative, then this. Share > Print > Save to Files gives him a PDF on his
// phone, which is the closest thing to a docx that a browser can hand him
// without shipping a library to build one.
//
// It is assembled from the advisor's own sections rather than a fresh model
// call. The read already exists, it is already what he trusts, and asking for
// it twice would produce a second version to reconcile against the first.

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** One `## Section` out of the assessment. */
function section(analysis, name) {
  const m = String(analysis || '').match(
    new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
  return m ? m[1].trim() : '';
}

/** Bullets as an array, with the leading marker gone. */
function bullets(text) {
  return String(text || '').split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, '').replace(/\[\[|\]\]/g, '').trim())
    .filter(Boolean);
}

/**
 * The decision chart, as real SVG rather than an image.
 *
 * One question, then a branch per answer, then what each branch means. Three
 * or four of these is the useful number: a chart with ten decision points is a
 * document nobody consults mid-conversation, which is the only moment this
 * exists for.
 */
function flowChart(steps) {
  if (!steps.length) return '';
  const W = 660;
  const ROW = 132;
  const H = steps.length * ROW + 30;
  const parts = [];

  steps.forEach((s, i) => {
    const y = i * ROW + 20;
    const cx = W / 2;
    // The question, in a rounded box across the middle.
    parts.push(`
      <rect x="${cx - 190}" y="${y}" width="380" height="46" rx="10"
        fill="#F4F0E6" stroke="#8A7B5C" stroke-width="1.5"/>
      <text x="${cx}" y="${y + 28}" text-anchor="middle" font-size="14" font-weight="600"
        fill="#231F16">${esc(s.q.slice(0, 62))}</text>`);
    // Two answers below it, each with the move it implies.
    const armY = y + 62;
    [['yes', cx - 160, s.yes], ['no', cx + 160, s.no]].forEach(([label, x, then]) => {
      parts.push(`
        <path d="M ${cx} ${y + 46} L ${cx} ${armY - 10} L ${x} ${armY - 10} L ${x} ${armY}"
          fill="none" stroke="#8A7B5C" stroke-width="1.5"/>
        <text x="${(cx + x) / 2}" y="${armY - 16}" text-anchor="middle" font-size="11"
          fill="#6B6151" paint-order="stroke" stroke="#FFFFFF" stroke-width="3.5"
          stroke-linejoin="round">${label}</text>
        <rect x="${x - 150}" y="${armY}" width="300" height="40" rx="8"
          fill="#FFFFFF" stroke="#C9BFA6" stroke-width="1.2"/>
        <text x="${x}" y="${armY + 25}" text-anchor="middle" font-size="12.5"
          fill="#231F16">${esc(String(then || '—').slice(0, 48))}</text>`);
    });
  });

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
    aria-label="Decision chart for the call">${parts.join('')}</svg>`;
}

/**
 * Turn "Worth investigating" bullets into decision steps. Each bullet is
 * written as `thing to chase | what the result settles`, or as one sentence;
 * either way the chart asks whether the thing came back positive.
 */
function stepsFrom(invest, diff) {
  const steps = invest.slice(0, 3).map((b) => {
    const [what, settles] = b.split('|').map((x) => x.trim());
    return {
      q: what.replace(/\.$/, ''),
      yes: settles || 'Chase it with the ordering doctor',
      no: 'Move down the differential',
    };
  });
  if (!steps.length && diff.length) {
    const top = diff[0];
    steps.push({
      q: `Does anything today support ${top.name}?`,
      yes: 'Push for the test that separates it',
      no: 'Ask what else was considered and ruled out',
    });
  }
  return steps;
}

/**
 * Open the prep sheet in a print window.
 * opts: { name, when, analysis, differential, notes }
 */
export function openPrepSheet({ name = '', when = '', analysis = '', differential = [] } = {}) {
  const rightNow = section(analysis, 'Right now');
  const ask = bullets(section(analysis, 'Worth asking')) .concat(bullets(section(analysis, 'Ask next')));
  const invest = bullets(section(analysis, 'Worth investigating')).concat(bullets(section(analysis, 'Worth chasing')));
  const missing = bullets(section(analysis, "What's missing"));
  const known = section(analysis, 'What we know so far');
  const ruled = bullets(section(analysis, 'Ruled out'));

  const win = window.open('', '_blank');
  if (!win) {
    alert('Your browser blocked the print window. Allow pop-ups for this site and try again.');
    return;
  }

  // The model separates "the thing" from "what it settles" with a pipe. That is
  // a field separator, not punctuation anybody reads off a page.
  const clean = (x) => x.replace(/\[\[|\]\]/g, '').split('|').map((t) => t.trim()).filter(Boolean).join(' — ');
  const list = (items) => (items.length
    ? `<ol>${items.map((x) => `<li>${esc(clean(x))}</li>`).join('')}</ol>`
    : '<p class="none">Nothing yet.</p>');

  win.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>Prep — ${esc(name)}</title>
    <style>
      body { font: 14.5px/1.5 -apple-system, system-ui, sans-serif; color: #1A1712;
             margin: 0; padding: 2rem 1.6rem; background: #fff; }
      h1 { font-size: 1.45rem; margin: 0 0 .1rem; }
      .when { color: #6B6151; margin: 0 0 1.4rem; }
      h2 { font-size: 1rem; margin: 1.5rem 0 .35rem; text-transform: uppercase;
           letter-spacing: .07em; color: #6B6151; border-bottom: 1px solid #DDD4C2;
           padding-bottom: .2rem; }
      ol, ul { padding-left: 1.2rem; margin: .3rem 0; }
      li { margin: 0 0 .4rem; }
      .lead { font-size: 1.02rem; }
      .none { color: #8A8272; font-style: italic; }
      .dx { display: flex; align-items: baseline; gap: .5rem; margin: 0 0 .35rem; }
      .dx b { min-width: 3.2rem; }
      .bar { flex: 1; height: 7px; background: #EDE7D8; border-radius: 4px; overflow: hidden; }
      .bar i { display: block; height: 100%; background: #8A7B5C; }
      .chart { margin: .6rem 0 0; }
      /* One page per section boundary where it helps, and never a heading
         stranded at the foot of a page. */
      h2 { break-after: avoid; page-break-after: avoid; }
      @page { margin: 14mm; }
    </style></head><body>
    <h1>${esc(name || 'Call prep')}</h1>
    <p class="when">${esc(when || '')}</p>

    <h2>Lead with</h2>
    ${rightNow ? `<p class="lead">${esc(rightNow.replace(/\[\[|\]\]/g, ''))}</p>` : '<p class="none">No read yet.</p>'}

    <h2>Ask, in this order</h2>
    ${list(ask)}

    <h2>Worth investigating</h2>
    ${list(invest)}

    <h2>Where it stands</h2>
    ${differential.length
      ? differential.map((r) => {
        const pct = Math.max(0, Math.min(100, Math.round(Number(r.pct) || 0)));
        return `<div class="dx"><b>${pct}%</b><span>${esc(r.name || '')}</span>
          <span class="bar"><i style="width:${pct}%"></i></span></div>`;
      }).join('')
      : '<p class="none">No differential yet.</p>'}

    <h2>If they say this, then that</h2>
    <div class="chart">${flowChart(stepsFrom(invest, differential)) || '<p class="none">Not enough to chart yet.</p>'}</div>

    <h2>Still missing</h2>
    ${list(missing)}

    ${ruled.length ? `<h2>Already ruled out</h2>${list(ruled)}` : ''}

    ${known ? `<h2>What we know so far</h2><div>${esc(known)
      .replace(/^### (.+)$/gm, '<h3 style="font-size:.95rem;margin:.7rem 0 .15rem;">$1</h3>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/\n{2,}/g, '</p><p>')}</div>` : ''}

    </body></html>`);
  win.document.close();
  // Give the new document a beat to lay out before the print sheet opens.
  setTimeout(() => win.print(), 400);
}
