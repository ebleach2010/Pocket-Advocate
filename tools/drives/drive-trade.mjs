// drive-trade.mjs - PR 420, the trading desk, driven in the demo.
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-trade.mjs
//
// Eric, 2026-09-23: "Simplify the trading app substantially. The app should
// now have only two primary purposes: 1. Suggested Trades 2. Market News."
//
// Twelve sections, A to L (M, N and O came after: his size, accept or pass, and ADD/TRIM): the shelf card opens the desk; the shell is three
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
// RE-PINNED 2026-09-24 (v7.10): how many agree moved from the Desk row to just under the chance (section P reads it there).
ok('a trade reads every field he asked for', !!nv && ['Now', 'Entry', 'Amount', 'Hold', 'Stop', 'Targets', 'Risk', 'Reward', 'R:R'].every((k) => nv.cells[k]) && ['Catalyst', 'Out if'].every((k) => nv.why.includes(k)) && await page.evaluate(() => /^\d of 5 agree$/.test(document.querySelector('#board .rec .odds .agree')?.textContent.trim() || '')), JSON.stringify(nv?.cells));
ok('the amount is dollars and shares sized from his balance', !!nv && /^\$\d[\d,]* · [\d.]+ shares$/.test(nv.cells.Amount), nv?.cells.Amount);
const put = board.find((c) => c.tk === 'TSLA');
ok('a contract says Stock for the price and counts whole contracts', !!put && !!put.cells.Stock && /1 contract/.test(put.cells.Amount), JSON.stringify(put?.cells));
// RE-PINNED 2026-09-24 (v7.6, Eric: "I should be able to accept/deny"): YES and NO on every new suggestion.
ok('every trade on the board offers YES and NO and nothing else', board.every((c) => c.acts.join() === 'take,decline'));
// RE-PINNED 2026-09-24 (v7.8): ADD/TRIM sits between PROFIT and LOSS.
ok('the one he took is lit, electric yellow, with PROFIT, ADD/TRIM and LOSS', active.length === 1 && active[0].tk === 'PLTR' && active[0].active && active[0].acts.join() === 'profit,scale,loss' && active[0].border === 'rgb(244, 255, 31)', JSON.stringify(active.map((c) => [c.tk, c.border])));
ok('the tab carries the count of taken trades', (await page.evaluate(() => document.getElementById('bar-badge').textContent)) === '1');
ok('the line under the button says when the last run was', /^Last run .+ · 4 trades$/.test(await page.evaluate(() => document.getElementById('run-line').textContent.trim())));
ok('the sub line shows the balance and the 3% rule', /Balance \$2,380\.00 · risk 3% a trade/.test(await page.evaluate(() => document.getElementById('trades-sub').textContent)));
await shot('C-board');

