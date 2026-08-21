// The version line at the very bottom of the page, with its notes window.
//
// Eric, 2026-08-21: "Each push is a version update even if it's not loudly
// announced. So at the very bottom of the screen put Update [version #].
// Next to it is version notes button (equally small text)." The window shows
// the NEWEST version's client-side notes only - what changed for the person
// reading, bug fixes included, never anything from Eric's side - and each
// push replaces them (the rule lives at the top of changelog.js). Admin
// pages mount this too, showing the same client-facing notes.
//
// Self-mounting: pages include it with one script tag and nothing else.
import { CHANGELOG, VERSION } from './changelog.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function openNotes() {
  if (document.getElementById('pa-vnotes')) return;
  const current = CHANGELOG[0] || { version: VERSION, client: [] };
  const overlay = document.createElement('div');
  overlay.id = 'pa-vnotes';
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-card" role="dialog" aria-modal="true" aria-label="Version notes">
      <h3 style="margin:0 0 .2rem;">Pocket Advocate v${esc(current.version)}</h3>
      <p class="dim small" style="margin:0 0 .6rem;">What changed in this version.</p>
      <ul class="whats-new-list">${(current.client || [])
        .map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      <div class="actions"><button class="btn" data-x>Got it</button></div>
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-x]').addEventListener('click', close);
  document.body.appendChild(overlay);
  overlay.querySelector('[data-x]').focus();
}

function mount() {
  const host = document.querySelector('main') || document.body;
  const line = document.createElement('p');
  line.id = 'pa-verline';
  // Small on purpose, both halves equally: furniture, not a feature.
  line.style.cssText = 'margin:1.4rem 0 .4rem; text-align:center; font-size:.68rem; opacity:.65;';
  line.innerHTML = `
    <span class="dim">Update v${esc(VERSION)}</span>
    <button type="button" data-vnotes class="dim"
      style="font:inherit; background:none; border:none; cursor:pointer; text-decoration:underline; padding:0 0 0 .5rem; color:inherit;"
      >Version notes</button>`;
  line.querySelector('[data-vnotes]').addEventListener('click', openNotes);
  // On the client case page the line sits ABOVE the tip jar (Eric,
  // 2026-08-21), not under it at the very end. The page footer div exists in
  // the case page's skeleton; everywhere else the line takes the bottom of
  // main. case.js re-asserts this placement when it paints the footer, which
  // covers whichever module happens to run first.
  const jarHost = document.querySelector('[data-page-footer]');
  if (jarHost) jarHost.before(line);
  else host.appendChild(line);
}

mount();
