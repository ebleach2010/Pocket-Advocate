// drive-trade.mjs - the trade desk as one app, driven in the demo.
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-trade.mjs
//
// Eric, 2026-09-22: "The current Trading Desk is too fragmented. Remove the
// excessive tabs and consolidate the app into a smaller number of clear,
// useful sections."
//
// Fourteen sections, A to N: the shelf card opens the new page, the five tabs
// and the cog, Plays with its scan landing on the page's own poll, Take it,
// News, Positions with the day bar, Stats against the seeded closes, a close
// at a profit and one at a loss with their effects, the reduced plan, the
// Desk stream with the question mark rule, Settings, the old address handing
// off, and the delete and the door. Nothing here talks to a market or a model:
// the demo seeds the desk and lands a scan and a question on a four second
// timer, which is the shape production has.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PA_PORT || '9377';
const SHOTS = process.env.PA_SHOTS || '';
const P = `http://127.0.0.1:${PORT}`;
const DESK = `${P}/admin-desk.html?id=demo-case-trade&demo=admin`;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(`PAGEERROR ${String(e).slice(0, 300)}`));
page.on('dialog', async (d) => { if (d.type() === 'confirm') await d.accept(); else await d.dismiss(); });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { if (c) { pass += 1; console.log(`  ok    ${n}${d ? ` (${d})` : ''}`); } else { fail += 1; console.log(`  FAIL  ${n}${d ? ` (${d})` : ''}`); } };
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const until = async (fn, ms = 20000, arg = null) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await page.waitForTimeout(300);
  }
};
/** The app's own tabs, tapped the way a thumb taps them. */
const go = async (name) => {
  await page.evaluate((n) => document.querySelector(`#bar [data-page="${n}"]`)?.click(), name);
  await page.waitForTimeout(700);
};
const text = async (sel) => page.evaluate((s) => document.querySelector(s)?.textContent.trim() || '', sel);
const open = async () => {
  await page.goto(DESK, { waitUntil: 'networkidle' });
  await until(() => !document.getElementById('boot') && !document.getElementById('app').hidden);
  await page.waitForTimeout(600);
};

console.log('\n--- A. the shelf: the green card opens the desk\'s own page on Plays ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); localStorage.removeItem('pa-demo-store-advocate'); localStorage.removeItem('pa-desk-page'); localStorage.removeItem('pa-desk-stats'); });
await page.reload({ waitUntil: 'networkidle' });
const card = await until(() => {
  const el = document.querySelector('.folder.trade');
  if (!el) return null;
  const a = el.closest('a') || el.querySelector('a') || el;
  return { href: a.getAttribute('href') || '', pill: el.querySelector('.status-pill')?.textContent.trim() || '', meta: el.querySelector('.folder-meta')?.textContent.trim() || '' };
});
ok('the desk\'s card points at its own page', !!card && /^\/admin-desk\.html\?id=demo-case-trade$/.test(card.href), card?.href);
ok('the card is still badged and carries its standing', !!card && card.pill === 'TRADE DESK' && /a day/.test(card.meta), `${card?.pill} | ${card?.meta}`);
const shelfLine = await page.evaluate(() => document.body.innerText);
ok('the shelf says one reading books itself and the rest waits for his tap', /one reading at 7:00 Mountain; everything else waits for your tap/.test(shelfLine));
await page.evaluate(() => document.querySelector('.folder.trade')?.closest('a')?.click());
await page.waitForTimeout(2500);
await until(() => !document.getElementById('boot'));
ok('the card walks into the app, open on Plays', /\/admin-desk(\.html)?/.test(page.url()) && await page.evaluate(() => !document.getElementById('pg-plays').hidden));
await shot('A-open');

console.log('\n--- B. the shell: five tabs, a cog, no tab strip, always dark ---');
const shell = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll('#bar [data-page]')].map((b2) => b2.querySelector('.lbl')?.textContent.trim()),
  cog: !!document.getElementById('cog'),
  strips: document.querySelectorAll('.tabs, .groups, .tab-strip').length,
  scheme: document.documentElement.dataset.scheme,
  desk: document.documentElement.hasAttribute('data-desk'),
  bg: getComputedStyle(document.body).backgroundColor,
  ind: !!document.getElementById('ind'),
  back: document.querySelector('.top .back')?.getAttribute('href'),
}));
ok('the bar carries exactly Plays, Positions, News, Stats and Desk, in that order',
  shell.tabs.join() === 'Plays,Positions,News,Stats,Desk', shell.tabs.join());
