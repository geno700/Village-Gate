// Demo backend: everything lives in localStorage and follows the same permission rules
// as supabase/schema.sql, so the UI behaves the same way in both modes.
import { DEFAULT_CATEGORIES, SECTORS, REQUEST_DAYS, RADIUS, cellOf, inEgypt } from './shared.js';
import { synthHouses } from './osm.js';

// The sample village sits on real map data (roads, canals, fields) bundled with the app.
// The sample village is Al-Safa (قرية الصفا) with its real roads, buildings and landmarks; the people
// and shops in it are made up. Falls back to the smaller bundled map.
const getJSON = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
const DEMO_MAP = await getJSON('./data/maps/al-safa.json') || await getJSON('./data/demo-village.json');

const KEY = 'vg-demo-db-v3';
const MAPS_KEY = 'vg-demo-maps-v3';
const DAY = 86400000;
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const clone = x => structuredClone(x);
const E = code => { throw new Error(code); };

let db; // loaded at the end of this file, after every constant is defined
const listeners = new Set();

/* ------------------------------------------------------------------ storage */
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      shiftDates(d, Date.now() - (d.savedAt || Date.now()));
      return d;
    }
  } catch (e) { console.warn('demo db unreadable, reseeding', e); }
  const d = seed();
  persist(d);
  return d;
}
function persist(d = db) { d.savedAt = Date.now(); localStorage.setItem(KEY, JSON.stringify(d)); }
const DATE_FIELDS = ['created_at', 'accepted_at', 'delivered_at', 'cancelled_at', 'expires_at', 'needed_by', 'verified_at', 'updated_at'];
/** Keep the demo looking "live": move every timestamp forward by the time since last visit. */
function shiftDates(d, delta) {
  if (delta < 3600000) return;
  for (const k of ['groups', 'memberships', 'categories', 'places', 'businesses', 'business_categories', 'requests', 'activity_log', 'users']) {
    for (const row of d[k] || []) for (const f of DATE_FIELDS) {
      if (row[f]) row[f] = new Date(new Date(row[f]).getTime() + delta).toISOString();
    }
  }
}

/* ------------------------------------------------------------------ permission helpers (mirror of SQL) */
const me = () => db.session;
const need = () => me() || E('not_signed_in');
const grp = g => db.groups.find(x => x.id === g);
const memOf = (g, u = me()) => db.memberships.find(m => m.group_id === g && m.user_id === u);
const isMember = g => { const m = memOf(g); return !!m && m.status === 'approved' && grp(g)?.status === 'active'; };
const hasRole = (g, roles) => isMember(g) && roles.includes(memOf(g).role);
const isAdm = g => hasRole(g, ['owner', 'admin']);
const canW = g => hasRole(g, ['owner', 'admin', 'member']);
const isPlat = () => db.platform_admins.includes(me());
const myVerifiedBiz = id => {
  const b = db.businesses.find(x => x.id === id);
  return b && b.owner_user_id === me() && b.status === 'verified' && canW(b.group_id) ? b : null;
};
const bizCats = id => db.business_categories.filter(x => x.business_id === id).map(x => x.category_id);

function log(g, action, entity, id, before = null, after = null) {
  db.activity_log.unshift({ id: uuid(), group_id: g, actor: me(), action, entity, entity_id: id,
    before: before && clone(before), after: after && clone(after), created_at: now(), created_by: me() });
  if (db.activity_log.length > 3000) db.activity_log.length = 3000;
}
function expireRequests() {
  const t = Date.now();
  for (const r of db.requests) if (r.status === 'open' && new Date(r.expires_at).getTime() < t) r.status = 'expired';
}
const ok = (v) => Promise.resolve(clone(v));
/** Run a mutation, persist, and turn thrown errors into rejected promises. */
async function tx(fn) { const r = fn(); persist(); return r === undefined ? undefined : clone(r); }

function checkPhone(p) { if (!/^01[0125]\d{8}$/.test(p || '')) E('invalid_phone'); }
function checkLatLng(lat, lng, required = true) {
  if (lat == null && lng == null && !required) return;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inEgypt(lat, lng)) E('invalid_location');
}
function checkName(s, min = 2, max = 80) { const v = (s || '').trim(); if (v.length < min || v.length > max) E('invalid_name'); return v; }
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode(groups = db.groups) {
  let c;
  do { c = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); }
  while (groups.some(g => g.join_code === c));
  return c;
}
function seedCategories(g, by, into = db.categories) {
  DEFAULT_CATEGORIES.forEach(([key, kind, sector, icon, name_en, name_ar], i) => into.push({
    id: uuid(), group_id: g, key, kind, sector, icon, name_en, name_ar, sort: (i + 1) * 10, active: true, created_at: now(), created_by: by }));
}
const SECTOR_KEYS = new Set([...SECTORS.map(s => s[0]), 'places']);
const checkRadius = r => { r = Math.round(+r || RADIUS.default); if (r < RADIUS.min || r > RADIUS.max) E('invalid_input'); return r; };
// village maps are big, so they live under their own key
const readMaps = () => { try { return JSON.parse(localStorage.getItem(MAPS_KEY) || '{}'); } catch { return {}; } };
const notify = () => listeners.forEach(cb => cb(me() ? userOut(me()) : null));
const userOut = id => { const u = db.users.find(x => x.id === id); return u && { id: u.id, email: u.email }; };

