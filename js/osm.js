// Real-world village data from OpenStreetMap: find a village by name (Nominatim), read its roads,
// canals, fields, built-up areas, buildings and landmarks (Overpass), and turn them into a small
// "village map" object that scene3d.js draws in 3D. Built once by the mayor and stored with the
// village, so residents never call these services.
//
// Village map format (all coordinates are metres from the centre, x = east, y = north, integers):
// { v: 1, lat, lng, r, rg, at, src: 'osm',
//   b:  [[heightDm, x0, y0, x1, y1, ...]]   building footprints (heightDm 0 = unknown)
//   rd: [[widthM, x0, y0, ...]]              roads
//   wl: [[widthM, x0, y0, ...]]              rivers, canals, drains
//   wa: [[x0, y0, ...]]                      water areas
//   l:  [[type, x0, y0, ...]]                land use: r residential, f farmland, o orchard, g green, c cemetery, i industrial
//   p:  [[categoryKey, name, lat, lng, osmRef]] landmarks that match a place category }
import { RADIUS } from './shared.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
export const GROUND_FACTOR = 1.6; // roads and fields are read this far beyond the village radius

/* ------------------------------------------------------------------ village search */
const placeName = (r, lang) => r.namedetails?.[`name:${lang}`] || r.name || r.display_name?.split(',')[0] || '';
/** Search villages and towns in Egypt by name. Call on submit only (Nominatim allows 1 request a second). */
export async function searchVillage(q, lang = 'ar') {
  const ready = await readyMatches(q, lang);
  const u = `${NOMINATIM}/search?format=jsonv2&countrycodes=eg&limit=8&namedetails=1&accept-language=${lang}&q=${encodeURIComponent(q.trim())}`;
  let rows;
  try {
    const res = await fetch(u, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('map_busy');
    rows = await res.json();
  } catch (e) { if (ready.length) return ready; throw e; }
  return ready.concat(rows.map(r => ({
    name: placeName(r, lang),
    area: r.display_name.split(',').slice(1, 3).map(s => s.trim()).filter(Boolean).join(lang === 'ar' ? '، ' : ', '),
    lat: +r.lat, lng: +r.lon, type: r.addresstype || r.type,
  })));
}

/* Ready-made villages (data/maps/index.json) come first in the search: OpenStreetMap often has no name for them. */
let readyList = null;
const readyIndex = () => readyList ??= fetch('./data/maps/index.json').then(r => r.ok ? r.json() : []).catch(() => []);
const normWord = s => String(s || '').toLowerCase().replace(/[ً-ْـ]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/^(al-|el-|ال)/, '');
const words = s => String(s || '').split(/[\s,،\-]+/).map(normWord).filter(w => w.length >= 2);
async function readyMatches(q, lang) {
  const qw = words(q), skip = new Set(['قريه', 'village', 'عزبه', 'kafr', 'كفر']);
  const key = qw.filter(w => !skip.has(w));
  if (!key.length) return [];
  return (await readyIndex()).filter(m => {
    const names = words(`${m.name_ar} ${m.name_en}`);
    return key.some(w => names.some(n => n === w || (w.length >= 3 && n.startsWith(w))));
  }).map(m => ({ name: lang === 'ar' ? m.name_ar : m.name_en, area: lang === 'ar' ? m.area : (m.area_en || m.area), lat: m.lat, lng: m.lng, type: 'village', ready: true }));
}
/** Name of the village around a point (to prefill the village name after tapping the map). */
export async function nameAt(lat, lng, lang = 'ar') {
  try {
    const res = await fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=14&namedetails=1&accept-language=${lang}&lat=${lat}&lon=${lng}`);
    if (!res.ok) return '';
    const r = await res.json();
    const a = r.address || {};
    return a.village || a.hamlet || a.suburb || a.town || a.neighbourhood || placeName(r, lang);
  } catch { return ''; }
}

/* ------------------------------------------------------------------ Overpass */
export function overpassQuery(lat, lng, r) {
  const rg = Math.round(r * GROUND_FACTOR), A = (rad) => `(around:${rad},${lat},${lng})`;
  return `[out:json][timeout:90];
(
  way["building"]${A(r)};
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track|pedestrian|road|footway|path)$"]${A(rg)};
  way["waterway"~"^(river|canal|stream|drain|ditch)$"]${A(rg)};
  way["natural"="water"]${A(rg)};
  way["landuse"~"^(residential|farmland|farmyard|orchard|meadow|grass|cemetery|industrial|commercial|retail|religious)$"]${A(rg)};
  way["leisure"~"^(park|garden|pitch|stadium|sports_centre)$"]${A(rg)};
  way["place"~"^(village|hamlet|neighbourhood|isolated_dwelling)$"]${A(rg)};
);
out geom qt;
(
  nwr["amenity"~"^(place_of_worship|hospital|clinic|doctors|pharmacy|school|kindergarten|college|post_office|bank|atm|police|fire_station|townhall|courthouse|marketplace|fuel|bus_station|veterinary|grave_yard|bakery)$"]${A(r)};
  nwr["office"="government"]${A(r)};
  nwr["healthcare"]${A(r)};
  nwr["shop"="bakery"]${A(r)};
  nwr["leisure"~"^(sports_centre|stadium|park)$"]["name"]${A(r)};
  nwr["landuse"="cemetery"]${A(r)};
  nwr["shop"]["name"]${A(r)};
  nwr["craft"]["name"]${A(r)};
  nwr["office"]["name"]${A(r)};
  nwr["amenity"~"^(restaurant|cafe|fast_food|car_repair|internet_cafe|dentist)$"]["name"]${A(r)};
);
out center tags qt;`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function overpass(query, onStep) {
  let wait = 2000;
  for (let round = 0; round < 2; round++) {
    for (const ep of OVERPASS) {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 75000);
      try {
        onStep?.('read');
        const res = await fetch(ep, { method: 'POST', body: new URLSearchParams({ data: query }), signal: ctl.signal });
        if (res.ok) {
          const text = await res.text();
          if (text.trimStart().startsWith('{')) return JSON.parse(text);
        }
      } catch (e) { console.warn('overpass', ep, e.message); } finally { clearTimeout(timer); }
    }
    onStep?.('busy');
    await sleep(wait); wait *= 3;
  }
  throw new Error('map_busy');
}

/**
 * Ready-made maps shipped with the app (data/maps/index.json): villages whose building outlines were
 * prepared from Overture Maps (open data that includes Google and Microsoft building outlines).
 * If the chosen centre is close to one, that map is used instead of reading OpenStreetMap live.
 */
async function bundledMap(lat, lng) {
  try {
    const list = await readyIndex();
    const kx = 111320 * Math.cos(lat * Math.PI / 180);
    const hit = list.find(m => Math.hypot((m.lng - lng) * kx, (m.lat - lat) * 110540) < (m.match_m || 700));
    return hit ? await fetch('./data/maps/' + hit.file).then(r => r.ok ? r.json() : null) : null;
  } catch { return null; }
}

/** Download and build the village map. Throws 'map_busy' when every map server refuses. */
export async function fetchVillageMap({ lat, lng }, r = RADIUS.default, onStep) {
  r = Math.max(RADIUS.min, Math.min(RADIUS.max, Math.round(r)));
  const ready = await bundledMap(lat, lng);
  if (ready) { onStep?.('build'); return { ...ready, at: new Date().toISOString() }; }
  const json = await overpass(overpassQuery(lat, lng, r), onStep);
  onStep?.('build');
  return processOverpass(json, { lat, lng }, r);
}

/* ------------------------------------------------------------------ processing (pure, also used by tools) */
const ROAD_W = { motorway: 14, trunk: 12, primary: 10, secondary: 8, tertiary: 7, unclassified: 5, residential: 5, living_street: 4, road: 5, service: 4, pedestrian: 4, track: 3, footway: 1.5, path: 1.5 };
const WATER_W = { river: 30, canal: 10, stream: 4, drain: 4, ditch: 2 };
const LAND = { residential: 'r', farmyard: 'r', village: 'r', hamlet: 'r', neighbourhood: 'r', isolated_dwelling: 'r', farmland: 'f', meadow: 'f',
  orchard: 'o', grass: 'g', park: 'g', garden: 'g', pitch: 'g', stadium: 'g', sports_centre: 'g', cemetery: 'c', industrial: 'i', commercial: 'i', retail: 'i', religious: 'i' };

/** OSM tags → place category key (see PLACES in shared.js), or null. */
export function placeKeyOf(t) {
  const a = t.amenity, rel = (t.religion || '').toLowerCase();
  if (a === 'place_of_worship') return rel === 'christian' ? 'church' : rel === 'muslim' || !rel ? 'mosque' : null;
  if (a === 'hospital' || t.healthcare === 'hospital') return 'health';
  if (a === 'clinic' || a === 'doctors' || ['clinic', 'doctor', 'centre'].includes(t.healthcare)) return 'clinic';
  if (a === 'pharmacy' || t.healthcare === 'pharmacy') return 'pharmacy_place';
  if (a === 'school' || a === 'college') return 'school';
  if (a === 'kindergarten') return 'kindergarten';
  if (a === 'post_office') return 'post';
  if (a === 'bank' || a === 'atm') return 'bank';
  if (a === 'police') return 'police';
  if (a === 'fire_station') return 'fire';
  if (a === 'townhall' || a === 'courthouse' || t.office === 'government') return 'government';
  if (a === 'marketplace') return 'market';
  if (a === 'fuel') return 'fuel_station';
  if (a === 'bus_station') return 'transport_stop';
  if (a === 'veterinary') return 'vet_place';
  if (a === 'bakery' || t.shop === 'bakery') return 'bakery_place';
  if (a === 'grave_yard' || t.landuse === 'cemetery') return 'cemetery';
  if (t.leisure === 'sports_centre' || t.leisure === 'stadium') return 'youth';
  if (t.leisure === 'park') return 'park';
  if (a === 'dentist') return 'clinic';
  // anything else with a name that sells or makes something: a shop, workshop, office or café
  if ((t.shop || t.craft || t.office || ['restaurant', 'cafe', 'fast_food', 'car_repair', 'internet_cafe'].includes(a)) && (t.name || t['name:ar'])) return 'shop';
  return null;
}

/** Egyptian phone in local form (01xxxxxxxxx / 0xxxxxxxx) or '' — map data writes +20, spaces and dashes. */
export function localPhone(raw) {
  let d = String(raw || '').split(/[;,/]/)[0].replace(/[^0-9+]/g, '');
  d = d.replace(/^(\+|00)20/, '0');
  if (!d.startsWith('0') && /^1[0125][0-9]{8}$/.test(d)) d = '0' + d;
  return /^0[0-9]{8,10}$/.test(d) ? d : '';
}

export function processOverpass(json, center, r) {
  const rg = Math.round(r * GROUND_FACTOR), keep = rg * 1.5;
  const kx = 111320 * Math.cos(center.lat * Math.PI / 180), ky = 110540;
  const P = g => [Math.round((g.lon - center.lng) * kx), Math.round((g.lat - center.lat) * ky)];
  const out = { v: 1, lat: +center.lat.toFixed(6), lng: +center.lng.toFixed(6), r, rg, at: new Date().toISOString(), src: 'osm', b: [], rd: [], wl: [], wa: [], l: [], p: [] };
  const seenRef = new Set();

  // split a line into runs that stay near the village (long canals and roads go on for kilometres)
  const runs = pts => {
    const res = []; let cur = [];
    pts.forEach((p, i) => {
      const inside = Math.hypot(p[0], p[1]) < keep;
      const nearIn = inside || (i > 0 && Math.hypot(...pts[i - 1]) < keep) || (i < pts.length - 1 && Math.hypot(...pts[i + 1]) < keep);
      if (nearIn) cur.push(p); else if (cur.length) { res.push(cur); cur = []; }
    });
    if (cur.length) res.push(cur);
    return res.filter(x => x.length > 1);
  };
  const flat = pts => pts.flat();
  const closed = g => g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
  const ring = g => g.slice(0, -1).map(P);

  for (const e of json.elements || []) {
    const t = e.tags || {};
    if (e.geometry) {
      const g = e.geometry;
      if (t.building && closed(g)) {
        const pts = ring(g);
        if (pts.length < 3 || Math.hypot(...pts[0]) > r * 1.2) continue;
        const hm = parseFloat(t.height) || (parseFloat(t['building:levels']) ? parseFloat(t['building:levels']) * 3.1 : 0);
        out.b.push([Math.round(Math.min(hm, 60) * 10), ...flat(pts)]);
      } else if (t.highway && ROAD_W[t.highway]) {
        for (const run of runs(g.map(P))) out.rd.push([ROAD_W[t.highway], ...flat(run)]);
      } else if (t.waterway && WATER_W[t.waterway]) {
        const w = Math.min(60, parseFloat(t.width) || WATER_W[t.waterway]);
        for (const run of runs(g.map(P))) out.wl.push([Math.round(w), ...flat(run)]);
      } else if (t.natural === 'water' && closed(g)) {
        out.wa.push(flat(ring(g)));
      } else if (closed(g)) {
        const type = LAND[t.landuse] || LAND[t.leisure] || LAND[t.place];
        if (type) out.l.push([type, ...flat(ring(g))]);
      }
    }
    const key = placeKeyOf(t);
    const c = e.center || (e.type === 'node' ? { lat: e.lat, lon: e.lon } : null);
    if (key && c && !e.geometry) {
      const ref = e.type[0] + e.id;
      if (seenRef.has(ref)) continue;
      seenRef.add(ref);
      const name = (t['name:ar'] || t.name || t['name:en'] || '').trim().slice(0, 80);
      // [type, name, lat, lng, ref, unsure (0/1), phone]
      out.p.push([key, name, +c.lat.toFixed(6), +c.lon.toFixed(6), ref, 0, localPhone(t.phone || t['contact:phone'] || t['contact:mobile'])]);
    }
  }
  return out;
}

/** Short summary for the setup screen. */
export function mapStats(m) {
  const counts = {};
  for (const p of m.p || []) counts[p[0]] = (counts[p[0]] || 0) + 1;
  let km = 0;
  for (const r of m.rd || []) for (let i = 3; i < r.length; i += 2) km += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]);
  return { buildings: m.b?.length || 0, roadsKm: Math.round(km / 100) / 10, canals: m.wl?.length || 0, places: counts, built: (m.l || []).some(x => x[0] === 'r') };
}

/* ------------------------------------------------------------------ houses where OSM has no buildings */
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function inPoly(x, y, a, start) { // a = flat [.., x0, y0, ...] from index start
  let ins = false;
  for (let i = start, j = a.length - 2; i < a.length; j = i, i += 2) {
    const xi = a[i], yi = a[i + 1], xj = a[j], yj = a[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const k = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - ax - k * dx, py - ay - k * dy);
}

/**
 * Village lanes are dense, field tracks are sparse: a 50 m cell counts as built-up when the local
 * streets around it (3 × 3 cells) add up to enough length. Returns (x, y) => boolean, plus the densest point.
 */
const DC = 50, DENSE_M = 330;
function streetGrid(m) {
  const cells = new Map();
  for (const rd of m.rd || []) {
    if (rd[0] < 4 || rd[0] > 7) continue;
    for (let i = 3; i < rd.length; i += 2) {
      const ax = rd[i - 2], ay = rd[i - 1], bx = rd[i], by = rd[i + 1], len = Math.hypot(bx - ax, by - ay), n = Math.ceil(len / 10);
      for (let k = 0; k < n; k++) {
        const key = Math.floor((ax + (bx - ax) * (k + 0.5) / n) / DC) + ',' + Math.floor((ay + (by - ay) * (k + 0.5) / n) / DC);
        cells.set(key, (cells.get(key) || 0) + len / n);
      }
    }
  }
  const sum = (cx, cy) => { let s = 0; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) s += cells.get((cx + i) + ',' + (cy + j)) || 0; return s; };
  return { cells, sum };
}
export function streetDensity(m) {
  const { sum } = streetGrid(m), memo = new Map();
  return (x, y) => {
    const cx = Math.floor(x / DC), cy = Math.floor(y / DC), key = cx + ',' + cy;
    if (!memo.has(key)) memo.set(key, sum(cx, cy) >= DENSE_M);
    return memo.get(key);
  };
}
/** The point (metres from the centre) where the village streets are densest, or null. */
export function densestPoint(m) {
  const { cells, sum } = streetGrid(m);
  let best = null, bs = 0;
  for (const key of cells.keys()) {
    const [cx, cy] = key.split(',').map(Number), s = sum(cx, cy);
    if (s > bs) { bs = s; best = { x: (cx + 0.5) * DC, y: (cy + 0.5) * DC }; }
  }
  return bs >= DENSE_M ? best : null;
}

/**
 * Most Egyptian villages on OpenStreetMap have streets and built-up areas but no building outlines.
 * This fills the real built-up areas with houses that face the real streets (same result every time).
 * Returns footprints in the `b` format. Real buildings are kept and new houses avoid them.
 */
export function synthHouses(m, max = 3200) {
  if ((m.b?.length || 0) >= 60) return [];
  const R = rng(Math.round(m.lat * 1e4) * 31 + Math.round(m.lng * 1e4));
  const built = (m.l || []).filter(x => x[0] === 'r').map(a => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 1; i < a.length; i += 2) { x0 = Math.min(x0, a[i]); x1 = Math.max(x1, a[i]); y0 = Math.min(y0, a[i + 1]); y1 = Math.max(y1, a[i + 1]); }
    return { a, x0, y0, x1, y1 };
  }).filter(p => (p.x1 - p.x0) * (p.y1 - p.y0) < 9e6 && Math.hypot((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2) < m.r * 1.3);
  const dense = streetDensity(m);
  const inBuilt = (x, y) => dense(x, y) || built.some(p => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1 && inPoly(x, y, p.a, 1));

  // road segments in a 40 m grid for quick nearest-road lookups
  const G = 40, grid = new Map(), segs = [];
  const add = (k, s) => { let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(s); };
  for (const rd of m.rd || []) {
    for (let i = 3; i < rd.length; i += 2) {
      const s = { ax: rd[i - 2], ay: rd[i - 1], bx: rd[i], by: rd[i + 1], w: rd[0] };
      segs.push(s);
      const n = Math.ceil(Math.hypot(s.bx - s.ax, s.by - s.ay) / G) + 1;
      for (let k = 0; k <= n; k++) {
        const x = s.ax + (s.bx - s.ax) * k / n, y = s.ay + (s.by - s.ay) * k / n;
        add(Math.floor(x / G) + ',' + Math.floor(y / G), s);
      }
    }
  }
  for (const wl of m.wl || []) for (let i = 3; i < wl.length; i += 2) {
    const s = { ax: wl[i - 2], ay: wl[i - 1], bx: wl[i], by: wl[i + 1], w: wl[0] + 4, water: true };
    const n = Math.ceil(Math.hypot(s.bx - s.ax, s.by - s.ay) / G) + 1;
    for (let k = 0; k <= n; k++) add(Math.floor((s.ax + (s.bx - s.ax) * k / n) / G) + ',' + Math.floor((s.ay + (s.by - s.ay) * k / n) / G), s);
  }
  const near = (x, y) => {
    let best = null, bd = Infinity;
    const gx = Math.floor(x / G), gy = Math.floor(y / G);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of grid.get((gx + i) + ',' + (gy + j)) || []) {
      const d = segDist(x, y, s.ax, s.ay, s.bx, s.by) - s.w / 2;
      if (d < bd) { bd = d; best = s; }
    }
    return { s: best, d: bd };
  };
  // occupancy grid (3 m) so houses don't overlap each other or real buildings
  const O = 3, occ = new Set();
  const cellsOf = (pts) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
    const res = [];
    for (let x = Math.floor(x0 / O); x <= Math.floor(x1 / O); x++) for (let y = Math.floor(y0 / O); y <= Math.floor(y1 / O); y++) {
      if (inPoly(x * O + O / 2, y * O + O / 2, pts, 0)) res.push(x + ',' + y);
    }
    return res;
  };
  for (const b of m.b || []) cellsOf(b.slice(1)).forEach(c => occ.add(c));

  const out = [];
  const tryHouse = (cx, cy, ux, uy, w, d) => { // u = unit vector along the street
    const vx = -uy, vy = ux, hw = w / 2, hd = d / 2;
    const pts = [cx - ux * hw - vx * hd, cy - uy * hw - vy * hd, cx + ux * hw - vx * hd, cy + uy * hw - vy * hd,
      cx + ux * hw + vx * hd, cy + uy * hw + vy * hd, cx - ux * hw + vx * hd, cy - uy * hw + vy * hd].map(Math.round);
    for (let i = 0; i < 8; i += 2) { const n = near(pts[i], pts[i + 1]); if (n.d < 0.8) return false; }
    const cells = cellsOf(pts);
    if (!cells.length || cells.some(c => occ.has(c))) return false;
    cells.forEach(c => occ.add(c));
    const floors = 1 + Math.floor(R() * R() * 4.2);
    out.push([Math.round(floors * 31), ...pts]);
    return true;
  };

  // 1) a row of houses on both sides of every local street inside the built-up area
  for (const s of segs) {
    if (s.w > 8 || s.w < 3 || out.length >= max) continue;
    const len = Math.hypot(s.bx - s.ax, s.by - s.ay); if (len < 6) continue;
    const ux = (s.bx - s.ax) / len, uy = (s.by - s.ay) / len;
    for (const side of [-1, 1]) {
      let t = 2 + R() * 3;
      while (t < len - 3 && out.length < max) {
        const w = 6 + R() * 6, d = 9 + R() * 8, off = s.w / 2 + 0.8 + d / 2;
        const cx = s.ax + ux * (t + w / 2) + side * -uy * off, cy = s.ay + uy * (t + w / 2) + side * ux * off;
        if (inBuilt(cx, cy)) tryHouse(cx, cy, ux, uy, w, d);
        t += w + 0.6 + (R() < 0.12 ? 4 + R() * 6 : 0);
      }
    }
  }
  // 2) fill the blocks between streets (Delta villages are dense)
  const step = 9;
  for (let y = -m.r; y < m.r && out.length < max; y += step) for (let x = -m.r; x < m.r && out.length < max; x += step) {
    const cx = x + (R() - 0.5) * 4, cy = y + (R() - 0.5) * 4;
    if (!inBuilt(cx, cy)) continue;
    const n = near(cx, cy);
    let ux = 1, uy = 0;
    if (n.s) { const l = Math.hypot(n.s.bx - n.s.ax, n.s.by - n.s.ay) || 1; ux = (n.s.bx - n.s.ax) / l; uy = (n.s.by - n.s.ay) / l; }
    if (n.d > 120 && built.length === 0) continue;
    tryHouse(cx, cy, ux, uy, 6 + R() * 5, 7 + R() * 6);
  }
  return out;
}

/* ------------------------------------------------------------------ made-up village (no map data at all) */
/** A plausible Delta village (canal, roads, houses) for when no real map is available. */
export function syntheticMap(center, seed = 7) {
  const R = rng(seed), r = 700, rg = Math.round(r * GROUND_FACTOR);
  const m = { v: 1, lat: center.lat, lng: center.lng, r, rg, at: null, src: 'synthetic', b: [], rd: [], wl: [], wa: [], l: [], p: [] };
  const canal = [];
  for (let x = -rg * 1.4; x <= rg * 1.4; x += 40) canal.push(Math.round(x), Math.round(-560 - 180 * Math.sin(x / 450) - 80 * Math.sin(x / 170)));
  m.wl.push([10, ...canal]);
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * Math.PI * 2 + R() * 0.4, pts = [];
    for (let d = 0; d <= rg * 1.4; d += 60) pts.push(Math.round(Math.cos(a + Math.sin(d / 300) * 0.15) * d), Math.round(Math.sin(a + Math.sin(d / 300) * 0.15) * d));
    m.rd.push([k < 2 ? 7 : 4, ...pts]);
  }
  for (let i = 0; i < 26; i++) { // village lanes
    const a = R() * Math.PI * 2, d = R() * 260, x = Math.cos(a) * d, y = Math.sin(a) * d, b = R() * Math.PI, L = 60 + R() * 160;
    m.rd.push([4, Math.round(x - Math.cos(b) * L), Math.round(y - Math.sin(b) * L), Math.round(x + Math.cos(b) * L), Math.round(y + Math.sin(b) * L)]);
  }
  const ring = [];
  for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2, d = 300 + 60 * Math.sin(a * 3 + 1) + R() * 30; ring.push(Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d)); }
  m.l.push(['r', ...ring]);
  return m;
}
