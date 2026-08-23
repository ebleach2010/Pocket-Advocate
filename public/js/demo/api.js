// Everything the app asks the Worker for, answered locally.
//
// Two things this makes true. Signing up takes any letters he likes, because
// the auth calls never leave the browser - and so there is NO demo branch in
// the Worker at all, no magic code, no bypass in handleVerifyCode. And
// pressing Analyze produces the ten sections instantly from a fixture, so the
// panel can be driven without a single model call.
//
// UI, not AI: nothing in the demo calls a model.

import { DEMO_CASE_ID } from './seed.js';

/** A little delay, so states that only exist while something is in flight
 *  (the button disabling, the progress bar, "Reading…") are visible. */
const beat = (ms = 320) => new Promise((r) => setTimeout(r, ms));

const ok = (body) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const fail = (status, error) => ({
  ok: false,
  status,
  headers: { get: () => 'application/json' },
  json: async () => ({ error }),
  text: async () => JSON.stringify({ error }),
});

const SUMMARY = `## Key points
- She has called the practice twice for the March panel and not got through.
- The rheumatology referral was mentioned by the second doctor and never confirmed.
- She has been photographing the hand rash herself, which is the best evidence in the file.

## Progress
The script for the phone call went out and she said she would use it. Nothing
has come back yet.

## Loose ends
- The full March blood panel with reference ranges.
- Written confirmation the rheumatology referral was sent.
potentially forgot to or have not provided. Helpful, but optional.

## Where it stands
Waiting on paperwork she has to prise out of a practice that does not answer
the phone. The referral question is the one that changes the shape of the case.`;

// A plausible running total for the chat-hours meter, so the admin suite
// shows the number doing its job the moment the page opens. Demo only.
let demoChatSecs = 3 * 3600 + 40 * 60;
let demoEffort = 'high';

// What the study looks like after a few nights. Demo only.
const demoVoice = {
  enabled: true,
  lastRunAt: new Date(Date.now() - 13 * 3_600_000).toISOString(),
  runs: 6,
  lastError: null,
  hour: 22,
};

