// WHAT A QUESTION READS (Eric, 2026-10-17: "When asking the advisor a
// question, there should be a toggle of some sort that has the advisor read
// your question against the case as of today, the past week, or all time. As
// well as 'search the chat' 'search uploads'. In as compact as possible ...
// It should also store general memory that it's already scraped and only
// search things it's uncertain about. There is absolutely no reason for it to
// read the entirety of the case every time unless prompted.").
//
// A question reads its memory (the assessment it keeps and this discussion)
// and the messages since its last read, and nothing more, unless he widens it:
//   time     memory | today | week | all
//   chat     the messages inside that time
//   uploads  the case's files inside that time, read again
// A time with no source searches the chat; a source with no time searches all
// of it. Pure: the Worker and the suites run it.

const DAY = 86_400_000;
export const SCOPE_TIMES = ['memory', 'today', 'week', 'all'];
/** With nothing in memory yet, this many of the newest messages stand in for it. */
export const FIRST_LOOK = 30;

export function cleanScope(raw) {
  let time = SCOPE_TIMES.includes(raw?.time) ? raw.time : 'memory';
  let chat = raw?.chat === true;
  const uploads = raw?.uploads === true;
  if (time !== 'memory' && !chat && !uploads) chat = true;
  if (time === 'memory' && (chat || uploads)) time = 'all';
  if (time === 'memory') chat = false;
  return { time, chat, uploads };
}

/** Where the window opens: his midnight (UTC minus seven) for today, seven days back for the week, the start for all. */
export function sinceMs(time, now = Date.now()) {
  if (time === 'today') {
    const shifted = new Date(now - 7 * 3600_000);
    return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) + 7 * 3600_000;
  }
  if (time === 'week') return now - 7 * DAY;
  if (time === 'all') return 0;
  return null;
}

const msOf = (v) => {
  if (!v) return NaN;
  if (typeof v?.toDate === 'function') return v.toDate().getTime();
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  return new Date(v).getTime();
};

/**
 * The messages a question reads. From memory: only those after the last read
 * (what memory does not hold yet), or the newest few when nothing has been
 * read. Searching the chat: every message inside the window.
 */
export function windowRows(rows, scope, analyzedThrough, now = Date.now()) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope.chat) {
    const from = sinceMs(scope.time, now) ?? 0;
    return list.filter((r) => { const t = msOf(r.data?.ts); return !Number.isFinite(t) || t >= from; });
  }
  const read = msOf(analyzedThrough);
  if (!Number.isFinite(read)) return list.slice(-FIRST_LOOK);
  return list.filter((r) => msOf(r.data?.ts) > read);
}

/** The case's files a question reads again, newest first, inside the window. */
export function windowFiles(files, scope, now = Date.now()) {
  if (!scope.uploads) return [];
  const from = sinceMs(scope.time, now) ?? 0;
  return (Array.isArray(files) ? files : [])
    .filter((f) => { const t = msOf(f.at); return !Number.isFinite(t) || t >= from; })
    .sort((a, b) => (msOf(b.at) || 0) - (msOf(a.at) || 0));
}

/** His words for what a question searched, for the row under it and the model. */
export function scopeWords(scope) {
  if (scope.time === 'memory') return 'from memory';
  const when = scope.time === 'today' ? 'today' : scope.time === 'week' ? 'the past week' : 'all time';
  const what = [scope.chat ? 'chat' : '', scope.uploads ? 'uploads' : ''].filter(Boolean).join(' and ');
  return `${what}, ${when}`;
}
