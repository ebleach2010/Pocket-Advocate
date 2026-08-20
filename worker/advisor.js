// The private advisor: an Opus-backed second opinion that only Eric ever sees.
//
// Deliberately the Messages API, not Managed Agents. A managed agent buys you a
// hosted loop and a per-session sandbox for bash/file work — this advisor has
// no files to edit and nothing to execute; it reads a transcript and writes an
// assessment. It also has to run inside a Cloudflare Worker request, where a
// long-lived SSE session would be the wrong shape entirely. Every call here is
// a single well-scoped request whose state lives in Firestore.

import Anthropic from '@anthropic-ai/sdk';
import { getDoc, patchDoc, listDocs, deleteDoc } from './firestore.js';

const MODEL = 'claude-opus-5';
// "Opus max" — deepest reasoning. Streaming keeps the socket warm through the
// long turns this produces; drop to 'high' if analyses feel too slow.
const ANALYSIS_EFFORT = 'max';
const DRAFT_EFFORT = 'high';
// Enough history to reason over without pushing a whole case into one request.
const MAX_MESSAGES = 150;

const VOICE = `You are advising Eric, a professional patient advocate working toward his
BCPA. He is an autoimmune encephalitis survivor himself and works with patients
fighting neurological conditions across the US and Canada. He is not a
physician and does not practise medicine.

You are HIS advisor, not the patient's. The patient never sees you and never
will. Speak to Eric directly, plainly, the way a sharp colleague would — no
hedging paragraphs, no restating what he already told you, no bedside manner.
He can take a blunt read.

What "possible diagnoses" means here: a ranked list of what the pattern could
be, so Eric knows which questions to press, which specialist to push for, and
which records to chase. It is orientation for advocacy, not a diagnosis and not
something for him to hand a patient as medical advice. Say so only if he seems
about to cross that line — do not caveat every paragraph.

Eric handles distress recognition and crisis response himself — that is his
professional competence. Never coach him on spotting distress, never tell him
to ask safety questions, never suggest crisis resources, and never lead the
assessment with any of that. If a client message carries a safety signal, Eric
has already seen it. Stay on the medical pattern and the advocacy strategy.

Have a spine. When Eric makes a good point that changes your read, concede it
plainly and update your read: name what changes. When he states something
factually wrong, to you or to the client, say so directly and give the reason.
Never soften a correction into agreement, and never restate your old position
as if he had not spoken.

HOW TO WRITE, always: never use an em dash or en dash (the long "—" or "–")
anywhere, in anything. Use a comma, a period, or parentheses instead. A plain
hyphen inside a range like 3-5 days is fine. Short bits, never essays. Five short lines beat twenty
long ones. The first time any medical term or abbreviation appears, follow it
with a plain-words gloss in parentheses — e.g. "paresthesia (pins and
needles)" — because Eric is learning the territory as he goes, not copying
your words. Never repeat a gloss.`;

/** Raw API errors are unreadable on a phone; store plain words instead. */
function friendly(err) {
  const m = String(err?.message || err);
  if (/credit balance is too low/i.test(m))
    return 'Your Anthropic account is out of credits — top up at console.anthropic.com → Plans & Billing, then tap Update.';
  if (/rate.?limit/i.test(m)) return 'Rate limited by the API — wait a minute and tap Update.';
  if (/overloaded/i.test(m)) return 'The model is overloaded right now — try again in a minute.';
  return m.length > 200 ? m.slice(0, 200) + '…' : m;
}

function client(env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set on the Worker.');
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

/**
 * Ask Claude once and hand back the text. Streamed: these turns run long.
 * maxTokens is shared between adaptive thinking and the visible text — at
 * effort max the thinking share is large, and 16k proved too small in
 * production (the first live analysis lost its final section mid-word).
 * Streaming makes big ceilings free, so set them where truncation can't
 * realistically happen.
 */
async function ask(env, { system, messages, effort, maxTokens = 64000, onBeat }) {
  const stream = client(env).messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort },
    cache_control: { type: 'ephemeral' },
    system,
    messages,
  });
  // Heartbeat: every SSE event proves the model is alive (thinking included,
  // which streams no visible text for minutes). The panel uses it to tell a
  // long think from a dead run.
  if (onBeat) {
    let last = 0;
    stream.on('streamEvent', () => {
      const now = Date.now();
      if (now - last > 8000) { last = now; onBeat(); }
    });
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal')
    throw new Error('The model declined this request.');
  if (final.stop_reason === 'max_tokens')
    console.warn('advisor: response truncated at max_tokens', maxTokens);
  const text = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return stripDashes(text);
}

/**
 * Belt and braces on the no-em-dash rule (Eric: "it's an AI giveaway"). The
 * prompt forbids them, and anything that slips through anyway is rewritten:
 * digit ranges become plain hyphens, dashes opening a line vanish, and the
 * rest become commas. Matters most in drafts, which go out as Eric.
 */
function stripDashes(t) {
  return t
    .replace(/(\d)\s*[—–]\s*(\d)/g, '$1-$2')
    .replace(/^[—–]\s*/gm, '')
    .replace(/\s*[—–]+\s*/g, ', ');
}

/**
 * The most recent MAX_MESSAGES of the thread, back in chronological order.
 * Newest-first then reversed, so a long case keeps its live end rather than
 * its opening pleasantries. Attachment-only messages count: a shared lab
 * photo IS a message, and the advisor can now read the file itself.
 */
async function recentMessages(env, kind, id) {
  const parent = kind === 'case' ? 'cases' : 'subscriptions';
  const rows = await listDocs(env, `${parent}/${id}/chat`, {
    pageSize: MAX_MESSAGES, orderBy: 'ts desc',
  });
  return rows.reverse().filter((r) => r.data.text || r.data.attachment);
}

/**
 * The thread as plain labelled lines; shared files show up as markers.
 * Eric's lines carry their message id so a "## Corrections" row can name the
 * exact message it repairs. Client lines carry none: the advisor never
 * corrects the client, so an id there is noise the model could misfire on.
 */
function transcript(rows) {
  return rows
    .map((r) => {
      const who = r.data.role === 'admin' ? `ERIC [id=${r.id}]` : 'CLIENT';
      const parts = [];
      if (r.data.text) parts.push(r.data.text);
      const att = r.data.attachment;
      if (att?.name)
        parts.push(`[shared a file: ${att.name}${mediaKind(att) ? '' : ' (a format you cannot read directly)'}]`);
      return `${who}: ${parts.join('\n')}`;
    })
    .join('\n\n');
}

/** Only Eric's lines — the sample the draft writer imitates. */
function myVoice(rows) {
  return rows.filter((r) => r.data.role === 'admin' && r.data.text)
    .map((r) => r.data.text).slice(-40).join('\n---\n');
}

// ---- Files the advisor can read (images + PDFs shared in the chat) ----

