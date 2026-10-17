// SALES, ONE SWITCH (Eric, 2026-10-12: "Stop sales everywhere." And, for
// later: "/open means open up all packages, remove the banner saying I'm
// sick. But leave the waitlist button for if my schedule is blocked off.")
//
// While a service is off, worker/index.js refuses every route that buys it
// (SALES_ROUTES there), whatever the page says; that is the gate. The pages
// load sales-closed.js, which says so and offers the waitlist instead,
// package by package. The Worker imports this file, so nothing here may
// touch a page when it loads.
// OPEN (Eric, 2026-10-17: "For now, open up all my tier options.").
export const SALES_OPEN = true;

// 24/7 Priority Chat, on its own switch (Eric, 2026-10-14: "Unlock priority
// chat"). The case, full service and every case add-on stay behind
// SALES_OPEN; the chat line's one route, /api/subscribe, answers to this.
export const CHAT_OPEN = true;

// HIS SWITCHES, ONE PER SERVICE (Eric, 2026-10-17: "My services are off. How
// do I toggle them back on in app?"). Priority Chat, the Advocacy Case and
// Full-Service each have an on or off row in his settings, kept in
// config/sales. The two lines above are only what a service is when he has
// never touched its row, or when the row cannot be read.
export const SERVICES = ['chat', 'case', 'full'];

/** The switches off a stored doc, each one filled from the lines above when unset. Pure. */
export function switchesFrom(d) {
  const pick = (k, dflt) => (typeof d?.[k] === 'boolean' ? d[k] : dflt);
  return { chat: pick('chat', CHAT_OPEN), case: pick('case', SALES_OPEN), full: pick('full', SALES_OPEN) };
}

/** What a page knows right now: the defaults until loadSales() has asked the Worker. */
export const live = switchesFrom(null);

let asked = null;
/**
 * Ask the Worker once per page (GET /api/sales) and keep the answer in
 * `live`. A page that cannot ask keeps the defaults; the Worker's gate is the
 * one that counts either way. Never called by the Worker itself.
 */
export function loadSales() {
  if (!asked) {
    const ask = fetch('/api/sales', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) Object.assign(live, switchesFrom(d)); return live; })
      .catch(() => live);
    // A page never waits more than three seconds on it.
    asked = Promise.race([ask, new Promise((done) => { setTimeout(() => done(live), 3000); })]);
  }
  return asked;
}

/** Whether a package can be bought right now, by its own switch (after loadSales). */
export function packageOpen(pkg) {
  return live[pkg] === true;
}

export const SALES_CLOSED_MESSAGE = "I'm not currently offering this. Join the waitlist on the home page and I'll get back to you soon.";
