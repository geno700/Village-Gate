// Mayor's office: members, businesses, places, categories, requests, invite, village settings, activity, export.
import { db } from './data.js';
import { state, isAdmin, isOwner, catById, center, go } from './state.js';
import { t, catName, sectorName, sectorIcon, getLang } from './i18n.js';
import { h, clear, field, selectEl, toast, errToast, busy, empty, toolbar, matches, statusChip, chip, confirmDialog, modal, fmtDate, fmtNum,
  timeAgo, telLink, normPhone, isPhone, downloadCSV, download, pickFile, stamp, sep } from './ui.js';
import { makeMap, pinIcon, locationPicker } from './map.js';
import { SECTORS, AREA_SIZES } from './shared.js';
import { fetchVillageMap, mapStats, synthHouses } from './osm.js';
import { mapPreview, landmarksOf } from './views-setup.js';
import { setPendingCount } from './app.js';

const TABS = ['members', 'businesses', 'places', 'categories', 'requests', 'invite', 'village', 'activity', 'export'];
const ICONS = { members: '👥', businesses: '🏪', places: '🕌', categories: '🏷️', requests: '🧾', invite: '🔑', village: '🏡', activity: '📜', export: '💾' };

export async function render(main, { tab = 'members' }, ctx) {
  if (!isAdmin()) return go('#/');
  if (!TABS.includes(tab)) tab = 'members';
  const gid = state.group.id;
  const body = h('div', { class: 'admin-body' });
  clear(main).append(h('section', { class: 'page wide' },
    h('h1', null, '🛡️ ', t('admin.title')),
    h('nav', { class: 'tabs', 'aria-label': t('admin.title') }, TABS.map(k =>
      h('a', { href: `#/admin/${k}`, class: 'tab' + (k === tab ? ' on' : ''), 'aria-current': k === tab ? 'page' : null }, ICONS[k], ' ', t('admin.tab.' + k)))),
    body));
  main.querySelector('.tab.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  const views = { members, businesses, places, categories, requests, invite, village, activity, exportTab };
  return views[tab === 'export' ? 'exportTab' : tab](body, gid, ctx);
}

const memberName = (list, uid) => list.find(m => m.user_id === uid)?.display_name || '—';
async function smallMap(el, ll, emoji, cls) {
  const { L, map } = await makeMap(el, { center: ll, zoom: 17 });
  L.marker([ll.lat, ll.lng], { icon: pinIcon(L, emoji, cls) }).addTo(map);
  return map;
}
function showOnMap(title, ll, emoji, cls) {
  const el = h('div', { class: 'map map-sm' });
  const m = modal(title, el, [{ label: t('common.close') }]);
  smallMap(el, ll, emoji, cls).then(map => m.el.addEventListener('close', () => map.remove()));
}

/* ---------------------------------------------------------------- members */
async function members(el, gid) {
  const rows = await db.listMembers(gid);
  setPendingCount(rows.filter(m => m.status === 'pending').length);
  const hasPending = rows.some(m => m.status === 'pending');
  let st = { q: '', status: hasPending ? 'pending' : 'approved', sort: 'new' };
  const list = h('div', { class: 'list' });
  const bar = toolbar({ placeholder: t('admin.searchMembers'), onChange: s => { st = s; paint(); }, selects: [
    { name: 'status', label: t('common.filter'), value: st.status, options: statusOptions(['pending', 'approved', 'rejected', 'removed', 'all'], rows) },
    { name: 'sort', label: t('common.sort'), options: [{ value: 'new', label: t('common.newest') }, { value: 'name', label: t('dir.sortName') }, { value: 'role', label: t('admin.byRole') }] },
  ] });
  const exportBtn = h('button', { class: 'btn ghost small', onclick: () => downloadCSV(`members-${stamp()}.csv`, rows, [
    { label: t('csv.name'), key: 'display_name' }, { label: t('csv.phone'), key: 'phone' }, { label: t('csv.role'), get: m => t('role.' + m.role) },
    { label: t('csv.status'), get: m => t('status.' + m.status) }, { label: t('csv.address'), key: 'home_note' }, { label: 'lat', key: 'home_lat' }, { label: 'lng', key: 'home_lng' },
    { label: t('csv.date'), key: 'created_at' }]) }, '⬇ CSV');
  el.append(h('div', { class: 'section-head' }, h('p', { class: 'muted' }, t('admin.membersHelp')), exportBtn), bar, list);
  const ROLE_ORDER = { owner: 0, admin: 1, member: 2, viewer: 3 };

  function paint() {
    recount(bar, rows); // keep the counts current after approve/reject/remove
    let r = rows.filter(m => matches(st.q, m.display_name, m.phone, m.home_note, m.email));
    if (st.status !== 'all') r = r.filter(m => m.status === st.status);
    r.sort(st.sort === 'name' ? (a, b) => a.display_name.localeCompare(b.display_name, 'ar') : st.sort === 'role' ? (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] : (a, b) => b.created_at.localeCompare(a.created_at));
    clear(list);
    if (!r.length) { list.append(empty('👥', st.status === 'pending' ? t('admin.noPending') : t('admin.noMembers'), st.status === 'pending' ? t('admin.noPendingHelp') : null,
      h('a', { href: '#/admin/invite', class: 'btn' }, '🔑 ', t('admin.tab.invite')))); return; }
    for (const m of r) list.append(memberRow(m));
  }
  function memberRow(m) {
    const self = m.user_id === state.user.id;
    const act = h('div', { class: 'row wrap' });
    const run = async (fn, msg) => { try { await fn(); toast(msg); const fresh = await db.listMembers(gid); rows.splice(0, rows.length, ...fresh); setPendingCount(rows.filter(x => x.status === 'pending').length); paint(); } catch (e) { errToast(e); } };
    if (m.home_lat != null) act.append(h('button', { class: 'btn small ghost', onclick: () => showOnMap(m.display_name, { lat: m.home_lat, lng: m.home_lng }, '🏠', 'home') }, '🏠 ', t('admin.seeHome')));
    if (m.phone) act.append(h('a', { href: telLink(m.phone), class: 'btn small ghost' }, '📞'));
    if (m.status === 'pending' || m.status === 'rejected') {
      act.append(h('button', { class: 'btn small primary', onclick: () => run(() => db.approveMember(m.id, 'member'), t('admin.approved', { name: m.display_name })) }, '✔ ', t('admin.approve')),
        h('button', { class: 'btn small', onclick: () => run(() => db.approveMember(m.id, 'viewer'), t('admin.approved', { name: m.display_name })) }, t('admin.approveViewer')));
      if (m.status === 'pending') act.append(h('button', { class: 'btn small ghost danger', onclick: async () => {
        if (await confirmDialog(t('admin.rejectQ', { name: m.display_name }), { ok: t('admin.reject'), danger: true })) run(() => db.rejectMember(m.id), t('admin.rejected'));
      } }, t('admin.reject')));
    }
    if (m.status === 'approved' && !self && m.role !== 'owner') {
      const opts = ['member', 'viewer'].concat(isOwner() ? ['admin'] : []);
      if (m.role === 'admin' && !isOwner()) { /* only the owner manages admins */ }
      else {
        act.append(selectEl(opts.map(r => ({ value: r, label: t('role.' + r) })), m.role, { class: 'small', 'aria-label': t('admin.role'), onchange: e => run(() => db.setMemberRole(m.id, e.target.value), t('common.saved')) }),
          h('button', { class: 'btn small ghost danger', onclick: async () => {
            if (await confirmDialog(t('admin.removeQ', { name: m.display_name }), { ok: t('admin.remove'), danger: true })) run(() => db.removeMember(m.id), t('admin.removed'));
          } }, t('admin.remove')));
      }
    }
    return h('div', { class: 'list-item col' },
      h('div', { class: 'row' }, h('span', { class: 'li-icon' }, m.role === 'owner' ? '👑' : m.role === 'admin' ? '🛡️' : m.role === 'viewer' ? '👁️' : '👤'),
        h('div', { class: 'li-main' }, h('strong', null, m.display_name, self ? ` (${t('common.you')})` : ''),
          h('small', null, [h('span', { dir: 'ltr' }, m.phone), sep(), t('role.' + m.role), sep(), timeAgo(m.created_at)])),
        statusChip(m.status)),
      m.home_note ? h('p', { class: 'small' }, '📍 ', m.home_note) : null,
      m.status === 'pending' ? h('p', { class: 'small muted' }, t('admin.verifyHint')) : null,
      act.childNodes.length ? act : null);
  }
  paint();
}

/* Status filter with a count per status; recount() refreshes the numbers after a change. */
const statusOptions = (keys, rows) => keys.map(s => ({ value: s,
  label: (s === 'all' ? t('req.fAll') : t('status.' + s)) + ` (${fmtNum(s === 'all' ? rows.length : rows.filter(r => r.status === s).length)})` }));
const recount = (bar, rows) => {
  const sel = bar.querySelector('select');
  if (sel) for (const o of statusOptions([...sel.options].map(o => o.value), rows)) { const opt = [...sel.options].find(x => x.value === o.value); if (opt) opt.textContent = o.label; }
};

/* ---------------------------------------------------------------- businesses */
async function businesses(el, gid, ctx) {
  const [rows, mem] = await Promise.all([db.listBusinesses(gid), db.listMembers(gid)]);
  const hasPending = rows.some(b => b.status === 'pending');
  let st = { q: '', status: hasPending ? 'pending' : 'verified' };
  const list = h('div', { class: 'list' });
  const bar = toolbar({ placeholder: t('admin.searchBusinesses'), onChange: s => { st = s; paint(); }, selects: [
    { name: 'status', label: t('common.filter'), value: st.status, options: statusOptions(['pending', 'verified', 'suspended', 'rejected', 'all'], rows) },
  ] });
  const exportBtn = h('button', { class: 'btn ghost small', onclick: () => downloadCSV(`businesses-${stamp()}.csv`, rows, [
    { label: t('csv.name'), key: 'name' }, { label: t('csv.owner'), get: b => memberName(mem, b.owner_user_id) }, { label: t('csv.category'), get: b => b.category_ids.map(id => catName(catById(id))).join(' / ') },
    { label: t('csv.phone'), key: 'phone' }, { label: t('csv.status'), get: b => t('status.' + b.status) }, { label: 'lat', key: 'lat' }, { label: 'lng', key: 'lng' }]) }, '⬇ CSV');
  el.append(h('div', { class: 'section-head' }, h('p', { class: 'muted' }, t('admin.bizHelp')), exportBtn), bar, list);
  function paint() {
    recount(bar, rows);
    let r = rows.filter(b => matches(st.q, b.name, b.phone, b.description, memberName(mem, b.owner_user_id)));
    if (st.status !== 'all') r = r.filter(b => b.status === st.status);
    r.sort((a, b) => b.created_at.localeCompare(a.created_at));
    clear(list);
    if (!r.length) { list.append(empty('🏪', t('admin.noBiz'), t('admin.noBizHelp'))); return; }
    for (const b of r) {
      const set = async (s, msg) => {
        try {
          await db.setBusinessStatus(b.id, s); b.status = s; toast(msg); paint();
          if (b.owner_user_id === state.user.id) { await ctx.refresh(); window.dispatchEvent(new Event('vg-chrome')); } // my own business: update the nav
        } catch (e) { errToast(e); }
      };
      const act = h('div', { class: 'row wrap' });
      if (b.lat != null) act.append(h('button', { class: 'btn small ghost', onclick: () => showOnMap(b.name, b, catById(b.category_ids[0])?.icon, 'biz') }, '🗺️'));
      act.append(h('a', { href: telLink(b.phone), class: 'btn small ghost' }, '📞'));
      if (b.status === 'pending' || b.status === 'rejected') act.append(h('button', { class: 'btn small primary', onclick: () => set('verified', t('admin.bizVerified')) }, '✔ ', t('admin.verify')));
      if (b.status === 'pending') act.append(h('button', { class: 'btn small ghost danger', onclick: async () => { if (await confirmDialog(t('admin.rejectBizQ', { name: b.name }), { ok: t('admin.reject'), danger: true })) set('rejected', t('admin.rejected')); } }, t('admin.reject')));
      if (b.status === 'verified') act.append(h('button', { class: 'btn small ghost danger', onclick: async () => { if (await confirmDialog(t('admin.suspendQ', { name: b.name }), { ok: t('admin.suspend'), danger: true })) set('suspended', t('admin.suspended')); } }, t('admin.suspend')));
      if (b.status === 'suspended') act.append(h('button', { class: 'btn small', onclick: () => set('verified', t('admin.bizVerified')) }, t('admin.reinstate')));
      list.append(h('div', { class: 'list-item col' },
        h('div', { class: 'row' }, h('span', { class: 'li-icon' }, catById(b.category_ids[0])?.icon || '🏪'),
          h('div', { class: 'li-main' }, h('strong', null, b.name), h('small', null, [t('admin.owner', { name: memberName(mem, b.owner_user_id) }), b.is_mobile ? t('biz.mobileShort') : null, timeAgo(b.created_at)].filter(Boolean).join(sep()))),
          statusChip(b.status)),
        h('div', { class: 'chips' }, b.category_ids.map(id => chip(catName(catById(id))))),
        b.description ? h('p', { class: 'small' }, b.description) : null, act));
    }
  }
  paint();
}

/* ---------------------------------------------------------------- places */
async function places(el, gid) {
  const rows = await db.listPlaces(gid);
  const placeCats = state.categories.filter(c => c.kind === 'place');
  let st = { q: '', cat: 'all' };
  const list = h('div', { class: 'list' });
  const bar = toolbar({ placeholder: t('common.search'), onChange: s => { st = s; paint(); }, selects: [
    { name: 'cat', label: t('common.filter'), options: [{ value: 'all', label: t('dir.everything') }, ...placeCats.map(c => ({ value: c.id, label: `${c.icon} ${catName(c)}` }))] }] });
  el.append(h('div', { class: 'section-head' }, h('p', { class: 'muted' }, t('admin.placesHelp')),
    h('button', { class: 'btn ghost small', onclick: () => downloadCSV(`places-${stamp()}.csv`, rows, [{ label: t('csv.name'), key: 'name' },
      { label: t('csv.category'), get: p => catName(catById(p.category_id)) }, { label: t('csv.phone'), key: 'phone' }, { label: t('csv.note'), key: 'note' }, { label: 'lat', key: 'lat' }, { label: 'lng', key: 'lng' }]) }, '⬇ CSV')),
  h('button', { class: 'btn primary block', onclick: () => edit(null) }, '＋ ', t('admin.addPlace')), bar, list);
  function paint() {
    let r = rows.filter(p => matches(st.q, p.name, p.note));
    if (st.cat !== 'all') r = r.filter(p => p.category_id === st.cat);
    r.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    clear(list);
    if (!r.length) { list.append(empty('🕌', t('admin.noPlaces'), t('admin.noPlacesHelp'))); return; }
    for (const p of r) list.append(h('div', { class: 'list-item' }, h('span', { class: 'li-icon place' }, catById(p.category_id)?.icon || '•'),
      h('div', { class: 'li-main' }, h('strong', null, p.name), h('small', null, [catName(catById(p.category_id)), p.note].filter(Boolean).join(sep()))),
      h('button', { class: 'icon-btn', 'aria-label': t('common.edit'), onclick: () => edit(p) }, '✎'),
      h('button', { class: 'icon-btn danger', 'aria-label': t('common.delete'), onclick: async () => {
        if (!await confirmDialog(t('admin.deletePlaceQ', { name: p.name }), { ok: t('common.delete'), danger: true })) return;
        try { await db.deletePlace(p.id); rows.splice(rows.indexOf(p), 1); toast(t('common.deleted')); paint(); } catch (e) { errToast(e); }
      } }, '🗑')));
  }
  async function edit(p) {
    const name = h('input', { required: true, minlength: 2, maxlength: 80, value: p?.name || '' });
    const cat = selectEl(placeCats.map(c => ({ value: c.id, label: `${c.icon} ${catName(c)}` })), p?.category_id);
    const phone = h('input', { type: 'tel', inputmode: 'tel', dir: 'ltr', value: p?.phone || '', placeholder: t('common.optional') });
    const note = h('input', { maxlength: 300, value: p?.note || '', placeholder: t('admin.placeNotePh') });
    const mapBox = h('div');
    let picker;
    const m = modal(p ? t('admin.editPlace') : t('admin.addPlace'), h('div', { class: 'stack' }, field(t('csv.name'), name), field(t('csv.category'), cat), mapBox, field(t('csv.phone'), phone), field(t('csv.note'), note)), [
      { label: t('common.cancel') },
      { label: t('common.save'), kind: 'primary', onClick: async () => {
        try {
          const ll = picker.get(); if (!ll) throw new Error('location_required');
          const ph = phone.value.trim() ? normPhone(phone.value) : null; if (ph && !isPhone(ph)) throw new Error('invalid_phone');
          const id = await db.savePlace(gid, { id: p?.id, name: name.value, category_id: cat.value, phone: ph, note: note.value, lat: ll.lat, lng: ll.lng });
          const row = { ...(p || {}), id, name: name.value.trim(), category_id: cat.value, phone: ph, note: note.value.trim(), lat: ll.lat, lng: ll.lng };
          if (p) Object.assign(p, row); else rows.push(row);
          toast(t('common.saved')); paint(); return true;
        } catch (e) { errToast(e); return false; }
      } }]);
    picker = await locationPicker(mapBox, { value: p ? { lat: p.lat, lng: p.lng } : null, center: center(), emoji: catById(p?.category_id)?.icon || '📍' });
    m.el.addEventListener('close', () => picker.map.remove());
  }
  paint();
}

/* ---------------------------------------------------------------- categories */
async function categories(el, gid, ctx) {
  const rows = await db.listCategories(gid);
  const list = h('div', { class: 'list' });
  el.append(h('p', { class: 'muted' }, t('admin.catsHelp')), h('button', { class: 'btn primary block', onclick: () => edit(null) }, '＋ ', t('admin.addCategory')), list);
  function paint() {
    clear(list);
    const groups = [...SECTORS.map(s => s[0]), 'places'].map(sec => [sec, rows.filter(x => (x.kind === 'place' ? 'places' : (x.sector || 'other')) === sec)]);
    for (const [sec, cats] of groups) {
      if (!cats.length) continue;
      list.append(h('h3', { class: 'section-title' }, sectorIcon(sec), ' ', sectorName(sec)));
      for (const c of cats) list.append(h('div', { class: 'list-item' + (c.active ? '' : ' dim') },
        h('span', { class: 'li-icon' }, c.icon), h('div', { class: 'li-main' }, h('strong', null, catName(c)), h('small', null, getLang() === 'ar' ? c.name_en : c.name_ar)),
        h('label', { class: 'switch', title: t('admin.active') }, h('input', { type: 'checkbox', checked: c.active, 'aria-label': t('admin.active'), onchange: async e => {
          try { await db.saveCategory(gid, { ...c, active: e.target.checked }); c.active = e.target.checked; await ctx.refresh(); paint(); } catch (err) { errToast(err); e.target.checked = !e.target.checked; }
        } }), h('span')),
        h('button', { class: 'icon-btn', 'aria-label': t('common.edit'), onclick: () => edit(c) }, '✎')));
    }
  }
  function edit(c) {
    const icon = h('input', { maxlength: 8, value: c?.icon || '', class: 'icon-input', required: true });
    const ar = h('input', { maxlength: 40, required: true, value: c?.name_ar || '' });
    const en = h('input', { maxlength: 40, required: true, value: c?.name_en || '', dir: 'ltr' });
    const kind = selectEl([{ value: 'service', label: t('admin.kind.service') }, { value: 'place', label: t('admin.kind.place') }], c?.kind || 'service', { disabled: !!c });
    const sector = selectEl(SECTORS.map(([k, ic]) => ({ value: k, label: `${ic} ${sectorName(k)}` })), c?.sector && c.sector !== 'places' ? c.sector : 'other');
    const sectorField = field(t('admin.sector'), sector);
    const syncKind = () => { sectorField.hidden = kind.value === 'place'; };
    kind.addEventListener('change', syncKind); syncKind();
    const sort = h('input', { type: 'number', value: c?.sort ?? (rows.length + 1) * 10, inputmode: 'numeric' });
    modal(c ? t('admin.editCategory') : t('admin.addCategory'), h('div', { class: 'stack' }, field(t('admin.icon'), icon, t('admin.iconHint')), field(t('admin.nameAr'), ar), field(t('admin.nameEn'), en), field(t('admin.kindLabel'), kind), sectorField, field(t('admin.sortOrder'), sort)), [
      { label: t('common.cancel') },
      { label: t('common.save'), kind: 'primary', onClick: async () => {
        try {
          const key = c?.key || (en.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'cat') ;
          const row = { id: c?.id, key: key.length < 2 ? key + '_x' : key, kind: kind.value, sector: kind.value === 'place' ? 'places' : sector.value, icon: icon.value.trim(), name_ar: ar.value, name_en: en.value, sort: parseInt(sort.value, 10) || 100, active: c?.active ?? true };
          const id = await db.saveCategory(gid, row);
          if (c) Object.assign(c, row); else rows.push({ ...row, id });
          rows.sort((a, b) => a.sort - b.sort);
          await ctx.refresh(); toast(t('common.saved')); paint(); return true;
        } catch (e) { errToast(e); return false; }
      } }]);
  }
  paint();
}

/* ---------------------------------------------------------------- requests overview */
async function requests(el, gid) {
  const [rows, mem, biz] = await Promise.all([db.adminRequests(gid), db.listMembers(gid), db.listBusinesses(gid)]);
  const weekAgo = Date.now() - 7 * 86400000;
  const stat = (label, n) => h('div', { class: 'stat' }, h('strong', null, fmtNum(n)), h('span', null, label));
  const byCat = {};
  rows.filter(r => r.status === 'open').forEach(r => { byCat[r.category_id] = (byCat[r.category_id] || 0) + 1; });
  const list = h('div', { class: 'list' });
  let st = { q: '', status: 'open', sort: 'new' };
  const bar = toolbar({ placeholder: t('req.search'), onChange: s => { st = s; paint(); }, selects: [
    { name: 'status', label: t('common.filter'), value: 'open', options: ['open', 'accepted', 'delivered', 'cancelled', 'expired', 'all'].map(s => ({ value: s, label: s === 'all' ? t('req.fAll') : t('status.' + s) })) },
    { name: 'sort', label: t('common.sort'), options: [{ value: 'new', label: t('common.newest') }, { value: 'old', label: t('common.oldest') }] }] });
  el.append(
    h('div', { class: 'stats' }, stat(t('status.open'), rows.filter(r => r.status === 'open').length), stat(t('status.accepted'), rows.filter(r => r.status === 'accepted').length),
      stat(t('admin.delivered7'), rows.filter(r => r.status === 'delivered' && new Date(r.delivered_at) > weekAgo).length), stat(t('admin.req7'), rows.filter(r => new Date(r.created_at) > weekAgo).length)),
    Object.keys(byCat).length ? h('div', { class: 'chips' }, Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([cid, n]) => chip(`${catById(cid)?.icon || ''} ${catName(catById(cid))}: ${fmtNum(n)}`))) : null,
    h('div', { class: 'section-head' }, h('p', { class: 'muted' }, t('admin.reqHelp')),
      h('button', { class: 'btn ghost small', onclick: () => downloadCSV(`requests-${stamp()}.csv`, rows, [{ label: t('csv.date'), key: 'created_at' }, { label: t('csv.category'), get: r => catName(catById(r.category_id)) },
        { label: t('csv.qty'), key: 'quantity' }, { label: t('csv.details'), key: 'details' }, { label: t('csv.requester'), get: r => memberName(mem, r.created_by) },
        { label: t('csv.status'), get: r => t('status.' + r.status) }, { label: t('csv.business'), get: r => biz.find(b => b.id === r.business_id)?.name || '' }, { label: t('csv.address'), key: 'location_note' }]) }, '⬇ CSV')),
    bar, list);
  function paint() {
    let r = rows.filter(x => matches(st.q, x.details, x.location_note, memberName(mem, x.created_by), catName(catById(x.category_id))));
    if (st.status !== 'all') r = r.filter(x => x.status === st.status);
    r.sort((a, b) => st.sort === 'new' ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at));
    clear(list);
    if (!r.length) { list.append(empty('🧾', t('admin.noRequests'), null)); return; }
    for (const x of r.slice(0, 300)) list.append(h('div', { class: 'list-item' }, h('span', { class: 'li-icon' }, catById(x.category_id)?.icon || '•'),
      h('div', { class: 'li-main' }, h('strong', null, catName(catById(x.category_id)), x.quantity > 1 ? ` × ${fmtNum(x.quantity)}` : '', ' — ', memberName(mem, x.created_by)),
        h('small', null, [x.details, x.business_id ? biz.find(b => b.id === x.business_id)?.name : null, timeAgo(x.created_at)].filter(Boolean).join(sep()))),
      statusChip(x.status)));
  }
  paint();
}

