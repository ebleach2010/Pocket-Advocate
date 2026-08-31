// What changed, and who is told about it.
//
// Every merge to main is a version. The client sees a card on next open, App
// Store style: the version, then a short bullet list of what actually changed
// for them. Eric sees the same card with the admin work included.
//
// Two rules that keep this honest rather than noisy:
//
//   Only client-visible changes appear in the client's list. Work that never
//   reaches their screen is not news to them; what they need is that their
//   documents now show as thumbnails, and where those thumbnails are.
//
//   Every entry says what changed AND where to find it if the UI moved. "The
//   chat and your files are easier to move between" is half a sentence; "tap
//   the tabs at the top of your case" is the other half, and it is the half
//   that stops a change from feeling like something went missing.

export const VERSION = '2.72';

/**
 * Newest first.
 *
 * This file is loaded by every page, so anything written here is readable by
 * anyone who opens devtools. Nothing goes in it that is not meant for the
 * person reading it.
 *
 * A version with an empty list never shows a card at all.
 *
 * ERIC'S VERSIONING RULE (2026-08-21, his words condensed): every push to
 * main is a version, even when it is not loudly announced. Each push bumps
 * VERSION here (and the worker's copy for /api/version), and the NEWEST
 * entry's `client` list is REPLACED with that push's changes - what was
 * added CLIENT SIDE ONLY, plus bug fixes. Never anything from his side.
 * `quiet: true` means footer-only: the version and its notes show behind
 * the small "Version notes" button at the bottom of the page (client and
 * admin alike), but no update card and no tour ever open for it. A loud
 * release omits `quiet` and may carry a `tour`; only Eric calls for one of
 * those.
 *
 * His two commands (verbatim, 2026-08-21): "push as full update" = a loud
 * entry, existing clients get the update card with bullet points. "push as
 * silent update" = a quiet entry, footer only, and anything NEW clients
 * need to know goes into the onboarding tutorial instead, replacing old
 * copy there if necessary. An unspecified push is silent.
 *
 * ERIC'S SCOPE RULE (2026-08-23, from a screenshot of the notes window):
 * client-readable notes never describe admin-side machinery, however it is
 * worded. A push whose changes are admin-only keeps an EMPTY client list,
 * and the footer (version-note.js) keeps showing the newest version that
 * actually changed something for clients, so the number and the notes a
 * client sees only move when their app does.
 */
