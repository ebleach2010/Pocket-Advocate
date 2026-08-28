// In office / out of office, the "?" sheet, and "Working on this client",
// driven in a real browser at 390x844 - an iPhone, which is where Eric and
// most of his clients are.
//
// Eric, 2026-08-27. Three things, and this drive asks all three of the app
// rather than of the source:
//   1. clients get a "pretty noticeable visual cue" of whether he is in or out,
//      and his manual switch beats the schedule both ways;
//   2. a small "?" beside the chat, at least 44px, opens "When will Eric
//      respond?" with his status at the top and his copy below it;
//   3. long-press a case file, tap "Working on this client", the folder turns
//      green-outline glow and the clock that already exists starts.
//
// Screenshots land in /tmp so they can actually be looked at, because a drive
// that only prints "ok" has not seen anything.
import { chromium } from 'playwright';

const PORT = process.env.PA_PORT || 8823;
const P = `http://127.0.0.1:${PORT}`;
const SHOT = process.env.PA_SHOTS || '/tmp/hours-shots';

let pass = 0, fail = 0;
const errs = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ok   ', n, d ? `- ${d}` : ''); }
  else { fail++; console.log('  FAIL ', n, d ? `- ${d}` : ''); }
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
// A real phone: 390x844, touch on, so a long press is a long press.
//
// PA_WIDTH drives the same script at 320, the narrowest phone anybody still
// carries, because the sheet and the pill both wrap and the shelf control is a
// row of three buttons.
const WIDTH = Number(process.env.PA_WIDTH || 390);
// A NAMED TIMEZONE, not the container's. The sheet now prints the reader's own
// clock beside Eric's, and a drive run in UTC would be reading the one case
// nobody is actually in. New York is a real client's phone and the answer is
// arithmetic anybody can check by hand.
const ctx = await b.newContext({
  viewport: { width: WIDTH, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  timezoneId: 'America/New_York',
});
await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));

const settle = (ms = 2500) => page.waitForTimeout(ms);

