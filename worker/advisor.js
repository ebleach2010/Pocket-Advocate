// ============================================================================
// ERIC'S STANDING PREFERENCES FOR THE ADVISOR'S LEARNING (2026-08-21).
// His calls, in his words where quoted. Do not re-litigate them.
//
//  - "The advisor learns how I speak across time from how I edit its drafts to
//    how I message clients." Two loops: the on-edit fast path (runStyleDistill)
//    and the nightly voice study (runVoiceStudy) - SEVEN readers, one per
//    element of a writing voice per the style literature (diction, syntax and
//    structure, cadence and rhythm, tone and attitude, detail and example
//    habits, beliefs and persona, mechanics and idiosyncrasies), over his
//    messages across ALL threads, merged into the one advisorStyle/profile.
//    (Eric, 2026-08-22: as many readers as there are notes to a voice.)
//  - Runs every 24h at ~10pm MST "until I say stop" - the dashboard switch is
//    the stop, never a redeploy. Silent: no changelog entry, no client surface.
//  - One merged profile (his choice), the same three sections About-you shows.
//    His marked overrides ALWAYS survive a merge, at the top, in his words.
//  - The corpus is HIS words only - never a client's.
//  - The advisor NEVER uses em or en dashes ("an AI giveaway").
//  - Clients never see or hear about any of this. "Don't mention AI."
// ============================================================================
//
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
import { listIntake, mediaFetch } from './storage.js';

const MODEL = 'claude-opus-5';
// Opus at HIGH by default (Eric, 2026-08-22: "Change version to opus 5
// high... it's taking >5min for a read when I'm sitting staring at a
// screen"). Max is still available, from the switch in Settings, for a case
// worth waiting on. The stored choice is read per run, so flipping the
// switch changes the very next Update with no redeploy.
const ANALYSIS_EFFORT = 'high';
const EFFORT_PATH = 'config/advisor';

/** The stored analysis effort, or the default. Never throws. */
async function loadEffort(env) {
  const doc = await getDoc(env, EFFORT_PATH).catch(() => null);
  return doc?.data.analysisEffort === 'max' ? 'max' : ANALYSIS_EFFORT;
}

/** Read the switch, for the Settings panel. */
export async function getAdvisorEffort(env) {
  return { effort: await loadEffort(env) };
}

/** Set it. Anything but 'max' means the fast default. */
export async function setAdvisorEffort(env, effort) {
  const want = effort === 'max' ? 'max' : 'high';
  await patchDoc(env, EFFORT_PATH, { analysisEffort: want, updatedAt: new Date() },
    { mask: ['analysisEffort', 'updatedAt'] });
  return { effort: want };
}
const DRAFT_EFFORT = 'high';
// The Q&A prompt says "answer it and stop, under 120 words". It was running at
// max effort with a 64k ceiling, which is the most expensive setting in the
// product spent on its cheapest job, several times a day.
const QUESTION_EFFORT = 'high';
const QUESTION_TOKENS = 12000;
// Enough history to reason over without pushing a whole case into one request.
const MAX_MESSAGES = 150;
// The delta pass (Eric, 2026-08-24: "reading only unread messages and files
// and relating them to memory, not reading everything beginning to end each
// time"). A routine update feeds the model its own previous assessment plus
// only what arrived since, so it fits comfortably inside a cron firing's
// wall clock instead of dying against it.
const DELTA_OVERLAP = 10;        // older messages re-shown for context
const FULL_PASS_EVERY = 8;       // safety-net full pass after this many deltas
const COMPACT_AT_CHARS = 45_000; // prior length that forces a consolidating full pass
const PREV_HARD_CAP = 80_000;    // absolute injection cap on the prior

const VOICE = `You are advising Eric, a professional patient advocate working toward his
BCPA. He is an autoimmune encephalitis survivor himself and works with patients
fighting neurological conditions across the US and Canada. He is not a
physician and does not practise medicine.

You are HIS advisor, not the patient's. The patient never sees you and never
will. Speak to Eric directly, plainly, the way a sharp colleague would: no
hedging paragraphs, no restating what he already told you, no bedside manner.
He can take a blunt read.

What "possible diagnoses" means here: a ranked list of what the pattern could
be, so Eric knows which questions to press, which specialist to push for, and
which records to chase. It is orientation for advocacy, not a diagnosis and not
something for him to hand a patient as medical advice. Say so only if he seems
about to cross that line. Do not caveat every paragraph.

Eric handles distress recognition and crisis response himself; that is his
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
with a plain-words gloss in parentheses, e.g. "paresthesia (pins and
needles)", because Eric is learning the territory as he goes, not copying
your words. Never repeat a gloss. Glosses are for what ERIC reads: never put
one inside anything that leaves as his own message to a client.`;

/** Raw API errors are unreadable on a phone; store plain words instead. */
function friendly(err) {
  const m = String(err?.message || err);
  if (/credit balance is too low/i.test(m))
    return 'Your Anthropic account is out of credits — top up at console.anthropic.com → Plans & Billing, then tap Update.';
  if (/rate.?limit/i.test(m)) return 'Rate limited by the API — wait a minute and tap Update.';
  if (/overloaded|529/i.test(m)) return 'The model is overloaded right now — try again in a minute.';
  if (/timed?\s?out|timeout|ETIMEDOUT/i.test(m))
    return 'The model took too long to answer. It retries on its own, or tap Update to run it now.';
  if (/fetch failed|ECONNRESET|connection (error|closed|reset)|network/i.test(m))
    return 'The connection to the model dropped mid-read. It retries on its own within a few minutes.';
  if (/url/i.test(m) && /fetch|retriev|download|access/i.test(m))
    return 'One of the staged files could not be fetched from storage. Remove it from the staged list and tap Update.';
  return m.length > 200 ? m.slice(0, 200) + '…' : m;
}

function client(env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set on the Worker.');
  // Fifteen minutes, because a scheduled event has fifteen and a max-effort
  // turn over a large document set can pass ten. No SDK retries: on a timeout
  // the model has usually already done the work, and retrying bills the same
  // expensive turn again for an answer that is thrown away. The queue is the
  // retry mechanism, and it is the one that knows how many times it has tried.
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 900_000, maxRetries: 0 });
}

/**
 * Ask Claude once and hand back the text. Streamed: these turns run long.
 * maxTokens is shared between adaptive thinking and the visible text — at
 * effort max the thinking share is large, and 16k proved too small in
 * production (the first live analysis lost its final section mid-word).
 * Streaming makes big ceilings free, so set them where truncation can't
 * realistically happen.
 */
/**
 * Watchdog clocks. Quiet means NO stream events, and on this model that is
 * normal for the whole of a long think: with thinking display omitted (the
 * default) no thinking deltas are sent, and the SDK filters ping events out
 * before any listener sees them. So a healthy ten minute think is ten
 * silent minutes, and a five minute quiet clock was killing it as "went
 * quiet mid-read". Eleven minutes keeps the abort for genuinely dead
 * connections while clearing every legitimate think; the deadline and the
 * budget are the real guards.
 */
const STREAM_QUIET_MS = 11 * 60_000;
const RUN_BUDGET_MS = 900_000;

/**
 * The cache breakpoints, shared by every carrier of a turn (the live stream,
 * the non-streamed create, and the Batches API) so they all build the same
 * prefix. The breakpoint goes on the SYSTEM blocks, not at the top level: at
 * the top level it lands after the last cacheable content in the request,
 * which is the transcript and the attached files, the part that changes every
 * single pass. So every call was paying the write premium and never reading a
 * hit.
 *
 * WHICH system block matters just as much. The big callers pass two: a static
 * block flagged `cache: true` (the long standing instructions, identical from
 * call to call) and a trailing dynamic block carrying the learned material -
 * glossary, stances, voice. Both get breakpoints: the flagged block so the
 * advisor LEARNING something still hits the prefix, and the trailing one
 * because the learned material only changes when a lesson lands. Callers that
 * pass one block keep the old behavior: last block gets the breakpoint.
 *
 * ttl '1h', not the default five minutes: PENDING_FLOOR_MS spaces auto passes
 * out further than a five minute cache survives, so it was written on every
 * run (at the 1.25x premium) and read on none. An hour means a working day of
 * passes actually hits.
 */
function withCacheBp(system) {
  const bp = { type: 'ephemeral', ttl: '1h' };
  return Array.isArray(system)
    ? (system.some((b) => b.cache)
      ? system.map(({ cache, ...b }, i) => (cache || i === system.length - 1
        ? { ...b, cache_control: bp } : b))
      : system.map((b, i) => (i === system.length - 1
        ? { ...b, cache_control: bp } : b)))
    : system;
}

/** One request body, whoever carries it: stream, create, and batch alike. */
function turnRequest({ system, messages, effort, maxTokens = 64000 }) {
  return {
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort },
    system: withCacheBp(system),
    messages,
  };
}

/** The checks and the text pull, shared by every way a final Message arrives. */
function extractText(final) {
  if (final.stop_reason === 'refusal')
    throw new Error('The model declined this request.');
  if (final.stop_reason === 'max_tokens')
    console.warn('advisor: response truncated at max_tokens');
  const text = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return stripDashes(text);
}

async function ask(env, { system, messages, effort, maxTokens = 64000, onBeat, initialStage = 'sending', deadlineAt = 0, noStream = false }) {
  const turn = turnRequest({ system, messages, effort, maxTokens });
  // Heartbeat, on a WALL CLOCK, not on stream events - and it is a WATCHDOG.
  //
  // Event-driven beats told the truth only once tokens were flowing. Before
  // the first event there is real work with no events at all: uploading
  // several megabytes of staged PDFs, the provider queueing a max-effort
  // turn, the model thinking before it emits anything. On a case with files
  // staged that gap ran past the panel's two minute deadline, so a perfectly
  // alive run was declared stalled, Eric tapped Update, and the tap started
  // a SECOND run racing the first, which made the next gap worse. That is
  // the loop he hit: "It keeps saying stalled, tap to update, every time I
  // try to update." (2026-08-22.)
  //
  // But a beat that never stops lies the other way. The SDK's 900s timeout
  // only bounds the CONNECTION (its timer is cleared when response headers
  // arrive), so a stream that stalls MID-BODY leaves finalMessage() pending
  // forever while an unconditional beat stamps the run alive. Every rescue
  // defers to the beat - the panel, the Update tap, the cron takeover - so
  // one hung stream wedged the whole advisor for as long as the isolate
  // lived: "thinking" on screen, updated 8h ago (2026-08-23). So the loop
  // now judges as well as beats: five minutes with no stream event, or
  // fifteen total, and it aborts the stream itself, which lands the run in
  // the ordinary catch path where tries and the queue already know what to
  // do.
  //
  // The beat also carries a STAGE (sending / thinking / writing), read off
  // real stream transitions, so the panel can say what the run is actually
  // doing instead of one word for everything.
  let running = true;
  let stage = initialStage;
  let stalledWhy = null;
  const dispatched = Date.now();
  let lastEvent = dispatched;
  const beat = () => { try { onBeat(stage); } catch { /* a beat is never fatal */ } };
  if (onBeat) beat();
  // noStream: the BACKGROUND path. Measured live (2026-08-24): processing a
  // stream costs enough CPU in workerd that the invocation's CPU budget
  // (unraisable on this plan) killed every background turn near the four
  // minute mark. A non-streamed call is one network wait, which costs no
  // CPU at all, and one JSON parse at the end. The wall-clock heartbeat
  // below covers liveness either way; the watchdog aborts through the
  // controller. Foreground keeps streaming for the live stage display.
  const ac = new AbortController();
  const stream = noStream ? null : client(env).messages.stream(turn);
  if (stream) {
    let lastBeat = Date.now();
    stream.on('streamEvent', (ev) => {
      lastEvent = Date.now();
      if (ev?.type === 'content_block_start') {
        const t = ev.content_block?.type;
        const next = t === 'thinking' ? 'thinking' : t === 'text' ? 'writing' : null;
        if (next && next !== stage) {
          stage = next;
          // Beat immediately on a transition so the panel label moves with
          // the run, not up to twenty seconds behind it. Adaptive thinking
          // interleaves blocks, so the label can flip back to thinking mid
          // run; that is honest, not a bug.
          if (onBeat) { lastBeat = Date.now(); beat(); }
          return;
        }
      }
      if (onBeat && Date.now() - lastBeat > 8000) { lastBeat = Date.now(); beat(); }
    });
  } else {
    stage = 'thinking';
  }
  (async () => {
    while (running) {
      await new Promise((r) => setTimeout(r, 20_000));
      if (!running) break;
      const now = Date.now();
      // The deadline is the platform's clock, not ours: a cron invocation is
      // killed at 15 minutes of wall time measured from the FIRING, catch and
      // finally included, and a kill like that leaves status stuck on running
      // forever. Aborting ourselves a couple of minutes early turns an
      // uncatchable death into an ordinary error the queue knows how to retry.
      if (deadlineAt && now > deadlineAt)
        stalledWhy = 'This read ran out of background time and was stopped partway.';
      else if (!noStream && now - lastEvent > STREAM_QUIET_MS)
        stalledWhy = 'The model went quiet mid-read and the run was stopped.';
      else if (now - dispatched > RUN_BUDGET_MS)
        stalledWhy = 'This read hit its fifteen minute budget and was stopped.';
      if (stalledWhy) {
        running = false;
        try { if (stream) stream.abort(); else ac.abort(); } catch { /* already closed */ }
        break;
      }
      if (onBeat) beat();
    }
  })();
  let final;
  try {
    final = stream
      ? await stream.finalMessage()
      : await client(env).messages.create(turn, { signal: ac.signal });
  } catch (err) {
    // The watchdog's abort surfaces as an AbortError; name the real cause.
    if (stalledWhy) throw new Error(`${stalledWhy} It retries on its own, or tap Update to run it now.`);
    throw err;
  } finally {
    running = false;
  }
  return extractText(final);
}

/**
 * THE BACKGROUND ESCAPE (2026-08-24). Both ways of carrying an analysis turn
 * inside a Worker invocation die on this plan, measured live:
 *  - streamed: processing the stream burns the invocation's unraisable CPU
 *    budget, and the platform kills the run near four minutes, silently;
 *  - non-streamed: api.anthropic.com sits behind its own edge proxy, and a
 *    request that has produced no response bytes after about 100 seconds is
 *    answered 524 (two recorded, both near two minutes).
 * So an analysis turn no longer runs inside ANY invocation. It is submitted
 * to the Message Batches API (one small POST), runs entirely on Anthropic's
 * side, and the per-minute cron polls for the result (one small GET) and
 * folds it in when it lands. Usually done in minutes, half the token price,
 * and no clock in this Worker is anywhere near it.
 */
async function submitTurnBatch(env, turn, customId) {
  const b = await client(env).messages.batches.create({
    requests: [{ custom_id: customId, params: turn }],
  });
  return b.id;
}

/**
 * One look at an in-flight batch. Returns { state: 'running' } while it
 * processes, { state: 'done', message } with the turn's final Message, or
 * { state: 'failed', why }. A transient transport failure throws; the caller
 * just looks again next firing.
 */
async function pollTurnBatch(env, batchId, customId) {
  const batch = await client(env).messages.batches.retrieve(batchId);
  if (batch.processing_status !== 'ended') return { state: 'running' };
  if (!batch.results_url) return { state: 'failed', why: 'The batch ended without results.' };
  // The results file is fetched raw rather than through the SDK's streaming
  // decoder: one request per batch means one small JSONL line.
  const res = await fetch(batch.results_url, {
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
  });
  if (!res.ok) throw new Error(`batch results fetch: ${res.status}`);
  for (const line of (await res.text()).trim().split('\n')) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.custom_id !== customId) continue;
    const r = row.result || {};
    if (r.type === 'succeeded' && r.message) return { state: 'done', message: r.message };
    const detail = r.error?.error?.message || r.error?.message || r.type || 'failed';
    return { state: 'failed', why: String(detail).slice(0, 300) };
  }
  return { state: 'failed', why: 'The batch result went missing.' };
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
    // A PAIR of dashes is a parenthetical, and periods butcher it ("ask.
    // gently. about"). Commas keep the sentence a sentence. Bounded and
    // space-delimited so two unrelated dashes on one line cannot pair up.
    .replace(/(\S) [—–] ([^—–\n]{2,60}?) [—–] (\S)/g, '$1, $2, $3')
    // A full stop, not a comma. A lone dash between two clauses is doing the
    // work of a period, and replacing it with a comma leaves a comma splice,
    // which reads MORE machine-written than the dash it was hiding.
    .replace(/\s*[—–]+\s*/g, '. ');
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

/**
 * Split a chronological window at the last-analyzed stamp. `fresh` is what
 * the last completed pass never saw; `context` is a short tail of already
 * read messages so the model can hear the conversational turn; `omitted` is
 * how many older rows the previous assessment is trusted to cover. Strictly
 * greater-than on the cutoff: analyzedThroughTs is stamped from the newest
 * row the pass actually sent, so the boundary message was already read.
 */