export const CHANGELOG = [
  {
    // THE CLOCK IN THE ROOM (Eric, 2026-08-31: a three-day-old fax called
    // "day 10" on the Read page). No prompt carried today's date; now every
    // one ends with the date on his clock and a computed-or-silent rule for
    // elapsed time. His side only.
    version: '2.72',
    quiet: true,
    client: [],
  },
  {
    // MILESTONES AND THE TIDY UPLOADS (Eric, 2026-08-30). A milestones feed
    // beside the work log, both tabs under Act on every case now; the
    // uploads page keeps one day on screen with a search box that pulls
    // matches from every day at once, pins riding on top. His side only.
    version: '2.71',
    quiet: true,
    client: [],
  },
  {
    // CLEARING THE CALENDAR (Eric, 2026-08-30: "Clear my calendar of any
    // open slots. Also, make a button to clear the entire calendar, as well
    // as a small x by the day."). A one-shot sweep took every open slot off
    // the live calendar; the editor gained a clear-everything button and a
    // small x on each day, both fenced to open slots only. His side only.
    version: '2.70',
    quiet: true,
    client: [],
  },
  {
    // HIS STORY (Eric, 2026-08-30: "There needs an 'about your advocate'
    // page on the landing page with this photo and copy"). New public page
    // at /advocate.html carrying his photo and his copy word for word,
    // reachable from the landing page portrait, the About page, and the
    // site footer.
    version: '2.69',
    client: [
      'New page: About your advocate. The story of why this service exists, in Eric\u2019s own words, with his face on it. Find it from the front page or the site footer under Meet your advocate.',
    ],
  },
  {
    // THE RENAME (Eric, 2026-08-30, after a second read of his advert:
    // "'hands-off' reads like you aren't doing much, which is basically the
    // opposite of the entire post"). One hundred twenty-three mentions across
    // seventeen files; the stored field names stay what they were, his own
    // quoted words in old comments stay his, and the old name survives only
    // in these release notes as history.
    version: '2.68',
    client: [
      'Hands-Off Case Management is now called Full-Service Case Management. Same service, same promises, a name that says what it is.',
    ],
  },
  {
    // Two star reports within the hour (Eric, 2026-08-30): pinning several
    // files could look refused, because the slow real listing let an OLDER
    // repaint land last over a newer star, and the client's saved shelf wore
    // a star its route refuses by design; and the boxed outline glyph should
    // just be the emoji. Repaints are generation-stamped now, the tapped
    // star flips instantly, the saved shelf carries no star, and the glyph
    // is a bare emoji, faded until pinned. His side only.
    version: '2.67',
    quiet: true,
    client: [],
  },
  {
    // The star grew a button the same day it was born (Eric, 2026-08-30:
    // "There should be a star button next to each upload that's just an
    // outline... It's not a long press, that causes issues"), and the pin
    // order became the order he starred them. His side's control; the
    // client's pinned block just keeps his chosen order, nothing new to say.
    version: '2.66',
    quiet: true,
    client: [],
  },
  {
    // Two asks (Eric, 2026-08-30): the full-message maker moved onto the
    // chat composer where he types ("So it should be on the chat page"),
    // and files can be starred to pin them to the top of both file lists
    // ("They're priority, like forms the client needs to fill out"). The
    // client sees the pin on their Documents, so one line.
    version: '2.65',
    quiet: true,
    client: [
      'Files your advocate marks as priority now sit pinned at the top of your Documents, under a heading that says they need your attention.',
    ],
  },
  {
    // Four asks in one message (Eric, 2026-08-30): the work log and the
    // uploads shelf on his side now show one day per page with Older and
    // Newer controls, the upload form moved above the shelf, and a drafted
    // message is built from HIS instruction alone, with the whole document
    // shelf visible by name so anything he references resolves. All on his
    // side of the desk; nothing on a client page moved.
    version: '2.64',
    quiet: true,
    client: [],
  },
  {
    // The chat resume net (Eric, 2026-08-29: "Got notification for chat but
    // no new message was there"): a phone coming back from the background
    // can sit on a frozen live stream, and tapping a notification is exactly
    // that move. Every return to the foreground now forces one fresh read of
    // the thread through the same painter, which also shoves the stream back
    // to life.
    version: '2.63',
    quiet: true,
    client: [
      'The chat now catches up the moment you come back to the app, so a notification never beats its message to your screen.',
    ],
  },
  {
    // The 7:31 AM bug (Eric, 2026-08-29: "This time is incorrect. I drafted
    // it at 1:31PM"): the log form's time picker hands over a string with no
    // time zone on it, and the server's own clock reads it six hours wrong.
    // The page now sends a real instant, the server reads a bare string as
    // Mountain wall time, and a one-shot pass moves every already-saved
    // entry back onto the clock it was typed from.
    version: '2.62',
    quiet: true,
    client: [
      'The times on the work log on your case page now read correctly in your time zone.',
    ],
  },
  {
    // The voice fix (Eric, 2026-08-29, on his side of the desk): the draft
    // writer now treats his own verbatim messages as the styling authority,
    // borrows his messages from every thread when the current one holds
    // little of him, and reads the client's newest messages for where they
    // are right now before writing a word. Nothing client-visible changed
    // in the app itself, so the client list stays empty.
    version: '2.61',
    quiet: true,
    client: [],
  },
  {
    // One reworded comment, in THIS file: the entry below named his side's
    // machinery, and a client's browser downloads this file. Nothing ever
    // rendered the word, but the blindness audit reads served bytes and
    // flagged it, which is the audit doing its job. Nothing else moved.
    version: '2.60',
    quiet: true,
    client: [],
  },
  {
    // Three log asks (Eric, 2026-08-29): what he logs now feeds the case
    // notes on his side of the desk, both log views read day by day, and
    // the whole log exports as a CSV with the clock's three figures.
    version: '2.59',
    quiet: true,
    client: [
      'The work log on your case page now reads day by day, with a dated heading wherever the date changes, instead of one long list.',
    ],
  },
  {
    // Cleanup: the reprice diag comes off /api/version now the $3,500 is
    // stored; the cron heartbeat readout stays. Admin plumbing only.
    version: '2.58',
    quiet: true,
    client: [],
  },
  {
    // The cron watchdog (found live 2026-08-28: the scheduled trigger went
    // silent for over an hour). Any API request now checks the heartbeat
    // and, when it is five minutes stale, claims it and runs the
    // rung-guarded safety ladders: the clock nudges, the appeal warnings,
    // the follow-up warnings. Admin plumbing; nothing client-visible.
    version: '2.57',
    quiet: true,
    client: [],
  },
  {
    // Diagnostic push 2: /api/version also reports the cron heartbeat and
    // runs the reprice one-shot itself, so a dead cron cannot block it.
    version: '2.56',
    quiet: true,
    client: [],
  },
  {
    // Diagnostic push: the $3,500 reprice migration runs on every cron fire
    // until it lands, and its marker is readable on /api/version while it
    // is watched. Admin plumbing only.
    version: '2.55',
    quiet: true,
    client: [],
  },
  {
    // Three on Eric's word, 2026-08-29: Fri-Sun out of office by schedule
    // (his switch still wins), the Hands-Off month at $3,500 with a one-shot
    // migration for the stored rate, and the client-facing hours card with
    // the pacing sentence, front and center on Hands-Off cases.
    version: '2.54',
    quiet: true,
    client: [
      'Hands-Off cases now show your advocacy hours front and center: what is used, what a month includes, and fair warning as the included hours run down.',
      'Standard advocacy hours are now Monday to Thursday, 8:00 AM to 7:00 PM Mountain Time. My live status still shows when I am in outside those hours.',
    ],
  },
  {
    // Two clocks for two tiers and the flat month (Eric, 2026-08-29). The
    // work clock resets when a case goes Hands-Off (review hours kept
    // behind work.tierMark), the upgrade price is the full month with no
    // case-fee credit, and Hands-Off governs from the flip even before the
    // report lands.
    version: '2.53',
    quiet: true,
    client: [
      'If your case moves to Hands-Off Case Management, the worked-hours figure on your case page starts fresh for it, and your case review hours are shown on their own line.',
    ],
  },
  {
    // The hours envelopes (Eric, 2026-08-29, adopting the framing he was
    // advised to use): Hands-Off months are up to 20-22 hours of
    // comprehensive advocacy with priority access throughout, extra
    // casework at $175 to $225 an hour agreed in advance; the Advocacy Case
    // is 5-6 hours of research and reporting. Copy and agreements only; no
    // price changed.
    version: '2.52',
    quiet: true,
    client: [
      'The service descriptions now spell out the time behind each service: 5-6 hours of research and reporting in an Advocacy Case, and up to 20-22 hours of advocacy in each Hands-Off month.',
    ],
  },
  {
    // Today's hours under every total (Eric, 2026-08-29: "a daily hours/min
    // logged for the day for a running clock, seen next to the total. Only
    // seen on my side."). Admin-only by storage AND by paint; the client
    // list stays empty.
    version: '2.51',
    quiet: true,
    client: [],
  },
  {
    // The work switch (Eric, 2026-08-29: "I want a toggle-able pill like a
    // light switch"). The long-press menu on the case folder is gone; the
    // clock is a switch on the card now. Admin-only, nothing changes on the
    // client's screen, so the client list stays empty.
    version: '2.50',
    quiet: true,
    client: [],
  },
  {
    // The colour slider for his activity types (Eric, 2026-08-29: "Would
    // like a color wheel/slider for choosing new color for a category.").
    // Quiet; admin control, client sees only nicer pills.
    version: '2.49',
    quiet: true,
    client: [],
  },
  {
    // His own work-log activity types (Eric, 2026-08-29: "I want to add
    // 'email' for example... I can select the highlight color."). Quiet.
    version: '2.48',
    quiet: true,
    client: [
      'The work log on your case page can now show more kinds of work, each with its own colour, so what I have been doing reads at a glance.',
    ],
  },
  {
    // The Daylight restyle lands on main on Eric's word ("Ship it.",
    // 2026-08-29). Quiet, per the unspecified-push rule; he can call for a
    // full update if he wants the card shown.
    version: '2.47',
    quiet: true,
    client: [
      'Pocket Advocate has a new look, drawn from our logo: powder blue in the day, deep navy after dark. Everything on your case works exactly as it did.',
      'When my office is closed, the app rests in its night colors until I am back. Your own choice of look in Settings always wins, and you can change it there any time.',
    ],
  },
  {
    // Nothing is signed in the app any more (Eric, 2026-08-29: "Do NOT send
    // him any forms whatsoever... Keep that my side, not his."). Quiet.
    version: '2.46',
    quiet: true,
    client: [
      'Your case page no longer asks you to sign anything. Every document comes to you from your advocate directly, and your case page simply shows when your signed forms are back with him.',
    ],
  },
  {
    // The contact tick on the scope of work agreement (Eric, 2026-08-29:
    // "he agrees I can contact him via phone by text or phone call...
    // non-urgent messages should be used in the app chat portal"). Quiet.
    version: '2.45',
    quiet: true,
    client: [
      'Your scope of work agreement now includes a contact line: you tick it to say I may call or text you about your case, and anything not urgent stays in your case chat.',
    ],
  },
  {
    // One document signed in the app now: the scope of work agreement, on
    // Hands-Off cases opened by hand (Eric, 2026-08-29: "All I need is scope
    // of work agreement. The rest I handle."). Quiet, per the rule above.
    version: '2.44',
    quiet: true,
    client: [
      'If your case is on Hands-Off Case Management, your scope of work agreement lives on your case page: read it and sign it there, and read it back any time.',
    ],
  },
  {
    // The agreement catches up with the truth (Eric, 2026-08-28: "I do my
    // very best and there is no limit... refunds happen under agreement").
    // Quiet, per the rule above; the client list carries it because the
    // words of the agreement are the client's to read.
    version: '2.43',
    quiet: true,
    client: [
      'The Hands-Off agreement no longer caps the number of insurance appeals I write. It now says what was always true: I write as many as your case needs, and I do not count them any more than I count calls.',
      'The agreement now says plainly that refunds are settled between us, person to person, rather than triggered by a clause on their own.',
      'It is also more honest about time: a difficult case rarely resolves in a month or two, and what you are buying is acceleration, an easier journey, and as much of what I know as I can hand you.',
    ],
  },
  {
    // Nothing in this release is on the client's side of the glass, so the
    // client list is empty on purpose. version-note.js takes the newest
    // release that has one, so the footer and the notes window both hold at
    // 2.40 until their own app changes again.
    //
    // Quiet, and unspecified: an unspecified push is silent.
    //
    // This comment says what the list holds and no more. THIS FILE IS SERVED
    // TO EVERY PAGE, so the blindness rule covers its comments.
    version: '2.42',
    quiet: true,
    client: [],
  },
  {
    // NOTHING IN THIS RELEASE IS ON THE CLIENT'S SIDE OF THE GLASS, so the
    // client list is empty on purpose rather than by omission. An empty list
    // is the supported shape: version-note.js takes the newest release that
    // has one, so the footer number and the notes window both hold still at
    // 2.40 and move again the next time their own app changes.
    //
    // QUIET, and unspecified: an unspecified push is silent, per the rule
    // above.
    //
    // This comment says what the list holds and no more. THIS FILE IS SERVED
    // TO EVERY PAGE, so its comments are client-readable bytes and the
    // blindness rule covers them; a previous entry failed the audit for
    // explaining what it was leaving out.
    version: '2.41',
    quiet: true,
    client: [],
  },
  {
    // Filing a file, and the two things about it a client can see
    // (Eric, 2026-08-27 and 2026-08-28).
    //
    // 2.39 shipped and reached clients earlier tonight, so this is its own
    // version rather than an edit to that list.
    //
    // QUIET, same as 2.39: he said "push what you build to main since it
    // doesn't affect the client much at all" and never said "push as full
    // update", and an unspecified push is silent.
    //
    // TWO bullets only, and that is deliberate. Almost all of this release is
    // on his side of the glass and none of it is news to a client, per the
    // scope rule above. What IS news is that a file can now change its name,
    // and that a file he has filed as part of the record has stopped being
    // theirs to delete. The second one takes away something they had, which
    // is exactly the kind of change this list exists for.
    //
    // And a note for whoever writes the next entry: THIS FILE IS SERVED TO
    // EVERY PAGE, so its comments are client-readable bytes and the blindness
    // rule covers them. The first draft of this comment listed the admin side
    // work by name to explain why it was being left out, and the audit failed
    // on it: "FAIL /js/changelog.js - 1 forbidden match". Say what belongs in
    // the list, never what was left out of it.
    version: '2.40',
    quiet: true,
    client: [
      'A document I have labelled as part of your case record can no longer be deleted from your side. Anything you uploaded yourself and I have not labelled is still yours to remove.',
      'If I rename a document so it is easier to recognise, the new name is what you see. Nothing about the file itself changes, and any link you already have to it keeps working.',
    ],
  },
  {
    // Office hours, the work log, and what a document is (Eric, 2026-08-27
    // and 2026-08-28).
    //
    // 2.39 sat on the branch while main stayed at 2.38, so it has never
    // reached a client. Rather than bumping past it and leaving a version
    // nobody was ever shown, its client list is REPLACED with the whole of
    // this push, which is what the versioning rule above asks for.
    //
    // QUIET. His words were "push what you build to main since it doesn't
    // affect the client much at all", and an unspecified push is silent. He
    // did not say "push as full update", so no update card opens: the version
    // and these notes sit behind the "Version notes" button in the footer.
    //
    // Client half only, per the scope rule. The settings cog, the case limit,
    // the long press on a case folder and everything else on his side of the
    // glass is deliberately absent.
    version: '2.39',
    quiet: true,
    client: [
      'Your chat now shows whether I am in office or out of office, as a pill above the messages.',
      'New: the small "?" beside that pill answers "When will Eric respond?" It explains my hours, how I decide what to answer first, and what is happening when you have not heard back yet.',
      'The hours in that answer now also show in your own timezone, so you do not have to work out what Mountain time means where you are.',
      'You can always message me outside office hours. I see it when I am back in office.',
      'New: a log of the work I have been doing on your case, by date. It is the fourth tab along the top of your case, beside your documents.',
      'Your documents now carry a label saying what each one is, such as a call summary, an appointment summary, or a form to fill in, and I tell you the file name when a new one lands.',
      'The total you have paid now shows on your case beside the hours I have worked, so the two numbers read against each other properly.',
      'You will hear from me when I start a new kind of work on your case, such as calling your clinics or writing to your insurer. Once when that stretch of work begins, not once for every call.',
      'The forms I need you to sign now come to you from me directly rather than being signed in the app. Any permission you have already given me is still on your case, with View and Withdraw beside it, and you can still withdraw one at any time.',
      'Fixed: the subscriber chat could show a reply time that had never been set. A note about timing now appears only when one has been written.',
      'Fixed: a message or an update from me could arrive on your phone appearing to come from "A client". It says my name now.',
    ],
  },
  {
    // THIS BRANCH'S ENTRY. It sat at 2.36 while the branch was open, and
    // 2.36 and 2.37 shipped to main underneath it, so it moves up rather
    // than colliding with a version a client has already been shown.
    //
    // The reshaped tier (check-ins, $3,500), telehealth appointment
    // advocacy, the Add-ons tab, phone consent at booking, and closure
    // reasons shown to the client. Plus the second build round on this
    // branch: more "Eric is…" status lines in chat, the note-taking clause
    // in the agreement (new bookings only), and the call document. None of
    // it is live for clients until the release that turns the tier on, so
    // the client bullets wait with it and are written at push time.
    //
    // And the third round: the visual pass. The landing page, the three
    // booking steps and the five client case pages were rebuilt to look like
    // the mockup, each on its own sheet layered over site.css, which stays
    // byte-identical to main's. Two things in that pass are behaviour rather
    // than paint and need client bullets of their own at push time: a
    // booking refusal now prints against the control that is blocking and
    // scrolls to it, instead of a message a client had to hunt for; and an
    // enhancement a case cannot use yet says which of the two true things it
    // is, rather than vanishing and quietly changing the shape of the page
    // from one case to the next.
    //
    // THAT VISUAL PASS WAS REVERTED. It rewrote the markup of three pages at
    // once and did not look like what he asked for. What shipped instead is a
    // stylesheet layered after site.css that changes no markup, no copy, no
    // prices and no behaviour, so the two bullets above about the refusal and
    // the unavailable card are NOT in this release and are not listed below.
    //
    // WRITTEN AT PUSH TIME, 2026-08-26, on his word "push to main". He did not
    // say "full update", and an unspecified push is silent, so this stays
    // quiet: footer only, no card, no tour. The list below is his side of the
    // rule: client-visible only, nothing from his own half of the app.
    version: '2.38',
    quiet: true,
    client: [
      'The app has a new look. Everything is where it was, and nothing you had has moved or been removed.',
      'Your case page groups its extras under Case Enhancements. Tap the Enhance tab on your case to see what you can add.',
      'New: appointment advocacy. I can sit in on a telehealth appointment with you. It is on the Enhance tab.',
      'New: Hands Off Case Management, billed a month at a time. You ask for it from your open case and nothing is charged until I accept. If I cannot take it on, you get my reason in writing.',
      'When your case window is running out you can add another month from the Enhance tab rather than starting again.',
      'While your case is open we speak on a regular check in call, so you are never waiting to hear where things stand.',
      'If I close a case, the reason is written on your page rather than the case simply ending.',
      'The price of a follow up session has changed. What you were quoted the day you booked is what you pay, so an open case keeps its own rate.',
    ],
  },
  {
    version: '2.37',
    quiet: true,
    // The status dropdown was refusing Eric on any thread whose newest
    // message was his own, which working a case is most of the time. A
    // status is his working state, not a reaction, so it is now allowed
    // there - and it now notifies the CLIENT rather than whoever wrote the
    // message it hangs on, which on his own message was nobody.
    //
    // A client can therefore start seeing status notes that never arrived
    // before. Under his scope rule (2026-08-23) that is still him telling
    // them what he is doing, not a change to their app, so this stays empty.
    client: [],
  },
  {
    version: '2.36',
    quiet: true,
    // A failed status now says WHY it failed, in the Worker's own words, and
    // two comments that named an admin-only tool are out of the files a
    // client's browser downloads. Nothing on a client's screen moves.
    client: [],
  },
  {
    version: '2.35',
    quiet: true,
    // Selecting text in chat, a held mouse press opening the message menu,
    // tapping a page no longer turning it, and Eric's status dropdown. The
    // one thing a CLIENT can see is more status notes from him - which is
    // him telling them what he is doing, not a change to their app - so
    // under his scope rule (2026-08-23) this list stays empty.
    client: [],
  },
  {
    version: '2.34',
    quiet: true,
    // The work clock gains a correction, and the maintenance window moves to
    // 8PM. Both are Eric's side of the app: the clock correction is a control
    // on his chart, and the window is the front door, which a client who
    // already has a case never meets. A client CAN see the hours total change
    // as a result, but the change itself is admin machinery, so under his
    // scope rule (2026-08-23) this list stays empty.
    client: [],
  },
  {
    version: '2.33',
    quiet: true,
    client: [],
  },
  {
    // The tip jar's removal is client-visible and worth saying: something they
    // could see on their page every visit is simply gone, and silence about
    // that invites "did I break something". The rest of this push is the
    // agreement they tick at booking, which existing clients never see again,
    // and admin machinery.
    //
    // 2.35, not 2.34: while this branch sat unmerged, 2.33 shipped to main as
    // the maintenance window. Everything here moved up one rather than reuse
    // a number a client's app has already seen.
    version: '2.35',
    quiet: true,
    client: [
      'The tip jar is gone from the bottom of your case page. Nothing on this app asks you for money beyond what you booked.',
    ],
  },
  {
    // The tier is not live yet, so its client notes wait for the release that
    // turns it on. What IS listed is a fix a client can see on their own page
    // today.
    version: '2.34',
    quiet: true,
    client: [
      'Bug fix: the scope note and the buttons on your Docs page no longer reset while you are reading them. If you had a form snap shut on you mid-tap, that was this.',
    ],
  },
  {
    // Shipped to main on 2026-08-24 while this branch waited: the front-door
    // maintenance window. Empty client list because it changed nothing for
    // anyone who already had a case.
    version: '2.33',
    quiet: true,
    client: [],
  },
  {
    // The re-landing of the pulled-back update (2.26-2.30). Client notes for
    // the whole feature get written in one go on the release that turns the
    // new tier on; until then this stays quiet.
    version: '2.32',
    quiet: true,
    client: [],
  },
  {
    // The pullback itself: kept the booking closure and the settings split,
    // reverted the rest to be fixed and re-landed.
    version: '2.31',
    quiet: true,
    client: [],
  },
  {
    // Empty, and this one is worth saying why. The booking page changed for
    // anyone who visits it: the books are shut for two weeks. But this card
    // is shown to people who ALREADY have a case, and for them nothing
    // changed at all - the closure says so out loud on the page itself.
    // Telling an existing client "I have stopped taking clients" reads as bad
    // news about their case, and it is not news about their case.
    version: '2.30',
    quiet: true,
    client: [],
  },
  {
    // Empty on purpose, and not because nothing changed for clients: the
    // Full Access upgrade card gained the scope note it always promised. That
    // card is part of a tier that is not live yet, so announcing the note now
    // would describe a screen no client has. The whole tier's client notes get
    // written in one go on the release that turns it on.
    version: '2.29',
    quiet: true,
    client: [],
  },
  {
    version: '2.28',
    quiet: true,
    client: [],
  },
  {
    version: '2.27',
    quiet: true,
    client: [],
  },
  {
    version: '2.26',
    quiet: true,
    client: [],
  },
  {
    version: '2.25',
    quiet: true,
    client: [],
  },
  {
    version: '2.24',
    quiet: true,
    client: [],
  },
  {
    version: '2.23',
    quiet: true,
    client: [],
  },
  {
    version: '2.22',
    quiet: true,
    client: [],
  },
  {
    version: '2.21',
    quiet: true,
    client: [],
  },
  {
    version: '2.20',
    quiet: true,
    client: [],
  },
  {
    version: '2.19',
    quiet: true,
    client: [],
  },
  {
    version: '2.18',
    quiet: true,
    client: [],
  },
  {
    version: '2.17',
    quiet: true,
    client: [],
  },
  {
    version: '2.16',
    quiet: true,
    client: [],
  },
  {
    version: '2.15',
    quiet: true,
    client: [],
  },
  {
    version: '2.14',
    quiet: true,
    client: [],
  },
  {
    version: '2.13',
    quiet: true,
    client: [],
  },
  {
    version: '2.12',
    quiet: true,
    client: [],
  },
  {
    version: '2.11',
    quiet: true,
    client: [],
  },
  {
    version: '2.10',
    quiet: true,
    client: [
      'The time-worked line on your Progress page now updates live: the minutes climb while the page is open, and "working on it right now" appears and clears the moment the work starts or stops.',
    ],
  },
  {
    version: '2.9',
    quiet: true,
    client: [],
  },
  {
    version: '2.8',
    quiet: true,
    client: [],
  },
  {
    version: '2.7',
    quiet: true,
    client: [
      'Your case page now shows the time I have actually worked on your case, under Progress. I start and stop that clock myself, and it says when I am working on it right now.',
    ],
  },
  {
    version: '2.6',
    quiet: true,
    client: [
      'Links in chat are now tappable. Paste a study, an article, or a portal link and it opens straight from the message.',
      'Bug fix: on a long thread, the newest messages were being hidden. Chat now always shows where the conversation actually is.',
    ],
  },
  {
    version: '2.5',
    quiet: true,
    client: [
      'Chat now opens one week before your scheduled call. Until then, your "For our next call" list stays open, and I read it.',
      'Want a direct line sooner? You can open chat immediately for a one-time $50, right from your case page, and it stays open for the life of your case.',
      "You'll get a notification and an email the moment chat opens, so there's nothing to watch for.",
    ],
  },
  {
    version: '2.4',
    quiet: true,
    client: [
      'Press and hold a file you uploaded on the Docs page to delete it. Files I place there, like your report and the call recording, stay part of your case record.',
    ],
  },
  {
    version: '2.3',
    quiet: true,
    client: [
      'A "For our next call" list now lives right under the chat. Add anything to it, anytime. We go through the list together on the call, where it gets real attention instead of a rushed reply.',
      'Bug fix: chat opens at your newest message instead of somewhere in the middle of history.',
      'Bug fix: removing a reaction from a message works again.',
    ],
  },
  {
    version: '2.2',
    // A guided tour rather than a list. Each card is one page of their case,
    // in the order the tabs are in, and says what the page is for and how to
    // get around it. `where` is the tab it is talking about, so the card and
    // the thing it describes are never out of step.
    tour: [
      {
        where: 'Your case',
        icon: '📁',
        body: 'Your case is a folder with tabs across the top. Tap a tab to open '
          + 'that page, or swipe left and right to move between them. Nothing '
          + 'is buried: every page is one tap away.',
      },
      {
        where: 'Progress',
        icon: '📍',
        body: 'Where your case is up to, and when we are speaking. The time is '
          + 'shown in your own timezone as well as mine, and there is a "+ '
          + 'calendar" link that adds it to your phone. Session details are '
          + 'folded up underneath; tap to open them.',
      },
      {
        where: 'Chat',
        icon: '💬',
        body: 'Messages between us. The ⤢ button next to the box makes it full '
          + 'screen, which is easier to read on a phone, and the same button '
          + 'brings it back. Press and hold any message to react to it, copy it, '
          + 'or save it. You can edit your own message for three minutes after '
          + 'sending it.',
      },
      {
        where: 'Docs',
        icon: '📄',
        body: 'Everything on your case: your report, the recording, and anything '
          + 'either of us has uploaded. Tap the box at the top to add labs, '
          + 'imaging or records. Files shared in chat land here too, so there is '
          + 'one place to look.',
      },
      {
        where: 'Saved',
        icon: '🔖',
        body: 'Messages you have bookmarked, each with room for a note of your '
          + 'own. Press and hold a message in Chat and choose "Save this '
          + 'message". This page is yours: I am not told what you save.',
      },
      {
        where: 'If a question is too much',
        icon: '⚐',
        body: 'Press and hold any question I asked and tap the flag to pass on '
          + 'it. It is marked and we move on. No questions asked, no judgement, '
          + 'and you never owe an explanation.',
      },
      {
        where: 'The tip jar',
        icon: '\u{1FAD9}',
        body: 'At the bottom of your case page. Completely optional, and '
          + 'nothing about your care changes either way. Right under it is '
          + 'the review card: you are welcome to leave one at any point, '
          + 'not just when your case wraps up.',
      },
      {
        where: 'How it looks',
        icon: '⚙',
        body: 'Four looks, including a light one and a high-contrast one. Tap '
          + 'the ⚙ in the top bar. If reading is hard today, the high-contrast '
          + 'one is worth trying.',
      },
    ],
    client: [
      'Your case is now a folder with tabs instead of one long scroll. Tap a tab, or swipe left and right to move between pages.',
      'A new Saved tab: press and hold any message to bookmark it with a note of your own.',
      'Files shared in chat now show up in your Documents, where they always should have.',
      'When you add a photo or a document, you can name it in your own words. IMG_4127 tells nobody anything; "rash on my left hand" tells us both.',
      'Long file names are readable again instead of being cut off mid-word.',
      'When your report is delivered it is marked with a ✅, and a short feedback card opens under it.',
      'You can export your case as a PDF and pick which sections to include. It is in the feedback card, under Docs.',
      'Four looks to choose from, including a light one and a high-contrast one. Tap the ⚙ in the top bar.',
      'A tip jar sits at the bottom of your case page. Completely optional, always appreciated, and nothing about your care changes either way.',
      'You can leave a review at any point along the way, not just at the end. The card is at the bottom of your case page.',
    ],
  },
  {
    version: '2.1',
    client: [
      'Press and hold a message to react to it, or to edit your own within three minutes.',
      'Press and hold a file shared in chat to save it to your Documents.',
    ],
  },
];

