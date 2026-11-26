// Welcome, sign-up / log-in / password reset, create or join a village, waiting for approval.
import { db, isDemo } from './data.js';
import { state, go } from './state.js';
import { t, setLang, getLang } from './i18n.js';
import { h, clear, field, toast, errToast, busy, normPhone, isPhone, normDigits, fmtDate } from './ui.js';
import { locationPicker } from './map.js';
import { mountScene } from './scene3d.js';
import { PLACES } from './shared.js';

const PLACE_ICON = Object.fromEntries(PLACES.map(p => [p[0], p[1]]));

export const JOIN_KEY = 'vg-join';
export const pendingJoin = () => sessionStorage.getItem(JOIN_KEY);

/** Sample landmarks for the welcome scene (relative to a Delta village centre). */
const WELCOME_CENTER = { lat: 30.887, lng: 31.048 }; // same centre as data/demo-village.json
const WELCOME_POINTS = (c = WELCOME_CENTER) => [
  ['🕌', 'المسجد الكبير', 'Main mosque', 0.0004, -0.0006, 'place', 'mosque'], ['⛪', 'الكنيسة', 'Church', 0.0022, 0.0035, 'place', 'church'],
  ['🏥', 'الوحدة الصحية', 'Health unit', -0.0012, -0.0024, 'place', 'health'], ['🏫', 'المدرسة', 'School', 0.0031, -0.0018, 'place', 'school'],
  ['🏛️', 'مجلس القرية', 'Village council', 0.0001, 0.0019, 'place', 'government'], ['⚽', 'مركز الشباب', 'Youth centre', 0.0042, 0.0012, 'place', 'youth'],
  ['🔥', 'غاز', 'Gas', -0.0018, 0.0006, 'biz'], ['🛒', 'بقالة', 'Groceries', 0.0012, 0.0002, 'biz'], ['🍞', 'مخبز', 'Bakery', -0.0004, -0.0016, 'biz'],
  ['🔧', 'سباكة', 'Plumber', 0.0019, -0.0031, 'biz'], ['📚', 'مكتبة', 'Bookshop', 0.0026, 0.0009, 'biz'], ['💊', 'صيدلية', 'Pharmacy', 0.0009, 0.0011, 'biz'],
  ['🛺', 'توك توك', 'Tuk-tuk', -0.0026, 0.0021, 'biz'], ['🚜', 'جرار زراعي', 'Tractor', -0.0034, -0.0012, 'biz'], ['🩺', 'طبيب', 'Doctor', 0.0006, 0.0028, 'biz'],
].map(([icon, ar, en, a, b, kind, model]) => ({ icon, label: getLang() === 'ar' ? ar : en, lat: c.lat + a, lng: c.lng + b, kind, model }));

function langToggle() {
  return h('button', { type: 'button', class: 'btn ghost small lang-toggle', onclick: () => setLang(getLang() === 'ar' ? 'en' : 'ar') },
    getLang() === 'ar' ? 'English' : 'العربية');
}
function authCard(main, title, ...body) {
  clear(main).append(h('section', { class: 'auth' },
    h('div', { class: 'auth-top' }, h('a', { href: '#/welcome', class: 'back' }, t('common.back')), langToggle()),
    h('img', { src: './icons/icon-192.png', alt: '', class: 'auth-logo', width: 64, height: 64 }),
    h('h1', null, title), ...body));
}

/* ---------------------------------------------------------------- welcome */
export async function welcome(main) {
  const stage = h('div', { class: 'scene-stage full' });
  clear(main).append(h('section', { class: 'welcome' }, stage,
    h('div', { class: 'welcome-shade' }),
    h('div', { class: 'welcome-content' },
      h('div', { class: 'welcome-lang' }, langToggle()),
      h('h1', { class: 'welcome-title' }, t('app.name')),
      h('p', { class: 'welcome-tag' }, t('welcome.tagline')),
      h('ul', { class: 'welcome-points' },
        h('li', null, '✅ ', t('welcome.p1')), h('li', null, '🔥 ', t('welcome.p2')), h('li', null, '🗺️ ', t('welcome.p3'))),
      h('div', { class: 'welcome-actions' },
        h('a', { href: '#/signup', class: 'btn primary big' }, t('auth.signup')),
        h('a', { href: '#/login', class: 'btn big glass' }, t('auth.login'))),
      isDemo ? h('p', { class: 'welcome-note' }, t('demo.welcomeNote'))
        : h('p', { class: 'welcome-note' }, h('a', { href: '?demo#/login' }, t('demo.try'))))));
  const get = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
  const map = await get('./data/maps/al-safa.json') || await get('./data/demo-village.json');
  const center = map ? { lat: map.lat, lng: map.lng } : WELCOME_CENTER;
  // real landmarks of the sample village when its map has them, otherwise sample ones
  // (only those inside the village; sample ones fill the types it does not have)
  const kx = 111320 * Math.cos(center.lat * Math.PI / 180);
  const real = (map?.p || []).filter(([, , lat, lng]) => Math.hypot((lng - map.lng) * kx, (lat - map.lat) * 110540) <= map.r * 1.15)
    .map(([key, name, lat, lng, ref]) => ({ id: ref, lat, lng, kind: 'place', model: key, icon: PLACE_ICON[key], label: name }));
  const realKeys = new Set(real.map(p => p.model));
  const sample = WELCOME_POINTS(center).filter(p => p.kind === 'biz' || !realKeys.has(p.model));
  return await mountScene(stage, { center, map, points: [...real, ...sample], mode: 'full', seed: 7 });
}

