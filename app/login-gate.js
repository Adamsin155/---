// The sign-in screen is dark and the app is light, and which of the two a page opens
// into is known only once the session was read. This runs before the page is drawn (a
// plain script in <head>, like frame-guard.js; the policy allows no code in the page
// itself) and says what the first paint should be (app/styles/login.css, docs/ops.md 51):
//  - nobody is signed in on this device: the night background of the sign-in screen,
//    so the light page is never seen behind it (<html data-door="in">);
//  - someone just signed in on the page before this one (app/login-ui.js left a note
//    for this tab): the same background for one more moment, until this page is ready,
//    so the dark screen opens onto a whole page (<html data-door="through">);
//  - anyone else (a person who is signed in): nothing. They never see the sign-in
//    screen or its background.
// It only reads whether a session is kept here; who the person is and what they may
// see is decided by the server, as always (app/supa.js).
(function () {
  var root = document.documentElement;
  var NOTE = 'astrateg.door';
  var through = false;
  var session = false;
  try {
    through = window.sessionStorage.getItem(NOTE) === '1';
    if (through) window.sessionStorage.removeItem(NOTE);
  } catch (e) { /* no storage */ }
  try {
    for (var i = 0; i < window.localStorage.length; i += 1) {
      if (/^sb-.+-auth-token$/.test(window.localStorage.key(i) || '')) session = true;
    }
  } catch (e) { /* no storage: no session is kept either */ }
  if (!session) root.setAttribute('data-door', 'in');
  else if (through) root.setAttribute('data-door', 'through');
}());