/* ---------------------------------------------------------------- invite */
function invite(el, gid) {
  const g = state.group;
  const link = () => `${location.origin}${location.pathname}#/join/${g.join_code}`;
  const codeEl = h('div', { class: 'join-code', dir: 'ltr' }, g.join_code);
  const linkEl = h('input', { readonly: true, value: link(), dir: 'ltr', onclick: e => e.target.select() });
  const copy = async txt => { try { await navigator.clipboard.writeText(txt); toast(t('common.copied')); } catch { linkEl.select(); } };
  const msg = () => t('admin.inviteMsg', { name: g.name, code: g.join_code, link: link() });
  el.append(h('div', { class: 'card center' }, h('p', null, t('admin.inviteHelp')), codeEl,
    h('div', { class: 'row center wrap' },
      h('button', { class: 'btn', onclick: () => copy(g.join_code) }, '📋 ', t('admin.copyCode')),
      h('button', { class: 'btn', onclick: () => copy(link()) }, '🔗 ', t('admin.copyLink')),
      navigator.share ? h('button', { class: 'btn primary', onclick: () => navigator.share({ title: g.name, text: msg() }).catch(() => {}) }, '📤 ', t('admin.share')) : null,
      h('a', { class: 'btn', href: 'https://wa.me/?text=' + encodeURIComponent(msg()), target: '_blank', rel: 'noopener' }, '💬 WhatsApp')),
    field(t('admin.inviteLink'), linkEl)),
  h('div', { class: 'card' }, h('h3', null, t('admin.newCode')), h('p', { class: 'muted' }, t('admin.newCodeHelp')),
    h('button', { class: 'btn ghost danger', onclick: async () => {
      if (!await confirmDialog(t('admin.newCodeQ'), { ok: t('admin.newCode'), danger: true })) return;
      try { g.join_code = await db.regenerateCode(gid); codeEl.textContent = g.join_code; linkEl.value = link(); toast(t('admin.codeChanged')); } catch (e) { errToast(e); }
    } }, '↻ ', t('admin.newCode'))));
}