// ---------------------------------------------------------------------------
console.log('\n--- 1. the advocate control, on the shelf ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(3000);

const ctl = await page.evaluate(() => {
  const box = document.querySelector('.office-ctl');
  if (!box) return { there: false };
  const big = box.querySelector('[data-big]');
  const acts = [...box.querySelectorAll('[data-set]')];
  return {
    there: true,
    state: big?.textContent?.trim(),
    why: box.querySelector('[data-why]')?.textContent?.trim(),
    buttons: acts.map((x) => x.textContent.trim()),
    // Every one of his controls has to be thumb-sized.
    smallest: Math.min(...acts.map((x) => Math.round(x.getBoundingClientRect().height))),
    // He is on a phone: nothing may push the page sideways.
    docWidth: document.documentElement.scrollWidth,
    winWidth: window.innerWidth,
  };
});
ok('the status control is on the shelf', ctl.there, JSON.stringify(ctl.state));
ok('it says in or out in words', /IN OFFICE|OUT OF OFFICE/.test(ctl.state || ''), ctl.state);
ok('it offers both switches and the way back to the schedule',
  ctl.buttons?.join('|') === 'In office|Out of office|Follow my hours', ctl.buttons?.join('|'));
ok('every switch is a 44px target', ctl.smallest >= 44, `${ctl.smallest}px`);
ok(`and nothing on the shelf scrolls sideways at ${WIDTH}px`,
  ctl.docWidth <= ctl.winWidth, `${ctl.docWidth} vs ${ctl.winWidth}`);
await page.screenshot({ path: `${SHOT}/1-shelf-control.png` });

// ---------------------------------------------------------------------------
console.log('\n--- 2. the client cue follows the schedule ---');
// The case page is a folder of tabs and the chat lives on one of them, so the
// cue and its "?" are display:none until that tab is open. Measuring them from
// the Progress tab reports 0x0 for everything, which is how the first run of
// this drive "found" a 0px tap target.
const openClientChat = async () => {
  await page.goto(`${P}/case.html?id=demo-case&demo=1`, { waitUntil: 'networkidle' });
  await settle(3000);
  // The first-run tutorial is a modal overlay and it swallows every tap behind
  // it, so it has to go before anything on the page can be pressed. Marking it
  // done is what the tutorial itself does when you finish it.
  await page.evaluate(() => {
    try { localStorage.setItem('pa-intro-done', '1'); } catch { /* blocked */ }
    document.getElementById('pa-intro')?.remove();
  });
  await page.evaluate(() => document.querySelector('.folder-tabs a[data-page="chat"]')?.click());
  await settle(2500);
};
await openClientChat();

const readCue = () => page.evaluate(() => {
  const cue = document.querySelector('.office-cue');
  if (!cue) return { there: false };
  const r = cue.getBoundingClientRect();
  const cs = getComputedStyle(cue);
  const dot = cue.querySelector('.p-dot');
  return {
    there: true,
    label: cue.querySelector('.p-label')?.textContent?.trim(),
    cls: cue.className,
    border: cs.borderColor,
    background: cs.backgroundColor,
    dotColour: dot ? getComputedStyle(dot).backgroundColor : null,
    w: Math.round(r.width), h: Math.round(r.height),
  };
});

const scheduled = await readCue();
ok('the client case page carries the pill', scheduled.there, JSON.stringify(scheduled));
// THE CHECK THAT WAS MISSING. Nothing anywhere asserted that a client surface
// really paints the cue: commenting out watchPresence(el) in case.js froze the
// pill on its cold state on every client's chat and the whole battery stayed
// green. This is the page being looked at rather than the source being read.
ok('the client page really PAINTS the status, not just the empty pill',
  /In office|Out of office/.test(scheduled.label || '')
  && !/unknown/.test(scheduled.cls || ''),
  `${scheduled.label} [${scheduled.cls}]`);
ok('and it carries the matching class, so the styling is on',
  /\b(in|out)\b/.test(scheduled.cls || ''), scheduled.cls);

const help = await page.evaluate(() => {
  const btn = document.querySelector('[data-help="hours"]');
  if (!btn) return { there: false };
  const r = btn.getBoundingClientRect();
  return {
    there: true,
    w: Math.round(r.width), h: Math.round(r.height),
    label: btn.getAttribute('aria-label'),
    text: btn.textContent.trim(),
    // "Visually subtle": it must not be shouting louder than the pill.
    colour: getComputedStyle(btn).color,
  };
});
ok('there is a "?" beside the chat', help.there && help.text === '?', JSON.stringify(help));
ok('it is at least a 44px tap target', help.w >= 44 && help.h >= 44, `${help.w}x${help.h}`);
ok('and it says what it opens', /When will Eric respond/.test(help.label || ''), help.label);
await page.screenshot({ path: `${SHOT}/2-client-cue.png` });

// ---------------------------------------------------------------------------
console.log('\n--- 3. the sheet ---');
await page.click('[data-help="hours"]');
await settle(1200);

const sheet = await page.evaluate(() => {
  const card = document.querySelector('#pa-help .settings-card');
  if (!card) return { there: false };
  const title = card.querySelector('h3')?.textContent?.trim();
  const paras = [...card.querySelectorAll('p')].map((p) => p.textContent.replace(/\s+/g, ' ').trim());
  const key = card.querySelector('.hours-key');
  const keyCs = key ? getComputedStyle(key) : null;
  const bodyCs = getComputedStyle(card.querySelector('p:not([class])') || card);
  const statusFirst = card.querySelector('.hours-now');
  const cue = card.querySelector('.office-cue');
  return {
    there: true,
    title,
    paras,
    text: card.textContent.replace(/\s+/g, ' ').trim(),
    statusIsFirst: !!statusFirst
      && [...card.children].indexOf(statusFirst) <= 1,
    statusLabel: cue?.querySelector('.p-label')?.textContent?.trim(),
    keyText: key?.textContent?.replace(/\s+/g, ' ').trim(),
    keyWeight: keyCs?.fontWeight,
    keySize: parseFloat(keyCs?.fontSize || '0'),
    bodySize: parseFloat(bodyCs.fontSize || '0'),
    bodyColour: bodyCs.color,
    keyBorder: keyCs?.borderLeftWidth,
    scrollsSideways: document.documentElement.scrollWidth > window.innerWidth,
    // The reader's own clock, beside his.
    localText: card.querySelector('.hours-local')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    localSize: parseFloat(getComputedStyle(card.querySelector('.hours-local') || card).fontSize || '0'),
    localColour: getComputedStyle(card.querySelector('.hours-local') || card).color,
    // THE EMERGENCY LINE, MEASURED. It was var(--dim) at .88rem, the faintest
    // and smallest paragraph on a sheet two screens long.
    safetyText: card.querySelector('.hours-safety')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    safetySize: parseFloat(getComputedStyle(card.querySelector('.hours-safety') || card).fontSize || '0'),
    safetyColour: getComputedStyle(card.querySelector('.hours-safety') || card).color,
    safetyIsLast: (() => {
      const ps = [...card.querySelectorAll('p')];
      return ps.length > 0 && ps[ps.length - 1].classList.contains('hours-safety');
    })(),
    cardHeight: Math.round(card.scrollHeight),
  };
});
ok('the sheet opens', sheet.there);
ok('titled in his words', sheet.title === 'When will Eric respond?', sheet.title);
ok('his status is at the TOP, above the copy', sheet.statusIsFirst, String(sheet.statusIsFirst));
ok('and the status in the sheet is a real one',
  /In office|Out of office/.test(sheet.statusLabel || ''), sheet.statusLabel);
ok('it is broken into sections, not one wall of text',
  (sheet.paras || []).length >= 7, `${(sheet.paras || []).length} blocks`);
ok('the sentence he asked to emphasise is the emphasised one',
  /^If I haven't responded yet, that doesn't necessarily mean I'm not working on your case\.$/
    .test(sheet.keyText || ''), sheet.keyText);
ok('and it is VISIBLY emphasised, not just tagged',
  Number(sheet.keyWeight) >= 700 && sheet.keySize > sheet.bodySize
  && parseFloat(sheet.keyBorder) >= 2,
  `weight ${sheet.keyWeight}, ${sheet.keySize}px vs body ${sheet.bodySize}px, rule ${sheet.keyBorder}`);

// His copy, as RENDERED. The suite compares the source; this compares what a
// person actually sees, which is the only place an HTML entity would show up
// as the character it decodes to.
const WORDS = [
  'Standard advocacy hours are Monday to Friday, 8:00 AM to 7:00 PM Mountain Time, unless my current status shows otherwise.',
  'I check messages throughout the day, but responses are triaged based on urgency, time sensitivity, and what each case needs, not simply the order messages arrive.',
  'A time-sensitive issue, such as an appointment happening soon, a problem accessing care, a deadline, or an important change in your situation, may be prioritized ahead of a routine question or update.',
  "If I haven't responded yet, that doesn't necessarily mean I'm not working on your case.",
  'A significant part of advocacy happens behind the scenes.',
  'Some messages also deserve more than a quick answer.',
  "You're always welcome to send messages outside office hours. I'll see them when I'm back in office.",
  'This chat is not an emergency or real-time medical service.',
];
for (const w of WORDS)
  ok(`rendered: "${w.slice(0, 44)}..."`, (sheet.text || '').includes(w));
ok('no em or en dash anywhere a person reads it',
  !/[—–]/.test(sheet.text || ''),
  (sheet.text || '').match(/.{0,30}[—–].{0,30}/)?.[0] || '');
ok('no response time is promised, because none has been set',
  !/typically|usually within|within \d+ (hour|day)/i.test(sheet.text || ''));
ok('the sheet does not push the page sideways', !sheet.scrollsSideways);

// BOTH CLOCKS. He asked for the reader's own timezone beside Mountain. This
// context is pinned to America/New_York, where his 8:00 to 19:00 Mountain is
// 10:00 AM to 9:00 PM, in either half of the year.
ok('the sheet shows the reader their own clock as well as his',
  // Whitespace normalised: ICU puts a narrow no-break space before AM in some
  // versions and a plain one in others, and neither is what is being tested.
  /10:00 AM to 9:00 PM your time/.test((sheet.localText || '').replace(/\s/g, ' ')),
  sheet.localText || '(no local line rendered)');
ok('it sits directly under his hours sentence, and reads as one thought',
  (sheet.paras || []).findIndex((x) => /your time/.test(x))
    === (sheet.paras || []).findIndex((x) => /Standard advocacy hours/.test(x)) + 1,
  (sheet.paras || []).slice(0, 3).join(' || '));
ok('and it is not the quiet half: same size and colour as the prose',
  sheet.localSize >= sheet.bodySize && sheet.localColour === sheet.bodyColour,
  `${sheet.localSize}px ${sheet.localColour} vs body ${sheet.bodySize}px ${sheet.bodyColour}`);

// THE EMERGENCY LINE. Eric's position for it is last and it stays last; what
// changed is that it is no longer the faintest thing on the page.
ok('the emergency line is still the last thing he wrote', sheet.safetyIsLast,
  sheet.safetyText.slice(0, 60));
ok('and it is NOT dimmer than the prose around it',
  sheet.safetyColour === sheet.bodyColour,
  `safety ${sheet.safetyColour} vs body ${sheet.bodyColour}`);
ok('and NOT smaller than it either',
  sheet.safetySize >= sheet.bodySize,
  `${sheet.safetySize}px vs body ${sheet.bodySize}px`);
await page.screenshot({ path: `${SHOT}/3-sheet-top.png` });
await page.evaluate(() => {
  const c = document.querySelector('#pa-help .settings-card');
  if (c) c.scrollTop = c.scrollHeight;
});
await settle(400);
await page.screenshot({ path: `${SHOT}/3b-sheet-bottom.png` });

await page.keyboard.press('Escape');
await settle(600);
ok('Escape closes it', await page.evaluate(() => !document.getElementById('pa-help')));

// ---------------------------------------------------------------------------
console.log('\n--- 4. the switch beats the schedule, seen from the client side ---');
const flip = async (which) => {
  await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
  await settle(2500);
  // The visual pass (2026-08-29) folded the office card into a closed
  // <details>; the buttons still exist unchanged inside it. Set .open
  // directly - clicking the summary after a repaint can toggle it closed.
  await page.evaluate(() => {
    const d = document.querySelector('details.office-fold');
    if (d) d.open = true;
  });
  await settle(300);
  await page.click(`[data-set="${which}"]`);
  await settle(1500);
  return page.evaluate(() => ({
    state: document.querySelector('[data-big]')?.textContent?.trim(),
    why: document.querySelector('[data-why]')?.textContent?.trim(),
    overriding: !!document.querySelector('[data-why]')?.classList.contains('overriding'),
  }));
};

const wentOut = await flip('out');
ok('he can switch himself OUT', wentOut.state === 'OUT OF OFFICE', wentOut.state);
ok('and is told the switch is disagreeing with his hours',
  wentOut.overriding && /Set by hand/.test(wentOut.why || ''), wentOut.why);
await page.screenshot({ path: `${SHOT}/4-shelf-out.png` });

await openClientChat();
await settle(3500);
const clientOut = await readCue();
ok('the CLIENT now sees out of office during his normal hours',
  clientOut.label === 'Out of office' && /\bout\b/.test(clientOut.cls || ''),
  `${clientOut.label} [${clientOut.cls}]`);
await page.screenshot({ path: `${SHOT}/5-client-out.png` });

const wentIn = await flip('in');
ok('he can switch himself back IN', wentIn.state === 'IN OFFICE', wentIn.state);

await openClientChat();
await settle(3500);
const clientIn = await readCue();
ok('and the client sees in office again', clientIn.label === 'In office', clientIn.label);
ok('the two states really do look different to a person',
  clientIn.border !== clientOut.border || clientIn.dotColour !== clientOut.dotColour,
  `in: ${clientIn.border} / ${clientIn.dotColour}   out: ${clientOut.border} / ${clientOut.dotColour}`);
await page.screenshot({ path: `${SHOT}/6-client-in.png` });

// The Chat tab carries the same cue and the same "?".
//
// THE SUBSCRIBER PAGE IS NOT DRIVEN HERE, and that is a real gap rather than
// an oversight: the demo store seeds no subscription at all, so
// /subscription.html can only ever render its "No subscription yet" branch,
// which has no chat and therefore no cue. What holds it together instead is
// the availability suite, which pins that subscription.js renders
// officeCueHtml() and calls wireHelp() like the other two. Seeding a demo
// subscription would be the way to close this, and it is a bigger change than
// this feature.
for (const [name, url] of [['the Chat tab', `${P}/chat.html?demo=1`]]) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await settle(3000);
  const found = await page.evaluate(() => ({
    cue: !!document.querySelector('.office-cue'),
    label: document.querySelector('.office-cue .p-label')?.textContent?.trim(),
    q: !!document.querySelector('[data-help="hours"]'),
  }));
  ok(`${name} carries the pill`, found.cue && /In office|Out of office/.test(found.label || ''),
    JSON.stringify(found));
  ok(`${name} carries the "?" too`, found.q);
}