/* ------------------------------------------------------------------ API */
export const api = {
  mode: 'demo',

  /* ----- auth ----- */
  async getUser() { return me() ? userOut(me()) : null; },
  onAuthChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  async signUp({ email, password, full_name }) {
    email = (email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) E('invalid_email');
    if ((password || '').length < 8) E('weak_password');
    if (db.users.some(u => u.email === email)) E('email_taken');
    const u = { id: uuid(), email, full_name: (full_name || '').trim(), phone: null, lang: 'ar', created_at: now() };
    db.users.push(u); db.session = u.id; persist(); notify();
    return { needsConfirm: false };
  },
  async signIn({ email }) {
    const u = db.users.find(x => x.email === (email || '').trim().toLowerCase());
    if (!u) E('invalid_login');
    db.session = u.id; persist(); notify();
  },
  async signOut() { db.session = null; persist(); notify(); },
  async sendReset() { /* demo: nothing to send */ },
  async updatePassword() { need(); },

  /* ----- demo only ----- */
  demoUsers() {
    return clone(db.users.filter(u => u.demo).map(u => ({ id: u.id, email: u.email, label: u.demo, full_name: u.full_name })));
  },
  async demoSwitch(uid) { db.session = uid; persist(); notify(); },
  demoReset() { localStorage.removeItem(KEY); localStorage.removeItem(MAPS_KEY); db = load(); },
  demoExportAll() { return clone({ kind: 'village-gate-demo', ...db }); },
  demoImportAll(data) {
    if (data?.kind !== 'village-gate-demo' || !Array.isArray(data.groups)) E('invalid_backup');
    delete data.kind; db = data; persist();
  },

  /* ----- profile ----- */
  async getProfile() { need(); const u = db.users.find(x => x.id === me()); return ok({ id: u.id, full_name: u.full_name, phone: u.phone, lang: u.lang }); },
  async saveProfile(p) {
    need();
    return tx(() => {
      const u = db.users.find(x => x.id === me());
      if (p.full_name != null) u.full_name = p.full_name.trim().slice(0, 80);
      if (p.phone != null) { if (p.phone) checkPhone(p.phone); u.phone = p.phone || null; }
      if (p.lang) u.lang = p.lang;
    });
  },
  async isPlatformAdmin() { return !!me() && isPlat(); },

  /* ----- villages ----- */
  async myGroups() {
    need();
    return ok(db.memberships.filter(m => m.user_id === me() && ['approved', 'pending'].includes(m.status))
      .map(m => ({ g: grp(m.group_id), m }))
      .filter(x => x.g && (x.g.status === 'active' || x.m.status === 'pending'))
      .map(({ g, m }) => ({ ...(m.status === 'approved' ? g : { id: g.id, name: g.name, center_lat: g.center_lat, center_lng: g.center_lng, zoom: g.zoom, radius_m: g.radius_m, status: g.status }), membership: m })));
  },
  async groupByCode(code) {
    const g = db.groups.find(x => x.join_code === (code || '').toUpperCase() && x.status === 'active');
    return g ? ok({ id: g.id, name: g.name, center_lat: g.center_lat, center_lng: g.center_lng }) : null;
  },
  async createGroup(p) {
    need();
    return tx(() => {
      const name = checkName(p.name);
      checkLatLng(p.center_lat, p.center_lng);
      checkPhone(p.phone); checkName(p.display_name);
      checkLatLng(p.home_lat, p.home_lng, false);
      const g = { id: uuid(), name, join_code: newCode(), center_lat: p.center_lat, center_lng: p.center_lng, zoom: 16,
        radius_m: checkRadius(p.radius_m), status: 'active', created_at: now(), created_by: me() };
      db.groups.push(g);
      db.memberships.push({ id: uuid(), group_id: g.id, user_id: me(), role: 'owner', status: 'approved',
        display_name: p.display_name.trim(), phone: p.phone, home_lat: p.home_lat ?? null, home_lng: p.home_lng ?? null,
        home_note: (p.home_note || '').trim(), verified_at: now(), verified_by: me(), created_at: now(), created_by: me() });
      seedCategories(g.id, me());
      log(g.id, 'create', 'groups', g.id, null, g);
      return g.id;
    });
  },
  async joinGroup(p) {
    need();
    return tx(() => {
      const g = db.groups.find(x => x.join_code === (p.code || '').toUpperCase() && x.status === 'active');
      if (!g) E('invalid_code');
      checkName(p.display_name); checkPhone(p.phone); checkLatLng(p.home_lat, p.home_lng, false);
      let m = memOf(g.id);
      const fields = { display_name: p.display_name.trim(), phone: p.phone, home_lat: p.home_lat ?? null,
        home_lng: p.home_lng ?? null, home_note: (p.home_note || '').trim() };
      if (m && ['approved', 'pending'].includes(m.status)) return g.id;
      if (m) { const before = clone(m); Object.assign(m, fields, { status: 'pending', role: 'member', verified_at: null, verified_by: null }); log(g.id, 'rejoin', 'memberships', m.id, before, m); }
      else {
        m = { id: uuid(), group_id: g.id, user_id: me(), role: 'member', status: 'pending', ...fields,
          verified_at: null, verified_by: null, created_at: now(), created_by: me() };
        db.memberships.push(m); log(g.id, 'join', 'memberships', m.id, null, m);
      }
      return g.id;
    });
  },
  async updateGroup(g, p) {
    return tx(() => {
      if (!isAdm(g)) E('forbidden');
      const x = grp(g), before = clone(x);
      if (p.name != null) x.name = checkName(p.name);
      if (p.center_lat != null) { checkLatLng(p.center_lat, p.center_lng); x.center_lat = p.center_lat; x.center_lng = p.center_lng; }
      if (p.zoom != null) x.zoom = Math.min(19, Math.max(10, p.zoom | 0));
      if (p.radius_m != null) x.radius_m = checkRadius(p.radius_m);
      log(g, 'update', 'groups', g, before, x);
    });
  },
  /* the 3D village map (built once from OpenStreetMap by an admin) */
  async getVillageMap(g) {
    if (!isMember(g)) return null;
    const m = readMaps()[g];
    if (m) return m;
    return DEMO_MAP && grp(g)?.demo_map ? clone(DEMO_MAP) : null;
  },
  async saveVillageMap(g, map) {
    return tx(() => {
      if (!isAdm(g)) E('forbidden');
      if (!map || map.v !== 1 || !Array.isArray(map.rd)) E('invalid_input');
      const all = readMaps(); all[g] = map;
      try { localStorage.setItem(MAPS_KEY, JSON.stringify(all)); } catch { E('map_too_big'); }
      log(g, 'build_map', 'groups', g, null, { buildings: map.b.length, roads: map.rd.length, places: map.p.length });
    });
  },
  /* landmarks found on the map → places (skips ones already added, matched by their OpenStreetMap id) */
  async importPlaces(g, list) {
    return tx(() => {
      if (!isAdm(g)) E('forbidden');
      let added = 0;
      for (const p of (list || []).slice(0, 300)) {
        const c = db.categories.find(x => x.group_id === g && x.kind === 'place' && x.key === p.key);
        if (!c || !/^([nwr][0-9]{1,12}|o[0-9a-f]{8,32})$/.test(p.osm_ref || '') || db.places.some(x => x.group_id === g && x.osm_ref === p.osm_ref)) continue;
        const name = (p.name || '').trim().slice(0, 80);
        if (name.length < 2 || !inEgypt(p.lat, p.lng)) continue;
        db.places.push({ id: uuid(), group_id: g, category_id: c.id, name, phone: /^0[0-9]{8,10}$/.test(p.phone || '') ? p.phone : null, lat: p.lat, lng: p.lng, note: '', osm_ref: p.osm_ref, created_at: now(), created_by: me() });
        added++;
      }
      if (added) log(g, 'import_places', 'places', g, null, { added });
      return added;
    });
  },
  async regenerateCode(g) {
    return tx(() => { if (!isAdm(g)) E('forbidden'); const x = grp(g), b = x.join_code; x.join_code = newCode(); log(g, 'new_code', 'groups', g, { join_code: b }, { join_code: x.join_code }); return x.join_code; });
  },
  async deleteGroup(g) {
    return tx(() => {
      if (!hasRole(g, ['owner'])) E('owner_only');
      db.groups = db.groups.filter(x => x.id !== g);
      const maps = readMaps(); delete maps[g]; localStorage.setItem(MAPS_KEY, JSON.stringify(maps));
      for (const k of ['memberships', 'categories', 'places', 'businesses', 'business_categories', 'requests', 'activity_log']) db[k] = db[k].filter(x => x.group_id !== g);
    });
  },
  async transferOwnership(g, membershipId) {
    return tx(() => {
      if (!hasRole(g, ['owner'])) E('owner_only');
      const target = db.memberships.find(m => m.id === membershipId && m.group_id === g);
      if (!target || target.status !== 'approved' || target.user_id === me()) E('invalid_input');
      const mine = memOf(g);
      mine.role = 'admin'; target.role = 'owner';
      log(g, 'transfer_owner', 'memberships', target.id, { owner: mine.user_id }, { owner: target.user_id });
    });
  },
  async leaveGroup(g) {
    return tx(() => {
      const m = memOf(g); if (!m) E('not_found');
      if (m.role === 'owner') E('owner_cannot_leave');
      const b = clone(m); m.status = 'removed'; log(g, 'leave', 'memberships', m.id, b, m);
    });
  },
  async updateMyMembership(g, p) {
    return tx(() => {
      const m = memOf(g); if (!m || !['approved', 'pending'].includes(m.status)) E('forbidden');
      checkName(p.display_name); checkPhone(p.phone); checkLatLng(p.home_lat, p.home_lng, false);
      const b = clone(m);
      Object.assign(m, { display_name: p.display_name.trim(), phone: p.phone, home_lat: p.home_lat ?? null, home_lng: p.home_lng ?? null, home_note: (p.home_note || '').trim().slice(0, 200) });
      log(g, 'update_self', 'memberships', m.id, b, m);
    });
  },

  /* ----- members (admins) ----- */
  async listMembers(g) {
    if (!isAdm(g)) return ok(db.memberships.filter(m => m.group_id === g && m.user_id === me()));
    return ok(db.memberships.filter(m => m.group_id === g).map(m => ({ ...m, email: db.users.find(u => u.id === m.user_id)?.email })));
  },
  async approveMember(id, role = 'member') {
    return tx(() => {
      const m = db.memberships.find(x => x.id === id); if (!m) E('not_found');
      if (!isAdm(m.group_id)) E('forbidden');
      if (!['member', 'viewer'].includes(role)) E('invalid_input');
      if (!['pending', 'rejected'].includes(m.status)) E('invalid_state');
      const b = clone(m); Object.assign(m, { status: 'approved', role, verified_at: now(), verified_by: me() });
      log(m.group_id, 'approve', 'memberships', m.id, b, m);
    });
  },
  async rejectMember(id) {
    return tx(() => {
      const m = db.memberships.find(x => x.id === id); if (!m) E('not_found');
      if (!isAdm(m.group_id)) E('forbidden');
      if (m.status !== 'pending') E('invalid_state');
      const b = clone(m); m.status = 'rejected'; log(m.group_id, 'reject', 'memberships', m.id, b, m);
    });
  },
  async setMemberRole(id, role) {
    return tx(() => {
      const m = db.memberships.find(x => x.id === id); if (!m) E('not_found');
      const g = m.group_id;
      if (!isAdm(g)) E('forbidden');
      if (!['admin', 'member', 'viewer'].includes(role) || m.status !== 'approved' || m.role === 'owner') E('invalid_input');
      if ((role === 'admin' || m.role === 'admin') && !hasRole(g, ['owner'])) E('owner_only');
      const b = clone(m); m.role = role; log(g, 'set_role', 'memberships', m.id, b, m);
    });
  },
  async removeMember(id) {
    return tx(() => {
      const m = db.memberships.find(x => x.id === id); if (!m) E('not_found');
      const g = m.group_id;
      if (!isAdm(g)) E('forbidden');
      if (m.role === 'owner') E('owner_cannot_leave');
      if (m.role === 'admin' && !hasRole(g, ['owner'])) E('owner_only');
      const b = clone(m); m.status = 'removed'; log(g, 'remove', 'memberships', m.id, b, m);
      // their businesses stop working at once (same as the SQL helper my_business_ids)
      for (const r of db.requests) {
        const biz = db.businesses.find(x => x.id === r.business_id);
        if (r.status === 'accepted' && biz?.owner_user_id === m.user_id && biz.group_id === g) Object.assign(r, { status: 'open', business_id: null, accepted_at: null });
      }
    });
  },

  /* ----- categories & places ----- */
  async listCategories(g) { if (!isMember(g)) return []; return ok(db.categories.filter(c => c.group_id === g).sort((a, b) => a.sort - b.sort)); },
  async saveCategory(g, c) {
    return tx(() => {
      if (!isAdm(g)) E('forbidden');
      if (!/^[a-z0-9_]{2,30}$/.test(c.key || '') || !c.name_en?.trim() || !c.name_ar?.trim() || !['service', 'place'].includes(c.kind)) E('invalid_input');
      const sector = c.kind === 'place' ? 'places' : (c.sector || 'other');
      if (!SECTOR_KEYS.has(sector)) E('invalid_input');
      const row = { key: c.key, kind: c.kind, sector, icon: (c.icon || '•').slice(0, 8), name_en: c.name_en.trim(), name_ar: c.name_ar.trim(), sort: c.sort | 0, active: c.active !== false };
      if (c.id) {
        const x = db.categories.find(y => y.id === c.id && y.group_id === g); if (!x) E('not_found');
        const b = clone(x); const { key, kind, ...editable } = row; Object.assign(x, editable, x.kind === 'place' ? { sector: 'places' } : {});
        log(g, 'update', 'categories', x.id, b, x); return x.id;
      }
      if (db.categories.some(y => y.group_id === g && y.key === c.key)) E('duplicate');
      const x = { id: uuid(), group_id: g, ...row, created_at: now(), created_by: me() };
      db.categories.push(x); log(g, 'insert', 'categories', x.id, null, x); return x.id;
    });
  },
  async listPlaces(g) { if (!isMember(g)) return []; return ok(db.places.filter(p => p.group_id === g && (p.status || 'approved') === 'approved')); },
  /** Suggested places waiting for the mayor: all of them for admins, only my own for residents. */
  async listPlaceSuggestions(g) {
    if (!isMember(g)) return [];
    return ok(db.places.filter(p => p.group_id === g && p.status === 'pending' && (isAdm(g) || p.created_by === me()))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)));
  },
  async suggestPlace(g, p) {
    return tx(() => {
      if (!canW(g)) E('forbidden');
      const admin = isAdm(g);
      if (!admin && db.places.filter(x => x.group_id === g && x.created_by === me() && x.status === 'pending').length >= 10) E('too_many');
      const cat = db.categories.find(c => c.id === p.category_id && c.group_id === g && c.kind === 'place'); if (!cat) E('invalid_input');
      checkLatLng(p.lat, p.lng);
      const x = { id: uuid(), group_id: g, category_id: cat.id, name: checkName(p.name), phone: null, lat: p.lat, lng: p.lng,
        note: (p.note || '').trim().slice(0, 300), osm_ref: null, status: admin ? 'approved' : 'pending', created_at: now(), created_by: me() };
      db.places.push(x); log(g, 'insert', 'places', x.id, null, x); return x.id;
    });
  },
  async reviewPlace(id, approve) {
    return tx(() => {
      const x = db.places.find(y => y.id === id); if (!x) E('not_found');
      if (!isAdm(x.group_id)) E('forbidden');
      if (x.status !== 'pending') E('invalid_state');
      if (approve) { const b = clone(x); x.status = 'approved'; log(x.group_id, 'update', 'places', x.id, b, x); }
      else { db.places = db.places.filter(y => y.id !== id); log(x.group_id, 'delete', 'places', id, x, null); }
    });
  },
  async savePlace(g, p) {
    return tx(() => {
      if (!isAdm(g)) E('forbidden');
      const cat = db.categories.find(c => c.id === p.category_id && c.group_id === g && c.kind === 'place'); if (!cat) E('invalid_input');
      checkLatLng(p.lat, p.lng); if (p.phone) checkPhone(p.phone);
      const row = { category_id: p.category_id, name: checkName(p.name), phone: p.phone || null, lat: p.lat, lng: p.lng, note: (p.note || '').trim().slice(0, 300) };
      if (p.id) { const x = db.places.find(y => y.id === p.id && y.group_id === g); if (!x) E('not_found'); const b = clone(x); Object.assign(x, row); log(g, 'update', 'places', x.id, b, x); return x.id; }
      const x = { id: uuid(), group_id: g, ...row, created_at: now(), created_by: me() };
      db.places.push(x); log(g, 'insert', 'places', x.id, null, x); return x.id;
    });
  },
  async deletePlace(id) {
    return tx(() => {
      const x = db.places.find(y => y.id === id); if (!x) E('not_found');
      if (!isAdm(x.group_id)) E('forbidden');
      db.places = db.places.filter(y => y.id !== id); log(x.group_id, 'delete', 'places', id, x, null);
    });
  },

  /* ----- businesses ----- */
  async listBusinesses(g) {
    if (!isMember(g)) return [];
    return ok(db.businesses.filter(b => b.group_id === g && (b.status === 'verified' || b.owner_user_id === me() || isAdm(g)))
      .map(b => ({ ...b, category_ids: bizCats(b.id) })));
  },
  async saveBusiness(g, b, categoryIds) {
    return tx(() => {
      if (!canW(g)) E('forbidden');
      if (!categoryIds?.length || categoryIds.some(id => !db.categories.find(c => c.id === id && c.group_id === g && c.kind === 'service'))) E('invalid_input');
      checkPhone(b.phone); if (b.whatsapp) checkPhone(b.whatsapp);
      if (!b.is_mobile || b.lat != null) checkLatLng(b.lat, b.lng);
      const row = { name: checkName(b.name), description: (b.description || '').trim().slice(0, 500), phone: b.phone, whatsapp: b.whatsapp || null,
        lat: b.lat ?? null, lng: b.lng ?? null, is_mobile: !!b.is_mobile, hours: (b.hours || '').trim().slice(0, 100) };
      let x;
      if (b.id) {
        x = db.businesses.find(y => y.id === b.id && y.group_id === g); if (!x) E('not_found');
        if (x.owner_user_id !== me() && !isAdm(g)) E('forbidden');
        const before = clone(x); Object.assign(x, row); log(g, 'update', 'businesses', x.id, before, x);
      } else {
        x = { id: uuid(), group_id: g, owner_user_id: me(), ...row, status: 'pending', verified_at: null, verified_by: null, created_at: now(), created_by: me() };
        db.businesses.push(x); log(g, 'insert', 'businesses', x.id, null, x);
      }
      db.business_categories = db.business_categories.filter(y => y.business_id !== x.id);
      for (const cid of new Set(categoryIds)) db.business_categories.push({ id: uuid(), group_id: g, business_id: x.id, category_id: cid, created_at: now(), created_by: me() });
      return x.id;
    });
  },
  async deleteBusiness(id) {
    return tx(() => {
      const x = db.businesses.find(y => y.id === id); if (!x) E('not_found');
      if (!(x.owner_user_id === me() && canW(x.group_id)) && !isAdm(x.group_id)) E('forbidden');
      db.businesses = db.businesses.filter(y => y.id !== id);
      db.business_categories = db.business_categories.filter(y => y.business_id !== id);
      for (const r of db.requests) if (r.business_id === id) { if (r.status === 'accepted') Object.assign(r, { status: 'open', accepted_at: null }); r.business_id = null; }
      log(x.group_id, 'delete', 'businesses', id, x, null);
    });
  },
  async setBusinessStatus(id, status) {
    return tx(() => {
      const x = db.businesses.find(y => y.id === id); if (!x) E('not_found');
      if (!isAdm(x.group_id)) E('forbidden');
      if (!['pending', 'verified', 'suspended', 'rejected'].includes(status)) E('invalid_input');
      const b = clone(x);
      x.status = status;
      if (status === 'verified') { x.verified_at = now(); x.verified_by = me(); }
      if (status !== 'verified') for (const r of db.requests) if (r.business_id === id && r.status === 'accepted') Object.assign(r, { status: 'open', business_id: null, accepted_at: null });
      log(x.group_id, 'set_status', 'businesses', id, b, x);
    });
  },

  /* ----- requests ----- */
  async myRequests(g) { expireRequests(); return ok(db.requests.filter(r => r.group_id === g && r.created_by === me() && isMember(g))); },
  async adminRequests(g) { if (!isAdm(g)) return []; expireRequests(); return ok(db.requests.filter(r => r.group_id === g)); },
  async createRequest(g, r) {
    return tx(() => {
      if (!canW(g)) E('forbidden');
      if (!db.categories.find(c => c.id === r.category_id && c.group_id === g && c.kind === 'service')) E('invalid_input');
      checkLatLng(r.lat, r.lng);
      const q = r.quantity | 0; if (q < 1 || q > 99) E('invalid_input');
      const x = { id: uuid(), group_id: g, category_id: r.category_id, details: (r.details || '').trim().slice(0, 300), quantity: q,
        lat: r.lat, lng: r.lng, location_note: (r.location_note || '').trim().slice(0, 200), needed_by: r.needed_by || null,
        expires_at: new Date(Date.now() + REQUEST_DAYS * DAY).toISOString(), status: 'open', business_id: null,
        accepted_at: null, delivered_at: null, cancelled_at: null, created_at: now(), created_by: me() };
      db.requests.push(x); log(g, 'insert', 'requests', x.id, null, x); return x.id;
    });
  },
  async cancelRequest(id) {
    return tx(() => {
      const r = db.requests.find(x => x.id === id); if (!r) E('not_found');
      if (r.created_by !== me() || !isMember(r.group_id)) E('forbidden');
      if (!['open', 'accepted'].includes(r.status)) E('invalid_state');
      const b = clone(r); Object.assign(r, { status: 'cancelled', cancelled_at: now() }); log(r.group_id, 'cancel', 'requests', id, b, r);
    });
  },
  async deliverRequest(id) {
    return tx(() => {
      const r = db.requests.find(x => x.id === id); if (!r) E('not_found');
      const mineReq = r.created_by === me() && isMember(r.group_id);
      if (!mineReq && !myVerifiedBiz(r.business_id)) E('forbidden');
      if (r.status !== 'accepted') E('invalid_state');
      const b = clone(r); Object.assign(r, { status: 'delivered', delivered_at: now() }); log(r.group_id, 'deliver', 'requests', id, b, r);
    });
  },
  async releaseRequest(id) {
    return tx(() => {
      const r = db.requests.find(x => x.id === id); if (!r) E('not_found');
      if (!myVerifiedBiz(r.business_id) || r.status !== 'accepted') E('forbidden');
      const b = clone(r); Object.assign(r, { status: 'open', business_id: null, accepted_at: null }); log(r.group_id, 'release', 'requests', id, b, r);
    });
  },
  /** Open requests for a verified business, with the location rounded to a ~100 m cell. No names, no exact pins. */
  async openDemand(g, businessId, hours = 48) {
    const b = myVerifiedBiz(businessId); if (!b || b.group_id !== g) E('forbidden');
    expireRequests(); persist();
    const cats = bizCats(b.id), since = Date.now() - hours * 3600000;
    return ok(db.requests.filter(r => r.group_id === g && r.status === 'open' && cats.includes(r.category_id) && new Date(r.created_at).getTime() >= since)
      .map(r => { const c = cellOf(r.lat, r.lng); return { id: r.id, category_id: r.category_id, quantity: r.quantity, details: r.details,
        created_at: r.created_at, needed_by: r.needed_by, cell_lat: c.lat, cell_lng: c.lng }; }));
  },
  async acceptRequests(businessId, ids) {
    return tx(() => {
      const b = myVerifiedBiz(businessId); if (!b) E('forbidden');
      const cats = bizCats(b.id); let n = 0;
      for (const r of db.requests) {
        if (ids.includes(r.id) && r.group_id === b.group_id && r.status === 'open' && cats.includes(r.category_id) && new Date(r.expires_at) > new Date()) {
          const before = clone(r);
          Object.assign(r, { status: 'accepted', business_id: b.id, accepted_at: now() }); n++;
          log(b.group_id, 'accept', 'requests', r.id, before, r);
        }
      }
      return n;
    });
  },
  /** Jobs of my business: exact pin and contact, only after accepting. */
  async myJobs(businessId) {
    const b = db.businesses.find(x => x.id === businessId);
    if (!b || b.owner_user_id !== me() || !isMember(b.group_id)) E('forbidden');
    const since = Date.now() - 7 * DAY;
    return ok(db.requests.filter(r => r.business_id === b.id && (r.status === 'accepted' || (r.status === 'delivered' && new Date(r.delivered_at).getTime() > since)))
      .map(r => { const m = memOf(r.group_id, r.created_by); return { ...r, contact_name: m?.display_name || '', contact_phone: m?.phone || '' }; }));
  },

  /* ----- activity, export ----- */
  async listActivity(g, limit = 200) { if (!isAdm(g)) return []; return ok(db.activity_log.filter(a => a.group_id === g).slice(0, limit)); },
  async exportGroup(g) {
    if (!isAdm(g)) E('forbidden');
    const pick = k => db[k].filter(x => x.group_id === g);
    return ok({ kind: 'village-gate-backup', version: 1, exported_at: now(), group: grp(g),
      categories: pick('categories'), places: pick('places'), memberships: pick('memberships'), businesses: pick('businesses'),
      business_categories: pick('business_categories'), requests: pick('requests') });
  },
  /** Restores categories (matched by key) and places. Members, businesses and requests are never restored from a file. */
  async importGroup(g, data) {
    return tx(() => {
      if (!isAdm(g)) E('forbidden');
      if (data?.kind !== 'village-gate-backup' || !Array.isArray(data.categories)) E('invalid_backup');
      const keyOf = {}; let nc = 0, np = 0;
      for (const c of data.categories) {
        if (!/^[a-z0-9_]{2,30}$/.test(c.key || '') || !['service', 'place'].includes(c.kind)) continue;
        keyOf[c.id] = c.key;
        const x = db.categories.find(y => y.group_id === g && y.key === c.key);
        const row = { kind: c.kind, icon: c.icon || '•', name_en: c.name_en, name_ar: c.name_ar, sort: c.sort | 0, active: c.active !== false };
        if (x) Object.assign(x, row); else db.categories.push({ id: uuid(), group_id: g, key: c.key, ...row, created_at: now(), created_by: me() });
        nc++;
      }
      for (const p of data.places || []) {
        const cat = db.categories.find(y => y.group_id === g && y.key === keyOf[p.category_id] && y.kind === 'place');
        if (!cat || !inEgypt(p.lat, p.lng) || !p.name) continue;
        const row = { category_id: cat.id, name: p.name, phone: p.phone || null, lat: p.lat, lng: p.lng, note: p.note || '' };
        const x = db.places.find(y => y.id === p.id && y.group_id === g);
        if (x) Object.assign(x, row); else db.places.push({ id: p.id && !db.places.some(y => y.id === p.id) ? p.id : uuid(), group_id: g, ...row, created_at: now(), created_by: me() });
        np++;
      }
      log(g, 'restore', 'groups', g, null, { categories: nc, places: np });
      return { categories: nc, places: np };
    });
  },

  /* ----- platform owner ----- */
  async platformStats() {
    if (!isPlat()) E('forbidden');
    const weeks = [];
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 1) % 7)); // weeks start Saturday
    for (let i = 11; i >= 0; i--) {
      const a = start.getTime() - i * 7 * DAY, b = a + 7 * DAY;
      const inW = r => { const t = new Date(r.created_at).getTime(); return t >= a && t < b; };
      weeks.push({ week: new Date(a).toISOString().slice(0, 10), activity: db.activity_log.filter(inW).length,
        new_users: db.users.filter(inW).length, new_groups: db.groups.filter(inW).length });
    }
    return ok({ groups: db.groups.length, active_groups: db.groups.filter(g => g.status === 'active').length,
      users: db.users.length, memberships: db.memberships.filter(m => m.status === 'approved').length,
      requests_7d: db.requests.filter(r => Date.now() - new Date(r.created_at) < 7 * DAY).length, weeks });
  },
  async platformGroups(q = '') {
    if (!isPlat()) E('forbidden');
    const s = q.trim().toLowerCase();
    return ok(db.groups.filter(g => !s || g.name.toLowerCase().includes(s) || g.join_code.toLowerCase() === s).map(g => {
      const ms = db.memberships.filter(m => m.group_id === g.id);
      const last = db.activity_log.find(a => a.group_id === g.id);
      return { id: g.id, name: g.name, status: g.status, created_at: g.created_at,
        owner_name: ms.find(m => m.role === 'owner')?.display_name || '',
        members: ms.filter(m => m.status === 'approved').length, pending: ms.filter(m => m.status === 'pending').length,
        businesses: db.businesses.filter(b => b.group_id === g.id && b.status === 'verified').length,
        requests_7d: db.requests.filter(r => r.group_id === g.id && Date.now() - new Date(r.created_at) < 7 * DAY).length,
        last_activity: last?.created_at || null };
    }));
  },
  async setGroupStatus(g, status) {
    return tx(() => {
      if (!isPlat()) E('forbidden');
      if (!['active', 'disabled'].includes(status)) E('invalid_input');
      const x = grp(g); if (!x) E('not_found');
      const b = { status: x.status }; x.status = status; log(g, 'platform_status', 'groups', g, b, { status });
    });
  },
  async platformActivity(g = null, limit = 200) {
    if (!isPlat()) E('forbidden');
    return ok(db.activity_log.filter(a => !g || a.group_id === g).slice(0, limit).map(a => ({ ...a,
      group_name: grp(a.group_id)?.name || '', actor_name: memOf(a.group_id, a.actor)?.display_name || db.users.find(u => u.id === a.actor)?.full_name || '' })));
  },
};

