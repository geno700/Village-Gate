// "I need…" request form and the list of my requests.
import { db } from './data.js';
import { state, catById, center, go, query, canWrite } from './state.js';
import { t, catName, sectorName, sectorIcon, getLang } from './i18n.js';
import { SECTORS, SEARCH_WORDS, POPULAR } from './shared.js';
import { h, clear, field, selectEl, toast, errToast, busy, empty, toolbar, matches, timeAgo, fmtDate, fmtNum, statusChip,
  confirmDialog, telLink, downloadCSV, stamp, sep, normText } from './ui.js';
import { locationPicker } from './map.js';

const homeOf = () => state.membership?.home_lat != null ? { lat: state.membership.home_lat, lng: state.membership.home_lng } : null;

/* ---------------------------------------------------------------- "what do you need?" picker */
/** Services offered by verified businesses: { categoryId: count } */
export const providerCounts = businesses => {
  const n = {};
  for (const b of businesses) if (b.status === 'verified') for (const id of b.category_ids) n[id] = (n[id] || 0) + 1;
  return n;
};
/** The services to show first: the ones the village actually has, then the usual favourites. */
export function popularServices(services, counts, max = 8) {
  const pop = c => { const i = POPULAR.indexOf(c.key); return i < 0 ? 99 : i; };
  const ranked = services.filter(c => counts[c.id]).sort((a, b) => pop(a) - pop(b) || counts[b.id] - counts[a.id] || a.sort - b.sort);
  for (const key of POPULAR) { const c = services.find(x => x.key === key); if (c && !ranked.includes(c)) ranked.push(c); }
  return ranked.slice(0, max);
}
// word-start matching ("tractor" should not find "contractor"); Arabic "ال" and "و" prefixes are ignored
const tokens = text => normText(text).split(/[\s,،&/()-]+/).filter(Boolean).flatMap(w => [w, w.replace(/^(و?ال|و)/, '')]);
const serviceTokens = c => tokens([c.name_ar, c.name_en, SEARCH_WORDS[c.key], sectorName(c.sector)].join(' '));
const hitsWord = (toks, w) => { const q = normText(w).replace(/^(و?ال)/, ''); return q.length > 1 && toks.some(x => x.startsWith(q)); };

function needPicker(main, services, counts) {
  const tile = c => h('a', { href: `#/request/new?cat=${c.id}`, class: 'tile' },
    h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, c.icon), h('span', { class: 'tile-label' }, catName(c)),
    counts[c.id] ? h('span', { class: 'tile-badge' }, t('need.providersN', { n: fmtNum(counts[c.id]) })) : null);
  const body = h('div', { class: 'stack' });
  const q = h('input', { type: 'search', class: 'need-search', placeholder: t('need.searchPh'), 'aria-label': t('need.title'), oninput: () => paint() });
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = Speech ? h('button', { type: 'button', class: 'mic-btn', 'aria-label': t('need.speak'), onclick: () => {
    const rec = new Speech();
    rec.lang = getLang() === 'ar' ? 'ar-EG' : 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
    mic.classList.add('on'); q.placeholder = t('need.listening');
    rec.onresult = e => { q.value = e.results[0][0].transcript; paint(); };
    rec.onerror = () => toast(t('err.no_speech'), 'err');
    rec.onend = () => { mic.classList.remove('on'); q.placeholder = t('need.searchPh'); };
    rec.start();
  } }, '🎤') : null;
  let sector = null;
  function paint() {
    clear(body);
    const text = q.value.trim();
    if (text) {
      const words = text.split(/\s+/).filter(w => w.length > 1);
      const hits = services.filter(c => { const toks = serviceTokens(c); return words.some(w => hitsWord(toks, w)); })
        .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));
      body.append(h('h2', { class: 'section-title' }, t('need.results')),
        hits.length ? h('div', { class: 'tiles' }, hits.slice(0, 24).map(tile)) : h('p', { class: 'note' }, t('need.noMatch')));
      if (!hits.length) { const other = services.find(c => c.key === 'other'); if (other) body.append(h('div', { class: 'tiles' }, tile(other))); }
      return;
    }
    if (sector) {
      body.append(h('button', { type: 'button', class: 'btn ghost small', onclick: () => { sector = null; paint(); } }, t('common.back')),
        h('h2', { class: 'section-title' }, sectorIcon(sector), ' ', sectorName(sector)),
        h('div', { class: 'tiles' }, services.filter(c => (c.sector || 'other') === sector).map(tile)));
      return;
    }
    body.append(h('h2', { class: 'section-title' }, t('need.popular')), h('div', { class: 'tiles' }, popularServices(services, counts).map(tile)),
      h('h2', { class: 'section-title' }, t('need.sectors')),
      h('div', { class: 'tiles sectors' }, SECTORS.filter(([k]) => services.some(c => (c.sector || 'other') === k)).map(([k, icon]) =>
        h('button', { type: 'button', class: 'tile', onclick: () => { sector = k; paint(); main.scrollIntoView({ block: 'start' }); } },
          h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, icon), h('span', { class: 'tile-label' }, sectorName(k))))));
  }
  clear(main).append(h('section', { class: 'page' }, h('h1', null, t('need.title')),
    h('div', { class: 'need-bar' }, q, mic), body));
  paint();
}