console.log('\n--- D. RUN TRADING DESK: one tap, no confirmation, the stages, the landing ---');
// The run's bar (2026-09-24), sampled five times a second from the tap to after the landing.
await page.evaluate(() => { window.__bar = []; window.__barTick = setInterval(() => { const b = document.getElementById('runbar'); window.__bar.push(b.hidden ? null : parseFloat(b.querySelector('i').style.width)); }, 200); });
await page.click('#run');
const started = await until(() => document.getElementById('run').disabled && /Starting|researchers/.test(document.getElementById('run-line').textContent) && document.getElementById('run-line').textContent, 5000);
ok('one tap starts it with no confirmation and the button goes down', !!started, started || '');
const researching = await until(() => /of 5 back/.test(document.getElementById('run-line').textContent) && document.querySelectorAll('#run-line .agents i').length === 5 && document.getElementById('run-line').textContent, 12000);
ok('the line counts the researchers back, with five dots', !!researching, researching || '');
const landed = await until(() => !document.getElementById('run').disabled && /Last run/.test(document.getElementById('run-line').textContent) && document.querySelector('#toasts .toast')?.textContent, 20000);
ok('the run lands on its own and says how many trades', /The desk is in: 3 trades\./.test(landed || ''), landed || '');
await page.waitForTimeout(2200);
const bar = await page.evaluate(() => { clearInterval(window.__barTick); return { seen: window.__bar.filter((v) => v != null), hiddenNow: document.getElementById('runbar').hidden }; });
const shown = bar.seen;
const beforeFull = shown.slice(0, Math.max(0, shown.indexOf(100)));
ok('the bar shows while the run goes, only ever moves forward, stays under 100 until the trades land, reads 100 when they do, and then goes', shown.length > 5 && shown.every((v, i) => i === 0 || v >= shown[i - 1]) && beforeFull.length > 3 && beforeFull.every((v) => v < 100) && beforeFull.some((v) => v >= 8 && v < 72) && shown.includes(100) && bar.hiddenNow, JSON.stringify({ n: shown.length, first: shown.slice(0, 4), last: shown.slice(-4), hidden: bar.hiddenNow }));
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
// RE-PINNED 2026-09-24 (v7.8): ADD/TRIM sits between PROFIT and LOSS.
ok('it is lit electric yellow with PROFIT, ADD/TRIM and LOSS and no YES', !!qqq && qqq.active && qqq.border === 'rgb(244, 255, 31)' && qqq.acts.join() === 'profit,scale,loss', JSON.stringify(qqq));
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
// RE-PINNED 2026-09-24 (v7.9, Eric: "I want GLp-1 pipeline stocks added to the search"): the GLP-1 chain sits before alerts.
ok('the sheet leads with the balance, then risk, market data, the GLP-1 chain and alerts', sheet.heads.join() === 'Balance,Risk,Market data,GLP-1 chain,Alerts', sheet.heads.join());
const chain = await page.evaluate(() => { const r = document.getElementById('chain'); const subs = [...r.querySelectorAll('.sub')].slice(1); return subs.map((x) => [x.textContent.trim(), [...x.nextElementSibling.querySelectorAll('.chip')].map((c) => c.textContent.trim()).join(' ')]); });
ok('the GLP-1 chain runs from the makers to the sellers, HIMS among the sellers', chain.map((g) => g[0]).join('|') === 'Makers, selling now|In development|Production and supply|Distribution|Sellers' && /^HIMS /.test(chain[4]?.[1] || '') && chain.every((g) => g[1].length > 0), JSON.stringify(chain));
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

console.log('\n--- N. accept or pass: NO holds a position back, YES makes the next one an add ---');
// Eric, 2026-09-24: "I should be able to accept/deny. If denied, it doesn't suggest that position to me
// again unless an additional agent agrees", and "The desk should only suggest new positions or increasing
// equity in a position."
const boardTks = async () => (await cards('#board .rec')).map((c) => c.tk).sort().join();
const runAgain = async () => {
  await page.click('#run');
  return until(() => !document.getElementById('run').disabled && /Last run/.test(document.getElementById('run-line').textContent) && document.querySelector('#toasts .toast')?.textContent, 20000);
};
const onBoard = await boardTks();
ok('the board holds AMD before he passes on it', /AMD/.test(onBoard), onBoard);
await page.evaluate(() => [...document.querySelectorAll('#board .rec')].find((c) => c.querySelector('.tk')?.textContent.trim() === 'AMD')?.querySelector('[data-act="decline"]')?.click());
const passed = await until(() => ![...document.querySelectorAll('#board .rec')].some((c) => c.querySelector('.tk')?.textContent.trim() === 'AMD') && document.querySelector('#toasts .toast')?.textContent, 4000);
ok('NO takes it off the board and says when it can come back', /^Passed on AMD\. It comes back only if more than 3 of 5 agree\.$/.test(passed || ''), passed || '');
await runAgain();
const afterPass = await boardTks();
ok('the next run leaves the AMD scalp off the board, and the others come', afterPass === 'MU,QQQ', afterPass);
await page.evaluate(() => [...document.querySelectorAll('#board .rec')].find((c) => c.querySelector('.tk')?.textContent.trim() === 'QQQ')?.querySelector('[data-act="take"]')?.click());
await until(() => [...document.querySelectorAll('#active .rec')].some((c) => c.querySelector('.tk').textContent.trim() === 'QQQ'), 4000);
await runAgain();
const addCard = await page.evaluate(() => { const c = [...document.querySelectorAll('#board .rec')].find((x) => x.querySelector('.tk')?.textContent.trim() === 'QQQ'); return c ? { chip: c.querySelector('.addtag')?.textContent.trim() || '', note: c.querySelector('.deal-note.add')?.textContent.trim() || '' } : null; });
// RE-PINNED 2026-09-24 (v7.7): the add says how many agreed when he took it and how many agree now.
ok('with QQQ taken, the next run offers QQQ only as an add to it, and says how many agreed then and now', !!addCard && addCard.chip === 'Add' && /^You already hold QQQ\. 4 of 5 agreed when you took it; 4 of 5 agree now\. Taking this adds to your position\.$/.test(addCard.note), JSON.stringify(addCard));
// RE-PINNED 2026-09-24 (v7.10): read under the chance, where the count now sits.
ok('every card on the board shows how many of the desk agree', await page.evaluate(() => [...document.querySelectorAll('#board .rec')].every((c) => /^\d of 5 agree$/.test(c.querySelector('.odds .agree')?.textContent.trim() || ''))));
ok('and the AMD scalp he passed on is still off', !(await boardTks()).includes('AMD'), await boardTks());
await shot('N-add');

