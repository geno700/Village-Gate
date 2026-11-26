// Boot, router, header, bottom navigation, service worker.
import { db, isDemo } from './data.js';
import { state, isAdmin, verifiedBusinesses, go, query } from './state.js';
import { t, setLang, getLang, initLang } from './i18n.js';
import { h, $, clear, toast, errToast, spinner, modal } from './ui.js';
import * as auth from './views-auth.js';
import { pendingJoin } from './views-auth.js';
import * as home from './views-home.js';
import * as maps from './views-map.js';
import * as reqs from './views-requests.js';
import * as biz from './views-business.js';
import * as admin from './views-admin.js';
import * as owner from './views-owner.js';
import * as settings from './views-settings.js';
import * as setupView from './views-setup.js';

const GROUP_KEY = 'vg-group';

/* ---------- routes ---------- */
// need: 'none' (signed out ok) | 'user' (signed in) | 'member' (approved in selected village) | 'platform'
const ROUTES = [
  ['welcome', auth.welcome, 'none'],
  ['login', auth.login, 'none'],
  ['signup', auth.signup, 'none'],
  ['reset', auth.reset, 'none'],
  ['new-password', auth.newPassword, 'user'],
  ['join/:code', auth.join, 'none'],
  ['start', auth.start, 'user'],
  ['setup', setupView.setup, 'user'],
  ['pending', auth.pending, 'user'],
  ['settings', settings.render, 'user'],
  ['', home.render, 'member', 'home'],
  ['map', maps.mapView, 'member', 'map'],
  ['directory', maps.directory, 'member', 'directory'],
  ['business/:id', maps.businessDetail, 'member', 'directory'],
  ['request/new', reqs.newRequest, 'member', 'requests'],
  ['requests', reqs.myRequests, 'member', 'requests'],
  ['my-business', biz.myBusiness, 'member', 'more'],
  ['demand', biz.demand, 'member', 'demand'],
  ['admin', admin.render, 'member', 'more'],
  ['admin/:tab', admin.render, 'member', 'more'],
  ['owner', owner.render, 'platform', 'more'],
];
function match(hash) {
  const path = hash.replace(/^#\/?/, '').split('?')[0].replace(/\/$/, '');
  const parts = path ? path.split('/') : [];
  for (const [pattern, view, need, tab] of ROUTES) {
    const pp = pattern ? pattern.split('/') : [];
    if (pp.length !== parts.length) continue;
    const params = {};
    if (pp.every((p, i) => p.startsWith(':') ? (params[p.slice(1)] = decodeURIComponent(parts[i]), true) : p === parts[i]))
      return { view, need, tab: tab || 'more', params, path };
  }
  return null;
}

/* ---------- context ---------- */
export async function refresh() {
  state.user = await db.getUser();
  if (!state.user) {
    Object.assign(state, { profile: null, groups: [], group: null, membership: null, categories: [], myBusinesses: [], platformAdmin: false });
    return;
  }
  const [profile, groups, plat] = await Promise.all([db.getProfile(), db.myGroups(), db.isPlatformAdmin().catch(() => false)]);
  state.profile = profile; state.groups = groups; state.platformAdmin = !!plat;
  if (profile?.lang && profile.lang !== getLang() && !localStorage.getItem('vg-lang')) setLang(profile.lang);
  const saved = localStorage.getItem(GROUP_KEY);
  const g = groups.find(x => x.id === saved) || groups.find(x => x.membership.status === 'approved') || groups[0] || null;
  state.group = g; state.membership = g?.membership || null;
  if (g) localStorage.setItem(GROUP_KEY, g.id);
  if (g && state.membership.status === 'approved') {
    const [cats, bizs] = await Promise.all([db.listCategories(g.id), db.listBusinesses(g.id)]);
    state.categories = cats;
    state.myBusinesses = bizs.filter(b => b.owner_user_id === state.user.id);
  } else { state.categories = []; state.myBusinesses = []; }
}
export async function switchGroup(id) {
  localStorage.setItem(GROUP_KEY, id);
  await refresh();
  renderChrome();
  go('#/');
}

/* ---------- chrome: header + nav ---------- */
function renderChrome(tab) {
  const header = $('#app-header'), nav = $('#app-nav');
  clear(header); clear(nav);
  const approved = state.membership?.status === 'approved';
  header.append(
    h('a', { href: '#/', class: 'brand', 'aria-label': t('app.name') }, h('img', { src: './icons/icon-192.png', alt: '', width: 30, height: 30 }),
      h('span', { class: 'brand-name' }, state.group && approved ? '' : t('app.name'))),
    state.user && state.groups.length ? groupSwitcher() : h('span', { class: 'grow' }),
    isDemo ? h('button', { class: 'demo-badge', type: 'button', title: t('demo.switchUser'), onclick: demoSwitcher }, t('demo.badge')) : '',
  );
  document.body.classList.toggle('has-nav', !!(state.user && approved));
  if (!state.user || !approved) return;
  const items = [
    ['home', '#/', '🏠', t('nav.home')],
    ['map', '#/map', '🗺️', t('nav.map')],
    ['requests', '#/requests', '🧾', t('nav.requests')],
    verifiedBusinesses().length ? ['demand', '#/demand', '🔥', t('nav.demand')] : ['directory', '#/directory', '📒', t('nav.directory')],
    ['more', '#/settings', '☰', t('nav.more')],
  ];
  for (const [key, href, icon, label] of items) {
    nav.append(h('a', { href, class: 'nav-item' + (key === tab ? ' active' : ''), 'aria-current': key === tab ? 'page' : null },
      h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, icon), h('span', { class: 'nav-label' }, label),
      key === 'more' && isAdmin() && pendingBadge() ? h('span', { class: 'dot', 'aria-label': t('admin.pendingBadge') }) : null));
  }
}
let pendingCount = 0;
const pendingBadge = () => pendingCount > 0;
export function setPendingCount(n) { pendingCount = n; $('.nav-item[href="#/settings"] .dot')?.remove(); if (n) $('.nav-item[href="#/settings"]')?.append(h('span', { class: 'dot' })); }

