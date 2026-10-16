// The routes a client's pages call, answered inside the visitor's tab for
// the case preview (2026-10-15). Public reads (the price list, the reviews,
// the version) still go to the server; everything that would write, send or
// charge is answered here instead, so nothing the visitor does leaves the tab.
import { EMOJI_REACTIONS } from '../msg-actions.js';
import { PREVIEW_UID, PREVIEW_CASE, ERIC_UID } from './seed.js';

// Reads anyone may make, passed through untouched.
const PASS = new Set(['/api/rates', '/api/reviews', '/api/changelog', '/api/version', '/api/stats']);
// Every route that would take money or book a time.
const SHOP = new Set(['/api/checkout', '/api/chat-unlock', '/api/upgrade', '/api/followup', '/api/extend',
  '/api/subscribe', '/api/portal', '/api/invite', '/api/invite/confirm']);
export const NOT_HERE = 'This is a preview, so nothing in it can be bought or booked. Everything else on this case works.';
// What a visitor hears back, one answer to each message they send, in turn
// (Eric, 2026-10-16: "Have the example chat in the suite for clients be more
// friendly and softer toned. This chat isn't usable in the way a fake
// contractor is. You can send a message but a generic answer about how I
// would respond here ... appear"). A real conversation's kind of answer;
// the strip at the top already says this is a preview.
export const PREVIEW_REPLIES = [
  "Thank you for telling me. I'm really glad you reached out, and I'm on it. Is there anything else you'd like me to know before our call?",
  'That makes a lot of sense. When did you first notice it? Even a rough guess helps.',
  "I hear you. You don't have to carry this part on your own. Would it help if I called the office for you this week?",
  "That's a good question. Let me look into it properly, and I'll come back to you today with a clear answer.",
  "Of course. I've added it to our list for the next call so it doesn't get lost.",
  "Take your time. Whenever you're ready, send me what you have, even if it's just a photo of a page.",
];
// Kept for anything that still names the first one.
export const FIRST_REPLY = PREVIEW_REPLIES[0];

const beat = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const answer = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (body = { ok: true }) => answer(200, body);
const fail = (status, error) => answer(status, { error });

