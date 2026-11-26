// Places from Overture Maps (open data from Meta and Microsoft, CDLA-Permissive-2.0), read straight from
// Overture's public map tiles with HTTP range requests: free, no key, works for any village.
// A tiny reader of PMTiles v3 and Mapbox Vector Tiles, using only what the browser has (fetch, DataView,
// DecompressionStream). Overture says its tiles may change between releases, so every failure returns [].

const BUCKET = 'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/';

/* ---------- small helpers ---------- */
const u64 = (dv, o) => dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 2 ** 32;
async function range(url, offset, length) {
  const res = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
  if (res.status !== 206 && res.status !== 200) throw new Error('tiles_unavailable');
  return new Uint8Array(await res.arrayBuffer());
}
async function gunzip(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** Varint reader that is safe above 2^32 (offsets in big tile files). */
function reader(buf) {
  let pos = 0;
  const varint = () => { let v = 0, s = 0, b; do { b = buf[pos++]; v += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return v; };
  return { varint, get pos() { return pos; }, set pos(p) { pos = p; }, buf };
}

/* ---------- PMTiles v3 ---------- */
function tileId(z, x, y) {
  let acc = 0;
  for (let a = 0; a < z; a++) acc += 4 ** a;
  let d = 0, s = 2 ** (z - 1);
  const xy = [x, y];
  while (s >= 1) {
    const rx = (xy[0] & s) > 0 ? 1 : 0, ry = (xy[1] & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { xy[0] = s - 1 - xy[0]; xy[1] = s - 1 - xy[1]; } const t = xy[0]; xy[0] = xy[1]; xy[1] = t; }
    s /= 2;
  }
  return acc + d;
}
function parseDir(bytes) {
  const r = reader(bytes), n = r.varint(), e = [];
  let id = 0;
  for (let i = 0; i < n; i++) { id += r.varint(); e.push({ id }); }
  for (const x of e) x.run = r.varint();
  for (const x of e) x.len = r.varint();
  e.forEach((x, i) => { const v = r.varint(); x.off = v === 0 && i > 0 ? e[i - 1].off + e[i - 1].len : v - 1; });
  return e;
}
const findEntry = (dir, id) => {
  let lo = 0, hi = dir.length - 1, hit = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (dir[m].id <= id) { hit = dir[m]; lo = m + 1; } else hi = m - 1; }
  return hit;
};
async function openArchive(url) {
  const head = await range(url, 0, 16384);
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (String.fromCharCode(...head.slice(0, 7)) !== 'PMTiles' || head[7] !== 3) throw new Error('tiles_unavailable');
  const h = { rootOff: u64(dv, 8), rootLen: u64(dv, 16), leafOff: u64(dv, 40), dataOff: u64(dv, 56), maxZoom: head[101] };
  const root = parseDir(await gunzip(h.rootOff + h.rootLen <= head.length ? head.slice(h.rootOff, h.rootOff + h.rootLen) : await range(url, h.rootOff, h.rootLen)));
  const leaves = new Map();
  return {
    maxZoom: h.maxZoom,
    async tile(z, x, y) {
      const id = tileId(z, x, y);
      let dir = root;
      for (let depth = 0; depth < 4; depth++) {
        const e = findEntry(dir, id);
        if (!e) return null;
        if (e.run === 0) { // leaf directory
          const key = e.off;
          if (!leaves.has(key)) leaves.set(key, parseDir(await gunzip(await range(url, h.leafOff + e.off, e.len))));
          dir = leaves.get(key); continue;
        }
        return id < e.id + e.run ? gunzip(await range(url, h.dataOff + e.off, e.len)) : null;
      }
      return null;
    },
  };
}

/* ---------- Mapbox Vector Tile (points only) ---------- */
const td = new TextDecoder();
function decodeTile(bytes, z, x, y) {
  const out = [];
  const r = reader(bytes);
  while (r.pos < bytes.length) {
    const tag = r.varint(), field = tag >> 3, wire = tag & 7;
    if (field === 3 && wire === 2) { const len = r.varint(); out.push(...decodeLayer(bytes.subarray(r.pos, r.pos + len), z, x, y)); r.pos += len; }
    else skip(r, wire);
  }
  return out;
}
function skip(r, wire) {
  if (wire === 0) r.varint(); else if (wire === 1) r.pos += 8; else if (wire === 2) { const len = r.varint(); r.pos += len; } else if (wire === 5) r.pos += 4;
  else throw new Error('bad_tile');
}
function decodeLayer(bytes, z, x, y) {
  const r = reader(bytes), keys = [], values = [], feats = [];
  let extent = 4096;
  while (r.pos < bytes.length) {
    const tag = r.varint(), field = tag >> 3, wire = tag & 7;
    if (field === 2 && wire === 2) { const len = r.varint(); feats.push(bytes.subarray(r.pos, r.pos + len)); r.pos += len; }
    else if (field === 3 && wire === 2) { const len = r.varint(); keys.push(td.decode(bytes.subarray(r.pos, r.pos + len))); r.pos += len; }
    else if (field === 4 && wire === 2) { const len = r.varint(); values.push(decodeValue(bytes.subarray(r.pos, r.pos + len))); r.pos += len; }
    else if (field === 5 && wire === 0) extent = r.varint();
    else skip(r, wire);
  }
  const n = 2 ** z;
  return feats.map(fb => {
    const f = reader(fb), props = {};
    let gx = null, gy = null;
    while (f.pos < fb.length) {
      const tag = f.varint(), field = tag >> 3, wire = tag & 7;
      if (field === 2 && wire === 2) { const len = f.varint(), end = f.pos + len; while (f.pos < end) { const k = f.varint(), v = f.varint(); props[keys[k]] = values[v]; } }
      else if (field === 4 && wire === 2) {
        const len = f.varint(), end = f.pos + len;
        const cmd = f.varint();
        if ((cmd & 7) === 1) { const zz = v => (v >>> 1) ^ -(v & 1); gx = zz(f.varint()); gy = zz(f.varint()); }
        f.pos = end;
      } else skip(f, wire);
    }
    if (gx == null) return null;
    const px = (x + gx / extent) / n, py = (y + gy / extent) / n;
    return { props, lng: px * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * py))) * 180 / Math.PI };
  }).filter(Boolean);
}
function decodeValue(bytes) {
  const r = reader(bytes);
  while (r.pos < bytes.length) {
    const tag = r.varint(), field = tag >> 3, wire = tag & 7;
    if (field === 1) { const len = r.varint(); const s = td.decode(bytes.subarray(r.pos, r.pos + len)); r.pos += len; return s; }
    if (field === 2) { const v = new DataView(bytes.buffer, bytes.byteOffset + r.pos, 4).getFloat32(0, true); r.pos += 4; return v; }
    if (field === 3) { const v = new DataView(bytes.buffer, bytes.byteOffset + r.pos, 8).getFloat64(0, true); r.pos += 8; return v; }
    if (field === 4 || field === 5) return r.varint();
    if (field === 6) { const v = r.varint(); return v % 2 ? -(v + 1) / 2 : v / 2; }
    if (field === 7) return !!r.varint();
    skip(r, wire);
  }
  return null;
}

