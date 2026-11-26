// My business (register / edit / status) and the provider's demand heatmap + jobs route.
import { db, cellOf, CELL } from './data.js';
import { state, catById, center, go, canWrite, verifiedBusinesses, locate, query } from './state.js';
import { t, catName, sectorName } from './i18n.js';
import { SECTORS, SEARCH_WORDS } from './shared.js';
import { h, clear, field, toast, errToast, busy, empty, statusChip, chip, confirmDialog, normPhone, isPhone, fmtNum, timeAgo, fmtDate,
  distanceKm, fmtDistance, telLink, waLink, modal, sep, matches } from './ui.js';
import { locationPicker, makeMap, pinIcon, countIcon } from './map.js';

/* ---------------------------------------------------------------- my business */
export async function myBusiness(main, _p, ctx) {
  const page = h('section', { class: 'page' });
  clear(main).append(page);
  const list = state.myBusinesses;
  const paintList = () => {
    clear(page).append(h('h1', null, t('biz.mineTitle')), h('p', { class: 'muted' }, t('biz.mineIntro')));
    if (!list.length) page.append(empty('🏪', t('biz.noneTitle'), t('biz.noneHelp')));
    for (const b of list) {
      page.append(h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('h2', null, b.name), statusChip(b.status)),
        h('div', { class: 'chips' }, b.category_ids.map(id => chip(`${catById(id)?.icon || ''} ${catName(catById(id))}`))),
        h('p', { class: 'small muted' }, t('biz.statusHelp.' + b.status)),
        h('div', { class: 'row wrap' },
          b.status === 'verified' ? h('a', { href: '#/demand', class: 'btn small primary' }, '🔥 ', t('nav.demand')) : null,
          h('button', { class: 'btn small', onclick: () => edit(b) }, '✎ ', t('common.edit')),
          h('a', { href: `#/business/${b.id}`, class: 'btn small ghost' }, t('biz.preview')),
          h('button', { class: 'btn small ghost danger', onclick: async () => {
            if (!await confirmDialog(t('biz.deleteQ', { name: b.name }), { ok: t('common.delete'), danger: true })) return;
            try { await db.deleteBusiness(b.id); await ctx.refresh(); toast(t('common.deleted')); myBusiness(main, _p, ctx); } catch (e) { errToast(e); }
          } }, t('common.delete')))));
    }
    if (canWrite()) page.append(h('button', { class: 'btn primary block', onclick: () => edit(null) }, '＋ ', t('biz.register')));
  };

  async function edit(b) {
    const services = state.categories.filter(c => c.kind === 'service' && (c.active || b?.category_ids.includes(c.id)));
    const chosen = new Set(b?.category_ids || []);
    const name = h('input', { required: true, minlength: 2, maxlength: 80, value: b?.name || '' });
    // ~100 services: chosen ones on top, then a search box and one fold per sector
    const chosenOut = h('div', { class: 'chips' });
    const catSearch = h('input', { type: 'search', placeholder: t('biz.searchCats'), oninput: () => paintCats() });
    const catList = h('div', { class: 'cat-groups' });
    const cats = h('div', { class: 'stack' }, chosenOut, catSearch, catList);
    const toggle = (c, on) => { on ? chosen.add(c.id) : chosen.delete(c.id); paintChosen(); };
    function paintChosen() {
      clear(chosenOut).append(...services.filter(c => chosen.has(c.id)).map(c => h('button', { type: 'button', class: 'chip-btn on', onclick: () => { toggle(c, false); paintCats(); } },
        c.icon, ' ', catName(c), ' ✕')));
      if (!chosen.size) chosenOut.append(h('small', { class: 'hint' }, t('err.pick_category')));
    }
    function paintCats() {
      const q = catSearch.value.trim();
      clear(catList);
      for (const [sec, icon] of SECTORS) {
        const list = services.filter(c => (c.sector || 'other') === sec && (!q || matches(q, c.name_ar, c.name_en, SEARCH_WORDS[c.key])));
        if (!list.length) continue;
        const n = list.filter(c => chosen.has(c.id)).length;
        catList.append(h('details', { class: 'cat-group', open: !!q || n > 0 },
          h('summary', null, icon, ' ', sectorName(sec), n ? h('span', { class: 'badge' }, fmtNum(n)) : null),
          h('div', { class: 'check-grid' }, list.map(c => h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: chosen.has(c.id), onchange: e => toggle(c, e.target.checked) }), c.icon, ' ', catName(c))))));
      }
    }
    paintChosen(); paintCats();
    const desc = h('textarea', { rows: 2, maxlength: 500, value: b?.description || '', placeholder: t('biz.descPh') });
    const phone = h('input', { type: 'tel', inputmode: 'tel', dir: 'ltr', required: true, value: b?.phone || state.membership.phone || '' });
    const wa = h('input', { type: 'tel', inputmode: 'tel', dir: 'ltr', value: b?.whatsapp ?? (b ? '' : state.membership.phone || ''), placeholder: t('common.optional') });
    const hours = h('input', { maxlength: 100, value: b?.hours || '', placeholder: t('biz.hoursPh') });
    const mobile = h('input', { type: 'checkbox', checked: !!b?.is_mobile });
    const mapBox = h('div');
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, b ? t('common.save') : t('biz.sendForVerify'));
    const form = h('form', { class: 'stack' },
      field(t('biz.name'), name), h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('biz.categories')), cats),
      field(t('biz.description'), desc), field(t('biz.phone'), phone), field(t('biz.whatsapp'), wa),
      h('label', { class: 'check big' }, mobile, t('biz.isMobile')),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('biz.location')), mapBox, h('small', { class: 'hint' }, t('biz.locationHint'))),
      field(t('biz.hours'), hours), btn,
      h('button', { type: 'button', class: 'btn ghost block', onclick: paintList }, t('common.cancel')));
    clear(page).append(h('h1', null, b ? t('biz.editTitle') : t('biz.register')),
      b ? null : h('p', { class: 'note' }, t('biz.verifyNote')), h('div', { class: 'card' }, form));
    window.scrollTo(0, 0);
    const picker = await locationPicker(mapBox, { value: b?.lat != null ? { lat: b.lat, lng: b.lng } : null, center: center(), emoji: '🏪' });
    form.onsubmit = async e => {
      e.preventDefault();
      try {
        if (!chosen.size) throw new Error('pick_category');
        const p = normPhone(phone.value), w = wa.value.trim() ? normPhone(wa.value) : null;
        if (!isPhone(p) || (w && !isPhone(w))) throw new Error('invalid_phone');
        const loc = picker.get();
        if (!mobile.checked && !loc) throw new Error('location_required');
        busy(btn, true);
        await db.saveBusiness(state.group.id, { id: b?.id, name: name.value, description: desc.value, phone: p, whatsapp: w,
          is_mobile: mobile.checked, lat: loc?.lat ?? null, lng: loc?.lng ?? null, hours: hours.value }, [...chosen]);
        await ctx.refresh();
        toast(b ? t('common.saved') : t('biz.sent'));
        if (location.hash === '#/my-business') myBusiness(main, _p, ctx); else go('#/my-business');
      } catch (err) { errToast(err); } finally { busy(btn, false); }
    };
  }
  paintList();
  if (query().get('new') === '1' && canWrite()) edit(null);
}

