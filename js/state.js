// Shared app state. Views read from here; app.js keeps it fresh.
export const state = {
  user: null,          // { id, email }
  profile: null,       // { full_name, phone, lang }
  groups: [],          // [{ ...group, membership }]
  group: null,         // the selected village
  membership: null,    // my membership in it
  categories: [],      // categories of the selected village
  myBusinesses: [],    // my businesses in the selected village
  platformAdmin: false,
  here: null,          // last known GPS position {lat,lng}
};

export const role = () => state.membership?.status === 'approved' ? state.membership.role : null;
export const isAdmin = () => ['owner', 'admin'].includes(role());
export const isOwner = () => role() === 'owner';
export const canWrite = () => ['owner', 'admin', 'member'].includes(role());
export const verifiedBusinesses = () => state.myBusinesses.filter(b => b.status === 'verified');
export const catById = id => state.categories.find(c => c.id === id);
export const center = () => state.group ? { lat: state.group.center_lat, lng: state.group.center_lng } : null;

/** Query string inside the hash: #/directory?cat=123 */
export const query = () => new URLSearchParams(location.hash.split('?')[1] || '');

export function go(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

/** Ask the browser for the current position once; resolves null on failure. */
export function locate() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => { state.here = { lat: p.coords.latitude, lng: p.coords.longitude }; resolve(state.here); },
      () => resolve(null), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}