console.log('\n--- O. ADD/TRIM: more or less of a taken trade, with a new suggested stop ---');
// Eric, 2026-09-24: "Button between profit and loss that says add/trim and this opens the card to
// add/subtract a new contract or stock amount (in dollars) manually. It gives me a new suggested stop loss."
const qqqCard = () => page.evaluate(() => [...document.querySelectorAll('#active .rec')].find((c) => c.querySelector('.tk')?.textContent.trim() === 'QQQ') || null);
const openScaleOn = async () => {
  await page.evaluate(() => [...document.querySelectorAll('#active .rec')].find((c) => c.querySelector('.tk')?.textContent.trim() === 'QQQ')?.querySelector('[data-act="scale"]')?.click());
  return until(() => document.getElementById('sc-n') && { px: document.getElementById('sc-px').value, risk: document.getElementById('sc-risk').value, focus: document.activeElement?.id, on: document.querySelector('#sc-seg .on')?.dataset.k, sum: document.querySelector('.sheet .sum')?.textContent.trim() }, 3000);
};
const scalePrev = () => page.evaluate(() => ({
  rows: Object.fromEntries([...document.querySelectorAll('#sc-prev .row')].map((r) => [r.querySelector('.k').textContent.trim(), r.querySelector('.v').textContent.trim()])),
  why: [...document.querySelectorAll('#sc-prev .why')].map((x) => x.textContent.trim()).join(' '),
  off: document.getElementById('sc-go').disabled, go: document.getElementById('sc-go').textContent.trim(),
}));
const q0 = await cardOf('QQQ', '#active .rec');
ok('a taken trade has PROFIT, then ADD/TRIM, then LOSS', !!q0 && q0.acts.join() === 'profit,scale,loss', JSON.stringify(q0?.acts));
ok('a new suggestion has no ADD/TRIM', await page.evaluate(() => ![...document.querySelectorAll('#board .rec')].some((c) => c.querySelector('[data-act="scale"]'))));
const sc = await openScaleOn();
ok('ADD/TRIM opens on Add, with the price and his risk filled and the amount ready to type', !!sc && sc.on === 'add' && Number(sc.px) > 0 && `$${Number(sc.risk).toFixed(2)}` === q0?.cells.Risk && sc.focus === 'sc-n' && /^You hold [\d.]+ shares at \$498\.20, stop \$495\.90\./.test(sc.sum), JSON.stringify(sc));
await page.fill('#sc-n', '500');
await page.fill('#sc-px', '497');
const addPv = await scalePrev();
ok('as he types, the new average, the new stop and what keeping the old one would risk are shown', !addPv.off && addPv.go === 'Save the add' && /^[\d.]+ shares at \$497\.\d\d$/.test(addPv.rows.Holds || '') && /^\$[\d,.]+ was \$495\.90$/.test(addPv.rows.Stop || '') && /Keeping the stop at \$495\.90 would risk \$[\d,.]+ instead\./.test(addPv.why), JSON.stringify(addPv));
await shot('O-add-sheet');
await page.click('#sc-go');
const added = await until(() => !document.getElementById('sc-go') && document.querySelector('#toasts .toast')?.textContent, 4000);
const q1 = await cardOf('QQQ', '#active .rec');
const newStop = (addPv.rows.Stop || '').split(' ')[0];
// The stop rounds toward the entry, so the risk after can be a few cents under what he had, never over.
const dollars = (v) => Number(String(v || '').replace(/[$,]/g, ''));
ok('Save lands on the card: the new stop, the same risk to within a few cents under, and his average after one add', /^Added\. QQQ stop \$/.test(added || '') && q1?.cells.Stop === newStop && dollars(q1?.cells.Risk) <= dollars(q0?.cells.Risk) && dollars(q0?.cells.Risk) - dollars(q1?.cells.Risk) <= 0.1 && /^Your size\. [\d.]+ shares at an average of \$497\.\d\d after 1 add\. The desk had the stop at \$495\.90/.test(await note('QQQ')), JSON.stringify({ added, cells: q1?.cells, note: await note('QQQ') }));
const tighter = Number(newStop.replace(/[$,]/g, '')) > 495.9;
ok('adding more at the same risk pulls the stop up toward the entry', tighter, newStop);
await openScaleOn();
await page.evaluate(() => document.querySelector('#sc-seg [data-k="trim"]').click());
await page.fill('#sc-n', '999999');
await page.fill('#sc-px', '499');
const wholePv = await scalePrev();
ok('trimming more than he holds is refused in words, and Save waits', wholePv.off && /That is the whole position\. Mark it PROFIT or LOSS instead\./.test(wholePv.why), JSON.stringify(wholePv));
await page.fill('#sc-n', '400');
const trimPv = await scalePrev();
ok('a trim keeps his average and widens the stop to hold the same risk', !trimPv.off && trimPv.go === 'Save the trim' && (trimPv.rows.Holds || '').endsWith((await note('QQQ')).match(/average of (\$[\d.]+)/)?.[1] || 'x') && Number((trimPv.rows.Stop || '').split(' ')[0].replace(/[$,]/g, '')) < Number(newStop.replace(/[$,]/g, '')), JSON.stringify(trimPv));
await page.click('#sc-go');
const trimmed = await until(() => !document.getElementById('sc-go') && document.querySelector('#toasts .toast')?.textContent, 4000);
ok('the trim lands and the card counts both', /^Trimmed\. QQQ stop \$/.test(trimmed || '') && / after 1 add and 1 trim\./.test(await note('QQQ')), JSON.stringify({ trimmed, note: await note('QQQ') }));
await tapCell('QQQ', 'amount');
const sized = await until(() => document.getElementById('sz-amt') && { reset: !!document.getElementById('sz-reset'), holds: [...document.querySelectorAll('#sz-prev .row .k')].map((k) => k.textContent.trim()) }, 3000);
ok('after an add or a trim his size opens without the way back to the desk\'s plan, and says Holds', !!sized && !sized.reset && sized.holds.includes('Holds'), JSON.stringify(sized));
await page.evaluate(() => document.querySelector('.sheet [data-x]')?.click());
await page.waitForTimeout(300);
await page.setViewportSize({ width: 320, height: 640 });
await page.waitForTimeout(400);
const at320 = await page.evaluate(() => { const c = [...document.querySelectorAll('#active .rec')].find((x) => x.querySelector('.tk')?.textContent.trim() === 'QQQ'); const bs = [...c.querySelectorAll('.acts .btn')]; return { doc: document.documentElement.scrollWidth, card: [c.clientWidth, c.scrollWidth], right: Math.round(c.getBoundingClientRect().right), cut: bs.filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent), row: new Set(bs.map((x) => Math.round(x.getBoundingClientRect().top))).size === 1, tall: bs.map((x) => Math.round(x.getBoundingClientRect().height)) }; });
// The card itself is measured: the first build grew the card past the screen and the page hid it.
ok('at 320px the three buttons fit on one row inside the card with nothing cut', at320.doc <= 321 && at320.card[1] <= at320.card[0] + 1 && at320.right <= 320 && !at320.cut.length && at320.row && at320.tall.every((h) => h >= 44), JSON.stringify(at320));
await page.evaluate(() => [...document.querySelectorAll('#active .rec')].find((c) => c.querySelector('.tk')?.textContent.trim() === 'QQQ')?.scrollIntoView({ block: 'center' }));
await shot('O-card-320');
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => [...document.querySelectorAll('#active .rec')].find((c) => c.querySelector('.tk')?.textContent.trim() === 'QQQ')?.querySelector('[data-act="profit"]')?.click());
await until(() => ![...document.querySelectorAll('#active .rec')].some((c) => c.querySelector('.tk').textContent.trim() === 'QQQ'), 5000);
await go('history');
const qRow = await until(() => { const h = [...document.querySelectorAll('#hist .hist[data-hist]')].find((x) => x.querySelector('.what b')?.textContent === 'QQQ'); if (!h) return null; h.querySelector('summary').click(); return h.querySelector('.more').textContent.replace(/\s+/g, ' '); }, 5000);
ok('History says his average beside what he put in', /You put in \$[\d,.]+, average \$497\.\d\d, risked \$/.test(qRow || ''), qRow || '');
await go('trades');

