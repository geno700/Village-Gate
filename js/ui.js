// Small DOM + formatting helpers shared by all views. No user data is ever put in innerHTML.
import { t, getLang } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** h('div', {class:'x', onclick: fn}, 'text', child) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'required' || k === 'hidden') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

/** List separator: Arabic comma in Arabic (a middle dot looks like the Arabic zero ٠). */
export const sep = () => getLang() === 'ar' ? '، ' : ' · ';
/** Join a list of words in the current language (Arabic comma in Arabic). */
export const joinList = items => items.join(getLang() === 'ar' ? '، ' : ', ');

/* ---------- digits, phones, numbers ---------- */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩', FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export function normDigits(s) {
  return String(s ?? '')
    .replace(/[٠-٩]/g, d => AR_DIGITS.indexOf(d))
    .replace(/[۰-۹]/g, d => FA_DIGITS.indexOf(d))
    .replace(/٫/g, '.').replace(/٬/g, ',');
}
export function normPhone(s) {
  let p = normDigits(s).replace(/[^\d+]/g, '');
  if (p.startsWith('+20')) p = '0' + p.slice(3);
  else if (p.startsWith('0020')) p = '0' + p.slice(4);
  else if (p.startsWith('20') && p.length === 12) p = '0' + p.slice(2);
  return p.replace(/\+/g, '');
}
export const isPhone = p => /^01[0125]\d{8}$/.test(p);
export function toInt(s) { const n = parseInt(normDigits(s), 10); return Number.isFinite(n) ? n : null; }

export function fmtNum(n) {
  return new Intl.NumberFormat(getLang() === 'ar' ? 'ar-EG' : 'en-US').format(n);
}
export function fmtDate(d, withTime = true) {
  if (!d) return '';
  const opts = withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' };
  return new Intl.DateTimeFormat(getLang() === 'ar' ? 'ar-EG' : 'en-GB', opts).format(new Date(d));
}
export function timeAgo(d) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(getLang() === 'ar' ? 'ar-EG' : 'en', { numeric: 'auto' });
  const abs = Math.abs(s), sign = s > 0 ? -1 : 1;
  if (abs < 60) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(sign * Math.round(abs / 60), 'minute');
  if (abs < 86400) return rtf.format(sign * Math.round(abs / 3600), 'hour');
  return rtf.format(sign * Math.round(abs / 86400), 'day');
}
export function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export function fmtDistance(km) {
  if (km == null) return '';
  return km < 1 ? `${fmtNum(Math.round(km * 1000))} ${t('unit.m')}` : `${fmtNum(Math.round(km * 10) / 10)} ${t('unit.km')}`;
}
/** Search match that ignores Arabic letter variants and case. */
export function normText(s) {
  return normDigits(s).toLowerCase()
    .replace(/[أإآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[ً-ْ]/g, '');
}
export const matches = (q, ...fields) => !q || fields.some(f => normText(f || '').includes(normText(q)));

/* ---------- toasts & dialogs ---------- */
export function toast(msg, type = 'ok') {
  let box = $('#toasts');
  if (!box) { box = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const el = h('div', { class: `toast ${type}` }, msg);
  box.append(el);
  setTimeout(() => el.classList.add('out'), type === 'err' ? 4500 : 2600);
  setTimeout(() => el.remove(), type === 'err' ? 5000 : 3100);
}
export function errToast(e) {
  console.error(e);
  const m = e?.message || String(e);
  toast(t('err.' + m, null, m), 'err');
}

export function modal(title, body, actions = []) {
  const dlg = h('dialog', { class: 'modal' });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(
    h('form', { method: 'dialog', class: 'modal-inner', onsubmit: e => e.preventDefault() },
      h('header', { class: 'modal-head' }, h('h2', null, title),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('common.close'), onclick: close }, '✕')),
      h('div', { class: 'modal-body' }, body),
      actions.length ? h('footer', { class: 'modal-foot' }, actions.map(a =>
        h('button', { type: a.submit ? 'submit' : 'button', class: `btn ${a.kind || ''}`, onclick: async e => {
          if (a.onClick) { const keep = await a.onClick(e); if (keep === false) return; }
          close();
        } }, a.label))) : null));
  dlg.addEventListener('cancel', () => setTimeout(close));
  document.body.append(dlg);
  dlg.showModal();
  return { close, el: dlg };
}
export function confirmDialog(message, { ok = t('common.confirm'), danger = false, title = t('common.areYouSure') } = {}) {
  return new Promise(resolve => {
    let done = false;
    const m = modal(title, h('p', null, message), [
      { label: t('common.cancel'), onClick: () => { done = true; resolve(false); } },
      { label: ok, kind: danger ? 'danger' : 'primary', onClick: () => { done = true; resolve(true); } },
    ]);
    m.el.addEventListener('close', () => { if (!done) resolve(false); });
  });
}

/* ---------- files ---------- */
export function download(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function toCSV(rows, columns) {
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map(c => esc(c.label)).join(',');
  const body = rows.map(r => columns.map(c => esc(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(',')).join('\r\n');
  return '﻿' + head + '\r\n' + body; // BOM so Excel opens Arabic correctly
}
export function downloadCSV(filename, rows, columns) { download(filename, toCSV(rows, columns), 'text/csv'); }
export function pickFile(accept = 'application/json') {
  return new Promise(resolve => {
    const inp = h('input', { type: 'file', accept, style: 'display:none' });
    inp.onchange = () => { resolve(inp.files[0] || null); inp.remove(); };
    document.body.append(inp); inp.click();
  });
}
export const stamp = () => new Date().toISOString().slice(0, 10);

/* ---------- building blocks ---------- */
export function empty(icon, title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon', 'aria-hidden': 'true' }, icon),
    h('h3', null, title), text ? h('p', null, text) : null, action || null);
}
export function spinner() { return h('div', { class: 'spinner', role: 'progressbar', 'aria-label': t('common.loading') }); }
export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input,
    hint ? h('small', { class: 'hint' }, hint) : null);
}
export function selectEl(options, value, attrs = {}) {
  return h('select', attrs, options.map(o => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
}
export function chip(text, cls = '') { return h('span', { class: `chip ${cls}` }, text); }
export function statusChip(status) { return chip(t('status.' + status), 'st-' + status); }
/** Toolbar with search box + optional filter/sort selects. Calls onChange({q, ...selects}). */
export function toolbar({ placeholder, selects = [], onChange }) {
  const st = { q: '' };
  selects.forEach(s => { st[s.name] = s.value ?? s.options[0].value; });
  const emit = () => onChange({ ...st });
  const q = h('input', { type: 'search', class: 'search', placeholder: placeholder || t('common.search'),
    'aria-label': t('common.search'), oninput: e => { st.q = e.target.value; emit(); } });
  const sels = selects.map(s => selectEl(s.options, st[s.name], { 'aria-label': s.label, onchange: e => { st[s.name] = e.target.value; emit(); } }));
  return h('div', { class: 'toolbar' }, q, sels.length ? h('div', { class: 'toolbar-row' }, sels) : null);
}
export function telLink(phone) { return phone ? `tel:${phone}` : null; }
export function waLink(phone, text = '') {
  if (!phone) return null;
  const intl = '2' + phone; // 01xxxxxxxxx -> 201xxxxxxxxx
  return `https://wa.me/${intl}${text ? '?text=' + encodeURIComponent(text) : ''}`;
}
export function busy(btn, on) {
  if (!btn) return;
  btn.disabled = on; btn.classList.toggle('is-busy', on);
}