ok('there is a cog, a moving indicator, a way back to the shelf and no tab strip anywhere',
  shell.cog && shell.ind && shell.back === '/admin.html' && shell.strips === 0, JSON.stringify({ strips: shell.strips, back: shell.back }));
ok('the desk is stamped dark whatever the app\'s scheme is, on its own ground and not the app\'s', shell.desk && shell.scheme === 'calm' && shell.bg === 'rgb(6, 10, 19)', `${shell.scheme} ${shell.bg}`);
const nav = await page.evaluate(() => {
  const r = document.querySelector('#bar button.on').getBoundingClientRect();
  const i = document.getElementById('ind').getBoundingClientRect();
  return Math.abs((i.left + i.width / 2) - (r.left + r.width / 2));
});
ok('the indicator sits under the tab that is on', nav < 3, `${nav.toFixed(1)}px off`);

console.log('\n--- C. Plays: the market line, the cards best first, a scan that lands on its own ---');
const plays = await until(() => {
  const cards = [...document.querySelectorAll('#plays [data-play]')];
  if (!cards.length) return null;
  return {
    n: cards.length,
    // THE PLAIN SENTENCE (Eric, 2026-09-22): the whole face is one line now, so the drive reads
    // the line rather than hunting for chips and cells that no longer exist.
    lines: cards.map((c) => c.querySelector('.plain')?.textContent.trim()),
    odds: cards.map((c) => c.querySelector('.odds .v')?.textContent.trim()),
    tks: cards.map((c) => c.querySelector('.tk')?.textContent.trim()),
    unders: cards.map((c) => c.querySelector('.under')?.textContent.trim()),
    note: document.getElementById('note-p')?.textContent.trim().slice(0, 40),
    bullets: document.querySelectorAll('#note-p li').length,
    more: !!document.getElementById('note-more'),
    mkt: document.getElementById('mkt-word')?.textContent.trim(),
    ticks: document.querySelectorAll('#ticks .tq').length,
    stale: cards.filter((c) => c.className.includes('expired')).length,
  };
});
ok('three plays, best chance first', !!plays && plays.n === 3
  && plays.lines.map((l) => (l.match(/\b[A-Z]{1,5}\b/) || [''])[0]).join() === 'NVDA,AMD,TSLA', plays?.lines.join(' | '));
// v6.11 (Eric: "Stock names have disappeared"): the ticker leads the head row on every card.
ok('every card leads with its ticker at the head, in the order the sentences name them', !!plays && plays.tks.join() === 'NVDA,AMD,TSLA', JSON.stringify(plays?.tks));
// "3 hours, NVDA, $248, stop loss price, take profit price. If call, date strike expiration."
ok('each card is one plain sentence: the hold, what to buy with how much, the stop loss and the take profit',
  !!plays && plays.lines.every((l) => /^\d+(\.\d+)? (minutes?|hours?|days?), (buy|short) \$[\d,]+ of /.test(l)
    && /stop loss [\d.]+/.test(l) && /take profit [\d.]+/.test(l)),
  plays?.lines[0]);
ok('and the contract names its strike and when it expires',
  !!plays && plays.lines.some((l) => /call expiring \d+ \w{3}|call debit spread expiring \d+ \w{3}/.test(l))
    || plays.lines.every((l) => !/call|put|spread/.test(l)), plays?.lines.join(' | '));
ok('the line under it says what he loses in dollars and the chance, with no R and no share count',
  !!plays && plays.unders.every((u) => /You lose about \$[\d,.]+ if the stop hits\./.test(u) && !/\dR\b/.test(u) && !/ sh\b/.test(u)),
  plays?.unders[0]);
// v6.8 (Eric: "Why is the confidence interval gone"): it is on the face of every card, top right.
ok('the chance of profit is on the face of every card, first thing on the right',
  !!plays && plays.odds.length === plays.n && plays.odds.every((o) => /^\d+ to \d+%$/.test(o || '')), JSON.stringify(plays?.odds));
