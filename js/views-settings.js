// "More" page: shortcuts, my details in this village, language, villages, password, demo tools, log out.
import { db, isDemo } from './data.js';
import { state, isAdmin, canWrite, verifiedBusinesses, center, go } from './state.js';
import { t, setLang, getLang } from './i18n.js';
import { h, clear, field, toast, errToast, busy, confirmDialog, download, pickFile, stamp, statusChip, joinList, sep } from './ui.js';
import { personFields } from './views-auth.js';

const VERSION = '1.2.1';

export async function render(main, _p, ctx) {
  const approved = state.membership?.status === 'approved';
  const link = (href, icon, label, sub) => h('a', { href, class: 'list-item' }, h('span', { class: 'li-icon' }, icon),
    h('div', { class: 'li-main' }, h('strong', null, label), sub ? h('small', null, sub) : null), h('span', { class: 'chev' }, '›'));

  const shortcuts = h('div', { class: 'list' },
    approved ? link('#/directory', '📒', t('nav.directory'), t('settings.directorySub')) : null,
    approved && canWrite() ? link('#/my-business', '🏪', t('biz.mineTitle'), state.myBusinesses.length ? joinList(state.myBusinesses.map(b => b.name)) : t('settings.bizSub')) : null,
    approved && verifiedBusinesses().length ? link('#/demand', '🔥', t('nav.demand'), t('settings.demandSub')) : null,
    approved && isAdmin() ? link('#/admin', '🛡️', t('admin.title'), t('settings.adminSub')) : null,
    state.platformAdmin ? link('#/owner', '🌐', t('owner.title'), t('settings.ownerSub')) : null);

  // language
  const langSeg = h('div', { class: 'seg' }, [['ar', 'العربية'], ['en', 'English']].map(([code, label]) =>
    h('button', { type: 'button', class: 'seg-btn' + (getLang() === code ? ' on' : ''), onclick: () => { setLang(code); db.saveProfile({ lang: code }).catch(() => {}); } }, label)));

  // villages
  const villages = h('div', { class: 'list' }, state.groups.map(g => h('div', { class: 'list-item' },
    h('span', { class: 'li-icon' }, '🏡'), h('div', { class: 'li-main' }, h('strong', null, g.name), h('small', null, t('role.' + g.membership.role))),
    g.membership.status !== 'approved' ? statusChip(g.membership.status) : null,
    g.id !== state.group?.id ? h('button', { class: 'btn small', onclick: () => ctx.switchGroup(g.id) }, t('settings.open')) : h('span', { class: 'chip ok' }, t('settings.current')),
    g.membership.role !== 'owner' ? h('button', { class: 'btn small ghost danger', onclick: async () => {
      if (!await confirmDialog(t('settings.leaveQ', { name: g.name }), { ok: t('settings.leave'), danger: true })) return;
      try { await db.leaveGroup(g.id); localStorage.removeItem('vg-group'); await ctx.refresh(); toast(t('settings.left')); go('#/'); } catch (e) { errToast(e); }
    } }, t('settings.leave')) : null)));

  // my details in this village
  const meBox = h('div', { class: 'stack' });
  const meBtn = h('button', { class: 'btn primary', type: 'submit' }, t('common.save'));
  const meForm = h('form', { class: 'stack' }, meBox, h('p', { class: 'hint' }, t('settings.meHint')), meBtn);

  // password
  const pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8, required: true, dir: 'ltr' });
  const pwBtn = h('button', { class: 'btn', type: 'submit' }, t('auth.savePassword'));
  const pwForm = h('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault(); busy(pwBtn, true);
    try { await db.updatePassword(pw.value); pw.value = ''; toast(t('auth.passwordSaved')); } catch (err) { errToast(err); } finally { busy(pwBtn, false); }
  } }, field(t('auth.newPassword'), pw, t('auth.pwHint')), pwBtn);

  clear(main).append(h('section', { class: 'page' },
    h('h1', null, t('nav.more')),
    h('p', { class: 'muted' }, state.user.email),
    shortcuts.childNodes.length ? shortcuts : null,
    h('div', { class: 'card' }, h('h2', null, '🌐 ', t('settings.language')), langSeg),
    state.group ? h('div', { class: 'card' }, h('h2', null, '🙋 ', t('settings.me', { name: state.group.name })), meForm) : null,
    h('div', { class: 'card' }, h('h2', null, '🏡 ', t('settings.villages')), villages,
      h('a', { href: '#/start', class: 'btn block' }, '＋ ', t('start.addVillage'))),
    h('details', { class: 'card' }, h('summary', null, h('h2', null, '🔒 ', t('settings.password'))), pwForm),
    isDemo ? h('div', { class: 'card' }, h('h2', null, '🧪 ', t('demo.tools')), h('p', { class: 'muted' }, t('demo.toolsHelp')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: () => download(`village-gate-demo-${stamp()}.json`, JSON.stringify(db.demoExportAll())) }, '💾 ', t('demo.backup')),
        h('button', { class: 'btn', onclick: async () => {
          const f = await pickFile('application/json,.json'); if (!f) return;
          try { db.demoImportAll(JSON.parse(await f.text())); await ctx.refresh(); toast(t('demo.restored')); go('#/'); } catch (e) { errToast(e.message === 'invalid_backup' ? e : new Error('invalid_backup')); }
        } }, '📂 ', t('demo.restore')),
        h('button', { class: 'btn ghost danger', onclick: async () => {
          if (!await confirmDialog(t('demo.resetQ'), { ok: t('demo.reset'), danger: true })) return;
          db.demoReset(); localStorage.removeItem('vg-group'); await ctx.refresh(); toast(t('demo.wasReset')); go('#/');
        } }, '↺ ', t('demo.reset')))) : null,
    h('button', { class: 'btn block ghost danger', onclick: async () => {
      if (!await confirmDialog(t('settings.logoutQ'), { ok: t('settings.logout') })) return;
      await db.signOut(); localStorage.removeItem('vg-group'); go('#/welcome');
    } }, '⎋ ', t('settings.logout')),
    h('p', { class: 'center muted small' }, [t('app.name'), 'v' + VERSION, 'MIT'].join(sep()))));

  if (state.group) {
    const m = state.membership;
    const person = await personFields(meBox, { center: center(), value: m });
    meForm.onsubmit = async e => {
      e.preventDefault();
      try {
        const p = person.read(); busy(meBtn, true);
        await db.updateMyMembership(state.group.id, p); await ctx.refresh(); toast(t('common.saved'));
      } catch (err) { errToast(err); } finally { busy(meBtn, false); }
    };
  }
}