/* ---------- Overture category → village place type ---------- */
const SKIP = /lodging|hotel|river|lake|canal|geographic|historic|landmark|sikh|hindu|buddh|bus_stop|structure_and_geography|^village|^city|^town/;
const CAT = [
  [/mosque|islamic/, 'mosque'], [/church|christian/, 'church'],
  [/hospital|medical_center/, 'health'], [/clinic|doctor|dentist|dermatolog|medical|physician|pediatric|optometr|laborator/, 'clinic'], [/pharmacy|drugstore/, 'pharmacy_place'],
  [/kindergarten|preschool|day_care|nursery_school/, 'kindergarten'], [/school|college|education|university/, 'school'],
  [/post_office/, 'post'], [/bank|atm|credit_union/, 'bank'], [/police/, 'police'], [/fire_department|fire_station/, 'fire'],
  [/government|town_hall|city_hall|public_service|community_services/, 'government'],
  [/stadium|sports_club|soccer|football|gym|playground/, 'youth'],
  [/farmers_market|^market/, 'market'], [/bakery/, 'bakery_place'], [/gas_station|fuel/, 'fuel_station'],
  [/bus_station|taxi|transport/, 'transport_stop'], [/veterinar/, 'vet_place'], [/agricultural_cooperative|farm_supply/, 'agri_coop'],
  [/^park$|public_garden/, 'park'], [/cemetery|funeral/, 'cemetery'],
];
// the name often says more than the category (Arabic and English words)
const BY_NAME = [
  [/مسجد|جامع|mosque/i, 'mosque'], [/كنيس|church/i, 'church'], [/مستشف|hospital|وحدة صحية|الوحدة الصحية/i, 'health'],
  [/صيدل|pharmac/i, 'pharmacy_place'], [/عياد|عيادة|clinic|dr\.|دكتور|معمل|تحاليل|laborator/i, 'clinic'],
  [/حضان|روضة|kindergarten|nursery school/i, 'kindergarten'], [/مدرس|معهد|school/i, 'school'],
  [/مخبز|فرن|bakery/i, 'bakery_place'], [/بنك|bank|atm/i, 'bank'], [/بريد|post office/i, 'post'],
  [/مركز شباب|youth/i, 'youth'], [/بنزين|وقود|fuel|gas station/i, 'fuel_station'], [/بيطر|veterin/i, 'vet_place'],
  [/الجمعية الزراعية|جمعية زراعية/i, 'agri_coop'],
];
const parseJSON = s => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; } };