function groupSwitcher() {
  const sel = h('select', { class: 'group-switch', 'aria-label': t('settings.village'), onchange: e => {
    if (e.target.value === '__new') { go('#/start'); e.target.value = state.group?.id || ''; return; }
    switchGroup(e.target.value);
  } },
  state.groups.map(g => h('option', { value: g.id, selected: g.id === state.group?.id }, g.name + (g.membership.status === 'pending' ? ' ⏳' : ''))),
  h('option', { value: '__new' }, '＋ ' + t('start.addVillage')));
  return sel;
}

async function demoSwitcher() {
  const users = db.demoUsers();
  const list = h('div', { class: 'list' }, users.map(u => h('button', { type: 'button', class: 'list-item col' + (u.id === state.user?.id ? ' selected' : ''), onclick: async () => {
    m.close(); await db.demoSwitch(u.id); localStorage.removeItem(GROUP_KEY); await refresh(); route(true);
    toast(t('demo.nowActingAs', { name: u.full_name }));
  } }, h('strong', null, t('demo.as.' + u.label)), h('small', null, `${u.full_name} · ${u.email}`))));
  const m = modal(t('demo.switchUser'), h('div', null, h('p', { class: 'muted' }, t('demo.switchHelp')), list));
}

/* ---------- router ---------- */
let cleanup = null, routing = 0;
export async function route(forceChrome) {
  const my = ++routing;
  const main = $('#main');
  let r = match(location.hash || '#/');
  if (!r) { go('#/'); return; }
  const signedIn = !!state.user;
  const approved = state.membership?.status === 'approved';
  // guards
  if (!signedIn && r.need !== 'none') return go('#/welcome');
  if (signedIn && ['welcome', 'login', 'signup'].includes(r.path)) return go(pendingJoin() ? '#/join/' + pendingJoin() : '#/');
  if (r.need === 'member' && !approved) return go(state.groups.length ? '#/pending' : '#/start');
  if (r.need === 'platform' && !state.platformAdmin) return go('#/');
  if (r.path === 'pending' && approved) return go('#/');

  if (cleanup) { try { cleanup(); } catch (e) { console.warn(e); } cleanup = null; }
  renderChrome(r.tab);
  clear(main).append(spinner());
  main.className = 'main view-' + (r.path.split('/')[0] || 'home');
  try {
    const out = await r.view(main, r.params, { refresh, switchGroup, query: query() });
    if (my !== routing) { if (typeof out === 'function') out(); return; }
    if (typeof out === 'function') cleanup = out;
  } catch (e) {
    if (my !== routing) return;
    clear(main).append(h('div', { class: 'empty' }, h('h3', null, t('err.loadFailed')), h('p', { class: 'muted' }, e.message || String(e)),
      h('button', { class: 'btn', onclick: () => route() }, t('common.retry'))));
    console.error(e);
  }
  main.focus({ preventScroll: true });
  if (!forceChrome) window.scrollTo(0, 0);
}

/* ---------- service worker ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  // During local development the cache would hide your edits; add ?sw to the URL to test it locally.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (local && !new URLSearchParams(location.search).has('sw')) return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    const prompt = () => {
      if ($('#update-bar')) return;
      document.body.append(h('div', { id: 'update-bar', role: 'alert' }, t('pwa.newVersion'),
        h('button', { class: 'btn small primary', onclick: () => { reg.waiting?.postMessage('skipWaiting'); } }, t('pwa.reload'))));
    };
    if (reg.waiting && navigator.serviceWorker.controller) prompt();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(); });
    });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  }).catch(e => console.warn('SW failed', e));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
}

/* ---------- boot ---------- */
async function boot() {
  initLang();
  if (isDemo) document.body.classList.add('is-demo');
  try { await refresh(); } catch (e) { errToast(e); }
  db.onAuthChange(async () => { await refresh(); route(true); });
  window.addEventListener('hashchange', () => route());
  window.addEventListener('vg-lang', () => route(true));
  window.addEventListener('vg-chrome', () => renderChrome(match(location.hash || '#/')?.tab));
  await route();
  registerSW();
}
boot();