/* ---------------------------------------------------------------- login / signup / reset */
export function login(main) {
  const email = h('input', { type: 'email', autocomplete: 'email', required: true, dir: 'ltr' });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: isDemo ? null : true, dir: 'ltr' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, t('auth.login'));
  const form = h('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault(); busy(btn, true);
    try { await db.signIn({ email: email.value, password: pw.value }); }
    catch (err) { errToast(err); } finally { busy(btn, false); }
  } }, field(t('auth.email'), email), field(t('auth.password'), pw), btn,
  h('div', { class: 'row between' }, h('a', { href: '#/reset' }, t('auth.forgot')), h('a', { href: '#/signup' }, t('auth.noAccount'))));
  const demoBox = isDemo ? h('div', { class: 'card demo-box' }, h('p', null, t('demo.loginHelp')),
    h('div', { class: 'chips' }, db.demoUsers().map(u => h('button', { type: 'button', class: 'chip-btn', onclick: () => { email.value = u.email; pw.value = 'demo'; form.requestSubmit(); } }, t('demo.as.' + u.label))))) : null;
  authCard(main, t('auth.loginTitle'), form, demoBox);
}

export function signup(main) {
  const name = h('input', { autocomplete: 'name', required: true, minlength: 2, maxlength: 80 });
  const email = h('input', { type: 'email', autocomplete: 'email', required: true, dir: 'ltr' });
  const pw = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8, dir: 'ltr' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, t('auth.signup'));
  const form = h('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault(); busy(btn, true);
    try {
      const r = await db.signUp({ email: email.value, password: pw.value, full_name: name.value.trim() });
      if (r?.needsConfirm) {
        authCard(main, t('auth.checkEmailTitle'), h('p', null, t('auth.checkEmail', { email: email.value })),
          h('a', { href: '#/login', class: 'btn block' }, t('auth.login')));
      }
    } catch (err) { errToast(err); } finally { busy(btn, false); }
  } }, field(t('auth.fullName'), name), field(t('auth.email'), email), field(t('auth.password'), pw, t('auth.pwHint')), btn,
  h('p', { class: 'center' }, h('a', { href: '#/login' }, t('auth.haveAccount'))));
  authCard(main, t('auth.signupTitle'), pendingJoin() ? h('p', { class: 'note' }, t('join.signupFirst')) : null, form);
}

export function reset(main) {
  const email = h('input', { type: 'email', autocomplete: 'email', required: true, dir: 'ltr' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, t('auth.sendReset'));
  authCard(main, t('auth.resetTitle'), h('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault(); busy(btn, true);
    try { await db.sendReset(email.value); toast(t('auth.resetSent')); go('#/login'); }
    catch (err) { errToast(err); } finally { busy(btn, false); }
  } }, h('p', { class: 'muted' }, t('auth.resetHelp')), field(t('auth.email'), email), btn));
}

export function newPassword(main) {
  const pw = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8, dir: 'ltr' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, t('auth.savePassword'));
  authCard(main, t('auth.newPasswordTitle'), h('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault(); busy(btn, true);
    try { await db.updatePassword(pw.value); toast(t('auth.passwordSaved')); go('#/'); }
    catch (err) { errToast(err); } finally { busy(btn, false); }
  } }, field(t('auth.newPassword'), pw, t('auth.pwHint')), btn));
}

/* ---------------------------------------------------------------- create / join */
/** Name + phone + home pin + address note. Returns { el, read() } where read() validates. */
export async function personFields(container, { center, value = {}, homeRequired = false }) {
  const name = h('input', { required: true, minlength: 2, maxlength: 80, value: value.display_name ?? state.profile?.full_name ?? '' });
  const phone = h('input', { type: 'tel', inputmode: 'tel', required: true, dir: 'ltr', placeholder: '01xxxxxxxxx', value: value.phone ?? state.profile?.phone ?? '' });
  const note = h('input', { maxlength: 200, value: value.home_note || '', placeholder: t('join.homeNotePh') });
  const mapBox = h('div');
  container.append(field(t('join.displayName'), name, t('join.displayNameHint')), field(t('join.phone'), phone, t('join.phoneHint')),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('join.homePin') + (homeRequired ? '' : ` (${t('common.optional')})`)), mapBox,
      h('small', { class: 'hint' }, t('join.homePinHint'))),
    field(t('join.homeNote'), note));
  const picker = await locationPicker(mapBox, { value: value.home_lat != null ? { lat: value.home_lat, lng: value.home_lng } : null, center });
  return {
    read() {
      const p = normPhone(phone.value);
      if (name.value.trim().length < 2) { name.focus(); throw new Error('invalid_name'); }
      if (!isPhone(p)) { phone.focus(); throw new Error('invalid_phone'); }
      const home = picker.get();
      if (homeRequired && !home) throw new Error('home_required');
      return { display_name: name.value.trim(), phone: p, home_lat: home?.lat ?? null, home_lng: home?.lng ?? null, home_note: note.value.trim() };
    },
  };
}

