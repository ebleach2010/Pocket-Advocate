// What step 1 looks like when the calendar has nothing in it, or cannot be
// read at all. Both paths take every control below the calendar away
// (stripUnwiredStep1), and both are easy to break with a restyle: the sticky
// action bar keeps a Back link and loses Continue, and the panel that carried
// the intro must not collapse into an empty box.
//
// It reproduces the DOM those two paths produce rather than forcing the demo
// store to fail, which is enough to see whether the layout survives.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PA_PORT || 8812;
const P = `http://127.0.0.1:${PORT}`;
const OUT = process.env.PA_OUT || '/tmp/book-empty';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(`${P}/book.html?demo=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2600);

for (const [name, body, keepIntro] of [
  ['closed', `<p class="muted">I have closed my books for now: I am carrying as many
       cases as I can do properly, and taking another would mean doing all of
       them worse. I open again <strong>Sunday, September 6</strong>, and the
       times will appear here.</p>
     <p class="muted small">If you are already a client, nothing about your case
       changes. Message me in your chat as usual.</p>`, false],
  ['unreadable', `<p class="error">Couldn't load the calendar: permission denied</p>
     <p class="muted small">Reload the page and it usually comes back. If it does
       not, the About page has another way to reach me.</p>`, true],
]) {
  await page.evaluate(([html, keep]) => {
    const el = document.getElementById('step');
    el.querySelector('#days').innerHTML = html;
    el.querySelector('#request-box')?.remove();
    el.querySelector('#after-times')?.remove();
    el.querySelector('#continue')?.remove();
    el.querySelector('#ready-note')?.remove();
    if (!keep) el.querySelector('#time-intro')?.remove();
    document.querySelectorAll('.demo-bar, .pa-demo-bar').forEach((e) => e.remove());
    document.querySelector('[data-suite-go]')?.closest('#step + div')?.remove();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [body, keepIntro]);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(`  ${name.padEnd(12)} doc ${h}px`);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
}
await b.close();
