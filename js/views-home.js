// Home: 3D village header, "I need…" tiles, my active requests, alerts for admins and businesses.
import { db } from './data.js';
import { state, isAdmin, canWrite, verifiedBusinesses, catById, center, go } from './state.js';
import { t, catName } from './i18n.js';
import { h, clear, fmtNum, timeAgo, statusChip, sep } from './ui.js';
import { mountScene } from './scene3d.js';
import { providerCounts, popularServices } from './views-requests.js';

export async function render(main) {
  const g = state.group, gid = g.id;
  const [places, businesses, mine, villageMap] = await Promise.all([db.listPlaces(gid), db.listBusinesses(gid), db.myRequests(gid),
    db.getVillageMap(gid).catch(() => null)]);
  const verified = businesses.filter(b => b.status === 'verified');

  const stage = h('div', { class: 'scene-stage hero' });
  // first name, keeping a title ("الحاج") and compound names ("عبد الرحمن", "أبو يوسف") whole
  const words = (state.membership.display_name || '').trim().split(/\s+/);
  let k = /^(الحاج|الحاجة|الأستاذ|الأستاذة|د\.?|دكتور|الشيخ|عم)$/.test(words[0]) && words.length > 1 ? 1 : 0;
  if (/^(عبد|أبو|ابو|أم|ام)$/.test(words[k]) && words[k + 1]) k++;
  const hello = words.slice(0, k + 1).join(' ');
  // big 3D village you can turn and zoom; tapping a landmark shows a small card first
  let scene = null;
  const ctlBtn = (icon, label, fn) => h('button', { type: 'button', class: 'scene-btn', 'aria-label': label, title: label, onclick: fn }, icon);
  const fullBtn = ctlBtn('⛶', t('home.fullMap'), () => setFull(!hero.classList.contains('full')));
  const pick = h('div', { class: 'scene-pick', hidden: true });
  const hero = h('section', { class: 'hero-wrap' }, stage, h('div', { class: 'hero-shade' }),
    h('div', { class: 'hero-text' }, h('p', { class: 'hero-hello' }, t('home.hello', { name: hello })),
      h('h1', null, g.name), h('p', { class: 'hero-sub' },
        t('home.counts', { places: fmtNum(places.length), businesses: fmtNum(verified.length) }))),
    h('div', { class: 'scene-ctrls' },
      ctlBtn('＋', t('home.zoomIn'), () => scene?.zoomBy?.(0.75)),
      ctlBtn('－', t('home.zoomOut'), () => scene?.zoomBy?.(1.33)),
      ctlBtn('⟳', t('home.turn'), () => scene?.turn?.(Math.PI / 4)),
      ctlBtn('🧭', t('home.resetView'), () => scene?.reset?.()),
      fullBtn),
    h('p', { class: 'scene-hint', 'aria-hidden': 'true' }, t('home.mapHint')),
    pick);
  const onKey = e => { if (e.key === 'Escape') setFull(false); };
  function setFull(on) {
    hero.classList.toggle('full', on); document.body.classList.toggle('scene-full', on);
    fullBtn.textContent = on ? '✕' : '⛶'; fullBtn.setAttribute('aria-label', t(on ? 'home.exitFull' : 'home.fullMap')); fullBtn.title = fullBtn.getAttribute('aria-label');
    scene?.setFull?.(on);
    if (on) document.addEventListener('keydown', onKey); else document.removeEventListener('keydown', onKey);
  }
  const showPick = p => {
    clear(pick);
    if (!p) { pick.hidden = true; return; }
    const href = p.kind === 'biz' ? `#/business/${p.id}` : `#/map?place=${p.id}`;
    pick.append(h('span', { class: 'li-icon' }, p.icon || '📍'),
      h('div', { class: 'li-main' }, h('strong', null, p.label), h('small', null, p.sub || '')),
      p.phone ? h('a', { class: 'btn small ghost', href: `tel:${p.phone}`, 'aria-label': t('common.call') }, '📞') : null,
      h('button', { type: 'button', class: 'btn small primary', onclick: () => { setFull(false); go(href); } }, t('home.openPlace')),
      h('button', { type: 'button', class: 'btn small ghost', 'aria-label': t('common.close'), onclick: () => showPick(null) }, '✕'));
    pick.hidden = false;
  };

  const blocks = [];

  // admin alerts
  if (isAdmin()) {
    const [members, suggested] = await Promise.all([db.listMembers(gid), db.listPlaceSuggestions(gid).catch(() => [])]);
    const pm = members.filter(m => m.status === 'pending').length;
    const pb = businesses.filter(b => b.status === 'pending').length;
    const pp = suggested.length;
    if (pm || pb || pp) blocks.push(h('a', { href: pm ? '#/admin/members' : pb ? '#/admin/businesses' : '#/admin/places', class: 'card alert' },
      h('span', { class: 'alert-icon' }, '🛡️'), h('div', null, h('strong', null, t('home.adminAlert')),
        h('p', null, [pm ? t('home.pendingMembers', { n: fmtNum(pm) }) : null, pb ? t('home.pendingBusinesses', { n: fmtNum(pb) }) : null,
          pp ? t('home.pendingPlaces', { n: fmtNum(pp) }) : null].filter(Boolean).join(sep())))));
  }
  // business demand teaser
  const vb = verifiedBusinesses();
  if (vb.length) {
    const rows = (await Promise.all(vb.map(b => db.openDemand(gid, b.id, 48).catch(() => [])))).flat();
    const n = new Set(rows.map(r => r.id)).size;
    blocks.push(h('a', { href: '#/demand', class: 'card alert demand' }, h('span', { class: 'alert-icon' }, '🔥'),
      h('div', null, h('strong', null, t('home.demandTitle')), h('p', null, n ? t('home.demandN', { n: fmtNum(n) }) : t('home.demandNone')))));
  } else if (state.myBusinesses.some(b => b.status === 'pending')) {
    blocks.push(h('a', { href: '#/my-business', class: 'card alert' }, h('span', { class: 'alert-icon' }, '⏳'), h('div', null, h('strong', null, t('biz.pendingTitle')), h('p', null, t('biz.pendingText')))));
  }

  // I need…
  const services = state.categories.filter(c => c.kind === 'service' && c.active);
  if (canWrite()) {
    const counts = providerCounts(businesses);
    blocks.push(h('section', null, h('h2', { class: 'section-title' }, t('home.need')),
      h('div', { class: 'tiles' }, popularServices(services, counts, 7).map(c => h('a', { href: `#/request/new?cat=${c.id}`, class: 'tile' },
        h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, c.icon), h('span', { class: 'tile-label' }, catName(c)))),
        h('a', { href: '#/request/new', class: 'tile more' }, h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, '🔎'), h('span', { class: 'tile-label' }, t('home.more'))))));
  } else {
    blocks.push(h('p', { class: 'card note' }, t('home.viewerNote')));
  }

  // my active requests
  const active = mine.filter(r => ['open', 'accepted'].includes(r.status)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (active.length) {
    blocks.push(h('section', null, h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, t('home.myActive')), h('a', { href: '#/requests' }, t('common.seeAll'))),
      h('div', { class: 'list' }, active.slice(0, 3).map(r => {
        const c = catById(r.category_id);
        return h('a', { href: '#/requests', class: 'list-item' }, h('span', { class: 'li-icon' }, c?.icon || '•'),
          h('div', { class: 'li-main' }, h('strong', null, catName(c)), h('small', null, [r.details, timeAgo(r.created_at)].filter(Boolean).join(sep()))), statusChip(r.status));
      }))));
  }

  // village guide
  const placeCats = state.categories.filter(c => c.kind === 'place' && places.some(p => p.category_id === c.id));
  if (placeCats.length) blocks.push(h('section', null, h('h2', { class: 'section-title' }, t('home.guide')),
    h('div', { class: 'chips scroll' }, placeCats.map(c => h('a', { href: `#/directory?cat=${c.id}`, class: 'chip-btn' }, c.icon, ' ', catName(c))),
      h('a', { href: '#/map', class: 'chip-btn' }, '🗺️ ', t('home.openMap')))));
  // everyone who can write can add (mayor) or suggest (resident) a missing place
  if (canWrite()) blocks.push(h('a', { href: '#/place/new', class: 'btn block' }, '＋ ', t(isAdmin() ? 'place.addBtn' : 'place.suggestBtn')));

  clear(main).append(hero, h('div', { class: 'page' }, blocks));

  const points = [
    ...places.map(p => ({ id: p.id, lat: p.lat, lng: p.lng, icon: catById(p.category_id)?.icon, label: p.name, kind: 'place', model: catById(p.category_id)?.key,
      sub: [catName(catById(p.category_id)), p.note].filter(Boolean).join(sep()), phone: p.phone })),
    ...verified.filter(b => b.lat != null).map(b => ({ id: b.id, lat: b.lat, lng: b.lng, icon: catById(b.category_ids[0])?.icon, label: b.name, kind: 'biz',
      sub: b.category_ids.map(id => catName(catById(id))).filter(Boolean).slice(0, 2).join(sep()), phone: b.phone })),
  ];
  scene = await mountScene(stage, { center: center(), map: villageMap, points, mode: 'hero', interactive: true, onPick: showPick });
  return () => { setFull(false); scene?.(); };
}