export function start(main) {
  const code = h('input', { required: true, maxlength: 6, minlength: 6, dir: 'ltr', class: 'code-input', placeholder: 'ABC123', autocapitalize: 'characters',
    oninput: e => { e.target.value = normDigits(e.target.value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); } });
  const joinForm = h('form', { class: 'stack', onsubmit: e => { e.preventDefault(); if (code.value.length === 6) go('#/join/' + code.value); } },
    field(t('start.code'), code), h('button', { class: 'btn primary block', type: 'submit' }, t('start.join')));

  clear(main).append(h('section', { class: 'page' },
    h('h1', null, state.groups.length ? t('start.addVillage') : t('start.title')),
    h('p', { class: 'muted' }, t('start.intro')),
    h('div', { class: 'card' }, h('h2', null, '🔑 ', t('start.joinTitle')), h('p', { class: 'muted' }, t('start.joinHelp')), joinForm),
    h('div', { class: 'card' }, h('h2', null, '🏡 ', t('start.createTitle')), h('p', { class: 'muted' }, t('start.createHelp')),
      h('a', { href: '#/setup', class: 'btn block' }, '🗺️ ', t('start.setupBtn'))),
    h('p', { class: 'center' }, h('a', { href: '#/settings' }, t('nav.settings')))));
}

export async function join(main, { code }, ctx) {
  code = normDigits(code || '').toUpperCase();
  if (!state.user) {
    sessionStorage.setItem(JOIN_KEY, code);
    authCard(main, t('join.title'), h('p', null, t('join.needAccount')),
      h('div', { class: 'stack' }, h('a', { href: '#/signup', class: 'btn primary block' }, t('auth.signup')), h('a', { href: '#/login', class: 'btn block' }, t('auth.login'))));
    return;
  }
  sessionStorage.removeItem(JOIN_KEY);
  const g = await db.groupByCode(code);
  if (!g) {
    clear(main).append(h('section', { class: 'page' }, h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, '🔍'),
      h('h3', null, t('join.badCode')), h('p', null, t('join.badCodeHelp')), h('a', { href: '#/start', class: 'btn' }, t('common.back')))));
    return;
  }
  const existing = state.groups.find(x => x.id === g.id);
  if (existing) { localStorage.setItem('vg-group', g.id); await ctx.refresh(); go(existing.membership.status === 'approved' ? '#/' : '#/pending'); return; }
  const box = h('div', { class: 'stack' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, t('join.send'));
  const form = h('form', { class: 'stack' }, box, btn);
  clear(main).append(h('section', { class: 'page' }, h('h1', null, t('join.joining', { name: g.name })),
    h('p', { class: 'muted' }, t('join.help')), h('div', { class: 'card' }, form)));
  const person = await personFields(box, { center: g.center_lat ? { lat: g.center_lat, lng: g.center_lng } : null, homeRequired: true });
  form.onsubmit = async e => {
    e.preventDefault();
    try {
      const p = person.read(); busy(btn, true);
      const id = await db.joinGroup({ code, ...p });
      if (!state.profile?.phone) db.saveProfile({ phone: p.phone }).catch(() => {});
      localStorage.setItem('vg-group', id);
      await ctx.refresh(); toast(t('join.sent')); go('#/pending');
    } catch (err) { errToast(err); } finally { busy(btn, false); }
  };
}

export function pending(main, _p, ctx) {
  const g = state.group;
  if (!g) return go('#/start');
  clear(main).append(h('section', { class: 'page' }, h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, '⏳'), h('h3', null, t('pending.title', { name: g.name })),
    h('p', null, t('pending.text')),
    h('ol', { class: 'steps' }, h('li', null, t('pending.s1')), h('li', null, t('pending.s2')), h('li', null, t('pending.s3'))),
    h('p', { class: 'muted' }, t('pending.sent', { date: fmtDate(g.membership.created_at) })),
    h('div', { class: 'row center wrap' },
      h('button', { class: 'btn primary', onclick: async () => { await ctx.refresh(); if (state.membership?.status === 'approved') { toast(t('pending.approved')); go('#/'); } else toast(t('pending.still')); } }, t('pending.check')),
      h('a', { href: '#/start', class: 'btn' }, t('start.addVillage')),
      h('a', { href: '#/settings', class: 'btn ghost' }, t('nav.settings'))))));
}
