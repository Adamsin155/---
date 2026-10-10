// The sign-in screen of Astrateg Payment is the night of the staff sign-in screen
// (app/styles/login.css, docs/ops.md sections 51 and 56), and the app itself is light.
// This runs before the page is drawn (a plain script in <head>, like app/frame-guard.js;
// the policy allows no code in the page itself) and says what the first paint is:
//  - nobody is signed in to this app on this device: the night, so the light page is
//    never seen behind the sign-in card (<html data-door="in">);
//  - an owner who is signed in: nothing. They never see the night.
// It is this app's own gate because this app keeps its own session, under its own key
// (app/payouts/client.js); app/login-gate.js reads the staff session. It only reads
// whether a session is kept here: who may see the data is decided by the server
// (row level security, public.payout_owners).
(function () {
  var session = false;
  try { session = !!window.localStorage.getItem('astrateg-payment-auth'); } catch (e) { /* no storage: no session is kept either */ }
  if (!session) document.documentElement.setAttribute('data-door', 'in');
}());