console.log('\n--- P. the re-check: a run updates how many agree on what he took, and drops one none of the five back ---');
// Eric, 2026-09-24: "If a new run disagrees with a strategy still on the table (0/5 agents agree), then it
// is removed. If some agents still agree, update with the new number of agreeing agents. The number of
// agents that agree should be placed just under probability in the same font."
await page.evaluate(() => localStorage.removeItem('pa-demo-store'));
await page.goto(DESK, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const heads = await page.evaluate(() => [...document.querySelectorAll('.rec')].map((c) => {
  const vs = [...c.querySelectorAll('.odds .v')];
  const a = c.querySelector('.odds .agree');
  const fa = a && getComputedStyle(a); const fc = vs[0] && getComputedStyle(vs[0]);
  return { tk: c.querySelector('.tk').textContent.trim(), order: vs.map((x) => (x.classList.contains('agree') ? 'agree' : 'chance')).join(), agree: a?.textContent.trim() || '', same: !!fa && !!fc && fa.fontFamily === fc.fontFamily && fa.fontSize === fc.fontSize && fa.color === fc.color, desk: [...c.querySelectorAll('.why dt')].some((d) => d.textContent.trim() === 'Desk') };
}));
ok('every card shows how many agree just under the chance, in the chance\'s own type, and no Desk row', heads.length >= 5 && heads.every((h) => h.order === 'chance,agree' && /^\d of 5 agree$/.test(h.agree) && h.same && !h.desk), JSON.stringify(heads));
// v7.13 (Eric: "They are listed for and against"): a new trade names who is for it, against it, and had no view.
const tsla = await page.evaluate(() => { const c = [...document.querySelectorAll('#board .rec')].find((x) => x.querySelector('.tk')?.textContent.trim() === 'TSLA'); return c ? Object.fromEntries([...c.querySelectorAll('.why dt')].map((d) => [d.textContent.trim(), d.nextElementSibling.textContent.trim()])) : null; });
ok('a new trade lists For, Against and No view by name, all five once', !!tsla && tsla.For === '2 · Addy Boofer, 0 DTE n00b' && tsla.Against === '2 · God, Swinger' && tsla['No view'] === '1 · Clark Kent', JSON.stringify(tsla));
ok('PLTR, the trade he holds, reads 4 of 5 before the run', heads.find((h) => h.tk === 'PLTR')?.agree === '4 of 5 agree', JSON.stringify(heads.find((h) => h.tk === 'PLTR')));
await page.evaluate(() => [...document.querySelectorAll('#board .rec')].find((c) => c.querySelector('.tk')?.textContent.trim() === 'SOFI')?.querySelector('[data-act="take"]')?.click());
await until(() => [...document.querySelectorAll('#active .rec')].some((c) => c.querySelector('.tk').textContent.trim() === 'SOFI'), 4000);
await page.click('#run');
const rechecked = await until(() => !document.getElementById('run').disabled && [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).find((t) => /The desk is in/.test(t)), 20000);
// RE-PINNED 2026-09-24 (v7.12, Eric: "tell me if I should hold or if things have changed and I need to sell,
// front and center"; a SELL stays up in red until he marks it): nothing is dropped; each taken trade gets HOLD or SELL.
// RE-PINNED 2026-09-24 (v7.13): with how many agree.
ok('the run lands and says to sell SOFI and hold PLTR, with how many agree', /Sell SOFI now \(5 of 5\)\. Hold PLTR \(3 of 5\)\.$/.test(rechecked || ''), rechecked || '');
const activeNow = await page.evaluate(() => [...document.querySelectorAll('#active .rec')].map((c) => ({
  tk: c.querySelector('.tk').textContent.trim(), agree: c.querySelector('.odds .agree')?.textContent.trim(), sell: c.classList.contains('sell'),
  call: c.querySelector('.verdict .call')?.textContent.trim() || '', why: c.querySelector('.verdict .why')?.textContent.trim() || '',
  first: c.firstElementChild?.classList.contains('verdict'),
  votes: [...c.querySelectorAll('.verdict .votes li')].map((li) => [...li.children].map((x) => x.textContent.trim()).join(' ')),
  when: c.querySelector('.verdict .when')?.textContent.trim() || '',
  red: getComputedStyle(c.querySelector('.verdict')).borderTopColor,
})));
ok('SOFI stays on the Active list, first, red, with SELL NOW and why, at the very top of its card', activeNow[0]?.tk === 'SOFI' && activeNow[0].sell && activeNow[0].call === 'SELL NOW' && /None of the five back it any more\./.test(activeNow[0].why) && activeNow[0].first, JSON.stringify(activeNow));
ok('PLTR reads HOLD with its reason and the 3 of 5 the run gave it', activeNow.some((x) => x.tk === 'PLTR' && x.call === 'HOLD' && x.why && x.agree === '3 of 5 agree' && !x.sell && x.first), JSON.stringify(activeNow));
// v7.13 (Eric: "what agents and how many agree with that decision, what the second most popular decision is,
// third, etc until the agents are fully listed").
ok('PLTR lists who voted HOLD first, then TRIM, then SELL, every agent once, and names the desk on the call', JSON.stringify(activeNow.find((x) => x.tk === 'PLTR')?.votes) === JSON.stringify(['HOLD 3 Addy Boofer, Clark Kent, God', 'TRIM 1 Swinger', 'SELL 1 0 DTE n00b']) && /^Call by Judge, jury, executioner, from the /.test(activeNow.find((x) => x.tk === 'PLTR')?.when || ''), JSON.stringify(activeNow.find((x) => x.tk === 'PLTR')));
ok('SOFI\'s SELL lists all five under SELL and reads 5 of 5', JSON.stringify(activeNow[0]?.votes) === JSON.stringify(['SELL 5 Addy Boofer, Clark Kent, God, Swinger, 0 DTE n00b']) && activeNow[0].agree === '5 of 5 agree', JSON.stringify(activeNow[0]));

await page.evaluate(() => document.getElementById('active-wrap')?.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(300);
const seen = await page.evaluate(() => { const v = document.querySelector('#active .rec .verdict'); const top = document.querySelector('.top'); return v && top ? { verdict: Math.round(v.getBoundingClientRect().top), bar: Math.round(top.getBoundingClientRect().bottom) } : null; });
ok('brought into view, the SELL banner sits below the top bar, not under it', !!seen && seen.verdict >= seen.bar, JSON.stringify(seen));
await shot('P-sell');
await page.evaluate(() => [...document.querySelectorAll('#active .rec')].find((c) => c.querySelector('.tk')?.textContent.trim() === 'SOFI')?.querySelector('[data-act="loss"]')?.click());
await until(() => ![...document.querySelectorAll('#active .rec')].some((c) => c.querySelector('.tk').textContent.trim() === 'SOFI'), 5000);
await go('history');
const sofi = await until(() => { const h = [...document.querySelectorAll('#hist .hist[data-hist]')].find((x) => x.querySelector('.what b')?.textContent === 'SOFI'); if (!h) return null; return { tag: h.querySelector('.res')?.textContent.trim() }; }, 5000);
ok('SOFI leaves only when he marks it, and lands in History as he marked it', sofi?.tag === 'LOSS', JSON.stringify(sofi));
await shot('P-history');
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