const KEY = 'pa-seen-version';

/** Sortable so 2.10 lands after 2.9 rather than before it. */
function rank(v) {
  return String(v).split('.').map((n) => String(Number(n) || 0).padStart(4, '0')).join('.');
}

export function seenVersion() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function markVersionSeen(v = VERSION) {
  try { localStorage.setItem(KEY, v); } catch { /* storage blocked */ }
}

/**
 * Everything they have not been told about yet, newest first. A first-ever
 * visit gets nothing: somebody who has never used the app does not need a
 * changelog, they need the app.
 */
export function unseenVersions(extra = {}) {
  const seen = seenVersion();
  if (!seen) return [];
  return CHANGELOG
    // Quiet versions never open a card or a tour; their notes live behind the
    // "Version notes" button in the page footer instead (version-note.js).
    .filter((v) => !v.quiet && rank(v.version) > rank(seen))
    .map((v) => ({
      version: v.version,
      // `extra` is Eric's half, fetched from the admin route. A client never
      // has one, and never has a way to ask for one.
      notes: [...v.client, ...(extra[v.version] || [])],
      tour: v.tour || [],
    }))
    .filter((v) => v.notes.length);
}

/**
 * The card. Dismissible, and it never comes back: the moment it is built the
 * version is marked seen, so a reload does not bring it round again even if
 * they never tapped anything.
 */