let latestRelease = null;
async function release() {
  if (latestRelease) return latestRelease;
  const xml = await fetch(BUCKET + '?list-type=2&prefix=tiles/&delimiter=/').then(r => r.text());
  const all = [...xml.matchAll(/<Prefix>tiles\/([^<]+)\/<\/Prefix>/g)].map(m => m[1]).sort();
  if (!all.length) throw new Error('tiles_unavailable');
  return (latestRelease = all.pop());
}

/**
 * Overture places within radiusM of a point, as village-map rows [type, name, lat, lng, ref, unsure, phone].
 * `localPhone` normalises phone numbers (passed in to keep this file free of other imports).
 */
export async function overturePlaces({ lat, lng }, radiusM, localPhone = () => '') {
  const arc = await openArchive(`${BUCKET}tiles/${await release()}/places.pmtiles`);
  const z = Math.min(14, arc.maxZoom), n = 2 ** z;
  const kx = 111320 * Math.cos(lat * Math.PI / 180);
  const dLng = radiusM / kx, dLat = radiusM / 110540;
  const tx = v => Math.floor((v + 180) / 360 * n);
  const ty = v => Math.floor((1 - Math.log(Math.tan(v * Math.PI / 180) + 1 / Math.cos(v * Math.PI / 180)) / Math.PI) / 2 * n);
  const tiles = [];
  for (let x = tx(lng - dLng); x <= tx(lng + dLng); x++) for (let y = ty(lat + dLat); y <= ty(lat - dLat); y++) tiles.push([x, y]);
  if (tiles.length > 16) tiles.length = 16; // a village never needs more
  const feats = (await Promise.all(tiles.map(async ([x, y]) => {
    const t = await arc.tile(z, x, y).catch(() => null);
    return t ? decodeTile(t, z, x, y) : [];
  }))).flat();
  const out = [], seen = new Set();
  for (const { props: p, lat: la, lng: lo } of feats) {
    if (Math.hypot((lo - lng) * kx, (la - lat) * 110540) > radiusM) continue;
    const cat = String(p.basic_category || parseJSON(p.taxonomy)?.primary || '');
    const name = String(p['@name'] || parseJSON(p.names)?.primary || '').trim().slice(0, 80);
    if (!cat || SKIP.test(cat) || name.length < 2) continue;
    const key = BY_NAME.find(([re]) => re.test(name))?.[1] || CAT.find(([re]) => re.test(cat))?.[1] || 'shop';
    const ref = 'o' + String(p.id || '').toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 24);
    if (ref.length < 9 || seen.has(ref)) continue;
    seen.add(ref);
    const conf = typeof p.confidence === 'number' ? p.confidence : 1;
    out.push([key, name, +la.toFixed(6), +lo.toFixed(6), ref, conf < 0.5 ? 1 : 0, localPhone((parseJSON(p.phones) || [])[0])]);
  }
  return out;
}
