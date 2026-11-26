// Village map, directory (businesses + places) and the business card.
import { db } from './data.js';
import { state, catById, center, locate, isAdmin, canWrite, query } from './state.js';
import { t, catName } from './i18n.js';
import { h, clear, toolbar, empty, matches, distanceKm, fmtDistance, fmtNum, telLink, waLink, chip, statusChip, downloadCSV, stamp, sep } from './ui.js';
import { makeMap, pinIcon } from './map.js';
import { SEARCH_WORDS } from './shared.js';

const homeOf = () => state.membership?.home_lat != null ? { lat: state.membership.home_lat, lng: state.membership.home_lng } : null;
const catsLabel = ids => ids.map(id => catName(catById(id))).filter(Boolean).join('، ');

function contactButtons(phone, whatsapp, name) {
  return h('div', { class: 'row wrap' },
    phone ? h('a', { href: telLink(phone), class: 'btn small' }, '📞 ', t('common.call')) : null,
    whatsapp ? h('a', { href: waLink(whatsapp, t('biz.waHello', { name })), class: 'btn small', target: '_blank', rel: 'noopener' }, '💬 ', t('common.whatsapp')) : null);
}

/* ---------------------------------------------------------------- map */
export async function mapView(main) {
  const gid = state.group.id;
  const [places, businesses] = await Promise.all([db.listPlaces(gid), db.listBusinesses(gid)]);
  const verified = businesses.filter(b => b.status === 'verified' && b.lat != null);
  const mapEl = h('div', { class: 'map map-full' });
  let show = 'all';
  const filterBar = h('div', { class: 'map-filter chips' }, [['all', t('map.all')], ['place', t('map.places')], ['biz', t('map.businesses')]].map(([k, label]) =>
    h('button', { type: 'button', class: 'chip-btn' + (k === 'all' ? ' on' : ''), dataset: { k }, onclick: e => {
      show = k; filterBar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k)); paint();
    } }, label)));
  const locBtn = h('button', { type: 'button', class: 'map-fab', 'aria-label': t('loc.useGps'), onclick: async () => {
    const here = await locate(); if (here) { map.setView([here.lat, here.lng], 17); L.circleMarker([here.lat, here.lng], { radius: 8, color: '#1e88e5', fillOpacity: 0.8 }).addTo(map); }
  } }, '📍');
  clear(main).append(h('div', { class: 'map-page' }, mapEl, filterBar, locBtn));
  const { L, map } = await makeMap(mapEl, { center: center(), zoom: state.group.zoom || 16 });
  const layer = L.layerGroup().addTo(map);
  const markers = {};
  const popup = (title, sub, extra) => h('div', { class: 'popup' }, h('strong', null, title), sub ? h('small', null, sub) : null, extra);
  function paint() {
    layer.clearLayers();
    if (show !== 'biz') for (const p of places) {
      const c = catById(p.category_id);
      markers[p.id] = L.marker([p.lat, p.lng], { icon: pinIcon(L, c?.icon, 'place'), title: p.name })
        .bindPopup(popup(p.name, [catName(c), p.note].filter(Boolean).join(sep()), contactButtons(p.phone, null, p.name))).addTo(layer);
    }
    if (show !== 'place') for (const b of verified) {
      markers[b.id] = L.marker([b.lat, b.lng], { icon: pinIcon(L, catById(b.category_ids[0])?.icon, 'biz'), title: b.name })
        .bindPopup(popup(b.name, catsLabel(b.category_ids), h('div', null, contactButtons(b.phone, b.whatsapp, b.name),
          h('a', { href: `#/business/${b.id}`, class: 'popup-link' }, t('common.details'))))).addTo(layer);
    }
    const home = homeOf();
    if (home) L.marker([home.lat, home.lng], { icon: pinIcon(L, '🏠', 'home'), title: t('map.myHome') }).bindPopup(t('map.myHome')).addTo(layer);
  }
  paint();
  const focus = query().get('place') || query().get('biz');
  if (focus && markers[focus]) { map.setView(markers[focus].getLatLng(), 18); markers[focus].openPopup(); }
  return () => map.remove();
}

