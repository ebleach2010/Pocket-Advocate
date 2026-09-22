// A text PDF, written by hand. Letter pages, Helvetica, a title line, bold
// headings on lines starting "# ", bullets on lines starting "- ", a footer
// with the page count, as many pages as it takes. No library: the Worker has
// no filesystem and the shape of a text PDF is small enough to write out, and
// the demo builds the same file in the browser from this same code. Pure:
// lines in, bytes out, nothing read from anywhere. No secrets, so a public
// path is fine; nothing here is worth gating.
//
// One invariant carries the whole file: every character of the output is one
// byte (WinAnsi), so string offsets are byte offsets and the cross-reference
// table is right by construction. toWin() is the only door for text, and it
// drops what it cannot spell rather than letting a wide character through.

// WinAnsi's bytes 0x80 to 0x9F, as [code point, byte]. The two dashes are
// absent on purpose: they become a plain hyphen below, because nothing a
// person reads here carries one.
const WIN = new Map([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
  [0x02C6, 0x88], [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C], [0x017D, 0x8E],
  [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93], [0x201D, 0x94], [0x2022, 0x95],
  [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B], [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F],
]);
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`, 'g');

/** Text as WinAnsi, one character per byte: Latin-1 kept, the table above mapped, a dash a hyphen, anything else dropped. */
export function toWin(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s).replace(DASHES, '-').replace(/\t/g, '    ')) {
    const cp = ch.codePointAt(0);
    if (cp === 0x0A || (cp >= 0x20 && cp <= 0x7E) || (cp >= 0xA0 && cp <= 0xFF)) out += ch;
    else if (WIN.has(cp)) out += String.fromCharCode(WIN.get(cp));
  }
  return out.replace(/ {2,}/g, ' ');
}

// Helvetica's advance widths per 1000 em for the printable ASCII run, 0x20
// to 0x7E, from the standard metrics; anything else is taken as 556, the
// width of a lowercase letter, and the bold face runs six percent wider.
const HELV = '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584'
  .split(' ').map(Number);
/** The width of a line at a size, in points. */
export function textWidth(s, size, bold = false) {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    w += c >= 0x20 && c <= 0x7E ? HELV[c - 0x20] : 556;
  }
  return (w * size / 1000) * (bold ? 1.06 : 1);
}

/** Greedy word wrap to a width in points; a word wider than the line is broken by character. */
export function wrapLine(text, size, bold, maxWidth) {
  const out = [];
  let line = '';
  const push = () => { if (line) out.push(line); line = ''; };
  for (const word of text.split(' ')) {
    if (!word) continue;
    const cand = line ? `${line} ${word}` : word;
    if (textWidth(cand, size, bold) <= maxWidth) { line = cand; continue; }
    push();
    if (textWidth(word, size, bold) <= maxWidth) { line = word; continue; }
    let piece = '';
    for (const ch of word) {
      if (textWidth(piece + ch, size, bold) > maxWidth) { out.push(piece); piece = ch; } else piece += ch;
    }
    line = piece;
  }
  push();
  return out.length ? out : [''];
}

const W = 612;
const H = 792;
const MARGIN = 54;
const BODY = 10.5;
const LEAD = 14;
const TITLE = 16;
const TITLE_LEAD = 20;
const FOOT = 8;
const FOOT_Y = 30;
const BULLET_IN = 12;

/**
 * The document. `lines` are the body, one string per line: "# " opens a bold
 * heading, "- " or "* " a bullet, a blank line is a blank line, anything else
 * a paragraph line wrapped to the page. `title` sits at the top in a larger
 * bold, `footer` on every page's foot beside the page count. Returns bytes.
 */
export function textPdf(lines, { title = '', footer = '' } = {}) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const usable = W - 2 * MARGIN;
  // Every line the pages will carry, in order: text, font, size, lead, x.
  const items = [];
  const t = toWin(title).trim();
  if (t) {
    for (const l of wrapLine(t, TITLE, true, usable)) items.push({ t: l, bold: true, size: TITLE, lead: TITLE_LEAD, x: MARGIN });
    items.push({ t: '', bold: false, size: BODY, lead: LEAD, x: MARGIN });
  }
  for (const raw of Array.isArray(lines) ? lines : String(lines || '').split('\n')) {
    const line = toWin(raw).trimEnd();
    if (!line.trim()) { items.push({ t: '', bold: false, size: BODY, lead: LEAD, x: MARGIN }); continue; }
    const head = line.match(/^#{1,3}\s+(.*)$/);
    if (head) {
      const prev = items[items.length - 1];
      if (prev && prev.t) items.push({ t: '', bold: false, size: BODY, lead: 6, x: MARGIN });
      for (const l of wrapLine(head[1].trim(), BODY, true, usable)) items.push({ t: l, bold: true, size: BODY, lead: LEAD, x: MARGIN });
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      const wrapped = wrapLine(bullet[1].trim(), BODY, false, usable - BULLET_IN);
      wrapped.forEach((l, i) => items.push({ t: l, bold: false, size: BODY, lead: LEAD, x: MARGIN + BULLET_IN, glyph: i === 0 }));
      continue;
    }
    for (const l of wrapLine(line.trim(), BODY, false, usable)) items.push({ t: l, bold: false, size: BODY, lead: LEAD, x: MARGIN });
  }
  if (!items.length) items.push({ t: '', bold: false, size: BODY, lead: LEAD, x: MARGIN });

  // Pages: walk the items down each page until the next line would sit in
  // the footer's band, then start another.
  const floor = MARGIN + FOOT_Y;
  const pages = [];
  let page = [];
  let y = H - MARGIN;
  for (const it of items) {
    if (y - it.lead < floor && page.length) { pages.push(page); page = []; y = H - MARGIN; }
    y -= it.lead;
    page.push({ ...it, y });
  }
  pages.push(page);

  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add('');
  const pagesObj = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const foot = toWin(footer).trim();
  const pageIds = [];
  pages.forEach((pg, n) => {
    const parts = ['BT'];
    for (const l of pg) {
      if (l.glyph) parts.push(`/F1 ${BODY} Tf 1 0 0 1 ${MARGIN} ${l.y.toFixed(1)} Tm (${String.fromCharCode(0x95)}) Tj`);
      if (l.t) parts.push(`${l.bold ? '/F2' : '/F1'} ${l.size} Tf 1 0 0 1 ${l.x} ${l.y.toFixed(1)} Tm (${esc(l.t)}) Tj`);
    }
    const count = `Page ${n + 1} of ${pages.length}`;
    parts.push('0.45 g');
    if (foot) parts.push(`/F1 ${FOOT} Tf 1 0 0 1 ${MARGIN} ${FOOT_Y} Tm (${esc(foot)}) Tj`);
    parts.push(`/F1 ${FOOT} Tf 1 0 0 1 ${(W - MARGIN - textWidth(count, FOOT)).toFixed(1)} ${FOOT_Y} Tm (${esc(count)}) Tj`);
    parts.push('0 g', 'ET');
    const stream = parts.join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let out = `%PDF-1.4\n%${String.fromCharCode(0xE2, 0xE3, 0xCF, 0xD3)}\n`;
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character above is one byte, so string offsets are byte offsets.
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}