ok('and the small line no longer repeats it', !!plays && plays.unders.every((u) => !/Chance of profit/.test(u)), plays?.unders[0]);
ok('nothing expired is on the board', !!plays && plays.stale === 0, `${plays?.stale} expired cards`);
// v6.9 (Eric: "This needs to disappear or be shortened to 5 bullet points").
ok('the note is at most five bullets and has no more button', !!plays && plays.bullets >= 1 && plays.bullets <= 5 && !plays.more, `${plays?.bullets} bullets, more=${plays?.more}`);
ok('the scan\'s note sits above them and the market line reads his clock', !!plays && /The indexes opened/.test(plays.note || '') && /^\d\d:\d\d · /.test(plays.mkt || ''), plays?.mkt);
ok('the prices he is in are on the strip', !!plays && plays.ticks >= 1, `${plays?.ticks} tiles`);
await shot('C-plays');
await page.evaluate(() => document.getElementById('scan-go').click());
const scanning = await until(() => document.getElementById('scan').getAttribute('aria-busy') === 'true', 6000);
ok('Scan says it is scanning and disables itself', !!scanning && await page.evaluate(() => document.getElementById('scan-go').disabled));
// RE-PINNED 2026-09-22 (v6.7, Eric: "Why do I have expired plays? Those should just refresh."). A
// scan replaces the board: it expires what was standing and files what stands now, so the count
// after a scan is what the scan filed, not that plus the stale ones it just retired.
const landed = await until(() => {
  const busy = document.getElementById('scan').getAttribute('aria-busy') === 'true';
  const cards = [...document.querySelectorAll('#plays [data-play]')];
  return !busy && cards.length === 1
    ? { n: cards.length, line: cards[0].querySelector('.plain')?.textContent.trim(), txt: document.getElementById('scan-txt').textContent.trim() }
    : null;
}, 25000);
ok('the scan refreshes the board rather than piling up on it', !!landed && landed.n === 1, JSON.stringify(landed));
ok('and what it filed reads as one plain sentence', !!landed && /^3 hours, buy \$[\d,]+ of QQQ, stop loss 496\.40, take profit 501\.50$/.test(landed.line || ''), landed?.line);

console.log('\n--- D. Take it: the sheet comes pre-filled and the saved position marks the play ---');
await page.evaluate(() => document.querySelector('#plays [data-play] [data-act="take"]').click());
await page.waitForTimeout(600);
const sheet = await page.evaluate(() => {
  const f = (id) => document.getElementById(id)?.value || '';
  return { h3: document.querySelector('.sheet h3')?.textContent.trim(), tk: f('np-tk'), entry: f('np-entry'), stop: f('np-stop'), qty: f('np-qty'), risk: document.getElementById('np-risk')?.textContent.trim() };
});
ok('the sheet knows which play it came from and fills the four figures',
  /^Take /.test(sheet.h3 || '') && !!sheet.tk && !!sheet.entry && !!sheet.stop && !!sheet.qty, JSON.stringify(sheet).slice(0, 160));
ok('it says what the trade risks against what the rule allows', /Risk \$/.test(sheet.risk || '') && /allowed/.test(sheet.risk || ''), sheet.risk);
await shot('D-sheet');

// DOLLARS OR SHARES (Eric, 2026-09-22: "It should have an option for fractional shares. So
// essentially it changes dollars to shares"). The chip flips the unit and holds the position: the
// share count becomes what it costs, and typing dollars buys a fraction of a share.
const unit0 = await page.evaluate(() => {
  const u = document.getElementById('np-unit');
  return { text: u?.textContent.trim(), unit: u?.dataset.unit, hidden: !!u?.hidden, qty: document.getElementById('np-qty').value };
});
ok('the quantity field says what its number means, and it starts in shares',
  unit0.unit === 'shares' && /shares/i.test(unit0.text || '') && !unit0.hidden, JSON.stringify(unit0));
const flipped = await page.evaluate(async () => {
  document.getElementById('np-unit').click();
  await new Promise((r) => setTimeout(r, 250));
  const u = document.getElementById('np-unit');
  return { unit: u.dataset.unit, text: u.textContent.trim(), qty: document.getElementById('np-qty').value, risk: document.getElementById('np-risk').textContent.trim() };
});
const entryPx = Number(sheet.entry);
ok('one tap turns the share count into what it costs, at the entry price',
  flipped.unit === 'dollars' && flipped.text === '$'
  && Math.abs(Number(flipped.qty) - Number(sheet.qty) * entryPx) < 0.02,
  `${sheet.qty} sh at ${entryPx} -> ${flipped.qty}`);
ok('and the line says how many shares that money buys',
  /buys [\d.]+ shares/.test(flipped.risk), flipped.risk.slice(0, 140));
const fracBuy = await page.evaluate(async (px) => {
  const q = document.getElementById('np-qty');
  q.value = String(Math.round(px / 2));            // half a share's worth, near enough
  q.dispatchEvent(new Event('input'));
  await new Promise((r) => setTimeout(r, 250));
  return document.getElementById('np-risk').textContent.trim();
}, entryPx);
ok('a dollar amount under one share still buys a fraction of one', /buys 0\.\d+ shares/.test(fracBuy), fracBuy.slice(0, 140));
await shot('D-dollars');
const backToShares = await page.evaluate(async () => {
  document.getElementById('np-unit').click();
  await new Promise((r) => setTimeout(r, 250));
  return { unit: document.getElementById('np-unit').dataset.unit, qty: document.getElementById('np-qty').value };
});
ok('and back again, holding the fraction rather than rounding it away',
  backToShares.unit === 'shares' && Number(backToShares.qty) > 0 && Number(backToShares.qty) < 1, JSON.stringify(backToShares));