// ---------------------------------------------------------------------------
console.log('\n--- 5. the work switch on the card ---');
// The long-press menu this section used to drive is gone (Eric, 2026-08-29:
// "long pressing the chart isn't the way to go about toggling on if I'm
// working... I want a toggle-able pill like a light switch. On/off for work
// with a 0.25 second animation of the switch flipping."). What is driven now
// is the switch itself: flip on, knob across, folder glows green, same clock
// underneath; flip off, plain manila. The long-press drive and its shots are
// in this file's history at v2.49.
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(3500);

const folderId = await page.evaluate(() => {
  const card = document.querySelector('.folder');
  card?.scrollIntoView({ block: 'center', behavior: 'instant' });
  return card?.dataset.id || null;
});
await settle(900);
ok('there is a folder on the shelf', !!folderId, String(folderId));

const swState = (id) => page.evaluate((fid) => {
  const card = document.querySelector(`.folder[data-id="${fid}"]`);
  const clock = document.querySelector(`[data-clock="${fid}"]`);
  const knob = clock?.querySelector('.wk-knob');
  const cs = card ? getComputedStyle(card) : null;
  return {
    working: !!card?.classList.contains('working'),
    clockOn: !!clock?.classList.contains('on'),
    role: clock?.getAttribute('role'),
    checked: clock?.getAttribute('aria-checked'),
    title: clock?.getAttribute('title'),
    knobShift: knob ? getComputedStyle(knob).transform : null,
    knobTransition: knob ? getComputedStyle(knob).transitionDuration : null,
    clockText: clock?.querySelector('[data-clock-t]')?.textContent?.trim(),
    dayText: clock?.querySelector('[data-clock-day]')?.textContent?.trim(),
    dayHidden: clock?.querySelector('[data-clock-day]')?.hidden ?? null,
    outline: cs?.outlineColor,
    outlineWidth: cs?.outlineWidth,
  };
}, id);