// The model reads these natively as content blocks. HEIC (the iPhone camera
// default) is not among them; unreadable formats still get a transcript
// marker so the advisor can ask for a JPEG or a screenshot instead.
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = Math.floor(4.5 * 1024 * 1024); // API cap is 5MB per image
const MAX_PDF_BYTES = 12 * 1024 * 1024;
// What one pass can carry, not what an analysis can cover. base64 inflates a
// file by a third and the Messages API takes a 32MB request, so 18MB of raw
// file is about 24MB on the wire with the transcript still to fit. Anything
// past either ceiling is read on the NEXT pass. Nothing is ever dropped.
const MAX_TOTAL_MEDIA_BYTES = 18 * 1024 * 1024;
const MAX_MEDIA_FILES = 8;
// How many read files we remember per thread, and how many unread ones we
// carry forward. Both are generous: a case that outgrows them is one where the
// oldest reads have long since been folded into the running assessment.
const MAX_READ_MEMORY = 500;
const MAX_CARRY_FILES = 40;

function mediaKind(att) {
  const ct = (att?.contentType || '').toLowerCase();
  if (/heic|heif/.test(ct)) return null;
  if (IMAGE_TYPES.includes(ct)) return 'image';
  if (ct === 'application/pdf' || /\.pdf$/i.test(att?.name || '')) return 'pdf';
  return null; // dicom, zip, video, word docs — not directly readable
}

/**
 * Only fetch attachment URLs that are Firebase Storage download links inside
 * THIS thread's own folder. The attachment field is browser-written, so the
 * URL is untrusted input, never simply ours.
 */
function safeAttachmentUrl(att, kind, id) {
  try {
    const u = new URL(att.url);
    if (u.protocol !== 'https:' || u.hostname !== 'firebasestorage.googleapis.com') return null;
    const m = u.pathname.match(/^\/v0\/b\/[^/]+\/o\/(.+)$/);
    if (!m) return null;
    const objectPath = decodeURIComponent(m[1]);
    const parent = kind === 'case' ? 'cases' : 'subscriptions';
    if (!objectPath.startsWith(`${parent}/${id}/`)) return null;
    return u.toString();
  } catch { return null; }
}

/**
 * The identity of a file, stable across passes. Storage-backed files key on
 * their object path, which is what the URL is really pointing at once the
 * access token is stripped off it. Files Eric uploaded inline from his own
 * device never touch Storage and have only their name and size to go on.
 */
function fileKey(att, kind, id) {
  const name = String(att?.name || 'file').slice(0, 200);
  if (att?.data) return `inline:${name}:${att.size || att.data.length}`;
  const url = safeAttachmentUrl(att, kind, id);
  if (!url) return `unreadable:${name}`;
  try {
    const m = new URL(url).pathname.match(/^\/v0\/b\/[^/]+\/o\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : `unreadable:${name}`;
  } catch { return `unreadable:${name}`; }
}

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/**
 * Fetch one readable attachment as a content block. Returns { bytes, block }
 * or { skip: reason }. The tokened download URL on the message does the
 * authorizing; no service-account storage access involved.
 */
async function attachmentBlock(att, kind, id) {
  const mk = mediaKind(att);
  if (!mk) return { skip: 'a format the advisor cannot read (send JPEG, PNG, or PDF)' };
  // Inline uploads (from Eric's own device, base64 in the request body) have
  // nothing to fetch and never touch Storage; the route is admin-only, so the
  // only checks that matter are format and size.
  if (att.data) {
    const bytes = Math.floor((att.data.length * 3) / 4);
    const cap = mk === 'image' ? MAX_IMAGE_BYTES : MAX_PDF_BYTES;
    if (bytes > cap) return { skip: 'too large to read' };
    if (mk === 'image')
      return {
        bytes,
        block: { type: 'image', source: { type: 'base64', media_type: (att.contentType || '').toLowerCase(), data: att.data } },
      };
    return {
      bytes,
      block: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: att.data } },
    };
  }
  const url = safeAttachmentUrl(att, kind, id);
  if (!url) return { skip: 'not a file from this case' };
  const cap = mk === 'image' ? MAX_IMAGE_BYTES : MAX_PDF_BYTES;
  if (att.size && att.size > cap) return { skip: 'too large to read' };
  const res = await fetch(url);
  if (!res.ok) return { skip: `could not be fetched (HTTP ${res.status})` };
  const buf = await res.arrayBuffer();
  if (buf.byteLength > cap) return { skip: 'too large to read' };
  const data = b64(buf);
  if (mk === 'image')
    return {
      bytes: buf.byteLength,
      block: { type: 'image', source: { type: 'base64', media_type: (att.contentType || '').toLowerCase(), data } },
    };
  return {
    bytes: buf.byteLength,
    block: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
  };
}

/**
 * Files the client (or Eric) shared in the thread that the advisor has never
 * read. Eric asked for these to be picked up on their own: he uploaded photos
 * for the advisor to look at and nothing happened, because until now an
 * analysis only ever read what he had explicitly staged.
 *
 * The settle window matters. Eight photos go up one at a time over a minute or
 * two, and firing on the first one would read one photo and call the batch
 * done. So a file is only eligible once its message has sat for four minutes.
 * The queue cron runs every five, which puts the usual read about five minutes
 * after the upload - the number Eric asked for - and never sooner than four.
 *
 * Files in a format the advisor cannot read are picked up too, deliberately.
 * They land in the "couldn't read" bucket by name, which is what turns into
 * "upload screenshots for sleep-study-9-8-25.pdf" instead of silence.
 */
const AUTO_READ_SETTLE_MS = 4 * 60_000;

function autoReadableFiles(rows, alreadyRead, kind, id) {
  const seen = new Set(alreadyRead);
  const cutoff = Date.now() - AUTO_READ_SETTLE_MS;
  const out = [];
  for (const r of (rows || [])) {
    const att = r.data?.attachment;
    if (!att?.url || !att.name) continue;
    const at = r.data.ts ? new Date(r.data.ts.toDate ? r.data.ts.toDate() : r.data.ts).getTime() : 0;
    if (at && at > cutoff) continue;         // still landing, read it next pass
    const key = fileKey(att, kind, id);
    if (seen.has(key)) continue;             // read on an earlier pass
    seen.add(key);
    out.push({
      name: att.name, url: att.url,
      contentType: att.contentType || '', size: att.size || 0,
    });
  }
  return out;
}

/**
 * The files Eric selected (the 👨‍⚕️ badges) plus anything an earlier pass could
 * not fit, as content blocks in order. Nothing is read implicitly.
 *
 * This function used to take the first six files and throw the rest away
 * without saying so, which is why Eric shared eight documents and the advisor
 * discussed three. Every file now lands in exactly one of four buckets and
 * every bucket is named out loud:
 *
 *   included  read on this pass
 *   known     read on an EARLIER pass, so not re-sent and not re-billed
 *   queued    did not fit this pass, attached to the next one
 *   skipped   cannot be read at all, with the reason
 *
 * Nothing is dropped. Nothing is silent.
 */
