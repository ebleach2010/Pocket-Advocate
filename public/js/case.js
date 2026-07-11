// Phase 1 case view: status, appointment details, election (with the
// "make my session private" revocation button, live until call time).
// The full dashboard — uploads, timeline, recording, report, chat — is Phase 2/3.

import { db, collection, getDocs, query, where } from './firebase.js';
import { requireUser, hydrateNav } from './auth.js';

const MOUNTAIN_TZ = 'America/Denver';
const STATUS_LABELS = {
  paid: 'Paid — finish your forms',
  forms: 'Paid — finish your forms',
  confirmed: 'Confirmed',
  awaiting_report: 'Call done — report on the way',
  delivered: 'Report delivered',
  closed: 'Closed',
};

hydrateNav();
const user = await requireUser();
if (user) loadCases();

async function loadCases() {
  const container = document.getElementById('cases');
  let docs = [];
  try {
    const snapshot = await getDocs(
      query(collection(db, 'cases'), where('clientUid', '==', user.uid))
    );
    snapshot.forEach((d) => docs.push({ id: d.id, ...d.data() }));
  } catch (err) {
    container.innerHTML = `<p class="error">Couldn't load your cases: ${err.message}</p>`;
    return;
  }

  if (!docs.length) {
    container.innerHTML =
      '<p class="muted">No cases yet.</p><p><a class="btn" href="/book.html">Book an Advocacy Case</a></p>';
    return;
  }

  docs.sort((a, b) => toDate(b.createdAt) - toDate(a.createdAt));
  container.innerHTML = docs.map(renderCase).join('');
  container.querySelectorAll('[data-make-private]').forEach((btn) =>
    btn.addEventListener('click', () => makePrivate(btn.dataset.makePrivate, btn))
  );
}

function renderCase(c) {
  const start = c.appointment && toDate(c.appointment.start);
  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  const localFmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  const method = c.appointment && c.appointment.method;
  const methodLine =
    method === 'phone'
      ? `Phone call — Eric will call you at ${c.appointment.phone || 'your number'}`
      : method === 'zoom'
        ? c.appointment.joinLink
          ? `Zoom call — <a href="${c.appointment.joinLink}">join link</a>`
          : 'Zoom call — the join link will appear here before the call'
        : c.appointment && c.appointment.joinLink
          ? `Discord voice channel — <a href="${c.appointment.joinLink}">join link</a>`
          : 'Discord voice channel — the join link will appear here before the call';

  const election = c.publicElection || { choice: 'private' };
  const revocable =
    election.choice === 'public' &&
    (!election.revocableUntil || toDate(election.revocableUntil) > new Date());

  return `
  <div class="card">
    <div class="row">
      <h3>Advocacy Case</h3>
      <span class="muted small">${STATUS_LABELS[c.status] || c.status}</span>
    </div>
    ${start ? `<p><strong>${mtFmt.format(start)}</strong><br><span class="muted small">${localFmt.format(start)} your time</span></p>` : ''}
    <p class="muted small">${methodLine}</p>
    <p class="muted small">Session: <strong>${election.choice === 'public' ? 'Public — will be broadcast live on YouTube' : 'Private'}</strong></p>
    ${revocable ? `<p><button class="btn secondary" data-make-private="${c.id}">Make my session private</button></p>` : ''}
    ${c.addOnFollowUp ? '<p class="muted small">Includes the follow-up add-on — you can book your second discussion once your report lands.</p>' : ''}
    <p class="muted small">Uploads for labs and imaging open here in the next release. For now, bring your materials to the call.</p>
  </div>`;
}

async function makePrivate(caseId, btn) {
  btn.disabled = true;
  try {
    const idToken = await user.getIdToken();
    const res = await fetch('/api/make-private', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ caseId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not update.');
    loadCases();
  } catch (err) {
    btn.disabled = false;
    alert(err.message);
  }
}

function toDate(v) {
  if (!v) return new Date(0);
  if (v.toDate) return v.toDate();
  return new Date(v);
}
