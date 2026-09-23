// drive-trade.mjs - PR 420, the trading desk, driven in the demo.
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-trade.mjs
//
// Eric, 2026-09-23: "Simplify the trading app substantially. The app should
// now have only two primary purposes: 1. Suggested Trades 2. Market News."
//
// Twelve sections, A to L: the shelf card opens the desk; the shell is three
// tabs and a cog with no chat anywhere; the board reads every field of a trade
// grouped by kind with the taken one lit yellow; RUN TRADING DESK walks its
// stages and lands fresh trades; YES lights a card and gives it PROFIT and
// LOSS; PROFIT and LOSS each play their moment and land in History; News keeps
// what matters; Settings re-sizes every card from the balance and the risk per
// trade; the research shows only behind its switch; reduced motion keeps the
// moment still; the old address hands off; and every page holds at 320px.
// Nothing here talks to a market or a model: the demo seeds the desk and walks
// a run on its own timer, which is the shape production has.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PA_PORT || '9377';
const SHOTS = process.env.PA_SHOTS || '';
const P = `http://127.0.0.1:${PORT}`;
const DESK = `${P}/admin-desk.html?demo=admin`;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(`PAGEERROR ${String(e).slice(0, 300)}`));
// PR 420 asks him nothing: a dialog of any kind is a failure, not something to click through.
page.on('dialog', async (d) => { errs.push(`DIALOG ${d.type()} ${d.message().slice(0, 120)}`); await d.dismiss(); });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { if (c) { pass += 1; console.log(`  ok    ${n}${d ? ` (${d})` : ''}`); } else { fail += 1; console.log(`  FAIL  ${n}${d ? ` (${d})` : ''}`); } };
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const until = async (fn, ms = 20000, arg = null) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await page.waitForTimeout(250);
  }
};
const go = async (name) => {
  await page.evaluate((n) => document.querySelector(`#bar [data-page="${n}"]`)?.click(), name);
  await page.waitForTimeout(700);
};
/** Every card in a list, read the way he reads one. */
const cards = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((c) => ({
  id: c.dataset.rec, kind: c.dataset.kind, active: c.classList.contains('active'),
  tk: c.querySelector('.tk')?.textContent.trim(),
  cells: Object.fromEntries([...c.querySelectorAll('.cell')].map((x) => [x.querySelector('.k').textContent.trim(), x.querySelector('.v').textContent.trim()])),
  why: [...c.querySelectorAll('.why dt')].map((x) => x.textContent.trim()),
  acts: [...c.querySelectorAll('[data-act]')].map((x) => x.dataset.act),
  border: getComputedStyle(c).borderTopColor,
})), sel);