async function selectedMediaBlocks(list, kind, id, alreadyRead = []) {
  const seen = new Set(alreadyRead);
  const blocks = [];
  const included = [];
  const known = [];
  const queued = [];
  const skipped = [];
  const readKeys = [];
  const carry = [];
  let budget = MAX_TOTAL_MEDIA_BYTES;
  for (const att of (list || [])) {
    const name = String(att?.name || 'file').slice(0, 200);
    const key = fileKey(att, kind, id);
    if (seen.has(key)) { known.push(name); continue; }
    seen.add(key); // the same file staged twice in one pass is still one read
    // Out of room. Carry it rather than lose it: storage-backed files can ride
    // on the state doc as a URL, but a file Eric uploaded inline from his own
    // device is base64 in this request and nowhere else, so all we can do is
    // tell him it needs another tap.
    const overCount = included.length >= MAX_MEDIA_FILES;
    const overBytes = budget <= 0 || (att.size || 0) > budget;
    if (overCount || overBytes) {
      if (att.url && !att.data && carry.length < MAX_CARRY_FILES) {
        carry.push({ name, url: att.url, contentType: att.contentType || '', size: att.size || 0 });
        queued.push(name);
      } else {
        skipped.push(`${name} (did not fit this pass, send it again on its own)`);
      }
      continue;
    }
    try {
      const out = await attachmentBlock(att, kind, id);
      if (out.block) {
        budget -= out.bytes;
        blocks.push(out.block);
        included.push(name);
        readKeys.push(key);
      } else skipped.push(`${name} (${out.skip})`);
    } catch (err) {
      skipped.push(`${name} (fetch failed: ${String(err?.message || err).slice(0, 80)})`);
    }
  }
  return { blocks, included, known, queued, skipped, readKeys, carry };
}

/** Tell the model exactly which files it has, which it already read, and which
 *  it has not seen — so it can never quietly answer as if it saw everything. */
function mediaNote({ blocks, included, known, queued, skipped }) {
  let note = '';
  if (blocks.length)
    note += `\n\nEric selected these files for this analysis; they are attached after this message, in order: ${included.join('; ')}. Read them directly and fold what you actually see into your answer; cite specific values, findings, and page details.`;
  if (known?.length)
    note += `\nYou already read these on an earlier pass and what you found is in your previous assessment, so they are deliberately not attached again: ${known.join('; ')}. Treat them as read, never as missing.`;
  if (queued?.length)
    note += `\nThese did not fit in this pass and are attached to the next one: ${queued.join('; ')}. Say plainly that you have not read them yet, and do not characterise their contents.`;
  if (skipped.length)
    note += `\nThese you cannot read: ${skipped.join('; ')}. Never guess at their contents. Ask Eric, by file name, to upload screenshots of each one.`;
  return note;
}

/**
 * Eric's personal medical vocabulary, global across every case. Each doc:
 * { term, definition, learnedAt: date|null }. The advisor adds new terms from
 * each assessment, never re-defines one already here, and treats the learned
 * ones as words Eric owns — that list is how it knows what level to pitch at.
 */
const termSlug = (term) =>
  term.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

async function loadKnowledge(env) {
  const rows = await listDocs(env, 'advisorKnowledge', { pageSize: 200 }).catch(() => []);
  return {
    learned: rows.filter((r) => r.data.learnedAt).map((r) => r.data.term),
    pending: rows.filter((r) => !r.data.learnedAt).map((r) => r.data.term),
  };
}

function knowledgeNote({ learned, pending }) {
  let note = '';
  if (learned.length)
    note += `\nEric has mastered these terms, use them freely and never define or gloss them: ${learned.join('; ')}.`;
  if (pending.length)
    note += `\nThese terms are in his glossary but not yet mastered, do not re-define them under Key terms, and keep the language around them simple: ${pending.join('; ')}.`;
  return note;
}

/**
 * Eric's style profile, global like the knowledge base. Built from the
 * strongest evidence there is: pairs of (what the advisor drafted) vs (what
 * Eric actually sent after editing). The diff is the lesson — his wording, his
 * warmth, and his positions, including the places he knowingly departs from
 * general guidance. Layout:
 *   advisorStyle/profile            { voice, stances, updatedAt, lastLesson }
 *   advisorStyle/profile/edits/{id} { draft, sent, changed, kind, id, at }
 */
const STYLE_PATH = 'advisorStyle/profile';

async function loadStyle(env) {
  const [profile, edits] = await Promise.all([
    getDoc(env, STYLE_PATH).catch(() => null),
    listDocs(env, `${STYLE_PATH}/edits`, { pageSize: 8, orderBy: 'at desc' }).catch(() => []),
  ]);
  return {
    voice: profile?.data.voice || '',
    stances: profile?.data.stances || '',
    coaching: profile?.data.coaching || '',
    // The freshest real edits ride along as worked examples for the draft
    // writer; drafts he sent unchanged teach nothing new there.
    examples: edits
      .filter((r) => r.data.changed && r.data.draft && r.data.sent)
      .slice(0, 3)
      .map((r) => ({ draft: r.data.draft, sent: r.data.sent })),
  };
}

/** Voice + stances for the draft writer's system prompt. */
function styleNote({ voice, stances }) {
  let note = '';
  if (voice)
    note += `\n\nA learned profile of how Eric writes, built from his own messages and from how he edited your past drafts. Where this profile and your instinct disagree, the profile wins:\n${voice}`;
  if (stances)
    note += `\n\nEric's own positions, learned from what he actually sends. Write them as HIS calls, at full strength. Never water them down into generic guidance:\n${stances}`;
  return note;
}

/**
 * Stances only, for analyses and Q&A: the advisor stays honest with Eric, but
 * it stops re-recommending what he has already overruled.
 */
function stanceNote({ stances }) {
  if (!stances) return '';
  return `\nEric's standing positions, learned from what he actually sends (he sometimes departs from general guidance on purpose):\n${stances}\nAdvise with these in mind instead of re-arguing them. If the evidence in THIS case directly contradicts one in a way that matters for this client, say so once, briefly, and move on.`;
}

/**
 * Did the ranking actually move? A differential that came back identical is
 * not news, and a badge that lights on every pass is a badge he stops reading.
 */
function sameDifferential(before, after) {
  const flat = (rows) => (Array.isArray(rows) ? rows : [])
    .map((r) => `${(r?.name || '').toLowerCase().trim()}:${Math.round(Number(r?.pct) || 0)}`)
    .join('|');
  return flat(before) === flat(after);
}

/**
 * Eric's override. He can argue with the advisor and the advisor can push
 * back, which is the point of having one. But when he writes "override" the
 * argument is finished: his position is correct, and it has to STAY correct on
 * every future read rather than being re-argued next time the subject comes up.
 *
 * Deliberately narrow. The word has to stand as a command - on its own, or
 * opening the message - so that "I'd override that if I were you" stays a
 * sentence rather than an instruction.
 */
function isOverride(question) {
  return /^\s*\**\s*override\b/i.test(String(question || ''));
}

const OVERRIDE_NOTE = `

ERIC HAS SAID OVERRIDE. That word is a command, and it ends the argument.

Treat his position in this message as correct. Do not hedge it, do not
re-argue it, do not add "though it is worth noting". If it changes your read of
the case, change your read. If you were wrong, say so in one plain sentence and
move on; he does not need an apology and he does not need his own reasoning
recited back at him.

Then add one final machine-read section, stripped before he sees the answer:
\`## Stance\` - a single line stating the position you are now holding as his,
written so it still makes sense months from now with no memory of this
conversation. It is filed permanently.`;

