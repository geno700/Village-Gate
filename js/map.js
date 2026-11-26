// Leaflet + OpenStreetMap helpers (Leaflet is loaded lazily from a pinned CDN URL).
import { h } from './ui.js';
import { t } from './i18n.js';
import { locate, state } from './state.js';

const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';
let loading;
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return loading ||= new Promise((resolve, reject) => {
    document.head.append(h('link', { rel: 'stylesheet', href: LEAFLET + 'leaflet.css', crossorigin: '' }));
    const s = h('script', { src: LEAFLET + 'leaflet.js', crossorigin: '' });
    s.onload = () => resolve(window.L);
    s.onerror = () => { loading = null; reject(new Error('map_load_failed')); };
    document.head.append(s);
  });
}

/** Creates a map inside `el` (a fixed-height div). Returns { L, map }. */
export async function makeMap(el, { center, zoom = 16 }) {
  const L = await loadLeaflet();
  el.setAttribute('dir', 'ltr');
  const map = L.map(el, { zoomControl: true, attributionControl: true, tap: true }).setView([center.lat, center.lng], zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe(el);
  map.on('unload', () => ro.disconnect());
  return { L, map };
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Round pin with an emoji. `cls` picks the color (place | biz | home | req). */
export function pinIcon(L, emoji, cls = '') {
  return L.divIcon({ className: `pin ${cls}`, html: `<span>${esc(emoji || '•')}</span>`, iconSize: [36, 44], iconAnchor: [18, 44], popupAnchor: [0, -40] });
}
export function countIcon(L, n, emoji) {
  return L.divIcon({ className: 'cell-count', html: `<span>${esc(emoji || '')}${esc(n)}</span>`, iconSize: [44, 26], iconAnchor: [22, 13] });
}

/**
 * A map where the user drops one pin. Returns { get(), set(), map }.
 * Tap the map to move the pin; the pin can also be dragged. "My location" uses GPS.
 */
export async function locationPicker(el, { value, center, zoom = 16, emoji = '🏠', onChange } = {}) {
  const wrap = h('div', { class: 'picker' });
  const mapEl = h('div', { class: 'map map-sm' });
  const status = h('small', { class: 'hint' }, value ? t('loc.set') : t('loc.tapMap'));
  const gpsBtn = h('button', { type: 'button', class: 'btn small' }, '📍 ', t('loc.useGps'));
  wrap.append(mapEl, h('div', { class: 'picker-bar' }, gpsBtn, status));
  el.append(wrap);
  const start = value || center || state.here || { lat: 30.8, lng: 31.0 };
  const { L, map } = await makeMap(mapEl, { center: start, zoom: value ? 17 : zoom });
  let pos = value ? { ...value } : null, marker = null;
  const put = (ll, pan) => {
    pos = { lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) };
    if (!marker) {
      marker = L.marker([pos.lat, pos.lng], { draggable: true, icon: pinIcon(L, emoji, 'home') }).addTo(map);
      marker.on('dragend', () => put(marker.getLatLng()));
    } else marker.setLatLng([pos.lat, pos.lng]);
    if (pan) map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), 17));
    status.textContent = t('loc.set');
    onChange?.(pos);
  };
  if (pos) put(pos);
  map.on('click', e => put(e.latlng));
  gpsBtn.onclick = async () => {
    gpsBtn.disabled = true; status.textContent = t('loc.finding');
    const here = await locate();
    gpsBtn.disabled = false;
    if (here) put(here, true); else status.textContent = t('loc.gpsFailed');
  };
  return { get: () => pos, set: ll => put(ll, true), map };
}
