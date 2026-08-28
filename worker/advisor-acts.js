// What the advisor is allowed to ASK FOR, and what it can never ask for.
//
// Eric, 2026-08-27, in his own words:
//
//   "Have the advisor have authority over settings in the app. Such as 'set
//    the total price paid by this client to 3500' or 'notify client that
//    there's a form he needs to fill out'. Things that make sense within the
//    app but don't explicitly build things."
//
// and, asked which of these should stop and ask him first:
//
//   "Tap to confirm the ones that matter."
//
// THE ADVISOR PROPOSES. IT DOES NOT EXECUTE. Nothing in this file runs
// anything. The model names an action and its arguments; this module checks
// that name against a fixed table and those arguments against fixed bounds;
// the Worker parks the result as a proposal on the advisor state document; and
// the panel either shows Eric a card to tap or, for a reversible desk setting,
// calls the ordinary admin route straight away. Either way the thing that
// actually writes is the route that already existed, with every guard,
// validation and bound it already had. A bad model turn cannot do anything by
// itself, because there is no path from a model turn to a write.
//
// THE TWO TIERS, which are his answer above turned into code:
//
//   CONFIRM  anything touching money, and anything a client sees or is sent.
//            A card, showing what it would do, and nothing happens until he
//            taps it.
//   DESK     reversible settings on his own desk that no client is told
//            about: in or out of office, the response line, whether the books
//            are open, how many tier cases he carries, and a plain clock
//            start or stop. These happen on his instruction with no card,
//            because a card for "I'm back" is a card he stops reading. Still
//            validated here AND by the route, exactly as if he had typed it.
//
// WHY BOTH HALVES CHECK. This module is the first gate and the route is the
// second. Neither is allowed to trust the other: the route is reachable from
// his own browser without the advisor at all, and this module is reachable by
// a model that has just been handed a client's medical records and asked to
// think about them. Two independent gates on the same value is the point.

/** Anything a client sees, and anything that is money. A card, and a tap. */
export const CONFIRM = 'confirm';
/** Reversible, his desk only, nobody told. Happens on his instruction. */
export const DESK = 'desk';

/**
 * How the panel carries an allowed act out.
 *
 *   'route'  call the ordinary admin route, with his own admin token.
 *   'draft'  hand it to the draft flow that already exists. The draft card IS
 *            the confirm card: he edits it, he taps Send, and only then does
 *            anything reach the client. This is why "tell him there's a form
 *            to fill in" needs no new path to a client at all.
 */
const ROUTE = 'route';
// The fourth destination, and the only one that is not an HTTP call. The form
// sender is a function inside admin-case.js, not a route: it builds the blank
// document in the browser and uploads it straight to Storage with the client
// SDK, so there is nothing for the panel to POST to. advisor.js cannot import
// from admin-case.js (they are separate entry points on the same page), so the
// two speak through a DOM event whose contract is written out at 'send-forms'
// below. Agreed between two branches that could not see each other's code.
const PAGE = 'page';
const DRAFT = 'draft';

/**
 * THE URGENT NOTIFICATION. Bounded here, and this bound is the whole safety
 * of it. See handleClientAlert in worker/index.js for why the guardrail on
 * caller-supplied notification text was moved for this one route and by whom.
 */
export const ALERT_MAX_CHARS = 140;

/**
 * A client's push notification is the only thing here whose text a person
 * writes rather than picks. It is a SENTENCE, not markup, on every surface it
 * touches, and the cheapest way to keep that true forever is to refuse the
 * characters that make markup at the door. A real sentence he would send has
 * no angle brackets in it, so nothing legitimate is lost.
 */
const MARKUP = /[<>]/;