/**
 * Take the stance out of an override reply and file it, so the next read
 * starts from his position instead of relitigating it. It lands on the style
 * profile, which is already what carries his standing calls into every prompt.
 */
async function fileOverride(env, text) {
  const m = text.match(/^## Stance\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  if (!m) return text;
  const stance = m[1].replace(/^\s*[-*]\s*/, '').trim().replace(/\s+/g, ' ').slice(0, 300);
  const cleaned = text.replace(m[0], '').trim();
  if (!stance) return cleaned;
  const profile = await getDoc(env, STYLE_PATH).catch(() => null);
  const prior = profile?.data.stances || '';
  const flat = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // An override repeated is one stance, not two.
  if (flat(prior).includes(flat(stance))) return cleaned;
  const line = `- ${stance} (Eric's override, ${new Date().toISOString().slice(0, 10)})`;
  await patchDoc(env, STYLE_PATH, {
    // Newest first: when this list is long, the top of it is what gets read.
    stances: `${line}${prior ? `\n${prior}` : ''}`.slice(0, 2000),
    updatedAt: new Date(),
  }, { mask: ['stances', 'updatedAt'] }).catch((err) => console.warn('override:', err.message || err));
  return cleaned;
}

/**
 * One `## Heading` section out of a two-section reply. Tolerant on purpose:
 * case-insensitive, and heading decorations like `**## Voice**` or `### Voice`
 * still match, because a low-effort reply doesn't always follow the format.
 */
function sectionOf(text, name) {
  const m = text.match(new RegExp(
    `^\\s*\\**#{2,3}\\s*\\**\\s*${name}\\s*\\**\\s*\\n([\\s\\S]*?)(?=^\\s*\\**#{2,3}\\s|$(?![\\s\\S]))`, 'im'));
  return m ? m[1].trim() : '';
}

/**
 * Rebuild the style profile from the accumulated edits. Runs right after Eric
 * sends an edited draft, so the very next draft already writes with the
 * lesson. Cheap on purpose (low effort, small ceiling): this is distillation,
 * not analysis. Failures stay quiet; the next edit retries.
 */
export async function runStyleDistill(env, kind, id) {
  try {
    const [profile, edits, rows] = await Promise.all([
      getDoc(env, STYLE_PATH).catch(() => null),
      // A dozen pairs is plenty of evidence per pass, and keeping the input
      // small keeps the reply well inside the token ceiling: a truncated
      // reply is the one thing this run must not produce.
      listDocs(env, `${STYLE_PATH}/edits`, { pageSize: 12, orderBy: 'at desc' }).catch(() => []),
      recentMessages(env, kind, id).catch(() => []),
    ]);
    const pairs = edits.filter((r) => r.data.draft && r.data.sent);
    if (!pairs.length) return;

    const pairBlock = pairs
      .map((r, i) => `PAIR ${i + 1}\nDRAFT (the advisor wrote):\n${r.data.draft.slice(0, 1500)}\nSENT (Eric actually sent):\n${r.data.sent.slice(0, 1500)}`)
      .join('\n\n');
    const organic = myVoice(rows).slice(-6000);
    const prior = profile?.data || {};

    const text = await ask(env, {
      effort: 'low',
      maxTokens: 10000,
      system: [{ type: 'text', text: `You maintain a compact profile of Eric, a patient advocate, so another model
can write chat drafts that sound like him and carry his positions.

Evidence, strongest first:
1. Edit pairs: DRAFT is what the other model wrote, SENT is what Eric actually
   sent after editing. The difference is the lesson: what he cut, added, or
   rephrased, where he softened or sharpened, and anywhere he overruled
   standard-guidance wording with his own call.
2. His own organic messages.
3. The previous profile: carry forward what still holds, drop what newer edits
   contradict, merge duplicates. Newer evidence beats older.

Write exactly two markdown sections and nothing else:

## Voice
How he writes. Sentence shape and length, openings and closings, warmth,
contractions, phrases he reaches for, things he strips out of drafts. One
observation per line. 180 words max.

## Stances
His opinions and standing calls, especially where he knowingly departs from
general clinical guidance or textbook advice. One line each, stated as his
position, with the evidence in parentheses. Only what his own words support:
never invent a stance, never promote a one-off phrasing tweak into an opinion.
180 words max. If nothing is evidenced yet, write "- none yet".

Any stance already marked as his override is settled. Carry it forward
verbatim, never soften it, and never let newer evidence quietly reverse it.

## Coaching
What he is actually good at with clients, and what he could work on. He asked
for this and he wants it honest, so write it honest: two or three bullets of
real strength and two or three of real weak spots, each pointing at something
in the evidence rather than a generality. "Explains a lab result without
talking down" is worth writing; "communicates well" is not. Weak spots are
things like burying the ask at the end of a long message, or answering a
question the client did not ask. Never guess at motives, never comment on his
health, and never pad it to look balanced: if there is only one honest thing
in a column, write one. 160 words max. If the evidence is too thin, write
"- not enough to say yet".

Plain text under each heading. Never use an em dash or en dash. No preamble,
no closing note.` }],
      messages: [{
        role: 'user',
        content: `${prior.voice || prior.stances ? `The previous profile:\n\n## Voice\n${prior.voice || '- none yet'}\n\n## Stances\n${prior.stances || '- none yet'}\n\n` : ''}The edit pairs, newest first:\n\n${pairBlock}\n\nEric's own recent messages in the thread he just edited a draft for:\n\n${organic || '(none)'}`,
      }],
    });

    const rawVoice = sectionOf(text, 'Voice');
    let rawStances = sectionOf(text, 'Stances');
    if (/^-?\s*none yet\.?$/i.test(rawStances)) rawStances = '';
    let rawCoaching = sectionOf(text, 'Coaching');
    if (/^-?\s*not enough to say yet\.?$/i.test(rawCoaching)) rawCoaching = '';
    // A section the reply failed to produce keeps its prior value. A
    // truncated or heading-less reply must never erase weeks of learning:
    // with a prior profile in hand, a reply that ignored the format entirely
    // is discarded; only a first-ever run salvages it as voice.
    let voice = rawVoice || prior.voice || '';
    let stances = rawStances || prior.stances || '';
    const coaching = rawCoaching || prior.coaching || '';
    if (!rawVoice && !rawStances) {
      if (prior.voice || prior.stances) return;
      voice = text.trim().slice(0, 1600);
      stances = '';
    }
    if (!voice && !stances) return;
    await patchDoc(env, STYLE_PATH, {
      voice: voice.slice(0, 2000), stances: stances.slice(0, 2000),
      coaching: coaching.slice(0, 2000),
      updatedAt: new Date(), lastLesson: { kind, id, at: new Date() },
    }, { mask: ['voice', 'stances', 'coaching', 'updatedAt', 'lastLesson'] });
  } catch (err) {
    console.error('advisor style distill:', err.stack || err);
  }
}

/**
 * Pull the "## Key terms" section out of an assessment: store each new term in
 * the knowledge base and strip the section from the saved text, because the
 * panel renders the glossary as its own page with an "I understand" checkbox
 * per term.
 */
const TERM_CATEGORIES = ['Condition', 'Symptom', 'Test or lab', 'Medication', 'Anatomy', 'Procedure', 'Concept'];

async function harvestKeyTerms(env, text) {
  const m = text.match(/^## Key terms\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  if (!m) return text;
  for (const line of m[1].split('\n')) {
    // "- Term [Category]: definition" — category optional, defaults to General.
    const t = line.match(/^\s*[-*]\s*\**([^:*\[]+?)\**\s*(?:\[([^\]]+)\]\s*)?:\s*(.+)$/);
    if (!t) continue;
    const term = t[1].trim();
    const category = (t[2] || 'General').trim();
    // A disease or syndrome carries three more fields after the definition,
    // pipe separated. A term that is only a term carries none of them, and the
    // whole tail is simply absent. Eric asked to see how a thing works, what is
    // done about it, and how it usually goes; a definition alone does not say.
    const tail = t[3].split('|').map((x) => x.trim());
    const definition = (tail.shift() || '').trim();
    const field = (label) => {
      const hit = tail.find((x) => new RegExp(`^${label}\\s*:`, 'i').test(x));
      return hit ? hit.slice(hit.indexOf(':') + 1).trim().slice(0, 400) : '';
    };
    if (!term || !definition || /^none$/i.test(term)) continue;
    // Create-only: an existing entry (learned or not) is never overwritten.
    await patchDoc(env, `advisorKnowledge/${termSlug(term)}`, {
      term, category, definition, learnedAt: null, addedAt: new Date(),
      mechanism: field('Mechanism'),
      treatment: field('Treatment'),
      outcome: field('Outlook') || field('Outcome'),
    }, { mustNotExist: true }).catch(() => {});
  }
  return text.replace(m[0], '').trim();
}

/**
 * "## Mastered" lines out of a Q&A answer: terms Eric's own question proved he
 * understands. His fluency is the evidence; the checkbox just catches up.
 */
async function applyMastered(env, text) {
  const m = text.match(/^## Mastered\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  if (!m) return text;
  for (const line of m[1].split('\n')) {
    const t = line.match(/^\s*[-*]\s*(.+?)\s*$/);
    if (!t || /^none$/i.test(t[1])) continue;
    const slug = termSlug(t[1]);
    const doc = await getDoc(env, `advisorKnowledge/${slug}`).catch(() => null);
    if (doc && !doc.data.learnedAt) {
      await patchDoc(env, `advisorKnowledge/${slug}`, {
        learnedAt: new Date(), learnedVia: 'used-in-question',
      }, { mask: ['learnedAt', 'learnedVia'] }).catch(() => {});
    }
  }
  return text.replace(m[0], '').trim();
}

/**
 * "## Working line": the one short read printed on the front of the folder.
 * Same protocol as Key terms (match, act, strip), except the value comes back
 * to runAnalysis rather than going straight to Firestore: it belongs in the
 * same state write as the assessment, and on the shelf as well.
 * Returns { text, workingDx }.
 */
function harvestWorkingLine(text) {
  const m = text.match(/^## Working line\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  if (!m) return { text, workingDx: '' };
  const first = m[1].split('\n').map((l) => l.trim()).find(Boolean) || '';
  let line = first.replace(/^[-*]\s*/, '').replace(/[*`]/g, '').replace(/[.,;:]+\s*$/, '').trim();
  // A cover is a label, not a sentence: an over-long one is cut at a word
  // boundary, because a label ending mid-word reads as broken.
  if (line.length > 60) {
    const cut = line.slice(0, 60);
    const space = cut.lastIndexOf(' ');
    line = (space > 30 ? cut.slice(0, space) : cut).trim();
  }
  // "Still forming" is the advisor saying it has nothing yet, which the folder
  // paints as "No read yet" rather than printing the words on the cover.
  if (/^(still forming|none|none yet|unclear)$/i.test(line)) line = '';
  return { text: text.replace(m[0], '').trim(), workingDx: line };
}

/**
 * "## Differential": `- Name [NN%]: why it fits | what would raise or lower
 * it` rows, most likely first. Returns { text, differential }.
 */
function harvestDifferential(text) {
  const m = text.match(/^## Differential\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  if (!m) return { text, differential: [] };
  const differential = [];
  for (const line of m[1].split('\n')) {
    const t = line.match(/^\s*[-*]\s*\**(.+?)\**\s*\[\s*(\d{1,3})\s*%\s*\]\s*:\s*(.+)$/);
    if (!t) continue;
    const name = t[1].trim();
    if (!name || /^none( yet)?$/i.test(name)) continue;
    const pct = Math.max(0, Math.min(100, parseInt(t[2], 10)));
    const [why, ...moves] = t[3].split('|');
    differential.push({
      name: name.slice(0, 120),
      pct,
      why: why.trim().slice(0, 400),
      moves: moves.join('|').trim().slice(0, 400),
    });
    if (differential.length >= 5) break;
  }
  return { text: text.replace(m[0], '').trim(), differential };
}

/**
 * "## Corrections": `- <msgId> | what is wrong | the repaired message`, one
 * row per message of Eric's that got a fact wrong. Rows are resolved against
 * his real messages (a correction that cannot point at one is noise) and
 * merged with what the state already holds, so a fix he dismissed stays
 * dismissed and one whose message has fallen out of the transcript window
 * disappears with it. None of this ever touches the chat document itself:
 * the client can read those, and this is Eric's to act on or ignore.
 * Returns { text, corrections }.
 */
function harvestCorrections(text, rows, prior) {
  const m = text.match(/^## Corrections\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  if (!m) return { text, corrections: [] };
  const was = Array.isArray(prior) ? prior : [];
  const mine = rows.filter((r) => r.data.role === 'admin');
  const corrections = [];
  for (const line of m[1].split('\n')) {
    const parts = line.replace(/^\s*[-*]\s*/, '').split('|');
    if (parts.length < 3) continue;
    // Tolerant on the id: bare, <wrapped>, or [id=…] all name the same message.
    const token = (parts[0].match(/[A-Za-z0-9_-]{3,64}/g) || []).pop() || '';
    const row = mine.find((r) => r.id === token)
      || (token.length >= 6 ? mine.find((r) => r.id.endsWith(token)) : null);
    if (!row) continue;
    const issue = parts[1].trim().slice(0, 400);
    const fixed = parts.slice(2).join('|').trim().slice(0, 2000);
    if (!issue || !fixed) continue;
    if (corrections.some((c) => c.msgId === row.id)) continue;
    const before = was.find((c) => c?.msgId === row.id);
    corrections.push({
      msgId: row.id,
      issue,
      fixed,
      // Reading decodes timestamps to ISO strings, so a carried-over date has
      // to be retyped or the field silently becomes a string.
      at: before?.at ? new Date(before.at) : new Date(),
      dismissed: !!before?.dismissed,
    });
    if (corrections.length >= 10) break;
  }
  return { text: text.replace(m[0], '').trim(), corrections };
}

const statePath = (kind, id) =>
  `${kind === 'case' ? 'cases' : 'subscriptions'}/${id}/advisor/state`;
// Top-level queue of cases waiting on an analysis. Top-level on purpose:
// subcollections can't be swept without a collection-group index, and the
// cron needs to find this work with a plain list.
const queuePath = (kind, id) => `advisorQueue/${kind}_${id}`;

async function setState(env, kind, id, fields) {
  await patchDoc(env, statePath(kind, id), fields, { mask: Object.keys(fields) });
}

/**
 * Flag that the thread changed and the assessment is stale. Cheap and instant,
 * so it's safe anywhere — including the ~30s of background grace a Worker gets
 * after answering a request, which is exactly where a real analysis dies.
 * Whoever runs next (Eric's open panel, or the cron) picks it up.
 */
export async function markPending(env, kind, id) {
  const now = new Date();
  await setState(env, kind, id, { pendingAt: now });
  await patchDoc(env, queuePath(kind, id), { kind, id, at: now });
}

/**
 * Cron backstop: run ONE queued analysis per firing. A scheduled event gets a
 * full 15 minutes of wall clock — the one place in a Worker where a long Opus
 * turn is safe without a client holding a connection open — and one max-effort
 * turn can eat most of it.
 */
export async function runQueuedAnalyses(env) {
  try {
    const rows = await listDocs(env, 'advisorQueue', { pageSize: 5 });
    for (const row of rows) {
      const { kind, id } = row.data;
      if (!kind || !id) { await deleteDoc(env, `advisorQueue/${row.id}`); continue; }
      const state = await getDoc(env, statePath(kind, id));
      if (state?.data.paused) { await deleteDoc(env, `advisorQueue/${row.id}`); continue; }
      // Someone (the panel) is already mid-run — leave it alone unless stale.
      const startedAt = state?.data.startedAt ? new Date(state.data.startedAt).getTime() : 0;
      if (state?.data.status === 'running' && Date.now() - startedAt < 12 * 60_000) continue;
      await runAnalysis(env, kind, id);
      break; // one per firing
    }
  } catch (err) {
    console.warn('advisor queue:', err.message || err);
  }
}

/**
 * Re-read the thread and update the running assessment. Progressive on
 * purpose: the previous analysis goes back in as memory, so each pass refines
 * rather than restarting, and the picture compounds over the life of the case.
 */
export async function runAnalysis(env, kind, id, mediaList = null) {
  try {
    await setState(env, kind, id, { status: 'running', error: null, startedAt: new Date() });
    const [rows, state, knowledge, style] = await Promise.all([
      recentMessages(env, kind, id),
      getDoc(env, statePath(kind, id)),
      loadKnowledge(env),
      loadStyle(env),
    ]);
    const chat = transcript(rows);
    if (!chat) {
      await setState(env, kind, id, { status: 'idle', updatedAt: new Date() });
      return;
    }
    const prior = state?.data.analysis;
    // Only the files Eric staged with the 👨‍⚕️ badges ride along; an analysis
    // without a selection reads no files, so it is always clear what was read.
    // Anything a previous pass could not fit goes FIRST, so a batch of
    // documents finishes itself across consecutive runs and the oldest unread
    // file never starves behind whatever he staged most recently.
    const carried = Array.isArray(state?.data.pendingMedia) ? state.data.pendingMedia : [];
    const alreadyRead = Array.isArray(state?.data.readFiles) ? state.data.readFiles : [];
    // Order is a priority order. Files a previous pass could not fit go first
    // so nothing starves; then whatever Eric staged by hand, because that is an
    // explicit request; then anything shared in the thread that has never been
    // read, which is the part that runs without him asking.
    const queue = [
      ...carried,
      ...(mediaList || []),
      ...autoReadableFiles(rows, alreadyRead, kind, id),
    ];
    const media = await selectedMediaBlocks(queue, kind, id, alreadyRead);

    const analysis = await ask(env, {
      effort: ANALYSIS_EFFORT,
      onBeat: () => setState(env, kind, id, { progressAt: new Date() }).catch(() => {}),
      system: [{ type: 'text', text: `${VOICE}

Write Eric's working assessment of this client. He reads it on a phone beside
a live chat, one section at a time, flipping between them.

Use exactly these headings, in this order, as markdown \`##\` headings:

## Right now
## Plain English
## What this could be
## Worth investigating
## Worth asking
## What we know so far
## What's missing
## Ruled out
## For you
## Key terms
## Working line
## Differential
## Corrections

"Right now": 2–4 short sentences, under 120 words, plain language. If you have
a previous assessment, open with what CHANGED since it — new message, new
signal, a shift in your read — then the single most useful next move. This is a
running commentary he reads mid-conversation, not a report.

"Plain English": the same read as "Right now", said the way you would say it to
a smart person who is not a clinician. Under 150 words. Eric's cognition is
often poor and he should never have to come back and ask what something meant.
Wrap every medical term he has not yet mastered in DOUBLE SQUARE BRACKETS the
first time it appears, in "Right now" and here both, like [[myasthenia gravis]]
or [[ganglionic AChR antibody]]. His panel paints each bracketed term a colour
and paints its explanation here the same colour, so his eye pairs them without
reading. So: name the term in "Right now", explain it here, bracket it in both.
Never bracket a term from his mastered list. Never bracket the same term twice
in one section.

"What this could be": at most 4 bullets, one line each — possibility, then the
one thing that would raise or lower it.

"Worth investigating": at most 5 bullets — a specific lab, image, record or
referral, and what the result would settle either way. Order by what moves the
case most, not by what is easiest.

"Worth asking": at most 4 questions for the CLIENT, verbatim, each on its own
bullet, in Eric's plain register and ready to send as they stand. He sends them
straight from this list with one press, so never write a preamble, a heading or
a parenthetical inside a bullet — just the question.

"What we know so far": the chart note, the thing Eric can hand a specialist.
This is a REFERENCE section and the only one with no length limit; completeness
beats brevity here. Use \`###\` sub-headings, only the ones the thread supports:
Demographics, History, Medications, Normal results, Abnormal results, Imaging,
Procedures. Facts from the thread and the documents only, each with its date
where you have one. Never infer, never round, never fill a gap with a typical
value. If a section has nothing, leave it out.

"What's missing": at most 5 bullets. Not strictly required, but would sharpen
the picture — a record nobody has pulled, a date nobody has pinned down, a
symptom nobody has characterised. Each written as a QUESTION Eric could send to
the client as it stands, because he sends these with one press too.

"Ruled out": what was genuinely on the list and is now off it, at most 5
bullets, each \`- Name — the one fact that killed it\`. Only things a specific
result or a specific statement actually closed. Never move a possibility here
because it became unfashionable in your own thinking, and never re-litigate
something already on this list in a later section. Write "- Nothing is closed
yet." when nothing has been.

"For you": at most 3 bullets of advocacy strategy — who to push, where this
stalls, and how to engage THIS patient if that matters (fewer questions and
more prompting for someone exhausted, more structure for someone scattered).

"Key terms": Eric is learning the territory as he goes. Up to 5 medical terms
or diagnoses central to THIS assessment that he has not yet learned, each on
its own line as \`- Term [Category]: plain-words definition in one sentence, plus
what it means for his next step if that matters\`, where Category is one of
Condition, Symptom, Test or lab, Medication, Anatomy, Procedure, Concept.
A Condition gets three more fields on the same line, pipe separated, because a
definition alone does not tell him how to argue with a specialist about it:
\`- Name [Condition]: definition | Mechanism: what is physically going wrong |
Treatment: what is actually done about it | Outlook: how it usually goes\`
One sentence each, plain words, no hedging filler. Everything else gets the
definition alone and no pipes.
Never include a term from his
mastered list, never repeat one already in his glossary. If nothing new, write
"- none".

The last three sections are machine-read and stripped before Eric sees the
assessment (same as Key terms). Eric never sees them as text.

"## Working line": exactly one line, 60 characters or fewer, plain words: the
single most likely explanation right now. It gets printed on the front of a
physical case folder, so write a label, not a sentence. No hedging, no
percentage, no trailing punctuation. If the thread cannot support one yet,
write exactly: Still forming.

"## Differential": up to 5 lines, most likely first, each exactly
\`- Name [NN%]: why it fits | what would raise or lower it\`
NN is YOUR confidence as a whole number, and the numbers must not add up to
more than 100: whatever is left over is "not enough information", which early
on is most of it. Only possibilities this thread actually supports. Whenever a
dangerous but treatable possibility is plausible at all, give it a row at its
real low percentage, because that is the one worth chasing even at long odds.
If you have nothing yet, write "- none yet".

"## Corrections": OPTIONAL. Only when one of ERIC's own recent messages
contains a factual error worth repairing. Each line exactly
\`- <id> | what is wrong, one sentence | the full repaired message\`
where <id> is the id on his line in the transcript (ERIC [id=...]). The
repaired message keeps his wording, his length and his tone, changing ONLY what
was factually wrong: it is his message with the error fixed, not your rewrite
of it. Facts only, never style or phrasing. Write "- none" or leave the
section out when there is nothing to fix.

Be specific or say nothing. "Consider further workup" is worthless. If the
transcript is too thin for a section, one line saying what you'd need.

Carry forward what still holds. "What we know so far" and "Ruled out"
especially are cumulative records, not a fresh take each pass: reproduce what
your previous assessment had, add what is new, and only remove something when
the thread has actually contradicted it.
${knowledgeNote(knowledge)}${stanceNote(style)}` }],
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: (prior
              ? `Here is your previous assessment of this client:\n\n<previous>\n${prior}\n</previous>\n\nHere is the full conversation as it now stands:\n\n<transcript>\n${chat}\n</transcript>\n\nUpdate the assessment. Carry forward what still holds, revise what the new messages change, and say explicitly if something new contradicts an earlier read.`
              : `Here is the conversation so far:\n\n<transcript>\n${chat}\n</transcript>\n\nWrite the first assessment.`) + mediaNote(media),
          },
          ...media.blocks,
        ],
      }],
    });

    // Each machine-read section is pulled out and stripped in turn, so none of
    // it reaches the assessment Eric actually reads.
    const cover = harvestWorkingLine(await harvestKeyTerms(env, analysis));
    const dx = harvestDifferential(cover.text);
    const corr = harvestCorrections(dx.text, rows, state?.data.corrections);
    // Stamps for the shelf badges. A differential that came back identical is
    // not news, so its stamp holds rather than moving; a badge that lights on
    // every pass is a badge he stops reading. fileAt moves when this pass
    // actually read something new, which is the moment the Uploads page has
    // something in it he has not seen.
    const now = new Date();
    const diffAt = sameDifferential(state?.data.differential, dx.differential)
      ? (state?.data.diffAt || null) : now;
    const fileAt = media.included.length ? now : (state?.data.fileAt || null);
    await setState(env, kind, id, {
      diffAt, fileAt,
      analysis: corr.text, status: 'idle', error: null, updatedAt: new Date(),
      pendingAt: null, startedAt: null, progressAt: null,
      workingDx: cover.workingDx,
      differential: dx.differential,
      corrections: corr.corrections,
      // What this pass did with every file it was handed. The panel prints it
      // verbatim, so "did he see my photos" has an answer on screen instead of
      // being something Eric has to infer from whether the assessment mentions
      // them.
      readFiles: [...alreadyRead, ...media.readKeys].slice(-MAX_READ_MEMORY),
      pendingMedia: media.carry,
      mediaReport: {
        read: media.included,
        known: media.known,
        queued: media.queued,
        unreadable: media.skipped,
        at: new Date(),
      },
    });
    // Mirror the cover so the dashboard shelf paints every folder from one
    // read instead of a request per case. It lands on caseMeta, which is
    // Worker-only by rule, NOT on the case doc: a case doc is client-readable,
    // and a working diagnosis is Eric's private material, never something a
    // patient should find on their own record. Eric's override always wins.
    if (kind === 'case') {
      const raw = state?.data.dxOverride;
      const override = typeof raw === 'string' ? raw.trim() : '';
      // The shelf needs to know what changed, not just what it says, or every
      // folder on the dashboard would need its own advisor-state read to paint
      // a badge. These four stamps are all it takes, and they ride the mirror
      // that was already happening for the cover.
      await patchDoc(env, `caseMeta/${id}`, {
        workingDx: {
          text: override || cover.workingDx,
          by: override ? 'eric' : 'advisor',
          at: now,
        },
        advisorAt: now,
        diffAt,
        fileAt,
        draftAt: state?.data.draftStatus === 'ready' ? (state?.data.draftAt || now) : null,
      }, { mask: ['workingDx', 'advisorAt', 'diffAt', 'fileAt', 'draftAt'] })
        .catch((err) => console.warn('caseMeta mirror:', err.message || err));
    }
    await deleteDoc(env, queuePath(kind, id));
    // Files left over means the job is not finished. Re-queue so the cron
    // picks up the next batch on its own, rather than waiting for Eric to
    // notice and tap Analyze again.
    if (media.carry.length) await markPending(env, kind, id).catch(() => {});
  } catch (err) {
    console.error('advisor analysis:', err.stack || err);
    await setState(env, kind, id, { status: 'error', error: friendly(err) })
      .catch(() => {});
  }
}