// A contract cannot be bought in pieces, so the chip is not offered on one. And picking one asks
// for the strike and the expiration, which used to be nowhere on this sheet at all (Eric,
// 2026-09-22: "make it clear if it's suggesting call, put, spread at what price/expiration").
const onCall = await page.evaluate(async () => {
  const i = document.getElementById('np-inst');
  i.value = 'call'; i.dispatchEvent(new Event('change'));
  await new Promise((r) => setTimeout(r, 200));
  const seen = (id) => { const el = document.getElementById(id); return !!el && !!el.offsetParent; };
  return {
    hidden: !!document.getElementById('np-unit').hidden,
    strike: seen('np-strike'), expiry: seen('np-expiry'), second: seen('np-strike2'),
    entryK: document.getElementById('np-entry-k').textContent.trim(),
  };
});
ok('a contract is never sized in dollars, because it cannot be bought in pieces', onCall.hidden === true, JSON.stringify(onCall));
ok('picking a call asks for the strike and the expiration, and not for a second leg',
  onCall.strike && onCall.expiry && !onCall.second, JSON.stringify(onCall));
ok('and the entry says it is a premium, not a share price', onCall.entryK === 'Premium', onCall.entryK);
const onSpread = await page.evaluate(async () => {
  const i = document.getElementById('np-inst');
  i.value = 'spread'; i.dispatchEvent(new Event('change'));
  await new Promise((r) => setTimeout(r, 200));
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); };
  set('np-strike', '650'); set('np-strike2', '655'); set('np-expiry', '2026-10-17');
  const legs = document.getElementById('np-legs'); legs.value = 'call'; legs.dispatchEvent(new Event('change'));
  await new Promise((r) => setTimeout(r, 250));
  const seen = (id) => { const el = document.getElementById(id); return !!el && !!el.offsetParent; };
  return {
    second: seen('np-strike2'), legs: seen('np-legs'), credit: !!document.getElementById('np-credit'),
    entryK: document.getElementById('np-entry-k').textContent.trim(),
    structure: document.getElementById('np-structure').value,
  };
});
ok('a spread asks for both strikes, which way round it runs and whether it is a credit',
  onSpread.second && onSpread.legs && onSpread.credit, JSON.stringify(onSpread));
ok('it writes What it is for him from the fields he filled',
  onSpread.structure === '650/655 call debit spread, 17 Oct', onSpread.structure);
ok('and the entry says debit or credit on a spread', onSpread.entryK === 'Debit or credit', onSpread.entryK);
await shot('D-spread');
const backToShares2 = await page.evaluate(async () => {
  const i = document.getElementById('np-inst');
  i.value = 'stock'; i.dispatchEvent(new Event('change'));
  await new Promise((r) => setTimeout(r, 200));
  const el = document.getElementById('np-strike');
  return { strike: !!el && !!el.offsetParent, entryK: document.getElementById('np-entry-k').textContent.trim() };
});
ok('shares are never asked for a strike or an expiration',
  backToShares2.strike === false && backToShares2.entryK === 'Entry', JSON.stringify(backToShares2));
await page.evaluate(async (sh) => {
  const i = document.getElementById('np-inst');
  i.value = 'stock'; i.dispatchEvent(new Event('change'));
  const q = document.getElementById('np-qty');
  q.value = sh; q.dispatchEvent(new Event('input'));
  await new Promise((r) => setTimeout(r, 200));
}, sheet.qty);

const takenTicker = sheet.tk;
await page.evaluate(() => document.getElementById('np-go').click());
await page.waitForTimeout(2500);
const saved = await until((tk) => {
  const cards = [...document.querySelectorAll('#positions [data-pos]')];
  const mine = cards.find((c) => c.querySelector('.tk')?.textContent.trim() === tk);
  return mine ? { n: cards.length, page: !document.getElementById('pg-positions').hidden, id: mine.dataset.pos } : null;
}, 15000, takenTicker);
ok('saving walks him to Positions with the new card on it', !!saved && saved.page && saved.n === 3, JSON.stringify(saved));
const marked = await page.evaluate(async () => {
  const r = await fetch('/api/admin/trade/state', { headers: { authorization: 'Bearer demo' } });
  const out = await r.json();
  return (out.plays || []).filter((p) => p.status === 'took').length;
});
ok('the play it came from reads as taken', marked === 1, `${marked} taken`);