/* ---------------------------------------------------------------- directory */
export async function directory(main) {
  const gid = state.group.id;
  const [places, businesses] = await Promise.all([db.listPlaces(gid), db.listBusinesses(gid)]);
  const items = [
    ...businesses.filter(b => b.status === 'verified').map(b => ({ kind: 'biz', id: b.id, name: b.name, cats: b.category_ids, phone: b.phone, whatsapp: b.whatsapp,
      lat: b.lat, lng: b.lng, sub: catsLabel(b.category_ids), mobile: b.is_mobile, desc: b.description })),
    ...places.map(p => ({ kind: 'place', id: p.id, name: p.name, cats: [p.category_id], phone: p.phone, lat: p.lat, lng: p.lng,
      sub: catName(catById(p.category_id)), desc: p.note })),
  ];
  const from = state.here || homeOf() || center();
  items.forEach(i => { i.dist = i.lat != null ? distanceKm(from, i) : null; });

  const used = state.categories.filter(c => items.some(i => i.cats.includes(c.id)));
  const initialCat = query().get('cat') || 'all';
  const list = h('div', { class: 'list' });
  const count = h('p', { class: 'muted small' });
  let st = { q: '', f: initialCat, sort: 'name' };
  const bar = toolbar({ placeholder: t('dir.search'), onChange: s => { st = s; paint(); }, selects: [
    { name: 'f', label: t('common.filter'), value: initialCat, options: [{ value: 'all', label: t('dir.everything') }, { value: 'biz', label: t('map.businesses') }, { value: 'place', label: t('map.places') },
      ...used.map(c => ({ value: c.id, label: `${c.icon} ${catName(c)}` }))] },
    { name: 'sort', label: t('common.sort'), options: [{ value: 'name', label: t('dir.sortName') }, { value: 'dist', label: t('dir.sortDistance') }] },
  ] });
  st.f = initialCat;

  function paint() {
    // also match everyday words for each service ("انبوبة" finds gas sellers)
    let rows = items.filter(i => matches(st.q, i.name, i.sub, i.desc, ...i.cats.map(id => SEARCH_WORDS[catById(id)?.key])));
    if (st.f === 'biz' || st.f === 'place') rows = rows.filter(i => i.kind === st.f);
    else if (st.f !== 'all') rows = rows.filter(i => i.cats.includes(st.f));
    rows.sort(st.sort === 'dist' ? (a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9) : (a, b) => a.name.localeCompare(b.name, 'ar'));
    count.textContent = t('dir.count', { n: fmtNum(rows.length) });
    clear(list);
    if (!rows.length) {
      list.append(empty('🔎', t('dir.emptyTitle'), items.length ? t('dir.emptyFiltered') : t('dir.emptyNone'),
        canWrite() ? h('a', { href: '#/my-business', class: 'btn' }, t('dir.addYours')) : null));
      return;
    }
    for (const i of rows) {
      const icon = catById(i.cats[0])?.icon || '•';
      list.append(h('div', { class: 'list-item' },
        h('a', { href: i.kind === 'biz' ? `#/business/${i.id}` : `#/map?place=${i.id}`, class: 'li-link' },
          h('span', { class: 'li-icon ' + i.kind }, icon),
          h('div', { class: 'li-main' }, h('strong', null, i.name),
            h('small', null, [i.sub, i.mobile ? t('biz.mobileShort') : null, i.dist != null ? fmtDistance(i.dist) : null].filter(Boolean).join(sep())))),
        i.phone ? h('a', { href: telLink(i.phone), class: 'icon-btn', 'aria-label': t('common.call') + ' ' + i.name }, '📞') : null));
    }
  }
  const exportBtn = h('button', { type: 'button', class: 'btn ghost small', onclick: () => downloadCSV(`directory-${stamp()}.csv`, items, [
    { label: t('csv.type'), get: i => i.kind === 'biz' ? t('map.businesses') : t('map.places') }, { label: t('csv.name'), key: 'name' },
    { label: t('csv.category'), key: 'sub' }, { label: t('csv.phone'), key: 'phone' }, { label: 'lat', key: 'lat' }, { label: 'lng', key: 'lng' }]) }, '⬇ CSV');
  clear(main).append(h('section', { class: 'page' }, h('div', { class: 'section-head' }, h('h1', null, t('dir.title')), exportBtn), bar, count, list));
  // pre-select category filter from ?cat=
  const sel = bar.querySelector('select'); if (sel) sel.value = initialCat;
  paint();
  if (!state.here) locate().then(p => { if (p) { items.forEach(i => { i.dist = i.lat != null ? distanceKm(p, i) : null; }); paint(); } });
}

/* ---------------------------------------------------------------- business card */
export async function businessDetail(main, { id }) {
  const all = await db.listBusinesses(state.group.id);
  const b = all.find(x => x.id === id);
  if (!b) { clear(main).append(h('section', { class: 'page' }, empty('🤷', t('biz.notFound'), t('biz.notFoundHelp'), h('a', { href: '#/directory', class: 'btn' }, t('dir.title'))))); return; }
  const mine = b.owner_user_id === state.user.id;
  const mapEl = b.lat != null ? h('div', { class: 'map map-sm' }) : null;
  clear(main).append(h('section', { class: 'page' },
    h('a', { href: '#/directory', class: 'back' }, t('common.back')),
    h('div', { class: 'card biz-card' },
      h('div', { class: 'biz-head' }, h('span', { class: 'biz-icon' }, catById(b.category_ids[0])?.icon || '🏪'),
        h('div', null, h('h1', null, b.name), h('div', { class: 'chips' }, b.category_ids.map(cid => chip(catName(catById(cid)))),
          b.status === 'verified' ? chip('✔ ' + t('biz.verifiedByMayor'), 'ok') : statusChip(b.status)))),
      b.description ? h('p', null, b.description) : null,
      h('dl', { class: 'facts' },
        b.hours ? [h('dt', null, t('biz.hours')), h('dd', null, b.hours)] : null,
        h('dt', null, t('biz.type')), h('dd', null, b.is_mobile ? t('biz.mobile') : t('biz.fixed')),
        h('dt', null, t('biz.phone')), h('dd', { dir: 'ltr' }, b.phone)),
      contactButtons(b.phone, b.whatsapp, b.name)),
    mapEl,
    canWrite() ? h('div', { class: 'card' }, h('h2', null, t('biz.askFor')), h('div', { class: 'chips' }, b.category_ids.map(cid => {
      const c = catById(cid); return h('a', { href: `#/request/new?cat=${cid}`, class: 'chip-btn' }, c?.icon, ' ', catName(c));
    })), h('small', { class: 'hint' }, t('biz.askForHint'))) : null,
    mine ? h('a', { href: '#/my-business', class: 'btn block' }, t('biz.editMine')) : null,
    isAdmin() && !mine ? h('a', { href: '#/admin/businesses', class: 'btn ghost block' }, t('admin.manageBusinesses')) : null));
  if (mapEl) {
    const { L, map } = await makeMap(mapEl, { center: { lat: b.lat, lng: b.lng }, zoom: 17 });
    L.marker([b.lat, b.lng], { icon: pinIcon(L, catById(b.category_ids[0])?.icon, 'biz') }).addTo(map);
    return () => map.remove();
  }
}
