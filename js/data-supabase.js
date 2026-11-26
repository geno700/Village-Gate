// Supabase backend. Same `api` shape as data-demo.js. All permission checks live in the
// database (RLS + security definer functions in supabase/schema.sql); this file only calls them.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: { schema: 'village_gate' },
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
const redirect = () => location.origin + location.pathname;

/** Open requests past their 3 days show as expired (the database marks them when a seller next looks). */
const expired = rows => { const now = Date.now(); for (const r of rows) if (r.status === 'open' && Date.parse(r.expires_at) < now) r.status = 'expired'; return rows; };

/** Unwrap a supabase response; database `raise exception 'code'` arrives as error.message = 'code'. */
function un({ data, error }) {
  if (error) {
    const msg = error.message || '';
    if (/Invalid login credentials/i.test(msg)) throw new Error('invalid_login');
    if (/already registered/i.test(msg)) throw new Error('email_taken');
    if (/Password should be/i.test(msg)) throw new Error('weak_password');
    if (/Email not confirmed/i.test(msg)) throw new Error('email_not_confirmed');
    if (/row-level security|permission denied/i.test(msg)) throw new Error('forbidden');
    if (/violates check constraint/i.test(msg)) throw new Error('invalid_input');
    if (/duplicate key/i.test(msg)) throw new Error('duplicate');
    throw new Error(msg || 'unknown');
  }
  return data;
}
const rpc = (fn, args) => sb.rpc(fn, args).then(un);
let uid = null;
sb.auth.onAuthStateChange((_e, s) => { uid = s?.user?.id || null; });

