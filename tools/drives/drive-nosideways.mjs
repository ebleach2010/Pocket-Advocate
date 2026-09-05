// drive-nosideways.mjs - nothing wider than the screen, on any page, on any
// tab, at two phone widths, in both demos.
//
//   PA_PORT=9377 node tools/drives/drive-nosideways.mjs
//
// Eric, 2026-09-05: "The app has side to side scroll, particularly if zoomed
// in. I'd prefer you can't use your fingers to zoom in at all and prevent
// side to side scroll altogether." The zoom is refused three ways (see
// tools/suites/nosideways.mjs); this drive is about the other half, the
// content itself: it opens every page as the client and as Eric at 390px and
// 320px, walks every tab or pane button it can find so hidden panes are
// measured too, and fails on any element whose box sticks out past either
// edge of the screen without a scroll container of its own to live in. That
// is exactly what iOS turns into a sideways drag of the whole page. Exits 1
// on the first offender; prints CLEAN otherwise.
import { chromium } from 'playwright';
const PORT = process.env.PA_PORT || 8795;
const P = `http://127.0.0.1:${PORT}`;
const WIDTHS = [390, 320];
const CLIENT = [
  '/', '/about.html', '/advocate.html', '/services.html', '/faq.html', '/contact.html', '/fit.html',
  '/reviews.html', '/stats.html', '/book.html', '/subscribe.html', '/signin.html', '/return.html',
  '/case.html?demo=1', '/chat.html?demo=1', '/subscription.html?demo=1',
];
const ADMIN = [
  '/admin.html?demo=admin', '/admin-case.html?id=demo-case&demo=admin', '/admin-case.html?id=demo-case-full&demo=admin',
  '/admin-chats.html?demo=admin', '/admin-calendar.html?demo=admin', '/admin-availability.html?demo=admin',
  '/admin-dictionary.html?demo=admin',
];
const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
const findings = [];
let measured = 0;
const measure = (pg) => pg.evaluate(() => {
  const w = document.documentElement.clientWidth;
  const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  const path = (el) => {
    const bits = [];
    let e = el;
    while (e && e !== document.body && bits.length < 4) {
      let s = e.tagName.toLowerCase();
      if (e.id) s += `#${e.id}`;
      else if (e.className && typeof e.className === 'string') s += '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.');
      for (const a of ['data-page', 'data-group', 'data-tab']) if (e.getAttribute?.(a)) s += `[${a}=${e.getAttribute(a)}]`;
      bits.unshift(s);
      e = e.parentElement;
    }
    return bits.join(' > ');
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    // Only what actually protrudes: a wide element inside an overflow
    // container of its own is clipped there and scrolls in place.
    let clipped = false;
    let p = el.parentElement;
    while (p && p !== document.body) {
      const pcs = getComputedStyle(p);
      if (/(hidden|clip|auto|scroll)/.test(pcs.overflowX) || /(hidden|clip|auto|scroll)/.test(pcs.overflow)) { clipped = true; break; }
      p = p.parentElement;
    }
    if (clipped) continue;
    if (r.right > w + 1 || r.left < -1) out.push({ sel: path(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) });
  }
  out.sort((a, c) => (c.right - c.left) - (a.right - a.left));
  return { w, sw, over: sw > w + 1, offenders: out.slice(0, 5) };
});
const settle = async (pg, ms = 900) => {
  await pg.waitForTimeout(ms);
  for (let i = 0; i < 6; i++) {
    const hit = await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /^(Got it|Not now|Skip|Close)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; });
    await pg.waitForTimeout(150); if (!hit) break;
  }
};
for (const [role, list] of [['client', CLIENT], ['admin', ADMIN]]) {
  for (const width of WIDTHS) {
    const ctx = await b.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addCookies([{ name: 'pa_demo', value: role, domain: '127.0.0.1', path: '/' }]);
    const page = await ctx.newPage();
    page.on('dialog', async (dlg) => { await dlg.dismiss(); });
    for (const path of list) {
      try {
        await page.goto(`${P}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
        await settle(page);
        const first = await measure(page);
        measured += 1;
        if (first.over || first.offenders.length) findings.push({ role, width, path, tab: '(load)', ...first });
        const tabs = await page.$$eval('[data-page], [data-group], [data-tab]', (els) => els.map((e) => ({
          sel: e.getAttribute('data-page') ? `[data-page="${e.getAttribute('data-page')}"]`
            : e.getAttribute('data-group') ? `[data-group="${e.getAttribute('data-group')}"]`
              : `[data-tab="${e.getAttribute('data-tab')}"]`,
          label: (e.textContent || '').trim().slice(0, 20),
        })));
        const seen = new Set();
        for (const t of tabs) {
          if (seen.has(t.sel)) continue; seen.add(t.sel);
          const clicked = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, t.sel).catch(() => false);
          if (!clicked) continue;
          await page.waitForTimeout(350);
          const m = await measure(page);
          measured += 1;
          if (m.over || m.offenders.length) findings.push({ role, width, path, tab: `${t.sel} ${t.label}`, ...m });
        }
      } catch (e) {
        findings.push({ role, width, path, tab: 'ERROR', err: String(e).slice(0, 120) });
      }
    }
    await ctx.close();
  }
}
await b.close();
console.log(`measured ${measured} page and tab views at ${WIDTHS.join(' and ')}px, both demos`);
if (!findings.length) { console.log('CLEAN: nothing wider than the screen anywhere.'); process.exit(0); }
for (const x of findings) {
  console.log(`\nFAIL ${x.role} ${x.width}px ${x.path} ${x.tab}${x.err ? ' ' + x.err : ''}${x.over ? `  page scrolls: scrollWidth ${x.sw} > ${x.w}` : ''}`);
  for (const o of x.offenders || []) console.log(`   ${o.left}..${o.right} (${o.width}w)  ${o.sel}`);
}
process.exit(1);