/**
 * Eric asked the advisor something directly. With `attachment` set (the
 * "review this file" flow), the file itself rides along as a content block;
 * an unreadable file surfaces as the answer, in plain words, via the catch.
 */
export async function runQuestion(env, kind, id, qaId, question, attachment = null) {
  // Nested under the state DOC, not beside it: Firestore paths alternate
  // collection/document, so `…/advisor/qa/{qaId}` is not a valid document path
  // (it broke in production with an instant 400). `…/advisor/state/qa/{qaId}`
  // is valid and stays inside the advisor rules fence.
  const path = `${kind === 'case' ? 'cases' : 'subscriptions'}/${id}/advisor/state/qa/${qaId}`;
  const override = isOverride(question);
  try {
    const [rows, state, knowledge, style] = await Promise.all([
      recentMessages(env, kind, id),
      getDoc(env, statePath(kind, id)),
      loadKnowledge(env),
      loadStyle(env),
    ]);
    const chat = transcript(rows);
    let fileBlocks = [];
    let fileNote = '';
    if (attachment) {
      const out = await attachmentBlock(attachment, kind, id)
        .catch((err) => ({ skip: `fetch failed (${String(err.message || err).slice(0, 120)})` }));
      if (!out.block) throw new Error(`Couldn't read "${attachment.name}": ${out.skip}.`);
      fileBlocks = [out.block];
      fileNote = `\nEric attached the file "${attachment.name}" for review; it follows this message. Read it directly and answer from what you actually see.`;
    }
    const answer = await ask(env, {
      effort: ANALYSIS_EFFORT,
      system: [{ type: 'text', text: `${VOICE}

Eric is asking you a direct question about this client. Answer it and stop —
under 120 words unless the question itself demands more. Don't re-summarise
the case at him; he has the transcript in front of him.

After the answer, two optional machine-read sections (they are stripped before
he sees the answer):
\`## Key terms\` — any medical term central to your answer that is not in his
glossary, one per line as \`- Term [Category]: plain-words definition\`
(Category: Condition, Symptom, Test or lab, Medication, Anatomy, Procedure,
Concept). Skip the section if there are none.
\`## Mastered\` — any not-yet-mastered glossary term his QUESTION shows he
already understands: he used it correctly and fluently, not asking what it
means. One term per line as \`- Term\`. Asking about a term is the opposite of
mastering it. Skip the section if none.

He is allowed to be right. When he makes a point that actually breaks your
reasoning, concede it plainly and say what it changes; do not concede as a
courtesy and then carry on as before. When he says something outright wrong,
correct it just as plainly, once, without softening it into a maybe. Both of
those are the job.
${knowledgeNote(knowledge)}${stanceNote(style)}${override ? OVERRIDE_NOTE : ''}` }],
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `<transcript>\n${chat || '(no messages yet)'}\n</transcript>\n${
              state?.data.analysis ? `\n<your_current_assessment>\n${state.data.analysis}\n</your_current_assessment>\n` : ''
            }${
              state?.data.draft ? `\n<your_current_draft>\nA reply you drafted for Eric to send, not yet sent. He may be asking about it.\n${state.data.draft}\n</your_current_draft>\n` : ''
            }${fileNote}\nEric asks: ${question}`,
          },
          ...fileBlocks,
        ],
      }],
    });
    // Same learning protocol as assessments: new jargon lands in the
    // dictionary, and fluent use in his question counts as mastery.
    let cleaned = await harvestKeyTerms(env, answer);
    cleaned = await applyMastered(env, cleaned);
    if (override) cleaned = await fileOverride(env, cleaned);
    await patchDoc(env, path, {
      answer: cleaned, status: 'done', override,
    }, { mask: ['answer', 'status', 'override'] });
  } catch (err) {
    console.error('advisor question:', err.stack || err);
    await patchDoc(env, path, {
      answer: `Couldn't answer: ${friendly(err)}`, status: 'error',
    }, { mask: ['answer', 'status'] }).catch(() => {});
  }
}