export const api = {
  mode: 'supabase',

  /* ----- auth ----- */
  async getUser() {
    const { data } = await sb.auth.getSession();
    const u = data.session?.user; uid = u?.id || null;
    // after the PKCE redirect, drop ?code= from the address bar
    if (u && new URLSearchParams(location.search).has('code')) history.replaceState(null, '', location.pathname + location.hash);
    return u ? { id: u.id, email: u.email } : null;
  },
  onAuthChange(cb) {
    const { data } = sb.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') { location.hash = '#/new-password'; }
      if (['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'].includes(event)) setTimeout(() => cb(s?.user ? { id: s.user.id, email: s.user.email } : null));
    });
    return () => data.subscription.unsubscribe();
  },
  async signUp({ email, password, full_name }) {
    const data = un(await sb.auth.signUp({ email: email.trim(), password, options: { data: { full_name }, emailRedirectTo: redirect() } }));
    return { needsConfirm: !data.session };
  },
  async signIn({ email, password }) { un(await sb.auth.signInWithPassword({ email: email.trim(), password })); },
  async signOut() { un(await sb.auth.signOut()); },
  async sendReset(email) { un(await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect() })); },
  async updatePassword(password) { un(await sb.auth.updateUser({ password })); },

  /* ----- profile ----- */
  async getProfile() {
    const p = un(await sb.from('profiles').select('id, full_name, phone, lang').eq('id', uid).maybeSingle());
    if (p) return p;
    const { data } = await sb.auth.getUser();
    const row = { id: uid, full_name: data.user?.user_metadata?.full_name || '', lang: 'ar' };
    un(await sb.from('profiles').upsert(row));
    return { ...row, phone: null };
  },
  async saveProfile(p) {
    const row = { id: uid, updated_at: new Date().toISOString() };
    for (const k of ['full_name', 'phone', 'lang']) if (p[k] !== undefined) row[k] = p[k] || (k === 'phone' ? null : p[k]);
    un(await sb.from('profiles').upsert(row));
  },
  async isPlatformAdmin() { return rpc('is_platform_admin'); },

  /* ----- villages ----- */
  async myGroups() {
    const ms = un(await sb.from('memberships').select('*').eq('user_id', uid).in('status', ['approved', 'pending']));
    if (!ms.length) return [];
    const gs = un(await sb.from('groups').select('*').in('id', ms.map(m => m.group_id)));
    return gs.map(g => ({ ...g, membership: ms.find(m => m.group_id === g.id) }));
  },
  async groupByCode(code) { const r = await rpc('group_by_code', { p_code: code }); return r?.[0] || null; },
  async createGroup(p) {
    return rpc('create_group', { p_name: p.name, p_lat: p.center_lat, p_lng: p.center_lng, p_radius: p.radius_m ?? null, p_display_name: p.display_name,
      p_phone: p.phone, p_home_lat: p.home_lat ?? null, p_home_lng: p.home_lng ?? null, p_home_note: p.home_note || '' });
  },
  async joinGroup(p) {
    return rpc('join_group', { p_code: p.code, p_display_name: p.display_name, p_phone: p.phone,
      p_home_lat: p.home_lat ?? null, p_home_lng: p.home_lng ?? null, p_home_note: p.home_note || '' });
  },
  async updateGroup(g, p) {
    return rpc('update_group', { p_group: g, p_name: p.name ?? null, p_lat: p.center_lat ?? null, p_lng: p.center_lng ?? null, p_zoom: p.zoom ?? null, p_radius: p.radius_m ?? null });
  },
  /* the 3D village map: cached on the device and downloaded again only when it changed */
  async getVillageMap(g) {
    const head = un(await sb.from('village_maps').select('updated_at').eq('group_id', g).maybeSingle());
    if (!head) return null;
    const ck = 'vg-map-' + g;
    try { const c = JSON.parse(localStorage.getItem(ck) || 'null'); if (c?.updated_at === head.updated_at) return c.data; } catch { /* re-download */ }
    const row = un(await sb.from('village_maps').select('data, updated_at').eq('group_id', g).single());
    try { localStorage.setItem(ck, JSON.stringify(row)); } catch { /* too big for this device's storage: fine */ }
    return row.data;
  },
  async saveVillageMap(g, map) { return rpc('save_village_map', { p_group: g, p_data: map }); },
  async importPlaces(g, list) { return rpc('import_places', { p_group: g, p_places: list }); },
  async regenerateCode(g) { return rpc('regenerate_join_code', { p_group: g }); },
  async deleteGroup(g) { return rpc('delete_group', { p_group: g }); },
  async transferOwnership(g, membershipId) { return rpc('transfer_ownership', { p_group: g, p_membership: membershipId }); },
  async leaveGroup(g) { return rpc('leave_group', { p_group: g }); },
  async updateMyMembership(g, p) {
    return rpc('update_my_membership', { p_group: g, p_display_name: p.display_name, p_phone: p.phone,
      p_home_lat: p.home_lat ?? null, p_home_lng: p.home_lng ?? null, p_home_note: p.home_note || '' });
  },

  /* ----- members ----- */
  async listMembers(g) { return un(await sb.from('memberships').select('*').eq('group_id', g).order('created_at', { ascending: false })); },
  async approveMember(id, role = 'member') { return rpc('approve_member', { p_membership: id, p_role: role }); },
  async rejectMember(id) { return rpc('reject_member', { p_membership: id }); },
  async setMemberRole(id, role) { return rpc('set_member_role', { p_membership: id, p_role: role }); },
  async removeMember(id) { return rpc('remove_member', { p_membership: id }); },

  /* ----- categories & places ----- */
  async listCategories(g) { return un(await sb.from('categories').select('*').eq('group_id', g).order('sort')); },
  async saveCategory(g, c) {
    const row = { key: c.key, kind: c.kind, sector: c.kind === 'place' ? 'places' : (c.sector || 'other'), icon: c.icon || '•', name_en: c.name_en?.trim(), name_ar: c.name_ar?.trim(), sort: c.sort | 0, active: c.active !== false };
    if (c.id) { const { key, kind, ...editable } = row; un(await sb.from('categories').update(editable).eq('id', c.id).eq('group_id', g)); return c.id; }
    return un(await sb.from('categories').insert({ ...row, group_id: g }).select('id').single()).id;
  },
  async listPlaces(g) { return un(await sb.from('places').select('*').eq('group_id', g).eq('status', 'approved')); },
  /** Suggested places waiting for the mayor: all of them for admins, only my own for residents. */
  async listPlaceSuggestions(g) { return un(await sb.from('places').select('*').eq('group_id', g).eq('status', 'pending').order('created_at', { ascending: false })); },
  async suggestPlace(g, p) {
    return rpc('suggest_place', { p_group: g, p_category: p.category_id, p_name: (p.name || '').trim(), p_lat: p.lat, p_lng: p.lng, p_note: (p.note || '').trim() });
  },
  async reviewPlace(id, approve) { return rpc('review_place', { p_place: id, p_approve: !!approve }); },
  async savePlace(g, p) {
    const row = { category_id: p.category_id, name: p.name?.trim(), phone: p.phone || null, lat: p.lat, lng: p.lng, note: (p.note || '').trim() };
    if (p.id) { un(await sb.from('places').update(row).eq('id', p.id).eq('group_id', g)); return p.id; }
    return un(await sb.from('places').insert({ ...row, group_id: g }).select('id').single()).id;
  },
  async deletePlace(id) { un(await sb.from('places').delete().eq('id', id)); },

  /* ----- businesses ----- */
  async listBusinesses(g) {
    const rows = un(await sb.from('businesses').select('*, business_categories(category_id)').eq('group_id', g));
    return rows.map(({ business_categories, ...b }) => ({ ...b, category_ids: (business_categories || []).map(x => x.category_id) }));
  },
  async saveBusiness(g, b, categoryIds) {
    return rpc('save_business', { p_group: g, p_id: b.id || null, p_name: b.name, p_description: b.description || '', p_phone: b.phone,
      p_whatsapp: b.whatsapp || null, p_lat: b.lat ?? null, p_lng: b.lng ?? null, p_is_mobile: !!b.is_mobile, p_hours: b.hours || '',
      p_categories: categoryIds });
  },
  async deleteBusiness(id) { return rpc('delete_business', { p_business: id }); },
  async setBusinessStatus(id, status) { return rpc('set_business_status', { p_business: id, p_status: status }); },

  /* ----- requests ----- */
  async myRequests(g) { return expired(un(await sb.from('requests').select('*').eq('group_id', g).eq('created_by', uid).order('created_at', { ascending: false }).limit(300))); },
  async adminRequests(g) {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    return expired(un(await sb.from('requests').select('*').eq('group_id', g).gte('created_at', since).order('created_at', { ascending: false }).limit(2000)));
  },
  async createRequest(g, r) {
    return un(await sb.from('requests').insert({ group_id: g, category_id: r.category_id, details: (r.details || '').trim(), quantity: r.quantity,
      lat: r.lat, lng: r.lng, location_note: (r.location_note || '').trim(), needed_by: r.needed_by || null }).select('id').single()).id;
  },
  async cancelRequest(id) { return rpc('cancel_request', { p_request: id }); },
  async deliverRequest(id) { return rpc('deliver_request', { p_request: id }); },
  async releaseRequest(id) { return rpc('release_request', { p_request: id }); },
  async openDemand(g, businessId, hours = 48) { return rpc('open_demand', { p_group: g, p_business: businessId, p_hours: hours }); },
  async acceptRequests(businessId, ids) { return rpc('accept_requests', { p_business: businessId, p_ids: ids }); },
  async myJobs(businessId) { return rpc('my_jobs', { p_business: businessId }); },

  /* ----- activity, export ----- */
  async listActivity(g, limit = 200) { return un(await sb.from('activity_log').select('*').eq('group_id', g).order('created_at', { ascending: false }).limit(limit)); },
  async exportGroup(g) { return rpc('export_group', { p_group: g }); },
  async importGroup(g, data) { return rpc('import_group', { p_group: g, p_data: data }); },

  /* ----- platform owner ----- */
  async platformStats() { return rpc('platform_stats'); },
  async platformGroups(q = '') { return rpc('platform_groups', { p_query: q }); },
  async setGroupStatus(g, status) { return rpc('platform_set_group_status', { p_group: g, p_status: status }); },
  async platformActivity(g = null, limit = 200) { return rpc('platform_activity', { p_group: g, p_limit: limit }); },
};