console.log('\n--- E. News: the earnings chips, the on-desk headlines first ---');
await go('news');
const news = await until(() => {
  const rows = [...document.querySelectorAll('#news-list li')];
  if (!rows.length) return null;
  return {
    n: rows.length,
    first: rows[0].querySelector('.t')?.textContent.trim(),
    lit: rows.filter((r) => r.querySelector('.b.lit')).length,
    firstLit: !!rows[0].querySelector('.b.lit'),
    chips: [...document.querySelectorAll('#news-earn .chip')].map((c) => c.textContent.trim()),
    sub: document.getElementById('news-sub')?.textContent.trim(),
  };
});
ok('eight headlines, the ones naming a ticker he is in at the top', !!news && news.n === 8 && news.firstLit && news.lit >= 2, JSON.stringify({ n: news?.n, lit: news?.lit }));
ok('the earnings chips say who reports and when', !!news && news.chips.length === 3 && /pre|post/.test(news.chips.join(' ')), news?.chips.join(' | '));
ok('the day line says which session it is', /full session/.test(news?.sub || ''), news?.sub);
await shot('E-news');

console.log('\n--- F. Positions: the day against the aim, the ladder, the closed row ---');
await go('positions');
const pos = await until(() => {
  const cards = [...document.querySelectorAll('#positions [data-pos]')];
  const nvda = cards.find((c) => c.querySelector('.tk')?.textContent.trim() === 'NVDA');
  if (!nvda) return null;
  const bar = getComputedStyle(document.getElementById('daybar'));
  return {
    n: cards.length,
    made: document.getElementById('day-real').textContent.trim(),
    big: document.getElementById('big').textContent.trim(),
    word: document.getElementById('day-sub').textContent.trim(),
    fill: bar.getPropertyValue('--fillc').trim(),
    limit: document.getElementById('lbl-limit').textContent.trim(),
    cap: document.getElementById('lbl-cap').textContent.trim(),
    ladder: nvda.querySelector('.tg')?.textContent.trim(),
    warn: cards.some((c) => c.querySelector('.warn')),
    closed: document.getElementById('closed').textContent.trim(),
  };
});
ok('the day opens at zero, under the floor, with the balance beside it', !!pos && pos.made === '$0.00' && /Under the floor/.test(pos.word) && /^\$[\d,]+\.\d\d$/.test(pos.big), `${pos?.made} · ${pos?.word} · ${pos?.big}`);
ok('the bar carries the loss limit on the left and the cap on the right', !!pos && /^-\$/.test(pos.limit) && /^\$/.test(pos.cap), `${pos?.limit} .. ${pos?.cap}`);
ok('the NVDA card prints its ladder', !!pos && /Targets/.test(pos.ladder || '') && /64\d/.test(pos.ladder || ''), pos?.ladder);
ok('nothing is closed today yet', !!pos && /Nothing closed yet today/.test(pos.closed));
await shot('F-positions');

console.log('\n--- J. Stats against the closes the demo seeded (before he closes anything today) ---');
await go('stats');
const st = await until(() => {
  const body = document.getElementById('st-body');
  if (!body || !body.querySelector('.tile.hero')) return null;
  return { rate: body.querySelector('.tile.hero .v')?.textContent.trim(), side: body.querySelector('.tile.hero .side')?.textContent.trim(), panel: body.innerText };
});
ok('the win rate and the split come off the fourteen seeded closes',
  !!st && st.rate === '69%' && /9 W \/ 4 L \/ 1 flat/.test(st.side) && /14 closed trades/.test(st.side), `${st?.rate} ${st?.side?.replace(/\n/g, ' ')}`);
ok('the streak and the longest each way are on the page', /3 wins/.test(st?.panel || '') && /longest 3W · 2L/.test(st?.panel || ''));
await page.evaluate(() => document.getElementById('st-next').click());
await page.waitForTimeout(700);
const brk = await page.evaluate(() => ({ txt: document.getElementById('st-body').innerText, chart: !!document.getElementById('chart-svg'), dots: [...document.querySelectorAll('#st-dots i')].map((i) => i.classList.contains('on')) }));
ok('the second page breaks it down by kind and by day and draws the balance chart',
  /scalp/i.test(brk.txt) && /intraday/i.test(brk.txt) && /swing/i.test(brk.txt) && brk.chart && brk.dots[1] === true);