const before = await swState(folderId);
ok('the switch is a switch, off, and the folder plain manila',
  before.role === 'switch' && before.checked === 'false'
  && !before.working && !before.clockOn, JSON.stringify(before));
ok('the knob is wired to flip in a quarter second',
  before.knobTransition === '0.25s', String(before.knobTransition));
// Today's line under the total (Eric, 2026-08-29: "a daily hours/min logged
// for the day... seen next to the total. Only seen on my side."). The demo
// seeds an hour five on this case, dated today, and it must be on the card
// with the clock still OFF - the day log is a log, not a live-only readout.
ok('today\'s hours sit under the total before anything is flipped',
  before.dayHidden === false && /^1h 5m today$/.test(before.dayText || ''),
  `"${before.dayText}" hidden=${before.dayHidden}`);
// Two clocks, two tiers (Eric, 2026-08-29). The demo case carries 24h 30m
// lifetime with 22h of review behind the mark, so the card must show the
// Hands-Off clock: 2h 30m, not the lifetime total.
ok('the card shows the Hands-Off clock, review hours behind the mark',
  before.clockText === '2h 30m', `"${before.clockText}"`);
await page.screenshot({ path: `${SHOT}/7-switch-off.png` });

await page.click(`[data-clock="${folderId}"]`);
await settle(2000);
const on = await swState(folderId);
ok('one flip: the switch reads on and the knob has slid across',
  on.checked === 'true' && on.clockOn
  && !!on.knobShift && on.knobShift !== 'none' && on.knobShift !== before.knobShift,
  JSON.stringify({ checked: on.checked, knob: on.knobShift }));