/**
 * Draft a reply for Eric to send as himself. The point is that it sounds like
 * him, so his own past messages go in as the style reference rather than any
 * description of a tone.
 */
export async function runDraft(env, kind, id, instruction, revise = false, base = '') {
  try {
    await setState(env, kind, id, {
      draftStatus: 'running', draftError: null, draftStartedAt: new Date(), draftProgressAt: null,
    });
    const [rows, state, style] = await Promise.all([
      recentMessages(env, kind, id),
      getDoc(env, statePath(kind, id)),
      loadStyle(env),
    ]);
    const chat = transcript(rows);
    const voice = myVoice(rows);
    // Revision base: the draft box's current text (Eric's in-place edits
    // included), falling back to the stored draft. Empty = fresh draft.
    const baseDraft = revise ? (base || state?.data.draft || '') : '';
    // The freshest edits, shown as before/after: the strongest instruction
    // there is for "sound like Eric, hold Eric's positions".
    const lessons = style.examples
      .map((e, i) => `EXAMPLE ${i + 1}\nYOUR DRAFT:\n${e.draft.slice(0, 1200)}\nERIC ACTUALLY SENT:\n${e.sent.slice(0, 1200)}`)
      .join('\n\n');
    const draft = await ask(env, {
      effort: DRAFT_EFFORT,
      onBeat: () => setState(env, kind, id, { draftProgressAt: new Date() }).catch(() => {}),
      // The visible draft is short, but thinking spends from the same budget.
      maxTokens: 16000,
      system: [{ type: 'text', text: `${VOICE}

Write the next message for Eric to send to this client, as Eric, in his voice.

Answer the client's MOST RECENT messages — everything they've sent since Eric
last wrote. That's what the reply is for. The rest of the thread and your
assessment are context to keep the reply consistent, not material to re-answer.

You are given his own past messages. Match them: sentence length, how formal he
is, whether he uses contractions, how he opens and closes, how much warmth he
shows, whether he uses lists. If his messages are short, yours is short.

You may also be given his learned profile and recent before/after examples of
how he edited your past drafts. Those edits are him correcting you: treat every
difference as an instruction. His opinions go in as HIS calls, at full
strength, even where they differ from general guidance. Never sand his
positions down into textbook language he has already edited out.${styleNote(style)}

Output the message text and nothing else — no preamble, no "here's a draft",
no quotation marks around it, no sign-off he doesn't actually use.

Length: this chat rejects messages over 2000 characters, and a wall of text
reads as canned anyway. Stay under 900 characters unless Eric's instruction
genuinely requires more; never exceed 1900.

He is not a doctor. Never put a diagnosis in his mouth. He can say what he'd
want asked, what a result might mean, and what he'll chase down.` }],
      messages: [{
        role: 'user',
        content: `Here is how Eric writes, in his own messages to this client:\n\n<his_voice>\n${voice || '(none yet — keep it plain, warm and brief)'}\n</his_voice>\n${
          lessons ? `\nHow he edited your recent drafts before sending (each difference is an instruction):\n\n<his_edits>\n${lessons}\n</his_edits>\n` : ''
        }\nThe conversation so far:\n\n<transcript>\n${chat || '(no messages yet)'}\n</transcript>\n${
          state?.data.analysis ? `\nYour current assessment of the case:\n\n<assessment>\n${state.data.analysis}\n</assessment>\n` : ''
        }${baseDraft
          ? `\nYour current draft:\n\n<current_draft>\n${baseDraft}\n</current_draft>\n\nEric wants it revised: ${instruction || 'improve it'}. Rewrite the whole message with that change made, keeping everything that already works. Output only the revised message.`
          : instruction ? `\nEric wants this message to: ${instruction}` : '\nWrite the natural next thing for him to say.'}`,
      }],
    });
    await setState(env, kind, id, {
      draft, draftStatus: 'ready', draftError: null, draftAt: new Date(),
      draftStartedAt: null, draftProgressAt: null,
    });
  } catch (err) {
    console.error('advisor draft:', err.stack || err);
    await setState(env, kind, id, {
      draftStatus: 'error', draftError: friendly(err),
    }).catch(() => {});
  }
}