export function previewApi(store) {
  const real = window.fetch.bind(window);
  const caseOf = (id) => (id === PREVIEW_CASE ? store.docs.get(`cases/${id}`) : null);
  const under = (prefix) => [...store.docs.entries()].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'));

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const path = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0];
    if (!path.startsWith('/api/')) return real(input, init);
    if (PASS.has(path) && (!init.method || init.method === 'GET')) return real(input, init);
    const method = String(init.method || 'GET').toUpperCase();
    const body = (() => { try { return init.body ? JSON.parse(init.body) : {}; } catch { return {}; } })();
    const q = new URLSearchParams(url.split('?')[1] || '');

    // His routes are not part of a client's case, here or anywhere.
    if (path.startsWith('/api/admin')) return fail(404, 'Not found');
    // In the preview he is always in (Eric, 2026-10-15: "make me 'in office'"),
    // whatever his real switch says.
    if (path === '/api/availability') return ok({ inOffice: true, responseTime: null });
    if (SHOP.has(path)) { await beat(); return fail(409, NOT_HERE); }

    // ---- the chat ------------------------------------------------------------
    if (path === '/api/notify') {
      // Every message a visitor sends gets a warm answer a moment later, the
      // next one in turn, so the chat feels like the real thing (2026-10-16).
      const meta = store.docs.get('preview/meta') || {};
      if (body?.kind === 'case' && body?.id === PREVIEW_CASE) {
        const n = Number(meta.replies) || 0;
        store.docs.set('preview/meta', { ...meta, replies: n + 1 });
        store.persist();
        setTimeout(() => {
          const p = `cases/${PREVIEW_CASE}/chat/r${Date.now().toString(36)}${n}`;
          store.docs.set(p, { from: ERIC_UID, role: 'admin', text: PREVIEW_REPLIES[n % PREVIEW_REPLIES.length], ts: new Date() });
          store.fire(p);
        }, 2200);
      }
      return ok();
    }
    if (path === '/api/chat/react' || path === '/api/chat/pass' || path === '/api/chat/edit') {
      const msgPath = `cases/${body.id}/chat/${body.msgId}`;
      const msg = caseOf(body.id) && store.docs.get(msgPath);
      if (!msg) return fail(404, 'No such message');
      const mine = msg.from === PREVIEW_UID;
      if (path === '/api/chat/react') {
        const reaction = body.reaction ?? null;
        const emo = EMOJI_REACTIONS.find((r) => r.id === reaction);
        if (reaction !== null && !emo) return fail(403, 'That reaction is not available.');
        if (mine) return fail(403, "You can only react to the other person's messages.");
        store.docs.set(msgPath, { ...msg, reaction: emo ? { id: reaction, emoji: emo.emoji, kind: 'emoji', by: PREVIEW_UID, at: new Date() } : null });
      }
      if (path === '/api/chat/pass') store.docs.set(msgPath, { ...msg, pass: body.pass ? { by: PREVIEW_UID, at: new Date() } : null });
      if (path === '/api/chat/edit') {
        if (!mine) return fail(403, 'You can only edit your own messages.');
        const text = String(body.text || '').trim();
        if (!text || text.length > 2000) return fail(400, 'Message must be 1 to 2000 characters.');
        store.docs.set(msgPath, { ...msg, text, editedAt: new Date() });
      }
      store.fire(msgPath);
      return ok();
    }
    if (path === '/api/chattime' || path === '/api/uploaded' || path === '/api/push/test' || path === '/api/make-private') return ok();

    // ---- saved messages ------------------------------------------------------
    if (path === '/api/saved') {
      const sc = body.id || q.get('id') || PREVIEW_CASE;
      const base = `cases/${sc}/saved/${PREVIEW_UID}/`;
      if (method === 'GET') return ok({ saved: under(base).map(([p, d]) => ({ msgId: p.split('/').pop(), ...d })) });
      const at = `${base}${body.msgId}`;
      if (body.delete) { store.docs.delete(at); store.persist(); return ok(); }
      const msg = store.docs.get(`cases/${sc}/chat/${body.msgId}`) || {};
      store.docs.set(at, {
        text: msg.text || '', role: msg.role || 'client', sentAt: msg.ts || null,
        note: String(body.note || '').slice(0, 500), savedAt: store.docs.get(at)?.savedAt || new Date(),
      });
      store.persist();
      return ok({ ok: true, msgId: body.msgId });
    }

    // ---- the next-call list --------------------------------------------------
    if (path === '/api/agenda') {
      const base = `cases/${body.id || q.get('id') || PREVIEW_CASE}/agenda/`;
      const list = () => under(base).map(([p, d]) => ({ id: p.split('/').pop(), ...d }))
        .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
      if (method === 'GET') return ok({ items: list() });
      if (body.action === 'add') {
        const text = String(body.text || '').trim().slice(0, 500);
        if (!text) return fail(400, 'Write the item first.');
        const itemId = `a${Date.now().toString(36)}`;
        const item = { text, by: PREVIEW_UID, role: 'client', at: new Date(), done: false, doneAt: null };
        store.docs.set(`${base}${itemId}`, item);
        store.persist();
        return ok({ ok: true, item: { id: itemId, ...item } });
      }
      const at = `${base}${body.itemId}`;
      const it = store.docs.get(at);
      if (body.action === 'done' && it) store.docs.set(at, { ...it, done: body.done !== false, doneAt: body.done !== false ? new Date() : null });
      if (body.action === 'remove' && it) {
        if (it.role !== 'client') return fail(403, 'Only items you added can be removed.');
        store.docs.delete(at);
      }
      if (body.action === 'clear') for (const x of list().filter((y) => y.done)) store.docs.delete(`${base}${x.id}`);
      store.persist();
      return ok();
    }

    // ---- his log and the milestones, the client's view -----------------------
    if (path === '/api/case-log') {
      const cid = q.get('caseId') || '';
      if (!caseOf(cid)) return fail(404, 'Not found');
      const items = under(`cases/${cid}/caseLog/`).map(([p, d]) => ({ id: p.split('/').pop(), at: d.at, kind: d.kind, who: d.who, summary: d.summary }))
        .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
      const milestones = under(`cases/${cid}/milestones/`).map(([, d]) => ({ what: d.what, kindLabel: d.kindLabel, kindColor: d.kindColor, at: d.at }))
        .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
      return ok({ items, milestones });
    }

    // ---- permissions ---------------------------------------------------------
    if (path === '/api/authority') {
      const cid = body.caseId || q.get('caseId') || '';
      const c = caseOf(cid);
      if (!c) return fail(404, 'Not found');
      const prefix = `cases/${cid}/authority/`;
      if (method === 'GET') {
        const want = q.get('id') || '';
        const items = under(prefix).map(([k, v]) => {
          const { signatureImage, ...rest } = v;
          const rowId = k.slice(prefix.length);
          return { id: rowId, ...rest, hasSignature: !!signatureImage, ...(want && rowId === want ? { signatureImage } : {}) };
        }).sort((a, b) => new Date(b.signedAt || 0) - new Date(a.signedAt || 0));
        return ok({ items });
      }
      await beat(400);
      if (body.action === 'revoke') {
        const cur = store.docs.get(prefix + body.id);
        if (cur?.kind === 'scope')
          return fail(409, 'This is the agreement your case runs on, not a permission. If something in it needs to change, tell me in your case chat and we will settle it together.');
        if (cur) store.docs.set(prefix + body.id, { ...cur, revokedAt: new Date() });
        store.persist();
        return ok();
      }
      if (!['records', 'representative', 'scope'].includes(body.kind)) return fail(400, 'Bad request');
      const typed = String(body.signedName || '').trim();
      if (typed.length < 2) return fail(400, 'Type your full name to sign.');
      const flat = (v) => String(v || '').toLowerCase().replace(/[^a-z]+/g, '');
      if (flat(typed) !== flat(c.clientName)) return fail(400, 'Sign with the same name that is on this case.');
      const scopes = Array.isArray(body.scopes) ? body.scopes.filter((x) => ['discuss', 'records', 'admin'].includes(x)).slice(0, 8) : [];
      if (body.kind === 'records' && !body.clinicName) return fail(400, 'Name the clinic this authorisation is for.');
      if (body.kind === 'representative' && !body.planName) return fail(400, 'Name your insurance plan.');
      if (body.kind === 'records' && !scopes.length) return fail(400, 'Tick at least one thing you are authorising me to do.');
      if (body.kind === 'scope' && body.contactOk !== true) return fail(400, 'Tick the box that lets me phone and text you about your case.');
      if (!/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(String(body.signatureImage || '').trim()))
        return fail(400, 'Sign the document with your finger before sending it.');
      const fid = `f${Date.now().toString(36)}`;
      store.docs.set(prefix + fid, {
        kind: body.kind, signedName: typed, signedAt: new Date(), revokedAt: null,
        expiresAt: new Date(Date.now() + 365 * 86_400_000),
        clinicName: body.clinicName || '', clinicAddress: body.clinicAddress || '', clinicPhone: body.clinicPhone || '',
        fromDate: body.fromDate || '', toDate: body.toDate || '', purpose: body.purpose || '',
        planName: body.planName || '', memberId: body.memberId || '',
        categories: Array.isArray(body.categories) ? body.categories : [], scopes,
        contactOk: body.contactOk === true, signatureImage: body.signatureImage || '',
      });
      store.persist();
      return ok({ ok: true, id: fid, signedAt: new Date().toISOString() });
    }

    // ---- a telehealth visit: included on a Full-Service case, so it goes through
    if (path === '/api/telehealth') {
      const c = caseOf(body.caseId);
      if (!c) return fail(404, 'Not found');
      if (!c.fullAccess) return fail(409, NOT_HERE);
      if (!body.when || Number.isNaN(new Date(body.when).getTime())) return fail(400, 'Pick the date and time of your appointment.');
      if (!body.clinicName) return fail(400, 'Name the clinic.');
      if (!body.provider) return fail(400, "Name the provider we'll be seeing.");
      if (typeof body.attestAt !== 'number') return fail(400, 'Tick the box confirming you are inviting me into your appointment.');
      store.docs.set(`cases/${body.caseId}`, {
        ...c,
        pendingTelehealth: {
          when: new Date(body.when), clinicName: body.clinicName, provider: body.provider,
          attestAt: new Date(body.attestAt), requestedAt: new Date(), state: 'requested', paidCents: 0,
        },
      });
      store.fire(`cases/${body.caseId}`);
      return ok({ ok: true, requested: true });
    }

    // ---- files ---------------------------------------------------------------
    if (path === '/api/file/delete') {
      const p = String(body.path || '');
      if (!new RegExp(`^(cases/${PREVIEW_CASE}/(uploads|chat-files)|profiles/${PREVIEW_UID}/saved)/[^/]+$`).test(p))
        return fail(403, 'Only files you added can be deleted.');
      store.files.delete(p);
      store.fire(p);
      return ok();
    }

    // ---- a review is a real client's, after a real case -----------------------
    if (path === '/api/review') return fail(409, 'Reviews come from real clients after a real case. This one is a preview.');

    // Anything else a client page asks is answered as done, and goes nowhere.
    return ok();
  };
}