ok('the folder turns green-outline glow', on.working && parseFloat(on.outlineWidth) >= 2,
  `${on.outlineWidth} ${on.outline}`);
// The Daylight palette (2026-08-29) deepened the glow green from
// rgb(16,185,129) to rgb(30,122,78), so this asserts green-DOMINANCE - the
// green channel beating both others - instead of pinning one green's bytes.
// Cyan fails it: cyan's blue keeps up with its green.
ok('the outline really is green, not the cyan everything else uses',
  (() => {
    const m = (on.outline || '').match(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)/);
    return !!m && +m[2] > +m[1] && +m[2] > +m[3];
  })(), on.outline);
ok('and the SAME clock that already existed is now running',
  on.clockOn, `clock reads "${on.clockText}"`);
// Caught on camera 2026-08-29: the flip repainted the card with the raw
// lifetime total for thirty seconds before the tick corrected it. The text
// must be the tier's clock at every moment, the flip included.
ok('the flip never flashes the lifetime total onto the card',
  /^2h 3[01]m$/.test(on.clockText || ''), `"${on.clockText}"`);
ok('the words keep up with the state', /Flip to stop/.test(on.title || ''), on.title);
ok('and the day line rides through the flip', /^1h 5m today$/.test(on.dayText || ''),
  `"${on.dayText}"`);
