// The working side's tabs, for each kind of staff (2026-10-15).
//
// Eric, 2026-10-15: "Each advocate gets their own isolated workspace." The
// pages are the ones he uses; the tabs an advocate sees are the ones that
// hold their own work. Hiding a tab hides nothing that matters on its own:
// every route behind those pages answers an advocate with a 404, and the
// database rules give them their own cases only.
//
// His tabs gain Advocates. Both gain the account page: his public profile,
// since he is advocate number one, and an advocate's own setup and password.
// An advocate also gets their chat with him (admin-staffchat.js).

// What only he works on, by the tab's own link.
// Calendar joined them 2026-10-15: an advocate cannot open time slots yet, so
// theirs was an empty grid; their booked calls are on Clients under BOOKED.
const HIS_ALONE = ['/admin-leads.html', '/admin-availability.html', '/admin-dictionary.html', '/admin-fund.html', '/admin-calendar.html'];

function addTab(tabs, href, label) {
  if (!tabs || tabs.querySelector(`a[href="${href}"]`)) return;
  const a = document.createElement('a');
  a.href = href;
  a.textContent = label;
  a.dataset.staffTab = '';
  if (location.pathname === href) a.classList.add('active');
  const auth = tabs.querySelector('[data-nav-auth]');
  tabs.insertBefore(a, auth || null);
}

export function mountStaffNav(role) {
  const tabs = document.querySelector('header .tabs');
  if (!tabs) return;
  if (role === 'advocate') {
    for (const a of tabs.querySelectorAll('a[href]')) {
      if (HIS_ALONE.includes(a.getAttribute('href'))) a.remove();
    }
    // The ledger link is his money; it is mounted by another module, maybe
    // after this runs, so the rule goes on the page rather than the node.
    const style = document.createElement('style');
    style.textContent = '[data-ledger]{display:none !important}';
    document.head.appendChild(style);
    addTab(tabs, '/admin-account.html', 'My account');
    // Their line to him (2026-10-15): the chat icon at the bottom right, and
    // his messages in a white box at the top of the screen.
    import('./firebase.js').then(({ auth }) => import('./admin-staffchat.js').then((m) => {
      const go = () => (auth.currentUser ? m.mountStaffChat(auth.currentUser) : setTimeout(go, 500));
      go();
    })).catch(() => {});
  } else {
    addTab(tabs, '/admin-advocates.html', 'Advocates');
    addTab(tabs, '/admin-account.html', 'My profile');
  }
}