/* ---------------------------------------------------------------- demand */
const HEAT = ['#ffe08a', '#ffb347', '#ff7a45', '#e8412c', '#b3122e'];
const heatColor = n => HEAT[Math.min(HEAT.length - 1, Math.floor(Math.log2(n)))];

export async function demand(main) {
  const vb = verifiedBusinesses();
  if (!vb.length) {
    clear(main).append(h('section', { class: 'page' }, empty('🔥', t('dem.noBizTitle'), t('dem.noBizHelp'), h('a', { href: '#/my-business', class: 'btn primary' }, t('biz.register')))));
    return;
  }
  const gid = state.group.id;
  let biz = vb.find(b => b.id === localStorage.getItem('vg-biz')) || vb[0];
  let tab = query().get('tab') === 'jobs' ? 'jobs' : 'map', hours = 48;
  let destroyMap = null;
  const top = h('div', { class: 'demand-top' });
  const body = h('div', { class: 'demand-body' });
  clear(main).append(h('section', { class: 'page wide' }, top, body));

  async function paint() {
    destroyMap?.(); destroyMap = null;
    const [rows, jobs] = await Promise.all([db.openDemand(gid, biz.id, hours), db.myJobs(biz.id)]);
    const active = jobs.filter(j => j.status === 'accepted');
    clear(top).append(
      h('div', { class: 'row between wrap' }, h('h1', null, '🔥 ', t('dem.title')),
        vb.length > 1 ? h('select', { 'aria-label': t('dem.business'), onchange: e => { biz = vb.find(b => b.id === e.target.value); localStorage.setItem('vg-biz', biz.id); paint(); } },
          vb.map(b => h('option', { value: b.id, selected: b.id === biz.id }, b.name))) : h('span', { class: 'muted' }, biz.name)),
      h('div', { class: 'seg' },
        h('button', { type: 'button', class: 'seg-btn' + (tab === 'map' ? ' on' : ''), onclick: () => { tab = 'map'; paint(); } }, t('dem.tabMap'), ` (${fmtNum(rows.length)})`),
        h('button', { type: 'button', class: 'seg-btn' + (tab === 'jobs' ? ' on' : ''), onclick: () => { tab = 'jobs'; paint(); } }, t('dem.tabJobs'), ` (${fmtNum(active.length)})`)));
    clear(body);
    if (tab === 'map') destroyMap = await demandMap(body, rows);
    else destroyMap = await jobsView(body, jobs);
  }

  async function demandMap(el, rows) {
    // group rows into cells
    const cells = new Map();
    for (const r of rows) {
      const k = `${r.cell_lat},${r.cell_lng}`;
      if (!cells.has(k)) cells.set(k, { lat: r.cell_lat, lng: r.cell_lng, rows: [] });
      cells.get(k).rows.push(r);
    }
    const qtySum = rows.reduce((s, r) => s + r.quantity, 0);
    const hoursBar = h('div', { class: 'chips' }, [[24, t('dem.h24')], [48, t('dem.h48')], [168, t('dem.d7')]].map(([v, l]) =>
      h('button', { type: 'button', class: 'chip-btn' + (v === hours ? ' on' : ''), onclick: () => { hours = v; paint(); } }, l)));
    const summary = h('p', { class: 'muted' }, rows.length ? t('dem.summary', { n: fmtNum(rows.length), q: fmtNum(qtySum), c: fmtNum(cells.size) }) : t('dem.none'));
    const mapEl = h('div', { class: 'map map-demand' });
    const legend = h('div', { class: 'legend' }, h('span', null, t('dem.fewer')), HEAT.map(c => h('i', { style: `background:${c}` })), h('span', null, t('dem.more')));
    const cellList = h('div', { class: 'list' });
    el.append(hoursBar, summary, mapEl, legend, h('p', { class: 'hint privacy' }, '🔒 ', t('dem.privacy')),
      cells.size ? h('h2', { class: 'section-title' }, t('dem.areas')) : null, cellList);

    const { L, map } = await makeMap(mapEl, { center: center(), zoom: state.group.zoom || 16 });
    const here = state.here;
    const sorted = [...cells.values()].sort((a, b) => b.rows.length - a.rows.length);
    sorted.forEach((c, i) => { c.n = i + 1; });
    const iconOf = r => catById(r.category_id)?.icon || '';
    for (const c of sorted) {
      const n = c.rows.length, half = CELL / 2;
      const rect = L.rectangle([[c.lat - half, c.lng - half], [c.lat + half, c.lng + half]],
        { color: heatColor(n), weight: 1, fillColor: heatColor(n), fillOpacity: 0.55 }).addTo(map);
      const lbl = L.marker([c.lat, c.lng], { icon: countIcon(L, fmtNum(n), new Set(c.rows.map(iconOf)).size === 1 ? iconOf(c.rows[0]) : '') }).addTo(map);
      rect.on('click', () => openCell(c)); lbl.on('click', () => openCell(c));
      const dist = here ? distanceKm(here, c) : null;
      cellList.append(h('button', { type: 'button', class: 'list-item', onclick: () => openCell(c) },
        h('span', { class: 'li-icon heat', style: `background:${heatColor(n)}` }, fmtNum(n)),
        h('div', { class: 'li-main' }, h('strong', null, t('dem.area', { n: fmtNum(c.n) })),
          h('small', null, [summarize(c.rows), dist != null ? fmtDistance(dist) : null].filter(Boolean).join(sep()))),
        h('span', { class: 'chev' }, '›')));
    }
    if (sorted.length) map.fitBounds(sorted.map(c => [c.lat, c.lng]), { padding: [30, 30], maxZoom: 16 });
    if (!cells.size) cellList.append(empty('😌', t('dem.noneTitle'), t('dem.noneHelp')));

    function openCell(c) {
      const ids = c.rows.map(r => r.id);
      const m = modal(t('dem.area', { n: fmtNum(c.n) }), h('div', { class: 'stack' },
        h('p', { class: 'muted' }, t('dem.cellHelp')),
        h('div', { class: 'list' }, c.rows.sort((a, b) => a.created_at.localeCompare(b.created_at)).map(r => h('div', { class: 'list-item' },
          h('span', { class: 'li-icon' }, iconOf(r)),
          h('div', { class: 'li-main' }, h('strong', null, catName(catById(r.category_id)), r.quantity > 1 ? ` × ${fmtNum(r.quantity)}` : ''),
            h('small', null, [r.details, timeAgo(r.created_at), r.needed_by ? t('dem.neededBy', { d: fmtDate(r.needed_by) }) : null].filter(Boolean).join(sep()))),
          h('button', { class: 'btn small', onclick: () => accept([r.id], m) }, t('dem.accept')))))),
      [{ label: t('common.close') }, { label: t('dem.acceptAll', { n: fmtNum(ids.length) }), kind: 'primary', onClick: () => accept(ids, m) }]);
    }
    async function accept(ids, m) {
      try {
        const n = await db.acceptRequests(biz.id, ids);
        toast(n ? t('dem.accepted', { n: fmtNum(n) }) : t('dem.alreadyTaken'), n ? 'ok' : 'err');
        m.close(); tab = n ? 'jobs' : tab; paint();
      } catch (e) { errToast(e); }
      return false;
    }
    return () => map.remove();
  }

  async function jobsView(el, jobs) {
    const active = jobs.filter(j => j.status === 'accepted');
    const done = jobs.filter(j => j.status === 'delivered').sort((a, b) => b.delivered_at.localeCompare(a.delivered_at));
    if (!active.length) {
      el.append(empty('📦', t('dem.noJobs'), t('dem.noJobsHelp'), h('button', { class: 'btn', onclick: () => { tab = 'map'; paint(); } }, t('dem.tabMap'))));
    }
    // nearest-next route starting from my position (or the village centre)
    const startAt = state.here || center();
    const route = [], left = [...active];
    let cur = startAt;
    while (left.length) {
      left.sort((a, b) => distanceKm(cur, a) - distanceKm(cur, b));
      const nx = left.shift(); route.push(nx); cur = nx;
    }
    const mapEl = active.length ? h('div', { class: 'map map-demand' }) : null;
    const list = h('div', { class: 'list' });
    if (active.length) el.append(h('div', { class: 'row between wrap' }, h('p', { class: 'muted' }, t('dem.routeHelp')),
      h('button', { class: 'btn small', onclick: async () => { const p = await locate(); if (p) paint(); else toast(t('loc.gpsFailed'), 'err'); } }, '📍 ', t('dem.fromHere'))), mapEl, list);
    route.forEach((j, i) => {
      const c = catById(j.category_id);
      list.append(h('div', { class: 'list-item col' },
        h('div', { class: 'row' }, h('span', { class: 'li-icon num' }, fmtNum(i + 1)),
          h('div', { class: 'li-main' }, h('strong', null, `${c?.icon || ''} ${catName(c)}`, j.quantity > 1 ? ` × ${fmtNum(j.quantity)}` : '', ' — ', j.contact_name),
            h('small', null, [j.location_note, j.details, timeAgo(j.created_at)].filter(Boolean).join(sep())))),
        h('div', { class: 'row wrap' },
          j.contact_phone ? h('a', { href: telLink(j.contact_phone), class: 'btn small' }, '📞 ', t('common.call')) : null,
          j.contact_phone ? h('a', { href: waLink(j.contact_phone, t('dem.waOnWay', { biz: biz.name })), class: 'btn small', target: '_blank', rel: 'noopener' }, '💬') : null,
          h('a', { href: `https://www.google.com/maps/dir/?api=1&destination=${j.lat},${j.lng}`, class: 'btn small', target: '_blank', rel: 'noopener' }, '🧭 ', t('dem.navigate')),
          h('button', { class: 'btn small primary', onclick: async () => {
            try { await db.deliverRequest(j.id); toast(t('dem.delivered')); paint(); } catch (e) { errToast(e); }
          } }, '✔ ', t('dem.markDelivered')),
          h('button', { class: 'btn small ghost', onclick: async () => {
            if (!await confirmDialog(t('dem.releaseQ'), { ok: t('dem.release') })) return;
            try { await db.releaseRequest(j.id); toast(t('dem.released')); paint(); } catch (e) { errToast(e); }
          } }, t('dem.release')))));
    });
    if (done.length) el.append(h('details', { class: 'card' }, h('summary', null, t('dem.doneWeek', { n: fmtNum(done.length) })),
      h('div', { class: 'list' }, done.map(j => h('div', { class: 'list-item' }, h('span', { class: 'li-icon' }, catById(j.category_id)?.icon || '✔'),
        h('div', { class: 'li-main' }, h('strong', null, j.contact_name), h('small', null, [catName(catById(j.category_id)), fmtDate(j.delivered_at)].join(sep()))))))));
    if (!mapEl) return null;
    const { L, map } = await makeMap(mapEl, { center: startAt, zoom: 16 });
    const line = [[startAt.lat, startAt.lng]];
    if (state.here) L.circleMarker([startAt.lat, startAt.lng], { radius: 8, color: '#1e88e5', fillOpacity: 0.9 }).addTo(map);
    route.forEach((j, i) => {
      L.marker([j.lat, j.lng], { icon: L.divIcon({ className: 'pin num', html: `<span>${fmtNum(i + 1)}</span>`, iconSize: [36, 44], iconAnchor: [18, 44] }) }).addTo(map)
        .bindPopup(`${fmtNum(i + 1)}. ${(j.contact_name || '').replace(/[<>&"]/g, '')}`);
      line.push([j.lat, j.lng]);
    });
    L.polyline(line, { color: '#c2502e', weight: 3, dashArray: '6 6' }).addTo(map);
    map.fitBounds(line, { padding: [30, 30], maxZoom: 17 });
    return () => map.remove();
  }

  function summarize(rows) {
    const by = {};
    for (const r of rows) by[r.category_id] = (by[r.category_id] || 0) + r.quantity;
    return Object.entries(by).map(([cid, q]) => `${catById(cid)?.icon || ''} ${fmtNum(q)}`).join('  ');
  }

  if (!state.here) locate();
  await paint();
  return () => destroyMap?.();
}
