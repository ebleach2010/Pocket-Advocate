// SALES, ONE SWITCH (Eric, 2026-10-12: "Stop sales everywhere." And, for
// later: "/open means open up all packages, remove the banner saying I'm
// sick. But leave the waitlist button for if my schedule is blocked off.")
//
// While this is false, worker/index.js refuses every route that starts a
// purchase (SALES_ROUTES there), whatever the page says; that is the gate.
// Book, subscribe and services load sales-closed.js, which says so and
// offers the waitlist instead. Pure data: the Worker imports this file, so
// nothing here may touch a page.
export const SALES_OPEN = false;

export const SALES_CLOSED_MESSAGE = "I'm not currently offering this. Join the waitlist on the home page and I'll get back to you soon.";