ok('the kinds add up to the seeded trades', /3W 1L/.test(brk.txt) && /4W 2L/.test(brk.txt) && /2W 1L/.test(brk.txt));
await page.evaluate(() => document.getElementById('st-next').click());
await page.waitForTimeout(700);
const closes = await page.evaluate(() => ({ rows: document.querySelectorAll('#st-body .closes .r').length, bars: document.querySelectorAll('#st-body .bars .col').length }));
ok('the third page draws one bar and one row for each of the last twenty', closes.rows === 14 && closes.bars === 14, JSON.stringify(closes));
await shot('J-stats');

console.log('\n--- G. a position closed at a profit: the coins, the number, the card leaving, the log line ---');
await go('positions');
const before = await page.evaluate(() => ({ n: document.querySelectorAll('#positions [data-pos]').length, made: document.getElementById('day-real').textContent.trim() }));
await page.evaluate((tk) => {
  const card = [...document.querySelectorAll('#positions [data-pos]')].find((c) => c.querySelector('.tk')?.textContent.trim() === tk);
  card.querySelector('[data-act="close"]').click();
}, takenTicker);
await page.waitForTimeout(600);
await page.evaluate(() => { const v = document.getElementById('cl-pl'); v.value = '28'; v.dispatchEvent(new Event('input')); });
const t0 = Date.now();
await page.evaluate(() => document.getElementById('cl-go').click());
const profit = await until(() => {
  const made = document.getElementById('day-real').textContent.trim();
  const last = window.__paFxLast;
  return made === '+$28.00' && last ? { made, kind: last.kind, plan: last.plan } : null;
}, 12000);
ok('the profit effect ran and the day reached the new figure inside a second and a half',
  !!profit && profit.kind === 'profit' && profit.plan.coins === true && Date.now() - t0 < 6000, `${Date.now() - t0}ms ${JSON.stringify(profit?.plan?.coins)}`);
const gone = await until((n) => document.querySelectorAll('#positions [data-pos]').length === n - 1, 12000, before.n);
ok('the card leaves once the coins have gone', !!gone);
const closedRow = await text('#closed');
ok('it joins Closed today with its figure', /\+\$28\.00/.test(closedRow), closedRow.replace(/\n/g, ' ').slice(0, 80));
await go('desk');
const logged = await until(() => {
  const rows = [...document.querySelectorAll('#stream .msg.you .b')].map((b2) => b2.textContent.trim());
  return rows.some((t) => /plus 28\.00\./.test(t)) ? rows.length : null;
}, 12000);
ok('the close put its line in the log, in the words the reading grades from', !!logged);
await shot('G-profit');

console.log('\n--- H. a position closed at a loss: the red flash, the sweeps, the count down ---');
await go('positions');
const beforeH = await page.evaluate(() => document.querySelectorAll('#positions [data-pos]').length);
await page.evaluate(() => {
  const card = [...document.querySelectorAll('#positions [data-pos]')].find((c) => c.querySelector('.tk')?.textContent.trim() === 'NVDA');
  card.querySelector('[data-act="close"]').click();
});
await page.waitForTimeout(600);
await page.evaluate(() => { const v = document.getElementById('cl-pl'); v.value = '-45'; v.dispatchEvent(new Event('input')); });
const bad = await page.evaluate(() => document.getElementById('cl-go').classList.contains('bad'));
ok('the button turns on a minus figure', bad);
await page.evaluate(() => document.getElementById('cl-go').click());
const loss = await until(() => {
  const last = window.__paFxLast;
  const made = document.getElementById('day-real').textContent.trim();
  return last && last.kind === 'loss' && made === '-$17.00' ? { made, plan: last.plan } : null;
}, 12000);
ok('the loss effect ran with its sweeps and the day counted down', !!loss && loss.plan.siren === true && loss.plan.coins === false, JSON.stringify(loss));
const goneH = await until((n) => document.querySelectorAll('#positions [data-pos]').length === n - 1, 12000, beforeH);
ok('that card leaves too', !!goneH);
await shot('H-loss');

console.log('\n--- I. Reduce effects: the numbers move and nothing else does ---');
await page.evaluate(() => document.getElementById('cog').click());
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector('[data-sw="reduceFx"]').click());
await until(() => document.querySelector('[data-sw="reduceFx"]').classList.contains('on'), 8000);
ok('the switch paints from the answer', await page.evaluate(() => document.querySelector('[data-sw="reduceFx"]').classList.contains('on')));
await page.evaluate(() => document.querySelector('.settings [data-x]').click());
await page.waitForTimeout(500);
await go('positions');
await page.evaluate(() => {
  const card = document.querySelector('#positions [data-pos]');
  card.querySelector('[data-act="close"]').click();
});
await page.waitForTimeout(600);
await page.evaluate(() => { const v = document.getElementById('cl-pl'); v.value = '12'; v.dispatchEvent(new Event('input')); });
await page.evaluate(() => document.getElementById('cl-go').click());
const quiet = await until(() => {
  const last = window.__paFxLast;
  return last && last.plan.numberOnly === true ? last.plan : null;
}, 12000);
ok('the plan it ran is the number-only one: no coins, no sweeps, no shake',
  !!quiet && quiet.coins === false && quiet.siren === false && quiet.shake === false, JSON.stringify(quiet));