console.log('\n--- A. the shelf: the green card is PR 420 and opens the desk ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); localStorage.removeItem('pa-demo-store-advocate'); localStorage.removeItem('pa-420-page'); });
await page.reload({ waitUntil: 'networkidle' });
const card = await until(() => {
  const el = document.querySelector('.folder.trade');
  if (!el) return null;
  const a = el.closest('a') || el.querySelector('a') || el;
  return { href: a.getAttribute('href') || '', pill: el.querySelector('.status-pill')?.textContent.trim() || '', meta: el.querySelector('.folder-meta')?.textContent.trim() || '', text: el.textContent };
});
ok('the desk\'s card points at its own page', !!card && /^\/admin-desk\.html\?id=demo-case-trade$/.test(card.href), card?.href);
ok('the card is named and badged PR 420 and says what it is for', !!card && card.pill === 'PR 420' && /PR 420/.test(card.text) && /Suggested trades and market news/.test(card.meta), `${card?.pill} | ${card?.meta}`);
ok('the shelf says when it runs', /runs itself at 7:00 Mountain on trading days; RUN TRADING DESK any time/.test(await page.evaluate(() => document.body.innerText)));
await page.evaluate(() => document.querySelector('.folder.trade')?.closest('a')?.click());
await page.waitForTimeout(2500);
await until(() => !document.getElementById('boot'));
ok('the card walks into the desk, open on Trades', /\/admin-desk(\.html)?/.test(page.url()) && await page.evaluate(() => !document.getElementById('pg-trades').hidden));
await shot('A-open');

console.log('\n--- B. the shell: three tabs and a cog, and nothing to talk to ---');
const shell = await page.evaluate(() => ({
  title: document.title,
  tabs: [...document.querySelectorAll('#bar [data-page]')].map((x) => x.querySelector('.lbl')?.textContent.trim()),
  cog: !!document.getElementById('cog'),
  boxes: document.querySelectorAll('textarea, #composer, #stream, #say').length,
  dark: getComputedStyle(document.body).backgroundColor,
  crumb: document.querySelector('.crumb')?.textContent.trim(),
}));
ok('the page is PR 420 with Trades, News and History and a cog', shell.title === 'PR 420' && shell.tabs.join() === 'Trades,News,History' && shell.cog && /^PR 420/.test(shell.crumb), JSON.stringify(shell));
ok('there is no chat, no composer and no text box anywhere on the page', shell.boxes === 0);
ok('it is always dark', shell.dark === 'rgb(6, 10, 19)', shell.dark);

console.log('\n--- C. the board: every field of a trade, grouped by kind, the taken one lit ---');
const board = await cards('#board .rec');
const active = await cards('#active .rec');
ok('the board groups scalp, intraday and swing in that order', (await page.evaluate(() => [...document.querySelectorAll('#board .kindgroup')].map((g) => g.dataset.kind).join())) === 'scalp,intraday,swing');
ok('the last run\'s four trades are on the board', board.map((c) => c.tk).join() === 'TSLA,NVDA,SOFI,AMD', board.map((c) => c.tk).join());
const nv = board.find((c) => c.tk === 'NVDA');
ok('a trade reads every field he asked for', !!nv && ['Now', 'Entry', 'Amount', 'Hold', 'Stop', 'Targets', 'Risk', 'Reward', 'R:R'].every((k) => nv.cells[k]) && ['Catalyst', 'Out if', 'Desk'].every((k) => nv.why.includes(k)), JSON.stringify(nv?.cells));
ok('the amount is dollars and shares sized from his balance', !!nv && /^\$\d[\d,]* · [\d.]+ shares$/.test(nv.cells.Amount), nv?.cells.Amount);
const put = board.find((c) => c.tk === 'TSLA');
ok('a contract says Stock for the price and counts whole contracts', !!put && !!put.cells.Stock && /1 contract/.test(put.cells.Amount), JSON.stringify(put?.cells));
ok('every trade on the board offers YES and nothing else', board.every((c) => c.acts.join() === 'take'));
ok('the one he took is lit, electric yellow, with PROFIT and LOSS', active.length === 1 && active[0].tk === 'PLTR' && active[0].active && active[0].acts.join() === 'profit,loss' && active[0].border === 'rgb(244, 255, 31)', JSON.stringify(active.map((c) => [c.tk, c.border])));
ok('the tab carries the count of taken trades', (await page.evaluate(() => document.getElementById('bar-badge').textContent)) === '1');
ok('the line under the button says when the last run was', /^Last run .+ · 4 trades$/.test(await page.evaluate(() => document.getElementById('run-line').textContent.trim())));
ok('the sub line shows the balance and the 3% rule', /Balance \$2,380\.00 · risk 3% a trade/.test(await page.evaluate(() => document.getElementById('trades-sub').textContent)));
await shot('C-board');

console.log('\n--- D. RUN TRADING DESK: one tap, no confirmation, the stages, the landing ---');
await page.click('#run');
const started = await until(() => document.getElementById('run').disabled && /Starting|researchers/.test(document.getElementById('run-line').textContent) && document.getElementById('run-line').textContent, 5000);
ok('one tap starts it with no confirmation and the button goes down', !!started, started || '');
const researching = await until(() => /of 5 back/.test(document.getElementById('run-line').textContent) && document.querySelectorAll('#run-line .agents i').length === 5 && document.getElementById('run-line').textContent, 12000);
ok('the line counts the researchers back, with five dots', !!researching, researching || '');
const landed = await until(() => !document.getElementById('run').disabled && /Last run/.test(document.getElementById('run-line').textContent) && document.querySelector('#toasts .toast')?.textContent, 20000);
ok('the run lands on its own and says how many trades', /The desk is in: 3 trades\./.test(landed || ''), landed || '');
const fresh = await cards('#board .rec');
ok('the board is the fresh run\'s trades and nothing from the last one', fresh.map((c) => c.tk).join() === 'AMD,QQQ,MU', fresh.map((c) => c.tk).join());
ok('the desk\'s one line on the tape is shown', /Semis are leading/.test(await page.evaluate(() => document.getElementById('deskread-t').textContent)));
ok('the taken trade stays lit through a run', (await cards('#active .rec')).map((c) => c.tk).join() === 'PLTR');
await shot('D-landed');

console.log('\n--- E. YES: the card goes electric yellow and grows PROFIT and LOSS ---');
await page.evaluate(() => document.querySelector('#board .rec[data-rec$="-1"] [data-act="take"]')?.click());
const lit = await until(() => document.querySelectorAll('#active .rec').length === 2 && [...document.querySelectorAll('#active .rec')].map((c) => c.querySelector('.tk').textContent).join(), 6000);
ok('YES moves QQQ into the active trades, first', lit === 'QQQ,PLTR', lit || '');
const qqq = (await cards('#active .rec'))[0];
ok('it is lit electric yellow with PROFIT and LOSS and no YES', !!qqq && qqq.active && qqq.border === 'rgb(244, 255, 31)' && qqq.acts.join() === 'profit,loss', JSON.stringify(qqq));
ok('it is off the board, and the tab count is two', !(await cards('#board .rec')).some((c) => c.tk === 'QQQ') && (await page.evaluate(() => document.getElementById('bar-badge').textContent)) === '2');
await shot('E-yes');

console.log('\n--- F. PROFIT: the moment plays and the trade lands in History ---');
await page.evaluate(() => document.querySelector('#active .rec [data-act="profit"]')?.click());
const profitPlan = await until(() => window.__paFxLast?.kind === 'profit' && window.__paFxLast.plan, 4000);
ok('PROFIT plays the full moment: flash, shake, coins', !!profitPlan && profitPlan.coins === true && profitPlan.shake === true && profitPlan.numberOnly === false, JSON.stringify(profitPlan));
const gone = await until(() => document.querySelectorAll('#active .rec').length === 1 && document.querySelector('#toasts .toast')?.textContent, 4000);
ok('the card leaves and the toast says where it went', /QQQ is in History, marked PROFIT\./.test(gone || ''), gone || '');

console.log('\n--- G. LOSS: the other moment ---');
await page.evaluate(() => document.querySelector('#active .rec [data-act="loss"]')?.click());
const lossPlan = await until(() => window.__paFxLast?.kind === 'loss' && window.__paFxLast.plan, 4000);
ok('LOSS plays its own moment: the siren and no coins', !!lossPlan && lossPlan.siren === true && lossPlan.coins === false, JSON.stringify(lossPlan));
ok('nothing is active any more and the section hides', !!await until(() => document.getElementById('active-wrap').hidden && document.getElementById('bar-badge').hidden, 4000));
await go('history');
const hist = await until(() => document.querySelectorAll('#hist .hist[data-hist]').length && [...document.querySelectorAll('#hist .hist[data-hist]')].slice(0, 2).map((h) => `${h.querySelector('.what b').textContent} ${h.querySelector('.res').textContent}`).join('|'), 5000);
ok('History leads with the two just marked, newest first', hist === 'PLTR LOSS|QQQ PROFIT', hist || '');
await page.evaluate(() => document.querySelector('#hist .hist[data-hist] summary')?.click());
await page.waitForTimeout(300);
ok('a history row folds out the setup and both times', /Taken .+ Closed /.test(await page.evaluate(() => document.querySelector('#hist .hist[data-hist] .more')?.textContent || '')));
await shot('G-history');

console.log('\n--- H. News: what could move a trade, and nothing else ---');
await go('news');
const news = await until(() => document.querySelectorAll('#news-list li').length && {
  desk: document.querySelectorAll('#news-desk .dnews').length,
  earn: [...document.querySelectorAll('#news-earn .chip')].map((c) => c.textContent.trim()),
  heads: [...document.querySelectorAll('#news-list li .t')].map((t) => t.textContent.trim()),
}, 6000);
ok('the desk\'s own picks lead the page', !!news && news.desk === 2, JSON.stringify(news?.desk));
ok('a story on a ticker that is not on the board is left out', !!news && news.heads.length > 0 && !news.heads.some((h) => /Tesla|Nvidia/.test(h)), JSON.stringify(news?.heads));
ok('headlines naming a ticker on the board come first', !!news && /AMD|Micron/.test(news.heads[0] || ''), news?.heads[0]);
ok('the market wide ones stay', !!news && news.heads.some((h) => /Fed minutes/.test(h)));
await page.evaluate(() => document.querySelector('#news-list li.has')?.click());
ok('a headline folds out its summary', !!await until(() => document.querySelector('#news-list li.open .sum'), 2000));
await shot('H-news');

console.log('\n--- I. Settings: the balance and the risk per trade size every card ---');
await go('trades');
const before = (await cards('#board .rec')).find((c) => c.tk === 'MU');
await page.click('#cog');
await page.waitForTimeout(400);
const sheet = await page.evaluate(() => ({
  heads: [...document.querySelectorAll('.settings h2')].map((h) => h.textContent.trim()),
  risk: document.getElementById('risk-in')?.value,
  key: document.getElementById('key-sub')?.textContent.trim(),
  research: document.getElementById('research-go')?.hidden,
}));
ok('the sheet leads with the balance, then risk, market data and alerts', sheet.heads.join() === 'Balance,Risk,Market data,Alerts', sheet.heads.join());
ok('the risk per trade is 3%', sheet.risk === '3', sheet.risk);
ok('the key shows by its last four only', /^on file · ends 1234$/.test(sheet.key), sheet.key);
ok('the research button is hidden until the debug switch is on', sheet.research === true);
await page.fill('#bal-in', '5000');
await page.click('#bal-go');
ok('a new balance saves and says so', !!await until(() => /Saved\./.test(document.getElementById('bal-said').textContent), 4000));
await page.fill('#risk-in', '1');
await page.dispatchEvent('#risk-in', 'change');
ok('a new risk per trade saves', !!await until(() => /Saved\./.test(document.getElementById('risk-said').textContent), 4000));
await page.click('[data-sw="debugResearch"]');
ok('the debug switch shows the research button', !!await until(() => document.getElementById('research-go') && !document.getElementById('research-go').hidden, 4000));
await page.click('#research-go');
const reports = await until(() => document.querySelectorAll('#rs-list .panel').length, 4000);
ok('the research sheet shows the five reports', reports === 5, String(reports));
await shot('I-settings');
await page.evaluate(() => document.querySelectorAll('#overlay .sheet [data-x]').forEach((x) => x.click()));
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.settings [data-x]')?.click());
await page.waitForTimeout(400);
const after = (await cards('#board .rec')).find((c) => c.tk === 'MU');
ok('every card re-sized from the new balance and rule', !!before && !!after && after.cells.Amount !== before.cells.Amount && after.cells.Risk !== before.cells.Risk, `${before?.cells.Amount} / ${before?.cells.Risk} -> ${after?.cells.Amount} / ${after?.cells.Risk}`);
ok('the sub line says the new balance and 1%', /Balance \$5,000\.00 · risk 1% a trade/.test(await page.evaluate(() => document.getElementById('trades-sub').textContent)));

console.log('\n--- M. his size: tap Amount or Risk, open or taken, and the stop and targets follow ---');
// Eric, 2026-09-23: "I should be able to manually tap on the amount traded and update it, the amount
// I'm willing to risk, then it adjusts the stop loss and take profit", "Including after the trade was accepted".
const cardOf = async (tk, sel = '#board .rec, #active .rec') => (await cards(sel)).find((c) => c.tk === tk);
const note = (tk) => page.evaluate((t) => [...document.querySelectorAll('.rec')].find((c) => c.querySelector('.tk')?.textContent.trim() === t)?.querySelector('.mine-note')?.textContent.trim() || '', tk);
const tapCell = (tk, edit) => page.evaluate(([t, e]) => [...document.querySelectorAll('.rec')].find((c) => c.querySelector('.tk')?.textContent.trim() === t)?.querySelector(`[data-edit="${e}"]`)?.click(), [tk, edit]);
const muDesk = await cardOf('MU');
ok('Amount and Risk are buttons on every card on the board', await page.evaluate(() => [...document.querySelectorAll('#board .rec')].every((c) => c.querySelector('button[data-edit="amount"]') && c.querySelector('button[data-edit="risk"]'))));
await tapCell('MU', 'amount');
const opened = await until(() => document.getElementById('sz-amt') && { amt: document.getElementById('sz-amt').value, risk: document.getElementById('sz-risk').value, focus: document.activeElement?.id, prev: document.getElementById('sz-prev').textContent }, 3000);
ok('a tap on Amount opens his size on the card\'s own numbers, the amount ready to type', !!opened && Number(opened.amt) > 0 && Number(opened.risk) > 0 && opened.focus === 'sz-amt' && /Stop/.test(opened.prev), JSON.stringify(opened));
await page.fill('#sz-amt', '1000');
await page.fill('#sz-risk', '5000');
const refused = await page.evaluate(() => ({ why: document.querySelector('#sz-prev .why')?.textContent || '', off: document.getElementById('sz-go').disabled }));
ok('a risk bigger than the trade is refused in words, and Save waits', /less than the/.test(refused.why) && refused.off, JSON.stringify(refused));
await page.fill('#sz-risk', '50');
const preview = await page.evaluate(() => ({ rows: [...document.querySelectorAll('#sz-prev .row')].map((r) => [r.querySelector('.k').textContent, r.querySelector('.v').textContent]), off: document.getElementById('sz-go').disabled }));
const pv = Object.fromEntries(preview.rows);
ok('as he types, the stop and targets they give are shown', !preview.off && /^\$[\d,.]+$/.test(pv.Stop || '') && /then|^\$/.test(pv.Targets || '') && pv.Stop !== muDesk?.cells.Stop, JSON.stringify(pv));
await shot('M-sheet');
await page.click('#sz-go');
const saved = await until(() => !document.getElementById('sz-go') && document.querySelector('#toasts .toast')?.textContent, 4000);
const mu = await cardOf('MU');
ok('Save lands on the card: his amount, his risk, the stop and targets he saw', /^Saved\. MU stop \$/.test(saved || '') && !!mu && /^\$1,000 · [\d.]+ shares$/.test(mu.cells.Amount) && /^\$(49\.9\d|50\.00)$/.test(mu.cells.Risk) && mu.cells.Stop === pv.Stop && mu.cells.Targets === pv.Targets, JSON.stringify({ saved, cells: mu?.cells }));
await page.evaluate(() => [...document.querySelectorAll('.rec')].find((c) => c.querySelector('.tk')?.textContent.trim() === 'MU')?.scrollIntoView({ block: 'center' }));
await shot('M-card');
const muNote = await note('MU');
ok('the card says it is his size and what the desk had', muNote.startsWith(`Your size. The desk had the stop at ${muDesk?.cells.Stop}, targets ${muDesk?.cells.Targets}.`), muNote);
await page.evaluate(() => [...document.querySelectorAll('#board .rec')].find((c) => c.querySelector('.tk')?.textContent.trim() === 'MU')?.querySelector('[data-act="take"]')?.click());
const muLit = await until(() => [...document.querySelectorAll('#active .rec')].some((c) => c.querySelector('.tk').textContent.trim() === 'MU'), 4000);
const muTaken = await cardOf('MU', '#active .rec');
ok('after YES the lit card keeps his size and still lets him change it', !!muLit && !!muTaken && muTaken.active && muTaken.cells.Stop === pv.Stop && await page.evaluate(() => !![...document.querySelectorAll('#active .rec')].find((c) => c.querySelector('.tk').textContent.trim() === 'MU')?.querySelector('button[data-edit="risk"]')), JSON.stringify(muTaken?.cells));
await tapCell('MU', 'risk');
const reopened = await until(() => document.getElementById('sz-risk') && { risk: document.getElementById('sz-risk').value, focus: document.activeElement?.id, reset: !!document.getElementById('sz-reset') }, 3000);
ok('a tap on Risk opens it on his saved numbers, the risk ready to type, with the way back to the desk\'s plan', !!reopened && reopened.risk === '50' && reopened.focus === 'sz-risk' && reopened.reset, JSON.stringify(reopened));
await page.fill('#sz-risk', '80');
await page.click('#sz-go');
await until(() => !document.getElementById('sz-go'), 4000);
const wider = await cardOf('MU', '#active .rec');
ok('more risk on a taken trade moves its stop further away and its targets with it', !!wider && Number(wider.cells.Stop.replace(/[$,]/g, '')) < Number(pv.Stop.replace(/[$,]/g, '')) && wider.cells.Targets !== pv.Targets && /^\$(79\.9\d|80\.00)$/.test(wider.cells.Risk), JSON.stringify(wider?.cells));
await tapCell('MU', 'amount');
await until(() => document.getElementById('sz-reset'), 3000);
await page.click('#sz-reset');
await until(() => !document.getElementById('sz-reset'), 4000);
const back = await cardOf('MU', '#active .rec');
ok('back to the desk\'s plan puts the desk\'s stop and targets back', !!back && back.cells.Stop === muDesk?.cells.Stop && back.cells.Targets === muDesk?.cells.Targets && !(await note('MU')), JSON.stringify(back?.cells));
await tapCell('MU', 'amount');
await until(() => document.getElementById('sz-amt'), 3000);
await page.fill('#sz-amt', '1000');
await page.fill('#sz-risk', '50');
await page.click('#sz-go');
await until(() => !document.getElementById('sz-go'), 4000);
await page.evaluate(() => [...document.querySelectorAll('#active .rec')].find((c) => c.querySelector('.tk').textContent.trim() === 'MU')?.querySelector('[data-act="profit"]')?.click());
await until(() => ![...document.querySelectorAll('#active .rec')].some((c) => c.querySelector('.tk').textContent.trim() === 'MU'), 5000);
await go('history');
const row = await until(() => { const h = [...document.querySelectorAll('#hist .hist[data-hist]')].find((x) => x.querySelector('.what b')?.textContent === 'MU'); if (!h) return null; h.querySelector('summary').click(); return h.querySelector('.more').textContent.replace(/\s+/g, ' '); }, 5000);
ok('History keeps the desk\'s plan and what he actually traded', (row || '').includes(`Desk Entry $118.20 to $119.00, stop ${muDesk?.cells.Stop}`) && /You put in \$(1,000\.00|999\.\d\d), risked \$50\.00/.test(row || '') && (row || '').includes(`stop ${pv.Stop}, targets ${pv.Targets}`), row || '');
await go('trades');

console.log('\n--- J. reduced motion keeps the moment still ---');
const still = await ctx.newPage();
still.on('pageerror', (e) => errs.push(`PAGEERROR ${String(e).slice(0, 300)}`));
await still.emulateMedia({ reducedMotion: 'reduce' });
await still.goto(DESK, { waitUntil: 'networkidle' });
await still.waitForTimeout(1500);
await still.evaluate(() => document.querySelector('#board .rec [data-act="take"]')?.click());
await still.waitForTimeout(900);
await still.evaluate(() => document.querySelector('#active .rec [data-act="profit"]')?.click());
await still.waitForTimeout(600);
const stillPlan = await still.evaluate(() => window.__paFxLast?.plan);
ok('under reduced motion PROFIT changes colour and nothing moves', !!stillPlan && stillPlan.numberOnly === true && stillPlan.shake === false && stillPlan.coins === false, JSON.stringify(stillPlan));
await still.close();

console.log('\n--- K. the old address hands off ---');
await page.goto(`${P}/admin-case.html?id=demo-case-trade&demo=admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
ok('the folder walks the desk straight into its own page', /\/admin-desk(\.html)?\?id=demo-case-trade/.test(page.url()), page.url());

console.log('\n--- L. every page at 320px ---');
// A fresh demo board: the sections above took or closed every card, and the size sheet needs one to open on.
await page.evaluate(() => localStorage.removeItem('pa-demo-store'));
const small = await ctx.newPage();
await small.setViewportSize({ width: 320, height: 640 });
await small.goto(DESK, { waitUntil: 'networkidle' });
await small.waitForTimeout(2000);
const widths = {};
for (const p of ['trades', 'news', 'history']) {
  await small.evaluate((n) => document.querySelector(`#bar [data-page="${n}"]`)?.click(), p);
  await small.waitForTimeout(900);
  widths[p] = await small.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}
await small.evaluate(() => document.getElementById('cog').click());
await small.waitForTimeout(400);
widths.settings = await small.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.querySelector('.settings').scrollWidth > window.innerWidth + 1);
const cut = await small.evaluate(() => [...document.querySelectorAll('#bar .lbl')].some((l) => l.scrollWidth > l.clientWidth + 1));
await small.evaluate(() => document.querySelector('.settings [data-x]')?.click());
await small.waitForTimeout(300);
await small.evaluate(() => document.querySelector('.rec [data-edit="amount"]')?.click());
await small.waitForTimeout(400);
const sizeAt320 = await small.evaluate(() => ({ open: !!document.getElementById('sz-amt'), doc: document.documentElement.scrollWidth, sheet: document.querySelector('.sheet')?.scrollWidth ?? null, recs: document.querySelectorAll('.rec [data-edit]').length }));
widths.size = !sizeAt320.open || sizeAt320.doc > 321 || sizeAt320.sheet > 321;
if (widths.size) console.log(`  (size sheet at 320px: ${JSON.stringify(sizeAt320)})`);
ok('no page and not the sheet scrolls sideways at 320px, and no tab label is cut', Object.values(widths).every((w) => !w) && !cut, JSON.stringify({ widths, cut }));
if (SHOTS) await small.screenshot({ path: `${SHOTS}/L-320.png` });
await small.close();

console.log(`\n${pass} ok, ${fail} failed`);
if (errs.length) { console.log('\nPage errors:'); for (const e of errs.slice(0, 12)) console.log(`  ${e}`); }
await b.close();
process.exit(fail || errs.length ? 1 : 0);
