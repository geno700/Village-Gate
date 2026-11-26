// Add a place to the village guide in a few taps: pick its type from big icons, drop the pin, done.
// The mayor's places go straight in; a resident's place is a suggestion the mayor approves in the Mayor's office.
import { db } from './data.js';
import { state, isAdmin, canWrite, catById, center, go, query } from './state.js';
import { t, catName } from './i18n.js';
import { h, clear, field, toast, errToast, busy, timeAgo, sep, normPhone, isPhone, statusChip } from './ui.js';
import { locationPicker } from './map.js';

const homeOf = () => state.membership?.home_lat != null ? { lat: state.membership.home_lat, lng: state.membership.home_lng } : null;

export async function addPlace(main) {
  const gid = state.group.id, admin = isAdmin();
  if (!canWrite()) { go('#/'); return; }
  const types = state.categories.filter(c => c.kind === 'place' && c.active);
  let chosen = catById(query().get('cat')) || null, picker = null;

  const tiles = h('div', { class: 'tiles place-types', role: 'radiogroup', 'aria-label': t('place.what') });
  const paintTiles = () => {
    clear(tiles).append(...types.map(c => h('button', { type: 'button', class: 'tile' + (chosen?.id === c.id ? ' on' : ''), role: 'radio',
      'aria-checked': String(chosen?.id === c.id), onclick: () => { chosen = c; paintTiles(); name.placeholder = catName(c); picker?.setEmoji?.(c.icon); } },
    h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, c.icon), h('span', { class: 'tile-label' }, catName(c)))));
  };
  const name = h('input', { maxlength: 80, placeholder: chosen ? catName(chosen) : t('place.namePh') });
  const note = h('input', { maxlength: 300, placeholder: t('place.notePh') });
  const phone = h('input', { type: 'tel', inputmode: 'tel', dir: 'ltr', placeholder: t('common.optional') });
  const mapBox = h('div');
  const btn = h('button', { type: 'submit', class: 'btn primary block big' }, admin ? t('place.add') : t('place.send'));
  const mine = h('div');
  const form = h('form', { class: 'stack' },
    h('h2', { class: 'section-title' }, '1. ', t('place.what')), tiles,
    h('h2', { class: 'section-title' }, '2. ', t('place.where')), mapBox,
    h('h2', { class: 'section-title' }, '3. ', t('place.details')),
    field(t('place.name'), name, t('place.nameHint')),
    field(t('csv.note'), note),
    admin ? field(t('csv.phone'), phone) : null,
    admin ? null : h('p', { class: 'note' }, '🛡️ ', t('place.reviewNote')),
    btn);
  clear(main).append(h('section', { class: 'page stack' },
    h('h1', null, admin ? t('place.addTitle') : t('place.suggestTitle')),
    h('p', { class: 'muted' }, admin ? t('place.addHelp') : t('place.suggestHelp')),
    h('div', { class: 'card' }, form), mine));
  paintTiles();

  picker = await locationPicker(mapBox, { center: homeOf() || center(), zoom: 17, emoji: chosen?.icon || '📍' });
  form.onsubmit = async e => {
    e.preventDefault();
    try {
      if (!chosen) { tiles.scrollIntoView({ block: 'center' }); throw new Error('pick_type'); }
      const ll = picker.get(); if (!ll) { mapBox.scrollIntoView({ block: 'center' }); throw new Error('location_required'); }
      const nm = name.value.trim() || catName(chosen);
      busy(btn, true);
      if (admin) {
        const ph = phone.value.trim() ? normPhone(phone.value) : null; if (ph && !isPhone(ph)) throw new Error('invalid_phone');
        await db.savePlace(gid, { name: nm, category_id: chosen.id, phone: ph, note: note.value, lat: ll.lat, lng: ll.lng });
        toast(t('place.added'));
      } else {
        await db.suggestPlace(gid, { name: nm, category_id: chosen.id, note: note.value, lat: ll.lat, lng: ll.lng });
        toast(t('place.sent'));
      }
      go('#/map');
    } catch (err) { errToast(err); busy(btn, false); }
  };

  // my suggestions still waiting for the mayor
  if (!admin) {
    const waiting = await db.listPlaceSuggestions(gid).catch(() => []);
    if (waiting.length) mine.append(h('h2', { class: 'section-title' }, t('place.myWaiting')),
      h('div', { class: 'list' }, waiting.map(p => h('div', { class: 'list-item' }, h('span', { class: 'li-icon place' }, catById(p.category_id)?.icon || '📍'),
        h('div', { class: 'li-main' }, h('strong', null, p.name), h('small', null, [catName(catById(p.category_id)), timeAgo(p.created_at)].filter(x => x !== p.name).join(sep()))),
        statusChip('pending')))));
  }
  return () => picker.map.remove();
}
