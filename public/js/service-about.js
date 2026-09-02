// The About sheets: what each service actually gets you, in one place each
// (Eric, 2026-08-25: "an 'about' button that explains EVERYTHING they get.
// There is a comprehensive paragraph section, a bullet point section
// breaking down main points, and a TL;DR").
//
// PURE DATA plus one renderer. Every claim here is backed by something the
// code does; nothing is promised that the product does not do.
//
// This file is downloaded by every client, so it holds the copy and nothing
// else. Notes about the copy live in the repo's own instructions file.

export const SERVICE_ABOUT = {
  case: {
    title: 'The Advocacy Case',
    price: '$1,200, once',
    tldr: 'One flat $1,200. You talk, I dig in, and within a week of our call you hold a written plan your own doctors can act on. No hourly meter, no guessing what you get.',
    paragraphs: [
      'An Advocacy Case is me taking your whole medical story, the records, the labs, the half-answers, the years of going in circles, and turning it into something you can act on. It starts with a private call, phone or video, usually about an hour. Before it, you upload whatever you have. I read all of it properly before we ever speak.',
      'After the call you get a written report within 7 days. It organizes your history, names the open questions, and lays out the next steps worth discussing with your care team: the referral worth chasing, the result worth a second look, the question worth asking by name. The call is recorded and saved in your private file so nothing said gets lost. Both are yours to keep, forever.',
      'Your case page keeps everything in one drawer: the report, the recording, your documents, our whole conversation. Your price is frozen the moment you book, so later price changes never touch you. If I ever have to pause, every deadline of mine stops with the pause and the time is put back. And when the case closes, nothing is taken away: the file stays yours, readable and downloadable, for good.',
      'What I do not sell is an outcome. I cannot promise a diagnosis, an overturned denial, or a doctor’s decision, and anyone who promises those is selling you something. You are paying for the work: I read properly, I tell you the truth about what I see, I meet the deadlines that are mine, and I say so plainly when something is not going your way.',
    ],
    bullets: [
      'A private call, phone or video, about an hour, recorded and saved for you',
      '5-6 hours of research and reporting behind every case',
      'I read every record you share before we speak: labs, imaging, notes, photos',
      'A written report within 7 days of the call, next steps first',
      'A private case page with chat, uploads, and everything in one place',
      'A shared list for our call that is open from day one',
      'Chat with me directly: it opens the week before our call, or right away for a one-time $50',
      'A 48-hour question window after the report lands, to go through it with me',
      'Your price locked at booking; pauses put the time back; the file is yours forever',
      'Add later, only if you want them: a follow-up session, telehealth advocacy, or Full-Service Case Management at the difference',
    ],
    cta: { label: 'Book a case', href: '/book.html' },
  },

  chat: {
    title: '24/7 Priority Chat',
    price: '$50/mo',
    tldr: 'A private line to me from your phone. Questions, updates, photos, records, and answers from a person who already knows your story. Cancel anytime; your history stays yours.',
    paragraphs: [
      'The chat line is for everything that happens between appointments: the letter you do not understand, the new symptom you are not sure matters, the scheduling call you are dreading. Send it when it happens. I read it personally and answer with your history in mind, not from a script.',
      'It is not an emergency line and it is not medical care. If something is urgent, call your doctor or emergency services first, then tell me. What I bring is continuity: one person who holds the thread while the system hands you around.',
      'Cancel whenever you like. Your message history stays readable to you either way; nothing you shared disappears because a subscription ended.',
    ],
    bullets: [
      'A private chat line to me, from your phone, for anything on the case of you',
      'Photos, records, and documents, straight into the conversation',
      'Read and answered personally, with your history in mind',
      'Cancel anytime; your history stays available to you',
    ],
    cta: { label: 'Start chatting', href: '/subscribe.html' },
  },

  handsOff: {
    title: 'Full-Service Case Management',
    price: '$4,400 a month, every month the same. The case fee is separate: it pays for the review.',
    tldr: 'You hand me the case. I do the legwork: the calls, the records, the insurer, the appeals, and we talk at least twice a month so you always know where it stands. A month at a time, for as long as you need it.',
    paragraphs: [
      'In a standard case I work beside you: I read, I explain, and you carry it to your doctors and your insurer. With Full-Service Case Management I work inside the case. I phone your clinics, chase your records, deal with your insurer, and write your appeals myself. Your job shrinks to giving me the permission I need to act for you, which I bring you and walk you through, and from there the legwork is mine.',
      'You ask, and I answer personally. I carry a limited number of these at a time, so this is not something you can simply buy - you send the request, I read it, and I tell you yes or no. Asking costs nothing and takes no card. If I say no, nothing is charged and I will tell you why.',
      'It is billed a month at a time, and I would rather explain why than have you wonder. A single payment for a whole engagement is a large thing to hand over at the exact moment you are least able to think about money. Monthly means the biggest number you ever see is one month, and it means you are never locked into a case that is going nowhere. Most of these run about two months. Some run one. Some run five. You decide each month.',
      'We speak at least twice a month, by phone or video, for as long as the case runs. That rhythm is part of the service, not an option: it is how the case keeps moving, and how you always know what happened without having to push for updates. If something breaks between check-ins, I add calls at no charge.',
      'If your insurer says no, I write the appeal: the first-level internal appeal, the escalation if they deny it, and I keep writing for as long as the case is mine. If a doctor will not cooperate, a referral that never gets sent, records that never arrive, I put it in writing and go through the channels myself. Appeal help alone typically runs $600 to $1,500 per appeal elsewhere; here it draws from the month\'s hours like everything else.',
      'A month buys 20 included hours of comprehensive advocacy, with priority access maintained throughout: the check-ins, the calls in your name, the records chased, the appeals written, all from the same hours. Most months use less. If yours genuinely needs more, we talk first: additional substantive casework beyond the included hours is billed at $175 to $225 an hour, agreed in advance.',
      'I cannot make an insurer answer faster and I cannot promise an outcome. What I promise is that somebody who knows these clocks is running yours, and that you hear the truth about how it is going, at least twice a month.',
    ],
    bullets: [
      'Asking costs nothing and takes no card. I answer every request myself',
      'Everything in an Advocacy Case included: the call, the record review, the written report',
      'I do the legwork: your clinics, your records, your insurer, handled by me on your authority',
      '20 included hours of comprehensive advocacy every 30-day service period',
      'Priority access maintained throughout the month',
      'Check-in calls at least twice a month, included; extra calls at my discretion, free',
      'Calls to clinics and your insurer, and written insurance appeals, all from the same hours',
      'Beyond the included hours, additional casework at $175 to $225 an hour, agreed in advance',
      'An appeal in flight does not expire with the window: a late denial still gets its answer',
      'I write to providers too, when a doctor will not cooperate',
      'Telehealth advocacy included: I join your video visits and advocate live',
      'A month at a time. Continue or stop at the end of any month, no penalty either way',
      'Your permission in writing starts my authority; I bring you the documents and walk you through them',
      'A separate service: the case fee pays for your review, and a month is priced on its own',
    ],
  },

  extension: {
    title: 'Another month',
    price: '$4,400 a month, the same as the first',
    tldr: 'Another month of everything: the check-ins, the calls on your behalf, the lot. Take as many as your case needs, one at a time. Nothing else changes.',
    paragraphs: [
      'Some cases outlast a month or two through nobody\u2019s fault: a records office takes its full thirty days, a referral sits in a queue, an insurer uses every day it is allowed. Continuing keeps me inside the case while those clocks run.',
      'It costs exactly what the first month cost. There is no separate extension product and no penalty rate for needing longer - the price is the price, month after month.',
      'Everything continues exactly as it was: the same cadence of check-ins, the same calls made in your name, the same file. There is no obligation to continue, ever, and no penalty for stopping: an appeal already in flight survives the window regardless.',
    ],
    bullets: [
      'Thirty days added to your coordination window, from the day it would have ended',
      'The same price as your first month. It never climbs for continuing',
      'Same check-ins, same calls, same everything',
      'Take as many as the case needs, one at a time',
      'Never required. The obligations that outlive the window outlive it either way',
    ],
  },

  followup: {
    title: 'Follow-Up Session',
    price: '$325, at the price you were quoted when you booked',
    tldr: 'A second full session on the same case, once your report has landed. Same file, no starting over.',
    paragraphs: [
      'The report usually raises things worth talking through: what changed, what a result actually means, which next step to take first. A follow-up is a full session for exactly that, on the same case, with everything we already built still in front of us.',
      'It is sold only after your first discussion has happened, at the price you were shown when you originally booked, and it is yours to use within 30 days of buying it. If the month gets away from you, message me; an expired follow-up can still be honoured.',
    ],
    bullets: [
      'A second full discussion on the same case',
      'Same file, same history, no starting over',
      'Your original quoted price, not today’s',
      'Use it within 30 days of purchase; I will warn you a week before it lapses',
    ],
  },

  telehealth: {
    title: 'Telehealth Appointment Advocacy',
    price: '$525 flat. Included with Full-Service Case Management.',
    tldr: 'I join your telehealth appointment by video and advocate live. If I cannot attend, or your provider refuses, every dollar comes back.',
    paragraphs: [
      'You name the appointment: the time, the clinic, the provider. I confirm each one personally, and then I am in the visit with you, asking the questions that get lost, keeping the thread when the appointment moves fast, and making sure what was agreed gets said out loud before it ends.',
      'Your provider still controls their visit and can decline my presence. If that happens, or if I cannot attend, the $525 for that appointment refunds in full, promised before you type a thing. And I never record a provider’s visit: notes and advocacy only.',
    ],
    bullets: [
      'I attend your telehealth visit by video and advocate live',
      'You invite me; I confirm every appointment personally',
      'Any refusal, theirs or mine, refunds that appointment in full',
      'Never recorded: notes and advocacy only',
      'Included at no charge on Full-Service Case Management',
    ],
  },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/**
 * The one renderer both surfaces share: the landing page's About buttons and
 * the Case Enhancements cards. TL;DR first, because the reader this is for
 * may only have the attention for the TL;DR; the depth is underneath for
 * whoever wants it.
 */
export function openServiceAbout(id) {
  const a = SERVICE_ABOUT[id];
  if (!a || document.getElementById('pa-about')) return;
  const overlay = document.createElement('div');
  overlay.id = 'pa-about';
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-card about-card" role="dialog" aria-modal="true" aria-label="${esc(a.title)}">
      <div class="row" style="align-items:flex-start;">
        <div>
          <h3 style="margin:0;">${esc(a.title)}</h3>
          <p class="dim small" style="margin:.15rem 0 0;">${esc(a.price)}</p>
        </div>
        <button class="btn quiet" data-x style="flex:none; margin-left:auto;">Close</button>
      </div>
      <div class="about-body" style="overflow-y:auto; margin-top:.7rem;">
        <p class="about-tldr"><strong>TL;DR</strong> — ${esc(a.tldr)}</p>
        ${a.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}
        <h4 style="margin:1rem 0 .3rem;">Point by point</h4>
        <ul class="about-list">${a.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
        ${a.cta ? `<p style="margin:1rem 0 .2rem;"><a class="btn glow" href="${esc(a.cta.href)}">${esc(a.cta.label)}</a></p>` : ''}
      </div>
    </div>`;
  // Escape closes it, like every other overlay in the app, and focus moves
  // in and comes back out to whatever opened it. Without the focus move the
  // sheet is appended at the end of <body>, so Tab walked the whole page to
  // reach it and a screen reader was never told it had opened.
  const opener = document.activeElement;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (opener?.isConnected) opener.focus();
  };
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-x]').addEventListener('click', close);
  document.body.appendChild(overlay);
  overlay.querySelector('[data-x]').focus();
}

/** Wire every [data-about] trigger under `root` to its sheet. */
export function wireAboutButtons(root = document) {
  for (const el of root.querySelectorAll('[data-about]')) {
    if (el._aboutWired) continue;
    el._aboutWired = true;
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openServiceAbout(el.dataset.about);
    });
  }
}