await page.screenshot({ path: `${SHOT}/8-switch-on.png` });

await page.click(`[data-clock="${folderId}"]`);
await settle(2000);
const off = await swState(folderId);
ok('flipping it back goes to regular manila', !off.working && off.checked === 'false',
  JSON.stringify({ checked: off.checked, working: off.working }));
ok('and stops the clock with it', !off.clockOn);
ok('the few seconds of that flip did not lose the day figure',
  /^1h 5m today$/.test(off.dayText || ''), `"${off.dayText}"`);
await page.screenshot({ path: `${SHOT}/9-switch-off-again.png` });

// A press on the diagnosis line must still be the diagnosis editor, not this.
const dxBox = await page.evaluate(() => {
  const el = document.querySelector('.folder-dx');
  if (!el) return null;
  // Instant, and measured after a settle below. A smooth scroll here reports
  // the rect the line is moving away from, and every event then lands on
  // nothing, which reads exactly like the press not working.
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  return true;
});
await settle(900);
const dxAt = dxBox && await page.evaluate(() => {
  const el = document.querySelector('.folder-dx');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
if (dxAt) {
  await page.mouse.move(dxAt.x, dxAt.y);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await settle(800);
  const which = await page.evaluate(() => ({
    dx: !!document.querySelector('.dx-card'),
    work: !!document.querySelector('.msg-menu'),
  }));
  ok('pressing the diagnosis line still opens the read editor, not the work menu',
    which.dx && !which.work, JSON.stringify(which));
  await page.keyboard.press('Escape');
  await settle(400);
} else {
  ok('pressing the diagnosis line still opens the read editor, not the work menu',
    false, 'no .folder-dx on the shelf to press');
}

// ---------------------------------------------------------------------------
// THE LONG PRESS IS GONE (Eric, 2026-08-29: "long pressing the chart isn't
// the way to go about toggling on if I'm working"). Until v2.49 this section
// drove the mark-eats-the-next-tap bug in the long-press work menu; the menu
// and its mark are deleted with the menu itself, and the old sequence lives
// in file history at v2.49. What must stay true instead: a long hold on the
// folder is now just a slow tap - no menu appears, the work switch does not
// flip, and the case simply opens.
console.log('\n--- 5b. a long hold on the folder is just a slow tap now ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(3000);
const tapBox = await page.evaluate(() => {
  const card = document.querySelector('.folder');
  card?.scrollIntoView({ block: 'center', behavior: 'instant' });
  return card?.dataset.id || null;
});
await settle(900);
const tapAt = await page.evaluate((id) => {
  const card = document.querySelector(`.folder[data-id="${id}"]`);
  if (!card) return null;
  const t = card.querySelector('.folder-name') || card;
  const r = t.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}, tapBox);
if (!tapAt) {
  ok('a long hold on the folder opens the case', false,
    'no folder on the shelf to press');
} else {
  const swBefore = await page.evaluate((id) =>
    document.querySelector(`[data-clock="${id}"]`)?.getAttribute('aria-checked') ?? null,
  tapBox);
  await page.mouse.move(tapAt.x, tapAt.y);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await settle(1600);
  const held = await page.evaluate(() => ({
    menu: !!document.querySelector('.msg-menu'),
    where: location.pathname + location.search,
  }));
  ok('no work menu appears any more', !held.menu);
  ok('the hold is just a slow tap: the case opens',
    /admin-case/.test(held.where), `at ${held.where}`);
  // While the drive is on the chart: the day figure beside the total on the
  // header switch too, from the same beacon answer the shelf used.
  await settle(1500);
  const headText = await page.evaluate(() =>
    document.querySelector('[data-work-head]')?.textContent?.trim() || '');
  ok('the chart header carries the day figure beside the total',
    /1h 5m today/.test(headText), `"${headText}"`);
  ok('and the chart header total is the Hands-Off clock too',
    /2h 30m/.test(headText) && !/24h 30m/.test(headText), `"${headText}"`);
  await page.screenshot({ path: `${SHOT}/10-hold-opens-case.png` });
  await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
  await settle(2500);
  const swAfter = await page.evaluate((id) =>
    document.querySelector(`[data-clock="${id}"]`)?.getAttribute('aria-checked') ?? null,
  tapBox);
  ok('and it never flipped the work switch on the way through',
    swAfter === swBefore, `switch ${swBefore} -> ${swAfter}`);
}

// Put the demo back the way it was found.
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(2500);
// Same fold as flip(): the buttons live inside the closed <details> now.
await page.evaluate(() => {
  const d = document.querySelector('details.office-fold');
  if (d) d.open = true;
});
await settle(300);
await page.click('[data-set=""]');
await settle(1200);
const restored = await page.evaluate(() => document.querySelector('[data-why]')?.textContent?.trim());
ok('"Follow my hours" hands the answer back to the schedule',
  /Following your hours/.test(restored || ''), restored);

// ---------------------------------------------------------------------------
console.log('\n--- 6. the cold state: the client page with no answer at all ---');
//
// UNKNOWN MUST NOT LOOK LIKE OUT. With the route unreachable the pill used to
// read "OFFICE HOURS" in the same grey ring with the same filled grey dot as
// "OUT OF OFFICE", so a dropped network told a client he was out when nobody
// knew. It reads "CHECKING" now, with a dashed ring and a hollow dot.
//
// Breaking the route takes a little care: the demo answers fetch itself, from
// inside the page, so there is no network request to intercept. This installs a
// property on window.fetch BEFORE anything loads, so whatever the demo assigns
// gets wrapped, and only /api/availability is refused.
{
  const cold = await b.newContext({
    viewport: { width: WIDTH, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    timezoneId: 'America/New_York',
  });
  await cold.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
  const cp = await cold.newPage();
  await cp.addInitScript(() => {
    let current = window.fetch;
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      get() { return current; },
      set(next) {
        current = (input, init) => {
          const u = String(typeof input === 'string' ? input : (input && input.url) || '');
          if (u.includes('/api/availability')) return Promise.reject(new Error('drive: offline'));
          return next(input, init);
        };
      },
    });
  });
  await cp.goto(`${P}/case.html?id=demo-case&demo=1`, { waitUntil: 'networkidle' });
  await cp.waitForTimeout(3000);
  await cp.evaluate(() => {
    try { localStorage.setItem('pa-intro-done', '1'); } catch { /* blocked */ }
    document.getElementById('pa-intro')?.remove();
  });
  await cp.evaluate(() => document.querySelector('.folder-tabs a[data-page="chat"]')?.click());
  await cp.waitForTimeout(2500);
  const dead = await cp.evaluate(() => {
    const cue = document.querySelector('.office-cue');
    if (!cue) return { there: false };
    const cs = getComputedStyle(cue);
    const dot = cue.querySelector('.p-dot');
    const dcs = dot ? getComputedStyle(dot) : null;
    return {
      there: true,
      label: cue.querySelector('.p-label')?.textContent?.trim(),
      cls: cue.className,
      borderStyle: cs.borderTopStyle,
      dotColour: dcs?.backgroundColor,
      title: cue.getAttribute('title'),
    };
  });
  ok('with no answer the pill is still on the page', dead.there, JSON.stringify(dead));
  ok('it does NOT claim he is out of office',
    dead.label !== 'Out of office' && !/\bout\b/.test(dead.cls || ''),
    `${dead.label} [${dead.cls}]`);
  ok('it says it does not know, in a word', dead.label === 'Checking', dead.label);
  ok('and it LOOKS different from out: dashed ring, hollow dot',
    dead.borderStyle === 'dashed'
    && dead.dotColour !== clientOut.dotColour,
    `${dead.borderStyle} ring, dot ${dead.dotColour} vs out ${clientOut.dotColour}`);
  await cp.screenshot({ path: `${SHOT}/11-cold-unknown.png` });
  await cold.close();
}

console.log(`\n${pass} ok, ${fail} FAIL`);
if (errs.length) console.log('page errors:\n  ' + errs.join('\n  '));
console.log(`screenshots in ${SHOT}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