export async function showVersionCard(isAdmin = false, user = null) {
  // Anything extra is fetched, and the fetch is allowed to fail: an empty
  // object is a perfectly good answer and the card is drawn from what is here.
  let extra = {};
  if (isAdmin && user) {
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/changelog', { headers: { authorization: `Bearer ${token}` } });
      if (res.ok) extra = (await res.json()).admin || {};
    } catch { /* the client half still shows */ }
  }
  const versions = unseenVersions(extra);
  // A marker created just now, from empty, means this person is NEW this
  // session - they browsed in, nothing more. The intro (onboarding.js) reads
  // this to tell a first-ever visitor from a returning client, because by the
  // time they reach their case page the marker exists either way.
  try {
    if (!seenVersion()) sessionStorage.setItem('pa-fresh-visitor', '1');
  } catch { /* storage blocked */ }
  markVersionSeen();
  if (!versions.length) return false;

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // The tour, if this release has one. One card per page, in tab order, paged
  // through with Next: a person who is unwell should never have to scroll a
  // wall of text to find out how to stop scrolling.
  // Eric, 2026-08-21: "They should get update notes and then take the tour."
  // step -1 is the notes page. The tour follows it, not the other way round.
  const tour = versions.flatMap((v) => v.tour || []);
  // This flow used to end on a copy of the tip jar. The jar was retired on
  // 2026-08-24, so the notes end on the tour, or on themselves.
  let step = -1;

  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-card whats-new" role="dialog" aria-modal="true" aria-label="What's new">
      <div data-body></div>
      <div class="actions" data-acts></div>
    </div>`;
  const bodyEl = overlay.querySelector('[data-body]');
  const actsEl = overlay.querySelector('[data-acts]');

  function draw() {
    if (step < 0) {
      // What changed, first. This is somebody who already uses the app.
      bodyEl.innerHTML = versions.map((v) => `
        <h3>Pocket Advocate ${esc(v.version)}</h3>
        <ul class="whats-new-list">${v.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`).join('');
      actsEl.innerHTML = tour.length
        ? `<button class="btn glow" data-next>Take the tour</button>
           <button class="btn ghost" data-close>Not now</button>`
        : '<button class="btn glow" data-close>Got it</button>';
      actsEl.querySelector('[data-next]')?.addEventListener('click', () => { step = 0; draw(); });
    } else if (step < tour.length) {
      const t = tour[step];
      bodyEl.innerHTML = `
        <p class="wn-step">${step + 1} of ${tour.length}</p>
        <h3>${esc(t.icon || '')} ${esc(t.where)}</h3>
        <p class="wn-body">${esc(t.body)}</p>
        <div class="wn-dots" aria-hidden="true">${tour.map((_, i) =>
          `<span class="${i === step ? 'on' : ''}"></span>`).join('')}</div>`;
      const lastTour = step === tour.length - 1;
      actsEl.innerHTML = `
        <button class="btn quiet" data-back>Back</button>
        ${lastTour
          ? '<button class="btn glow" data-close>Done</button>'
          : '<button class="btn glow" data-next>Next</button>'}
        ${lastTour ? '' : '<button class="btn ghost" data-close>Skip</button>'}`;
      actsEl.querySelector('[data-back]')?.addEventListener('click', () => { step--; draw(); });
      actsEl.querySelector('[data-next]')?.addEventListener('click', () => { step++; draw(); });
    }
    actsEl.querySelector('[data-close]')?.addEventListener('click', close);
  }

  function close() { overlay.remove(); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  draw();
  document.body.appendChild(overlay);
  return true;
}
