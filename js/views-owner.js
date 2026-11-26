// Platform owner page (#/owner): only users listed in platform_admins. Reads via security definer functions.
import { db } from './data.js';
import { state, go } from './state.js';
import { t } from './i18n.js';
import { h, clear, toast, errToast, empty, toolbar, statusChip, confirmDialog, fmtNum, fmtDate, timeAgo, selectEl, sep } from './ui.js';
import { describeActivity } from './views-admin.js';

export async function render(main) {
  if (!state.platformAdmin) return go('#/');
  const [stats, groups] = await Promise.all([db.platformStats(), db.platformGroups('')]);
  const stat = (label, n) => h('div', { class: 'stat' }, h('strong', null, fmtNum(n)), h('span', null, label));
  const max = Math.max(1, ...stats.weeks.map(w => w.activity));
  const chart = h('div', { class: 'bars', role: 'img', 'aria-label': t('owner.weekly') }, stats.weeks.map(w =>
    h('div', { class: 'bar', title: `${w.week}: ${w.activity}${sep()}+${w.new_users} ${t('owner.users')}` },
      h('span', { class: 'bar-fill', style: `height:${Math.round(w.activity / max * 100)}%` }), h('small', null, w.week.slice(5)))));
  const table = h('div', { class: 'list' });
  const actList = h('div', { class: 'list' });
  let rows = groups, st = { q: '', status: 'all' };
  const bar = toolbar({ placeholder: t('owner.search'), onChange: async s => {
    const qChanged = s.q !== st.q; st = s;
    if (qChanged) { try { rows = await db.platformGroups(s.q); } catch (e) { errToast(e); } }
    paint();
  }, selects: [{ name: 'status', label: t('common.filter'), options: [{ value: 'all', label: t('req.fAll') }, { value: 'active', label: t('status.active') }, { value: 'disabled', label: t('status.disabled') }] }] });
  const actFilter = selectEl([{ value: '', label: t('owner.allVillages') }, ...groups.map(g => ({ value: g.id, label: g.name }))], '', { 'aria-label': t('owner.activity'), onchange: e => loadActivity(e.target.value || null) });

  clear(main).append(h('section', { class: 'page wide' },
    h('h1', null, '🌐 ', t('owner.title')), h('p', { class: 'muted' }, t('owner.help')),
    h('div', { class: 'stats' }, stat(t('owner.villages'), stats.groups), stat(t('owner.activeVillages'), stats.active_groups), stat(t('owner.users'), stats.users),
      stat(t('owner.members'), stats.memberships), stat(t('owner.requests7'), stats.requests_7d)),
    h('div', { class: 'card' }, h('h2', null, t('owner.weekly')), chart),
    h('h2', { class: 'section-title' }, t('owner.villages')), bar, table,
    h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, t('owner.activity')), actFilter), actList));

  function paint() {
    clear(table);
    const r = rows.filter(g => st.status === 'all' || g.status === st.status);
    if (!r.length) { table.append(empty('🔍', t('owner.noVillages'), null)); return; }
    for (const g of r) table.append(h('div', { class: 'list-item col' + (g.status === 'disabled' ? ' dim' : '') },
      h('div', { class: 'row' }, h('span', { class: 'li-icon' }, '🏡'),
        h('div', { class: 'li-main' }, h('strong', null, g.name), h('small', null, [t('owner.mayor', { name: g.owner_name || '—' }), t('owner.since', { d: fmtDate(g.created_at, false) })].join(sep()))),
        statusChip(g.status)),
      h('p', { class: 'small' }, t('owner.villageStats', { m: fmtNum(g.members), p: fmtNum(g.pending), b: fmtNum(g.businesses), r: fmtNum(g.requests_7d) }),
        g.last_activity ? `${sep()}${t('owner.last', { d: timeAgo(g.last_activity) })}` : ''),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn small ghost', onclick: () => { actFilter.value = g.id; loadActivity(g.id); actFilter.scrollIntoView({ behavior: 'smooth' }); } }, '📜 ', t('owner.activity')),
        h('button', { class: 'btn small ' + (g.status === 'active' ? 'ghost danger' : 'primary'), onclick: async () => {
          const next = g.status === 'active' ? 'disabled' : 'active';
          if (!await confirmDialog(t(next === 'disabled' ? 'owner.disableQ' : 'owner.enableQ', { name: g.name }), { ok: t(next === 'disabled' ? 'owner.disable' : 'owner.enable'), danger: next === 'disabled' })) return;
          try { await db.setGroupStatus(g.id, next); g.status = next; toast(t('common.saved')); paint(); } catch (e) { errToast(e); }
        } }, g.status === 'active' ? t('owner.disable') : t('owner.enable')))));
  }
  async function loadActivity(gid) {
    clear(actList);
    try {
      const rows = await db.platformActivity(gid, 150);
      if (!rows.length) { actList.append(empty('📜', t('admin.noActivity'), null)); return; }
      for (const a of rows) {
        const d = describeActivity(a);
        actList.append(h('div', { class: 'list-item' }, h('div', { class: 'li-main' }, h('strong', null, d.title, d.name ? ` — ${d.name}` : ''),
          h('small', null, [a.group_name, a.actor_name, d.change, fmtDate(a.created_at)].filter(Boolean).join(sep())))));
      }
    } catch (e) { errToast(e); }
  }
  paint(); loadActivity(null);
}