/** One line, flattened, the same treatment the upload file name already gets. */
function flat(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

/** Money, as he says it: dollars. Cents are the wire format, never the ask. */
function dollarsToCents(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const cents = Math.round(v * 100);
  // The same bound the route enforces, to the cent: $1 to $100,000.
  if (!Number.isInteger(cents) || cents < 100 || cents > 100_000_00) return null;
  return cents;
}

function money(cents) {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: cents % 100 ? 2 : 0,
  })}`;
}

/**
 * THE ALLOWLIST. Every entry names a route that already exists and already
 * validates what it is given; nothing here invents a new way to write.
 *
 * `scoped`  true if the act belongs to one case, which is how the panel knows
 *           whether to put a caseId on the body.
 * `check`   returns { args, summary } or a plain-English refusal string. It
 *           never throws and never half-accepts: an act is fully valid or it
 *           is refused with a sentence Eric could read.
 */
const ACTS = {
  // ---- money ------------------------------------------------------------
  // CONFIRM, because it is money and because it is instantly live on the
  // client's own case page. The card shows BOTH figures, what the case reads
  // now and what it would read, because "set it to 3500" and "set it to
  // 35000" are one keystroke apart and only the card can tell them apart.
  'set-paid': {
    tier: CONFIRM, via: ROUTE, scoped: true,
    path: '/api/admin/case-update',
    describe: 'Record what this client has paid for the case',
    schema: {
      type: 'object',
      properties: {
        dollars: {
          type: 'number',
          description: 'The whole of what this client has paid for the case, in DOLLARS. 3500 means three thousand five hundred dollars.',
        },
      },
      required: ['dollars'],
    },
    check(raw) {
      const cents = dollarsToCents(raw?.dollars);
      if (cents === null) return 'Give an amount between $1 and $100,000.';
      return {
        args: { action: 'set-paid', paidCents: cents, by: 'advisor' },
        // The card fills in what it reads NOW; only the Worker knows that.
        summary: `Record that this client has paid ${money(cents)} for the case.`,
        amountCents: cents,
      };
    },
  },

  // ---- the desk ---------------------------------------------------------
  // DESK, all four. Reversible in one tap, no client is told, and a card in
  // front of "I'm out for an hour" is a card he learns to dismiss without
  // reading, which is worse than no card at all.
  'office-hours': {
    tier: DESK, via: ROUTE, scoped: false,
    path: '/api/admin/office-hours',
    describe: 'Show yourself in or out of office, or set the response time line',
    schema: {
      type: 'object',
      properties: {
        manual: {
          type: ['string', 'null'],
          enum: ['in', 'out', null],
          description: "'in' or 'out' to override the schedule, null to follow it again.",
        },
        responseTime: {
          type: ['string', 'null'],
          description: 'The response line clients read, e.g. "usually within a few hours". null removes it.',
        },
      },
    },
    check(raw) {
      const out = {};
      const has = (k) => raw && Object.prototype.hasOwnProperty.call(raw, k);
      if (has('manual')) {
        const m = raw.manual;
        if (m !== 'in' && m !== 'out' && m !== null)
          return "Set 'in', 'out', or null to follow the schedule.";
        out.manual = m;
      }
      if (has('responseTime')) {
        const r = raw.responseTime;
        if (r !== null && typeof r !== 'string')
          return 'A response time is a line of text, or null to remove it.';
        const typed = flat(r);
        // A client reads this line. Markup in it is markup on their screen.
        if (MARKUP.test(typed)) return 'A response line is a sentence, not markup.';
        if (typed.length > 160) return 'Keep the response line under 160 characters.';
        out.responseTime = typed || null;
      }
      if (!Object.keys(out).length) return 'Say whether you are in or out, or give a response line.';
      const bits = [];
      if (out.manual === 'in') bits.push('show you IN the office');
      if (out.manual === 'out') bits.push('show you OUT of the office');
      if (out.manual === null) bits.push('follow your normal schedule again');
      if (out.responseTime) bits.push(`say "${out.responseTime}"`);
      else if (out.responseTime === null && has('responseTime')) bits.push('promise no response time');
      return { args: out, summary: `Your door sign will ${bits.join(' and ')}.` };
    },
  },

  'booking-closure': {
    tier: DESK, via: ROUTE, scoped: false,
    path: '/api/admin/booking-closure',
    describe: 'Close the books to new cases for a number of weeks, or reopen them',
    schema: {
      type: 'object',
      properties: {
        weeks: { type: 'integer', description: 'Whole weeks to stay closed, 0 to 26. 0 reopens now.' },
      },
      required: ['weeks'],
    },
    check(raw) {
      const w = typeof raw?.weeks === 'number' ? raw.weeks : Number.NaN;
      if (!Number.isInteger(w) || w < 0 || w > 26) return 'Pick between 0 and 26 weeks.';
      return {
        args: { weeks: w },
        summary: w === 0
          ? 'Open the books to new cases again, starting now.'
          : `Close the books to new cases for ${w} week${w === 1 ? '' : 's'}.`,
      };
    },
  },

  'full-capacity': {
    tier: DESK, via: ROUTE, scoped: false,
    path: '/api/admin/full-capacity',
    describe: 'Set how many Hands-Off cases you carry at once',
    schema: {
      type: 'object',
      properties: {
        maxOpen: { type: 'integer', description: 'How many at once, 1 to 99. 0 means no limit.' },
      },
      required: ['maxOpen'],
    },
    check(raw) {
      const n = typeof raw?.maxOpen === 'number' ? raw.maxOpen : Number.NaN;
      if (!Number.isInteger(n) || n < 0 || n > 99)
        return 'Pick a whole number from 1 to 99, or no limit.';
      return {
        args: { maxOpen: n },
        summary: n === 0
          ? 'Carry as many Hands-Off cases at once as come in, with no limit.'
          : `Carry at most ${n} Hands-Off case${n === 1 ? '' : 's'} at once.`,
      };
    },
  },

  // ---- the work clock ---------------------------------------------------
  // Split in two on purpose. A plain start or stop is a toggle he can undo
  // with the same toggle, so it is DESK. Correcting the total MOVES A NUMBER
  // THE CLIENT CAN SEE on their own case page, so it is CONFIRM, and the card
  // shows both figures for the same reason set-paid's does.
  'work-clock': {
    tier: DESK, via: ROUTE, scoped: true,
    path: '/api/work',
    describe: 'Start or stop the work clock on this case',
    schema: {
      type: 'object',
      properties: { on: { type: 'boolean', description: 'true starts the clock, false stops it.' } },
      required: ['on'],
    },
    check(raw) {
      if (typeof raw?.on !== 'boolean') return 'Say whether the clock goes on or off.';
      return {
        args: { on: raw.on },
        summary: raw.on ? 'Start the work clock on this case.' : 'Stop the work clock on this case.',
      };
    },
  },

  'work-correct': {
    tier: CONFIRM, via: ROUTE, scoped: true,
    path: '/api/work',
    describe: 'Correct the total hours recorded on this case',
    schema: {
      type: 'object',
      properties: {
        hours: { type: 'number', description: 'The TOTAL hours the case should read, not a change to it.' },
      },
      required: ['hours'],
    },
    check(raw) {
      const h = typeof raw?.hours === 'number' ? raw.hours : Number.NaN;
      // The route's own bound, in the unit he thinks in: 4000 hours.
      if (!Number.isFinite(h) || h < 0 || h > 4000)
        return 'Give a total between 0 and 4000 hours.';
      const seconds = Math.round(h * 3600);
      return {
        args: { setSeconds: seconds },
        summary: `Correct the recorded work on this case to ${h.toLocaleString('en-US', { maximumFractionDigits: 2 })} hours.`,
        seconds,
      };
    },
  },

  // ---- a message to a client -------------------------------------------
  // CONFIRM, and the confirm card is the DRAFT CARD THAT ALREADY EXISTS. This
  // act writes a draft and stops. He reads it, edits it, taps Send, and only
  // his tap puts anything in front of a client. That machinery is complete and
  // durable already, so "tell him there's a form he needs to fill out" needs
  // no new path to a client, and that is exactly the point.
  'client-message': {
    tier: CONFIRM, via: DRAFT, scoped: true,
    path: '/api/advisor',
    describe: 'Draft a chat message to this client for you to read and send',
    schema: {
      type: 'object',
      properties: {
        instruction: { type: 'string', description: 'What the message should say, in a sentence.' },
      },
      required: ['instruction'],
    },
    check(raw) {
      // A string, not something String() will politely turn into one: a number
      // that arrives where a sentence was meant is a model turn that went
      // wrong, and "42" is not an instruction.
      if (typeof raw?.instruction !== 'string') return 'Say what the message should tell them.';
      const inst = flat(raw.instruction);
      if (!inst) return 'Say what the message should tell them.';
      if (inst.length > 1000) return 'Keep the instruction under 1000 characters.';
      return {
        args: { action: 'draft', instruction: inst },
        summary: `Write a message to this client: ${inst}`,
      };
    },
  },

  // ---- the urgent notification -----------------------------------------
  // Eric asked for this one in his own words, and asked for it to carry HIS
  // words: "special notifications. Such as 'send an urgent notification that
  // the client has a time sensitive form to fill out'."
  //
  // CONFIRM, obviously and without exception: it buzzes a phone. The card
  // shows the EXACT sentence the client will read, character for character,
  // before anything sends.
  'client-alert': {
    tier: CONFIRM, via: ROUTE, scoped: true,
    path: '/api/admin/client-alert',
    describe: 'Send this client an urgent push notification, in words you approve first',
    schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: `The one sentence the client will read on their phone, ${ALERT_MAX_CHARS} characters at most. Plain words only.`,
        },
      },
      required: ['text'],
    },
    check(raw) {
      if (typeof raw?.text !== 'string') return 'An alert is a sentence.';
      const text = flat(raw.text);
      if (!text) return 'Say what the notification should tell them.';
      if (MARKUP.test(text)) return 'A notification is a sentence, not markup.';
      if (text.length > ALERT_MAX_CHARS)
        return `Keep it under ${ALERT_MAX_CHARS} characters. A phone shows about two lines.`;
      return { args: { text }, summary: text, alertText: text };
    },
  },

  // ---- THE SEAM: sending the hands-off forms ----------------------------
  // Eric, 2026-08-27: "This is another example of what the advisor could do:
  // 'send the hands-off forms to the client'."
  //
  // TODO(claude/pocketai-webhooks-triggers-a96dea-forms): the form sender is
  // being built on that branch and does not exist here. The id is reserved and
  // the tier is already decided (CONFIRM: a client is sent something), so
  // wiring it up after that branch merges is: set enabled true, finish `check`
  // against the argument that branch takes, and give it a way to be carried
  // out.
  //
  // THAT LAST PART IS THE ONE THING THAT IS NOT LIKE THE OTHERS, and it is
  // worth knowing before anybody starts. Confirmed with that branch: the send
  // is `sendBlankForms(kinds)`, a module-scope function in
  // public/js/admin-case.js, NOT a Worker route. It writes to Storage from the
  // page and then calls the EXISTING /api/admin/case-update `summary-uploaded`
  // with category 'formsent', once per form. `kinds` is an array of ids taken
  // from a const SENDABLE_FORMS in that file; unknown ids are filtered out, so
  // a proposal naming a form that does not exist fails safe. It is deliberately
  // resendable, so do NOT add an "already sent?" check on this side either.
  //
  // Every other act here carries a `path` and the panel POSTs to it. A page
  // function is a different animal and public/js/advisor.js cannot import from
  // admin-case.js, so this one wants a fourth `via`, 'page', dispatched as a
  // DOM CustomEvent the way pa-panel-review and pa-mark-done already pass
  // between those two modules. `path` stays null for that reason.
  //
  // The event contract, agreed with that branch so nobody has to guess it
  // later. admin-case.js listens and puts the PROMISE back on the detail
  // SYNCHRONOUSLY:
  //
  //   document.addEventListener('pa-send-forms', (e) => {
  //     if (!e.detail) return;
  //     e.detail.result = sendBlankForms(e.detail.kinds);
  //   });
  //
  // and the panel dispatches and then reads it back:
  //
  //   const detail = { kinds: ['records', 'representative'], result: null };
  //   document.dispatchEvent(new CustomEvent('pa-send-forms', { detail }));
  //   if (!detail.result) throw new Error('The form sender is not on this page.');
  //   const { sent, quiet } = await detail.result;
  //
  // A null `result` after the dispatch means admin-case.js is not on this page,
  // which is a different thing from a send that failed and has to say so
  // differently. A rejection is a real failure and carries `sent` and `quiet`
  // on the Error, so a card can say which forms landed even while it says it
  // did not finish. The forms are deliberately RESENDABLE, so no once-only
  // guard goes on this side either.
  //
  // `enabled: false` means validate() REFUSES it today rather than parking a
  // proposal nothing can carry out, and the model is never offered the tool at
  // all. A half wired act that shows him a card he cannot tap is worse than
  // no act.
  // WIRED 2026-08-28, once both halves of the seam were in one tree for the
  // first time. Eric named this himself as what he wanted the advisor to do:
  // "send the hands-off forms to the client".
  //
  // CONFIRM tier, and not negotiable: this puts documents on a client's case
  // and buzzes their phone once per form. Resendable by design, so the card
  // never refuses on the grounds that they were sent before; that is his
  // explicit instruction and the form sender carries no guard either.
  'send-forms': {
    enabled: true,
    tier: CONFIRM, via: PAGE, scoped: true,
    path: null,
    event: 'pa-send-forms',
    describe: 'Send the Hands-Off authorisation forms to this client',
    schema: { type: 'object', properties: {} },
    check() {
      // No arguments to validate. WHICH forms is not the model's to choose:
      // the sender owns that list, and a model naming a form that does not
      // exist would be a silent no-op rather than a refusal.
      // The summary is what the card SAYS, so it names both forms and the
      // fact that they are blanks to sign, not something already filled in.
      // A2 caught this missing on the first pass, which would have put an
      // empty card in front of him.
      return {
        ok: true,
        args: {},
        kinds: ['records', 'representative'],
        summary: 'Send this client the records authorisation and the insurance '
          + 'representative form, blank and ready to sign.',
      };
    },
  },
};

/**
 * THE DENYLIST. Never proposable, whatever the model says, and checked BEFORE
 * the allowlist so that adding one of these names to ACTS by accident still
 * refuses. Each one is here for a reason that is not a matter of taste:
 */
const DENIED = {
  // No reopen route exists. Closing is one way and the client reads the
  // reason, so it belongs to him and to the Pause / close card.
  close: 'Closing a case is yours to do, on the card that asks for the reason the client reads. There is no way to undo it.',
  'close-case': 'Closing a case is yours to do, on the card that asks for the reason the client reads. There is no way to undo it.',
  // Gone is gone.
  'delete-file': 'Deleting a file cannot be undone, so it stays your hand only.',
  // No off switch: nothing in the app can take a case back off the tier.
  'open-full': 'Opening Hands-Off has no off switch, so it stays your hand only.',
  // Marks the case delivered, which starts an irreversible 48 hour clock.
  'report-uploaded': 'Marking the report delivered starts the client\'s 48 hours and cannot be taken back.',
  // CLAUDE.md, standing: prices only change on Eric's explicit word.
  'set-rates': 'Prices change on your word alone, typed by you, never proposed.',
  rates: 'Prices change on your word alone, typed by you, never proposed.',
  price: 'Prices change on your word alone, typed by you, never proposed.',
  // The authorisation and the representative designation are the CLIENT's
  // signature. worker/index.js refuses an admin outright on both, and that
  // refusal is not negotiable: a signature nobody can prove the client made is
  // a defective authorisation, which is weeks lost at a records department.
  sign: 'A client signs their own forms. Nothing on your side can sign or revoke for them.',
  'sign-authority': 'A client signs their own forms. Nothing on your side can sign or revoke for them.',
  revoke: 'A client revokes their own forms. Nothing on your side can sign or revoke for them.',
  'revoke-authority': 'A client revokes their own forms. Nothing on your side can sign or revoke for them.',
};

/** Names the model may use, in the order they are offered. */
export const ALLOWED = Object.keys(ACTS).filter((k) => ACTS[k].enabled !== false);
/** Names that are refused on sight, however perfectly they are spelled. */
export const DENYLIST = Object.keys(DENIED);

/**
 * A name in both tables would be a table that contradicts itself, and the one
 * reading that must win is the refusal. It cannot happen while both objects
 * are literals in this file, so this is a guard against the day somebody adds
 * to one without reading the other.
 */
export function tablesDisagree() {
  return Object.keys(ACTS).filter((k) => k in DENIED);
}

/** The tier an allowed act sits in, or null if it is not an allowed act. */
export function tierOf(name) {
  const act = ACTS[name];
  return act && act.enabled !== false ? act.tier : null;
}

/**
 * THE ONE QUESTION THE PANEL ASKS. Pure, so it can be lifted and run over
 * every act in the table at once, which is how "a money change can never
 * happen without a card" stops being a promise and becomes a check.
 *
 *   'run'    carry it out now, no card (DESK only, ever)
 *   'card'   show him a card and wait for a tap
 *   'draft'  hand it to the draft flow; the draft card is the confirm
 */
export function dispatchFor(act) {
  if (!act || typeof act !== 'object') return 'card';
  if (act.via === DRAFT) return DRAFT;
  return act.tier === DESK ? 'run' : 'card';
}

/**
 * Name plus arguments in, a parked proposal or a refusal out. Nothing is
 * executed, nothing is written, and nothing here can reach the network.
 *
 * The refusal is always a sentence Eric could read, because he is the one who
 * reads it: the panel prints it where the card would have gone.
 */
export function validateAction(name, rawArgs) {
  const id = typeof name === 'string' ? name.trim() : '';
  if (!id) return { ok: false, error: 'That was not an action I know.' };
  // DENIED FIRST, always. A name in the denylist is refused before the
  // allowlist is even consulted, so the two tables can never race.
  if (Object.prototype.hasOwnProperty.call(DENIED, id))
    return { ok: false, denied: true, error: DENIED[id] };
  const act = Object.prototype.hasOwnProperty.call(ACTS, id) ? ACTS[id] : null;
  if (!act) return { ok: false, error: 'That was not an action I know.' };
  if (act.enabled === false) {
    const why = act.check();
    return { ok: false, error: typeof why === 'string' ? why : 'That is not wired up yet.' };
  }
  const out = act.check(rawArgs && typeof rawArgs === 'object' ? rawArgs : {});
  if (typeof out === 'string') return { ok: false, error: out };
  if (!out || typeof out !== 'object') return { ok: false, error: 'That was not an action I know.' };
  return {
    ok: true,
    name: id,
    tier: act.tier,
    via: act.via,
    scoped: !!act.scoped,
    path: act.path,
    args: out.args,
    summary: out.summary,
    // Extras the card needs to show a before and an after. Present only on the
    // acts that move a number the client can see.
    ...(out.amountCents !== undefined ? { amountCents: out.amountCents } : {}),
    ...(out.seconds !== undefined ? { seconds: out.seconds } : {}),
    ...(out.alertText !== undefined ? { alertText: out.alertText } : {}),
    // For a `via: PAGE` act there is no route to POST to, so the panel needs
    // the event name and whatever the act decided to hand the page. Both come
    // off this module's own tables, never off the model.
    ...(act.event ? { event: act.event } : {}),
    ...(out.kinds !== undefined ? { kinds: out.kinds } : {}),
  };
}

/**
 * The tool definitions handed to the model, built FROM the same table, so a
 * tool it can see and an action this module will accept are the same list by
 * construction. A disabled act is never offered.
 */
export function actionTools() {
  return ALLOWED.map((name) => ({
    name,
    description: ACTS[name].describe,
    input_schema: ACTS[name].schema,
  }));
}

/** Money, formatted the way the cards say it. Exported so one file owns it. */
export { money };