/* ---------------------------------------------------------------- village settings */
async function village(el, gid, ctx) {
  const g = state.group;
  const name = h('input', { required: true, minlength: 2, maxlength: 80, value: g.name });
  const mapBox = h('div');
  const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, t('common.save'));
  let radius = g.radius_m || 1000;
  const sizeBtns = AREA_SIZES.map(([key, m]) => h('button', { type: 'button', class: 'seg-btn' + (m === radius ? ' on' : ''), role: 'radio', 'aria-checked': String(m === radius),
    onclick: () => { radius = m; sizeBtns.forEach((b, i) => { const on = AREA_SIZES[i][1] === m; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); } },
    t('setup.size.' + key)));
  const form = h('form', { class: 'stack' }, field(t('start.villageName'), name),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('start.center')), mapBox, h('small', { class: 'hint' }, t('admin.centerHint'))),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('setup.size')), h('div', { class: 'seg', role: 'radiogroup' }, sizeBtns)), saveBtn);
  el.append(h('div', { class: 'card' }, h('h2', null, t('admin.villageInfo')), form));

  // the 3D village map
  let destroyPreview = null;
  const mapInfo = h('p', { class: 'muted' }), mapArea = h('div', { class: 'stack' });
  const rebuildBtn = h('button', { type: 'button', class: 'btn' }, '🏗️ ', t('admin.mapRebuild'));
  const showInfo = (m, houses) => {
    mapInfo.textContent = m ? t('admin.mapBuilt', { date: fmtDate(m.at), roads: fmtNum(mapStats(m).roadsKm), houses: fmtNum(houses ?? (m.b.length + synthHouses(m).length)) }) : t('admin.mapNone');
  };
  showInfo(await db.getVillageMap(gid).catch(() => null));
  el.append(h('div', { class: 'card' }, h('h2', null, '🏘️ ', t('admin.mapTitle')), mapInfo, h('p', { class: 'hint' }, t('admin.mapHelp')), rebuildBtn, mapArea));
  rebuildBtn.onclick = async () => {
    busy(rebuildBtn, true); destroyPreview?.(); destroyPreview = null;
    const status = h('p', { class: 'build-status' }, t('setup.reading'));
    clear(mapArea).append(status);
    try {
      const m = await fetchVillageMap(center(), state.group.radius_m || radius, step => {
        status.textContent = t(step === 'busy' ? 'setup.busyRetry' : step === 'build' ? 'setup.building' : 'setup.reading');
      });
      await db.saveVillageMap(gid, m);
      const marks = landmarksOf(m);
      const added = marks.length ? await db.importPlaces(gid, marks) : 0;
      clear(mapArea);
      const prev = await mapPreview(mapArea, m, center());
      destroyPreview = prev.destroy;
      showInfo(m, prev.houses);
      toast(t('admin.mapSaved') + (added ? ' ' + t('admin.placesAdded', { n: fmtNum(added) }) : ''));
    } catch (err) { clear(mapArea).append(h('p', { class: 'note warn' }, t('setup.failed'))); errToast(err); }
    finally { busy(rebuildBtn, false); }
  };
  const members = isOwner() ? (await db.listMembers(gid)).filter(m => m.status === 'approved' && m.user_id !== state.user.id) : [];
  if (isOwner()) {
    const who = selectEl([{ value: '', label: t('admin.pickMember') }, ...members.map(m => ({ value: m.id, label: `${m.display_name} (${t('role.' + m.role)})` }))], '');
    el.append(h('div', { class: 'card' }, h('h2', null, '👑 ', t('admin.transfer')), h('p', { class: 'muted' }, t('admin.transferHelp')), who,
      h('button', { class: 'btn danger', onclick: async () => {
        const m = members.find(x => x.id === who.value); if (!m) return toast(t('admin.pickMember'), 'err');
        if (!await confirmDialog(t('admin.transferQ', { name: m.display_name }), { ok: t('admin.transfer'), danger: true })) return;
        try { await db.transferOwnership(gid, m.id); await ctx.refresh(); toast(t('admin.transferred')); go('#/'); } catch (e) { errToast(e); }
      } }, t('admin.transfer'))),
    h('div', { class: 'card danger-zone' }, h('h2', null, '⚠️ ', t('admin.deleteVillage')), h('p', null, t('admin.deleteHelp')),
      h('button', { class: 'btn danger', onclick: async () => {
        const typed = h('input', { placeholder: g.name });
        const okDel = await new Promise(res => {
          let done = false;
          const m = modal(t('admin.deleteVillage'), h('div', { class: 'stack' }, h('p', null, t('admin.deleteTypeName', { name: g.name })), typed), [
            { label: t('common.cancel'), onClick: () => { done = true; res(false); } },
            { label: t('common.delete'), kind: 'danger', onClick: () => { if (typed.value.trim() !== g.name) { toast(t('admin.nameMismatch'), 'err'); return false; } done = true; res(true); } }]);
          m.el.addEventListener('close', () => { if (!done) res(false); });
        });
        if (!okDel) return;
        try { await db.deleteGroup(gid); localStorage.removeItem('vg-group'); await ctx.refresh(); toast(t('common.deleted')); go('#/'); } catch (e) { errToast(e); }
      } }, t('admin.deleteVillage'))));
  }
  const picker = await locationPicker(mapBox, { value: center(), emoji: '📍', zoom: g.zoom });
  form.onsubmit = async e => {
    e.preventDefault(); busy(saveBtn, true);
    try { const c = picker.get(); await db.updateGroup(gid, { name: name.value, center_lat: c.lat, center_lng: c.lng, zoom: picker.map.getZoom(), radius_m: radius }); await ctx.refresh(); toast(t('common.saved')); }
    catch (err) { errToast(err); } finally { busy(saveBtn, false); }
  };
  return () => { picker.map.remove(); destroyPreview?.(); };
}