/* ---------------------------------------------------------------- new request */
export async function newRequest(main) {
  if (!canWrite()) return go('#/');
  const gid = state.group.id;
  const services = state.categories.filter(c => c.kind === 'service' && c.active);
  const businesses = await db.listBusinesses(gid);
  const counts = providerCounts(businesses);
  const chosen = services.find(c => c.id === query().get('cat'));
  if (!chosen) return needPicker(main, services, counts);
  const cat = { value: chosen.id };
  const nProv = counts[chosen.id] || 0;
  const providersNote = h('p', { class: 'note' + (nProv ? '' : ' warn') }, nProv ? t('req.providers', { n: fmtNum(nProv) }) : t('req.noProviders'));
  const chosenCard = h('div', { class: 'chosen-cat' }, h('span', { class: 'tile-icon' }, chosen.icon),
    h('div', { class: 'li-main' }, h('strong', null, catName(chosen)), h('small', null, sectorName(chosen.sector))),
    h('a', { href: '#/request/new', class: 'btn small ghost' }, t('need.change')));

  let qty = 1;
  const qtyOut = h('output', { class: 'qty-out', 'aria-live': 'polite' }, fmtNum(qty));
  const setQty = n => { qty = Math.max(1, Math.min(99, n)); qtyOut.textContent = fmtNum(qty); };
  const qtyInput = h('div', { class: 'stepper' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('req.less'), onclick: () => setQty(qty - 1) }, '−'), qtyOut,
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('req.more'), onclick: () => setQty(qty + 1) }, '+'));
  const details = h('textarea', { rows: 2, maxlength: 300, placeholder: t('req.detailsPh') });
  const when = selectEl([{ value: '', label: t('req.whenAny') }, { value: '2h', label: t('req.when2h') }, { value: 'today', label: t('req.whenToday') }, { value: 'tomorrow', label: t('req.whenTomorrow') }], '');

  const home = homeOf();
  let useHome = !!home;
  const pickBox = h('div', { hidden: useHome });
  const note = h('input', { maxlength: 200, value: state.membership.home_note || '', placeholder: t('join.homeNotePh') });
  const whereSel = home ? h('div', { class: 'seg', role: 'radiogroup' },
    h('button', { type: 'button', class: 'seg-btn on', role: 'radio', 'aria-checked': 'true', onclick: e => setWhere(true, e.target) }, '🏠 ', t('req.atHome')),
    h('button', { type: 'button', class: 'seg-btn', role: 'radio', 'aria-checked': 'false', onclick: e => setWhere(false, e.target) }, '📍 ', t('req.elsewhere'))) : null;
  let picker = null;
  async function setWhere(h_, btn) {
    useHome = h_;
    whereSel.querySelectorAll('.seg-btn').forEach(b => { b.classList.toggle('on', b === btn.closest('.seg-btn')); b.setAttribute('aria-checked', b === btn.closest('.seg-btn')); });
    pickBox.hidden = useHome;
    if (!useHome && !picker) picker = await locationPicker(pickBox, { center: home || center(), emoji: '📍' });
  }

  const btn = h('button', { class: 'btn primary block big', type: 'submit' }, t('req.send'));
  const form = h('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault();
    try {
      const loc = useHome ? home : picker?.get();
      if (!loc) throw new Error('location_required');
      const neededBy = (() => {
        const d = new Date();
        if (when.value === '2h') return new Date(Date.now() + 2 * 3600000).toISOString();
        if (when.value === 'today') { d.setHours(23, 0, 0, 0); return d.toISOString(); }
        if (when.value === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(14, 0, 0, 0); return d.toISOString(); }
        return null;
      })();
      busy(btn, true);
      await db.createRequest(gid, { category_id: cat.value, details: details.value, quantity: qty, lat: loc.lat, lng: loc.lng, location_note: note.value, needed_by: neededBy });
      toast(t('req.sent')); go('#/requests');
    } catch (err) { errToast(err); } finally { busy(btn, false); }
  } },
  h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('req.what')), chosenCard), providersNote,
  h('div', { class: 'row gap' }, h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('req.qty')), qtyInput), field(t('req.when'), when)),
  field(t('req.details'), details),
  h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('req.where')), whereSel, pickBox),
  field(t('join.homeNote'), note),
  h('p', { class: 'hint privacy' }, '🔒 ', t('req.privacy')),
  btn);

  clear(main).append(h('section', { class: 'page' }, h('h1', null, t('req.newTitle')), h('div', { class: 'card' }, form)));
  if (!home) picker = await locationPicker(pickBox, { center: center(), emoji: '📍' });
}

