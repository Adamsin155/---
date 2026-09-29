// First sign-in and password reset from a personal link (made on the team screen,
// team.html, and sent by WhatsApp; or Supabase's own reset email). The login card
// shows "choose a password" instead of the login form; once it is saved, the page
// continues into the app. The session then stays on the device (supa.js).
import { supabase, readAuthLink, verifyLink, isOffline, explainError, LINK_TYPES } from './supa.js';
import { h } from './quote-doc.js';

export const MIN_PASSWORD = 8;
export const LINK_EXPIRED = 'הקישור כבר לא תקף: הוא שומש, או שעברה יותר משעה. בקשו מעירית או מליאור קישור חדש.';
export const PASSWORD_SAVED = 'הסיסמה נשמרה. מעכשיו נכנסים עם כתובת המייל והסיסמה הזו.';

const $ = (id) => document.getElementById(id);

// Reads the link from the address bar (and clears it). Returns null when there is
// none, 'expired' when it cannot be used, 'signed-in' for a link that needs no
// password, and 'password' once a password was chosen.
export async function landFromLink() {
  const link = readAuthLink();
  if (!link) return null;
  if (link.expired) return 'expired';
  if (!LINK_TYPES.includes(link.type)) return (await verifyLink(link)) ? 'expired' : 'signed-in';
  // Supabase's redirect has already spent the token: sign in now, then ask.
  // A personal link is spent only when the password is submitted.
  if (link.accessToken && (await verifyLink(link))) return 'expired';
  return choosePassword(link, !!link.accessToken);
}

function passwordError(error) {
  const msg = String(error?.message || '');
  if (error?.code === 'same_password' || /same|different from the old/i.test(msg)) return 'זו הסיסמה הנוכחית. בחרו סיסמה אחרת.';
  if (/at least|characters|weak|short/i.test(msg)) return 'הסיסמה קצרה או פשוטה מדי. בחרו סיסמה ארוכה יותר.';
  return explainError(error);
}

function choosePassword(link, signedIn) {
  const invite = link.type === 'invite';
  const form = h('form', { class: 'login', id: 'sp-form', novalidate: true },
    h('h2', { id: 'sp-h' }, invite ? 'ברוכים הבאים! בחירת סיסמה' : 'בחירת סיסמה חדשה'),
    h('p', {}, invite
      ? 'זו הכניסה הראשונה שלך למערכת של אסטרטג. בוחרים סיסמה, ומעכשיו נכנסים עם כתובת המייל והסיסמה.'
      : 'בוחרים סיסמה חדשה, ומעכשיו נכנסים איתה.'),
    h('div', { class: 'field' },
      h('label', { for: 'sp-new' }, 'סיסמה חדשה'),
      h('input', { class: 'input', id: 'sp-new', type: 'password', dir: 'ltr', autocomplete: 'new-password', minlength: MIN_PASSWORD, required: true, 'aria-describedby': 'sp-hint' }),
      h('div', { class: 'hint', id: 'sp-hint' }, `לפחות ${MIN_PASSWORD} תווים.`)),
    h('div', { class: 'field' },
      h('label', { for: 'sp-again' }, 'הסיסמה שוב'),
      h('input', { class: 'input', id: 'sp-again', type: 'password', dir: 'ltr', autocomplete: 'new-password', required: true })),
    h('div', { class: 'err', id: 'sp-err', role: 'alert', hidden: true }),
    h('button', { type: 'submit', class: 'btn btn-primary', id: 'sp-submit' }, 'שמירה וכניסה'));

  // The panel sits in the login card, in place of the login form.
  const block = $('login-block');
  const login = $('login-form');
  login.hidden = true;
  block.prepend(form);
  block.setAttribute('aria-labelledby', 'sp-h');
  block.hidden = false;
  $('app').hidden = true;
  $('sp-new').focus();

  return new Promise((resolve) => {
    const done = (result) => {
      form.remove();
      login.hidden = false;
      block.setAttribute('aria-labelledby', 'lg-h');
      resolve(result);
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = $('sp-new').value;
      const fail = (msg, field = null) => {
        $('sp-err').textContent = msg;
        $('sp-err').hidden = false;
        for (const id of ['sp-new', 'sp-again']) $(id).removeAttribute('aria-invalid');
        if (field) { $(field).setAttribute('aria-invalid', 'true'); $(field).focus(); }
      };
      if (pw.length < MIN_PASSWORD) return fail(`הסיסמה צריכה להכיל לפחות ${MIN_PASSWORD} תווים.`, 'sp-new');
      if (pw !== $('sp-again').value) return fail('הסיסמאות אינן זהות. הקלידו את אותה סיסמה בשני השדות.', 'sp-again');
      $('sp-err').hidden = true;
      $('sp-submit').disabled = true;
      if (!signedIn) {
        const error = await verifyLink(link);
        if (error && isOffline(error)) { $('sp-submit').disabled = false; return fail(explainError(error)); }
        if (error) return done('expired');
        signedIn = true;
      }
      const { error } = await supabase.auth.updateUser({ password: pw });
      $('sp-submit').disabled = false;
      if (error) return fail(passwordError(error), 'sp-new');
      return done('password');
    });
  });
}