/* ---------------------------------------------------------------- activity */
export function describeActivity(a) {
  const ent = t('entity.' + a.entity, null, a.entity);
  const act = t('action.' + a.action, null, a.action);
  const name = a.after?.display_name || a.after?.name || a.before?.display_name || a.before?.name || '';
  let change = '';
  if (a.before?.status !== undefined && a.after?.status !== undefined && a.before.status !== a.after.status) change = `${t('status.' + a.before.status)} → ${t('status.' + a.after.status)}`;
  else if (a.before?.role && a.after?.role && a.before.role !== a.after.role) change = `${t('role.' + a.before.role)} → ${t('role.' + a.after.role)}`;
  return { title: `${act}${sep()}${ent}`, name, change };
}
async function activity(el, gid) {
  const [rows, mem] = await Promise.all([db.listActivity(gid, 300), db.listMembers(gid)]);
  let st = { q: '', ent: 'all' };
  const list = h('div', { class: 'list' });
  const ents = [...new Set(rows.map(r => r.entity))];
  el.append(h('p', { class: 'muted' }, t('admin.activityHelp')),
    toolbar({ placeholder: t('common.search'), onChange: s => { st = s; paint(); }, selects: [{ name: 'ent', label: t('common.filter'),
      options: [{ value: 'all', label: t('req.fAll') }, ...ents.map(e => ({ value: e, label: t('entity.' + e, null, e) }))] }] }), list);
  function paint() {
    clear(list);
    const r = rows.filter(a => (st.ent === 'all' || a.entity === st.ent)).map(a => ({ a, d: describeActivity(a), who: memberName(mem, a.actor) }))
      .filter(x => matches(st.q, x.d.title, x.d.name, x.who));
    if (!r.length) { list.append(empty('📜', t('admin.noActivity'), null)); return; }
    for (const { a, d, who } of r) list.append(h('details', { class: 'list-item col' },
      h('summary', null, h('strong', null, d.title), d.name ? ` — ${d.name}` : '', h('small', { class: 'block' }, [who, d.change, fmtDate(a.created_at)].filter(Boolean).join(sep()))),
      h('pre', { class: 'json', dir: 'ltr' }, JSON.stringify({ before: a.before, after: a.after }, null, 1))));
  }
  paint();
}

