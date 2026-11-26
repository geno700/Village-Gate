// New village, for the mayor: 1) find the village on the map and choose its size, 2) build it in 3D
// from OpenStreetMap and choose which landmarks to add, 3) your details. Then the village is created,
// the 3D map is stored with it, and the landmarks become places in the village guide.
import { db } from './data.js';
import { state, go } from './state.js';
import { t, getLang } from './i18n.js';
import { h, clear, field, toast, errToast, busy, fmtNum, spinner } from './ui.js';
import { locationPicker } from './map.js';
import { mountScene } from './scene3d.js';
import { searchVillage, nameAt, fetchVillageMap, mapStats, synthHouses } from './osm.js';
import { AREA_SIZES, PLACES, inEgypt } from './shared.js';
import { personFields } from './views-auth.js';

const PLACE_INFO = Object.fromEntries(PLACES.map(([key, icon, en, ar]) => [key, { icon, en, ar }]));
const placeLabel = key => PLACE_INFO[key]?.[getLang()] || key;

/** Landmarks from a village map, ready for db.importPlaces (unnamed ones get their category name). */
export const landmarksOf = map => (map?.p || []).filter(p => inEgypt(p[2], p[3]))
  .map(([key, name, lat, lng, osm_ref]) => ({ key, name: name || placeLabel(key), lat, lng, osm_ref }));

/** Appends a "3D preview + stats" block to `parent` (here and in the Mayor's office). Returns { el, destroy, houses }. */
export async function mapPreview(parent, map, center) {
  const stage = h('div', { class: 'scene-stage preview' });
  const houses = (map.b?.length || 0) + synthHouses(map).length;
  const st = mapStats(map);
  const el = h('div', { class: 'stack' }, stage,
    h('p', { class: 'map-stats' }, t('setup.found', { roads: fmtNum(st.roadsKm), canals: fmtNum(st.canals), houses: fmtNum(houses) })),
    (map.b?.length || 0) < 60 ? h('p', { class: 'hint' }, t('setup.houseNote')) : null,
    h('p', { class: 'hint attribution' }, '© OpenStreetMap'));
  parent.append(el);
  const points = landmarksOf(map).map(p => ({ id: p.osm_ref, lat: p.lat, lng: p.lng, icon: PLACE_INFO[p.key]?.icon, label: p.name, kind: 'place', model: p.key }));
  const destroy = await mountScene(stage, { center, map, points, mode: 'full' });
  return { el, destroy, houses };
}