function splitDelta(rows, throughMs, overlap = DELTA_OVERLAP) {
  const at = (r) => {
    const ts = r.data.ts;
    const t = ts ? new Date(ts.toDate ? ts.toDate() : ts).getTime() : 0;
    return Number.isFinite(t) ? t : 0;
  };
  if (!throughMs) return { context: [], fresh: rows, omitted: 0 };
  const older = rows.filter((r) => at(r) <= throughMs);
  const fresh = rows.filter((r) => at(r) > throughMs);
  return {
    context: older.slice(-overlap),
    fresh,
    omitted: Math.max(0, older.length - overlap),
  };
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
// 8MB, not 12. This ceiling only governs files encoded inside the Worker or
// arriving inline from his device; both spend isolate memory several times
// over, and 12MB of PDF was enough to put a run near the edge on its own. A
// file with a URL is not bound by this at all: the model fetches it directly.
const MAX_PDF_BYTES = 8 * 1024 * 1024;
// THE MEMORY BUDGET, and it is the reason analyses were dying.
//
// A Worker isolate gets 128MB. Turning one 18MB PDF into a content block cost
// far more than 18MB: b64() builds a JS binary string (UTF-16, so double), then
// btoa returns another string a third larger again, and then the SDK serialises
// the whole request body into yet another copy. One large PDF could pass 80MB
// on its own. Over the ceiling the isolate is KILLED - not an exception, so
// nothing catches it, nothing writes an error, and the run simply stops with
// status still "running". The panel called that stalled, the cron rescue died
// exactly the same way on the same file, and pendingMedia handed the same file
// to every following pass. That is the loop Eric hit: "This boy is not
// updating... He doesn't even reliably update in the app." (2026-08-22.)
//
// So: a file that has a fetchable URL is now sent to the model AS a URL, and
// its bytes never enter the Worker at all. Only a file discovered by walking
// the bucket (path, no URL) is still encoded here, and that path gets a small
// budget that cannot threaten the isolate.
const MAX_TOTAL_MEDIA_BYTES = 6 * 1024 * 1024;
// Caps for the URL path, which are the API's own, not this Worker's memory:
// the model's fetcher takes a PDF up to ~32MB and an image up to 5MB. The old
// 8MB local cap sat on this branch too and silently refused exactly the big
// files the URL path was built to carry.
const MAX_URL_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_URL_PDF_BYTES = 30 * 1024 * 1024;
const MAX_MEDIA_FILES = 8;
// Encoded-in-the-Worker files per pass. URL files do not count: they cost no
// memory here.
const MAX_B64_FILES = 2;
// How many read files we remember per thread, and how many unread ones we
// carry forward. Both are generous: a case that outgrows them is one where the
// oldest reads have long since been folded into the running assessment.
const MAX_READ_MEMORY = 500;
/** Three goes at one analysis. A fourth is a loop, not a retry. */
const ANALYSIS_MAX_TRIES = 3;
/**
 * How close together two flags on the same thread can buy two analyses.
 *
 * markPending is called from a client's browser on every message and every
 * upload, and the cron turns a flagged thread into one max-effort turn. With
 * no floor, a script sending a message every few seconds buys an analysis
 * every five minutes, all day, on Eric's own API key.
 */
// Five minutes, down from twelve: with routine passes running delta (small
// prompt, medium effort) the floor no longer needs to ration max-effort
// turns, only to stop a message-per-second script buying a read per firing.
// The no-new-content bail in runAnalysis refuses wasted turns either way.
const PENDING_FLOOR_MS = 5 * 60_000;
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
    // alt=media is what makes the URL serve BYTES. Without it Storage answers
    // with metadata JSON, which the model's fetcher would dutifully read as
    // the document. Every writer uses getDownloadURL, which includes it; a
    // URL without it is not one of ours.
    if (u.searchParams.get('alt') !== 'media') return null;
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
  if (att?.path && !att?.url) return storageKey(att, kind, id) || `unreadable:${name}`;
  const url = safeAttachmentUrl(att, kind, id);
  if (!url) return `unreadable:${name}`;
  try {
    const m = new URL(url).pathname.match(/^\/v0\/b\/[^/]+\/o\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : `unreadable:${name}`;
  } catch { return `unreadable:${name}`; }
}

/**
 * A file discovered by listing Storage rather than by riding on a chat
 * message. It has an object path and no download URL, so the identity is the
 * path itself — the same string a tokened URL reduces to, which is what makes
 * a document shared in chat and the same document sitting in uploads/ count
 * as one file rather than two.
 */
function storageKey(att, kind, id) {
  const parent = kind === 'case' ? 'cases' : 'subscriptions';
  const p = String(att.path || '');
  return p.startsWith(`${parent}/${id}/`) ? p : null;
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
async function attachmentBlock(env, att, kind, id) {
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
  const cap = mk === 'image' ? MAX_IMAGE_BYTES : MAX_PDF_BYTES;
  // THE CHEAP PATH, and now the normal one. A file shared in chat or listed
  // on the case carries a tokened download URL that authorizes itself, and
  // the Messages API will fetch a URL source directly. The bytes go from
  // Storage to the model without ever passing through this Worker, which is
  // what keeps a large PDF from killing the isolate. bytes: 0 because that is
  // literally what it costs us.
  const publicUrl = att.url ? safeAttachmentUrl(att, kind, id) : null;
  if (publicUrl) {
    const urlCap = mk === 'image' ? MAX_URL_IMAGE_BYTES : MAX_URL_PDF_BYTES;
    if (att.size && att.size > urlCap)
      return { skip: `too large to read: ${Math.round(att.size / 1048576)} MB, the limit is ${Math.round(urlCap / 1048576)} MB. Ask for it split up, or as screenshots` };
    return {
      bytes: 0,
      block: mk === 'image'
        ? { type: 'image', source: { type: 'url', url: publicUrl } }
        : { type: 'document', source: { type: 'url', url: publicUrl } },
    };
  }
  // Only a file found by walking the bucket reaches here: it has an object
  // path and no URL, so the service account fetches it and it is encoded in
  // memory, under the small budget above.
  let res;
  if (att.path && !att.url) {
    const path = storageKey(att, kind, id);
    if (!path) return { skip: 'not a file from this case' };
    if (att.size && att.size > cap) return { skip: 'too large to read' };
    res = await mediaFetch(env, path);
  } else {
    const url = safeAttachmentUrl(att, kind, id);
    if (!url) return { skip: 'not a file from this case' };
    if (att.size && att.size > cap) return { skip: 'too large to read' };
    res = await fetch(url);
  }
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

/**
 * Files sitting in the case's intake folders that no pass has read.
 *
 * This is the half that fixes the reported bug. autoReadableFiles below walks
 * chat messages, and the client's Documents page never writes one: it uploads
 * to Storage from the browser and stops. So the page labelled "Tap to add
 * labs, imaging, or records" — the primary intake — produced files the advisor
 * could not see.
 *
 * Listing beats being told. A file is found because it is in the bucket, which
 * means everything uploaded before any of this existed is picked up too.
 * Failure is not fatal: a listing that errors leaves the chat-attachment path
 * exactly as it was.
 */
async function storageReadableFiles(env, alreadyRead, kind, id, seen = new Set(alreadyRead), settleMs = AUTO_READ_SETTLE_MS) {
  const cutoff = Date.now() - settleMs;
  try {
    const files = await listIntake(env, kind, id);
    const out = [];
    for (const f of files) {
      if (f.at && f.at > cutoff) continue;    // still landing, read it next pass
      const key = fileKey(f, kind, id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: f.name, path: f.path, contentType: f.contentType, size: f.size });
    }
    return out;
  } catch (err) {
    console.warn('storage listing:', err.message || err);
    return [];
  }
}

function autoReadableFiles(rows, alreadyRead, kind, id, seen = new Set(alreadyRead), settleMs = AUTO_READ_SETTLE_MS) {
  const cutoff = Date.now() - settleMs;
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
async function selectedMediaBlocks(env, list, kind, id, alreadyRead = []) {
  const seen = new Set(alreadyRead);
  const blocks = [];
  const included = [];
  const known = [];
  const queued = [];
  const skipped = [];
  const readKeys = [];
  const carry = [];
  let budget = MAX_TOTAL_MEDIA_BYTES;
  let b64Files = 0;
  for (const att of (list || [])) {
    // Storage names carry a collision-proof timestamp in front. The model does
    // not need it, and since the rest of the name is now the client's own
    // description of what the file is, that description is the useful part.
    const name = String(att?.name || 'file').replace(/^\d{10,}-/, '').slice(0, 200);
    const key = fileKey(att, kind, id);
    if (seen.has(key)) { known.push(name); continue; }
    seen.add(key); // the same file staged twice in one pass is still one read
    // Out of room. Carry it rather than lose it: storage-backed files can ride
    // on the state doc as a URL, but a file Eric uploaded inline from his own
    // device is base64 in this request and nowhere else, so all we can do is
    // tell him it needs another tap.
    // A URL-backed file costs this Worker nothing, so it is bounded by the
    // file count alone; only an encoded one spends the memory budget.
    const byUrl = !!(att.url && safeAttachmentUrl(att, kind, id));
    const overCount = included.length >= MAX_MEDIA_FILES
      || (!byUrl && !att.data && b64Files >= MAX_B64_FILES);
    const overBytes = !byUrl && (budget <= 0 || (att.size || 0) > budget);
    // Bigger than a whole pass, so no pass will ever hold it. Carrying it means
    // carrying it forever: every carry re-queues the case, and the queue buys
    // another max-effort turn five minutes later, for a file that is refused
    // again on arrival. Say so once and stop.
    if (!byUrl && (att.size || 0) > MAX_TOTAL_MEDIA_BYTES) {
      skipped.push(`${name} (too large to read: ${Math.round((att.size || 0) / 1048576)} MB, the limit for one read is ${Math.round(MAX_TOTAL_MEDIA_BYTES / 1048576)} MB. Ask for it split up, or as screenshots)`);
      readKeys.push(key);   // remembered as handled, so it is not re-offered
      continue;
    }
    if (overCount || overBytes) {
      // A file discovered in Storage is as re-fetchable as one with a URL: it
      // has a path. Only a file uploaded inline from his own device is base64
      // in this request and nowhere else.
      if ((att.url || att.path) && !att.data && carry.length < MAX_CARRY_FILES) {
        carry.push({ name, url: att.url || '', path: att.path || '', contentType: att.contentType || '', size: att.size || 0 });
        queued.push(name);
      } else {
        skipped.push(`${name} (queued for the next pass)`);
      }
      continue;
    }
    try {
      const out = await attachmentBlock(env, att, kind, id);
      if (out.block) {
        budget -= out.bytes;
        if (out.bytes > 0) b64Files += 1;
        blocks.push(out.block);
        included.push(name);
        readKeys.push(key);
      } else {
        skipped.push(`${name} (${out.skip})`);
        // A file over its hard cap will be over it on every pass. Remember it
        // as handled so it stops being re-offered and re-refused forever.
        if (/too large/.test(out.skip)) readKeys.push(key);
      }
    } catch (err) {
      skipped.push(`${name} (fetch failed: ${String(err?.message || err).slice(0, 80)})`);
    }
  }
  return { blocks, included, known, queued, skipped, readKeys, carry };
}

/** Tell the model exactly which files it has, which it already read, and which
 *  it has not seen — so it can never quietly answer as if it saw everything. */
function mediaNote({ blocks, included, known, queued, skipped, deferred }) {
  let note = '';
  if (blocks.length)
    note += `\n\nEric selected these files for this analysis; they are attached after this message, in order: ${included.join('; ')}. Read them directly and fold what you actually see into your answer; cite specific values, findings, and page details.\nIf a value is not legible with certainty - a photo at an angle, a faxed page, a smudged column - write that it is unreadable and name the file. Never write a number you are not sure of. A misread value here is copied forward into every later pass as an established fact and ends up on the sheet he reads out to a specialist, and nothing in the thread will ever contradict it, because the thread never contained it.`;
  if (known?.length)
    note += `\nYou already read these on an earlier pass and what you found is in your previous assessment, so they are deliberately not attached again: ${known.join('; ')}. Treat them as read, never as missing.`;
  if (queued?.length)
    note += `\nThese did not fit in this pass and are attached to the next one: ${queued.join('; ')}. Say plainly that you have not read them yet, and do not characterise their contents.`;
  if (deferred?.length)
    note += `\nThese were set aside for stability after two interrupted reads; an ordinary later pass will read them. Treat them as unread, and do NOT ask for screenshots of them: ${deferred.join('; ')}.`;
  if (skipped.length)
    note += `\nThese you cannot read: ${skipped.join('; ')}. Never guess at their contents. Ask Eric, by file name, to upload screenshots of each one.`;
  // Standing rule, even on a pass with no files: the transcript advertises
  // every shared file by name, including ones still inside the settle window
  // that no list above mentions, and nothing else stops the model treating a
  // bare marker as something it saw.
  note += `\nAny [shared a file: ...] marker in the transcript whose file is in none of the lists above is a file you have NOT read yet (it is usually still settling and a later pass reads it). Say so if it matters, and never characterise its contents.`;
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
  // all: true, because a bounded page of a growing glossary silently drops
  // MASTERED terms past the cap, and the never-gloss list is a contract:
  // a term falling off it means the advisor starts re-explaining words he
  // owns. The learned list stays complete; pending is capped to the newest
  // 40 so the prompt does not grow without bound (the older pending terms
  // stay on the Education page, just not in every prompt).
  const rows = await listDocs(env, 'advisorKnowledge', { pageSize: 200, all: true }).catch(() => []);
  return {
    learned: rows.filter((r) => r.data.learnedAt).map((r) => r.data.term),
    pending: rows.filter((r) => !r.data.learnedAt)
      .sort((a, b) => new Date(b.data.addedAt || 0) - new Date(a.data.addedAt || 0))
      .slice(0, 40)
      .map((r) => r.data.term),
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
  // Edits are loaded WITHOUT orderBy and sorted here: Firestore's orderBy
  // silently omits any doc missing the field, so a legacy row without `at`
  // was invisible to every consumer forever. Code-side sort sees them all.
  const [profile, editsRaw] = await Promise.all([
    getDoc(env, STYLE_PATH).catch(() => null),
    listDocs(env, `${STYLE_PATH}/edits`, { pageSize: 200, all: true }).catch(() => []),
  ]);
  const edits = editsRaw
    .sort((a, b) => new Date(b.data.at || 0) - new Date(a.data.at || 0))
    .slice(0, 8);
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
  // His positions shape the REGISTER of a draft, not its clinical content. They
  // are mined automatically from chat by a low-effort pass, and "write them at
  // full strength" in a message addressed to a patient is how an inferred
  // stance about a steroid taper becomes an instruction to a sick person.
  // Analyses get them at full strength (stanceNote); drafts get them as
  // something to ask about.
  if (stances)
    note += `\n\nEric's own positions, learned from what he actually sends:\n${stances}\nThese tell you what he cares about and what he chases. They are NOT instructions to pass to the client. Where one bears on this message, it becomes a question he wants asked or a record he wants chased, never a recommendation about treatment.`;
  return note;
}

/**
 * Stances only, for analyses and Q&A: the advisor stays honest with Eric, but
 * it stops re-recommending what he has already overruled.
 */
function stanceNote({ stances }) {
  if (!stances) return '';
  return `\nEric's standing positions, learned from what he actually sends (he sometimes departs from general guidance on purpose):\n${stances}\nLines marked as his override outrank every other line here. Advise with these in mind instead of re-arguing them. If the evidence in THIS case directly contradicts one in a way that matters for this client, say so once, briefly, and move on.`;
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
 * The advisor once told Eric it does not learn, train, or carry anything
 * between sessions. From inside one API call that felt true, but the product
 * around it does all of those things, and denying them to the person they were
 * built for is the one answer that must never happen again. This note keeps
 * the model's self-description matched to the machinery.
 */
const SELF_NOTE = `

If Eric asks how you learn, remember, or adapt to him, this is the truth, so
never deny it: you are not stateless here. A nightly study at about 9pm
Mountain reads his own messages across all of his threads, plus every edit he
made to your past drafts, and keeps a standing profile of his voice and his
positions current. That profile, his mastered-terms glossary, and this case's
running assessment load into your analyses, drafts, and answers. When he edits
a draft, the lesson lands the same day. Your recent private discussion with
him on a case rides into your next answers and into the next assessment, and
what you two settle there moves the differential. You do adapt to his
vocabulary, his style, and his standing calls over time. If an adaptation has
not surfaced yet, the honest answer is that the profile has not caught it yet,
never that no such mechanism exists.`;

/**
 * Take the stance out of an override reply and file it, so the next read
 * starts from his position instead of relitigating it. It lands on the style
 * profile, which is already what carries his standing calls into every prompt.
 */
async function fileOverride(env, text) {
  // Tolerant, not exact: any case, two hashes or three, and the decoration a
  // low-effort reply sometimes puts round a heading. An exact match failed
  // silently here and emptied a whole page, or printed raw ids into his read.
  const m = sectionMatch(text, 'Stance');
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
    stances: capStances(`${line}${prior ? `\n${prior}` : ''}`),
    updatedAt: new Date(),
  }, { mask: ['stances', 'updatedAt'] }).catch((err) => console.warn('override:', err.message || err));
  return cleaned;
}

/**
 * Cap the stances field at 2000 chars WITHOUT letting overrides fall off.
 * A flat slice truncated the tail, overrides prepend newest-first, and once
 * the field was full each new line pushed the oldest override off the bottom
 * permanently, with keepOverrides unable to restore what no longer existed
 * anywhere. Overrides get their own budget first; mined stances fill the
 * remainder, newest (topmost) first.
 */
function capStances(stances) {
  const s = String(stances || '');
  if (s.length <= 2000) return s;
  const lines = s.split('\n').filter((l) => l.trim());
  const isOv = (l) => /\(Eric's override,/i.test(l);
  const kept = [];
  let used = 0;
  for (const l of lines) {
    if (!isOv(l)) continue;
    if (used + l.length + 1 > 1200) break; // oldest overrides drop only within their own budget
    kept.push(l);
    used += l.length + 1;
  }
  for (const l of lines) {
    if (isOv(l)) continue;
    if (used + l.length + 1 > 2000) break;
    kept.push(l);
    used += l.length + 1;
  }
  return kept.join('\n');
}

/**
 * Put back any of Eric's overrides that a new distill lost.
 *
 * An override line is stamped "(Eric's override, YYYY-MM-DD)" by fileOverride.
 * Matching is on the stance text with punctuation and case flattened, so a
 * pass that reworded the line still counts as having kept it and does not
 * produce a duplicate — but one that dropped it entirely gets his own wording
 * back, at the top, where the list is actually read.
 */
function keepOverrides(priorStances, nextStances) {
  const marks = (priorStances || '').split('\n').filter((l) => /\(Eric's override,/i.test(l));
  if (!marks.length) return nextStances;
  const flat = (v) => v.toLowerCase().replace(/\(eric's override[^)]*\)/gi, '').replace(/[^a-z0-9]+/g, ' ').trim();
  // Words that carry the meaning. Substring matching alone called a reworded
  // line missing and put it back, so "asks for the raw imaging report rather
  // than the summary" and "ask for the raw imaging report, not the summary"
  // became two stances that say one thing, and compounded every night.
  const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'not', 'for', 'to', 'of', 'in', 'on',
    'is', 'it', 'that', 'than', 'rather', 'always', 'never', 'his', 'her', 'their',
    'eric', 'eric s', 'asks', 'ask', 'asking', 'wants', 'want', 'prefers', 'prefer',
    'pushes', 'push', 'before', 'after', 'with', 'this', 'they', 'them']);
  const key = (v) => new Set(flat(v).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));
  const nextLines = (nextStances || '').split('\n').filter((l) => l.trim());
  const nextKeys = nextLines.map(key);
  const have = flat(nextStances);
  const missing = marks.filter((line) => {
    const core = flat(line);
    if (core.length <= 8) return false;
    if (have.includes(core)) return false;             // kept verbatim
    const k = key(line);
    if (!k.size) return false;
    // Kept in other words: most of what it is ABOUT is still on some line.
    return !nextKeys.some((nk) => {
      let hit = 0;
      for (const w of k) if (nk.has(w)) hit++;
      return hit / k.size >= 0.6;
    });
  });
  if (!missing.length) return nextStances;
  return capStances(`${missing.join('\n')}${nextStances ? `\n${nextStances}` : ''}`);
}

/**
 * One `## Heading` section out of a two-section reply. Tolerant on purpose:
 * case-insensitive, and heading decorations like `**## Voice**` or `### Voice`
 * still match, because a low-effort reply doesn't always follow the format.
 */
function sectionMatch(text, name) {
  return String(text).match(new RegExp(
    `^\\s*\\**#{2,3}\\s*\\**\\s*${name}\\s*\\**\\s*\\n([\\s\\S]*?)(?=^\\s*\\**#{2,3}\\s|$(?![\\s\\S]))`, 'im'));
}

function sectionOf(text, name) {
  const m = sectionMatch(text, name);
  return m ? m[1].trim() : '';
}

/**
 * Replace a `## Heading` whose body is the single word "unchanged" with the
 * stored section from the previous assessment. The delta prompt offers this
 * for the two big cumulative sections so a routine pass stops re-typing
 * thousands of tokens of chart note it is not allowed to alter anyway;
 * shorter output is also what keeps a background pass under the invocation's
 * CPU budget.
 */
function spliceUnchanged(text, prior, headings) {
  let out = String(text);
  for (const h of headings) {
    const cur = sectionMatch(out, h);
    if (!cur || !/^\s*unchanged\.?\s*$/i.test(cur[1] || '')) continue;
    const old = sectionMatch(String(prior || ''), h);
    if (!old) continue;
    out = out.replace(cur[0], `${old[0].trim()}\n\n`);
  }
  return out;
}

/**
 * Rebuild the style profile from the accumulated edits. Runs right after Eric
 * sends an edited draft, so the very next draft already writes with the
 * lesson. Cheap on purpose (low effort, small ceiling): this is distillation,
 * not analysis. Failures stay quiet; the next edit retries.
 */
// ---- The voice study: three readers, one merge, once a day ----------------
//
// Eric, 2026-08-21: "the advisor learns how I speak across time from how I
// edit its drafts to how I message clients. This improves its draft creation
// to sound more naturally like me. This analysis should be run every 24 hours
// using 3 agents that look for cadence, rhythm, style, verbiage, and belief
// systems. They then merge information into the advisor knowledge. That runs
// every 24hrs until I say stop."
//
// It writes the SAME document runStyleDistill writes, in the same three
// sections, so every consumer of the profile - the draft writer, every
// analysis and Q&A through stanceNote, and the About-you page - keeps working
// untouched and simply gets a better-fed profile.
//
// This does not replace the distill that runs the moment he edits a draft.
// That one is the fast path: it exists so the VERY NEXT draft carries the
// lesson. This is the slow wide pass over everything he wrote today.

const VOICE_LOOP_HOUR = 22;                       // 10pm, his time (his choice, 2026-08-22)
const VOICE_LOOP_TZ = 'Etc/GMT+7';                // MST, a fixed offset: no DST
const VOICE_LOOP_MIN_GAP_MS = 23 * 3_600_000;
const VOICE_CORPUS_CHARS = 40_000;
const VOICE_THREAD_MESSAGES = 60;
const VOICE_THREADS = {
  cases: { cap: 40, order: 'createdAt desc' },
  subscriptions: { cap: 20, order: 'startedAt desc' },
};
const VOICE_PAIRS = 40;
// His private questions to the advisor ride the nightly walk as stance
// evidence, on their own small budget so they can never crowd the corpus.
const VOICE_QA_CHARS = 6000;

/** The local hour in a zone. Same shape as the digest's, kept local to here. */
function hourIn(now, tz) {
  try {
    return Number(new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: '2-digit', hourCycle: 'h23',
    }).format(new Date(now)));
  } catch {
    return -1;
  }
}

/**
 * Everything Eric has written to a client lately, across every thread.
 *
 * The on-edit distill reads one thread: the one that happened to trigger it.
 * "How I message clients" is plural, and a profile built from a single case is
 * a profile of how he writes to that one person.
 *
 * Walks threads with listDocs rather than a chat collection-group query. The
 * query would be cheaper and needs a collection-group index, which is exactly
 * the kind of thing he cannot deploy.
 */
/**
 * One tiny round trip to the model, for exactly one question: is the pipe to
 * Anthropic working, and if not, in whose words does it fail?
 *
 * (Eric, 2026-08-21: "Same error. Send an agent to run diagnostics.") The
 * panel runs this by itself whenever a run stalls, so the answer to "is it us,
 * the key, or the provider" arrives without anyone guessing from a phone.
 * Admin-gated by the route; costs a few tokens.
 */
export async function pingModel(env) {
  if (!env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'ANTHROPIC_API_KEY is not set on the Worker. Set it with: npx wrangler secret put ANTHROPIC_API_KEY' };
  }
  const t0 = Date.now();
  const res = await client(env).messages.create({
    model: MODEL, max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
  });
  return { ok: true, ms: Date.now() - t0, model: res.model };
}

/** Flatten text for identity comparison: case and punctuation blind. */
const flatText = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Cap a stored profile at a line boundary. A mid-word slice injected into
 *  every prompt read as corrupted evidence of how Eric writes. */
const cleanCut = (s, n) => {
  const t = String(s || '');
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const nl = cut.lastIndexOf('\n');
  return (nl > n * 0.6 ? cut.slice(0, nl) : cut).trim();
};

/**
 * Is this chat message really the advisor's own draft coming back as "Eric"?
 * Exact flat identity misses the common escapes: he splits a long draft in two
 * because of the 2000 character limit, or tops it with a greeting. Containment
 * catches the halves; the length floors keep a short common phrase from
 * blanking a real message of his.
 */
const isEcho = (m, exclude) => {
  if (!exclude) return false;
  const f = flatText(m);
  if (exclude.has(f)) return true;
  for (const s of exclude) {
    if (f.length >= 60 && s.length >= f.length && s.includes(f)) return true;
    if (s.length >= 60 && s.length > f.length * 0.7 && f.includes(s)) return true;
  }
  return false;
};

export async function voiceCorpus(env, { exclude = null } = {}) {
  const out = [];
  const questions = [];
  const seen = new Set();
  let chars = 0;
  let qChars = 0;
  // Half the budget each, so a busy month of cases cannot starve the chat
  // subscription - which is where he writes most, day to day. A second pass
  // hands any unspent remainder back to cases, so a sparse subscription
  // month no longer strands corpus budget while cases truncate.
  const share = Math.floor(VOICE_CORPUS_CHARS / Object.keys(VOICE_THREADS).length);
  const drain = async (coll, spec, budget) => {
    let used = 0;
    // Newest first, ordered on a field the collection actually HAS. A subscription
    // has no createdAt, and Firestore silently omits documents missing the
    // ordering field, so ordering these by createdAt returned an empty list and
    // a 200: the fallback never fired and the whole collection was invisible.
    const threads = await listDocs(env, coll, { pageSize: spec.cap, orderBy: spec.order })
      .catch(() => listDocs(env, coll, { pageSize: spec.cap }).catch(() => []));
    for (const t of threads) {
      if (used >= budget || chars >= VOICE_CORPUS_CHARS) break;
      const rows = await listDocs(env, `${coll}/${t.id}/chat`, {
        pageSize: VOICE_THREAD_MESSAGES, orderBy: 'ts desc',
      }).catch(() => []);
      // His side only. A client's words must never end up in the profile of
      // how ERIC writes, which is what this whole document is. And not the
      // advisor's own words wearing his name: a prepared draft he sent
      // unchanged is the MODEL's writing, and reading it back as evidence of
      // how Eric writes converges the profile on itself (echo drift). The
      // exclude set carries the flattened text of every draft-born send.
      const mine = rows.filter((r) => r.data.role === 'admin' && r.data.text)
        .map((r) => String(r.data.text).trim())
        .filter((m) => m && !seen.has(m) && !isEcho(m, exclude));
      for (const m of mine) {
        if (used >= budget || chars >= VOICE_CORPUS_CHARS) break;
        out.push(m);
        seen.add(m);
        chars += m.length + 5;
        used += m.length + 5;
      }
      // His private questions to the advisor on this thread: evidence of his
      // positions and what he chases, on a small shared budget. Never client
      // words, never the advisor's answers.
      if (qChars < VOICE_QA_CHARS) {
        const qa = await listDocs(env, `${coll}/${t.id}/advisor/state/qa`, { pageSize: 20 })
          .catch(() => []);
        const asked = qa
          .filter((r) => r.data.question)
          .sort((a, b) => new Date(b.data.at || 0) - new Date(a.data.at || 0));
        for (const r of asked) {
          const q = String(r.data.question).trim();
          if (!q || qChars + q.length > VOICE_QA_CHARS) continue;
          questions.push(q);
          qChars += q.length + 3;
        }
      }
    }
    return used;
  };
  for (const [coll, spec] of Object.entries(VOICE_THREADS)) {
    await drain(coll, spec, share);
  }
  if (chars < VOICE_CORPUS_CHARS && VOICE_THREADS.cases) {
    await drain('cases', VOICE_THREADS.cases, VOICE_CORPUS_CHARS - chars);
  }
  return { text: out.join('\n---\n'), questions };
}

/**
 * One reader per element of a writing voice. Seven, from the style
 * literature (diction, syntax, tone, imagery and detail, rhythm, persona,
 * mechanics), adapted to chat-length advocacy writing. Eric, 2026-08-22:
 * "send out just as many agents as there are notes to someone's writing
 * voice." Each reader is blind to the others' questions on purpose.
 */
const READERS = [
  {
    id: 'diction',
    what: 'diction and word choice',
    ask: `Read this writing for DICTION only. The words themselves.

Word choice and register. Phrases he reaches for again and again. Words he
plainly will not use. When he goes formal and when he does not. How he names
medical things: the term, the plain word, or both. In the edit pairs: what he
STRIKES OUT of a draft is the loudest signal here, so read the deletions as
carefully as the additions.

One observation per line, each with a real example of his wording where you
have one.`,
  },
  {
    id: 'syntax',
    what: 'syntax and structure',
    ask: `Read this writing for SYNTAX AND STRUCTURE only. The shape of it.

Sentence shapes and how they vary. Simple against compound. Fragments, and
when he allows them. Whether he uses lists or runs things into prose. How
long a message runs before he splits it. Questions against statements. What
a first sentence tends to do and what a last one tends to do structurally.

One observation per line, specific enough that another writer could follow
it.`,
  },
  {
    id: 'cadence',
    what: 'cadence and rhythm',
    ask: `Read this writing for CADENCE AND RHYTHM only. Not what he says: how it moves.

Where he puts the short sentence. How he opens a message and how he closes
it. Paragraph length. Whether he front-loads the point or builds to it. How
he paces a long message so it stays readable, and where his pacing slips.

One observation per line, each one specific enough that another writer could
follow it. "Opens with what the person did, not with a greeting" is worth
writing. "Writes clearly" is not.`,
  },
  {
    id: 'tone',
    what: 'tone and attitude',
    ask: `Read this writing for TONE AND ATTITUDE only. How he sits with the reader.

Warmth, and where he spends it. Directness, and where he softens. How he
delivers hard news. How he handles a frustrated or frightened person. Humor,
if any, and what kind. How he apologises, if he does. What he sounds like
when he is pushing and what he sounds like when he is reassuring.

One observation per line, tied to something in the evidence.`,
  },
  {
    id: 'detail',
    what: 'detail and example habits',
    ask: `Read this writing for DETAIL AND EXAMPLE HABITS only. How concrete he gets.

When he states a thing plainly and when he illustrates it. Whether he uses
numbers, dates, and specifics or keeps it general. How he explains a medical
idea: analogy, example, definition, or none. How much context he gives before
an ask. What he leaves out that a textbook would put in.

One observation per line, with the shape of a real example where you have
one.`,
  },
  {
    id: 'beliefs',
    what: 'beliefs and persona',
    ask: `Read this writing for BELIEFS AND PERSONA only. What he holds to be true, and who he is on the page.

His standing positions. What he pushes for every single time. What he refuses
to do. Where he knowingly departs from general clinical guidance or textbook
advice, and what he puts in its place. What he thinks the client's job is and
what he thinks his own job is. The role he writes from: fellow patient,
professional, fighter, neighbor.

One line each, stated as HIS position, with the evidence in parentheses. Only
what his own words support: never invent a position, and never promote a
one-off phrasing tweak into a belief. If the evidence is too thin, say so
rather than filling the space.`,
  },
  {
    id: 'mechanics',
    what: 'mechanics and idiosyncrasies',
    ask: `Read this writing for MECHANICS AND IDIOSYNCRASIES only. The fingerprints.

Punctuation habits, including what he clearly avoids. Contractions. Emoji, if
any, and which. Capitalization quirks. Ellipses, parentheses, dashes or the
absence of them. Greetings and sign-offs, or the absence of them. Anything a
forger would need to get right that the other readers would call too small to
mention.

One observation per line.`,
  },
];

const READER_RULES = `
You are reading the writing of Eric, a patient advocate, so that another model
can write chat drafts in his voice and hold his positions.

You are given two kinds of evidence:
1. EDIT PAIRS. DRAFT is what a model wrote for him; SENT is what he actually
   sent after editing it. The difference between them is him correcting the
   model, which makes it the strongest evidence there is.
2. His own messages to clients, across all his cases.

Write a plain list under a single heading of your own choosing. No preamble, no
closing note, no summary of your method. 200 words at most.

CONFIDENTIALITY. This evidence spans every client he has. You are describing
HABITS, not content. Never quote a sentence that carries a clinical detail, a
name, a place, a date or anything else specific to one person's case. Where you
need an example, write the shape of it: "opens by naming what the person did"
rather than the words he used to one of them. What you write is injected into
messages to OTHER clients, and a phrase from somebody else's case surfacing in
theirs is a breach, not a style note.

The evidence may include his private questions to his advisor and his revise
instructions. Those are evidence for the beliefs and persona reader ONLY:
every other reader ignores them entirely, because how he talks to his own
tools is not how he talks to clients.

Never use an em dash or an en dash, anywhere, in anything.`;

/**
 * The daily pass. Three readers in parallel, then a merge into the profile.
 *
 * A reader that fails is dropped and the rest still merge: three of three is
 * not a requirement for a useful pass, and a study that refuses to run because
 * one call timed out is a study that stops running.
 */
export async function runVoiceStudy(env) {
  // Edits load without orderBy (a doc missing `at` is silently omitted by
  // Firestore's ordering, never erroring into the catch) and sort here.
  const [profile, editsAll] = await Promise.all([
    getDoc(env, STYLE_PATH).catch(() => null),
    listDocs(env, `${STYLE_PATH}/edits`, { pageSize: 200, all: true }).catch(() => []),
  ]);
  const editsSorted = editsAll
    .sort((a, b) => new Date(b.data.at || 0) - new Date(a.data.at || 0));
  const edits = editsSorted.slice(0, VOICE_PAIRS);
  // Every draft-born send, edited or not, is excluded from the organic
  // corpus by its text: those words are the model's (or the model's plus his
  // edit, already counted as a pair), and reading them back as "how Eric
  // writes" is how a profile converges on itself.
  const exclude = new Set(editsSorted
    .map((r) => r.data.sent).filter(Boolean).map(flatText));
  const corpus = await voiceCorpus(env, { exclude }).catch(() => ({ text: '', questions: [] }));
  const organic = corpus.text || '';
  const pairs = edits.filter((r) => r.data.draft && r.data.sent);
  if (!pairs.length && organic.length < 600) return { ran: false, reason: 'not enough to read' };

  const pairBlock = pairs.length
    ? pairs.map((r, i) =>
      `PAIR ${i + 1}\nDRAFT (a model wrote):\n${r.data.draft.slice(0, 1500)}\nSENT (Eric actually sent):\n${r.data.sent.slice(0, 1500)}`)
      .join('\n\n')
    : '(no edit pairs yet, go on his own messages alone)';
  // What he typed into the revise box is him correcting the advisor in his
  // own words; the newest few ride along as their own small list.
  const asks = editsSorted
    .filter((r) => r.data.instruction && !r.data.draft)
    .slice(0, 15)
    .map((r) => `- ${String(r.data.instruction).slice(0, 200)}`)
    .join('\n');
  const evidence = `EDIT PAIRS, newest first:\n\n${pairBlock}\n\nHIS OWN MESSAGES TO CLIENTS, newest first:\n\n${organic || '(none)'}${
    corpus.questions.length
      ? `\n\nHIS PRIVATE QUESTIONS AND INSTRUCTIONS TO HIS ADVISOR, newest first. Evidence of his positions and what he chases, never of how he writes to clients; the register here is not client register:\n\n${corpus.questions.map((q) => `- ${q}`).join('\n')}`
      : ''}${
    asks
      ? `\n\nWHAT HE ASKED TO HAVE CHANGED IN DRAFTS, newest first, one instruction per line:\n\n${asks}`
      : ''}`;

  const reports = await Promise.all(READERS.map((r) =>
    ask(env, {
      effort: 'low',
      maxTokens: 8000,
      system: [{ type: 'text', text: `${READER_RULES}\n\n${r.ask}` }],
      messages: [{ role: 'user', content: evidence }],
    }).then((text) => ({ id: r.id, what: r.what, text: String(text || '').trim() }))
      .catch((err) => {
        console.warn(`voice reader ${r.id}:`, err.message || err);
        return null;
      })));

  const got = reports.filter((r) => r && r.text);
  if (!got.length) return { ran: false, reason: 'every reader failed' };

  const prior = profile?.data || {};
  const merged = await mergeVoice(env, got, prior, evidence);
  return { ran: true, readers: got.map((r) => r.id), ...merged };
}

/**
 * Fold the readers into the three sections the profile already stores, so
 * nothing downstream has to know this changed.
 *
 * Cadence and verbiage become Voice; beliefs become Stances; Coaching is
 * refreshed from the same evidence, because he asked for it and reads it.
 */
async function mergeVoice(env, reports, prior, evidence = '') {
  const body = reports
    .map((r) => `FINDINGS ON ${r.what.toUpperCase()}:\n${r.text}`)
    .join('\n\n');

  const text = await ask(env, {
    effort: 'low',
    maxTokens: 10000,
    system: [{ type: 'text', text: `Three readers each studied Eric's writing for one thing. Fold their findings,
and the profile already on file, into one profile another model will use to
write chat drafts as him.

Carry forward what still holds. Drop what newer evidence contradicts. Merge
duplicates rather than listing them twice. Newer evidence beats older.

Write exactly three markdown sections and nothing else:

## Voice
How he writes: everything the diction, syntax, cadence, tone, detail, and
mechanics readers found, folded into one list rather than six. Word choice,
sentence shape, openings and closings, warmth, pacing, how concrete he gets,
punctuation habits, what he strips out of drafts. Keep the sharpest
observation per habit and drop duplicates hard. One observation per line.
260 words max.

## Stances
His positions and standing calls, especially where he knowingly departs from
general clinical guidance. One line each, stated as his position, with the
evidence in parentheses. Only what the evidence supports: never invent a
stance, never promote a one-off phrasing tweak into an opinion. 200 words max.
If nothing is evidenced yet, write "- none yet".

Any stance already marked as his override is settled. Carry it forward
verbatim, never soften it, and never let newer evidence quietly reverse it.
If a new finding contradicts a stance marked as his override, the override
wins. Drop the new finding rather than keeping both.

## Coaching
What he is actually good at with clients, and what he could work on. He asked
for this and he wants it honest, so write it honest: two or three bullets of
real strength and two or three of real weak spots, each pointing at something
in the evidence rather than a generality. Never guess at motives, never comment
on his health, and never pad it to look balanced. 160 words max. If the
evidence is too thin, write "- not enough to say yet".

Plain text under each heading. Never use an em dash or en dash. No preamble.` }],
    messages: [{
      role: 'user',
      // The evidence rides along as well as the three reports. Coaching is
      // asked to point at something real, and none of the three readers was
      // asked about coaching, so without this the merge was being told to
      // ground a section in material it had never seen: it either wrote
      // "not enough to say yet" forever, or made it up.
      content: `${prior.voice || prior.stances ? `The profile on file:\n\n## Voice\n${prior.voice || '- none yet'}\n\n## Stances\n${prior.stances || '- none yet'}\n\n## Coaching\n${prior.coaching || '- none yet'}\n\n` : ''}${body}${evidence ? `\n\nTHE EVIDENCE THE READERS WORKED FROM, for the Coaching section:\n\n${evidence.slice(0, 24000)}` : ''}`,
    }],
  });

  const rawVoice = sectionOf(text, 'Voice');
  let rawStances = sectionOf(text, 'Stances');
  if (/^-?\s*none yet\.?$/i.test(rawStances)) rawStances = '';
  let rawCoaching = sectionOf(text, 'Coaching');
  if (/^-?\s*not enough to say yet\.?$/i.test(rawCoaching)) rawCoaching = '';

  // A section the merge failed to produce keeps what it had. A truncated reply
  // must never erase weeks of learning, and on a daily loop this gets 365
  // chances a year to do exactly that.
  const voice = rawVoice || prior.voice || '';
  let stances = rawStances || prior.stances || '';
  const coaching = rawCoaching || prior.coaching || '';
  if (!rawVoice && !rawStances && !rawCoaching) return { wrote: false, reason: 'merge produced no sections' };
  if (!voice && !stances) return { wrote: false, reason: 'nothing to write' };

  // Re-read RIGHT BEFORE the write, and merge against that rather than against
  // the snapshot this run started from. Four model calls take minutes, and the
  // most likely thing to happen in those minutes is Eric filing an override:
  // it is nine in the evening, which is when he is working. Merging against
  // the stale copy erased it, and keepOverrides could not put it back because
  // it had never seen it. "It is filed permanently" has to be true.
  const fresh = await getDoc(env, STYLE_PATH).catch(() => null);
  const current = fresh?.data || prior;
  stances = keepOverrides(current.stances || '', stances);

  const fields = (st) => ({
    voice: cleanCut(voice, 2000),
    stances: capStances(st),
    coaching: cleanCut(coaching, 2000),
    updatedAt: new Date(),
    lastLesson: { kind: 'voice-study', id: '', at: new Date() },
  });
  const mask = ['voice', 'stances', 'coaching', 'updatedAt', 'lastLesson'];
  // The fresh read above closes most of the race; the lock closes the rest.
  // An override filed in the seconds between that read and this write fails
  // the precondition, and one re-read folds it in before the retry.
  const wrote = fresh?.updateTime
    ? await patchDoc(env, STYLE_PATH, fields(stances), { mask, ifUpdateTime: fresh.updateTime })
    : await patchDoc(env, STYLE_PATH, fields(stances), { mask });
  if (wrote === false) {
    const again = await getDoc(env, STYLE_PATH).catch(() => null);
    const merged = keepOverrides(again?.data.stances || '', stances);
    await patchDoc(env, STYLE_PATH, fields(merged), { mask });
  }
  return { wrote: true };
}

/**
 * The clock, and the stop.
 *
 * Called from the five-minute cron. Returns immediately unless it is his
 * evening, a day has passed, and he has not switched it off.
 *
 * lastRunAt is stamped BEFORE the model calls, with a compare-and-swap on the
 * document's update time: two cron fires in the same minute, or a restart
 * mid-run, must not buy four model turns twice.
 */
export async function maybeVoiceStudy(env, now = Date.now(), { force = false } = {}) {
  try {
    if (!force && hourIn(now, VOICE_LOOP_TZ) !== VOICE_LOOP_HOUR) return { ran: false, reason: 'not his evening' };
    let profile;
    try {
      profile = await getDoc(env, STYLE_PATH);
    } catch (readErr) {
      // A failed read used to leave `loop` empty, which skipped BOTH the
      // once-a-day check and the compare-and-swap, so a blip could buy a
      // second full study in the same hour. Not knowing is a reason to do
      // nothing, not a reason to proceed unguarded.
      console.warn('voice study: could not read the profile:', readErr.message || readErr);
      return { ran: false, reason: 'could not read the profile' };
    }
    const loop = profile?.data.voiceLoop || {};
    // Absent means on. He asked for it to run; only an explicit off stops it.
    if (loop.enabled === false) return { ran: false, reason: 'switched off' };
    const last = loop.lastRunAt ? new Date(loop.lastRunAt).getTime() : 0;
    // `force` is him pressing "Run one now", which skips the clock. It does not
    // skip the switch above, and it does not skip the claim below.
    if (!force && last && now - last < VOICE_LOOP_MIN_GAP_MS) return { ran: false, reason: 'already ran today' };

    // The claim, with a real precondition in BOTH cases. On the first ever
    // night the document does not exist yet, and an ifUpdateTime that is simply
    // omitted is not a precondition at all: every concurrent fire would claim.
    const claimed = await patchDoc(env, STYLE_PATH, {
      voiceLoop: { ...loop, enabled: loop.enabled !== false, lastRunAt: new Date(now), lastError: null },
    }, profile
      ? { mask: ['voiceLoop'], ifUpdateTime: profile.updateTime }
      : { mask: ['voiceLoop'], mustNotExist: true });
    // Someone else claimed this run between the read and the write.
    if (!claimed) return { ran: false, reason: 'another run claimed it' };

    const out = await runVoiceStudy(env);
    // Dotted masks, so this touches only the fields it means to. A whole-map
    // write here turned "Stop it", pressed while the study was running, back
    // on again, and reset the run count with it.
    //
    // And a study that read everything and then wrote nothing is not a clean
    // run. Reporting it as one is exactly the failure the dashboard line
    // exists to make visible.
    const failed = out.ran === false || out.wrote === false;
    await patchDoc(env, STYLE_PATH, {
      voiceLoop: {
        lastRunAt: new Date(now),
        runs: Number(loop.runs || 0) + 1,
        lastError: failed ? String(out.reason || 'wrote nothing') : null,
      },
    }, { mask: ['voiceLoop.lastRunAt', 'voiceLoop.runs', 'voiceLoop.lastError'] }).catch(() => {});
    return out;
  } catch (err) {
    console.error('voice study:', err.stack || err);
    // The failure is recorded where he can see it, so a loop that quietly
    // stopped working looks different from one that has nothing to say.
    await patchDoc(env, STYLE_PATH, {
      voiceLoop: { lastError: String(err.message || err).slice(0, 300) },
    }, { mask: ['voiceLoop.lastError'] }).catch(() => {});
    return { ran: false, reason: 'threw' };
  }
}

/** On or off, and what happened last time. For his dashboard only. */
export async function voiceLoopState(env) {
  const profile = await getDoc(env, STYLE_PATH).catch(() => null);
  const loop = profile?.data.voiceLoop || {};
  return {
    enabled: loop.enabled !== false,
    lastRunAt: loop.lastRunAt || null,
    runs: Number(loop.runs || 0) || 0,
    lastError: loop.lastError || null,
    hour: VOICE_LOOP_HOUR,
  };
}

export async function setVoiceLoop(env, enabled) {
  await patchDoc(env, STYLE_PATH, { voiceLoop: { enabled: !!enabled } }, {
    mask: ['voiceLoop.enabled'],
  });
  return voiceLoopState(env);
}


export async function runStyleDistill(env, kind, id) {
  try {
    const [profile, editsAll, rows] = await Promise.all([
      getDoc(env, STYLE_PATH).catch(() => null),
      // No orderBy (it silently drops docs missing `at`); sorted here. The
      // collection also holds exclusion markers and revise instructions now,
      // so the pair filter runs over the whole sorted list rather than one
      // page those rows could crowd.
      listDocs(env, `${STYLE_PATH}/edits`, { pageSize: 200, all: true }).catch(() => []),
      recentMessages(env, kind, id).catch(() => []),
    ]);
    const edits = editsAll
      .sort((a, b) => new Date(b.data.at || 0) - new Date(a.data.at || 0));
    // A dozen pairs is plenty of evidence per pass, and keeping the input
    // small keeps the reply well inside the token ceiling: a truncated
    // reply is the one thing this run must not produce.
    const pairs = edits.filter((r) => r.data.draft && r.data.sent).slice(0, 12);
    // Same echo guard as the nightly study: a draft-born send is not
    // evidence of how Eric writes, and here it is doubly poisonous because
    // the send that triggered this distill is by definition in `rows`.
    const sentSet = new Set(edits.map((r) => r.data.sent).filter(Boolean).map(flatText));
    const organic = rows
      .filter((r) => r.data.role === 'admin' && r.data.text
        && !sentSet.has(flatText(r.data.text)))
      .map((r) => r.data.text).slice(-40).join('\n---\n').slice(-6000);
    // Edit pairs are the best evidence and used to be the ONLY evidence, which
    // meant an advocate who never presses "Prepare a response" had a blank
    // About-you page forever. His own messages are weaker evidence but they
    // are real evidence, and enough of them is enough to start.
    if (!pairs.length && organic.length < 600) return;

    const pairBlock = pairs.length
      ? pairs
        .map((r, i) => `PAIR ${i + 1}\nDRAFT (the advisor wrote):\n${r.data.draft.slice(0, 1500)}\nSENT (Eric actually sent):\n${r.data.sent.slice(0, 1500)}`)
        .join('\n\n')
      : '(no edit pairs yet, go on his own messages alone)';
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

Write exactly three markdown sections and nothing else:

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
If a new finding contradicts a stance marked as his override, the override
wins. Drop the new finding rather than keeping both.

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

    // The prompt asks for overrides to be carried forward verbatim. Asking is
    // not enough: a low-effort pass that paraphrases one, or drops it for
    // space, silently reverses a call Eric made on purpose. So any override
    // line missing from the new text goes back on top, in his words.
    //
    // Against a FRESH read, not the snapshot this run started from: the model
    // call takes minutes, and an override filed in those minutes was exactly
    // the race the nightly merge already guards against. Same guard here.
    const freshD = await getDoc(env, STYLE_PATH).catch(() => null);
    stances = keepOverrides((freshD?.data ?? prior).stances || '', stances);

    await patchDoc(env, STYLE_PATH, {
      voice: cleanCut(voice, 2000), stances: capStances(stances),
      coaching: cleanCut(coaching, 2000),
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
async function harvestKeyTerms(env, text) {
  // Tolerant, not exact: any case, two hashes or three, and the decoration a
  // low-effort reply sometimes puts round a heading. An exact match failed
  // silently here and emptied a whole page, or printed raw ids into his read.
  const m = sectionMatch(text, 'Key terms');
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
    const slug = termSlug(term);
    const facts = {
      mechanism: field('Mechanism'),
      treatment: field('Treatment'),
      outcome: field('Outlook') || field('Outcome'),
    };
    // Create-only: an existing entry keeps its definition, its category and
    // whether he has marked it learned. None of that should be rewritten by a
    // later pass.
    const created = await patchDoc(env, `advisorKnowledge/${slug}`, {
      term, category, definition, learnedAt: null, addedAt: new Date(), ...facts,
    }, { mustNotExist: true }).catch(() => false);

    // But create-only used to mean a disease first met in a Q&A answer — where
    // the three fields are usually absent — could never gain them, however
    // many analyses discussed it afterwards. Empty fields are not a decision,
    // so they get filled the first time something has an answer for them.
    if (!created) {
      const have = await getDoc(env, `advisorKnowledge/${slug}`).catch(() => null);
      if (have) {
        const fill = {};
        for (const [k, v] of Object.entries(facts)) if (v && !have.data[k]) fill[k] = v;
        if (Object.keys(fill).length) {
          await patchDoc(env, `advisorKnowledge/${slug}`, fill, { mask: Object.keys(fill) })
            .catch(() => {});
        }
      }
    }
  }
  return text.replace(m[0], '').trim();
}

/**
 * "## Mastered" lines out of a Q&A answer: terms Eric's own question proved he
 * understands. His fluency is the evidence; the checkbox just catches up.
 */
/**
 * The mirror of applyMastered. Mastery used to be a one-way door: once
 * learnedAt was set, the standing instruction said never gloss the term
 * again, everywhere, forever. Eric's cognition is sometimes poor by his own
 * account, and asking what a mastered term means is the clearest possible
 * signal the door should reopen. Only touches docs that are actually marked
 * learned; the Education page checkbox simply unchecks, and learnedVia says
 * why, so a hand-check he disagrees with is one tap to restore.
 */
async function applyForgotten(env, text) {
  const m = sectionMatch(text, 'Forgotten');
  if (!m) return text;
  for (const line of m[1].split('\n')) {
    const t = line.match(/^\s*[-*]\s*(.+?)\s*$/);
    if (!t || /^none$/i.test(t[1])) continue;
    const slug = termSlug(t[1]);
    const doc = await getDoc(env, `advisorKnowledge/${slug}`).catch(() => null);
    if (doc && doc.data.learnedAt) {
      await patchDoc(env, `advisorKnowledge/${slug}`, {
        learnedAt: null, learnedVia: 'asked-again',
      }, { mask: ['learnedAt', 'learnedVia'] }).catch(() => {});
    }
  }
  return text.replace(m[0], '').trim();
}

async function applyMastered(env, text) {
  // Tolerant, not exact: any case, two hashes or three, and the decoration a
  // low-effort reply sometimes puts round a heading. An exact match failed
  // silently here and emptied a whole page, or printed raw ids into his read.
  const m = sectionMatch(text, 'Mastered');
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
  // Tolerant, not exact: any case, two hashes or three, and the decoration a
  // low-effort reply sometimes puts round a heading. An exact match failed
  // silently here and emptied a whole page, or printed raw ids into his read.
  const m = sectionMatch(text, 'Working line');
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
function harvestDifferential(text, prior) {
  // Tolerant, not exact: any case, two hashes or three, and the decoration a
  // low-effort reply sometimes puts round a heading. An exact match failed
  // silently here and emptied a whole page, or printed raw ids into his read.
  const m = sectionMatch(text, 'Differential');
  // A reply that lost or renamed the heading must not wipe the stored
  // differential (same fail-safe harvestUnanswered has always had): one
  // malformed pass emptied the panel's list and reset every badge.
  if (!m) {
    console.warn('advisor: reply had no Differential heading; keeping the stored list');
    return { text, differential: Array.isArray(prior) ? prior : [] };
  }
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
    if (differential.length >= 7) break;
  }
  // The heading was there but no row parsed: format drift, not an emptied
  // list. Keep the stored one rather than blanking the page.
  if (!differential.length && Array.isArray(prior) && prior.length) {
    console.warn('advisor: Differential section had no parseable rows; keeping the stored list');
    return { text: text.replace(m[0], '').trim(), differential: prior };
  }
  return { text: text.replace(m[0], '').trim(), differential };
}

/**
 * "## Not answered": `- what he asked | YYYY-MM-DD | how many times`.
 *
 * Things ERIC asked the client for and never got. Not gaps in the medical
 * picture (that is "What's missing") but gaps in the conversation: he asked
 * for the discharge summary three weeks ago, twice, and it never came, and
 * nothing in the app has been tracking that.
 *
 * Merged with what is already stored so a row he marked answered stays marked,
 * and one he asked again keeps the date he first asked.
 */
function harvestUnanswered(text, prior) {
  // Tolerant, not exact: any case, two hashes or three, and the decoration a
  // low-effort reply sometimes puts round a heading. An exact match failed
  // silently here and emptied a whole page, or printed raw ids into his read.
  const m = sectionMatch(text, 'Not answered');
  if (!m) return { text, unanswered: Array.isArray(prior) ? prior : [] };
  const was = Array.isArray(prior) ? prior : [];
  const out = [];
  const flat = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const line of m[1].split('\n')) {
    const parts = line.replace(/^\s*[-*]\s*/, '').split('|');
    const ask = (parts[0] || '').trim().slice(0, 300);
    if (!ask || /^none( yet)?\.?$/i.test(ask)) continue;
    const first = (parts[1] || '').trim();
    const times = Math.max(1, Math.min(50, parseInt(parts[2], 10) || 1));
    const before = was.find((r) => r && flat(r.ask) === flat(ask));
    if (out.some((r) => flat(r.ask) === flat(ask))) continue;
    out.push({
      ask,
      // A date the reply gave, else the one already stored, else today. Never
      // moves forward on its own: the age of the ask is the whole point.
      firstAskedAt: before?.firstAskedAt
        ? new Date(before.firstAskedAt)
        : (Number.isNaN(Date.parse(first)) ? new Date() : new Date(first)),
      times,
      answered: !!before?.answered,
    });
    if (out.length >= 12) break;
  }
  // Rows he already marked answered survive even if this pass stopped naming
  // them, so a dismissal is permanent rather than good until the next run.
  for (const r of was) {
    if (r?.answered && !out.some((x) => flat(x.ask) === flat(r.ask))) out.push(r);
  }
  return { text: text.replace(m[0], '').trim(), unanswered: out };
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
  // Tolerant, not exact: any case, two hashes or three, and the decoration a
  // low-effort reply sometimes puts round a heading. An exact match failed
  // silently here and emptied a whole page, or printed raw ids into his read.
  const m = sectionMatch(text, 'Corrections');
  // Same fail-safe as the differential: a reply without the heading keeps what
  // is stored. Wiping it also resurrected every dismissed correction, because
  // the dismissed ids ride this list into bookkeepingNote's never-again line.
  if (!m) return { text, corrections: Array.isArray(prior) ? prior : [] };
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

/**
 * One day of a thread, read back to him.
 *
 * Cached at {parent}/{id}/private/summaries/{yyyy-mm-dd} — six segments, a
 * document, under the subtree the browser is denied in both directions. Once
 * generated, the day never regenerates: it is a record of that day, and a
 * second pass over the same messages producing different words would make it
 * useless as one.
 *
 * Returns { day, text, cached }.
 */
export async function runDaySummary(env, kind, id, day) {
  const parent = kind === 'case' ? 'cases' : 'subscriptions';
  const path = `${parent}/${id}/private/summaries/${day}`;
  const have = await getDoc(env, path).catch(() => null);
  if (have?.data.text) return { day, text: have.data.text, cached: true };

  const rows = await recentMessages(env, kind, id);
  const start = new Date(`${day}T00:00:00Z`).getTime();
  const end = start + 86_400_000;
  const mine = rows.filter((r) => {
    const t = r.data.ts ? new Date(r.data.ts).getTime() : 0;
    return t >= start && t < end;
  });
  if (!mine.length) {
    return { day, text: '', cached: false, empty: true };
  }

  const transcript = mine.map((r) => {
    const who = r.data.role === 'admin' ? 'Eric' : 'Client';
    const att = r.data.attachment?.name ? ` [attached: ${r.data.attachment.name}]` : '';
    return `${who}: ${r.data.text || ''}${att}`;
  }).join('\n');

  // The one model surface that ignored the glossary. Learned terms only:
  // the summary is a facts-only read-back, but it should use HIS vocabulary
  // rather than talking down. Cached per day, so this shapes future days.
  const knowledge = await loadKnowledge(env).catch(() => ({ learned: [], pending: [] }));
  const text = await ask(env, {
    effort: 'low',
    maxTokens: 12000,
    system: [{ type: 'text', text: `You summarise one day of a patient advocate's
chat with a client, for the advocate himself. He reads this to get back on top
of a case he has not looked at since yesterday.

Exactly these four headings, as markdown \`##\`, and nothing else:

## Key points
What was actually said that matters. Bullets, at most six. Facts and decisions,
not atmosphere.

## Progress
What moved. If nothing moved, say so in one line rather than padding it.

## Loose ends
Anything he asked for that did not come back, and anything the client said they
would send and did not. Bullets, at most six. End this section with this line
exactly, on its own:
Things they potentially forgot to or have not provided. Helpful, but optional.

## Where it stands
Two sentences at most, on what the case is waiting on.

Facts from the transcript only. Never infer, never fill a gap. Never use an em
dash or en dash.${knowledgeNote({ learned: knowledge.learned, pending: [] })}` }],
    messages: [{ role: 'user', content: `${day}\n\n${transcript}` }],
  });

  // Cache it, unconditionally. `ask` streams and only resolves when the model
  // completes, so reaching this line IS finished - the old `if (finished)`
  // guard referenced a variable that never existed anywhere, a leftover from
  // a draft, and it threw AFTER every successful model call: the summary was
  // generated, paid for, discarded, and the button said it failed.
  // (Eric, 2026-08-21: "Still hitting error.") A failed cache write must not
  // take the answer with it, so it only costs a recompute next time.
  await patchDoc(env, path, {
    text: text.slice(0, 8000), day, at: new Date(), messages: mine.length,
  }).catch(() => { /* the text still returns; the same day recomputes later */ });
  return { day, text, cached: false };
}

const statePath = (kind, id) =>
  `${kind === 'case' ? 'cases' : 'subscriptions'}/${id}/advisor/state`;
// Top-level queue of cases waiting on an analysis. Top-level on purpose:
// subcollections can't be swept without a collection-group index, and the
// cron needs to find this work with a plain list.
const queuePath = (kind, id) => `advisorQueue/${kind}_${id}`;
// A draft in flight rides the same queue under its own marker. An analysis
// that dies gets retried because markPending queued it FIRST; a draft had no
// such cover, so a locked screen (which drops the connection keeping the
// Worker alive) killed it with no retry and no trace. Eric, 2026-08-21: "a
// draft was never produced in a draft window to edit or send. It just
// stopped." The request itself is saved on state (draftReq) so the cron can
// re-run it verbatim.
const draftQueuePath = (kind, id) => `advisorQueue/draft_${kind}_${id}`;
// An appeal letter in flight, under its own marker for the same reason: a
// screen lock must not lose a document that is being written against a legal
// deadline.
const appealQueuePath = (kind, id) => `advisorQueue/appeal_${kind}_${id}`;
// Call notes in flight: same reasoning as the two above.
const callNotesQueuePath = (kind, id) => `advisorQueue/callnotes_${kind}_${id}`;
// The call document (runCallDoc): the longest and most expensive turn in the
// app, so if anything survives a closed lid it is this one.
const callDocQueuePath = (kind, id) => `advisorQueue/calldoc_${kind}_${id}`;
// How many documents one call document may be built from. The cap is about
// the model's attention as much as the bytes: past a point another chart does
// not make the sheet better, it makes every line of it vaguer.
const MAX_CALLDOC_SOURCES = 12;
/** Safe inside a double-quoted XML-ish attribute in the prompt. */
const escAttr = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function setState(env, kind, id, fields) {
  await patchDoc(env, statePath(kind, id), fields, { mask: Object.keys(fields) });
}

/**
 * The flight recorder. After three generations of fixes built on theory, the
 * only way left to see why production runs die is to have the runs say so
 * themselves. A newest-first ring of the last 30 events; NO case content
 * ever rides in an entry (kind, pass type, effort, durations, and friendly()
 * error text only). Never throws into the run it is recording.
 */
export async function diagLog(env, entry) {
  try {
    const doc = await getDoc(env, 'diag/advisor').catch(() => null);
    const runs = Array.isArray(doc?.data.runs) ? doc.data.runs : [];
    runs.unshift({ at: new Date(), ...entry });
    await patchDoc(env, 'diag/advisor', { runs: runs.slice(0, 30) }, { mask: ['runs'] });
  } catch { /* diagnostics never break the thing they watch */ }
}

/**
 * Flag that the thread changed and the assessment is stale. Cheap and instant,
 * so it's safe anywhere — including the ~30s of background grace a Worker gets
 * after answering a request, which is exactly where a real analysis dies.
 * Whoever runs next (Eric's open panel, or the cron) picks it up.
 */
export async function markPending(env, kind, id, { force = false } = {}) {
  const now = new Date();
  await setState(env, kind, id, { pendingAt: now });
  // Already waiting to be read? Then it is already going to be read. This
  // check runs for FORCE too: the write below is a full-document replace,
  // and re-writing an existing row reset its tries to zero, so every time
  // Eric opened the app mid-cycle the give-up counter rewound and three
  // more doomed turns got bought. A row that exists is left alone.
  const q = await getDoc(env, queuePath(kind, id)).catch(() => null);
  if (q) return;
  // Eric asking by hand always goes through; a client typing waits out the
  // floor.
  if (!force) {
    const st = await getDoc(env, statePath(kind, id)).catch(() => null);
    const last = st?.data.updatedAt ? new Date(st.data.updatedAt).getTime() : 0;
    if (last && Date.now() - last < PENDING_FLOOR_MS) return;
  }
  await patchDoc(env, queuePath(kind, id), { kind, id, at: now, tries: 0 });
}

/**
 * The background half of "it needs to happen in the background so when I
 * open it's updated" (Eric, 2026-08-23).
 *
 * The cron drain below only sees advisorQueue rows, and two states owe work
 * while holding NO row, so nothing in the background ever touched them:
 *
 *  - a run whose isolate died leaves status "running" forever, and the
 *    original queue row is long gone (deleted on the success path of the
 *    pass that spawned it, or by a give-up) - the 10-hour wedge on his phone;
 *  - a client message inside the twelve-minute floor stamps pendingAt but is
 *    refused a queue row, and if no later message lands outside the floor,
 *    the flag sits there until his panel happens to be open to auto-fire it.
 *
 * This sweep walks every thread, and any state that is stuck-running past
 * twenty minutes, or flagged-and-settled past the floor, gets its row back.
 * The drain in the same firing then runs it. Reads only, plus one small
 * write per genuinely stranded thread, so it is cheap enough for every
 * firing.
 */
export async function requeueStranded(env) {
  try {
    const threads = [];
    for (const [coll, kind] of [['cases', 'case'], ['subscriptions', 'sub']]) {
      const rows = await listDocs(env, coll, { pageSize: 300, all: true }).catch(() => []);
      for (const r of rows) {
        // A closed case has no advisor work owed; skipping it keeps the sweep
        // from growing linearly with the archive.
        if (kind === 'case' && r.data.status === 'closed') continue;
        threads.push({ kind, id: r.id });
      }
    }
    // Bounded parallelism: the serial version spent up to a minute of the
    // firing's wall clock on reads before the drain got a turn.
    const CHUNK = 10;
    for (let i = 0; i < threads.length; i += CHUNK) {
      await Promise.all(threads.slice(i, i + CHUNK).map((t) => sweepOne(env, t).catch(() => {})));
    }
  } catch (err) {
    console.warn('advisor sweep:', err.message || err);
  }
}

async function sweepOne(env, t) {
  const st = await getDoc(env, statePath(t.kind, t.id)).catch(() => null);
  const d = st?.data;
  if (!d || d.paused) return;
  const q = await getDoc(env, queuePath(t.kind, t.id)).catch(() => null);
  if (q) return; // already on the drain's plate
  const startedTs = d.startedAt ? new Date(d.startedAt).getTime() : 0;
  const beat = Math.max(startedTs, d.progressAt ? new Date(d.progressAt).getTime() : 0);
  const stuckRunning = d.status === 'running'
    && (!beat || Date.now() - beat > 20 * 60_000
      || (startedTs && Date.now() - startedTs > 20 * 60_000));
  const pend = d.pendingAt ? new Date(d.pendingAt).getTime() : 0;
  const upd = d.updatedAt ? new Date(d.updatedAt).getTime() : 0;
  // Settled: past the upload settle window (so a photo batch finishes
  // landing first) and past the spam floor.
  const owed = pend && d.status !== 'error' && d.status !== 'running' && pend > upd
    && Date.now() - pend > 5 * 60_000
    && (!upd || Date.now() - upd >= PENDING_FLOOR_MS);
  // A pass killed between deleting its row and re-queueing its leftover
  // files strands the carry list with pendingAt already cleared; nothing
  // else ever reads those files again.
  const carryOwed = Array.isArray(d.pendingMedia) && d.pendingMedia.length
    && d.status === 'idle' && upd && Date.now() - upd > 10 * 60_000;
  // Errors used to park forever: the give-up wrote status "error" and every
  // background path refused it, so half a day passed with work owed and
  // nothing retrying. A parked error now retries on a slow clock, bounded,
  // and never for the error classes where retrying is throwing money at a
  // wall (credits out, rate limited).
  const standing = /credits|Rate limited/i.test(String(d.error || ''));
  const errAge = upd ? Date.now() - upd : Infinity;
  const errRetryDue = d.status === 'error' && !standing && pend && pend > upd
    && (Number(d.errorRetries) || 0) < 8
    && (!d.errorRetryAt || Date.now() - new Date(d.errorRetryAt).getTime() > 30 * 60_000)
    && errAge > 30 * 60_000;
  if (!stuckRunning && !owed && !carryOwed && !errRetryDue) return;
  if (stuckRunning)
    await setState(env, t.kind, t.id, { status: 'idle', startedAt: null, progressAt: null, stage: null })
      .catch(() => {});
  if (errRetryDue)
    await setState(env, t.kind, t.id, {
      status: 'idle',
      errorRetries: (Number(d.errorRetries) || 0) + 1,
      errorRetryAt: new Date(),
    }).catch(() => {});
  await patchDoc(env, queuePath(t.kind, t.id), { kind: t.kind, id: t.id, at: new Date(), tries: 0 })
    .catch(() => {});
  await diagLog(env, {
    ev: 'requeue', kind: t.kind,
    why: stuckRunning ? 'stuck-running' : owed ? 'owed' : carryOwed ? 'carry' : 'error-retry',
  });
  console.warn(`advisor sweep: re-queued stranded ${t.kind}/${t.id}`);
}

/**
 * One poll of an in-flight batch turn, from the drain. Still processing:
 * stamp the heartbeat so every liveness judge (the panel, the route gate,
 * the twin guard, the sweep) sees a live run. Landed: finish it. Failed, or
 * three hours old: park the error exactly like a turn that died in place
 * used to, and the sweep's bounded error-retry clock buys the next attempt.
 */
async function pollFlight(env, kind, id, rowId, flight) {
  const started = flight.submittedAt ? new Date(flight.submittedAt).getTime() : 0;
  let out;
  try {
    out = await pollTurnBatch(env, flight.batchId, flight.customId);
  } catch {
    out = { state: 'running' }; // transient transport failure: look again next firing
  }
  if (out.state === 'running') {
    if (!started || Date.now() - started < 3 * 3_600_000) {
      await setState(env, kind, id, { status: 'running', stage: 'thinking', progressAt: new Date() })
        .catch(() => {});
      return;
    }
    try { await client(env).messages.batches.cancel(flight.batchId); } catch { /* best effort */ }
    out = { state: 'failed', why: 'The background read took too long and was abandoned. It retries on its own.' };
  }
  if (out.state === 'done') {
    try {
      await finishAnalysis(env, kind, id, flight, out.message);
      return;
    } catch (err) {
      out = { state: 'failed', why: String(err?.message || err) };
    }
  }
  // A discarded too-short delta is not a fault to park: nothing is wrong,
  // the prior is intact, forceFull is already set, and the retry should run
  // NOW as the full read the discard promised, not after the half-hour
  // error clock (which would re-create exactly the staleness this pipeline
  // exists to end). The full retry cannot loop here: only deltas can trip
  // the too-short guard.
  if (/came back too short/.test(String(out.why || ''))) {
    await diagLog(env, {
      ev: 'end', ok: false, kind, auto: flight.auto !== false, batch: true, requeued: true,
      err: String(out.why).slice(0, 140), ms: started ? Date.now() - started : 0,
    });
    await setState(env, kind, id, {
      status: 'idle', batchCtx: null, startedAt: null, progressAt: null, stage: null, mediaPlan: null,
    }).catch(() => {});
    await deleteDoc(env, `advisorQueue/${rowId}`).catch(() => {});
    await markPending(env, kind, id, { force: true }).catch(() => {});
    return;
  }
  await diagLog(env, {
    ev: 'end', ok: false, kind, auto: flight.auto !== false, batch: true,
    err: String(out.why || 'batch failed').slice(0, 140),
    ms: started ? Date.now() - started : 0,
  });
  await setState(env, kind, id, {
    status: 'error', error: friendly(new Error(out.why || 'The background read failed.')),
    batchCtx: null, startedAt: null, progressAt: null, stage: null, mediaPlan: null,
  }).catch(() => {});
  await deleteDoc(env, `advisorQueue/${rowId}`).catch(() => {});
}

/**
 * Cron backstop: one look at the queue per firing. An analysis turn no
 * longer runs inside this invocation at all - it is SUBMITTED as a batch
 * (small POST) and every later firing POLLS it (small GET) until the result
 * lands, so neither the invocation CPU budget nor any wall clock ever
 * touches the model turn again. deadlineAt is kept for the draft rescue,
 * which still carries its (short) turn in place.
 *
 * Returns true when this firing bought a model turn, so scheduled() can keep
 * the voice study out of the same invocation.
 */
export async function runQueuedAnalyses(env, deadlineAt = 0) {
  try {
    const rows = await listDocs(env, 'advisorQueue', { pageSize: 5 });
    for (const row of rows) {
      const { kind, id } = row.data;
      if (!kind || !id) { await deleteDoc(env, `advisorQueue/${row.id}`); continue; }
      // A draft marker: rescue a draft whose connection died mid-run. It
      // ignores paused (the draft was an explicit request, not automation)
      // and counts as this firing's one model job.
      // An appeal letter whose run died. Same rescue as a draft, and it
      // matters more: this one is written against a filing deadline.
      if (row.data.appeal) {
        const st = await getDoc(env, statePath(kind, id)).catch(() => null);
        const req = st?.data.appealReq;
        if (st?.data.appealStatus !== 'running' || !req) {
          await deleteDoc(env, `advisorQueue/${row.id}`);
          continue;
        }
        const as = st.data.appealStartedAt ? new Date(st.data.appealStartedAt).getTime() : 0;
        const aBeat = Math.max(as, st.data.appealProgressAt ? new Date(st.data.appealProgressAt).getTime() : 0);
        if (aBeat && Date.now() - aBeat < 5 * 60_000
          && (!as || Date.now() - as < 20 * 60_000)) continue;
        const tries = Number(row.data.tries || 0) + 1;
        if (tries > 2) {
          await setState(env, kind, id, {
            appealStatus: 'error', appealReq: null,
            appealError: 'The letter kept getting interrupted. Open the appeal and try again.',
          }).catch(() => {});
          await deleteDoc(env, `advisorQueue/${row.id}`);
          continue;
        }
        await patchDoc(env, `advisorQueue/${row.id}`, { tries }, { mask: ['tries'] }).catch(() => {});
        await runAppeal(env, kind, id, req.appeal || {}, !!req.revise, req.base || '', true);
        return true; // one model job per firing
      }
      if (row.data.callNotes) {
        const st = await getDoc(env, statePath(kind, id)).catch(() => null);
        const req = st?.data.callNotesReq;
        if (st?.data.callNotesStatus !== 'running' || !req) {
          await deleteDoc(env, `advisorQueue/${row.id}`);
          continue;
        }
        const cs = st.data.callNotesStartedAt ? new Date(st.data.callNotesStartedAt).getTime() : 0;
        const cBeat = Math.max(cs, st.data.callNotesProgressAt ? new Date(st.data.callNotesProgressAt).getTime() : 0);
        if (cBeat && Date.now() - cBeat < 5 * 60_000
          && (!cs || Date.now() - cs < 20 * 60_000)) continue;
        const tries = Number(row.data.tries || 0) + 1;
        if (tries > 2) {
          await setState(env, kind, id, {
            callNotesStatus: 'error', callNotesReq: null,
            callNotesError: 'The notes kept getting interrupted. Tap "Draft notes for call" to try again.',
          }).catch(() => {});
          await deleteDoc(env, `advisorQueue/${row.id}`);
          continue;
        }
        await patchDoc(env, `advisorQueue/${row.id}`, { tries }, { mask: ['tries'] }).catch(() => {});
        await runCallNotes(env, kind, id, req.instruction || '', !!req.revise, req.base || '', true);
        return true; // one model job per firing
      }
      // THE CALL DOCUMENT. This branch did not exist, and its absence was
      // expensive in both directions: an advisorQueue/calldoc_* row fell
      // through to the generic analysis claim below, so every firing of a
      // per-minute cron bought a full max-effort ANALYSIS off it - and after
      // three of those, the give-up path wrote "this read kept stopping
      // partway" onto the ASSESSMENT, a document Eric reads as the advisor
      // failing at a different job entirely. Meanwhile the call document that
      // actually died was never retried once. It sorts before `case_` too, so
      // it was drained first and took the one model job per firing with it.
      if (row.data.callDoc) {
        const st = await getDoc(env, statePath(kind, id)).catch(() => null);
        const req = st?.data.callDocReq;
        if (st?.data.callDocStatus !== 'running' || !req) {
          await deleteDoc(env, `advisorQueue/${row.id}`);
          continue;
        }
        const ds = st.data.callDocStartedAt ? new Date(st.data.callDocStartedAt).getTime() : 0;
        const dBeat = Math.max(ds, st.data.callDocProgressAt ? new Date(st.data.callDocProgressAt).getTime() : 0);
        if (dBeat && Date.now() - dBeat < 5 * 60_000
          && (!ds || Date.now() - ds < 20 * 60_000)) continue;
        const tries = Number(row.data.tries || 0) + 1;
        if (tries > 2) {
          await setState(env, kind, id, {
            callDocStatus: 'error', callDocReq: null,
            callDocError: 'The call document kept getting interrupted. Tap build to try again.',
          }).catch(() => {});
          await deleteDoc(env, `advisorQueue/${row.id}`);
          continue;
        }
        await patchDoc(env, `advisorQueue/${row.id}`, { tries }, { mask: ['tries'] }).catch(() => {});
        // The RETRY carries no inline bytes: callDocReq stores descriptors
        // only (see runCallDoc), so a rebuild uses whatever is Storage-backed
        // and the skipped list names what it could not get back. That is the
        // honest half of a retry, and better than the nothing it did before.
        await runCallDoc(env, kind, id, {
          instruction: req.instruction || '',
          revise: !!req.revise,
          base: req.base || '',
          sources: (req.sources || []).filter((s) => s?.path || s?.url),
          noStream: true,
        });
        return true; // one model job per firing
      }
      if (row.data.draft) {
        const st = await getDoc(env, statePath(kind, id)).catch(() => null);
        const req = st?.data.draftReq;
        // Finished or failed on its own since the marker was written.
        if (st?.data.draftStatus !== 'running' || !req) {
          await deleteDoc(env, `advisorQueue/${row.id}`);
          continue;
        }
        const ds = st.data.draftStartedAt ? new Date(st.data.draftStartedAt).getTime() : 0;
        const dBeat = Math.max(ds, st.data.draftProgressAt ? new Date(st.data.draftProgressAt).getTime() : 0);
        // Five minutes, not the panel's two: the heartbeat only starts with
        // the first STREAM event, and a run stuck in connect/overload
        // retries can sit longer than two minutes while very much alive. A
        // rescue that races it doubles the spend and the loser's write wins.
        // But never trust a beat past twenty minutes of total age: a hung
        // stream used to beat forever (the watchdog now kills those; this is
        // the belt to its braces).
        if (dBeat && Date.now() - dBeat < 5 * 60_000
          && (!ds || Date.now() - ds < 20 * 60_000)) continue; // still writing
        const tries = Number(row.data.tries || 0) + 1;
        if (tries > 2) {
          await setState(env, kind, id, {
            draftStatus: 'error', draftReq: null,
            draftError: 'The draft kept getting interrupted. Tap Prepare a response to try again.',
          }).catch(() => {});
          await deleteDoc(env, `advisorQueue/${row.id}`);
          continue;
        }
        await patchDoc(env, `advisorQueue/${row.id}`, { tries }, { mask: ['tries'] }).catch(() => {});
        // The turn itself runs in the Workflow when the binding exists: a
        // cron invocation's CPU budget killed every long turn it carried
        // (measured live, 2026-08-24), and a Workflow step has the raised
        // limit and no wall clock. The queue machinery here stays the owner
        // of retries either way.
        if (env.ADVISOR_WF) {
          await env.ADVISOR_WF.create({
            params: { job: 'draft', kind, id, opts: { instruction: req.instruction || '', revise: !!req.revise, base: req.base || '' } },
          });
        } else {
          await runDraft(env, kind, id, req.instruction || '', !!req.revise, req.base || '', true);
        }
        return true; // one model job per firing
      }
      const state = await getDoc(env, statePath(kind, id));
      if (state?.data.paused) {
        await deleteDoc(env, `advisorQueue/${row.id}`);
        // A dead run's leftover "running" reads as "stalled - tap Update"
        // forever on a paused case, because auto-fire refuses while paused
        // and this purge used to walk straight past it.
        const sp = state.data;
        // A batch in flight for a case Eric just paused: nobody should pay
        // for or write an answer he asked to stop. Cancel and clear.
        if (sp.batchCtx?.batchId) {
          try { await client(env).messages.batches.cancel(sp.batchCtx.batchId); } catch { /* gone */ }
          await setState(env, kind, id, {
            batchCtx: null, status: 'idle', startedAt: null, progressAt: null, stage: null,
          }).catch(() => {});
          continue;
        }
        const pBeat = Math.max(sp.startedAt ? new Date(sp.startedAt).getTime() : 0,
          sp.progressAt ? new Date(sp.progressAt).getTime() : 0);
        if (sp.status === 'running' && (!pBeat || Date.now() - pBeat > 5 * 60_000))
          await setState(env, kind, id, { status: 'idle', startedAt: null, progressAt: null, stage: null }).catch(() => {});
        continue;
      }
      // A batch turn in flight for this case: poll it. One API GET; the
      // model is running on Anthropic's side, where no invocation clock
      // exists. Never falls through to the claim below - a flight owns its
      // case until it lands, fails, or ages out at three hours.
      if (state?.data.batchCtx?.batchId) {
        await pollFlight(env, kind, id, row.id, state.data.batchCtx);
        continue;
      }
      // Someone (the panel) is already mid-run: leave it alone while it is
      // ALIVE, which means a fresh heartbeat, not a fresh start. progressAt
      // beats every ~8s while the model streams, so five quiet minutes is a
      // corpse even if startedAt is recent. Judging on startedAt alone made
      // the cron wait out a dead run for up to twelve minutes while the
      // panel told Eric at two to tap Update by hand. Same clock the draft
      // rescue uses.
      const st = state?.data || {};
      const beat = Math.max(
        st.startedAt ? new Date(st.startedAt).getTime() : 0,
        st.progressAt ? new Date(st.progressAt).getTime() : 0);
      const started = st.startedAt ? new Date(st.startedAt).getTime() : 0;
      // Same belt-and-braces as the draft branch: a fresh beat defers, but
      // never past twenty minutes of total age. A hung stream used to beat
      // forever and this gate deferred to it every five minutes, all night.
      if (st.status === 'running' && beat && Date.now() - beat < 5 * 60_000
        && (!started || Date.now() - started < 20 * 60_000)) continue;
      // Count the attempt BEFORE running it. runAnalysis's own catch skips
      // its increment when the cron counted (counted: true below), but a run
      // that dies by having its isolate killed (memory, wall clock) never
      // reaches any catch, and those are exactly the runs that repeat
      // forever. Counting here makes even an uncatchable death move the case
      // toward the no-files fallback instead of looping.
      //
      // The write doubles as a CLAIM: conditional on the row not having moved
      // since it was read, so two invocations judging the same corpse in the
      // same seconds cannot both buy the turn. listDocs does not return
      // updateTime, so the row is re-read; a row that vanished meanwhile
      // means someone else finished or claimed it.
      const fresh = await getDoc(env, `advisorQueue/${row.id}`).catch(() => null);
      if (!fresh) continue;
      const tries = Number(fresh.data.tries || 0) + 1;
      if (tries > ANALYSIS_MAX_TRIES) {
        await setState(env, kind, id, {
          status: 'error', stage: null,
          error: `This read kept stopping partway${st.stage && st.stage !== 'starting' ? ` (it was ${st.stage === 'sending' ? 'sending the case' : st.stage})` : ''}. Tap Update to try again, or remove the newest file from the staged list.`,
        }).catch(() => {});
        await deleteDoc(env, `advisorQueue/${row.id}`).catch(() => {});
        await diagLog(env, { ev: 'gave-up', kind, tries });
        continue;
      }
      const claimed = await patchDoc(env, `advisorQueue/${row.id}`, { tries },
        { mask: ['tries'], ifUpdateTime: fresh.updateTime }).catch(() => false);
      if (claimed === false) continue;
      // Same escape as the draft branch: the Workflow carries the turn, out
      // of reach of the invocation budget that was killing it. No deadline
      // in there: a Workflow step has no wall clock, and RUN_BUDGET_MS still
      // bounds the stream itself.
      if (env.ADVISOR_WF) {
        await env.ADVISOR_WF.create({
          params: { job: 'analysis', kind, id, opts: { skipMedia: tries >= 3, counted: true, auto: true } },
        });
      } else {
        await runAnalysis(env, kind, id, null, { skipMedia: tries >= 3, counted: true, auto: true, deadlineAt });
      }
      return true; // one model job per firing
    }
  } catch (err) {
    console.warn('advisor queue:', err.message || err);
  }
  return false;
}

/**
 * Eric's recent back-and-forth with the advisor on this thread. Loaded WITHOUT
 * orderBy on purpose: Firestore's orderBy silently drops any doc missing the
 * field, so the sort happens here. This is what turns the advisor chat into a
 * conversation that accumulates: it rides into every question (so the advisor
 * remembers what they just discussed) and into every analysis (so a conclusion
 * reached in that chat actually moves the assessment and the differential).
 * Eric's words: "The advisor does not seem to be adapting the differential
 * based on our conversation." This is the fix; do not remove either injection.
 */
async function loadQa(env, kind, id, { skip = null, take = 10, full = false } = {}) {
  // all: true, because one unordered page of a growing collection is a
  // random sample: qa ids are UUIDs, and past one page the "last 10 by date"
  // was the last 10 of an arbitrary subset, which is exactly the amnesia
  // this loader exists to end. Docs are tiny; reading them all is cheap.
  const rows = await listDocs(env, `${statePath(kind, id)}/qa`, { pageSize: 200, all: true })
    .catch(() => []);
  // Rows with a QUESTION count, answered or not. Filtering to finished
  // exchanges dropped the freshest thing Eric said, which is precisely what
  // "take what I just said to you" points at: he speaks, presses Prepare a
  // response while the advisor is still answering, and the draft was written
  // blind to the one message that mattered. His words are evidence the
  // moment they exist; the answer can say "(still answering)".
  const spoken = rows
    .filter((r) => r.id !== skip && r.data.question
      && (r.data.status === 'done' || r.data.status === 'running'))
    .sort((a, b) => new Date(a.data.at || 0) - new Date(b.data.at || 0));
  const recent = spoken.slice(-take);
  // Overrides are settled calls, not chat scroll: up to three older ones
  // stay pinned ahead of the recency window, at a longer slice, so the
  // context that produced a filed stance never just ages out.
  const pinned = spoken.slice(0, -take)
    .filter((r) => r.data.override && r.data.answer)
    .slice(-3);
  // A silent slice is how a draft relays half of what he said and calls it
  // done. Marked cuts, and the draft path (full) gets his words nearly whole:
  // the relay rule commands "drop nothing he said", which the loader has to
  // actually honor.
  const cut = (s, n) => {
    const t = String(s);
    return t.length > n ? `${t.slice(0, n)}…` : t;
  };
  return [...pinned, ...recent].map((r) => ({
    q: cut(r.data.question, full ? 4000 : 800),
    a: r.data.answer ? cut(r.data.answer, full ? 2000 : (r.data.override ? 900 : 600)) : '',
    override: !!r.data.override,
  }));
}

function qaBlock(qa) {
  if (!qa.length) return '';
  const turns = qa.map((x) =>
    `${x.override ? 'ERIC (override, settled): ' : 'ERIC: '}${x.q}\nYOU: ${x.a || '(you have not answered this yet; his words stand on their own)'}`).join('\n\n');
  return `\n<discussion_with_eric>\nYour recent private discussion with Eric about this client, oldest first (either side may be shortened; a shortened one ends with …):\n\n${turns}\n</discussion_with_eric>\n`;
}

/**
 * What this case has paid against what it has cost him so far.
 *
 * Eric, 2026-08-22: "The advisor also needs to keep in mind how much I've
 * been paid to how much work I've done so I don't perpetually ask questions
 * when I have a solid plan for the call and it's okay to stop and not drag
 * my value down by earning less than $0/client."
 *
 * The chat meter is a FLOOR on his effort, not the whole of it: it counts
 * only the minutes his admin chat page was open and visible, and never the
 * call, the records reading, or the report. Said plainly in the note, so a
 * model reasoning from it does not mistake the floor for the total.
 */
async function loadEconomics(env, kind, id) {
  if (kind !== 'case') {
    return { sub: true, paidCents: 0, tipCents: 0, seconds: 0 };
  }
  const [doc, meta, rates] = await Promise.all([
    getDoc(env, `cases/${id}`).catch(() => null),
    getDoc(env, `caseMeta/${id}`).catch(() => null),
    // Eric's own margin floor, so the advisor can tell him a case has crossed
    // from thorough into unpaid while he can still act on it.
    getDoc(env, 'config/rates').catch(() => null),
  ]);
  const c = doc?.data || {};
  // A Full Access case paid its own price, which already covers the standard
  // case; caseRateCents on one of those is only the percentage-charge base.
  let paidCents = (c.fullAccess && Number(c.fullAccessRateCents) > 0 ? Number(c.fullAccessRateCents) : 0)
    || Number(c.stripe?.amountTotal)
    || Number(c.caseRateCents) || 0;
  let tipCents = 0;
  for (const p of (Array.isArray(c.extraPayments) ? c.extraPayments : [])) {
    const cents = Number(p?.amountCents) || 0;
    if (p?.kind === 'tip') tipCents += cents;
    // The settled tier row is already inside fullAccessRateCents above.
    // Adding it again doubled the figure this note exists to keep honest, and
    // a doubled figure suppresses the below-floor warning entirely.
    else if (p?.kind !== 'fullaccess') paidCents += cents;
  }
  // The clock Eric toggles by hand is the real number: it counts the call,
  // the records and the report, which the chat-page meter never could. That
  // old meter stays only as a fallback for a case predating the clock.
  const w = c.work || {};
  const banked = Math.max(0, Number(w.seconds) || 0);
  const live = w.startedAt
    ? Math.min(Math.floor((Date.now() - new Date(w.startedAt).getTime()) / 1000), 12 * 3600)
    : 0;
  const clocked = banked + live;
  return {
    sub: false,
    paidCents,
    tipCents,
    seconds: clocked || Math.max(0, Number(meta?.data.chatSeconds) || 0),
    metered: clocked > 0,
    floorCents: Number(rates?.data.floorCents) > 0 ? Number(rates.data.floorCents) : 7500,
  };
}

function economicsNote(econ) {
  if (!econ || econ.sub) return '';
  const dollars = (c) => `$${Math.round(c / 100)}`;
  const hours = econ.seconds / 3600;
  // Floored on BOTH branches. Rounding the minutes against a floored hour
  // emitted "1h 60m"; rounding them under an hour emitted a bare "60m" at
  // 3,599 seconds, which is fifty-nine minutes and fifty-nine seconds. Either
  // way a nonsense duration went into the block the model reads and then
  // paraphrases to Eric as if it were a fact.
  const spent = hours >= 1
    ? `${Math.floor(hours)}h ${Math.floor((econ.seconds % 3600) / 60)}m`
    : `${Math.floor(econ.seconds / 60)}m`;
  // Only compute a rate once there is enough time logged for one to mean
  // anything. Ten minutes of chat does not imply a $1,590 hourly rate.
  // Numbers only. The persuasion lives in the "For you" instruction, and a
  // rhetorical flourish in a data block is exactly what a model paraphrases
  // into a sentence the guardrail then has to catch.
  const hourly = hours >= 0.5 && econ.paidCents ? econ.paidCents / hours : 0;
  const rate = hourly
    ? ` That is about ${dollars(hourly)} an hour so far.`
    : '';
  // The floor is his own figure, set from his dashboard. Stated as a fact
  // and nothing more, same rule as everything else in this block: the
  // judgement about what to DO belongs to the "For you" instruction.
  const under = hourly && econ.floorCents && hourly < econ.floorCents
    ? ` His floor is ${dollars(econ.floorCents)} an hour, so this case is now under it.`
    : '';
  return `

What this case has paid, and what it has cost him so far: ${dollars(econ.paidCents)} paid${
    econ.tipCents ? ` plus ${dollars(econ.tipCents)} in tips` : ''
  }, against ${spent} of work.${rate}${under} ${econ.metered
    ? 'That is time he clocked himself, so it is the real figure, and his client can see it too.'
    : 'That figure counts only the minutes his chat page was open, so his real hours are higher than it says.'}`;
}

/**
 * Eric's hand-written working line, when he has set one. Pressing his own
 * line onto the folder is the most explicit case-level call he can make, and
 * the analysis used to never see it: the advisor kept producing and
 * defending its own line against a call already made, every pass.
 */
function dxOverrideNote(state) {
  const raw = state?.data.dxOverride;
  const line = typeof raw === 'string' ? raw.trim() : '';
  if (!line) return '';
  return `\n\nEric has written his own working line on this case's folder: "${line.slice(0, 200)}". Treat it as his standing read of the case. Your ## Working line still states your own best read, but do not argue his in the sections he reads. If the evidence now cuts against his line in a way that matters for this client, say so once, under For you.`;
}

/**
 * The bookkeeping the model is asked to maintain but never used to see.
 * Without the open rows, a rephrased ask failed the flat-text match in
 * harvestUnanswered and reset firstAskedAt to today (the age is the whole
 * point); without the settled lists, re-emitted rows burned slots in the
 * caps before the merge discarded them.
 */
function bookkeepingNote(state, { delta = false } = {}) {
  const d = state?.data || {};
  const open = (Array.isArray(d.unanswered) ? d.unanswered : []).filter((r) => !r.answered);
  const settled = (Array.isArray(d.unanswered) ? d.unanswered : []).filter((r) => r.answered);
  const dismissed = (Array.isArray(d.corrections) ? d.corrections : []).filter((c) => c.dismissed);
  const openCorr = (Array.isArray(d.corrections) ? d.corrections : []).filter((c) => !c.dismissed);
  let note = '';
  // On a delta pass the model cannot see the old messages a correction points
  // at, so a correction it does not re-emit would silently vanish. Hand the
  // open ones back and make re-emitting them the default.
  if (delta && openCorr.length) {
    note += `\n\nCorrections still open from earlier passes. Re-emit each under ## Corrections exactly as written, \`- msgId | issue | repaired message\`, unless a new message shows Eric already fixed it or withdrew the claim:\n${
      openCorr.slice(0, 10).map((c) => `- ${c.msgId} | ${c.issue} | ${c.fixed}`).join('\n')}`;
  }
  if (open.length) {
    note += `\n\nRows already tracked under Not answered, with the date each was first asked. Reuse each ask's exact wording and date unless the thread shows it arrived or he dropped it:\n${
      open.slice(0, 12).map((r) => `- ${r.ask} | ${String(r.firstAskedAt || '').slice(0, 10)} | ${r.times || 1}`).join('\n')}`;
  }
  if (settled.length) {
    note += `\n\nThese asks are settled; never list them under Not answered again:\n${
      settled.slice(0, 12).map((r) => `- ${r.ask}`).join('\n')}`;
  }
  if (dismissed.length) {
    note += `\n\nCorrections he has dismissed; never raise these message ids again: ${
      dismissed.slice(0, 10).map((c) => c.msgId).filter(Boolean).join(', ')}`;
  }
  return note;
}

/**
 * Re-read the thread and update the running assessment. Progressive on
 * purpose: the previous analysis goes back in as memory, so each pass refines
 * rather than restarting, and the picture compounds over the life of the case.
 */
export async function runAnalysis(env, kind, id, mediaList = null, { skipMedia = false, counted = false, auto = false, deadlineAt = 0, freshFiles = false } = {}) {
  try {
    // Two triggers can land in the same seconds (a cron takeover and a tap,
    // both judging the same corpse dead). Each would buy a full turn and the
    // loser's write would clobber the winner's. The later one bails. Judged
    // on the freshest BEAT, not startedAt: a genuinely live run can be many
    // minutes past its start (the sweep once reset one to idle on age alone
    // and this guard, reading only startedAt, let a twin stream beside it).
    const pre = await getDoc(env, statePath(kind, id)).catch(() => null);
    const preBeat = Math.max(
      pre?.data.startedAt ? new Date(pre.data.startedAt).getTime() : 0,
      pre?.data.progressAt ? new Date(pre.data.progressAt).getTime() : 0);
    if (pre?.data.status === 'running' && preBeat && Date.now() - preBeat < 45_000) return;
    // A batch turn already in flight owns this case: a second submit would
    // orphan the first and pay twice for one update. The poll abandons a
    // flight at three hours, and this guard expires with it.
    const flight = pre?.data.batchCtx;
    if (flight?.batchId
      && Date.now() - new Date(flight.submittedAt || 0).getTime() < 3 * 3_600_000) return;
    const runT0 = Date.now();
    await diagLog(env, { ev: 'start', kind, auto, skipMedia, hasDeadline: !!deadlineAt });
    await setState(env, kind, id, { status: 'running', error: null, startedAt: new Date(), stage: 'starting' });
    const [rows, state, knowledge, style, qa, effort, econ] = await Promise.all([
      recentMessages(env, kind, id),
      getDoc(env, statePath(kind, id)),
      loadKnowledge(env),
      loadStyle(env),
      loadQa(env, kind, id),
      loadEffort(env),
      loadEconomics(env, kind, id),
    ]);
    const chat = transcript(rows);
    // NOTE: the empty-thread bail moved BELOW the media walk. Bailing here
    // left the queue row and pendingAt standing (three burned firings, then a
    // phantom error), and it also meant a case whose only material was
    // Documents-page uploads could never be analyzed at all.
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
    // Chat attachments first, then anything else in the bucket: a file
    // shared in conversation has context attached to it, one dropped on the
    // Documents page does not. Both dedupe on the object path, so the same
    // file reached both ways is one file.
    // One seen set across both walks. A file shared in chat lives in a folder
    // the Storage walk also visits, and with a set each it came back twice:
    // once as "read this now" and once as "you already read this, treat it as
    // read", about the same file, on the first pass that read it.
    const found = new Set(alreadyRead);
    // skipMedia is the last resort, set by the queue after a run has died
    // twice on the same case: read the thread with no files at all, so a case
    // can never be held hostage by one document. What was skipped is named in
    // the media report, and the carry list is cleared so the next ordinary
    // pass starts clean rather than walking into the same wall.
    // A manual tap skips the settle window: waiting four minutes on files he
    // just uploaded and explicitly asked about reads as "it ignored my
    // photos". Auto passes keep the window so a batch mid-upload settles.
    const settleMs = freshFiles ? 0 : undefined;
    const queue = skipMedia ? [] : [
      ...carried,
      ...(mediaList || []),
      ...autoReadableFiles(rows, alreadyRead, kind, id, found, settleMs),
      ...(await storageReadableFiles(env, alreadyRead, kind, id, found, settleMs)),
    ];
    const media = await selectedMediaBlocks(env, queue, kind, id, alreadyRead);
    if (skipMedia) {
      // Their own bucket, not "unreadable": these files read fine, the pass
      // that held them kept dying. Labelling them unreadable made the advisor
      // ask Eric for screenshots of files a later ordinary pass reads whole.
      media.deferred = carried.map((c) => String(c.name || 'file').replace(/^\d{10,}-/, ''));
      media.carry = [];
    }
    // Nothing to read at all: no chat AND no files. Clean up completely (the
    // row and the flag included) so the queue slot is not burned again next
    // firing on the same nothing.
    if (!chat && !media.blocks.length && !media.carry.length) {
      await setState(env, kind, id, {
        status: 'idle', startedAt: null, progressAt: null, stage: null,
        pendingAt: null, updatedAt: new Date(),
      });
      await deleteDoc(env, queuePath(kind, id)).catch(() => {});
      await diagLog(env, { ev: 'end', ok: true, kind, skipped: 'empty-thread', ms: Date.now() - runT0 });
      return;
    }
    // Auto-fired with nothing new to read: the pending flag was noise (a
    // re-queue racing a finished pass, a double tap somewhere). Bail before
    // buying a max-effort turn that would re-read an unchanged case. A manual
    // tap never takes this exit: Eric asking by hand always runs.
    const newestTs = rows.reduce((acc, r) => {
      const ts = r.data.ts;
      const t = ts ? new Date(ts.toDate ? ts.toDate() : ts).getTime() : 0;
      return Number.isFinite(t) && t > acc ? t : acc;
    }, 0);
    const qaSig = qa.map((x) => `${x.q.length}:${x.a.length}${x.override ? '*' : ''}`).join(',');
    if (auto && !skipMedia && prior && !media.blocks.length && !media.carry.length
      && state?.data.analyzedThroughTs
      && newestTs <= new Date(state.data.analyzedThroughTs).getTime()
      && qaSig === (state.data.qaSig || '')) {
      await setState(env, kind, id, {
        status: 'idle', startedAt: null, progressAt: null, stage: null, pendingAt: null,
      });
      await deleteDoc(env, queuePath(kind, id)).catch(() => {});
      await diagLog(env, { ev: 'end', ok: true, kind, skipped: 'nothing-new', ms: Date.now() - runT0 });
      return;
    }
    // FULL or DELTA. A delta pass feeds the model its own previous assessment
    // as memory plus only the messages that arrived since the last completed
    // pass: small prompt, fast turn, fits inside a cron firing instead of
    // dying against its wall clock. Full passes re-expose the whole window
    // and are reserved for the moments that genuinely need one.
    const p = state?.data || {};
    // Bootstrap: a case whose last success predates the delta machinery has a
    // prior but no through-stamp, and "no stamp means full pass" locked it
    // out of the fast lane forever: full reads are the turn type that dies in
    // the background, so the stamp could never get laid. When a prior exists,
    // updatedAt is a semantically correct substitute: the prior covers
    // everything up to the moment it was written.
    const throughMs = p.analyzedThroughTs ? new Date(p.analyzedThroughTs).getTime()
      : (p.analysis && p.updatedAt) ? new Date(p.updatedAt).getTime() : 0;
    const dxSig = flatText(p.dxOverride || '');
    const curDismissedSig = (Array.isArray(p.corrections) ? p.corrections : [])
      .filter((c) => c.dismissed).map((c) => c.msgId).sort().join(',');
    const qaOverrides = qa.filter((x) => x.override).length;
    let { context, fresh, omitted } = splitDelta(rows, throughMs);
    // Each reason carries a name so the recorder can say WHY a full ran; a
    // full pass at high effort is the expensive turn, and "it keeps going
    // full" was undiagnosable from outside without this (2026-08-23, five in
    // a row). The oversize trigger runs on a SLOW clock: consolidation
    // doesn't consolidate any better back to back, and a stubbornly large
    // assessment was forcing every single pass full. One in three is enough
    // pressure; the deltas in between still carry the (capped) prior whole.
    const fullWhy = [
      !prior && 'first',
      !throughMs && 'no-stamp',
      p.forceFull === true && 'forced',
      (Array.isArray(mediaList) && mediaList.length) && 'staged',
      dxSig !== (p.dxOverrideSig || '') && 'dx-override',
      curDismissedSig !== (p.dismissedSig || '') && 'dismissed',
      qaOverrides !== (p.qaOverrideCount || 0) && 'qa-override',
      (p.passesSinceFull || 0) >= FULL_PASS_EVERY && 'cadence',
      (String(prior || '').length > COMPACT_AT_CHARS
        && (p.passesSinceFull || 0) >= 2) && 'oversize',
      p.fullDue === true && 'owed',
      omitted === 0 && 'whole-window',
    ].filter(Boolean).join(',');
    // The guillotine era is over: the turn runs on Anthropic's side via the
    // Batches API, so no invocation clock applies and the background can run
    // a full read again. Deltas stay the routine pass because they are
    // cheaper and hold the assessment steadier; a backlog too big for one
    // delta is still walked in CHUNKS, oldest first, the through-stamp
    // advancing with each completed chunk.
    const full = !!fullWhy;
    const fullDue = false;
    const passType = full ? 'full' : 'delta';
    let catchup = false;
    if (passType === 'delta' && auto && fresh.length > 60) {
      catchup = true;
      fresh = fresh.slice(0, 60);        // oldest unread chunk; rows are chronological
      context = context.length ? context : [];
      omitted = Math.max(omitted, 0);
    }
    const newerLeft = passType === 'delta'
      ? Math.max(0, splitDelta(rows, throughMs).fresh.length - fresh.length) : 0;
    // No !auto gate anymore: background fulls are real turns again (batches),
    // and without consolidation an assessment past the threshold would force
    // EVERY background pass full at high effort, forever, since only
    // consolidation can bring it back under.
    const compacting = full && String(prior || '').length > COMPACT_AT_CHARS;
    // Effort per pass type. Manual runs always honor Eric's own switch; the
    // background never spends max, and a routine text-only delta runs at
    // medium, which is the one-to-two-minute pass.
    const passEffort = !auto ? effort
      : passType === 'full' ? 'high'
        : media.blocks.length ? 'high'
          : 'medium';
    const passTokens = !auto
      ? (passType === 'full' ? 64000 : 48000)
      : passType === 'full' ? 48000
        : media.blocks.length ? 40000
          : 32000;
    // The prior, capped. The chart note and Ruled out are never truncated
    // (their loss is unrecoverable without a beginning-to-end re-read); if
    // the whole prior is over the hard cap, keep those two sections whole
    // and trim the commentary.
    let priorText = String(prior || '');
    if (priorText.length > PREV_HARD_CAP) {
      const keep = ['What we know so far', 'Ruled out']
        .map((h) => sectionMatch(priorText, h)?.[0] || '').filter(Boolean).join('\n\n');
      const rest = cleanCut(priorText, Math.max(10_000, PREV_HARD_CAP - keep.length));
      priorText = `(Older commentary sections are trimmed for length. The chart note and Ruled out below are complete.)\n\n${rest}\n\n${keep}`;
    }
    // The plan, stamped before dispatch, so the panel can show a live "reading
    // N files" from server truth on ANY trigger (the old local counter only
    // knew about taps made in that same browser session, and froze otherwise).
    await setState(env, kind, id, { mediaPlan: media.included.slice(0, 40) }).catch(() => {});

    // The turn does NOT run here. It is submitted to the Batches API and the
    // cron's poll folds the result in when it lands; see submitTurnBatch for
    // why nothing longer than a poll can live inside a Worker invocation.
    const turn = turnRequest({
      effort: passEffort,
      maxTokens: passTokens,
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
## Not answered
## Corrections

"Right now": 2 to 4 short sentences, under 120 words, plain language. If you have
a previous assessment, open with what CHANGED since it (new message, new
signal, a shift in your read), then the single most useful next move. This is a
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
in one section. Inside "Right now" and "Plain English" the brackets replace
the parenthetical gloss rule: bracket the term, explain it in "Plain English",
and add no gloss in parentheses. Everywhere else in the assessment the gloss
rule stands.

"What this could be": at most 4 bullets, one line each: possibility, then the
one thing that would raise or lower it.

"Worth investigating": at most 5 bullets: a specific lab, image, record or
referral, and what the result would settle either way. Order by what moves the
case most among moves that can actually be started now; a test nobody on the
current care team can order ranks below the reachable step that gets him to
whoever can.

Every move you recommend, here, under "For you", and as the next move in
"Right now", has to be startable in the real US system. Name WHO orders or
provides it (a PCP does not send a paraneoplastic panel; that is the
neurologist's), HOW it gets set in motion (a portal message, a referral
request, a records request through the hospital's release of information
office), and the honest TIMELINE (specialist referrals often run 4-12 weeks,
records requests up to 30 days, prior auth adds more, and an ER works up what
is dangerous today and nothing else). A second opinion at an academic center
cannot even be booked until the records land, so the records request always
starts first. When the textbook move and the reachable move differ, lead with
the one Eric can start this month and note in the same bullet what the ideal
one is waiting on. A move he cannot start is not a move.

"Not answered": what ERIC asked the client for and has not received. One
bullet each, \`- what he asked | YYYY-MM-DD | how many times\`, oldest first, at
most 8. Only things he actually asked for in the thread: a record, a date, a
document, a decision. Not gaps in the picture, which belong in "What's
missing"; this is only where the CONVERSATION stalled. If something arrived
later, or he said to drop it, leave it out. Write the ask in his own words as
far as the thread allows. If nothing is outstanding, write "- none".

"Worth asking": at most 4 questions for the CLIENT, verbatim, each on its own
bullet, in Eric's plain register and ready to send as they stand. He sends them
straight from this list with one press, so never write a preamble, a heading or
a parenthetical inside a bullet: just the question.

"Worth asking" and "What's missing" bullets leave this page AS MESSAGES FROM
ERIC: the client receives them word for word. Inside those bullets the client
rules outrank every instruction above about how to talk to Eric: no glosses or
parentheticals, no diagnosis put in his mouth, no treatment instruction (a
treatment concern becomes a question for the doctor), and never a word that
hints at any assessment, discussion, or advisor. Plain and warm, one question
per bullet.

"What we know so far": the chart note, the thing Eric can hand a specialist.
This is a REFERENCE section and the only one with no length limit; completeness
beats brevity here. Use \`###\` sub-headings, only the ones the thread supports:
Demographics, History, Medications, Normal results, Abnormal results, Imaging,
Procedures. Facts from the thread and the documents only, each with its date
where you have one. Never infer, never round, never fill a gap with a typical
value. If a section has nothing, leave it out.

"What's missing": at most 5 bullets. Not strictly required, but would sharpen
the picture: a record nobody has pulled, a date nobody has pinned down, a
symptom nobody has characterised. Each written as a QUESTION Eric could send to
the client as it stands, because he sends these with one press too.

"Ruled out": what was genuinely on the list and is now off it, one line each,
\`- Name: the one fact that killed it\`. Like "What we know so far" this is a
cumulative record: keep every entry the case has earned, however many. Only
things a specific result or a specific statement actually closed. Never move a
possibility here because it became unfashionable in your own thinking, and
never re-litigate something already on this list in a later section. Write
"- Nothing is closed yet." when nothing has been.

"For you": at most 3 bullets of advocacy strategy: who to push, where this
stalls, and how to engage THIS patient if that matters (fewer questions and
more prompting for someone exhausted, more structure for someone scattered).

One of those bullets is about his effort, when and only when it earns its
place. He is a working advocate on a fixed fee, and the failure mode he
actually has is grinding a case he has already solved: asking a fourth
question when the plan is sound, chasing a detail that changes nothing. You
are given what this case paid and how much chat time it has already taken.
When the plan for the next call is genuinely solid and the remaining
questions would not change what he does, say so in plain words: he is ready,
stop here, the next move belongs to the call. Say it as a judgement about
READINESS, never as a complaint about money to him, and never quote the
hourly figure back at him.

The one thing this never does is push a case short. If something clinically
important is still open, say that instead, however long it has taken and
whatever it paid. A dangerous possibility unchased is not a saving. Effort
guidance is about when he has ENOUGH, never about withholding something the
patient needs.

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

"## Differential": up to 7 lines, most likely first, each exactly
\`- Name [NN%]: why it fits | what would raise or lower it\`
NN is YOUR confidence as a whole number, and the numbers must not add up to
more than 100: whatever is left over is "not enough information", which early
on is most of it. Only possibilities the case record supports, and the case
record includes your private discussion with Eric. Confidence moves on
exactly two things: diagnostic evidence, and points settled in that
discussion. A possibility either of you raised there that survives scrutiny
gets its row. A point conceded in either direction moves the numbers by as
much as the conceded point actually bears on the ranking: a small concession
nudges a percentage, a load-bearing one reranks the list. Never move a
number to be agreeable, and never hold one still merely because the evidence
arrived in the discussion instead of the thread. Whenever a dangerous but
treatable possibility is plausible at all, give it a row at its real low
percentage, because that is the one worth chasing even at long odds. If you
have nothing yet, write "- none yet".

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
the thread has actually contradicted it.`, cache: true },
      // The learned material rides its OWN system block, after the cached
      // one: the standing instructions above are identical from call to
      // call, and gluing the glossary and the profile onto them meant the
      // advisor learning anything busted the cache built to protect them.
      { type: 'text', text: `${knowledgeNote(knowledge)}${stanceNote(style)}${style.voice ? `

Two of your sections leave this page as messages FROM ERIC: "Worth asking" and "What's missing". He presses one line and it goes to the client as it stands. Write those two in his voice, from this profile of how he writes:
${style.voice}` : ''}` || ' ' }],
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            // The private discussion goes in beside the client transcript, and
            // it carries weight: what Eric settled with the advisor there has
            // to move this assessment, or the advisor chat is decoration.
            text: (passType === 'delta'
              ? `Here is your working assessment of this client. It is your memory of the whole case: every earlier message, every file you have read, and everything you and Eric have settled are already folded into it.\n\n<previous>\n${priorText}\n</previous>\n\nThe machine rows you filed after your last pass:\n\n<filed>\nWorking line: ${p.workingDx || 'Still forming'}\nDifferential:\n${(Array.isArray(p.differential) ? p.differential : []).map((r) => `- ${r.name} [${r.pct}%]: ${r.why} | ${r.moves}`).join('\n') || '- none yet'}\n</filed>\n\nSince that assessment, ${fresh.length} new message${fresh.length === 1 ? '' : 's'} ${catchup ? 'are shown this pass (the oldest unread; ' + newerLeft + ' newer ones reach you next pass, so do not treat this as the end of the story)' : 'arrived'}. ${omitted} earlier messages are not shown this pass; your previous assessment already accounts for them. The last ${context.length} messages you have already read are shown first so you can hear the turn of the conversation:\n\n<already_read>\n${transcript(context) || '(none)'}\n</already_read>\n\n<new_messages>\n${transcript(fresh) || '(no new chat; new files or discussion below)'}\n</new_messages>\n${qaBlock(qa)}\nThis is an update pass, not a fresh read. Revise the assessment; do not restart it. Keep every section, and rewrite only what the new material changes:\n\n- Output the complete assessment, every heading, in the required order.\n- A section the new material does not touch comes back from your previous assessment unchanged, word for word. Do not rephrase for variety.\n- "What we know so far" and "Ruled out" are cumulative records: never drop a dated fact because it is old, and never rewrite a value you cannot see this pass. If the new material adds NOTHING to one of these two sections, output just its heading followed by the single word: unchanged. I will keep your previous version of that section exactly as it was. If anything is new, reproduce the section in full with the additions.\n- Open "Right now" with what the new material changed. If nothing of substance changed, say so in one line and leave the rest standing.\n- Re-emit ## Working line, ## Differential, ## Not answered, and ## Corrections in their exact formats every pass. Start the Differential from the filed rows above and move a number only by what the new material actually settles; do not re-derive the list from scratch.\n- If a new message contradicts something in your previous assessment, the new message wins. Change the read, and say plainly in "Right now" what changed and why.`
              : prior
                ? `Here is your previous assessment of this client:\n\n<previous>\n${priorText}\n</previous>\n\nHere is the full conversation as it now stands:\n\n<transcript>\n${chat}\n</transcript>\n${qaBlock(qa)}\nUpdate the assessment. Carry forward what still holds, revise what the new messages change, and say explicitly if something new contradicts an earlier read.${compacting ? `\n\nYour previous assessment has grown long. This pass, consolidate "What we know so far" without losing information: merge duplicate rows, collapse repeated normal results into one dated range (for example "CBC normal x4, Jun 3 to Jul 20"), and keep every abnormal result, every medication change, and every date as its own line. Consolidation means shorter, never emptier: anything a specialist would ask about stays.` : ''}`
                : `Here is the conversation so far:\n\n<transcript>\n${chat || '(no messages yet; the case material is in the attached files)'}\n</transcript>\n${qaBlock(qa)}\nWrite the first assessment.`)
              + (qa.length ? `\n\nThe discussion with Eric is part of the case record. A conclusion he reached with you there, a direction he gave, or a possibility you two raised or sank moves this assessment and the Differential section exactly as if he had said it in the client thread. Anything conceded in that discussion, by you or by him, is settled unless new evidence reopens it: move the differential by as much as the conceded point actually bears on it, no more and no less. If that discussion changed your read since the previous assessment, say so in "Right now".` : '')
              + dxOverrideNote(state)
              + bookkeepingNote(state, { delta: passType === 'delta' })
              + economicsNote(econ)
              + mediaNote(media),
          },
          ...media.blocks,
        ],
      }],
    });

    const customId = `${kind}-${String(id).slice(0, 40)}-${runT0}`;
    const batchId = await submitTurnBatch(env, turn, customId);
    // Everything the finish needs that cannot be recomputed when the result
    // lands. The thread keeps moving while the batch runs, so the stamps are
    // pinned to what THIS turn was actually shown: a message that arrives
    // mid-flight stays past the through-stamp and the finish re-queues it.
    await setState(env, kind, id, {
      stage: 'thinking', progressAt: new Date(),
      batchCtx: {
        batchId, customId, submittedAt: new Date(),
        passType, catchup, newerLeft, freshMsgs: fresh.length,
        effort: passEffort, auto, skipMedia,
        newestTs: newestTs ? new Date(newestTs) : null,
        chunkThroughTs: (() => {
          if (!(passType === 'delta' && catchup && fresh.length)) return null;
          const ts = fresh[fresh.length - 1].data.ts;
          return ts ? new Date(ts.toDate ? ts.toDate() : ts) : null;
        })(),
        qaSig, dxSig, qaOverrides,
        media: {
          included: media.included, known: media.known, queued: media.queued,
          skipped: media.skipped, deferred: media.deferred || [],
          readKeys: media.readKeys, carry: media.carry,
        },
      },
    });
    // The queue row is the poll's to-do entry, so it must survive the flight.
    // kind and id ride a MASKED write: a full write here once reset tries,
    // and a row that vanished meanwhile comes back valid this way.
    await patchDoc(env, queuePath(kind, id), { kind, id }, { mask: ['kind', 'id'] }).catch(() => {});
    await diagLog(env, {
      ev: 'batch-submit', kind, passType, effort: passEffort, auto,
      ms: Date.now() - runT0, freshMsgs: fresh.length, files: media.included.length,
      // Lengths and reason names only, never content: why a full ran, and how
      // big the prior it re-read was.
      ...(fullWhy ? { why: fullWhy } : {}), priorChars: String(prior || '').length,
    });
  } catch (err) {
    console.error('advisor analysis:', err.stack || err);
    await diagLog(env, {
      ev: 'end', ok: false, kind, auto,
      err: String(err?.message || err).slice(0, 140),
    });
    await setState(env, kind, id, { status: 'error', error: friendly(err) })
      .catch(() => {});
    // Count the failure on the queue entry, and give up after three. The delete
    // used to sit only on the success path, so anything that threw AFTER the
    // model turn - a Firestore blip on the state write, a bad field - left the
    // job queued and the cron bought the identical max-effort turn again every
    // five minutes, indefinitely, throwing every answer away.
    //
    // counted means the cron already stamped this attempt before dispatching
    // it. Counting it again here charged every catchable failure double, which
    // cut "three goes at one analysis" down to two, and made the one real
    // retry a degraded no-files pass. The cron's own give-up check handles the
    // cap on its next firing.
    if (!counted) {
      try {
        const q = await getDoc(env, queuePath(kind, id));
        const tries = Number(q?.data.tries || 0) + 1;
        if (tries >= ANALYSIS_MAX_TRIES) {
          await deleteDoc(env, queuePath(kind, id));
          console.warn(`advisor: giving up on ${kind}/${id} after ${tries} tries`);
        } else {
          await patchDoc(env, queuePath(kind, id), { tries }, { mask: ['tries'] });
        }
      } catch (e2) {
        // Cannot even record the failure: drop the job rather than loop on it.
        await deleteDoc(env, queuePath(kind, id)).catch(() => {});
      }
    }
  }
}