/* ---------------------------------------------------------------- export / backup */
function exportTab(el, gid, ctx) {
  const btn = (label, fn) => h('button', { class: 'btn block', onclick: async e => { busy(e.target, true); try { await fn(); } catch (err) { errToast(err); } finally { busy(e.target, false); } } }, label);
  el.append(
    h('div', { class: 'card stack' }, h('h2', null, '⬇ ', t('admin.csvTitle')), h('p', { class: 'muted' }, t('admin.csvHelp')),
      h('div', { class: 'row wrap' },
        h('a', { href: '#/admin/members', class: 'btn' }, t('admin.tab.members')), h('a', { href: '#/admin/businesses', class: 'btn' }, t('admin.tab.businesses')),
        h('a', { href: '#/admin/places', class: 'btn' }, t('admin.tab.places')), h('a', { href: '#/admin/requests', class: 'btn' }, t('admin.tab.requests')))),
    h('div', { class: 'card stack' }, h('h2', null, '💾 ', t('admin.backupTitle')), h('p', { class: 'muted' }, t('admin.backupHelp')),
      btn(t('admin.backup'), async () => { const data = await db.exportGroup(gid); download(`village-gate-${state.group.name}-${stamp()}.json`, JSON.stringify(data, null, 1)); toast(t('admin.backupDone')); }),
      h('p', { class: 'muted small' }, t('admin.restoreHelp')),
      btn(t('admin.restore'), async () => {
        const f = await pickFile('application/json,.json'); if (!f) return;
        let data; try { data = JSON.parse(await f.text()); } catch { throw new Error('invalid_backup'); }
        if (!await confirmDialog(t('admin.restoreQ'), { ok: t('admin.restore') })) return;
        const r = await db.importGroup(gid, data); await ctx.refresh();
        toast(t('admin.restored', { c: fmtNum(r?.categories ?? 0), p: fmtNum(r?.places ?? 0) }));
      })));
}