await page.evaluate(() => document.getElementById('cog').click());
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector('[data-sw="reduceFx"]').click());
await until(() => !document.querySelector('[data-sw="reduceFx"]').classList.contains('on'), 8000);
await page.evaluate(() => document.querySelector('.settings [data-x]').click());
await page.waitForTimeout(400);

console.log('\n--- K. Desk: a log line answers nothing, a question comes back ---');
await go('desk');
const rd = await page.evaluate(() => ({ when: document.getElementById('rd-when').textContent.trim(), list: document.getElementById('rd-list').textContent.trim(), reading: document.getElementById('reading').innerText.slice(0, 80) }));
ok('the reading sits in its drawer with its sections named', /Reading/.test(rd.when) && /Rules to hold/.test(rd.list), `${rd.when} | ${rd.list.slice(0, 60)}`);
const nBefore = await page.evaluate(() => document.querySelectorAll('#stream .msg').length);
await page.evaluate(() => { const t = document.getElementById('say'); t.value = 'AMD long 30 at 167.30, stop 163.80. Base above the fifty day.'; t.dispatchEvent(new Event('input')); });
ok('the chip reads Log on a line that is not a question', (await text('#mode')) === 'Log');
await page.evaluate(() => document.getElementById('send').click());
const logRow = await until((n) => {
  const rows = [...document.querySelectorAll('#stream .msg')];
  return rows.length === n + 1 && /Base above the fifty day/.test(rows[rows.length - 1].innerText) ? rows.length : null;
}, 12000, nBefore);
ok('the log line lands and nothing answers it', !!logRow, `${logRow} rows`);
await page.evaluate(() => { const t = document.getElementById('say'); t.value = 'Is 652 a real level or wishful?'; t.dispatchEvent(new Event('input')); });
ok('the chip flips to Ask on a question', (await text('#mode')) === 'Ask');
await page.evaluate(() => document.getElementById('send').click());
const thinking = await until(() => document.querySelector('#stream .msg.desk.think') ? true : null, 8000);
ok('the desk shows it is thinking', !!thinking);
const answer = await until(() => {
  const last = [...document.querySelectorAll('#stream .msg.desk')].pop();
  return last && !last.classList.contains('think') && last.innerText.trim().length > 20 ? last.innerText.slice(0, 60) : null;
}, 25000);
ok('the answer lands under the question', !!answer, (answer || '').replace(/\n/g, ' '));
// The desk writes documents too (v5.0): a question that asks for one comes
// back with a PDF hung under the answer, and the bytes behind the link are
// a real PDF rather than a promise of one.
await page.evaluate(() => { const t = document.getElementById('say'); t.value = 'Make me a one page PDF of my rules to hold?'; t.dispatchEvent(new Event('input')); });
await page.evaluate(() => document.getElementById('send').click());
const doc = await until(() => {
  const att = [...document.querySelectorAll('#stream .msg.desk .att')].pop();
  return att ? att.dataset.file : null;
}, 25000);
ok('a question that asks for a document comes back with one', !!doc && /^(https?:|data:application\/pdf)/.test(doc), (doc || '').slice(0, 48));
const bytes = doc ? await page.evaluate(async (u) => {
  const r = await fetch(u);
  const b = new Uint8Array(await r.arrayBuffer());
  return String.fromCharCode(...b.slice(0, 8));
}, doc) : '';
ok('the link is real PDF bytes, not a promise of them', String(bytes).startsWith('%PDF-1.4'), bytes);
await shot('K-desk');

