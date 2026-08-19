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

If anything in the transcript looks genuinely urgent — stroke signs, status
epilepticus, rapid neurological decline, sepsis, suicidality — lead with it in
plain words. That outranks everything else.

HOW TO WRITE, always: short bits, never essays. Five short lines beat twenty
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
  return final.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

/**
 * The most recent MAX_MESSAGES of the thread, back in chronological order.
 * Newest-first then reversed, so a long case keeps its live end rather than
 * its opening pleasantries.
 */
async function recentMessages(env, kind, id) {
  const parent = kind === 'case' ? 'cases' : 'subscriptions';
  const rows = await listDocs(env, `${parent}/${id}/chat`, {
    pageSize: MAX_MESSAGES, orderBy: 'ts desc',
  });
  return rows.reverse().filter((r) => r.data.text);
}

/** The thread as plain labelled lines. */
function transcript(rows) {
  return rows
    .map((r) => `${r.data.role === 'admin' ? 'ERIC' : 'CLIENT'}: ${r.data.text}`)
    .join('\n\n');
}

/** Only Eric's lines — the sample the draft writer imitates. */
function myVoice(rows) {
  return rows.filter((r) => r.data.role === 'admin')
    .map((r) => r.data.text).slice(-40).join('\n---\n');
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
export async function runAnalysis(env, kind, id) {
  try {
    await setState(env, kind, id, { status: 'running', error: null, startedAt: new Date() });
    const [rows, state] = await Promise.all([
      recentMessages(env, kind, id),
      getDoc(env, statePath(kind, id)),
    ]);
    const chat = transcript(rows);
    if (!chat) {
      await setState(env, kind, id, { status: 'idle', updatedAt: new Date() });
      return;
    }
    const prior = state?.data.analysis;

    const analysis = await ask(env, {
      effort: ANALYSIS_EFFORT,
      onBeat: () => setState(env, kind, id, { progressAt: new Date() }).catch(() => {}),
      system: [{ type: 'text', text: `${VOICE}

Write Eric's working assessment of this client. He reads it on a phone beside
a live chat — it must scan in thirty seconds. Hard cap: 300 words total.

Use exactly these headings, in this order, as markdown \`##\` headings:

## Right now
## What this could be
## Worth chasing
## Ask next
## For you

"Right now": 2–4 short sentences, plain language. If you have a previous
assessment, open with what CHANGED since it — new message, new signal, a shift
in your read — then the single most useful next move. This is a running
commentary he reads mid-conversation, not a report.
"What this could be": at most 4 bullets, one line each — possibility, then the
one thing that would raise or lower it.
"Worth chasing": at most 4 bullets — a specific lab, image, or record, and what
it rules in or out.
"Ask next": at most 3 questions, verbatim, ready to paste.
"For you": at most 3 bullets of advocacy strategy — who to push, where this
stalls.

Be specific or say nothing. "Consider further workup" is worthless. If the
transcript is too thin for a section, one line saying what you'd need.` }],
      messages: [{
        role: 'user',
        content: prior
          ? `Here is your previous assessment of this client:\n\n<previous>\n${prior}\n</previous>\n\nHere is the full conversation as it now stands:\n\n<transcript>\n${chat}\n</transcript>\n\nUpdate the assessment. Carry forward what still holds, revise what the new messages change, and say explicitly if something new contradicts an earlier read.`
          : `Here is the conversation so far:\n\n<transcript>\n${chat}\n</transcript>\n\nWrite the first assessment.`,
      }],
    });

    await setState(env, kind, id, {
      analysis, status: 'idle', error: null, updatedAt: new Date(),
      pendingAt: null, startedAt: null, progressAt: null,
    });
    await deleteDoc(env, queuePath(kind, id));
  } catch (err) {
    console.error('advisor analysis:', err.stack || err);
    await setState(env, kind, id, { status: 'error', error: friendly(err) })
      .catch(() => {});
  }
}

/** Eric asked the advisor something directly. */
export async function runQuestion(env, kind, id, qaId, question) {
  // Nested under the state DOC, not beside it: Firestore paths alternate
  // collection/document, so `…/advisor/qa/{qaId}` is not a valid document path
  // (it broke in production with an instant 400). `…/advisor/state/qa/{qaId}`
  // is valid and stays inside the advisor rules fence.
  const path = `${kind === 'case' ? 'cases' : 'subscriptions'}/${id}/advisor/state/qa/${qaId}`;
  try {
    const [rows, state] = await Promise.all([
      recentMessages(env, kind, id),
      getDoc(env, statePath(kind, id)),
    ]);
    const chat = transcript(rows);
    const answer = await ask(env, {
      effort: ANALYSIS_EFFORT,
      system: [{ type: 'text', text: `${VOICE}

Eric is asking you a direct question about this client. Answer it and stop —
under 120 words unless the question itself demands more. Don't re-summarise
the case at him; he has the transcript in front of him.` }],
      messages: [{
        role: 'user',
        content: `<transcript>\n${chat || '(no messages yet)'}\n</transcript>\n${
          state?.data.analysis ? `\n<your_current_assessment>\n${state.data.analysis}\n</your_current_assessment>\n` : ''
        }\nEric asks: ${question}`,
      }],
    });
    await patchDoc(env, path, { answer, status: 'done' }, { mask: ['answer', 'status'] });
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
export async function runDraft(env, kind, id, instruction) {
  try {
    await setState(env, kind, id, { draftStatus: 'running', draftError: null });
    const [rows, state] = await Promise.all([
      recentMessages(env, kind, id),
      getDoc(env, statePath(kind, id)),
    ]);
    const chat = transcript(rows);
    const voice = myVoice(rows);
    const draft = await ask(env, {
      effort: DRAFT_EFFORT,
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

Output the message text and nothing else — no preamble, no "here's a draft",
no quotation marks around it, no sign-off he doesn't actually use.

Length: this chat rejects messages over 2000 characters, and a wall of text
reads as canned anyway. Stay under 900 characters unless Eric's instruction
genuinely requires more; never exceed 1900.

He is not a doctor. Never put a diagnosis in his mouth. He can say what he'd
want asked, what a result might mean, and what he'll chase down.` }],
      messages: [{
        role: 'user',
        content: `Here is how Eric writes, in his own messages to this client:\n\n<his_voice>\n${voice || '(none yet — keep it plain, warm and brief)'}\n</his_voice>\n\nThe conversation so far:\n\n<transcript>\n${chat || '(no messages yet)'}\n</transcript>\n${
          state?.data.analysis ? `\nYour current assessment of the case:\n\n<assessment>\n${state.data.analysis}\n</assessment>\n` : ''
        }${instruction ? `\nEric wants this message to: ${instruction}` : '\nWrite the natural next thing for him to say.'}`,
      }],
    });
    await setState(env, kind, id, {
      draft, draftStatus: 'ready', draftError: null, draftAt: new Date(),
    });
  } catch (err) {
    console.error('advisor draft:', err.stack || err);
    await setState(env, kind, id, {
      draftStatus: 'error', draftError: friendly(err),
    }).catch(() => {});
  }
}