/* ---------------------------------------------------------------- my requests */
export async function myRequests(main) {
  const gid = state.group.id;
  const [rows, businesses] = await Promise.all([db.myRequests(gid), db.listBusinesses(gid)]);
  const bizName = id => businesses.find(b => b.id === id);
  const list = h('div', { class: 'list' });
  let st = { q: '', status: 'active', sort: 'new' };
  const bar = toolbar({ placeholder: t('req.search'), onChange: s => { st = s; paint(); }, selects: [
    { name: 'status', label: t('common.filter'), value: 'active', options: [{ value: 'active', label: t('req.fActive') }, { value: 'all', label: t('req.fAll') },
      ...['open', 'accepted', 'delivered', 'cancelled', 'expired'].map(s => ({ value: s, label: t('status.' + s) }))] },
    { name: 'sort', label: t('common.sort'), options: [{ value: 'new', label: t('common.newest') }, { value: 'old', label: t('common.oldest') }] },
  ] });

  function paint() {
    let r = rows.filter(x => matches(st.q, x.details, catName(catById(x.category_id)), x.location_note));
    if (st.status === 'active') r = r.filter(x => ['open', 'accepted'].includes(x.status));
    else if (st.status !== 'all') r = r.filter(x => x.status === st.status);
    r.sort((a, b) => st.sort === 'new' ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at));
    clear(list);
    if (!r.length) {
      list.append(rows.length
        ? empty('🧾', t('req.emptyFiltered'), t('req.emptyFilteredHelp'))
        : empty('🧾', t('req.emptyTitle'), t('req.emptyHelp'), canWrite() ? h('a', { href: '#/request/new', class: 'btn primary' }, t('req.newTitle')) : null));
      return;
    }
    for (const x of r) {
      const c = catById(x.category_id), b = bizName(x.business_id);
      const actions = h('div', { class: 'row wrap' });
      if (x.status === 'accepted') {
        if (b?.phone) actions.append(h('a', { href: telLink(b.phone), class: 'btn small' }, '📞 ', b.name));
        actions.append(h('button', { class: 'btn small primary', onclick: async () => {
          try { await db.deliverRequest(x.id); x.status = 'delivered'; x.delivered_at = new Date().toISOString(); toast(t('req.thanks')); paint(); } catch (e) { errToast(e); }
        } }, '✔ ', t('req.received')));
      }
      if (['open', 'accepted'].includes(x.status)) actions.append(h('button', { class: 'btn small ghost danger', onclick: async () => {
        if (!await confirmDialog(t('req.cancelQ'), { ok: t('req.cancel'), danger: true })) return;
        try { await db.cancelRequest(x.id); x.status = 'cancelled'; toast(t('req.cancelled')); paint(); } catch (e) { errToast(e); }
      } }, t('req.cancel')));
      if (['delivered', 'cancelled', 'expired'].includes(x.status) && canWrite()) actions.append(h('a', { href: `#/request/new?cat=${x.category_id}`, class: 'btn small ghost' }, '↻ ', t('req.again')));
      list.append(h('div', { class: 'list-item col' },
        h('div', { class: 'row' }, h('span', { class: 'li-icon' }, c?.icon || '•'),
          h('div', { class: 'li-main' }, h('strong', null, catName(c), x.quantity > 1 ? ` × ${fmtNum(x.quantity)}` : ''),
            h('small', null, [x.details, timeAgo(x.created_at)].filter(Boolean).join(sep()))), statusChip(x.status)),
        x.status === 'accepted' && b ? h('p', { class: 'small' }, t('req.acceptedBy', { name: b.name })) : null,
        x.status === 'open' ? h('p', { class: 'small muted' }, t('req.openHelp', { date: fmtDate(x.expires_at) })) : null,
        actions.childNodes.length ? actions : null));
    }
  }
  const exportBtn = h('button', { type: 'button', class: 'btn ghost small', onclick: () => downloadCSV(`my-requests-${stamp()}.csv`, rows, [
    { label: t('csv.date'), get: r => r.created_at }, { label: t('csv.category'), get: r => catName(catById(r.category_id)) }, { label: t('csv.qty'), key: 'quantity' },
    { label: t('csv.details'), key: 'details' }, { label: t('csv.status'), get: r => t('status.' + r.status) }, { label: t('csv.business'), get: r => bizName(r.business_id)?.name || '' }]) }, '⬇ CSV');
  clear(main).append(h('section', { class: 'page' },
    h('div', { class: 'section-head' }, h('h1', null, t('req.mineTitle')), exportBtn),
    canWrite() ? h('a', { href: '#/request/new', class: 'btn primary block' }, '＋ ', t('req.newTitle')) : null,
    bar, list));
  paint();
}