export function demoApi(role, store) {
  const real = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const path = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0];
    if (!path.startsWith('/api/')) return real(input, init);

    const body = (() => {
      try { return init.body ? JSON.parse(init.body) : {}; } catch { return {}; }
    })();
    const q = new URLSearchParams((url.split('?')[1] || ''));

    // ---- signing in takes anything at all --------------------------------
    // "I'll use any series of letters to fill the email box/code box. No email
    // needs to be sent."
    if (path === '/api/auth/request-code') { await beat(); return ok({ ok: true }); }
    if (path === '/api/auth/verify-code') { await beat(); return ok({ token: 'demo', deviceToken: 'demo' }); }
    if (path === '/api/auth/device-signin') return ok({ token: 'demo' });
    if (path === '/api/admin/login' || path === '/api/admin/pin') return ok({ token: 'demo', deviceToken: 'demo' });
    if (path === '/api/admin/session') return ok({ ok: true });

    // ---- money, without any -----------------------------------------------
    if (path === '/api/rates') return ok({ caseCents: 26500, addonCents: 7500, subCents: 5000, chatOpenCents: 5000 });
    if (path === '/api/admin/rates') return ok({ caseCents: 26500, addonCents: 7500, subCents: 5000, bookings: 0, changed: false });
    // The nightly study, with a plausible history so the card on the dashboard
    // shows what it shows on a real night.
    if (path === '/api/work') {
      const key = `cases/${DEMO_CASE_ID}`;
      const c = store.docs.get(key) || {};
      const w = c.work || { seconds: 0, startedAt: null };
      if (body.on === true) {
        if (!w.startedAt) store.docs.set(key, { ...c, work: { ...w, startedAt: new Date() } });
        return ok({ seconds: w.seconds || 0, running: true });
      }
      const add = w.startedAt ? Math.floor((Date.now() - new Date(w.startedAt).getTime()) / 1000) : 0;
      const seconds = (Number(w.seconds) || 0) + add;
      store.docs.set(key, { ...c, work: { seconds, startedAt: null } });
      return ok({ seconds, running: false });
    }
    if (path === '/api/admin/effort') {
      if (init.method === 'POST') demoEffort = body.effort === 'max' ? 'max' : 'high';
      return ok({ effort: demoEffort });
    }
    if (path === '/api/admin/voice') {
      if (typeof body.enabled === 'boolean') demoVoice.enabled = body.enabled;
      if (body.run === true) {
        demoVoice.runs += 1;
        demoVoice.lastRunAt = new Date().toISOString();
        return ok({ ...demoVoice, lastRun: { ran: true, wrote: true, readers: ['diction', 'syntax', 'cadence', 'tone', 'detail', 'beliefs', 'mechanics'] } });
      }
      return ok({ ...demoVoice });
    }
    if (path === '/api/checkout' || path === '/api/subscribe' || path === '/api/followup') {
      await beat(600);
      // Straight past Stripe to where paying would have landed him.
      const to = path === '/api/followup'
        ? `/case.html?id=${DEMO_CASE_ID}&followup=1&demo=1`
        : `/return.html?session_id=demo&demo=${role}`;
      return ok({ ok: true, url: to });
    }
    // ready, not just the id: the return page polls on that flag, and without
    // it the demo sat on "opening your case now" until it gave up.
    if (path === '/api/case-for-session') return ok({ ready: true, caseId: DEMO_CASE_ID });
    if (path === '/api/portal') return ok({ url: `/subscription.html?demo=${role}` });
    if (path === '/api/tip') return ok({ url: `/case.html?demo=1&tipped=1` });
    if (path === '/api/chat-unlock') return ok({ url: `/case.html?demo=1&chatopen=1` });

    // ---- the advisor, from a fixture -------------------------------------
    if (path === '/api/advisor/state') {
      const state = store.docs.get(`cases/${DEMO_CASE_ID}/advisor/state`) || {};
      const style = store.docs.get('advisorStyle/profile') || {};
      const notes = store.docs.get(`cases/${DEMO_CASE_ID}/private/notes/doc`) || {};
      const { readFiles, pendingMedia, ...panelState } = state;
      void readFiles; void pendingMedia;
      return ok({
        state: panelState,
        qa: [],
        glossary: [...store.docs.entries()]
          .filter(([p]) => p.startsWith('advisorKnowledge/'))
          .map(([p, d]) => ({ id: p.split('/').pop(), ...d, learned: !!d.learnedAt })),
        keyConfigured: true,
        notes: notes.html || '',
        notesUpdatedAt: notes.updatedAt || null,
        workingLine: state.workingDx || '',
        dxOverride: null,
        differential: state.differential || [],
        corrections: (state.corrections || []).filter((c) => !c.dismissed),
        unanswered: (state.unanswered || []).filter((r) => !r.answered),
        mediaReport: state.mediaReport || null,
        queuedFiles: [],
        about: {
          voice: style.voice || '',
          stances: style.stances || '',
          coaching: style.coaching || '',
          updatedAt: style.updatedAt || null,
        },
      });
    }
    if (path === '/api/advisor') {
      const state = store.docs.get(`cases/${DEMO_CASE_ID}/advisor/state`) || {};
      if (body.action === 'analyze') {
        // A visible run, so the progress bar and the running state are real
        // things he can watch, then the same sections settle back.
        store.docs.set(`cases/${DEMO_CASE_ID}/advisor/state`, {
          ...state, status: 'running', startedAt: new Date(), progressAt: new Date(),
        });
        setTimeout(() => {
          store.docs.set(`cases/${DEMO_CASE_ID}/advisor/state`, {
            ...state, status: 'idle', updatedAt: new Date(),
          });
        }, 4000);
        return ok({ ok: true });
      }
      if (body.action === 'dx') {
        store.docs.set(`cases/${DEMO_CASE_ID}/advisor/state`, {
          ...state, dxOverride: body.text || null, dxOverrideAt: new Date(),
        });
        return ok({ ok: true });
      }
      if (body.action === 'unanswered-answered') {
        const flat = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        store.docs.set(`cases/${DEMO_CASE_ID}/advisor/state`, {
          ...state,
          unanswered: (state.unanswered || []).map((r) => ({
            ...r, answered: flat(r.ask) === flat(body.ask) ? true : r.answered,
          })),
        });
        return ok({ ok: true });
      }
      if (body.action === 'correction-dismiss') {
        store.docs.set(`cases/${DEMO_CASE_ID}/advisor/state`, {
          ...state,
          corrections: (state.corrections || []).map((c) => ({
            ...c, dismissed: c.msgId === body.msgId ? true : c.dismissed,
          })),
        });
        return ok({ ok: true });
      }
      if (body.action === 'note') {
        store.docs.set(`cases/${DEMO_CASE_ID}/private/notes/doc`, {
          html: body.html || '', updatedAt: new Date(),
        });
        return ok({ ok: true });
      }
      await beat(700);
      return ok({ ok: true });
    }
    if (path === '/api/advisor/covers') {
      return ok({ covers: { [DEMO_CASE_ID]: { text: 'Two years unexplained, bloods never actually seen', by: 'advisor', at: new Date() } } });
    }
    if (path === '/api/advisor/dictionary') return ok({ terms: [] });

    // ---- one day, read back ----------------------------------------------
    if (path === '/api/summary') {
      await beat(900);
      return ok({ day: body.day, text: SUMMARY, cached: false });
    }

    // ---- saved messages ---------------------------------------------------
    if (path === '/api/saved') {
      const uid = role === 'admin' ? 'demo-admin' : 'demo-client';
      const base = `cases/${DEMO_CASE_ID}/private/saved/${uid}`;
      if (!init.method || init.method === 'GET') {
        return ok({
          saved: [...store.docs.entries()]
            .filter(([p]) => p.startsWith(`${base}/`))
            .map(([p, d]) => ({ msgId: p.split('/').pop(), ...d })),
        });
      }
      const at = `${base}/${body.msgId}`;
      if (body.delete) { store.docs.delete(at); return ok({ ok: true }); }
      const msg = store.docs.get(`cases/${DEMO_CASE_ID}/chat/${body.msgId}`) || {};
      store.docs.set(at, {
        text: msg.text || '', role: msg.role || 'client',
        sentAt: msg.ts || null, note: body.note || '',
        savedAt: store.docs.get(at)?.savedAt || new Date(),
      });
      return ok({ ok: true, msgId: body.msgId });
    }

    // ---- the next-call agenda + the chat-hours meter ----------------------
    if (path === '/api/agenda') {
      const base = `cases/${DEMO_CASE_ID}/agenda`;
      const list = () => [...store.docs.entries()]
        .filter(([p]) => p.startsWith(`${base}/`))
        .map(([p, d]) => ({ id: p.split('/').pop(), ...d }))
        .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
      if (!init.method || init.method === 'GET') return ok({ items: list() });
      if (body.action === 'add') {
        const id = `a${Date.now()}`;
        const item = {
          text: String(body.text || '').slice(0, 500),
          by: role === 'admin' ? 'demo-admin' : 'demo-client',
          role, at: new Date(), done: false, doneAt: null,
        };
        store.docs.set(`${base}/${id}`, item);
        return ok({ ok: true, item: { id, ...item } });
      }
      if (body.action === 'done') {
        const it = store.docs.get(`${base}/${body.itemId}`);
        if (it) {
          store.docs.set(`${base}/${body.itemId}`, {
            ...it, done: body.done !== false, doneAt: body.done !== false ? new Date() : null,
          });
        }
        return ok({ ok: true });
      }
      if (body.action === 'remove') { store.docs.delete(`${base}/${body.itemId}`); return ok({ ok: true }); }
      if (body.action === 'clear') {
        for (const it of list().filter((x) => x.done)) store.docs.delete(`${base}/${it.id}`);
        return ok({ ok: true });
      }
      return ok({ ok: true });
    }
    if (path === '/api/chattime') {
      demoChatSecs += Math.max(0, Math.min(120, Number(body.seconds) || 0));
      return ok({ total: demoChatSecs });
    }

    // ---- the ledger + file deletion ---------------------------------------
    if (path === '/api/admin/ledger') {
      const c = store.docs.get(`cases/${DEMO_CASE_ID}`) || {};
      let paid = Number(c.stripe?.amountTotal) || Number(c.caseRateCents) || 0;
      let tips = 0;
      for (const pmt of (Array.isArray(c.extraPayments) ? c.extraPayments : [])) {
        if (pmt?.kind === 'tip') tips += Number(pmt.amountCents) || 0;
        else paid += Number(pmt.amountCents) || 0;
      }
      // A little tip on the demo books, so the column shows its job.
      if (!tips) tips = 2500;
      return ok({
        clients: [{ name: c.clientName || 'Jordan Avery', paidCents: paid, tipCents: tips, cases: 1 }],
        totals: { paidCents: paid, tipCents: tips },
      });
    }
    if (path === '/api/file/delete') {
      if (typeof body.path === 'string') { store.files.delete(body.path); store.fire?.(body.path); }
      return ok({ ok: true });
    }

    // ---- everything else --------------------------------------------------
    if (path === '/api/version') return ok({ tag: 'demo', version: '2.15' });
    if (path === '/api/changelog') {
      return role === 'admin'
        ? ok({ admin: { '2.2': ['Everything on your side, in one place, with nothing real behind it.'] } })
        : fail(403, 'Admin only');
    }
    if (path === '/api/reviews') return ok({ reviews: [] });
    if (path === '/api/uploaded' || path === '/api/notify' || path === '/api/push/test') return ok({ ok: true });
    if (path === '/api/chat/react' || path === '/api/chat/pass' || path === '/api/chat/edit') {
      // These write to the message, and in the demo the store is the message.
      const msgPath = `cases/${DEMO_CASE_ID}/chat/${body.msgId}`;
      const msg = store.docs.get(msgPath);
      if (!msg) return fail(404, 'No such message');
      if (path === '/api/chat/react') store.docs.set(msgPath, { ...msg, reaction: body.reaction || null });
      if (path === '/api/chat/pass') store.docs.set(msgPath, { ...msg, pass: body.pass ? { by: 'demo-client', at: new Date() } : null });
      if (path === '/api/chat/edit') store.docs.set(msgPath, { ...msg, text: body.text, editedAt: new Date() });
      store.fire?.(msgPath);
      return ok({ ok: true });
    }
    if (path === '/api/review') return ok({ ok: true });
    if (path === '/api/make-private') return ok({ ok: true });

    return ok({ ok: true, demo: true });
  };
}