/* ================================================================== sample data */
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function seed() {
  const R = rng(20261124);
  const pick = a => a[Math.floor(R() * a.length)];
  const gauss = () => (R() + R() + R() - 1.5) / 1.5;
  const T = Date.now();
  const ago = h => new Date(T - h * 3600000).toISOString();
  const d = { version: 1, session: null, users: [], platform_admins: [], groups: [], memberships: [], categories: [], places: [],
    businesses: [], business_categories: [], requests: [], activity_log: [] };

  const M = ['محمد', 'أحمد', 'محمود', 'مصطفى', 'إبراهيم', 'علي', 'حسن', 'عمرو', 'سيد', 'عبد الله', 'خالد', 'يوسف', 'طارق', 'رمضان', 'شعبان', 'جمال'];
  const F = ['فاطمة', 'زينب', 'مريم', 'سعاد', 'هدى', 'آمنة', 'نجلاء', 'سمية', 'رحاب', 'أم هاشم', 'نادية', 'صباح', 'دعاء', 'إيمان'];
  const L = ['عبد العال', 'الشافعي', 'أبو زيد', 'السيد', 'عطية', 'النجار', 'المنوفي', 'حجازي', 'شلبي', 'الدسوقي', 'بدوي', 'سالم'];
  const STREETS = ['شارع المسجد الكبير', 'شارع البحر', 'بجوار الوحدة الصحية', 'خلف المدرسة الابتدائية', 'شارع المحطة', 'عند الجسر الصغير', 'شارع الجمعية الزراعية', 'نهاية شارع المقابر', 'على ناصية الترعة'];
  const phone = () => '01' + pick(['0', '1', '2', '5']) + String(Math.floor(R() * 1e8)).padStart(8, '0');

  const mkUser = (full_name, email, demo) => { const u = { id: uuid(), email, full_name, phone: phone(), lang: 'ar', created_at: ago(24 * (20 + R() * 60)), demo: demo || null }; d.users.push(u); return u; };
  const mkVillage = (name, lat, lng, owner, status = 'active', daysOld = 60) => {
    const g = { id: uuid(), name, join_code: '', center_lat: lat, center_lng: lng, zoom: 16, radius_m: 1000, status, created_at: ago(24 * daysOld), created_by: owner.id };
    g.join_code = newCode(d.groups); seedCategories(g.id, owner.id, d.categories);
    d.groups.push(g);
    return g;
  };
  const cat = (g, key) => d.categories.find(c => c.group_id === g.id && c.key === key).id;
  // in the sample village every home, shop and landmark sits on a house of the real-map 3D village
  const spots = [];
  if (DEMO_MAP) {
    const kx = 111320 * Math.cos(DEMO_MAP.lat * Math.PI / 180);
    for (const b of [...DEMO_MAP.b, ...synthHouses(DEMO_MAP)]) {
      let x = 0, y = 0; const n = (b.length - 1) / 2;
      for (let i = 1; i < b.length; i += 2) { x += b[i] / n; y += b[i + 1] / n; }
      spots.push({ lat: +(DEMO_MAP.lat + y / 110540).toFixed(6), lng: +(DEMO_MAP.lng + x / kx).toFixed(6), d: Math.hypot(x, y) });
    }
    spots.sort((a, b) => a.d - b.d);
  }
  const used = new Set();
  const spot = (maxIndex) => { // a free house, nearer the centre for small maxIndex
    for (let k = 0; k < 50; k++) { const i = Math.floor(R() * Math.min(maxIndex, spots.length)); if (!used.has(i)) { used.add(i); return spots[i]; } }
    return spots[Math.floor(R() * spots.length)];
  };
  const home = (g, spread = 1) => g.demo_map && spots.length ? spot(Math.round(spots.length * Math.min(1, spread)))
    : { lat: +(g.center_lat + gauss() * 0.0042 * spread).toFixed(6), lng: +(g.center_lng + gauss() * 0.0050 * spread).toFixed(6) };
  const mkMember = (g, u, role, status = 'approved', hrs = 24 * 30) => {
    const h = home(g, 0.9);
    const m = { id: uuid(), group_id: g.id, user_id: u.id, role, status, display_name: u.full_name, phone: u.phone,
      home_lat: h.lat, home_lng: h.lng, home_note: pick(STREETS), verified_at: status === 'approved' ? ago(hrs - 2) : null,
      verified_by: status === 'approved' ? g.created_by : null, created_at: ago(hrs), created_by: u.id };
    d.memberships.push(m); return m;
  };
  const mkPlace = (g, key, name, dlat, dlng, ph = null, note = '') => {
    const at = g.demo_map && spots.length ? spot(Math.round(spots.length * 0.5)) : { lat: +(g.center_lat + dlat).toFixed(6), lng: +(g.center_lng + dlng).toFixed(6) };
    d.places.push({ id: uuid(), group_id: g.id, category_id: cat(g, key), name, phone: ph, lat: at.lat, lng: at.lng, note, osm_ref: null, created_at: g.created_at, created_by: g.created_by });
  };
  const mkBiz = (g, u, name, keys, opts = {}) => {
    const p = opts.mobile ? { lat: null, lng: null } : home(g, 0.6);
    const b = { id: uuid(), group_id: g.id, owner_user_id: u.id, name, description: opts.desc || '', phone: u.phone, whatsapp: opts.wa === false ? null : u.phone,
      lat: p.lat, lng: p.lng, is_mobile: !!opts.mobile, hours: opts.hours || '٨ص - ١٠م', status: opts.status || 'verified',
      verified_at: (opts.status || 'verified') === 'verified' ? ago(24 * 20) : null, verified_by: (opts.status || 'verified') === 'verified' ? g.created_by : null,
      created_at: ago(24 * 25), created_by: u.id };
    d.businesses.push(b);
    keys.forEach(k => d.business_categories.push({ id: uuid(), group_id: g.id, business_id: b.id, category_id: cat(g, k), created_at: b.created_at, created_by: u.id }));
    return b;
  };

  /* ---- people you can "act as" ---- */
  const mayor = mkUser('الحاج عبد الرحمن سعيد', 'mayor@demo.test', 'mayor');
  const helper = mkUser('محمود عبد الله', 'admin@demo.test', 'admin');
  const fatma = mkUser('فاطمة حسن', 'fatma@demo.test', 'resident');
  const hassan = mkUser('حسن عبد الحميد', 'gas@demo.test', 'gas');
  const karim = mkUser('كريم البقال', 'grocer@demo.test', 'grocer');
  const nadia = mkUser('نادية فؤاد', 'viewer@demo.test', 'viewer');
  const saeed = mkUser('سعيد إبراهيم', 'pending@demo.test', 'pending');
  d.platform_admins.push(mayor.id);

  /* ---- village 1: Kafr El-Nakhla ---- */
  const v = mkVillage(DEMO_MAP?.name_ar || 'كفر النخلة', DEMO_MAP?.lat ?? 30.887, DEMO_MAP?.lng ?? 31.048, mayor);
  v.demo_map = !!DEMO_MAP; v.radius_m = DEMO_MAP?.r ?? 1000;
  mkMember(v, mayor, 'owner', 'approved', 24 * 60);
  mkMember(v, helper, 'admin', 'approved', 24 * 58);
  const fatmaM = mkMember(v, fatma, 'member');
  mkMember(v, hassan, 'member'); mkMember(v, karim, 'member'); mkMember(v, nadia, 'viewer');
  mkMember(v, saeed, 'member', 'pending', 5);
  const residents = [];
  for (let i = 0; i < 34; i++) {
    const female = R() < 0.5;
    const u = mkUser(`${pick(female ? F : M)} ${pick(M)} ${pick(L)}`, `resident${i + 1}@demo.test`);
    residents.push(mkMember(v, u, 'member'));
  }
  for (let i = 0; i < 3; i++) { const u = mkUser(`${pick(M)} ${pick(L)}`, `new${i + 1}@demo.test`); mkMember(v, u, 'member', 'pending', 2 + i * 7); }

  // real landmarks from the map first, then everyday ones the map does not have yet
  const PLACE_AR = Object.fromEntries(DEFAULT_CATEGORIES.filter(c => c[1] === 'place').map(c => [c[0], c[5]]));
  const realKeys = new Set();
  const mkx = 111320 * Math.cos((DEMO_MAP?.lat || 0) * Math.PI / 180);
  for (const [key, name, lat, lng, ref, , phone] of DEMO_MAP?.p || []) {
    // only places inside the village circle (the map also lists the market town nearby)
    if (!PLACE_AR[key] || Math.hypot((lng - DEMO_MAP.lng) * mkx, (lat - DEMO_MAP.lat) * 110540) > DEMO_MAP.r * 1.15) continue;
    realKeys.add(key);
    d.places.push({ id: uuid(), group_id: v.id, category_id: cat(v, key), name: name || PLACE_AR[key], phone: phone || null, lat, lng, note: '', osm_ref: ref,
      created_at: v.created_at, created_by: v.created_by });
  }
  const fill = (key, name, dlat, dlng, ph, note) => { if (!realKeys.has(key)) mkPlace(v, key, name, dlat, dlng, ph, note); };
  fill('mosque', 'المسجد الكبير', 0.0004, -0.0006, null, 'صلاة الجمعة الساعة ١٢:٠٠');
  fill('health', 'الوحدة الصحية', -0.0012, -0.0024, null, 'من ٨ صباحًا حتى ٢ ظهرًا، والطوارئ على مدار الساعة');
  fill('pharmacy_place', 'الصيدلية', 0.0009, 0.0011, '01001234567');
  fill('school', 'المدرسة الابتدائية', 0.0031, -0.0018);
  fill('agri_coop', 'الجمعية الزراعية', 0.0016, -0.0043);
  fill('government', 'مجلس القرية', 0.0001, 0.0019);
  fill('post', 'مكتب البريد', -0.0004, 0.0016);
  fill('youth', 'مركز الشباب', 0.0042, 0.0012);
  fill('cemetery', 'المقابر', -0.0052, 0.0047);
  fill('bakery_place', 'المخبز البلدي', -0.0008, 0.0004);
  fill('market', 'سوق القرية', 0.0012, -0.0012);
  fill('transport_stop', 'موقف المواصلات', 0.0026, 0.0026);

  const gasH = mkBiz(v, hassan, 'غاز حسن', ['gas'], { mobile: true, desc: 'توصيل أسطوانات الغاز إلى المنازل يوميًا', hours: '٧ ص - ٥ م' });
  const amana = mkBiz(v, karim, 'بقالة الأمانة', ['grocery', 'gas', 'water'], { desc: 'بقالة وسلع تموينية وأسطوانات غاز', hours: '٧ ص - ١٢ م' });
  const others = [
    ['متجر البركة', ['grocery', 'water', 'dairy'], {}],
    ['بقالة أم هاشم', ['grocery'], { wa: false }],
    ['عربة خضروات رجب', ['vegetables'], { mobile: true }],
    ['المخبز البلدي', ['bakery'], { hours: '٥ ص - ١٢ ظ' }],
    ['جزارة الحاج سالم', ['meat', 'poultry'], {}],
    ['توك توك أبو يوسف', ['transport', 'delivery'], { mobile: true }],
    ['شعبان للسباكة', ['plumbing'], { mobile: true }],
    ['كهرباء النور', ['electric', 'appliance'], {}],
    ['مركز المستقبل للهواتف', ['phones', 'phone_repair', 'e_services'], {}],
    ['مكتبة الطلبة', ['books', 'printing'], {}],
    ['صيدلية د. منى للتوصيل', ['pharmacy'], {}],
    ['مياه الصفا', ['water'], { mobile: true }],
    ['د. سامح للرعاية المنزلية', ['doctor', 'nursing', 'lab'], { mobile: true }],
    ['جرارات الحاج فتحي', ['tractor', 'harvest'], { mobile: true }],
    ['د. وليد البيطري', ['vet'], { mobile: true }],
    ['ورشة الأمانة للخراطة', ['machining', 'welding', 'motor_rewind'], {}],
    ['الشبكة الذهبية للإنترنت', ['internet', 'cctv', 'satellite'], {}],
    ['مقاولات الإخلاص', ['mason', 'tiling', 'building_materials'], {}],
    ['نجارة الأمل', ['carpentry'], { status: 'pending' }],
    ['ورشة إصلاح الغسالات', ['appliance'], { status: 'suspended' }],
  ];
  const owners = residents.slice(0, others.length);
  const bizs = others.map(([n, k, o], i) => mkBiz(v, d.users.find(u => u.id === owners[i].user_id), n, k, o));

  // requests of the last 3 days; gas is the busiest
  const weights = [['gas', 30], ['grocery', 8], ['water', 6], ['vegetables', 4], ['plumbing', 3], ['electric', 2], ['transport', 3], ['bakery', 2], ['books', 2], ['nursing', 2], ['tractor', 2], ['vet', 1], ['internet', 1]];
  const total = weights.reduce((s, w) => s + w[1], 0);
  const DETAILS = { gas: ['أسطوانة واحدة', 'أسطوانتان', 'أسطوانة واحدة، الأمر عاجل'], grocery: ['طبق بيض وزيت', 'سكر ٢ كيلو وأرز', 'طبق بيض'], water: ['عبوة ٢٠ لترًا', 'صندوق مياه'],
    vegetables: ['طماطم وبطاطس', 'خضروات للطهي'], plumbing: ['صنبور يسرّب الماء', 'خزان المرحاض معطل'], electric: ['مقبس كهرباء محترق'], transport: ['مشوار إلى المركز الساعة ٨'],
    bakery: ['٢٠ رغيفًا'], books: ['كراسات وأقلام للمدرسة'], nursing: ['حقنة في المنزل'], tractor: ['حرث فدان واحد'], vet: ['جاموسة مريضة'], internet: ['تركيب جهاز راوتر'] };
  const pool = [...residents, fatmaM];
  for (let i = 0; i < 62; i++) {
    let x = R() * total, key = 'gas';
    for (const [k, w] of weights) { if ((x -= w) <= 0) { key = k; break; } }
    const m = pool[Math.floor(R() * pool.length)];
    const h = Math.round(R() * 70) + 0.5;
    const r = { id: uuid(), group_id: v.id, category_id: cat(v, key), details: pick(DETAILS[key]), quantity: key === 'gas' ? 1 + (R() < 0.25 ? 1 : 0) : 1,
      lat: +(m.home_lat + (R() - 0.5) * 0.0001).toFixed(6), lng: +(m.home_lng + (R() - 0.5) * 0.0001).toFixed(6), location_note: m.home_note,
      needed_by: null, expires_at: new Date(T - h * 3600000 + REQUEST_DAYS * DAY).toISOString(), status: 'open', business_id: null,
      accepted_at: null, delivered_at: null, cancelled_at: null, created_at: ago(h), created_by: m.user_id };
    const roll = R();
    if (key === 'gas' && roll < 0.18) Object.assign(r, { status: 'accepted', business_id: gasH.id, accepted_at: ago(h * 0.5) });
    else if (key === 'gas' && roll < 0.3) Object.assign(r, { status: 'delivered', business_id: gasH.id, accepted_at: ago(h * 0.6), delivered_at: ago(h * 0.3) });
    else if (key === 'grocery' && roll < 0.3) Object.assign(r, { status: 'delivered', business_id: amana.id, accepted_at: ago(h * 0.6), delivered_at: ago(h * 0.4) });
    else if (roll > 0.95) Object.assign(r, { status: 'cancelled', cancelled_at: ago(h * 0.5) });
    d.requests.push(r);
  }
  // Fatma's own: one open, one accepted, one delivered
  const fr = (key, status, h, det) => d.requests.push({ id: uuid(), group_id: v.id, category_id: cat(v, key), details: det, quantity: 1, lat: fatmaM.home_lat, lng: fatmaM.home_lng,
    location_note: fatmaM.home_note, needed_by: null, expires_at: new Date(T - h * 3600000 + REQUEST_DAYS * DAY).toISOString(), status,
    business_id: status === 'open' ? null : (key === 'gas' ? gasH.id : amana.id), accepted_at: status === 'open' ? null : ago(h - 1),
    delivered_at: status === 'delivered' ? ago(h - 2) : null, cancelled_at: null, created_at: ago(h), created_by: fatma.id });
  fr('water', 'open', 3, 'عبوة مياه ٢٠ لترًا');
  fr('gas', 'accepted', 6, 'أسطوانة واحدة');
  fr('grocery', 'delivered', 30, 'طبق بيض وزيت');

  /* ---- village 2: small, mayor is a plain resident there ---- */
  const omar = mkUser('عمر الصفصافي', 'omda2@demo.test');
  const v2 = mkVillage('عزبة الصفصاف', 30.9180, 31.0705, omar, 'active', 20);
  mkMember(v2, omar, 'owner'); mkMember(v2, mayor, 'member'); mkMember(v2, fatma, 'member', 'pending', 12);
  mkPlace(v2, 'mosque', 'مسجد العزبة', 0.0003, 0.0002);
  mkPlace(v2, 'health', 'عيادة د. سامي', -0.0011, 0.0008);
  mkPlace(v2, 'school', 'مدرسة الصفصاف', 0.0014, -0.0012);
  mkBiz(v2, omar, 'بقالة العزبة', ['grocery', 'gas'], {});

  /* ---- village 3: disabled (for the platform owner page) ---- */
  const ali = mkUser('علي الجمّال', 'omda3@demo.test');
  const v3 = mkVillage('نجع الجميزة', 30.8710, 31.0150, ali, 'disabled', 90);
  mkMember(v3, ali, 'owner');

  // a short history for the activity log
  d.activity_log.push(
    { id: uuid(), group_id: v.id, actor: mayor.id, action: 'approve', entity: 'memberships', entity_id: fatmaM.id, before: { status: 'pending' }, after: { status: 'approved' }, created_at: ago(24 * 29), created_by: mayor.id },
    { id: uuid(), group_id: v.id, actor: mayor.id, action: 'set_status', entity: 'businesses', entity_id: gasH.id, before: { status: 'pending' }, after: { status: 'verified' }, created_at: ago(24 * 20), created_by: mayor.id },
    { id: uuid(), group_id: v.id, actor: helper.id, action: 'set_status', entity: 'businesses', entity_id: bizs[bizs.length - 1].id, before: { status: 'verified' }, after: { status: 'suspended' }, created_at: ago(24 * 4), created_by: helper.id },
  );
  for (const r of d.requests) if (r.status !== 'open') d.activity_log.push({ id: uuid(), group_id: r.group_id, actor: r.created_by, action: r.status === 'cancelled' ? 'cancel' : r.status === 'delivered' ? 'deliver' : 'accept',
    entity: 'requests', entity_id: r.id, before: { status: 'open' }, after: { status: r.status }, created_at: r.delivered_at || r.accepted_at || r.cancelled_at, created_by: r.created_by });
  d.activity_log.sort((a, b) => b.created_at.localeCompare(a.created_at));

  d.session = mayor.id;
  return d;
}

db = load();