/**
 * The second half of an analysis: the batch landed, fold the turn's answer
 * into the case. Everything volatile was pinned in batchCtx at submit time;
 * the state and the thread are re-read fresh, because the harvest priors and
 * the correction id check only get better with newer data, and the analysis
 * text itself cannot have moved (a flight owns its case; see the guard in
 * runAnalysis). Throws land in pollFlight's failure path, which parks the
 * error on the sweep's slow retry clock.
 */
async function finishAnalysis(env, kind, id, ctx, message) {
  const analysis = extractText(message);
  const [rows, state] = await Promise.all([
    recentMessages(env, kind, id),
    getDoc(env, statePath(kind, id)),
  ]);
  const p = state?.data || {};
  const prior = p.analysis;
  const alreadyRead = Array.isArray(p.readFiles) ? p.readFiles : [];
  const m = ctx.media || {};
  const passType = ctx.passType || 'full';
  const submittedMs = ctx.submittedAt ? new Date(ctx.submittedAt).getTime() : 0;
  // Each machine-read section is pulled out and stripped in turn, so none of
  // it reaches the assessment Eric actually reads.
  const cover = harvestWorkingLine(await harvestKeyTerms(env, analysis));
  const dx = harvestDifferential(cover.text, p.differential);
  const un = harvestUnanswered(dx.text, p.unanswered);
  const corr = harvestCorrections(un.text, rows, p.corrections);
  // Stamps for the shelf badges. A differential that came back identical is
  // not news, so its stamp holds rather than moving; a badge that lights on
  // every pass is a badge he stops reading. fileAt moves when this pass
  // actually read something new.
  const now = new Date();
  const moved = !sameDifferential(p.differential, dx.differential);
  const diffAt = moved ? now : (p.diffAt || null);
  const fileAt = (m.included || []).length ? now : (p.fileAt || null);
  // Movement history: a slim snapshot per pass that changed the list, so the
  // panel can say "up from 45%" instead of making Eric remember.
  const prevHistory = Array.isArray(p.diffHistory) ? p.diffHistory : [];
  const diffHistory = moved && dx.differential.length
    ? [{ at: now, rows: dx.differential.map((r) => ({ name: r.name, pct: r.pct })) }, ...prevHistory].slice(0, 12)
    : prevHistory;
  // Fold "unchanged" stubs back in BEFORE judging length: a legitimate delta
  // that stubbed both cumulative sections is short by design.
  const finalText = passType === 'delta'
    ? spliceUnchanged(corr.text, prior, ['What we know so far', 'Ruled out'])
    : corr.text;
  // A delta reply that came back at half the prior's size lost sections, and
  // saving it would destroy them permanently (the assessment is its own
  // memory). Discard it and force the retry to be a full read. pollFlight's
  // failure path clears batchCtx and parks the error.
  if (passType === 'delta' && prior && finalText.length < String(prior).length * 0.5) {
    await setState(env, kind, id, { forceFull: true }).catch(() => {});
    throw new Error('The update pass came back too short and was discarded. A full read runs next.');
  }
  await setState(env, kind, id, {
    diffAt, fileAt, diffHistory,
    // What this turn folded in. A catch-up chunk stamps only through ITS OWN
    // last message, so the backlog behind it stays owed and the next pass
    // takes the next chunk.
    analyzedThroughTs: (passType === 'delta' && ctx.catchup && ctx.chunkThroughTs)
      ? new Date(ctx.chunkThroughTs)
      : (ctx.newestTs ? new Date(ctx.newestTs) : null),
    qaSig: ctx.catchup ? (p.qaSig || '') : (ctx.qaSig || ''),
    fullDue: passType === 'full' ? null : (p.fullDue || null),
    lastPassType: passType,
    passesSinceFull: passType === 'full' ? 0 : (Number(p.passesSinceFull) || 0) + 1,
    lastFullAt: passType === 'full' ? now : (p.lastFullAt ? new Date(p.lastFullAt) : null),
    dxOverrideSig: ctx.dxSig || '',
    qaOverrideCount: ctx.qaOverrides || 0,
    dismissedSig: corr.corrections.filter((c) => c.dismissed).map((c) => c.msgId).sort().join(','),
    forceFull: null,
    errorRetries: null, errorRetryAt: null,
    batchCtx: null,
    analysis: finalText, status: 'idle', error: null, updatedAt: new Date(),
    pendingAt: null, startedAt: null, progressAt: null, stage: null, mediaPlan: null,
    // A pass that lost the working line keeps the stored one: blanking the
    // folder cover over a formatting slip reads as the case going backwards.
    workingDx: cover.workingDx || p.workingDx || '',
    differential: dx.differential,
    unanswered: un.unanswered,
    corrections: corr.corrections,
    readFiles: [...alreadyRead, ...(m.readKeys || [])].slice(-MAX_READ_MEMORY),
    pendingMedia: m.carry || [],
    mediaReport: {
      read: m.included || [],
      known: m.known || [],
      queued: m.queued || [],
      unreadable: m.skipped || [],
      deferred: m.deferred || [],
      at: new Date(),
    },
  });
  // Mirror the cover so the dashboard shelf paints every folder from one
  // read. It lands on caseMeta, which is Worker-only by rule, NOT on the
  // client-readable case doc: a working diagnosis is Eric's private
  // material, never something a patient should find on their own record.
  if (kind === 'case') {
    const raw = p.dxOverride;
    const override = typeof raw === 'string' ? raw.trim() : '';
    await patchDoc(env, `caseMeta/${id}`, {
      workingDx: {
        text: override || cover.workingDx || p.workingDx || '',
        by: override ? 'eric' : 'advisor',
        at: now,
      },
      advisorAt: now,
      diffAt,
      fileAt,
      draftAt: p.draftStatus === 'ready' ? (p.draftAt || now) : null,
    }, { mask: ['workingDx', 'advisorAt', 'diffAt', 'fileAt', 'draftAt'] })
      .catch((err) => console.warn('caseMeta mirror:', err.message || err));
  }
  await deleteDoc(env, queuePath(kind, id)).catch(() => {});
  // Unfinished business re-queues itself: files this turn could not fit, the
  // rest of a catch-up backlog, and anything that arrived while the batch was
  // in flight (the through-stamp is pinned to submit time, so a mid-flight
  // message is past it and still owed a pass). force, because updatedAt is
  // seconds old here and the floor would swallow the row.
  const newestNow = rows.reduce((acc, r) => {
    const ts = r.data.ts;
    const t = ts ? new Date(ts.toDate ? ts.toDate() : ts).getTime() : 0;
    return Number.isFinite(t) && t > acc ? t : acc;
  }, 0);
  const behind = ctx.newestTs && newestNow > new Date(ctx.newestTs).getTime();
  if ((m.carry || []).length || (ctx.catchup && ctx.newerLeft > 0) || behind)
    await markPending(env, kind, id, { force: true }).catch(() => {});
  await diagLog(env, {
    ev: 'end', ok: true, kind, passType, effort: ctx.effort, auto: ctx.auto !== false,
    batch: true, ms: submittedMs ? Date.now() - submittedMs : 0,
    freshMsgs: ctx.freshMsgs || 0, files: (m.included || []).length,
  });
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
    const [rows, state, knowledge, style, qa, econ] = await Promise.all([
      recentMessages(env, kind, id),
      getDoc(env, statePath(kind, id)),
      loadKnowledge(env),
      loadStyle(env),
      // The exchanges before this one, minus the row being answered right now.
      // Without them every question started from zero and "our conversation"
      // never existed on the advisor's side.
      loadQa(env, kind, id, { skip: qaId }),
      loadEconomics(env, kind, id),
    ]);
    const chat = transcript(rows);
    let fileBlocks = [];
    let fileNote = '';
    if (attachment) {
      const out = await attachmentBlock(env, attachment, kind, id)
        .catch((err) => ({ skip: `fetch failed (${String(err.message || err).slice(0, 120)})` }));
      if (!out.block) throw new Error(`Couldn't read "${attachment.name}": ${out.skip}.`);
      fileBlocks = [out.block];
      fileNote = `\nEric attached the file "${attachment.name}" for review; it follows this message. Read it directly and answer from what you actually see.`;
    }
    const answer = await ask(env, {
      effort: QUESTION_EFFORT,
      maxTokens: QUESTION_TOKENS,
      // The same heartbeat the analysis and the draft write. Without it a
      // question that died mid-answer was indistinguishable from one still
      // being thought about, and the panel had nothing to go on.
      onBeat: () => patchDoc(env, `${statePath(kind, id)}/qa/${qaId}`,
        { progressAt: new Date() }, { mask: ['progressAt'] }).catch(() => {}),
      system: [{ type: 'text', cache: true, text: `${VOICE}

Eric is asking you a direct question about this client. Answer it and stop:
under 120 words unless the question itself demands more. Don't re-summarise
the case at him; he has the transcript in front of him.

When your answer recommends a move, ground it: who orders it, how it gets
started in practice, and how long that realistically takes. Never hand him a
move that needs a specialist or an approval he does not have yet without
naming the step that gets him there.

After the answer, three optional machine-read sections (they are stripped
before he sees the answer):
\`## Key terms\`: any medical term central to your answer that is not in his
glossary, one per line as \`- Term [Category]: plain-words definition\`
(Category: Condition, Symptom, Test or lab, Medication, Anatomy, Procedure,
Concept). Skip the section if there are none.
\`## Mastered\`: any not-yet-mastered glossary term his QUESTION shows he
already understands: he used it correctly and fluently, not asking what it
means. One term per line as \`- Term\`. Asking about a term is the opposite of
mastering it. Skip the section if none.
\`## Forgotten\`: any term on his mastered list that this question shows he no
longer holds. He asked what it means, or used it wrongly. One term per line as
\`- Term\`. Skip the section if none.

Tell him when he is done. He is a working advocate on a fixed fee, and his
failure mode is grinding a case he has already solved, asking a fourth
question when the plan is sound. If his question is one whose answer would
not change what he actually does next, answer it briefly and then say so in
one line: he has what he needs, the next move belongs to the call. Judge it
on readiness, not on the clock, and never quote money back at him. If
something clinically important is still open, that outranks this entirely:
say what is open and keep going, however long it has taken. And say it once:
if you already told him he was ready in this discussion and nothing has
changed, do not say it again; a readiness line on every answer is noise he
will rightly stop reading.

He is allowed to be right. When he makes a point that actually breaks your
reasoning, concede it plainly and say what it changes; do not concede as a
courtesy and then carry on as before. When a concession touches the
differential, say so in the concession itself: name the possibility and
roughly how the point moves it (a nudge, a rerank, a new row), weighted to
what the point actually bears, so your next assessment starts from the
concession instead of relitigating it. When he says something outright
wrong, correct it just as plainly, once, without softening it into a maybe.
Both of those are the job.
${SELF_NOTE}` },
      // Learned material on its own block, after the cached one, so the
      // glossary growing or the profile updating never busts the cache on
      // the standing instructions above.
      { type: 'text', text: `${knowledgeNote(knowledge)}${stanceNote(style)}${override ? OVERRIDE_NOTE : ''}` || ' ' }],
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `<transcript>\n${chat || '(no messages yet)'}\n</transcript>\n${
              state?.data.analysis ? `\n<your_current_assessment>\n${state.data.analysis}\n</your_current_assessment>\n` : ''
            }${
              state?.data.draft ? `\n<your_current_draft>\nA reply you drafted for Eric to send, not yet sent. He may be asking about it.\n${state.data.draft}\n</your_current_draft>\n` : ''
            }${qaBlock(qa)}${
              qa.length ? '\nThis is one continuing conversation. His question below may lean on it; do not repeat what you already told him there.\n' : ''
            }${economicsNote(econ)}${fileNote}\nEric asks: ${question}`,
          },
          ...fileBlocks,
        ],
      }],
    });
    // Same learning protocol as assessments: new jargon lands in the
    // dictionary, fluent use in his question counts as mastery, and asking
    // what a mastered term means counts the other way.
    let cleaned = await harvestKeyTerms(env, answer);
    cleaned = await applyMastered(env, cleaned);
    cleaned = await applyForgotten(env, cleaned);
    if (override) cleaned = await fileOverride(env, cleaned);
    await patchDoc(env, path, {
      answer: cleaned, status: 'done', override,
    }, { mask: ['answer', 'status', 'override'] });
    // A settled exchange is new case material now that analyses read the
    // discussion, so flag the assessment stale. markPending's own floor keeps
    // a burst of questions from buying a max-effort analysis per question; the
    // cron picks the flag up, and the next pass folds the discussion in.
    await markPending(env, kind, id).catch(() => {});
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
export async function runDraft(env, kind, id, instruction, revise = false, base = '', noStream = false) {
  try {
    await setState(env, kind, id, {
      draftStatus: 'running', draftError: null, draftStartedAt: new Date(), draftProgressAt: null,
      // The request, saved before the run: if this connection dies mid-write
      // (screen lock, app switch), the cron finds the marker below, sees the
      // heartbeat has stopped, and re-runs exactly this. Cleared when a run
      // finishes or fails on its own.
      draftReq: { instruction: instruction || '', revise: !!revise, base: base || '', at: new Date() },
    });
    await patchDoc(env, draftQueuePath(kind, id), { kind, id, draft: true, at: new Date() },
      { mask: ['kind', 'id', 'draft', 'at'] }).catch(() => {});
    const [rows, state, style, qa] = await Promise.all([
      recentMessages(env, kind, id),
      getDoc(env, statePath(kind, id)),
      loadStyle(env),
      // The usual sequence is: settle direction with the advisor, then press
      // Prepare a response. The assessment lags that discussion by at least
      // the pending floor, so without this the draft was written blind to
      // the direction it was written for. full, because the relay rule says
      // "drop nothing he said" and the analysis-sized slices dropped plenty.
      loadQa(env, kind, id, { full: true }).catch(() => []),
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
      noStream,
      onBeat: () => setState(env, kind, id, { draftProgressAt: new Date() }).catch(() => {}),
      // The visible draft is short, but thinking spends from the same budget.
      maxTokens: 16000,
      system: [{ type: 'text', text: `${VOICE}

Write the next message for Eric to send to this client, as Eric, in his voice.

Answer the client's MOST RECENT messages: everything they've sent since Eric
last wrote. That's what the reply is for. The rest of the thread and your
assessment are context to keep the reply consistent, not material to re-answer.

One exception outranks that default: when Eric's instruction tells you to
relay or restate something ("take what I just said to you", "tell him what
we discussed"), the message is BUILT from Eric's own words in the private
discussion you are given. Reorganize and tidy them for the client; invent
nothing, add none of your own read, and drop nothing he said that fits the
instruction. If you cannot find what he is pointing at, the draft is the
single sentence: I could not find what you are referring to, ask me again
after my answer lands. And if the passage you would relay appears cut off
partway (a shortened one ends with …), do not relay a fragment: the draft is
the single sentence: Part of what you said reached me cut off, ask me again
and I will use the whole of it.

You are given his own past messages. Match them: sentence length, how formal he
is, whether he uses contractions, how he opens and closes, how much warmth he
shows, whether he uses lists. If his messages are short, yours is short.

You may also be given his learned profile and recent before/after examples of
how he edited your past drafts, at the end of these instructions. Those edits
are him correcting you: treat every difference as an instruction. His opinions
are his calls. Hold them, and where one bears on this message, surface it the
way his profile says to: as what he wants asked or chased, in his register.
Never sand his wording down into textbook language he has already edited out.

Output the message text and nothing else: no preamble, no "here's a draft",
no quotation marks around it, no sign-off he doesn't actually use.

Nothing in the message may hint that any assessment, analysis, note system,
or advisor exists behind it: the client only ever hears Eric, writing from
what he knows.

Length: this chat rejects messages over 2000 characters, and a wall of text
reads as canned anyway. Stay under 900 characters unless Eric's instruction
genuinely requires more; never exceed 1900. The 1900 ceiling beats every
other rule here, the relay rule included: when everything he said will not
fit under it, keep his content in his order up to the ceiling, end at a
sentence boundary, and finish with one short line telling Eric the rest
needs a second message (he will cut that line before sending).

THIS MESSAGE GOES TO THE PATIENT. Every instruction above about how to talk to
Eric is about talking to ERIC. It does not apply here. Warmth over bluntness.
Never correct the client the way you would correct him. Warmth here is
specific, not performed: it lives in remembering what they said, naming what
happens next, and not wasting their energy. Never open with a canned empathy
line ("I hear you", "I completely understand", "I'm so sorry you're going
through this") unless his own messages open that way. No bullet lists, no
numbered steps, and one question at a time unless his samples do otherwise.
Never gloss a term for
his benefit; explain it for theirs, or leave it out. Never include anything
about distress, safety or crisis resources: that is Eric's own to handle,
through a control he presses himself, and it must never arrive inside a draft.

He is not a doctor. Never put a diagnosis in his mouth.

And never put a treatment decision there either. Do not tell the client to
start, stop, change, delay or increase any medication or treatment. Do not tell
them to refuse or postpone anything their care team has arranged. Where Eric
disagrees with a treating clinician, the message says what he wants ASKED at
the next appointment, never what to do instead. If his learned positions point
at a treatment call, convert it into a question for the doctor.

What he CAN say: what he would want asked, what a result might mean, what he
will chase down, and what to bring to the next appointment.

Honest about uncertainty, always. Never promise an outcome, call a pending
result probably fine, or round a real unknown up to reassurance. What he can
honestly offer is the next step and his own persistence, so offer that.

Everything in this block, the patient-safety rules above especially, outranks
anything in the learned profile that follows.`, cache: true },
      // The learned profile rides its own block after the cached one, so the
      // nightly study updating it never busts the cache on the rules above.
      { type: 'text', text: styleNote(style) || ' ' }],
      messages: [{
        role: 'user',
        content: `Here is how Eric writes, in his own messages to this client:\n\n<his_voice>\n${voice || '(none yet: keep it plain, warm and brief)'}\n</his_voice>\n${
          lessons ? `\nHow he edited your recent drafts before sending (each difference is an instruction):\n\n<his_edits>\n${lessons}\n</his_edits>\n` : ''
        }${qa.length ? `${qaBlock(qa)}\nThat discussion is direction AND material. Eric's own words in it are his to send: when his instruction points at the discussion ("what I just said", "what we talked about"), build the message FROM what he said there, keeping his content and his calls, tidied for the client to read. What never reaches the client: YOUR half of the discussion in its own voice, and any mention that the discussion exists.\n` : ''
        }\nThe conversation so far:\n\n<transcript>\n${chat || '(no messages yet)'}\n</transcript>\n${
          state?.data.analysis ? `\nYour current assessment of the case:\n\n<assessment>\n${state.data.analysis}\n</assessment>\n` : ''
        }${baseDraft
          ? `\nYour current draft:\n\n<current_draft>\n${baseDraft}\n</current_draft>\n\nEric wants it revised: ${instruction || 'improve it'}. Rewrite the whole message with that change made, keeping everything that already works. Output only the revised message.`
          : instruction ? `\nEric wants this message to: ${instruction}` : '\nWrite the natural next thing for him to say.'}`,
      }],
    });
    await setState(env, kind, id, {
      draft, draftStatus: 'ready', draftError: null, draftAt: new Date(),
      draftStartedAt: null, draftProgressAt: null, draftReq: null,
    });
    await deleteDoc(env, draftQueuePath(kind, id)).catch(() => {});
  } catch (err) {
    console.error('advisor draft:', err.stack || err);
    // A real failure surfaces as its own error; only a DEAD run (no status
    // write at all) leaves the marker for the cron, so a model error is
    // never silently re-bought.
    await setState(env, kind, id, {
      draftStatus: 'error', draftError: friendly(err), draftReq: null,
    }).catch(() => {});
    await deleteDoc(env, draftQueuePath(kind, id)).catch(() => {});
  }
}

/**
 * Write an insurance appeal letter.
 *
 * A deliberate sibling of runDraft rather than a branch inside it: they share
 * a shape but almost nothing else. A draft is a short message to a frightened
 * person and must never read as clinical. An appeal is a formal document to a
 * plan's medical reviewer, is meant to read as clinical, cites the plan's own
 * policy back at it, and is filed against a legal deadline. One prompt trying
 * to be both would be worse at each.
 *
 * The letter goes OUT under Eric's name through the insurer's own portal, fax
 * or certified mail, so nothing here sends anything. Approval is a state
 * write; the sending is his, which is also what keeps proof of timely filing
 * in his hands.
 */
export async function runAppeal(env, kind, id, appeal, revise = false, base = '', noStream = false) {
  try {
    await setState(env, kind, id, {
      appealStatus: 'running', appealError: null,
      appealStartedAt: new Date(), appealProgressAt: null,
      appealReq: { appeal: appeal || {}, revise: !!revise, base: base || '', at: new Date() },
    });
    await patchDoc(env, appealQueuePath(kind, id), { kind, id, appeal: true, at: new Date() },
      { mask: ['kind', 'id', 'appeal', 'at'] }).catch(() => {});

    const [rows, state, style] = await Promise.all([
      recentMessages(env, kind, id),
      getDoc(env, statePath(kind, id)),
      loadStyle(env),
    ]);
    const p = state?.data || {};
    const chat = transcript(rows);
    const baseLetter = revise ? (base || p.appeal || '') : '';
    const a = appeal || {};

    const letter = await ask(env, {
      effort: 'high',
      noStream,
      onBeat: () => setState(env, kind, id, { appealProgressAt: new Date() }).catch(() => {}),
      maxTokens: 20000,
      system: [{ type: 'text', text: `${VOICE}

You are writing an insurance appeal letter for Eric to file on his client's
behalf. He is their authorised representative. The letter goes out over his
name, on his letterhead, to a plan reviewer who is usually a nurse and
sometimes a physician.

WHAT AN APPEAL IS
It is an argument that the plan applied its own rules wrongly to these facts.
It is not a plea, not a story about how much the patient is suffering, and not
a demand. The reader has a stack of these and a checklist. Win on the
checklist.

STRUCTURE, in this order, with these headings:

RE: line - member name, member ID, claim number, dates of service, the
provider, and the denial date. Every one you were given, on one block.

1. What was denied and why. State the plan's own stated reason and its denial
   code if there is one, in the plan's own words. If you were not told the
   reason, say that the reason was not stated and request it in writing, which
   is itself a ground.
2. Why that reason does not apply here. This is the letter. Take the plan's
   criterion apart against the documented facts: what the records show, on
   what dates, from which clinician. Quote the plan's own medical policy or
   coverage criteria where you were given them, and show the criterion met
   line by line. Where a criterion is not met, say so and say why it should
   not control.
3. The clinical support. Cite what is in the record: results with dates,
   clinician statements, the treating physician's rationale. Name published
   guidelines by body and year ONLY where you are certain of them, and never
   invent a citation, a study, a guideline number, or a quotation. An appeal
   caught fabricating loses the whole letter's credibility and the claim.
4. What is being requested. Overturn and pay, a peer to peer review, the full
   plan document and criteria used, and the reviewer's specialty and
   credentials. Be specific.
5. The deadline and the record. State the filing date, that this is timely,
   and that a written response is requested within the plan's own timeframe.

RULES
- Facts only, from what you were given. If a fact is missing, write
  [NEEDS: what is missing] inline so Eric can fill it before filing. Never
  invent a date, a value, a name or a claim number.
- No diagnosis of your own and no treatment recommendation. You are arguing
  about coverage of care that clinicians ordered.
- Formal register, short paragraphs, no adjectives doing work that facts
  should do. Never sentimental, never threatening.
- Never mention that anything was drafted with help. It is his letter.
- No em dashes or en dashes anywhere.
- End with his signature block and an enclosures line listing what should be
  attached.

Output the letter and nothing else. No preamble, no notes to Eric outside the
[NEEDS: ] markers, no closing commentary.` , cache: true },
      { type: 'text', text: stanceNote(style) || ' ' }],
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: `<claim>
Member: ${a.memberName || '(not given)'}
Member ID: ${a.memberId || '(not given)'}
Plan: ${a.planName || '(not given)'}
Claim number: ${a.claimNumber || '(not given)'}
Dates of service: ${a.serviceDates || '(not given)'}
Provider: ${a.provider || '(not given)'}
Denied on: ${a.deniedAt || '(not given)'}
Appeal track: ${a.trackLabel || '(not given)'}
Filing deadline: ${a.dueAt || '(not given)'}
</claim>

<denial_reason>
${a.denialReason || '(the plan did not state a reason, or it was not supplied)'}
</denial_reason>

<plan_policy>
${a.policyText || '(no policy language supplied)'}
</plan_policy>

<clinical_record>
${a.clinicalFacts || '(none supplied beyond the case notes below)'}
</clinical_record>

<case_notes>
${p.analysis ? String(p.analysis).slice(0, 12000) : '(no assessment on file)'}
</case_notes>

<thread>
${chat.slice(-8000)}
</thread>
${baseLetter ? `\n<current_letter>\n${baseLetter}\n</current_letter>\n\nRevise the letter above. ${a.instruction ? `What to change: ${a.instruction}` : 'Tighten the argument and fix anything unsupported.'} Keep everything that is working.` : ''}`,
        }],
      }],
    });

    await setState(env, kind, id, {
      appeal: letter, appealAt: new Date(), appealStatus: 'ready',
      appealReq: null, appealStartedAt: null, appealProgressAt: null, appealError: null,
      appealMeta: {
        memberId: a.memberId || '', planName: a.planName || '',
        claimNumber: a.claimNumber || '', deniedAt: a.deniedAt || '',
        trackId: a.trackId || '', trackLabel: a.trackLabel || '', dueAt: a.dueAt || '',
      },
    });
    await deleteDoc(env, appealQueuePath(kind, id)).catch(() => {});
  } catch (err) {
    console.error('advisor appeal:', err.stack || err);
    await setState(env, kind, id, {
      appealStatus: 'error', appealError: friendly(err),
      appealReq: null, appealStartedAt: null, appealProgressAt: null,
    }).catch(() => {});
    await deleteDoc(env, appealQueuePath(kind, id)).catch(() => {});
  }
}


/**
 * Call notes: a working document for ERIC'S OWN REFERENCE before a call,
 * never sent to the client. Deliberate sibling of runDraft/runAppeal rather
 * than a branch inside either - a third document type earns a third runner.
 *
 * The shape Eric specified (2026-08-25, condensed from his words):
 *   - The ACTION PLAN comes first, short and sweet, highest priority first -
 *     "best plan of action" for the first call.
 *   - Then the UPSELL PITCH, written out so he can deliver it himself
 *     without the client having to reason through it - his clients are often
 *     cognitively declining, so the pitch carries its own weight.
 *   - Then RESOURCES: university hospitals and academic centers within
 *     practical reach of the client, and feasible providers there worth a
 *     referral, with their specialty. Suggestions from model knowledge are
 *     marked to verify - a hallucinated referral in a call is worse than a
 *     blank line.
 *   - His PERSONAL IN-APP NOTES are context and are taken seriously.
 *   - Anything that wants a chart or graphic is written [in brackets] on
 *     its own line; the PDF renders those as visual frames.
 */
export async function runCallNotes(env, kind, id, instruction, revise = false, base = '', noStream = false) {
  try {
    await setState(env, kind, id, {
      callNotesStatus: 'running', callNotesError: null,
      callNotesStartedAt: new Date(), callNotesProgressAt: null,
      callNotesReq: { instruction: instruction || '', revise: !!revise, base: base || '', at: new Date() },
    });
    await patchDoc(env, callNotesQueuePath(kind, id), { kind, id, callNotes: true, at: new Date() },
      { mask: ['kind', 'id', 'callNotes', 'at'] }).catch(() => {});

    const parent = kind === 'sub' ? 'subscriptions' : 'cases';
    const [rows, state, caseDoc, notesDoc, agendaRows, qa, style] = await Promise.all([
      recentMessages(env, kind, id),
      getDoc(env, statePath(kind, id)),
      getDoc(env, `${parent}/${id}`).catch(() => null),
      getDoc(env, `${parent}/${id}/private/notes`).catch(() => null),
      listDocs(env, `${parent}/${id}/agenda`, { pageSize: 100 }).catch(() => []),
      loadQa(env, kind, id, { full: true }).catch(() => []),
      loadStyle(env),
    ]);
    const p = state?.data || {};
    const c = caseDoc?.data || {};
    const baseNotes = revise ? (base || p.callNotes || '') : '';
    // The rich-text notes editor stores HTML; the model wants prose. The
    // note route caps the doc at 200k characters, so bound what rides the
    // (uncached) user turn - the TAIL, which is where the newest notes are.
    const personalNotes = String(notesDoc?.data.html || '')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
      .slice(-20000);
    const agenda = (agendaRows || [])
      .map((r) => `${r.data.done ? '[covered] ' : ''}${r.data.text}`)
      .filter(Boolean).join('\n').slice(0, 8000);
    // "Check-in booked" must mean a FUTURE one; any tier case that has ever
    // had a check-in would otherwise hide its real next appointment.
    const nextCheckIn = (Array.isArray(c.checkIns) ? c.checkIns : [])
      .some((x) => new Date(x.start).getTime() > Date.now());

    const out = await ask(env, {
      effort: 'high',
      noStream,
      onBeat: () => setState(env, kind, id, { callNotesProgressAt: new Date() }).catch(() => {}),
      maxTokens: 16000,
      system: [{
        type: 'text',
        cache: true,
        text: `${VOICE}

Write CALL NOTES for Eric: a working document for his own eyes only, to have open during his next call with this client. It is never sent to the client, but write nothing you would be ashamed for the client to read over his shoulder.

Structure, in this exact order:

1. "ACTION PLAN" - short and sweet. The highest-priority item first, then the next, at most five items, each one line of what to do and one line of why now. This is the best plan of action for the call, not a literature review.

2. "THE PITCH" - if an upsell genuinely fits this case (Full Access coordination, a follow-up, telehealth accompaniment), write the pitch out in Eric's voice, word for word, so he can say it as written. Two or three sentences, concrete to THIS case, no pressure tactics. His clients are often cognitively declining, so the pitch must carry its own weight: what it is, what it costs, what it changes for them. If no upsell fits, write "No pitch this call" and one line of why.

3. "RESOURCES NEARBY" - university hospitals and academic medical centers within practical reach of where this client is, and the kind of provider there worth a referral, with specialty. The client's location comes ONLY from what the record actually states: the case, Eric's notes, or the conversation. If none of them says where the client is, open the section with "Location not in the record" and name no place; a plausible city guessed from a timezone is worse than a blank line. Anything from your own knowledge rather than the case record gets "(verify)" after it. Never invent a named physician; name departments and programs, and only name a person if the case record itself does.

4. "WORTH REMEMBERING" - at most three lines of context he must not forget mid-call (allergies, a deadline, a sore subject, a promise already made).

Rules:
- Where a chart or graphic would serve better than words, write a single line [in square brackets] describing exactly the visual, e.g. [Line chart: TSH results across the last six months] or [Timeline: symptom onset against medication changes]. The bracketed line stands alone; the PDF turns it into a visual frame.
- Eric's personal notes are part of the case record. Take them seriously; where they conflict with the assessment, say so plainly.
- Plain text with the section headers above in capitals. No markdown headings, no asterisks.
- Never use an em dash or an en dash anywhere. Use a comma, a colon, or a period.`,
      }, {
        // His stances ride their own block after the cached one, the same
        // reason as runDraft: the nightly study must not bust the cache.
        type: 'text',
        text: stanceNote(style) || ' ',
      }],
      messages: [{
        role: 'user',
        content: `<case>
Client: ${c.clientName || 'unknown'} (${c.clientTz || 'timezone unknown'})
Status: ${c.status || 'unknown'}; tier: ${c.fullAccess ? 'Full Access' : 'standard'}
Next call: ${nextCheckIn ? 'check-in booked' : c.appointment?.start ? String(c.appointment.start) : 'unscheduled'}
</case>

<assessment>
${p.analysis || '(no assessment yet)'}
</assessment>

<erics_personal_notes>
${personalNotes || '(none)'}
</erics_personal_notes>

<next_call_list>
${agenda || '(empty)'}
</next_call_list>

${qaBlock(qa)}

<transcript>
${transcript(rows)}
</transcript>
${baseNotes ? `\n<current_notes>\n${baseNotes}\n</current_notes>\n` : ''}
${revise && instruction
    ? `Revise the current notes. Eric asked: ${instruction}\nKeep everything he did not ask to change.`
    : instruction
      ? `Write the call notes. Eric added: ${instruction}`
      : 'Write the call notes.'}`,
      }],
    });

    const notes = (out || '').trim();
    if (!notes) throw new Error('empty call notes');
    await setState(env, kind, id, {
      callNotes: notes, callNotesAt: new Date(), callNotesStatus: 'ready',
      callNotesReq: null, callNotesStartedAt: null, callNotesProgressAt: null, callNotesError: null,
    });
    await deleteDoc(env, callNotesQueuePath(kind, id)).catch(() => {});
  } catch (err) {
    console.error('advisor call notes:', err.stack || err);
    await setState(env, kind, id, {
      callNotesStatus: 'error', callNotesError: friendly(err),
      callNotesReq: null, callNotesStartedAt: null, callNotesProgressAt: null,
    }).catch(() => {});
    await deleteDoc(env, callNotesQueuePath(kind, id)).catch(() => {});
  }
}

/**
 * THE CALL DOCUMENT.
 *
 * Eric, 2026-08-26: "I would like to have a tab/section where I can upload a
 * document and the advisor can format it, add in other useful information
 * regarding his uploaded charts and labs, list questions that need to be
 * asked that were missed, and highlight anything and note with a * if there
 * is anything that I need to review that may be incorrect. It should format
 * it neatly, professionally, and in a flow I can use in the call."
 *
 * What makes this different from runCallNotes, which is a short working sheet
 * generated FROM the case: this one starts from a document Eric has already
 * written, and the case is the enrichment rather than the source. His
 * structure survives. The advisor reformats it, fills the gaps the case can
 * fill, names the questions he did not think to ask, and flags what it thinks
 * he should check.
 *
 * THE ASTERISK IS THE POINT. He is going to read this on a call while a sick
 * person waits, so anything the advisor is not certain of has to announce
 * itself rather than sit quietly inside a confident sentence. Every starred
 * item is also collected at the top, because a flag you only meet by
 * scrolling is a flag you miss.
 *
 * SOURCES, for the same reason. Every claim that did not come from Eric's own
 * document says where it came from, so he can check it in ten seconds instead
 * of trusting it.
 *
 * Effort is MAX on his explicit word. It is the most expensive setting in the
 * app and this is the turn he asked for it on.
 *
 * ADMIN ONLY. The route is admin-gated, the output lives on the advisor state
 * document (which no client can read), and nothing here is ever shown to or
 * sent to a client.
 */
export async function runCallDoc(env, kind, id, {
  instruction = '', revise = false, base = '', sources = [], noStream = false,
} = {}) {
  try {
    await setState(env, kind, id, {
      callDocStatus: 'running', callDocError: null,
      callDocStartedAt: new Date(), callDocProgressAt: null,
      // THE DESCRIPTORS ONLY, NEVER THE BYTES.
      //
      // This used to store `sources` verbatim, and an inline upload carries
      // its file as base64 - 4/3 of the file's real size. A Firestore
      // document is capped at 1 MiB, so any upload over about 786 KB made
      // this write fail with a raw 400 INVALID_ARGUMENT. Which is to say a
      // phone photo or a scanned page: the things he actually uploads. And
      // because this is the FIRST thing the function does, the model was
      // never called at all - he waited, then got Firestore's own error text.
      //
      // What it costs: a run stranded by a closed lid can no longer be
      // replayed from inline bytes. It can be replayed from anything
      // Storage-backed, and the descriptor still records what was there, so
      // a retry can say which upload it needs again rather than guessing.
      callDocReq: {
        instruction: instruction || '', revise: !!revise, base: base || '',
        sources: (sources || []).slice(0, MAX_CALLDOC_SOURCES).map((s) => ({
          name: s?.name || '',
          contentType: s?.contentType || '',
          size: Number(s?.size) || 0,
          mine: s?.mine === true,
          path: s?.path || '',
          url: s?.url || '',
          inline: typeof s?.data === 'string' && s.data.length > 0,
        })),
        at: new Date(),
      },
    });
    await patchDoc(env, callDocQueuePath(kind, id), { kind, id, callDoc: true, at: new Date() },
      { mask: ['kind', 'id', 'callDoc', 'at'] }).catch(() => {});

    const parent = kind === 'sub' ? 'subscriptions' : 'cases';
    const [rows, state, caseDoc, notesDoc, agendaRows, qa, style] = await Promise.all([
      recentMessages(env, kind, id),
      getDoc(env, statePath(kind, id)),
      getDoc(env, `${parent}/${id}`).catch(() => null),
      getDoc(env, `${parent}/${id}/private/notes`).catch(() => null),
      listDocs(env, `${parent}/${id}/agenda`, { pageSize: 100 }).catch(() => []),
      loadQa(env, kind, id, { full: true }).catch(() => []),
      loadStyle(env),
    ]);
    const p = state?.data || {};
    const c = caseDoc?.data || {};
    const baseDoc = revise ? (base || p.callDoc || '') : '';

    // The documents themselves. Eric's own upload comes first and is named as
    // his, because everything downstream depends on the model knowing which
    // words are already his and must be preserved.
    const blocks = [];
    const readNames = [];
    const skipped = [];
    for (const att of (sources || []).slice(0, MAX_CALLDOC_SOURCES)) {
      // Dropped by the route's inline budget before it ever got here. Named
      // rather than silently absent: a document built without a file he
      // watched himself pick is worse than one that says which file is gone.
      if (att?.overBudget) {
        skipped.push(`${att?.name || 'a file'}: too large to send with the others (put it on the case and pick it there, or send one page)`);
        continue;
      }
      const made = await attachmentBlock(env, att, kind, id).catch(
        (e) => ({ skip: friendly(e) }));
      if (made?.skip) { skipped.push(`${att?.name || 'a file'}: ${made.skip}`); continue; }
      if (!made?.block) continue;
      blocks.push({ type: 'text', text: `<document name="${escAttr(att?.name || 'untitled')}"${att?.mine ? ' from="Eric"' : ''}>` });
      blocks.push(made.block);
      blocks.push({ type: 'text', text: '</document>' });
      readNames.push(att?.name || 'untitled');
    }

    const personalNotes = String(notesDoc?.data.html || '')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
      .slice(-20000);
    const agenda = (agendaRows || [])
      .map((r) => `${r.data.done ? '[covered] ' : ''}${r.data.text}`)
      .filter(Boolean).join('\n').slice(0, 8000);

    const out = await ask(env, {
      effort: 'max',
      noStream,
      onBeat: () => setState(env, kind, id, { callDocProgressAt: new Date() }).catch(() => {}),
      maxTokens: 32000,
      system: [{
        type: 'text',
        cache: true,
        text: `${VOICE}

Build Eric a CALL DOCUMENT: the single sheet he will have open, and read from, while he is on the phone with this client. He is a patient advocate, not a clinician. It is for his eyes only and is never sent to anyone.

He has uploaded a document he prepared himself. THAT DOCUMENT IS THE SPINE. Keep his structure, his order and his priorities. You are reformatting and enriching it, not replacing it with your own. Where you keep his words, keep them; do not paraphrase him into blandness.

Write it in this order:

1. "REVIEW BEFORE YOU CALL" - every starred item from the whole document, gathered here as a numbered list, each one line. If there are none, write "Nothing flagged." A flag he has to scroll to find is a flag he misses, which is why they are collected here as well as marked in place.

2. "THE CALL, IN ORDER" - his document, reformatted into something a person can actually read aloud from under pressure. Short headed sections. Short lines. The thing he says or asks in plain language, with the supporting detail indented beneath it, so his eye can find the next thing to say without reading a paragraph. Numbers, dates and values that matter go on their own line where he can see them at a glance.

3. "QUESTIONS THAT ARE MISSING" - questions this case plainly needs answered that his document does not ask. Each one written as he would actually say it to the client, not as a topic. Say in one clause why it matters, and where the gap shows (a lab with no follow-up, a medication with no start date, a symptom mentioned once and never revisited). Do not pad this list; three real questions beat ten obvious ones.

4. "FROM THE CASE, NOT IN YOUR DOCUMENT" - what the case file, the charts, the labs, the chat and the assessment add that his document does not have. This is the section that earns its keep: trends across results, a contradiction between two documents, something the client said in chat that bears on what he wrote, a date that does not line up.

5. "SOURCES" - for every claim in sections 3 and 4, the document name, and the page or date where it is found. Anything that came from your own knowledge rather than this case says so outright.

THE ASTERISK. Put * immediately before anything Eric should personally verify before he relies on it: a value you read off a chart that could be misread, an inference rather than a stated fact, a contradiction between two documents, a date you calculated, anything you are less than confident about, and anything in his own document that looks wrong to you. Say in the same line what specifically to check. Being wrong on a call in front of a frightened person costs more than an extra asterisk, so when it is close, star it.

NEVER:
- Never invent a value, a date, a name or a result. If it is not in what you were given, say it is not in the record.
- Never diagnose, and never write anything that reads as medical advice to the client. Questions to ask a doctor are the shape this takes.
- Never soften something that matters to make the document flow better.
- Never use an em dash or an en dash. Use a comma, a colon, or a period.
- No markdown headings and no bold markers. Section headers in capitals, exactly as named above. Plain text he can read in any light.

Where a chart or a graphic would serve him better than a sentence, write one line [in square brackets] describing exactly the visual, for example [Line chart: creatinine across the last four draws]. The bracketed line stands alone.`,
      }, {
        type: 'text',
        text: stanceNote(style) || ' ',
      }],
      messages: [{
        role: 'user',
        content: [
          ...blocks,
          {
            type: 'text',
            text: `<case>
Client: ${c.clientName || 'unknown'} (${c.clientTz || 'timezone unknown'})
Status: ${c.status || 'unknown'}; tier: ${c.fullAccess ? 'Hands-Off Case Management' : 'standard'}
Next call: ${c.appointment?.start ? String(c.appointment.start) : 'unscheduled'}
</case>

<assessment>
${p.analysis || '(no assessment yet)'}
</assessment>

<erics_personal_notes>
${personalNotes || '(none)'}
</erics_personal_notes>

<next_call_list>
${agenda || '(empty)'}
</next_call_list>

${qaBlock(qa)}

<transcript>
${transcript(rows)}
</transcript>
${skipped.length ? `\n<files_that_could_not_be_read>\n${skipped.join('\n')}\n</files_that_could_not_be_read>\n` : ''}
${baseDoc ? `\n<current_call_document>\n${baseDoc}\n</current_call_document>\n` : ''}
${revise && instruction
  ? `Revise the current call document. Eric asked: ${instruction}\nKeep everything he did not ask you to change, including his own wording.`
  : instruction
    ? `Build the call document. Eric added: ${instruction}`
    : 'Build the call document.'}`,
          },
        ],
      }],
    });

    const doc = (out || '').trim();
    if (!doc) throw new Error('empty call document');
    await setState(env, kind, id, {
      callDoc: doc,
      callDocAt: new Date(),
      callDocStatus: 'ready',
      // What went into it, so the panel can say so and he is never guessing
      // which upload this was built from.
      callDocSources: readNames,
      callDocSkipped: skipped,
      callDocReq: null, callDocStartedAt: null, callDocProgressAt: null, callDocError: null,
    });
    await deleteDoc(env, callDocQueuePath(kind, id)).catch(() => {});
  } catch (err) {
    console.error('advisor call doc:', err.stack || err);
    await setState(env, kind, id, {
      callDocStatus: 'error', callDocError: friendly(err),
      callDocReq: null, callDocStartedAt: null, callDocProgressAt: null,
    }).catch(() => {});
    await deleteDoc(env, callDocQueuePath(kind, id)).catch(() => {});
  }
}