export async function setup(main, _p, ctx) {
  const S = { center: null, radius: 1000, name: '', nameTyped: false, map: null, importPlaces: true };
  let cleanup = null;
  const page = h('section', { class: 'page setup' });
  clear(main).append(page);
  const head = (n, title, help) => [
    h('p', { class: 'step-of' }, t('setup.stepOf', { n: fmtNum(n), of: fmtNum(3) })),
    h('h1', null, title), help ? h('p', { class: 'muted' }, help) : null];
  const leave = () => { cleanup?.(); cleanup = null; };

  /* ---------------- 1. where is the village? ---------------- */
  async function step1() {
    leave();
    const q = h('input', { type: 'search', required: true, minlength: 2, placeholder: t('setup.searchPh'), enterkeyhint: 'search' });
    const searchBtn = h('button', { class: 'btn primary', type: 'submit' }, '🔍 ', t('setup.search'));
    const results = h('div', { class: 'list results' });
    const mapBox = h('div');
    const vname = h('input', { required: true, minlength: 2, maxlength: 80, value: S.name, placeholder: t('start.villageNamePh'),
      oninput: () => { S.name = vname.value; S.nameTyped = true; } });
    const sizeBtns = AREA_SIZES.map(([key, m]) => h('button', { type: 'button', class: 'seg-btn' + (m === S.radius ? ' on' : ''), role: 'radio',
      'aria-checked': String(m === S.radius), onclick: () => setRadius(m) }, t('setup.size.' + key)));
    const buildBtn = h('button', { class: 'btn primary block big', type: 'button' }, '🏗️ ', t('setup.build'));

    clear(page).append(...head(1, t('setup.step1'), t('setup.step1Help')),
      h('form', { class: 'row search-row', onsubmit: async e => {
        e.preventDefault();
        if (q.value.trim().length < 2) return;
        busy(searchBtn, true); clear(results).append(h('p', { class: 'hint' }, t('setup.searching')));
        try {
          const rows = await searchVillage(q.value, getLang());
          clear(results);
          if (!rows.length) results.append(h('p', { class: 'note warn' }, t('setup.noResults')));
          for (const r of rows) results.append(h('button', { type: 'button', class: 'list-item', onclick: () => {
            if (!picker) return;
            if (!S.nameTyped) { S.name = r.name; vname.value = r.name; }
            picker.set({ lat: r.lat, lng: r.lng }); clear(results);
          } }, h('span', { class: 'li-icon' }, '📍'), h('div', { class: 'li-main' }, h('strong', null, r.name), h('small', null, r.area))));
        } catch (err) { clear(results); errToast(err); } finally { busy(searchBtn, false); }
      } }, q, searchBtn),
      results,
      mapBox,
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('setup.size')), h('div', { class: 'seg', role: 'radiogroup' }, sizeBtns),
        h('small', { class: 'hint' }, t('setup.sizeHelp'))),
      field(t('start.villageName'), vname),
      buildBtn);

    let circle = null, nameTimer = 0, picker = null;
    const L = await import('./map.js').then(m => m.loadLeaflet());
    const fit = () => { if (circle) picker.map.fitBounds(circle.getBounds(), { padding: [12, 12] }); };
    const onCenter = pos => {
      S.center = pos;
      if (!circle) circle = L.circle([pos.lat, pos.lng], { radius: S.radius, color: '#c2502e', weight: 2, fillOpacity: 0.08 }).addTo(picker.map);
      else circle.setLatLng([pos.lat, pos.lng]);
      setTimeout(fit, 0);
      if (!S.nameTyped) {
        clearTimeout(nameTimer);
        nameTimer = setTimeout(async () => { const n = await nameAt(pos.lat, pos.lng, getLang()); if (n && !S.nameTyped) { S.name = n; vname.value = n; } }, 700);
      }
    };
    picker = await locationPicker(mapBox, { value: S.center, center: S.center || { lat: 30.8, lng: 31.0 }, zoom: 7, emoji: '📍', onChange: onCenter });
    picker.map.getContainer().classList.add('map-md');
    if (S.center) onCenter(S.center);
    function setRadius(m) {
      S.radius = m;
      sizeBtns.forEach((b, i) => { const on = AREA_SIZES[i][1] === m; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      if (circle) { circle.setRadius(m); fit(); }
    }
    buildBtn.onclick = () => {
      try {
        if (!S.center) throw new Error('center_required');
        if (!inEgypt(S.center.lat, S.center.lng)) throw new Error('invalid_location');
        S.name = vname.value.trim();
        if (S.name.length < 2) { vname.focus(); throw new Error('invalid_name'); }
        step2();
      } catch (err) { errToast(err); }
    };
  }

  /* ---------------- 2. build it in 3D ---------------- */
  async function step2() {
    leave();
    const status = h('p', { class: 'build-status' }, spinner(), ' ', t('setup.reading'));
    const body = h('div', { class: 'stack' }, status);
    clear(page).append(...head(2, t('setup.step2'), S.name), body);
    let alive = true;
    cleanup = () => { alive = false; };
    try {
      const key = `${S.center.lat},${S.center.lng},${S.radius}`;
      const map = S.map && S.mapKey === key ? S.map : await fetchVillageMap(S.center, S.radius, step => {
        if (!alive) return;
        status.lastChild.textContent = ' ' + t(step === 'busy' ? 'setup.busyRetry' : step === 'build' ? 'setup.building' : 'setup.reading');
      });
      if (!alive) return;
      S.map = map; S.mapKey = key;
      clear(body);
      const prev = await mapPreview(body, map, S.center);
      if (!alive) { prev.destroy(); return; }
      cleanup = () => { alive = false; prev.destroy(); };
      const marks = landmarksOf(map);
      const counts = {};
      for (const p of marks) counts[p.key] = (counts[p.key] || 0) + 1;
      const check = h('input', { type: 'checkbox', checked: S.importPlaces, onchange: e => { S.importPlaces = e.target.checked; } });
      body.append(
        marks.length ? h('div', { class: 'card' }, h('h2', null, t('setup.landmarks')),
          h('div', { class: 'chips' }, Object.entries(counts).map(([k, n]) => h('span', { class: 'chip' }, PLACE_INFO[k]?.icon, ' ', placeLabel(k), n > 1 ? ` × ${fmtNum(n)}` : ''))),
          h('label', { class: 'check' }, check, ' ', t('setup.importPlaces', { n: fmtNum(marks.length) })))
          : h('p', { class: 'note' }, t('setup.noLandmarks')),
        h('div', { class: 'row gap' },
          h('button', { type: 'button', class: 'btn', onclick: step1 }, t('setup.changePlace')),
          h('button', { type: 'button', class: 'btn primary grow', onclick: step3 }, t('setup.looksRight'))));
    } catch (err) {
      if (!alive) return;
      console.warn(err);
      S.map = null;
      clear(body).append(h('p', { class: 'note warn' }, t('setup.failed')),
        h('div', { class: 'row gap wrap' },
          h('button', { type: 'button', class: 'btn', onclick: step1 }, t('setup.changePlace')),
          h('button', { type: 'button', class: 'btn primary', onclick: step2 }, t('common.retry')),
          h('button', { type: 'button', class: 'btn ghost', onclick: step3 }, t('setup.continueSimple'))));
    }
  }

  /* ---------------- 3. about you, then create ---------------- */
  async function step3() {
    leave();
    const box = h('div', { class: 'stack' });
    const btn = h('button', { class: 'btn primary block big', type: 'submit' }, t('start.create'));
    const form = h('form', { class: 'stack' }, box, btn);
    clear(page).append(...head(3, t('setup.step3'), S.name),
      h('div', { class: 'card' }, form),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => (S.map ? step2() : step1()) }, t('common.back')));
    const person = await personFields(box, { center: S.center });
    form.onsubmit = async e => {
      e.preventDefault();
      try {
        const p = person.read();
        busy(btn, true);
        const id = await db.createGroup({ name: S.name, center_lat: S.center.lat, center_lng: S.center.lng, radius_m: S.radius, ...p });
        localStorage.setItem('vg-group', id);
        if (S.map) {
          try {
            await db.saveVillageMap(id, S.map);
            const marks = landmarksOf(S.map);
            if (S.importPlaces && marks.length) {
              const n = await db.importPlaces(id, marks);
              if (n) toast(t('admin.placesAdded', { n: fmtNum(n) }));
            }
          } catch (err) { errToast(err); } // the village exists; the map can be built again from the Mayor's office
        }
        if (!state.profile?.phone) db.saveProfile({ phone: p.phone }).catch(() => {});
        await ctx.refresh();
        toast(t('start.created')); go('#/admin/invite');
      } catch (err) { errToast(err); busy(btn, false); }
    };
  }

  await step1();
  return () => leave();
}
