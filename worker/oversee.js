// Eric's three acts on a case someone else works (2026-10-16).
//
// "I should be able to tap on the employee and see things from their
// perspective without being able to interact with their client. I can still
// delete uploads and chats for real employees if I think they're dangerous, as
// well as hit the ⚕️ icon to send them suicide prevention resources with the
// prewritten message."
//
// The quiet view refuses every other write. These three are his alone, and
// each leaves a mark both sides can see: a removed message or file reads
// "Removed by Eric" where it was (his choice, 2026-10-16), and the crisis
// message is from him by name, not from the advocate.
//
//   POST /api/admin/oversee
//     { action: 'remove-message', caseId, msgId }
//     { action: 'remove-file', caseId, path }
//     { action: 'crisis', caseId, text }

import { getDoc, patchDoc, listDocs } from './firestore.js';
import { deleteFile } from './storage.js';
import { notifyUser } from './push.js';
import { advocateIdOf } from './staff.js';

const ID = /^[\w-]{1,64}$/;
// The folders a person shares into. His private shelf and the client's own
// saved folder are not here: neither is something an advocate's client put on
// this case.
const FILE_FOLDERS = ['uploads', 'report', 'recording', 'chat-files'];
export const REMOVED_BY = 'Eric';
const REMOVED_KEEP = 50;

const firstOf = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/** The storage path a chat attachment lives at, from its path or its download url. */
export function attachmentPath(att) {
  if (!att) return '';
  if (typeof att.path === 'string' && att.path) return att.path;
  try {
    const u = new URL(String(att.url || ''));
    const m = u.pathname.match(/\/o\/([^/]+)$/);
    return m ? decodeURIComponent(m[1]) : '';
  } catch { return ''; }
}

export async function handleOversee(request, env, { requireAdmin, json }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'Not found' }, 404);
  const body = await request.json().catch(() => ({}));
  const caseId = String(body?.caseId || '');
  if (!ID.test(caseId)) return json({ error: 'Bad request' }, 400);
  const doc = await getDoc(env, `cases/${caseId}`);
  if (!doc) return json({ error: 'Not found' }, 404);
  const c = doc.data;
  // His own case has nobody on the other side to protect or to send to.
  if (c.self) return json({ error: 'This is your own case.' }, 400);
  const now = new Date();
  const removed = { by: REMOVED_BY, at: now };

  if (body.action === 'remove-message') {
    const msgId = String(body?.msgId || '');
    if (!ID.test(msgId)) return json({ error: 'Bad request' }, 400);
    const path = `cases/${caseId}/chat/${msgId}`;
    const msg = await getDoc(env, path);
    if (!msg) return json({ error: 'Not found' }, 404);
    if (msg.data.removed) return json({ ok: true, already: true });
    const filePath = attachmentPath(msg.data.attachment);
    if (filePath.startsWith(`cases/${caseId}/chat-files/`)) await deleteFile(env, filePath).catch(() => {});
    await patchDoc(env, path, { text: '', attachment: null, quote: null, removed },
      { mask: ['text', 'attachment', 'quote', 'removed'] });
    await fixPreview(env, caseId, c, msg.data);
    return json({ ok: true });
  }

  if (body.action === 'remove-file') {
    const path = String(body?.path || '');
    const m = path.match(/^cases\/([\w-]{1,64})\/([\w-]+)\/[^/]{1,300}$/);
    if (!m || m[1] !== caseId || !FILE_FOLDERS.includes(m[2]) || path.includes('..'))
      return json({ error: 'Bad request' }, 400);
    await deleteFile(env, path).catch(() => {});
    // A file shared in the chat is also a message: that bubble reads removed
    // too, so the thread never holds a picture of a file that is gone.
    if (m[2] === 'chat-files') {
      const msgs = await listDocs(env, `cases/${caseId}/chat`, { all: true }).catch(() => []);
      for (const x of msgs) {
        if (x.data?.removed || attachmentPath(x.data?.attachment) !== path) continue;
        const id = String(x.name || x.id || '').split('/').pop();
        if (!ID.test(id)) continue;
        await patchDoc(env, `cases/${caseId}/chat/${id}`, { text: '', attachment: null, quote: null, removed },
          { mask: ['text', 'attachment', 'quote', 'removed'] });
        await fixPreview(env, caseId, c, x.data);
      }
    }
    // The uploads lists say where a file went. Never its name: the name may
    // be the very thing that was dangerous.
    const list = Array.isArray(c.removedFiles) ? c.removedFiles : [];
    const next = [...list, { kind: m[2], by: REMOVED_BY, at: now }].slice(-REMOVED_KEEP)
      .map((r) => ({ ...r, at: r.at ? new Date(r.at) : now }));
    await patchDoc(env, `cases/${caseId}`, { removedFiles: next }, { mask: ['removedFiles'] });
    return json({ ok: true });
  }

  if (body.action === 'crisis') {
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 4000) return json({ error: 'The message is empty or too long.' }, 400);
    if (c.status === 'closed') return json({ error: 'This case is closed, so its chat is too.' }, 409);
    const id = `eric-${now.getTime().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
    await patchDoc(env, `cases/${caseId}/chat/${id}`, {
      from: env.ADMIN_UID || 'admin', role: 'admin', text, ts: now, byName: REMOVED_BY,
    });
    await patchDoc(env, `cases/${caseId}`, {
      lastMessage: { text: text.slice(0, 120), from: env.ADMIN_UID || 'admin', role: 'admin', ts: now, emailed: false },
    }, { mask: ['lastMessage'] });
    const client = firstOf(c.clientName) || 'your client';
    await notifyUser(env, c.clientUid, {
      title: 'Pocket Advocate', body: 'Eric sent you a message.', link: `/case.html?id=${caseId}`,
    }).catch(() => {});
    // The advocate whose case it is hears it from him too, not from the client.
    const adv = advocateIdOf(c, env);
    if (adv && adv !== env.ADMIN_UID) {
      await notifyUser(env, adv, {
        title: 'Pocket Advocate', body: `Eric sent ${client} a message on your case.`, link: `/admin-case.html?id=${caseId}&page=chat`,
      }).catch(() => {});
    }
    return json({ ok: true, id });
  }

  return json({ error: 'Bad request' }, 400);
}

/** The thread's preview line, if it was the message just removed. */
async function fixPreview(env, caseId, c, msg) {
  const last = c.lastMessage;
  if (!last || last.from !== msg.from) return;
  const was = String(msg.text || (msg.attachment ? `📎 ${msg.attachment.name || 'file'}` : '')).slice(0, 120);
  if (last.text !== was) return;
  await patchDoc(env, `cases/${caseId}`, {
    lastMessage: { ...last, text: `Removed by ${REMOVED_BY}`, ts: last.ts ? new Date(last.ts) : new Date() },
  }, { mask: ['lastMessage'] }).catch(() => {});
}
