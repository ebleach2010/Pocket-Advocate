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
 * Pull the "## Key terms" section out of an assessment: store each new term in
 * the knowledge base and strip the section from the saved text, because the
 * panel renders the glossary as its own page with an "I understand" checkbox
 * per term.
 */
async function harvestKeyTerms(env, analysis) {
  const m = analysis.match(/^## Key terms\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  if (!m) return analysis;
  for (const line of m[1].split('\n')) {
    const t = line.match(/^\s*[-*]\s*\**([^:*]+?)\**\s*:\s*(.+)$/);
    if (!t) continue;
    const term = t[1].trim();
    const definition = t[2].trim();
    if (!term || !definition || /^none$/i.test(term)) continue;
    // Create-only: an existing entry (learned or not) is never overwritten.
    await patchDoc(env, `advisorKnowledge/${termSlug(term)}`, {
      term, definition, learnedAt: null, addedAt: new Date(),
    }, { mustNotExist: true }).catch(() => {});
  }
  return analysis.replace(m[0], '').trim();
}

/**
 * A tiny plain-words recap of Eric's latest unanswered messages, written for
 * clients with brain fog or fatigue: two short sentences at most, saying what
 * he said and what he's asking, so nobody has to re-read a wall to re-orient.
 * Runs once per message run, only when the run has sat unanswered 5+ minutes,
 * and lands on the last message of the run for both sides to see.
 */
export async function runRecap(env, kind, id, { force = false } = {}) {
  const parent = kind === 'case' ? 'cases' : 'subscriptions';
  const rows = await recentMessages(env, kind, id);

  // The trailing run of Eric's messages — ends the moment the client replies.
  const run = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].data.role === 'admin') run.unshift(rows[i]);
    else break;
  }
  // Forced runs (Eric, from the long-press menu) speak their failures; the
  // automatic path stays silent — a client's chat shouldn't alert about a
  // recap that simply wasn't needed.
  if (!run.length) {
    if (force) throw new Error('The client has replied since — nothing is waiting on a recap.');
    return { ok: false, reason: 'nothing to recap' };
  }
  const last = run[run.length - 1];
  const text = run.map((r) => r.data.text).filter(Boolean).join('\n\n');
  if (force) {
    if (!text) throw new Error('These messages have no text to recap.');
  } else {
    if (last.data.recap) return { ok: true, already: true };
    if (Date.now() - new Date(last.data.ts || 0).getTime() < 5 * 60_000)
      return { ok: false, reason: 'too soon' };
    // One short message doesn't need a recap of itself.
    if (!text || (text.length < 240 && run.length < 2))
      return { ok: false, reason: 'too short to need one' };
  }

  const recap = await ask(env, {
    effort: 'low',
    maxTokens: 8000,
    system: [{ type: 'text', text: `You write one tiny recap of what Eric, a
patient advocate, just said in his latest chat messages to his client. The
client may have brain fog, fatigue, or trouble concentrating.

Three short sentences at the very most, even when he wrote a lot — pick what
matters. Sixth-grade reading level, addressed to the client:
"Eric asked you...", "Eric wants...". If he asked something, say plainly what
he is asking. No medical jargon without plain words right next to it. Never use
an em dash or en dash. Output the recap text only, nothing else.` }],
    messages: [{ role: 'user', content: `Eric's messages, oldest first:\n\n${text}` }],
  });

  // Cap length at a sentence boundary — a recap clipped mid-sentence reads
  // as broken (learned live on the first forced run).
  let out = recap;
  if (out.length > 600) {
    const head = out.slice(0, 600);
    const cut = Math.max(head.lastIndexOf('.'), head.lastIndexOf('?'), head.lastIndexOf('!'));
    out = cut > 200 ? head.slice(0, cut + 1) : head;
  }
  await patchDoc(env, `${parent}/${id}/chat/${last.id}`, {
    recap: { text: out, at: new Date() },
  }, { mask: ['recap'] });
  return { ok: true };
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
    const [rows, state, knowledge] = await Promise.all([
      recentMessages(env, kind, id),
      getDoc(env, statePath(kind, id)),
      loadKnowledge(env),
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
## Key terms

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
"Key terms": Eric is learning the territory as he goes. Up to 5 medical terms
or diagnoses central to THIS assessment that he has not yet learned, each on
its own line as \`- Term: plain-words definition in one sentence, plus what it
means for his next step if that matters\`. Never include a term from his
mastered list, never repeat one already in his glossary. If nothing new, write
"- none".

Be specific or say nothing. "Consider further workup" is worthless. If the
transcript is too thin for a section, one line saying what you'd need.
${knowledgeNote(knowledge)}` }],
      messages: [{
        role: 'user',
        content: prior
          ? `Here is your previous assessment of this client:\n\n<previous>\n${prior}\n</previous>\n\nHere is the full conversation as it now stands:\n\n<transcript>\n${chat}\n</transcript>\n\nUpdate the assessment. Carry forward what still holds, revise what the new messages change, and say explicitly if something new contradicts an earlier read.`
          : `Here is the conversation so far:\n\n<transcript>\n${chat}\n</transcript>\n\nWrite the first assessment.`,
      }],
    });

    const cleaned = await harvestKeyTerms(env, analysis);
    await setState(env, kind, id, {
      analysis: cleaned, status: 'idle', error: null, updatedAt: new Date(),
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
    const [rows, state, knowledge] = await Promise.all([
      recentMessages(env, kind, id),
      getDoc(env, statePath(kind, id)),
      loadKnowledge(env),
    ]);
    const chat = transcript(rows);
    const answer = await ask(env, {
      effort: ANALYSIS_EFFORT,
      system: [{ type: 'text', text: `${VOICE}

Eric is asking you a direct question about this client. Answer it and stop —
under 120 words unless the question itself demands more. Don't re-summarise
the case at him; he has the transcript in front of him.
${knowledgeNote(knowledge)}` }],
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
    await setState(env, kind, id, {
      draftStatus: 'running', draftError: null, draftStartedAt: new Date(), draftProgressAt: null,
    });
    const [rows, state] = await Promise.all([
      recentMessages(env, kind, id),
      getDoc(env, statePath(kind, id)),
    ]);
    const chat = transcript(rows);
    const voice = myVoice(rows);
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
      draftStartedAt: null, draftProgressAt: null,
    });
  } catch (err) {
    console.error('advisor draft:', err.stack || err);
    await setState(env, kind, id, {
      draftStatus: 'error', draftError: friendly(err),
    }).catch(() => {});
  }
}