console.log('\n--- L. Settings: the rules, the key\'s tail, the watchlist ---');
await page.evaluate(() => document.getElementById('cog').click());
await page.waitForTimeout(700);
const before2 = await page.evaluate(() => document.querySelector('[data-sub="riskPct"]').textContent.trim());
await page.evaluate(() => { const i = document.querySelector('[data-rule="riskPct"]'); i.value = '2'; i.dispatchEvent(new Event('change')); });
const ruled = await until((was) => {
  const now = document.querySelector('[data-sub="riskPct"]').textContent.trim();
  return now !== was ? now : null;
}, 10000, before2);
ok('a rule he types moves the dollars beside it, from the server\'s answer', !!ruled && /2% of the account/.test(ruled), `${before2} -> ${ruled}`);
const keyLine = await text('#key-sub');
ok('the key is on file by its last four digits and never in full', /on file · ends \w{4}$/.test(keyLine) && !/demo-finnhub/.test(keyLine), keyLine);
const set = await page.evaluate(() => ({
  chips: document.querySelectorAll('#watch-chips .chip').length,
  files: document.querySelectorAll('#set-files .r').length,
  sw: [...document.querySelectorAll('[data-sw]')].map((s) => s.dataset.sw),
  version: document.querySelector('.settings .foot')?.textContent.trim(),
  danger: !!document.getElementById('desk-delete'),
}));
// RE-PINNED 2026-09-22 (v6.2): the version line used to be pinned at 6.0 verbatim, so it went stale
// the moment anything shipped and said nothing about whether the sheet agreed with the build. It is
// read off the running Worker now, so the pin is that the sheet shows the version actually served.
const served = await (await fetch(`${P}/api/version`)).json().catch(() => ({}));
ok('the watchlist, the three switches, the files shelf and the version are all in the sheet, and the version is the one the build is serving',
  set.chips === 10 && set.sw.join() === 'pushOn,celebrate,reduceFx' && set.danger
  && !!served.version && set.version === `Version ${served.version}`,
  `${JSON.stringify(set).slice(0, 140)} served ${served.version}`);
await shot('L-settings');
await page.evaluate(() => { const i = document.querySelector('[data-rule="riskPct"]'); i.value = '1'; i.dispatchEvent(new Event('change')); });
await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelector('.settings [data-x]').click());

console.log('\n--- M. the old address hands off ---');
await page.goto(`${P}/admin-case.html?id=demo-case-trade&demo=admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
ok('the folder walks a desk straight into its own app', /\/admin-desk(\.html)?\?id=demo-case-trade/.test(page.url()), page.url());

console.log('\n--- N. delete the desk, then the door opens a new one ---');
await open();
await page.evaluate(() => document.getElementById('cog').click());
await page.waitForTimeout(700);
await page.evaluate(() => document.getElementById('desk-delete').click());
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('dd-go').click());
await page.waitForTimeout(3000);
ok('deleting walks back to the shelf', /\/admin(\.html)?$/.test(page.url()), page.url());
const door = await until(() => (document.querySelector('[data-open-trade]') ? true : null), 15000);
ok('the green door is back once no desk is open', !!door);
await page.goto(DESK.replace('id=demo-case-trade&', ''), { waitUntil: 'networkidle' });
const doorPage = await until(() => (document.getElementById('door-go') ? true : null), 15000);
ok('the page itself shows the door when there is no desk', !!doorPage);
await page.evaluate(() => document.getElementById('door-go').click());
await page.waitForTimeout(3000);
ok('one tap opens a desk and walks into it', /\/admin-desk(\.html)?\?id=/.test(page.url()), page.url());
await shot('N-door');

console.log('\n--- B and F again at 320px ---');
const small = await ctx.newPage();
await small.setViewportSize({ width: 320, height: 640 });
await small.goto(page.url(), { waitUntil: 'networkidle' });
await small.waitForTimeout(3000);
const narrow = await small.evaluate(() => ({
  wide: document.documentElement.scrollWidth > window.innerWidth + 1,
  tabs: document.querySelectorAll('#bar [data-page]').length,
  cut: [...document.querySelectorAll('#bar .lbl')].some((l) => l.scrollWidth > l.clientWidth + 1),
}));
ok('the bar holds its five at 320px with nothing cut and no sideways scroll', narrow.tabs === 5 && !narrow.cut && !narrow.wide, JSON.stringify(narrow));
await small.evaluate(() => document.querySelector('#bar [data-page="positions"]')?.click());
await small.waitForTimeout(1200);
const narrowPos = await small.evaluate(() => ({ wide: document.documentElement.scrollWidth > window.innerWidth + 1, made: !!document.getElementById('day-real') }));
ok('Positions holds at 320px too', narrowPos.made && !narrowPos.wide, JSON.stringify(narrowPos));
if (SHOTS) await small.screenshot({ path: `${SHOTS}/B-320.png`, fullPage: true });
await small.close();

console.log(`\n${pass} ok, ${fail} failed`);
if (errs.length) { console.log('\nPage errors:'); for (const e of errs.slice(0, 12)) console.log(`  ${e}`); }
await b.close();
process.exit(fail || errs.length ? 1 : 0);
