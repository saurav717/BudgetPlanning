/* Ledger frontend: vanilla JS + Chart.js. No build step. */
(() => {
'use strict';

// ======================================================================
// utilities
// ======================================================================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  wallet: 'M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3 M3 7h16a2 2 0 0 1 2 2v3h-5a2 2 0 0 0 0 4h5',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  pie: 'M21 12A9 9 0 1 1 12 3v9z M15 3.5A9 9 0 0 1 20.5 9H15z',
  repeat: 'M17 2l4 4-4 4 M3 11V9a3 3 0 0 1 3-3h15 M7 22l-4-4 4-4 M21 13v2a3 3 0 0 1-3 3H3',
  target: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12z M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4z',
  chart: 'M3 3v18h18 M7 15l4-4 3 3 5-6',
  trending: 'M3 17l6-6 4 4 8-8 M14 7h7v7',
  bulb: 'M9 18h6 M10 22h4 M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2z',
  sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',
  globe: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z M2 12h20 M12 2a15 15 0 0 1 0 20 M12 2a15 15 0 0 0 0 20',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  refresh: 'M21 12a9 9 0 0 1-15.5 6.2L3 16 M3 12a9 9 0 0 1 15.5-6.2L21 8 M21 3v5h-5 M3 21v-5h5',
  menu: 'M3 6h18M3 12h18M3 18h18', plus: 'M12 5v14M5 12h14', x: 'M18 6 6 18M6 6l12 12',
  chevL: 'M15 18l-6-6 6-6', chevR: 'M9 18l6-6-6-6', chevU: 'M18 15l-6-6-6 6', chevD: 'M6 9l6 6 6-6',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M21 21l-4.3-4.3',
  calendar: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M16 2v4M8 2v4M3 10h18',
  card: 'M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z M2 10h20 M6 15h4',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  layout: 'M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z',
  alert: 'M12 9v4M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  check: 'M20 6 9 17l-5-5', info: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z M12 16v-4 M12 8h.01',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7 M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  bank: 'M3 21h18 M3 10h18 M5 6l7-3 7 3 M4 10v11 M20 10v11 M8 14v3 M12 14v3 M16 14v3',
  piggy: 'M19 8.5c1 .8 1.6 2 1.8 3.5H22v3h-2c-.5 1.2-1.4 2.2-2.5 2.8V21h-3v-2h-4v2h-3v-3.3A7 7 0 0 1 11 6h3.5L18 4v4.5z M15 11h.01',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z', clock: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z M12 6v6l4 2',
  arrowUp: 'M12 19V5 M5 12l7-7 7 7', arrowDown: 'M12 5v14 M19 12l-7 7-7-7', sparkle: 'M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z',
  send: 'M22 2 11 13 M22 2l-7 20-4-9-9-4z', user: 'M20 21a8 8 0 0 0-16 0 M12 3a5 5 0 1 0 0 10a5 5 0 1 0 0-10z',
  tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z M7.5 7.5h.01', trash: 'M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6',
  edit: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
};
const icon = (n, s = 18, sw = 1.8) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[n] || ''}"/></svg>`;
const hydrateIcons = (root = document) => $$('[data-icon]', root).forEach(el => { if (!el.firstElementChild) el.innerHTML = icon(el.dataset.icon, +(el.dataset.size || 18)); });

// ---------- state ----------
const S = { profile: null, cur: 'USD', second: '', cats: [], accts: [], priorities: {}, plaid: null };

// ---------- formatting ----------
const _nf = {};
function nf(cur, minD, maxD, compact) {
  const k = [cur, minD, maxD, compact].join('|');
  if (!_nf[k]) {
    try { _nf[k] = new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol', minimumFractionDigits: minD, maximumFractionDigits: maxD, notation: compact ? 'compact' : 'standard' }); }
    catch (e) { _nf[k] = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: minD, maximumFractionDigits: maxD }); }
  }
  return _nf[k];
}
function money(v, o = {}) {
  if (v == null || isNaN(v)) return '—';
  const cur = o.cur || S.cur, abs = Math.abs(v);
  let s;
  if (o.compact) s = nf(cur, 0, abs >= 1000 ? 1 : 0, true).format(abs);
  else { const d = o.cents === true ? 2 : o.cents === false ? 0 : abs >= 1000 ? 0 : 2; s = nf(cur, d, d, false).format(abs); }
  return (v < 0 ? '−' : o.sign && v > 0 ? '+' : '') + s;
}
const pct = (v, d = 0) => v == null || isNaN(v) ? '—' : (v * 100).toFixed(d) + '%';
const toDate = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd || 1); };
const fmtDate = (d, o = { month: 'short', day: 'numeric' }) => d ? toDate(d).toLocaleDateString(undefined, o) : '';
const fmtMonth = (m) => toDate(m + '-01').toLocaleDateString(undefined, { month: 'short' });
const monthName = (m) => toDate(m + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const thisMonth = () => todayIso().slice(0, 7);
const shiftMonth = (m, n) => { const d = toDate(m + '-01'); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const daysUntil = (d) => Math.round((toDate(d) - toDate(todayIso())) / 864e5);
const relDays = (n) => n < 0 ? `${-n}d overdue` : n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const hexA = (hex, a) => { const m = hex.replace('#', '').match(/.{2}/g); if (!m) return hex; const [r, g, b] = m.map(x => parseInt(x, 16)); return `rgba(${r},${g},${b},${a})`; };

// category groups -> fixed palette slots (identity follows the group, never its rank)
const GROUP_SLOT = { Housing: 1, Food: 2, Transportation: 3, Lifestyle: 7, Health: 5, Remittances: 4, Income: 6, Other: 8 };
const groupColor = (g) => GROUP_SLOT[g] ? css('--s' + GROUP_SLOT[g]) : css('--muted');
const TYPE_LABEL = { checking: 'Checking', savings: 'Savings', credit: 'Credit cards', investment: 'Investments', loan: 'Loans', cash: 'Cash', other: 'Other' };
const TYPE_ICON = { checking: 'bank', savings: 'piggy', credit: 'card', investment: 'trending', loan: 'shield', cash: 'wallet', other: 'wallet' };
const TYPE_SLOT = { checking: 1, savings: 3, credit: 2, investment: 7, loan: 5, cash: 6, other: 8 };
const TAX_TYPES = { '': 'Not tax-advantaged', '401k': '401(k)', roth_401k: 'Roth 401(k)', '403b': '403(b)', ira: 'Traditional IRA', roth_ira: 'Roth IRA', hsa: 'HSA' };

// ---------- api ----------
const BACKEND = window.LedgerBackend;  // set in browser mode (static site + Google Drive), null when served by `ledger serve`
async function apiRaw(path, opts = {}) {
  if (BACKEND) {
    const [p, q] = ('/api' + path).split('?');
    const r = await BACKEND.request(opts.method || 'GET', p, q || '', opts.body === undefined ? null : JSON.stringify(opts.body));
    return { ok: r.status < 400, status: r.status, text: r.body, type: r.content_type };
  }
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  const r = await fetch('/api' + path, init);
  return { ok: r.ok, status: r.status, text: await r.text(), type: r.headers.get('content-type') || '' };
}
async function api(path, opts = {}) {
  if (BACKEND) {
    const r = await apiRaw(path, opts);
    if (r.status === 204) return null;
    let data = {}; try { data = r.text ? JSON.parse(r.text) : {}; } catch (e) {}
    if (!r.ok) throw new Error(typeof data.detail === 'string' ? data.detail : data.detail ? JSON.stringify(data.detail) : 'Error ' + r.status);
    return data;
  }
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  const r = await fetch('/api' + path, init);
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.detail === 'string' ? data.detail : data.detail ? JSON.stringify(data.detail) : r.statusText);
  return data;
}

// ---------- toast, modal, tooltip ----------
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800); }
function modal(html, onMount, cls = '') {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-bg"><div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div></div>`;
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  $('.modal-bg', root).addEventListener('mousedown', e => { if (e.target.classList.contains('modal-bg')) close(); });
  $$('[data-close]', root).forEach(b => b.addEventListener('click', close));
  hydrateIcons(root);
  const m = $('.modal', root);
  onMount && onMount(m, close);
  const f = $('[autofocus]', m); f && f.focus();
  return close;
}
const mhead = (title, sub = '') => `<div class="m-head"><div><h2>${title}</h2>${sub ? `<div class="muted small" style="margin-top:4px">${sub}</div>` : ''}</div><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>`;
const confirmModal = (text, ok = 'Delete') => new Promise(res => modal(`${mhead('Are you sure?')}<p class="soft">${h(text)}</p><div class="form-actions"><button class="btn" data-close>Cancel</button><button class="btn danger" id="ok">${ok}</button></div>`, (m, close) => { $('#ok', m).onclick = () => { close(); res(true); }; }));
const tipEl = () => $('#tip');
document.addEventListener('mouseover', e => {
  const el = e.target.closest('[data-tip]');
  if (!el) { tipEl().classList.remove('show'); return; }
  tipEl().innerHTML = el.dataset.tip; tipEl().classList.add('show');
});
document.addEventListener('mousemove', e => {
  const t = tipEl(); if (!t.classList.contains('show')) return;
  const r = t.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  t.style.left = x + 'px'; t.style.top = y + 'px';
});

// ---------- small components ----------
const ph = (title, sub = '', actions = '') => `<div class="ph"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
const card = (title, body, o = {}) => `<section class="card ${o.cls || ''}" ${o.id ? `id="${o.id}"` : ''}>${title !== null ? `<div class="card-head"><h2>${title}</h2>${o.meta ? `<span class="meta">${o.meta}</span>` : ''}${o.more ? `<a class="more" href="${o.more[0]}">${o.more[1]} ${icon('chevR', 14)}</a>` : ''}${o.right || ''}</div>` : ''}${body}</section>`;
const empty = (text, ic = 'sparkle', action = '') => `<div class="empty"><div class="em-ic">${icon(ic, 20)}</div><div>${text}</div>${action ? `<div style="margin-top:12px">${action}</div>` : ''}</div>`;
const bar = (p, o = {}) => { const v = clamp(p || 0, 0, 1); const cls = o.cls ?? (p > 1 ? 'over' : p > .9 ? 'warn' : ''); return `<div class="bar ${o.thin ? 'thin' : ''}"><i class="${cls}" style="width:${v * 100}%;${o.color ? `background:${o.color}` : ''}"></i>${o.mark != null ? `<span class="mark" style="left:calc(${clamp(o.mark, 0, 1) * 100}% - 1px)" ${o.markTip ? `data-tip="${h(o.markTip)}"` : ''}></span>` : ''}</div>`; };
const statusChip = (st, label) => `<span class="status ${st}">${icon(st === 'good' ? 'check' : st === 'info' ? 'info' : 'alert', 12, 2.4)}${h(label)}</span>`;
const deltaChip = (v, o = {}) => { const good = o.invert ? v < 0 : v > 0; const cls = Math.abs(v) < (o.flat ?? 0.5) ? 'flat' : good ? 'up' : 'down'; return `<span class="delta ${cls}">${icon(v >= 0 ? 'arrowUp' : 'arrowDown', 11, 2.6)}${o.text ?? money(Math.abs(v), { cents: false })}</span>`; };
function ring(score, o = {}) {
  const size = o.size || 120, sw = o.stroke || 10, r = (size - sw) / 2, c = 2 * Math.PI * r, p = clamp((score || 0) / 100, 0, 1);
  const col = o.color || (score >= 75 ? css('--good') : score >= 45 ? css('--warning') : css('--serious'));
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${css('--surface-3')}" stroke-width="${sw}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${c * p} ${c}"/></svg><div class="ring-label">${o.label ?? `<b>${score ?? '—'}</b><span>${o.sub || ''}</span>`}</div></div>`;
}
const monoIc = (text, color, ic) => `<span class="mono-ic" style="background:${color}">${ic ? icon(ic, 16, 2) : h((text || '?').trim()[0]?.toUpperCase() || '?')}</span>`;
const dateBox = (d) => { const dt = toDate(d); return `<span class="date-box"><b>${dt.getDate()}</b><span>${dt.toLocaleDateString(undefined, { month: 'short' })}</span></span>`; };
const amt = (v, o = {}) => `<span class="tx-amt ${v > 0 ? 'pos' : ''}">${money(v, { sign: true, ...o })}</span>`;
const legend = (items) => `<div class="legend">${items.map(it => `<span><i class="${it.kind || ''}" style="background:${it.color};border-color:${it.color}"></i>${h(it.label)}</span>`).join('')}</div>`;
const catChip = (t) => `<span class="chip cat" data-catpick="${t.id}"><i style="background:${groupColor(t.category_group)}"></i>${h(t.category || 'Uncategorized')}</span>`;

// ======================================================================
// charts
// ======================================================================
const charts = [];
const destroyCharts = () => { while (charts.length) charts.pop().destroy(); };
function chartDefaults() {
  if (!window.Chart) return;
  Object.assign(Chart.defaults, { color: css('--text-2'), borderColor: css('--grid'), animation: false });
  Chart.defaults.font.family = css('--font') || 'Inter, sans-serif'; Chart.defaults.font.size = 11.5;
  Chart.defaults.plugins.legend.display = false;
  Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: css('--text'), titleColor: css('--inverse'), bodyColor: css('--inverse'), padding: 10, cornerRadius: 8, displayColors: true, boxPadding: 4, usePointStyle: true, titleFont: { weight: '600' } });
}
const axisY = (o = {}) => ({ ticks: { callback: v => o.pct ? v + '%' : money(v, { compact: true }), maxTicksLimit: o.ticks || 5, padding: 8 }, grid: { color: css('--grid'), drawTicks: false }, border: { display: false }, beginAtZero: !!o.zero, ...(o.extra || {}) });
const axisX = (o = {}) => ({ grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 14, padding: 6, ...(o.ticks || {}) }, ...(o.extra || {}) });
const gradient = (color, a0 = .22) => (ctx) => { const { chart } = ctx; const area = chart.chartArea; if (!area) return 'transparent'; const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom); g.addColorStop(0, hexA(color, a0)); g.addColorStop(1, hexA(color, 0)); return g; };
function mk(canvas, cfg) { if (!canvas || !window.Chart) return null; const c = new Chart(canvas, cfg); charts.push(c); return c; }
function lineChart(canvas, labels, series, o = {}) {
  return mk(canvas, { type: 'line', data: { labels, datasets: series.map(s => ({ label: s.label, data: s.data, borderColor: s.color, backgroundColor: s.fill ? gradient(s.color) : s.color, fill: !!s.fill, borderWidth: s.width || 2, borderDash: s.dash || [], pointRadius: s.points || 0, pointHoverRadius: 4, pointBackgroundColor: s.color, pointBorderColor: css('--surface'), pointBorderWidth: 2, tension: s.tension ?? .3, spanGaps: true })) },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { x: axisX(o.x), y: axisY(o.y) },
      plugins: { tooltip: { callbacks: { title: o.title || (i => i[0].label), label: c => ` ${c.dataset.label}: ${o.pctVal ? c.parsed.y.toFixed(0) + '%' : money(c.parsed.y)}` } } } } });
}
function barChart(canvas, labels, series, o = {}) {
  return mk(canvas, { type: 'bar', data: { labels, datasets: series.map(s => ({ label: s.label, data: s.data, backgroundColor: s.colors || s.color, hoverBackgroundColor: s.colors || s.color, borderRadius: 4, borderSkipped: o.horizontal ? 'start' : 'bottom', maxBarThickness: o.thick || 26, categoryPercentage: .7, barPercentage: .86 })) },
    options: { indexAxis: o.horizontal ? 'y' : 'x', maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: o.horizontal ? { x: axisY({ zero: true }), y: axisX() } : { x: { ...axisX(), stacked: !!o.stacked }, y: { ...axisY({ zero: true }), stacked: !!o.stacked } },
      plugins: { tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${money(o.horizontal ? c.parsed.x : c.parsed.y)}` } } } } });
}
function sparkline(canvas, data, color) {
  return mk(canvas, { type: 'line', data: { labels: data.map((_, i) => i), datasets: [{ data, borderColor: color, borderWidth: 2, fill: true, backgroundColor: gradient(color, .25), pointRadius: 0, tension: .35 }] },
    options: { maintainAspectRatio: false, plugins: { tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } }, layout: { padding: { top: 4, bottom: 2 } } } });
}

// ======================================================================
// shell: nav, theme, router
// ======================================================================
const NAV = [
  { label: 'Overview', items: [['dashboard', 'Dashboard', 'home'], ['health', 'Money checkup', 'heart'], ['insights', 'Insights', 'bulb'], ['reports', 'Reports', 'chart']] },
  { label: 'Money', items: [['accounts', 'Accounts', 'wallet'], ['transactions', 'Transactions', 'list'], ['recurring', 'Recurring', 'repeat'], ['investments', 'Investments', 'trending']] },
  { label: 'Plan', items: [['budget', 'Budget', 'pie'], ['forecast', 'Cash forecast', 'calendar'], ['goals', 'Goals', 'target'], ['home', 'Money home', 'send']] },
  { label: '', items: [['settings', 'Settings', 'sliders'], ['transparency', 'Funding & costs', 'piggy']] },
];
const showsMoneyHome = () => !!(S.profile && (S.profile.second_currency || (S.profile.priorities || []).includes('support_family')));
function drawNav(active, badges = {}) {
  $('#nav').innerHTML = NAV.map(sec => `<div class="nav-section">${sec.label ? `<div class="nav-section-label">${sec.label}</div>` : ''}${sec.items.filter(([id]) => id !== 'home' || showsMoneyHome()).map(([id, label, ic]) => `<a class="nav-item ${active === id ? 'active' : ''}" href="#${id}">${icon(ic, 18)}<span>${label}</span>${badges[id] ? `<span class="badge">${badges[id]}</span>` : ''}</a>`).join('')}</div>`).join('');
}
function drawMe() {
  const n = (S.profile?.name || '').trim();
  $('#avatar').textContent = n ? n[0].toUpperCase() : icon('user', 16) && '?';
  if (!n) $('#avatar').innerHTML = icon('user', 16, 2);
  $('#me-name').textContent = n || 'Set up profile';
}
function currentTheme() { const t = document.documentElement.dataset.theme; return t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
function drawThemeBtn() { $('#theme-btn').innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon'); $('#theme-btn').title = currentTheme() === 'dark' ? 'Switch to light' : 'Switch to dark'; }
$('#theme-btn').onclick = () => { const next = currentTheme() === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('ledger-theme', next); } catch (e) {} drawThemeBtn(); render(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { drawThemeBtn(); render(); });
const closeMenu = () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); };
$('#menu-btn').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); };
$('#scrim').onclick = closeMenu;

async function loadRefs() {
  const [p, cats, accts] = await Promise.all([api('/profile'), api('/categories'), api('/accounts')]);
  S.profile = p; S.cur = p.home_currency || 'USD'; S.second = p.second_currency || ''; S.priorities = p.priority_options || {};
  S.cats = cats; S.accts = accts;
  const g = {}; cats.forEach(c => g[c.id] = c.group); S.catGroup = g;
}
const catName = (id) => (S.cats.find(c => c.id === id) || {}).name || 'Uncategorized';
function catSelect(selected, attrs = '') {
  const groups = {};
  S.cats.filter(c => !c.archived).forEach(c => (groups[c.kind === 'income' ? 'Income' : c.kind === 'transfer' ? 'Transfers' : c.group] ||= []).push(c));
  return `<select ${attrs}>${Object.entries(groups).map(([g, cs]) => `<optgroup label="${h(g)}">${cs.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${h(c.name)}</option>`).join('')}</optgroup>`).join('')}</select>`;
}
const acctSelect = (selected, attrs = '', none = false) => `<select ${attrs}>${none ? '<option value="">— none —</option>' : ''}${S.accts.filter(a => !a.archived).map(a => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${h(a.name)}</option>`).join('')}</select>`;

async function exportCsv() {
  const r = await apiRaw('/export/transactions.csv');
  const url = URL.createObjectURL(new Blob([r.text], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `ledger-transactions-${todayIso()}.csv` });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-export]')) exportCsv(); });

const views = {};
const ALIAS = { budgets: 'budget' };
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  destroyCharts();
  closeMenu();
  let [view, qs] = location.hash.replace('#', '').split('?');
  view = ALIAS[view] || view;
  const name = views[view] ? view : 'dashboard';
  const main = $('#view');
  try {
    if (BACKEND) await BACKEND.ready;
    await loadRefs();
    if (seq !== renderSeq) return;
    drawNav(name); drawMe(); drawThemeBtn(); chartDefaults();
    $('#topbar-title').textContent = NAV.flatMap(s => s.items).find(i => i[0] === name)?.[1] || 'Ledger';
    if (!S.profile.onboarded && name !== 'settings') { onboarding(); }
    main.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    await views[name](main, Object.fromEntries(new URLSearchParams(qs || '')));
    hydrateIcons(main);
    window.scrollTo({ top: 0 });
  } catch (e) {
    console.error(e);
    main.innerHTML = card('Something went wrong', `<p class="soft">${h(e.message)}</p><button class="btn" onclick="location.reload()">Reload</button>`);
  }
}
window.addEventListener('hashchange', render);

// ======================================================================
// dashboard
// ======================================================================
const greeting = () => { const hr = new Date().getHours(); return hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'; };
const TONE_ICON = { neutral: 'info', good: 'check', warning: 'alert', serious: 'alert' };

function insightHtml(i) {
  const link = i.action ? `#${i.action.view}${i.action.search ? '?q=' + encodeURIComponent(i.action.search) : i.action.uncategorized ? '?uncategorized=1' : ''}` : null;
  const ic = i.severity === 'info' ? 'bulb' : 'alert';
  return `<div class="insight ${i.severity}"><span class="ic">${icon(ic, 16, 2)}</span><div class="grow"><div class="title">${h(i.title)}</div><div class="body">${h(i.body)}</div></div><div class="acts">${link ? `<a class="btn sm ghost" href="${link}">View</a>` : ''}<button class="icon-btn" style="width:28px;height:28px" data-dismiss="${h(i.key)}" title="Dismiss">${icon('x', 14)}</button></div></div>`;
}
function bindDismiss(root) { $$('[data-dismiss]', root).forEach(b => b.onclick = async () => { await api('/insights/dismiss', { method: 'POST', body: { key: b.dataset.dismiss } }); b.closest('.insight').remove(); }); }

function heatmapHtml(month, breaks, o = {}) {
  const lvl = (v) => v <= 0 ? 0 : v <= breaks[0] ? 1 : v <= breaks[1] ? 2 : v <= breaks[2] ? 3 : v <= breaks[3] ? 4 : 5;
  const t = todayIso();
  const cells = month.days.map(d => {
    const n = +d.date.slice(8);
    if (d.future) return `<div class="cell future" aria-hidden="true"></div>`;
    return `<div class="cell l${lvl(d.spent)} ${d.date === t ? 'today' : ''}" data-tip="${h(`<b>${fmtDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}</b><br>${d.spent ? money(d.spent) + ' · ' + plural(d.count, 'purchase') : 'No spending'}`)}" aria-label="${fmtDate(d.date)} ${money(d.spent)}">${o.labels !== false ? n : ''}</div>`;
  });
  return `${o.title ? `<div class="small soft" style="font-weight:600;margin-bottom:6px">${o.title}</div>` : ''}<div class="heat">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => `<div class="dow">${x}</div>`).join('')}${'<div></div>'.repeat(month.first_weekday)}${cells.join('')}</div>`;
}
const heatScale = (breaks) => `<div class="heat-scale"><span>Less</span>${[0, 1, 2, 3, 4, 5].map(i => `<i style="background:var(--seq-${i})" data-tip="${h(i === 0 ? 'No spending' : i === 5 ? 'Over ' + money(breaks[3], { cents: false }) : 'Up to ' + money(breaks[i - 1], { cents: false }))}"></i>`).join('')}<span>More</span></div>`;

function forecastChart(canvas, fc, o = {}) {
  const labels = fc.series.map(p => fmtDate(p.date));
  const lowIdx = fc.series.findIndex(p => p.date === fc.low.date);
  const c = css('--s1');
  return mk(canvas, { type: 'line', data: { labels, datasets: [
      { label: 'Projected cash', data: fc.series.map(p => p.balance), borderColor: c, backgroundColor: gradient(c), fill: true, borderWidth: 2, tension: .25, pointRadius: fc.series.map((_, i) => i === lowIdx ? 5 : 0), pointBackgroundColor: css('--serious'), pointBorderColor: css('--surface'), pointBorderWidth: 2, pointHoverRadius: 4 },
      { label: 'Your buffer', data: fc.series.map(() => fc.buffer), borderColor: css('--muted'), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false, pointHoverRadius: 0 }] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { x: axisX({ ticks: { maxTicksLimit: o.ticks || 6 } }), y: axisY() },
      plugins: { tooltip: { filter: i => i.datasetIndex === 0, callbacks: { label: (ctx) => { const d = fc.series[ctx.dataIndex].date; const ev = fc.events.filter(e => e.date === d); return [` Projected: ${money(ctx.parsed.y)}`, ...ev.map(e => `  ${e.amount > 0 ? '+' : '−'}${money(Math.abs(e.amount))} ${e.label}`)]; } } } } } });
}
function paceChart(canvas, p) {
  const labels = Array.from({ length: p.days }, (_, i) => String(i + 1));
  const ds = [{ label: 'This month', data: p.this_month, color: css('--s1'), fill: true, width: 2.5, points: p.this_month.length <= 3 ? 4 : 0 }, { label: 'Last month', data: p.last_month.slice(0, p.days), color: css('--muted'), width: 1.5 }];
  if (p.budget_line) ds.push({ label: 'Budget pace', data: p.budget_line, color: css('--s2'), dash: [5, 4], width: 1.5, tension: 0 });
  return lineChart(canvas, labels, ds, { title: i => `Day ${i[0].label}`, x: { ticks: { maxTicksLimit: 8 } } });
}
const paceLegend = (p) => legend([{ label: 'This month', color: css('--s1') }, { label: 'Last month', color: css('--muted'), kind: 'line' }, ...(p.budget_line ? [{ label: 'Budget pace', color: css('--s2'), kind: 'dash' }] : [])]);

// each widget returns { html, mount } and is rendered in the order/visibility the profile chose
const W = {
  kpis(o) {
    const s = o.safe_to_spend, p = o.pace, fc = o.forecast, cf = o.cashflow, last = cf[cf.length - 2] || {}, target = o.profile.savings_rate_target || .2;
    const below = fc.low.balance < fc.buffer;
    const exp = p.expected_by_now;
    return { html: `<div class="tiles">
      <div class="tile"><div class="t-label"><span class="t-ic">${icon('wallet', 15)}</span>Safe to spend<span class="muted" data-tip="${h('Checking and cash, minus what you owe on cards, minus bills due before your next paycheck.')}">${icon('info', 13)}</span></div>
        <div class="t-value ${s.safe_to_spend < 0 ? 'bad' : ''}">${money(s.safe_to_spend, { cents: false })}</div><div class="t-sub">until payday in <b>${s.days_to_next_income} days</b> · ${money(s.upcoming_bills, { cents: false })} in bills</div></div>
      <div class="tile"><div class="t-label"><span class="t-ic">${icon('pie', 15)}</span>Spent in ${new Date().toLocaleDateString(undefined, { month: 'long' })}</div>
        <div class="t-value">${money(p.spent, { cents: false })}</div><div class="t-sub row between" style="margin-bottom:8px">${p.planned ? `<span>of ${money(p.planned, { cents: false })} planned</span>` : '<span>no budget set</span>'}${deltaChip(p.delta_vs_last, { invert: true, flat: 25, text: money(Math.abs(p.delta_vs_last), { cents: false }) + ' vs last mo' })}</div>
        ${p.planned ? bar(p.spent / p.planned, { thin: true, mark: exp / p.planned, markTip: `Where you'd be on an even pace: ${money(exp, { cents: false })}` }) : ''}</div>
      <div class="tile"><div class="t-label"><span class="t-ic">${icon('calendar', 15)}</span>Lowest cash ahead</div>
        <div class="t-value ${below ? 'bad' : ''}">${money(fc.low.balance, { cents: false })}</div><div class="t-sub">on <b>${fmtDate(fc.low.date)}</b> · ${below ? `<span class="bad">below your ${money(fc.buffer, { cents: false })} buffer</span>` : `buffer ${money(fc.buffer, { cents: false })}`}</div></div>
      <div class="tile"><div class="t-label"><span class="t-ic">${icon('piggy', 15)}</span>Saved in ${last.month ? fmtDate(last.month + '-01', { month: 'long' }) : 'last month'}</div>
        <div class="t-value ${last.savings < 0 ? 'bad' : ''}">${money(last.savings || 0, { cents: false })}</div><div class="t-sub">${last.savings_rate != null ? `<b>${pct(last.savings_rate)}</b> of income · target ${pct(target)}` : 'no income recorded'}</div></div>
    </div>` };
  },
  networth(o) {
    const hist = o.net_worth_history, nw = o.net_worth;
    const types = Object.entries(nw.by_type).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    return { html: card('Net worth', `<div class="chart"><canvas id="w-nw"></canvas></div>${legend([{ label: 'Net worth', color: css('--s1') }, { label: 'Assets', color: css('--s3'), kind: 'line' }, { label: 'Liabilities', color: css('--s2'), kind: 'line' }])}
      <div class="row wrap" style="gap:6px;margin-top:12px">${types.map(([t, v]) => `<span class="chip ghost"><i style="width:7px;height:7px;border-radius:50%;background:var(--s${TYPE_SLOT[t] || 8})"></i>${TYPE_LABEL[t] || t} <b class="num">${money(v, { compact: true })}</b></span>`).join('')}</div>`, { meta: '12 months', more: ['#accounts', 'Accounts'] }),
      mount: () => lineChart($('#w-nw'), hist.map(x => fmtMonth(x.month)), [{ label: 'Net worth', data: hist.map(x => x.net_worth), color: css('--s1'), fill: true, width: 2.5 }, { label: 'Assets', data: hist.map(x => x.assets), color: css('--s3'), width: 1.5 }, { label: 'Liabilities', data: hist.map(x => -x.liabilities), color: css('--s2'), width: 1.5 }]) };
  },
  insights(o) {
    return { html: card('Insights', o.insights.length ? o.insights.map(insightHtml).join('') : empty('Nothing needs your attention right now.', 'check'), { more: ['#insights', 'All'] }), mount: (root) => bindDismiss(root) };
  },
  forecast(o) {
    const fc = o.forecast, below = fc.first_below_buffer;
    const next = fc.events.slice(0, 4);
    return { html: card('Cash forecast', `${below ? `<div class="callout serious" style="margin-bottom:12px">${icon('alert', 16, 2)}<div>Spendable cash dips below your ${money(fc.buffer, { cents: false })} buffer around <b>${fmtDate(below)}</b>. Consider moving a planned transfer or trimming spending before then.</div></div>` : ''}
      <div class="chart"><canvas id="w-fc"></canvas></div>${legend([{ label: 'Projected spendable cash', color: css('--s1') }, { label: 'Your buffer', color: css('--muted'), kind: 'dash' }, { label: 'Lowest point', color: css('--serious') }])}
      <div class="grid g2" style="margin-top:14px;gap:0 24px">${next.map(e => `<div class="li"><span class="date-box"><b>${toDate(e.date).getDate()}</b><span>${toDate(e.date).toLocaleDateString(undefined, { month: 'short' })}</span></span><div class="grow"><div class="main-t">${h(e.label)}</div><div class="sub-t">${e.kind === 'income' ? 'income' : e.kind === 'transfer' ? 'scheduled transfer' : 'bill'}</div></div><span class="amt">${amt(e.amount, { cents: false })}</span></div>`).join('')}</div>`,
      { meta: `next ${fc.days} days`, more: ['#forecast', 'Details'] }), mount: () => forecastChart($('#w-fc'), fc) };
  },
  checkup(o) {
    const c = o.checkup;
    if (c.score == null) return { html: card('Money checkup', empty('Add a few months of transactions to get your score.', 'heart')) };
    return { html: card('Money checkup', `<div class="row" style="gap:18px;margin-bottom:10px">${ring(c.score, { size: 104, stroke: 9, sub: c.grade })}<div class="grow small soft">${c.focus ? `Biggest opportunity: <b style="color:var(--text)">${h(c.metrics.find(m => m.id === c.focus).label.toLowerCase())}</b>. ${h(c.metrics.find(m => m.id === c.focus).advice)}` : ''}</div></div>
      ${c.metrics.map(m => `<div class="li" style="padding:8px 0"><div class="grow"><div class="main-t" style="font-weight:500">${h(m.label)}</div></div><span class="num small soft">${h(m.display)}</span>${statusChip(m.status, m.status === 'good' ? 'Good' : m.status === 'warning' ? 'Watch' : 'Act')}</div>`).join('')}`, { more: ['#health', 'Details'] }) };
  },
  pace(o) {
    const p = o.pace;
    const meta = p.projected ? `on pace for ${money(p.projected, { cents: false })}` : '';
    return { html: card('Spending pace', `<div class="chart"><canvas id="w-pace"></canvas></div>${paceLegend(p)}`, { meta }), mount: () => paceChart($('#w-pace'), p) };
  },
  heatmap(o) {
    const d = o.daily;
    const m = d.months[d.months.length - 1];
    const busiest = [...m.days].sort((a, b) => b.spent - a.spent)[0];
    const noSpend = m.days.filter(x => !x.future && x.spent === 0).length;
    return { html: card('Daily spending', `${heatmapHtml(m, d.breaks)}<div class="row between">${heatScale(d.breaks)}</div>
      <div class="small soft" style="margin-top:10px">${plural(noSpend, 'no-spend day')} so far${busiest && busiest.spent ? ` · biggest day ${fmtDate(busiest.date)} (${money(busiest.spent, { cents: false })})` : ''}</div>`, { meta: monthName(m.month), more: ['#reports', 'More'] }) };
  },
  budget(o) {
    const rows = o.budget_rows, prog = o.budget_summary.month_progress;
    return { html: card('Budget', rows.length ? `<div class="stack">${rows.map(r => `<div><div class="row between small" style="margin-bottom:6px"><span style="font-weight:550">${h(r.category)}</span><span class="num ${r.remaining < 0 ? 'bad' : 'soft'}">${money(r.actual, { cents: false })} <span class="muted">/ ${money(r.available, { cents: false })}</span></span></div>${bar(r.pct, { thin: true, mark: prog, markTip: 'Today' })}</div>`).join('')}</div>` : empty('No budgets yet.', 'pie', '<a class="btn sm" href="#budget">Set up a budget</a>'), { meta: `${pct(prog)} of month gone`, more: ['#budget', 'Edit'] }) };
  },
  upcoming(o) {
    const items = o.upcoming.slice(0, 6);
    return { html: card('Upcoming', items.length ? `<div class="list">${items.map(u => `<div class="li">${dateBox(u.next_date)}<div class="grow"><div class="main-t">${h(u.merchant)}</div><div class="sub-t">${relDays(u.days_until)} · ${u.cadence}</div></div><span class="amt">${amt(u.amount)}</span></div>`).join('')}</div>` : empty('No recurring bills detected yet.', 'repeat'), { more: ['#recurring', 'All'] }) };
  },
  recent(o) {
    return { html: card('Recent', `<div class="list">${o.recent.map(t => `<div class="li">${monoIc(t.merchant, groupColor(t.category_group))}<div class="grow"><div class="main-t">${h(t.merchant)}</div><div class="sub-t">${fmtDate(t.date)} · ${h(t.category || 'Uncategorized')}</div></div><span class="amt">${amt(t.amount)}</span></div>`).join('')}</div>`, { more: ['#transactions', 'All'] }) };
  },
  goals(o) {
    const gs = o.goals;
    return { html: card('Goals', gs.length ? `<div class="grid g2">${gs.slice(0, 4).map(g => `<div class="goal-card">${ring(g.pct * 100, { size: 64, stroke: 7, color: g.pct >= 1 ? css('--good') : css('--s1'), label: `<b style="font-size:15px">${pct(g.pct)}</b>` })}<div style="min-width:0"><div class="main-t" style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${h(g.name)}</div><div class="small soft num">${money(g.current, { cents: false })} of ${money(g.target_amount, { cents: false })}</div><div style="margin-top:4px">${g.remaining <= 0 ? statusChip('good', 'Done') : g.target_date ? statusChip(g.on_track ? 'good' : 'warning', g.on_track ? 'On track' : 'Behind') : ''}</div></div></div>`).join('')}</div>` : empty('No goals yet.', 'target', '<a class="btn sm" href="#goals">Create a goal</a>'), { more: ['#goals', 'All'] }) };
  },
  remittances(o) {
    const r = o.remittances;
    if (!r) return { html: '' };
    const months = r.monthly.filter(m => m.month <= thisMonth());
    return { html: card('Money sent home', `<div class="row between" style="align-items:flex-end;margin-bottom:6px"><div><div class="tile" style="padding:0;border:0;box-shadow:none;background:none"><div class="t-value" style="margin:0">${money(r.total, { cents: false })}</div><div class="t-sub">${r.second_currency ? `≈ <b>${money(r.total_second, { cur: r.second_currency, cents: false })}</b> · ` : ''}${plural(r.count, 'transfer')} in ${r.year}</div></div></div>
      ${r.same_period_last_year ? deltaChip(r.total - r.same_period_last_year, { text: money(Math.abs(r.total - r.same_period_last_year), { cents: false }) + ' vs last year', flat: 50 }) : ''}</div>
      <div class="chart short"><canvas id="w-remit"></canvas></div>
      <div class="row wrap" style="gap:6px;margin-top:10px">${r.by_service.slice(0, 4).map(s => `<span class="chip ghost">${h(s.merchant)} <b class="num">${money(s.amount, { cents: false })}</b></span>`).join('')}${r.rate ? `<span class="chip accent" style="margin-left:auto">1 ${S.cur} = ${money(r.rate, { cur: r.second_currency, cents: true })}</span>` : ''}</div>`, { meta: `${money(r.avg_month, { cents: false })}/mo avg`, more: ['#home', 'Details'] }),
      mount: () => barChart($('#w-remit'), months.map(m => fmtMonth(m.month)), [{ label: 'Sent home', data: months.map(m => m.amount), color: css('--s4') }], { thick: 18 }) };
  },
  retirement(o) {
    const r = o.retirement;
    if (!r || !r.buckets.length) return { html: card('Retirement contributions', empty('Mark an investment account as 401(k), IRA or HSA to track contribution limits.', 'shield', '<a class="btn sm" href="#accounts">Edit accounts</a>')) };
    return { html: card(`Retirement contributions`, `<div class="stack">${r.buckets.map(b => `<div><div class="row between small" style="margin-bottom:6px"><span style="font-weight:600">${h(b.label)}</span><span class="num soft">${money(b.contributed, { cents: false })} <span class="muted">/ ${money(b.limit, { cents: false })}</span></span></div>
      ${bar(b.pct, { cls: b.pct >= 1 ? 'good' : '', mark: b.expected_pct, markTip: `Even pace to max out by Dec 31: ${pct(b.expected_pct)}` })}
      <div class="tiny muted" style="margin-top:6px">${b.remaining > 0 ? `${money(b.per_paycheck_to_max, { cents: false })}/paycheck for ${r.paychecks_left} paychecks to max out` : 'Maxed out for the year'} · ${b.on_pace ? '<span class="pos">on pace</span>' : '<span class="warn">behind pace</span>'}</div></div>`).join('')}</div>`, { meta: String(r.year), more: ['#investments', 'Details'] }) };
  },
  utilization(o) {
    const u = o.utilization;
    if (!u) return { html: '' };
    const withL = u.cards.filter(c => c.limit);
    return { html: card('Credit card utilisation', withL.length ? `<div class="row" style="gap:18px;margin-bottom:12px">${ring(Math.round((1 - Math.min(1, u.util / 0.5)) * 100), { size: 84, stroke: 8, label: `<b style="font-size:18px">${pct(u.util)}</b><span>used</span>` })}<div class="small soft grow">${money(u.total_owed, { cents: false })} owed across ${money(u.total_limit, { cents: false })} in limits. Under 10% is ideal for your credit score; over 30% starts to hurt.</div></div>
      <div class="stack">${withL.map(c => `<div><div class="row between small" style="margin-bottom:6px"><span>${h(c.name)}</span><span class="num soft">${pct(c.util)} · ${money(c.owed, { cents: false })}</span></div>${bar(c.util / 0.5, { thin: true, cls: c.util > .3 ? 'over' : c.util > .1 ? 'warn' : 'good', mark: .2, markTip: '10% utilisation' })}</div>`).join('')}</div>`
      : empty('Add credit limits to your cards to track utilisation.', 'card', '<a class="btn sm" href="#accounts">Add limits</a>')) };
  },
  cashflow(o) {
    const cf = o.cashflow;
    return { html: card('Cash flow', `<div class="chart"><canvas id="w-cf"></canvas></div>${legend([{ label: 'Income', color: css('--s1') }, { label: 'Spending', color: css('--s2') }])}`, { meta: '6 months', more: ['#reports', 'Reports'] }),
      mount: () => barChart($('#w-cf'), cf.map(x => fmtMonth(x.month)), [{ label: 'Income', data: cf.map(x => x.income), color: css('--s1') }, { label: 'Spending', data: cf.map(x => x.expenses), color: css('--s2') }]) };
  },
  spending(o) {
    const g = o.spending_by_group.slice(0, 7);
    return { html: card('Spending by group', g.length ? `<div class="chart" style="height:${Math.max(140, g.length * 34)}px"><canvas id="w-sg"></canvas></div>` : empty('No spending yet this month.'), { meta: 'this month' }),
      mount: () => g.length && barChart($('#w-sg'), g.map(x => x.group), [{ label: 'Spent', colors: g.map(x => groupColor(x.group)) }].map(s => ({ ...s, data: g.map(x => x.spent) })), { horizontal: true, thick: 16 }) };
  },
};

views.dashboard = async (main) => {
  const o = await api('/overview');
  const nw = o.net_worth, hist = o.net_worth_history, prev = hist[hist.length - 2];
  const delta = prev ? nw.net_worth - prev.net_worth : 0;
  const name = (o.profile.name || '').trim();
  const visible = o.layout.filter(w => w.visible && W[w.id]);
  const built = visible.map(w => ({ w, ...W[w.id](o) })).filter(x => x.html);
  main.innerHTML = `
  <section class="hero">
    <div>
      <div class="row between"><span class="hello">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span><button class="btn sm ghost" id="customize" style="margin:-6px 0">${icon('layout', 15)} Customize</button></div>
      <h1>${greeting()}${name ? ', ' + h(name.split(' ')[0]) : ''}</h1>
      <ul class="brief">${o.briefing.map(l => `<li class="tone-${l.tone}"><span class="ic">${icon(TONE_ICON[l.tone] || 'info', 13, 2.4)}</span><span>${h(l.text)}</span></li>`).join('')}</ul>
    </div>
    <div class="hero-nw">
      <div class="label"><span>Net worth</span>${deltaChip(delta, { text: money(Math.abs(delta), { cents: false }) + ' this month' })}</div>
      <div class="big">${money(nw.net_worth, { cents: false })}</div>
      <div class="alt">${o.fx.second ? `≈ ${money(fx2(nw.net_worth, o.fx.rate), { cur: o.fx.second, compact: true })} · ` : ''}${money(nw.assets, { compact: true })} assets · ${money(-nw.liabilities, { compact: true })} owed</div>
      <div class="chart mini" style="margin-top:8px"><canvas id="hero-spark"></canvas></div>
    </div>
  </section>
  <div class="grid g12">${packRows(built).map(b => `<div style="grid-column:span ${b.span}" data-w ${b.span >= 7 ? 'data-wide' : ''} data-widget="${b.w.id}">${b.html}</div>`).join('')}</div>
  <div class="center" style="margin-top:22px"><button class="btn ghost sm" id="customize2">${icon('layout', 15)} Customize this dashboard</button></div>`;
  sparkline($('#hero-spark'), hist.map(x => x.net_worth), css('--s1'));
  built.forEach(b => b.mount && b.mount($(`[data-widget="${b.w.id}"]`)));
  $('#customize').onclick = $('#customize2').onclick = () => customize();
};
const fx2 = (v, rate) => rate ? v * rate : null;
// Fill every 12-column row: when the next widget doesn't fit, widen the widgets already in the row.
function packRows(items) {
  const out = []; let row = [];
  const flush = () => {
    if (!row.length) return;
    let left = 12 - row.reduce((s, x) => s + x.span, 0);
    for (let i = 0; left > 0; i = (i + 1) % row.length) { row[row.length - 1 - i].span++; left--; }
    out.push(...row); row = [];
  };
  items.forEach(b => {
    const span = b.w.span;
    if (row.reduce((s, x) => s + x.span, 0) + span > 12) flush();
    row.push({ ...b, span });
    if (span === 12) flush();
  });
  flush();
  return out;
}

async function customize() {
  const { layout, recommended } = await api('/layout');
  let rows = layout.map(w => ({ ...w }));
  const draw = (m) => {
    $('#cust', m).innerHTML = rows.map((w, i) => `<div class="cust-row ${w.visible ? '' : 'off'}"><label class="switch"><input type="checkbox" data-vis="${i}" ${w.visible ? 'checked' : ''}><span></span></label><span class="name">${h(w.title)}</span>
      <button class="icon-btn" data-up="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">${icon('chevU', 16)}</button><button class="icon-btn" data-down="${i}" ${i === rows.length - 1 ? 'disabled' : ''} title="Move down">${icon('chevD', 16)}</button></div>`).join('');
    $$('[data-vis]', m).forEach(c => c.onchange = () => { rows[+c.dataset.vis].visible = c.checked; draw(m); });
    $$('[data-up]', m).forEach(b => b.onclick = () => { const i = +b.dataset.up; [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; draw(m); });
    $$('[data-down]', m).forEach(b => b.onclick = () => { const i = +b.dataset.down; [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; draw(m); });
  };
  modal(`${mhead('Customize your dashboard', 'Show what matters to you, in the order you want it. The recommended layout follows the priorities in your profile.')}
    <div class="cust" id="cust"></div>
    <div class="form-actions" style="margin-top:16px"><button class="btn ghost" id="rec">${icon('sparkle', 15)} Use recommended</button><span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="save">Save layout</button></div>`,
    (m, close) => {
      draw(m);
      $('#rec', m).onclick = () => { rows = recommended.map(w => ({ ...w })); draw(m); };
      $('#save', m).onclick = async () => { await api('/layout', { method: 'PUT', body: { layout: rows } }); close(); toast('Dashboard updated'); render(); };
    });
}

// ======================================================================
// onboarding
// ======================================================================
const PRIORITY_ICON = { emergency_fund: 'shield', debt_payoff: 'card', reduce_spending: 'pie', invest_retirement: 'trending', support_family: 'send', save_for_goal: 'target', grow_net_worth: 'chart' };
const CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'AED', 'JPY', 'CHF'];
function onboarding() {
  if ($('#onb')) return;
  const p = { ...S.profile };
  let step = 0;
  const el = document.createElement('div');
  el.className = 'onb'; el.id = 'onb';
  document.body.appendChild(el);
  const steps = [
    () => `<h1>Let's make this yours</h1><p class="soft">A few questions so Ledger can show the numbers that matter to you. You can change any of this later in Settings.</p>
      <div class="form" style="margin-top:20px"><label>What should we call you?<input name="name" value="${h(p.name || '')}" placeholder="First name" autofocus></label>
      <div class="two"><label>Your main currency<select name="home_currency">${CURRENCIES.map(c => `<option ${c === p.home_currency ? 'selected' : ''}>${c}</option>`).join('')}</select><span class="hint">Everything is totalled in this.</span></label>
      <label>A second currency you care about<select name="second_currency"><option value="">None</option>${CURRENCIES.map(c => `<option ${c === p.second_currency ? 'selected' : ''}>${c}</option>`).join('')}</select><span class="hint">E.g. INR if you have accounts or family in India.</span></label></div></div>`,
    () => `<h1>How does money come in?</h1><p class="soft">This drives the cash forecast, “safe to spend”, and per-paycheck targets.</p>
      <div class="form" style="margin-top:20px"><div class="two"><label>How often are you paid?<select name="pay_frequency">${[['weekly', 'Weekly'], ['biweekly', 'Every two weeks'], ['semimonthly', 'Twice a month'], ['monthly', 'Monthly']].map(([v, l]) => `<option value="${v}" ${p.pay_frequency === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Cash cushion to never dip below<input type="number" name="min_cash_buffer" value="${p.min_cash_buffer ?? 1000}" step="100"><span class="hint">We'll warn you if the forecast drops under this.</span></label></div>
      <div class="two"><label>Emergency fund target (months of spending)<input type="number" name="emergency_months" value="${p.emergency_months ?? 6}" min="1" max="24"></label>
      <label>Savings rate you're aiming for (%)<input type="number" name="savings_rate_target" value="${Math.round((p.savings_rate_target ?? .2) * 100)}" min="0" max="90"></label></div></div>`,
    () => `<h1>What are you working on?</h1><p class="soft">Pick everything that applies. Your dashboard is arranged around these.</p>
      <div class="pick" style="margin-top:20px">${Object.entries(S.priorities).map(([k, v]) => `<label><input type="checkbox" name="priorities" value="${k}" ${(p.priorities || []).includes(k) ? 'checked' : ''}><span class="p-ic">${icon(PRIORITY_ICON[k] || 'sparkle', 16)}</span>${h(v)}</label>`).join('')}</div>`,
  ];
  const collect = () => {
    const f = $('form', el);
    const fd = new FormData(f);
    for (const [k, v] of fd.entries()) if (k !== 'priorities') p[k] = v;
    if (step === 2) p.priorities = fd.getAll('priorities');
    ['min_cash_buffer', 'emergency_months'].forEach(k => p[k] = p[k] === '' || p[k] == null ? p[k] : +p[k]);
    if (typeof p.savings_rate_target === 'string') p.savings_rate_target = +p.savings_rate_target / 100;
  };
  const draw = () => {
    el.innerHTML = `<form class="onb-card"><div class="row between"><div class="brand" style="padding:0">${'<span class="logo">' + icon('trending', 16, 2.4) + '</span>'}<span>Ledger</span></div><span class="muted small">Step ${step + 1} of ${steps.length}</span></div>
      <div class="onb-steps" style="margin-top:18px">${steps.map((_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>
      ${steps[step]()}
      <div class="form-actions" style="margin-top:26px">${step > 0 ? '<button type="button" class="btn ghost" id="back">Back</button>' : '<button type="button" class="btn ghost" id="skip">Skip for now</button>'}<span class="grow"></span><button class="btn primary">${step < steps.length - 1 ? 'Continue' : 'Build my dashboard'} ${icon('chevR', 15)}</button></div></form>`;
    $('form', el).onsubmit = async (e) => {
      e.preventDefault(); collect();
      if (step < steps.length - 1) { step++; draw(); return; }
      await api('/profile', { method: 'PUT', body: { ...p, onboarded: true, reset_layout: true } });
      el.remove(); toast(p.name ? `Welcome, ${p.name.split(' ')[0]}` : 'All set'); render();
    };
    const back = $('#back', el); if (back) back.onclick = () => { collect(); step--; draw(); };
    const skip = $('#skip', el); if (skip) skip.onclick = async () => { await api('/profile', { method: 'PUT', body: { onboarded: true } }); el.remove(); render(); };
    const af = $('[autofocus]', el); af && af.focus();
  };
  draw();
}

// ======================================================================
// plaid
// ======================================================================
async function plaidLink(itemId) {
  if (!window.Plaid) { toast('Plaid Link failed to load. Check your connection.'); return; }
  try {
    const { link_token } = await api('/plaid/link-token', { method: 'POST', body: itemId ? { item_id: itemId } : {} });
    Plaid.create({ token: link_token, onSuccess: async (public_token) => {
      if (itemId) { toast('Re-authenticated. Syncing…'); return syncPlaid(); }
      toast('Linking… this can take a few seconds');
      try { const r = await api('/plaid/exchange', { method: 'POST', body: { public_token } }); toast(`Linked ${r.institution || 'bank'}: ${plural(r.accounts.length, 'account')}, ${r.sync.added} transactions`); render(); }
      catch (e) { toast(e.message); }
    }, onExit: (err) => { if (err) toast(err.display_message || err.error_message || 'Link closed'); } }).open();
  } catch (e) { toast(e.message); }
}
async function syncPlaid() {
  const btn = $('#sync-btn'); btn.classList.add('spinning'); $('#sync-label').textContent = 'Syncing…';
  try {
    const r = await api('/plaid/sync', { method: 'POST' });
    const added = r.results.reduce((s, x) => s + (x.added || 0), 0), errs = r.results.filter(x => x.error);
    toast(errs.length ? errs[0].error : r.results.length ? `Synced: ${plural(added, 'new transaction')}` : 'No banks connected yet. Add one in Settings.');
    render();
  } catch (e) { toast(e.message); }
  finally { btn.classList.remove('spinning'); $('#sync-label').textContent = 'Sync banks'; }
}
$('#sync-btn').onclick = syncPlaid;
if (BACKEND) {
  const foot = $('.side-foot');
  foot.insertAdjacentHTML('afterbegin', `<div class="save-status" id="save-status"></div>`);
  const draw = (st) => {
    const el = $('#save-status'); if (!el) return;
    if (st.mode === 'demo') { el.innerHTML = `<span class="dot warn"></span><span>Demo · nothing is saved</span>`; return; }
    if (st.mode !== 'drive') { el.innerHTML = ''; return; }
    const txt = st.error === 'conflict' ? 'Changed elsewhere' : st.error ? 'Save failed, retrying…' : st.saving ? 'Saving to Drive…' : st.dirty ? 'Unsaved changes' : st.lastSaved ? `Encrypted & saved ${st.lastSaved.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Encrypted in Drive';
    el.innerHTML = `<span class="dot ${st.error ? 'bad' : st.saving || st.dirty ? 'busy' : 'ok'}"></span><span class="grow">${txt}</span><button class="icon-btn" id="lock-btn" title="Lock" style="width:26px;height:26px">${icon('shield', 14)}</button>`;
    $('#lock-btn').onclick = () => BACKEND.lock();
  };
  BACKEND.onStatus(draw); draw(BACKEND.status());
}

// ======================================================================
// accounts
// ======================================================================
views.accounts = async (main) => {
  const [nw, plaid] = await Promise.all([api('/net-worth'), api('/plaid/status')]);
  S.plaid = plaid;
  const groups = {};
  S.accts.filter(a => !a.archived).forEach(a => (groups[a.type] ||= []).push(a));
  const archived = S.accts.filter(a => a.archived);
  const c = nw.current, assets = c.assets, liab = -c.liabilities;
  main.innerHTML = ph('Accounts', `${plural(S.accts.filter(a => !a.archived).length, 'account')} · totals in ${S.cur}`,
    `${plaid.configured ? `<button class="btn" id="link-btn">${icon('link', 15)} Connect a bank</button>` : ''}<button class="btn primary" id="add-acct">${icon('plus', 15)} Add account</button>`) + `
  <div class="grid g12">
    <div class="span-8">${card('Net worth over time', `<div class="chart tall"><canvas id="nw"></canvas></div>${legend([{ label: 'Net worth', color: css('--s1') }, { label: 'Assets', color: css('--s3'), kind: 'line' }, { label: 'Liabilities', color: css('--s2'), kind: 'line' }])}`, { meta: '12 months' })}</div>
    <div class="span-4">${card('Where it sits', `<div class="t-value num" style="font-size:28px;font-weight:700;letter-spacing:-.03em">${money(c.net_worth, { cents: false })}</div>
      <div class="small soft" style="margin-bottom:14px">${money(assets, { cents: false })} assets · ${money(liab, { cents: false })} owed</div>
      <div style="display:flex;height:10px;border-radius:999px;overflow:hidden;gap:2px;margin-bottom:14px">${Object.entries(c.by_type).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([t, v]) => `<i style="flex:${v};background:var(--s${TYPE_SLOT[t]})" data-tip="${h(`<b>${TYPE_LABEL[t]}</b><br>${money(v)} · ${pct(v / assets)}`)}"></i>`).join('')}</div>
      <dl class="kv">${Object.entries(c.by_type).sort((a, b) => b[1] - a[1]).map(([t, v]) => `<dt><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--s${TYPE_SLOT[t]});margin-right:8px"></span>${TYPE_LABEL[t] || t}</dt><dd class="${v < 0 ? 'bad' : ''}">${money(v, { cents: false })}</dd>`).join('')}</dl>`)}</div>
    ${Object.keys(groups).sort((a, b) => Object.keys(TYPE_LABEL).indexOf(a) - Object.keys(TYPE_LABEL).indexOf(b)).map(t => `<div class="span-6">${card(TYPE_LABEL[t] || t, `<div>${groups[t].map(a => acctRow(a)).join('')}</div>`, { meta: money(groups[t].reduce((s, a) => s + a.balance_home, 0), { cents: false }) })}</div>`).join('')}
    ${archived.length ? `<div class="span-12">${card(null, `<details><summary><span class="chev">${icon('chevR', 14)}</span>${plural(archived.length, 'archived account')}</summary><div style="margin-top:8px">${archived.map(a => acctRow(a)).join('')}</div></details>`)}</div>` : ''}
  </div>`;
  lineChart($('#nw'), nw.history.map(x => fmtMonth(x.month)), [{ label: 'Net worth', data: nw.history.map(x => x.net_worth), color: css('--s1'), fill: true, width: 2.5 }, { label: 'Assets', data: nw.history.map(x => x.assets), color: css('--s3'), width: 1.5 }, { label: 'Liabilities', data: nw.history.map(x => -x.liabilities), color: css('--s2'), width: 1.5 }]);
  $('#add-acct').onclick = () => accountForm();
  if ($('#link-btn')) $('#link-btn').onclick = () => plaidLink();
  $$('[data-bal]', main).forEach(b => b.onclick = () => balanceForm(S.accts.find(x => x.id === +b.dataset.bal)));
  $$('[data-edit]', main).forEach(b => b.onclick = () => accountForm(S.accts.find(x => x.id === +b.dataset.edit)));
};
function acctRow(a) {
  const foreign = a.currency && a.currency !== S.cur;
  const util = a.type === 'credit' && a.credit_limit ? -a.balance / a.credit_limit : null;
  return `<div class="acct-row">${monoIc(a.name, `var(--s${TYPE_SLOT[a.type] || 8})`, TYPE_ICON[a.type])}
    <div style="min-width:0"><div class="main-t" style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><a href="#transactions?account_id=${a.id}" style="color:var(--text)">${h(a.name)}</a></div>
      <div class="sub-t small muted" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${h(a.institution || 'Manual')}${a.balance_date ? ` · updated ${fmtDate(a.balance_date)}` : ''}${a.plaid_item_id ? ' <span class="chip accent">Plaid</span>' : ''}${foreign ? ` <span class="chip">${a.currency}</span>` : ''}${a.tax_type ? ` <span class="chip">${TAX_TYPES[a.tax_type] || a.tax_type}</span>` : ''}${!a.include_in_net_worth ? ' <span class="chip">not in net worth</span>' : ''}</div>
      ${util != null ? `<div style="margin-top:6px;max-width:220px">${bar(util / .5, { thin: true, cls: util > .3 ? 'over' : util > .1 ? 'warn' : 'good' })}<div class="tiny muted" style="margin-top:3px">${pct(util)} of ${money(a.credit_limit, { cur: a.currency, cents: false })} limit</div></div>` : ''}</div>
    <div class="bal">${money(a.balance, { cur: a.currency || S.cur })}${foreign ? `<div class="tiny muted">≈ ${money(a.balance_home, { cents: false })}</div>` : ''}</div>
    <div class="acts row" style="gap:4px"><button class="btn sm" data-bal="${a.id}">Update</button><button class="icon-btn" data-edit="${a.id}" title="Edit">${icon('edit', 15)}</button></div></div>`;
}
function balanceForm(a) {
  modal(`${mhead('Update balance', h(a.name))}<form class="form"><label>${a.is_liability ? 'Amount owed' : 'Balance'} (${a.currency})<input type="number" step="0.01" name="balance" value="${Math.abs(a.balance)}" required autofocus></label><label>As of<input type="date" name="date" value="${todayIso()}"></label><div class="form-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
    (m, close) => $('form', m).onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); await api(`/accounts/${a.id}/balance`, { method: 'POST', body: { balance: +f.get('balance'), date: f.get('date') } }); close(); toast('Balance updated'); render(); });
}
function accountForm(a) {
  modal(`${mhead(a ? 'Edit account' : 'Add an account', a ? '' : 'For banks Plaid can\'t reach, or cash and assets you track by hand.')}<form class="form">
    <label>Name<input name="name" value="${h(a?.name || '')}" required autofocus placeholder="e.g. Chase Checking"></label>
    <div class="two"><label>Type<select name="type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${a?.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>Institution<input name="institution" value="${h(a?.institution || '')}"></label></div>
    <div class="two"><label>Currency<select name="currency">${CURRENCIES.map(c => `<option ${(a?.currency || S.cur) === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    ${a ? '<span></span>' : '<label>Current balance<input type="number" step="0.01" name="balance" placeholder="what you owe, for cards & loans"></label>'}</div>
    <div class="two" data-show="credit"><label>Credit limit<input type="number" step="100" name="credit_limit" value="${a?.credit_limit ?? ''}"><span class="hint">Used for utilisation tracking.</span></label><span></span></div>
    <div class="two" data-show="investment savings"><label>Tax treatment<select name="tax_type">${Object.entries(TAX_TYPES).map(([k, v]) => `<option value="${k}" ${(a?.tax_type || '') === k ? 'selected' : ''}>${v}</option>`).join('')}</select><span class="hint">Tracks yearly contribution limits.</span></label><span></span></div>
    <label class="check"><input type="checkbox" name="include_in_net_worth" ${!a || a.include_in_net_worth ? 'checked' : ''}> Include in net worth</label>
    ${a ? `<label class="check"><input type="checkbox" name="archived" ${a.archived ? 'checked' : ''}> Archived (closed account; keeps history)</label>` : ''}
    <div class="form-actions">${a ? `<button class="btn danger" type="button" id="del">${icon('trash', 15)} Delete</button><span class="grow"></span>` : ''}<button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
    (m, close) => {
      const sync = () => { const t = $('[name=type]', m).value; $$('[data-show]', m).forEach(el => el.classList.toggle('hidden', !el.dataset.show.split(' ').includes(t))); };
      $('[name=type]', m).onchange = sync; sync();
      $('form', m).onsubmit = async e => {
        e.preventDefault(); const f = new FormData(e.target);
        const body = { name: f.get('name'), type: f.get('type'), institution: f.get('institution'), currency: f.get('currency'), include_in_net_worth: f.get('include_in_net_worth') === 'on',
          credit_limit: f.get('type') === 'credit' && f.get('credit_limit') ? +f.get('credit_limit') : null, tax_type: ['investment', 'savings'].includes(f.get('type')) ? f.get('tax_type') : '' };
        try {
          if (a) { body.archived = f.get('archived') === 'on'; await api(`/accounts/${a.id}`, { method: 'PATCH', body }); }
          else { if (f.get('balance')) body.balance = +f.get('balance'); await api('/accounts', { method: 'POST', body }); }
          close(); toast('Saved'); render();
        } catch (err) { toast(err.message); }
      };
      if (a) $('#del', m).onclick = async () => { if (await confirmModal(`Delete ${a.name} and all ${a.tx_count} of its transactions? Archiving keeps history instead.`)) { await api(`/accounts/${a.id}`, { method: 'DELETE' }); close(); render(); } };
    });
}

// ======================================================================
// transactions
// ======================================================================
views.transactions = async (main, q) => {
  const st = { q: q.q || '', account_id: q.account_id || '', category_id: q.category_id || '', uncategorized: q.uncategorized === '1', unreviewed: q.unreviewed === '1', start: q.start || '', end: q.end || '', tag: q.tag || '', offset: 0 };
  const sel = new Set();
  main.innerHTML = ph('Transactions', '<span id="tx-count">&nbsp;</span>', `<button class="btn" data-export>${icon('download', 15)} Export</button><button class="btn primary" id="add-tx">${icon('plus', 15)} Add</button>`) + `
  <section class="card">
    <div class="toolbar"><div class="search"><span>${icon('search', 16)}</span><input type="search" id="f-q" placeholder="Search merchant, notes, amount…" value="${h(st.q)}"></div>
      <select id="f-acct"><option value="">All accounts</option>${S.accts.map(a => `<option value="${a.id}" ${st.account_id == a.id ? 'selected' : ''}>${h(a.name)}</option>`).join('')}</select>
      <select id="f-cat"><option value="">All categories</option>${S.cats.map(c => `<option value="${c.id}" ${st.category_id == c.id ? 'selected' : ''}>${h(c.name)}</option>`).join('')}</select>
      <input type="date" id="f-start" value="${st.start}" title="From"><input type="date" id="f-end" value="${st.end}" title="To"></div>
    <div class="row wrap" style="margin:-4px 0 12px;gap:6px"><button class="chip ${st.uncategorized ? 'accent' : 'ghost'}" id="f-unc" style="cursor:pointer">Uncategorized</button><button class="chip ${st.unreviewed ? 'accent' : 'ghost'}" id="f-unrev" style="cursor:pointer">Needs review</button>${st.tag ? `<span class="chip accent">${icon('tag', 12)} ${h(st.tag)}</span>` : ''}</div>
    <div class="bulkbar" id="bulk"><b id="bulk-n"></b>${catSelect(null, 'id="bulk-cat"')}<button class="btn sm" id="bulk-apply">Set category</button><button class="btn sm" id="bulk-review">Mark reviewed</button><button class="btn sm" id="bulk-hide">Hide</button><input id="bulk-tag" placeholder="tag" style="width:110px"><button class="btn sm" id="bulk-tag-btn">Tag</button></div>
    <div id="tx-table" style="overflow-x:auto"></div><div class="center" style="margin-top:14px"><button class="btn" id="more">Load more</button></div>
  </section>`;
  let items = [], total = 0;
  const load = async (append = false) => {
    if (!append) { st.offset = 0; items = []; }
    const p = new URLSearchParams({ limit: 100, offset: st.offset });
    ['q', 'account_id', 'category_id', 'start', 'end', 'tag'].forEach(k => st[k] && p.set(k, st[k]));
    if (st.uncategorized) p.set('uncategorized', 'true'); if (st.unreviewed) p.set('unreviewed', 'true');
    const r = await api('/transactions?' + p); total = r.total; items = items.concat(r.items); st.offset = items.length;
    const sum = items.reduce((s, t) => s + t.amount, 0);
    $('#tx-count').innerHTML = `${total.toLocaleString()} transactions${items.length ? ` · net of shown <b class="num">${money(sum, { sign: true })}</b>` : ''}`;
    $('#more').style.display = items.length < total ? '' : 'none';
    draw();
  };
  const groupBy = (arr) => { const g = []; arr.forEach(t => { const last = g[g.length - 1]; if (last && last.date === t.date) last.items.push(t); else g.push({ date: t.date, items: [t] }); }); return g; };
  const draw = () => {
    $('#tx-table').innerHTML = items.length ? `<table><thead><tr><th style="width:28px"><input type="checkbox" id="sel-all"></th><th>Merchant</th><th>Category</th><th>Account</th><th class="right">Amount</th></tr></thead><tbody>
      ${groupBy(items).map(g => `<tr><td colspan="5" style="background:var(--surface-2);font-size:12px;font-weight:600;color:var(--text-2);padding:6px 10px">${fmtDate(g.date, { weekday: 'long', month: 'long', day: 'numeric' })}</td></tr>${g.items.map(t => `<tr class="click" data-id="${t.id}"><td><input type="checkbox" data-sel="${t.id}" ${sel.has(t.id) ? 'checked' : ''}></td>
        <td><div class="row" style="gap:10px">${monoIc(t.merchant, groupColor(t.category_group))}<div style="min-width:0"><div style="font-weight:550">${h(t.merchant)} ${t.pending ? '<span class="chip pending">pending</span>' : ''}${t.transfer_pair_id ? '<span class="chip">transfer</span>' : ''}${t.split_count ? '<span class="chip">split</span>' : ''}${t.tags.map(g => `<span class="chip">${icon('tag', 11)} ${h(g)}</span>`).join(' ')}</div>${t.notes ? `<div class="small muted">${h(t.notes)}</div>` : ''}</div></div></td>
        <td>${catChip(t)}</td><td class="small muted nowrap">${h(t.account)}</td><td class="right">${amt(t.amount)}</td></tr>`).join('')}`).join('')}</tbody></table>` : empty('No transactions match these filters.', 'search');
    $$('tr[data-id]', main).forEach(tr => tr.onclick = (e) => { if (e.target.closest('input,[data-catpick]')) return; txDetail(items.find(t => t.id === +tr.dataset.id), () => load()); });
    $$('[data-catpick]', main).forEach(el => el.onclick = () => quickCategory(items.find(t => t.id === +el.dataset.catpick), () => load()));
    $$('[data-sel]', main).forEach(cb => cb.onchange = () => { cb.checked ? sel.add(+cb.dataset.sel) : sel.delete(+cb.dataset.sel); upd(); });
    const all = $('#sel-all'); if (all) all.onchange = () => { items.forEach(t => all.checked ? sel.add(t.id) : sel.delete(t.id)); draw(); upd(); };
  };
  const upd = () => { $('#bulk').classList.toggle('show', sel.size > 0); $('#bulk-n').textContent = `${sel.size} selected`; };
  const bulk = async (body) => { await api('/transactions/bulk', { method: 'POST', body: { ids: [...sel], ...body } }); sel.clear(); upd(); toast('Updated'); load(); };
  $('#bulk-apply').onclick = () => bulk({ category_id: +$('#bulk-cat').value });
  $('#bulk-review').onclick = () => bulk({ reviewed: true }); $('#bulk-hide').onclick = () => bulk({ hidden: true });
  $('#bulk-tag-btn').onclick = () => $('#bulk-tag').value && bulk({ add_tag: $('#bulk-tag').value });
  let deb; $('#f-q').oninput = e => { st.q = e.target.value; clearTimeout(deb); deb = setTimeout(() => load(), 250); };
  $('#f-acct').onchange = e => { st.account_id = e.target.value; load(); }; $('#f-cat').onchange = e => { st.category_id = e.target.value; load(); };
  $('#f-start').onchange = e => { st.start = e.target.value; load(); }; $('#f-end').onchange = e => { st.end = e.target.value; load(); };
  $('#f-unc').onclick = e => { st.uncategorized = !st.uncategorized; e.target.className = 'chip ' + (st.uncategorized ? 'accent' : 'ghost'); load(); };
  $('#f-unrev').onclick = e => { st.unreviewed = !st.unreviewed; e.target.className = 'chip ' + (st.unreviewed ? 'accent' : 'ghost'); load(); };
  $('#more').onclick = () => load(true);
  $('#add-tx').onclick = () => modal(`${mhead('Add a transaction', 'For cash purchases or anything your bank feed missed.')}<form class="form"><div class="two"><label>Account${acctSelect(null, 'name="account_id"')}</label><label>Date<input type="date" name="date" value="${todayIso()}" required></label></div>
    <label>Description<input name="description" required placeholder="e.g. Farmers market" autofocus></label><div class="two"><label>Amount<input type="number" step="0.01" name="amount" required><span class="hint">Negative for spending, positive for income.</span></label><label>Category${catSelect(null, 'name="category_id"')}</label></div>
    <label>Notes<input name="notes"></label><div class="form-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Add</button></div></form>`,
    (m, close) => $('form', m).onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.account_id = +f.account_id; f.amount = +f.amount; f.category_id = +f.category_id; await api('/transactions', { method: 'POST', body: f }); close(); toast('Added'); load(); });
  await load();
};
function quickCategory(t, done) {
  modal(`${mhead('Categorize', `${h(t.merchant)} · ${money(t.amount)} · ${fmtDate(t.date)}`)}<form class="form"><label>Category${catSelect(t.category_id, 'name="category_id" autofocus')}</label>
    <label class="check"><input type="checkbox" name="create_rule" checked> Always categorize matching transactions this way</label>
    <label>Match text<input name="rule_pattern" value="${h(t.merchant)}"><span class="hint">Applies to past unreviewed transactions too. Edit in Settings → Rules.</span></label>
    <div class="form-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
    (m, close) => $('form', m).onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); const r = await api(`/transactions/${t.id}`, { method: 'PATCH', body: { category_id: +f.get('category_id'), create_rule: f.get('create_rule') === 'on', rule_pattern: f.get('rule_pattern') } }); close(); toast(r.rule_applied_to ? `Saved · rule applied to ${plural(r.rule_applied_to, 'transaction')}` : 'Saved'); done(); });
}
const splitRow = (s) => `<div class="row split-row" style="margin-bottom:6px"><input type="number" step="0.01" name="s_amount" value="${s.amount}" style="width:120px">${catSelect(s.category_id, 'name="s_cat" style="flex:1"')}</div>`;
async function txDetail(t0, done) {
  const t = await api(`/transactions/${t0.id}`);
  modal(`${mhead(h(t.merchant), `${h(t.description)} · ${h(t.account)}`)}
  <form class="form"><div class="two"><label>Merchant name<input name="merchant" value="${h(t.merchant)}"></label><label>Amount<input type="number" step="0.01" name="amount" value="${t.amount}"></label></div>
  <div class="two"><label>Category${catSelect(t.category_id, 'name="category_id"')}</label><label>Date<input type="date" name="date" value="${t.date}"></label></div>
  <label>Tags<input name="tags" value="${h(t.tags.join(', '))}" placeholder="comma-separated, e.g. reimbursable, trip-japan"></label><label>Notes<textarea name="notes" rows="2">${h(t.notes || '')}</textarea></label>
  <label class="check"><input type="checkbox" name="hidden" ${t.hidden ? 'checked' : ''}> Hide from budgets and reports</label>
  <details ${t.splits.length ? 'open' : ''}><summary><span class="chev">${icon('chevR', 14)}</span>Split across categories ${t.splits.length ? `(${t.splits.length})` : ''}</summary><div id="splits" style="margin-top:10px">${(t.splits.length ? t.splits : [{ amount: t.amount, category_id: t.category_id }]).map(splitRow).join('')}</div><div class="row"><button class="btn sm" type="button" id="add-split">${icon('plus', 14)} Add split</button><button class="btn sm" type="button" id="save-splits">Save splits</button><span class="small bad" id="split-sum"></span></div></details>
  <div class="form-actions"><button class="btn danger" type="button" id="del">${icon('trash', 15)} Delete</button><span class="grow"></span><button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
    (m, close) => {
      $('form', m).onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); await api(`/transactions/${t.id}`, { method: 'PATCH', body: { merchant: f.get('merchant'), amount: +f.get('amount'), category_id: +f.get('category_id'), date: f.get('date'), notes: f.get('notes'), hidden: f.get('hidden') === 'on', tags: f.get('tags').split(',').map(s => s.trim()).filter(Boolean) } }); close(); toast('Saved'); done(); };
      $('#del', m).onclick = async () => { if (await confirmModal('Delete this transaction?')) { await api(`/transactions/${t.id}`, { method: 'DELETE' }); done(); } };
      $('#add-split', m).onclick = () => $('#splits', m).insertAdjacentHTML('beforeend', splitRow({ amount: 0 }));
      $('#save-splits', m).onclick = async () => { const rows = $$('.split-row', m).map(r => ({ amount: +$('[name=s_amount]', r).value, category_id: +$('[name=s_cat]', r).value })); const sum = rows.reduce((s, r) => s + r.amount, 0); if (Math.abs(sum - t.amount) > .005) { $('#split-sum', m).textContent = `Splits add up to ${money(sum)}; need ${money(t.amount)}`; return; } try { await api(`/transactions/${t.id}/splits`, { method: 'PUT', body: rows.length > 1 ? rows : [] }); toast('Splits saved'); close(); done(); } catch (err) { toast(err.message); } };
    });
}

async function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
}
/** Read a bank export as CSV text. Excel files (common for Indian banks) are converted in the browser. */
async function fileToCsv(file) {
  if (/\.(xlsx?|xlsm)$/i.test(file.name)) {
    if (!window.XLSX) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false, raw: false });
    return XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { blankrows: false });
  }
  return await file.text();
}

// ======================================================================
// budget
// ======================================================================
views.budget = async (main, q) => {
  let month = q.month || thisMonth();
  const draw = async () => {
    destroyCharts();
    const bs = await api('/budgets?month=' + month), s = bs.summary, t = bs.totals;
    const isNow = month === thisMonth();
    const section = (title, type, rows, desc) => !rows.length && type === 'income' ? '' : `<div class="span-12">${card(title, `<div class="small muted" style="margin:-8px 0 10px">${desc}</div>
      <table><thead><tr><th>Category</th><th class="right" style="width:120px">Budget</th><th class="right" style="width:110px">${type === 'income' ? 'Received' : 'Spent'}</th><th class="right" style="width:120px">${type === 'income' ? 'Still expected' : 'Left'}</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><div class="row" style="gap:8px;margin-bottom:${r.kind === 'expense' ? 6 : 0}px"><span style="font-weight:550">${h(r.category)}</span>${r.rollover ? `<span class="chip" data-tip="${h('Unspent budget carried forward from earlier months')}">${money(r.rollover, { sign: true, cents: false })} rolled over</span>` : ''}</div>${r.kind === 'expense' ? bar(r.pct, { thin: true, mark: isNow ? s.month_progress : null, markTip: 'Today' }) : ''}</td>
        <td class="right"><input type="number" step="1" data-cat="${r.category_id}" value="${r.budget ?? ''}" placeholder="—" style="width:100px"></td><td class="right num">${money(r.actual)}</td>
        <td class="right num ${r.remaining == null ? 'muted' : r.remaining < 0 && r.kind === 'expense' ? 'bad' : ''}" style="font-weight:600">${r.remaining == null ? '—' : money(r.kind === 'income' ? Math.max(0, -r.remaining) : r.remaining)}</td></tr>`).join('') || `<tr><td colspan="4" class="muted small">Nothing here yet.</td></tr>`}</tbody></table>`,
      { meta: type === 'income' ? `${money(t.income_actual, { cents: false })} of ${money(t.income_budget, { cents: false })}` : `${money(t[type + '_actual'], { cents: false })} of ${money(t[type + '_budget'], { cents: false })}` })}</div>`;
    const rows = bs.rows;
    main.innerHTML = ph('Budget', 'Type a number to set a monthly budget. It applies to every month until you change it.',
      `<div class="seg"><button id="prev">${icon('chevL', 15)}</button><button class="active" style="min-width:150px">${monthName(month)}</button><button id="next">${icon('chevR', 15)}</button></div><button class="btn" id="suggest">${icon('sparkle', 15)} Suggest from history</button>`) + `
    <div class="tiles" style="margin-bottom:16px">
      <div class="tile"><div class="t-label"><span class="t-ic">${icon('arrowDown', 15)}</span>Expected income</div><div class="t-value">${money(s.expected_income, { cents: false })}</div><div class="t-sub">${t.income_budget ? 'from your income budget' : 'actual so far; set an income budget'}</div></div>
      <div class="tile"><div class="t-label"><span class="t-ic">${icon('pie', 15)}</span>Planned spending</div><div class="t-value">${money(s.planned_spending, { cents: false })}</div><div class="t-sub">fixed ${money(t.fixed_budget, { compact: true })} · flex ${money(t.flex_budget, { compact: true })} · irregular ${money(t.non_monthly_budget, { compact: true })}</div></div>
      <div class="tile"><div class="t-label"><span class="t-ic">${icon('piggy', 15)}</span>Left to budget</div><div class="t-value ${s.left_to_budget < 0 ? 'bad' : 'pos'}">${money(s.left_to_budget, { cents: false })}</div><div class="t-sub">${s.left_to_budget < 0 ? 'planning to spend more than you earn' : 'unassigned: savings, goals or investing'}</div></div>
      <div class="tile"><div class="t-label"><span class="t-ic">${icon('clock', 15)}</span>${isNow ? 'Left this month' : 'Left over'}</div><div class="t-value ${s.remaining < 0 ? 'bad' : ''}">${money(s.remaining, { cents: false })}</div><div class="t-sub" style="margin-bottom:8px">${money(s.spent, { cents: false })} spent${s.unbudgeted_spend ? ` · <span class="warn">${money(s.unbudgeted_spend, { cents: false })} unbudgeted</span>` : ''}</div>${bar(s.planned_spending ? s.spent / s.planned_spending : 0, { thin: true, mark: isNow ? s.month_progress : null })}</div>
    </div>
    <div class="grid g12">
      ${section('Income', 'income', rows.filter(r => r.kind === 'income'), 'What you expect to earn.')}
      ${section('Fixed', 'fixed', rows.filter(r => r.kind === 'expense' && r.budget_type === 'fixed'), 'Bills that cost the same every month.')}
      ${section('Flexible', 'flex', rows.filter(r => r.kind === 'expense' && r.budget_type === 'flex'), 'Day-to-day spending you can dial up or down.')}
      ${section('Non-monthly', 'non_monthly', rows.filter(r => r.kind === 'expense' && r.budget_type === 'non_monthly'), 'Irregular costs. Turn on rollover so unspent money builds up for the big months.')}
      <div class="span-12">${card(null, `<details><summary><span class="chev">${icon('chevR', 14)}</span>Add a budget for another category</summary><div class="row wrap" style="margin-top:12px">${catSelect(null, 'id="new-cat"')}<input type="number" id="new-amt" placeholder="amount" style="width:120px"><button class="btn" id="new-add">Add</button><span class="small muted">Change a category's type and rollover in <a href="#settings?tab=categories">Settings</a>.</span></div></details>`)}</div>
    </div>`;
    hydrateIcons(main);
    $('#prev').onclick = () => { month = shiftMonth(month, -1); draw(); }; $('#next').onclick = () => { month = shiftMonth(month, 1); draw(); };
    $$('input[data-cat]', main).forEach(inp => inp.onchange = async () => { await api('/budgets', { method: 'PUT', body: { category_id: +inp.dataset.cat, amount: inp.value === '' ? null : +inp.value, month: null } }); toast('Budget saved'); draw(); });
    $('#new-add').onclick = async () => { if (!$('#new-amt').value) return; await api('/budgets', { method: 'PUT', body: { category_id: +$('#new-cat').value, amount: +$('#new-amt').value, month: null } }); draw(); };
    $('#suggest').onclick = async () => { const sug = await api('/budgets/suggest'); modal(`${mhead('Suggested budgets', 'Your average over the last 3 complete months.')}<table class="plain">${sug.map(x => `<tr><td>${h(x.category)}</td><td class="right num">${money(x.suggested, { cents: false })}</td></tr>`).join('')}</table><div class="form-actions" style="margin-top:14px"><button class="btn" data-close>Cancel</button><button class="btn primary" id="apply">Apply all</button></div>`, (m, close) => $('#apply', m).onclick = async () => { const r = await api('/budgets/apply-suggestions', { method: 'POST' }); close(); toast(`Set ${plural(r.set, 'budget')}`); draw(); }); };
  };
  await draw();
};

// ======================================================================
// recurring
// ======================================================================
views.recurring = async (main) => {
  const r = await api('/recurring');
  const now = new Date(), y = now.getFullYear(), mo = now.getMonth(), daysIn = new Date(y, mo + 1, 0).getDate(), first = new Date(y, mo, 1).getDay();
  const byDay = {};
  r.items.forEach(it => { const d = toDate(it.next_date); if (d.getFullYear() === y && d.getMonth() === mo) (byDay[d.getDate()] ||= []).push(it); });
  const exp = r.items.filter(i => i.kind === 'expense'), inc = r.items.filter(i => i.kind === 'income');
  const subs = exp.filter(i => i.category === 'Subscriptions');
  const row = (it) => `<tr><td><div class="row" style="gap:10px">${monoIc(it.merchant, it.kind === 'income' ? css('--s6') : groupColor(S.catGroup[it.category_id]))}<div><div style="font-weight:550">${h(it.merchant)}</div><div class="small muted">${h(it.category || '')} · ${it.cadence} · seen ${it.occurrences}×</div></div></div></td>
    <td class="small nowrap">${it.overdue ? '<span class="bad">overdue</span>' : fmtDate(it.next_date)}<div class="muted tiny">${relDays(it.days_until)}</div></td><td class="right">${amt(it.amount)}</td><td class="right small muted num nowrap">${money(Math.abs(it.monthly_equivalent))}/mo</td>
    <td class="right nowrap">${it.status !== 'ignored' ? `<button class="btn sm ghost" data-ign="${it.merchant_key}">Not recurring</button>` : `<button class="btn sm" data-un="${it.merchant_key}">Restore</button>`}</td></tr>`;
  main.innerHTML = ph('Recurring', 'Bills, subscriptions and income found in your history. Dismiss anything that isn\'t really recurring.') + `
  <div class="tiles" style="margin-bottom:16px">
    <div class="tile"><div class="t-label"><span class="t-ic">${icon('repeat', 15)}</span>Recurring bills</div><div class="t-value">${money(r.monthly_expenses, { cents: false })}<span class="muted" style="font-size:14px;font-weight:500">/mo</span></div><div class="t-sub">${plural(exp.length, 'item')} · ${money(r.monthly_expenses * 12, { cents: false })} a year</div></div>
    <div class="tile"><div class="t-label"><span class="t-ic">${icon('arrowDown', 15)}</span>Recurring income</div><div class="t-value">${money(r.monthly_income, { cents: false })}<span class="muted" style="font-size:14px;font-weight:500">/mo</span></div><div class="t-sub">${plural(inc.length, 'source')}</div></div>
    <div class="tile"><div class="t-label"><span class="t-ic">${icon('zap', 15)}</span>Subscriptions</div><div class="t-value">${money(-subs.reduce((s, i) => s + i.monthly_equivalent, 0), { cents: false })}<span class="muted" style="font-size:14px;font-weight:500">/mo</span></div><div class="t-sub">${subs.map(i => h(i.merchant)).join(', ') || 'none detected'}</div></div>
    <div class="tile"><div class="t-label"><span class="t-ic">${icon('piggy', 15)}</span>Committed share of income</div><div class="t-value">${r.monthly_income ? pct(r.monthly_expenses / r.monthly_income) : '—'}</div><div class="t-sub">goes to recurring bills before you spend anything</div></div>
  </div>
  <div class="grid g12">
    <div class="span-8">${card(now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), `<div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="dow">${d}</div>`).join('')}${'<div></div>'.repeat(first)}
      ${Array.from({ length: daysIn }, (_, i) => i + 1).map(d => `<div class="day ${d === now.getDate() ? 'today' : ''}"><div class="d">${d}</div>${(byDay[d] || []).map(it => `<div class="ev ${it.amount > 0 ? 'in' : ''}" data-tip="${h(`<b>${h(it.merchant)}</b><br>${money(it.amount, { sign: true })} · ${it.cadence}`)}">${h(it.merchant)}</div>`).join('')}</div>`).join('')}</div>`)}</div>
    <div class="span-4">${card('Add a missing one', `<p class="small soft">Detection needs three or more charges on a steady schedule. If a bill is new, confirm it by merchant name and it'll be tracked from now on.</p><div class="row"><input id="conf-key" placeholder="Merchant name" class="grow"><button class="btn" id="conf-btn">Confirm</button></div>`)}</div>
    <div class="span-12">${card('Bills & subscriptions', exp.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Merchant</th><th>Next</th><th class="right">Amount</th><th class="right">Monthly</th><th></th></tr></thead><tbody>${exp.map(row).join('')}</tbody></table></div>` : empty('Nothing detected yet.', 'repeat'))}</div>
    <div class="span-12">${card('Income', inc.length ? `<div style="overflow-x:auto"><table><tbody>${inc.map(row).join('')}</tbody></table></div>` : empty('No recurring income detected.', 'arrowDown'))}</div>
  </div>`;
  $$('[data-ign]', main).forEach(b => b.onclick = async () => { await api(`/recurring/${b.dataset.ign}/status`, { method: 'POST', body: { status: 'ignored' } }); render(); });
  $$('[data-un]', main).forEach(b => b.onclick = async () => { await api(`/recurring/${b.dataset.un}/status`, { method: 'POST', body: { status: 'detected' } }); render(); });
  $('#conf-btn').onclick = async () => { const v = $('#conf-key').value; const k = v.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24); if (!k) return; await api(`/recurring/${k}/status`, { method: 'POST', body: { status: 'confirmed', display_name: v } }); toast('Confirmed'); render(); };
};

// ======================================================================
// goals
// ======================================================================
views.goals = async (main) => {
  const goals = await api('/goals');
  main.innerHTML = ph('Goals', 'Link a goal to an account and progress follows its balance automatically.', `<button class="btn primary" id="add">${icon('plus', 15)} New goal</button>`) + `
  <div class="grid g3">${goals.map(g => card(null, `<div class="row between" style="margin-bottom:14px"><span class="chip">${icon(g.kind === 'payoff' ? 'card' : 'piggy', 12)} ${g.kind === 'payoff' ? 'Pay off' : 'Save up'}</span>${g.remaining <= 0 ? statusChip('good', 'Done') : g.target_date ? statusChip(g.on_track ? 'good' : 'warning', g.on_track ? 'On track' : 'Behind') : ''}</div>
    <div class="row" style="gap:18px">${ring(g.pct * 100, { size: 96, stroke: 9, color: g.pct >= 1 ? css('--good') : css('--s1'), label: `<b style="font-size:20px">${pct(g.pct)}</b>` })}<div style="min-width:0"><h2 style="font-size:16px">${h(g.name)}</h2><div class="num soft" style="margin-top:2px">${money(g.current, { cents: false })} <span class="muted">of ${money(g.target_amount, { cents: false })}</span></div></div></div>
    <dl class="kv" style="margin-top:16px">${g.remaining > 0 ? `<dt>Still to go</dt><dd>${money(g.remaining, { cents: false })}</dd>` : ''}${g.target_date ? `<dt>Target date</dt><dd>${fmtDate(g.target_date, { month: 'short', year: 'numeric' })}</dd>` : ''}${g.needed_per_month != null && g.remaining > 0 ? `<dt>Needed per month</dt><dd>${money(g.needed_per_month, { cents: false })}</dd>` : ''}${g.monthly_contribution ? `<dt>You're putting in</dt><dd>${money(g.monthly_contribution, { cents: false })}/mo</dd>` : ''}${g.eta_months ? `<dt>At that rate</dt><dd>${g.eta_months} months</dd>` : ''}</dl>
    ${g.remaining > 0 && g.target_date && !g.on_track ? `<div class="callout warning small" style="margin-top:12px">${icon('alert', 15, 2)}<div>Add ${money(g.needed_per_month - g.monthly_contribution, { cents: false })}/mo or push the date out.</div></div>` : ''}
    <div class="row" style="margin-top:14px"><button class="btn sm" data-edit="${g.id}">${icon('edit', 14)} Edit</button><button class="btn sm ghost danger" data-del="${g.id}">Remove</button></div>`)).join('') || `<div style="grid-column:1/-1">${card(null, empty('No goals yet. An emergency fund is a great first one.', 'target', `<button class="btn primary" id="add2">Create a goal</button>`))}</div>`}</div>`;
  const form = (g) => modal(`${mhead(g ? 'Edit goal' : 'New goal')}<form class="form"><label>Name<input name="name" value="${h(g?.name || '')}" required autofocus placeholder="e.g. Emergency fund"></label>
    <div class="two"><label>Type<select name="kind"><option value="save" ${g?.kind === 'save' ? 'selected' : ''}>Save up</option><option value="payoff" ${g?.kind === 'payoff' ? 'selected' : ''}>Pay off debt</option></select></label><label>Target amount<input type="number" step="1" name="target_amount" value="${g?.target_amount || ''}" required></label></div>
    <div class="two"><label>Target date<input type="date" name="target_date" value="${g?.target_date || ''}"></label><label>Linked account${acctSelect(g?.account_id, 'name="account_id"', true)}<span class="hint">Progress follows this balance.</span></label></div>
    <div class="two"><label>Starting amount<input type="number" step="1" name="starting_amount" value="${g?.starting_amount || 0}"><span class="hint">Only used without a linked account.</span></label><label>Monthly contribution<input type="number" step="1" name="monthly_contribution" value="${g?.monthly_contribution || 0}"></label></div>
    <div class="form-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
    (m, close) => $('form', m).onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); ['target_amount', 'starting_amount', 'monthly_contribution'].forEach(k => f[k] = +f[k]); f.account_id = f.account_id ? +f.account_id : null; f.target_date = f.target_date || null; await api(g ? `/goals/${g.id}` : '/goals', { method: g ? 'PATCH' : 'POST', body: f }); close(); render(); });
  ['#add', '#add2'].forEach(s => { const b = $(s); if (b) b.onclick = () => form(); });
  $$('[data-edit]', main).forEach(b => b.onclick = () => form(goals.find(g => g.id === +b.dataset.edit)));
  $$('[data-del]', main).forEach(b => b.onclick = async () => { if (await confirmModal('Remove this goal?', 'Remove')) { await api(`/goals/${b.dataset.del}`, { method: 'DELETE' }); render(); } });
};

// ======================================================================
// reports
// ======================================================================
views.reports = async (main, q) => {
  let months = +(q.months || 1), catId = q.category_id ? +q.category_id : null;
  const draw = async () => {
    destroyCharts();
    const [sp, cf, sk, pc, dl] = await Promise.all([api(`/reports/spending?months=${months}`), api('/reports/cashflow?months=12'), api(`/reports/sankey?months=${months}`), api('/reports/pace'), api('/reports/daily?months=3')]);
    const trend = catId ? await api(`/reports/trend/${catId}?months=12`) : null;
    const cats = sp.groups.flatMap(g => g.categories.map(c => ({ ...c, group: g.group }))).sort((a, b) => b.spent - a.spent);
    const totalSp = sp.groups.reduce((s, g) => s + g.spent, 0);
    const full = cf.slice(0, -1).filter(x => x.income);
    const avgSr = full.length ? full.reduce((s, x) => s + (x.savings_rate || 0), 0) / full.length : null;
    main.innerHTML = ph('Reports', `${fmtDate(sp.start, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmtDate(sp.end, { month: 'short', day: 'numeric', year: 'numeric' })}`,
      `<div class="seg">${[1, 3, 6, 12].map(n => `<button data-m="${n}" class="${months === n ? 'active' : ''}">${n === 1 ? 'This month' : n + ' months'}</button>`).join('')}</div>`) + `
    <div class="grid g12">
      <div class="span-12">${card('Where your money went', `<div class="small soft" style="margin:-8px 0 8px">${money(sk.income, { cents: false })} in → ${money(sk.expenses, { cents: false })} spent${sk.income > sk.expenses ? ` → <b class="pos">${money(sk.income - sk.expenses, { cents: false })} saved</b>` : ''}. Hover a flow for details.</div><div style="overflow-x:auto"><svg class="sankey" id="sankey" style="min-width:680px"></svg></div>`)}</div>
      <div class="span-7">${card('Spending pace', `<div class="chart"><canvas id="pace"></canvas></div>${paceLegend(pc)}`, { meta: pc.projected ? `on pace for ${money(pc.projected, { cents: false })}` : monthName(pc.month) })}</div>
      <div class="span-5">${card('Daily spending', `<div class="grid g3" style="gap:12px">${dl.months.map(m => `<div>${heatmapHtml(m, dl.breaks, { labels: false, title: fmtDate(m.month + '-01', { month: 'short' }) })}</div>`).join('')}</div>${heatScale(dl.breaks)}`, { meta: 'last 3 months' })}</div>
      <div class="span-8">${card('Income, spending and savings', `<div class="chart"><canvas id="cf"></canvas></div>${legend([{ label: 'Income', color: css('--s1') }, { label: 'Spending', color: css('--s2') }, { label: 'Saved', color: css('--s3') }])}`, { meta: '12 months' })}</div>
      <div class="span-4">${card('Savings rate', `<div class="chart"><canvas id="sr"></canvas></div><div class="small soft" style="margin-top:8px">Average ${pct(avgSr)} · target ${pct(S.profile.savings_rate_target)}</div>`)}</div>
      <div class="span-4">${card('By group', `<div class="list">${sp.groups.map(g => `<div class="li"><span style="width:10px;height:10px;border-radius:3px;background:${groupColor(g.group)};flex:none"></span><div class="grow main-t" style="font-weight:500">${h(g.group)}</div><span class="small muted num">${pct(g.spent / (totalSp || 1))}</span><span class="amt">${money(g.spent, { cents: false })}</span></div>`).join('')}</div>`)}</div>
      <div class="span-4">${card('By category', `<div class="list">${cats.slice(0, 12).map(c => `<div class="li" style="cursor:pointer" data-cat="${c.category_id}"><span style="width:10px;height:10px;border-radius:3px;background:${groupColor(c.group)};flex:none"></span><div class="grow"><div class="main-t" style="font-weight:500">${h(c.category)}</div><div class="sub-t">${plural(c.count, 'transaction')}</div></div><span class="amt">${money(c.spent, { cents: false })}</span></div>`).join('')}</div>`, { meta: 'click for trend' })}</div>
      <div class="span-4">${card('Top merchants', `<div class="list">${sp.merchants.slice(0, 12).map(m => `<div class="li" style="cursor:pointer" data-q="${h(m.merchant)}">${monoIc(m.merchant, css('--surface-3')).replace('color:#fff', '')}<div class="grow"><div class="main-t" style="font-weight:500">${h(m.merchant)}</div><div class="sub-t">${m.count}×</div></div><span class="amt">${money(m.spent, { cents: false })}</span></div>`).join('')}</div>`)}</div>
      ${trend ? `<div class="span-12" id="trend-card">${card(`${h(catName(catId))} by month`, `<div class="chart"><canvas id="trend"></canvas></div>`, { right: `<button class="icon-btn" id="clear-trend">${icon('x', 16)}</button>` })}</div>` : ''}
    </div>`;
    hydrateIcons(main);
    $$('.list .mono-ic', main).forEach(e => { if (e.parentElement.dataset.q) e.style.color = 'var(--text-2)'; });
    drawSankey($('#sankey'), sk.links);
    paceChart($('#pace'), pc);
    barChart($('#cf'), cf.map(x => fmtMonth(x.month)), [{ label: 'Income', data: cf.map(x => x.income), color: css('--s1') }, { label: 'Spending', data: cf.map(x => x.expenses), color: css('--s2') }, { label: 'Saved', data: cf.map(x => x.savings), color: css('--s3') }], { thick: 14 });
    lineChart($('#sr'), cf.map(x => fmtMonth(x.month)), [{ label: 'Saved', data: cf.map(x => x.savings_rate == null ? null : Math.round(x.savings_rate * 100)), color: css('--s3'), fill: true, points: 3 }, { label: 'Target', data: cf.map(() => Math.round((S.profile.savings_rate_target || .2) * 100)), color: css('--muted'), dash: [5, 4], width: 1.5 }], { y: { pct: true }, pctVal: true });
    if (trend) { barChart($('#trend'), trend.map(x => fmtMonth(x.month)), [{ label: 'Spent', data: trend.map(x => x.spent), color: groupColor(S.catGroup[catId]) }]); $('#clear-trend').onclick = () => { catId = null; draw(); }; $('#trend-card').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    $$('.seg button', main).forEach(b => b.onclick = () => { months = +b.dataset.m; draw(); });
    $$('[data-cat]', main).forEach(el => el.onclick = () => { catId = +el.dataset.cat; draw(); });
    $$('[data-q]', main).forEach(el => el.onclick = () => location.hash = '#transactions?q=' + encodeURIComponent(el.dataset.q));
  };
  await draw();
};
function drawSankey(svg, links) {
  svg.innerHTML = '';
  if (!links.length) { svg.innerHTML = `<text x="20" y="30">No data for this period.</text>`; return; }
  const W = Math.max(680, svg.clientWidth || 900), H = 440, PAD = 10, NW = 10;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const layer = { 'Cash flow': 1 }, nodes = {};
  links.forEach(l => { nodes[l.source] ||= { name: l.source, out: 0, in: 0 }; nodes[l.target] ||= { name: l.target, out: 0, in: 0 }; nodes[l.source].out += l.value; nodes[l.target].in += l.value; });
  links.forEach(l => { if (l.target === 'Cash flow') layer[l.source] = 0; });
  links.forEach(l => { if (l.source === 'Cash flow') layer[l.target] = 2; });
  links.forEach(l => { if (layer[l.source] === 2 && layer[l.target] == null) layer[l.target] = 3; });
  const cols = [[], [], [], []];
  Object.values(nodes).forEach(n => { n.value = Math.max(n.in, n.out); n.layer = layer[n.name] ?? 3; cols[n.layer].push(n); });
  cols.forEach(c => c.sort((a, b) => b.value - a.value));
  const total = Math.max(...cols.map(c => c.reduce((s, n) => s + n.value, 0)));
  const usable = H - PAD * 2, labelW = 170;
  const colX = [labelW - 20, labelW + (W - 2 * labelW) * .33, labelW + (W - 2 * labelW) * .7, W - labelW];
  cols.forEach((c, i) => { const gap = c.length > 1 ? Math.min(12, usable * .22 / (c.length - 1)) : 0; const scale = (usable - gap * (c.length - 1)) / total; let y = PAD + (usable - (c.reduce((s, n) => s + n.value, 0) * scale + gap * (c.length - 1))) / 2; c.forEach(n => { Object.assign(n, { x: colX[i], y, h: Math.max(1.5, n.value * scale), scale, oy: y, iy: y }); y += n.h + gap; }); });
  const nodeColor = (n) => n.layer === 1 ? css('--text-2') : n.layer === 0 ? css('--s6') : n.name === 'Saved' ? css('--s3') : n.layer === 2 ? groupColor(n.name) : groupColor(links.find(l => l.target === n.name)?.source);
  let out = '';
  [...links].sort((a, b) => (nodes[a.source].y - nodes[b.source].y) || (nodes[a.target].y - nodes[b.target].y)).forEach(l => {
    const s = nodes[l.source], t = nodes[l.target], w = Math.max(1, l.value * s.scale);
    const x0 = s.x + NW, x1 = t.x, y0 = s.oy + w / 2, y1 = t.iy + w / 2; s.oy += w; t.iy += w;
    const cx = (x0 + x1) / 2, col = l.target === 'Cash flow' ? nodeColor(s) : nodeColor(t);
    out += `<path class="link" d="M${x0},${y0} C${cx},${y0} ${cx},${y1} ${x1},${y1}" stroke="${col}" stroke-width="${w}" data-tip="${h(`<b>${h(l.source)} → ${h(l.target)}</b><br>${money(l.value)}`)}"></path>`;
  });
  Object.values(nodes).forEach(n => {
    out += `<rect x="${n.x}" y="${n.y}" width="${NW}" height="${n.h}" rx="3" fill="${nodeColor(n)}" data-tip="${h(`<b>${h(n.name)}</b><br>${money(n.value)}`)}"></rect>`;
    if (n.h >= 10 || n.layer <= 1) { const left = n.layer === 0; const tx = left ? n.x - 8 : n.x + NW + 8; out += `<text x="${tx}" y="${n.y + n.h / 2 + 4}" text-anchor="${left ? 'end' : 'start'}">${h(n.name)} <tspan fill="${css('--muted')}">${money(n.value, { compact: true })}</tspan></text>`; }
  });
  svg.innerHTML = out;
}

// ======================================================================
// cash forecast
// ======================================================================
views.forecast = async (main, q) => {
  let days = +(q.days || 60);
  const draw = async () => {
    destroyCharts();
    const fc = await api(`/forecast?days=${days}`);
    let run = fc.start;
    const byDate = {}; fc.events.forEach(e => (byDate[e.date] ||= []).push(e));
    const rows = fc.events.map(e => { const p = fc.series.find(s => s.date === e.date); return { ...e, after: p ? p.balance : null }; });
    const below = fc.first_below_buffer;
    main.innerHTML = ph('Cash forecast', 'Where your spendable cash is heading, based on your paychecks, bills, scheduled transfers and typical day-to-day spending.',
      `<div class="seg">${[30, 60, 90].map(n => `<button data-d="${n}" class="${days === n ? 'active' : ''}">${n} days</button>`).join('')}</div>`) + `
    ${below ? `<div class="callout serious" style="margin-bottom:16px">${icon('alert', 18, 2)}<div><b>Projected to dip below your ${money(fc.buffer, { cents: false })} cushion around ${fmtDate(below, { weekday: 'short', month: 'short', day: 'numeric' })}.</b> Lowest point ${money(fc.low.balance, { cents: false })} on ${fmtDate(fc.low.date)}. Options: delay a transfer to savings or home, move money from savings beforehand, or trim spending by ${money(Math.max(0, fc.buffer - fc.low.balance), { cents: false })} before then.</div></div>`
      : `<div class="callout good" style="margin-bottom:16px">${icon('check', 18, 2)}<div>You stay above your ${money(fc.buffer, { cents: false })} cushion for the next ${days} days. Lowest point: ${money(fc.low.balance, { cents: false })} on ${fmtDate(fc.low.date)}.</div></div>`}
    <div class="tiles" style="margin-bottom:16px">
      <div class="tile"><div class="t-label"><span class="t-ic">${icon('wallet', 15)}</span>Starting point</div><div class="t-value">${money(fc.start, { cents: false })}</div><div class="t-sub">${money(fc.start_cash, { cents: false })} cash − ${money(fc.card_balances, { cents: false })} on cards</div></div>
      <div class="tile"><div class="t-label"><span class="t-ic">${icon('arrowDown', 15)}</span>Coming in</div><div class="t-value pos">${money(fc.income_total, { cents: false })}</div><div class="t-sub">scheduled income</div></div>
      <div class="tile"><div class="t-label"><span class="t-ic">${icon('arrowUp', 15)}</span>Going out</div><div class="t-value">${money(fc.outflow_total + fc.daily_variable * days, { cents: false })}</div><div class="t-sub">${money(fc.outflow_total, { cents: false })} scheduled + ~${money(fc.daily_variable, { cents: false })}/day everyday spending</div></div>
      <div class="tile"><div class="t-label"><span class="t-ic">${icon('calendar', 15)}</span>In ${days} days</div><div class="t-value ${fc.end.balance < fc.buffer ? 'bad' : ''}">${money(fc.end.balance, { cents: false })}</div><div class="t-sub">${deltaChip(fc.end.balance - fc.start, { flat: 25 })}</div></div>
    </div>
    <div class="grid g12">
      <div class="span-12">${card('Projected spendable cash', `<div class="chart tall"><canvas id="fc"></canvas></div>${legend([{ label: 'Projected cash', color: css('--s1') }, { label: 'Your cushion', color: css('--muted'), kind: 'dash' }, { label: 'Lowest point', color: css('--serious') }])}`)}</div>
      <div class="span-8">${card('What\'s scheduled', rows.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>What</th><th class="right">Amount</th><th class="right">Cash after</th></tr></thead><tbody>${rows.map(e => `<tr><td class="nowrap small">${fmtDate(e.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td><td><span style="font-weight:550">${h(e.label)}</span> <span class="chip">${e.kind === 'transfer' ? 'transfer' : e.kind === 'income' ? 'income' : 'bill'}</span></td><td class="right">${amt(e.amount)}</td><td class="right num ${e.after != null && e.after < fc.buffer ? 'bad' : 'soft'}">${money(e.after, { cents: false })}</td></tr>`).join('')}</tbody></table></div>` : empty('No recurring items detected yet.', 'repeat'))}</div>
      <div class="span-4">${card('How this is calculated', `<div class="stack small soft"><p>Starts from your checking and cash balances, minus what you currently owe on credit cards (since that will be paid from checking).</p><p>Adds each detected paycheck and subtracts each detected bill, subscription and regular transfer (savings, investing, money sent home) on its expected date.</p><p>Subtracts <b>${money(fc.daily_variable)}</b> a day for everything else: your average non-recurring spending over the last 90 days.</p><p>Change your cushion in <a href="#settings?tab=profile">Settings → Profile</a>.</p></div>`)}</div>
    </div>`;
    hydrateIcons(main);
    forecastChart($('#fc'), fc, { ticks: 10 });
    $$('.seg button', main).forEach(b => b.onclick = () => { days = +b.dataset.d; draw(); });
  };
  await draw();
};

// ======================================================================
// money checkup
// ======================================================================
views.health = async (main) => {
  const c = await api('/checkup');
  const ICON = { emergency: 'shield', savings_rate: 'piggy', utilization: 'card', dti: 'bank', budget: 'pie', retirement: 'trending' };
  const LINK = { emergency: '#goals', savings_rate: '#reports', utilization: '#accounts', dti: '#accounts', budget: '#budget', retirement: '#investments' };
  if (c.score == null) { main.innerHTML = ph('Money checkup') + card(null, empty('Add a few months of transactions and account balances to get your checkup.', 'heart', '<a class="btn primary" href="#settings?tab=connections">Connect accounts</a>')); return; }
  const focus = c.metrics.find(m => m.id === c.focus);
  main.innerHTML = ph('Money checkup', 'A plain-English read on your financial health, scored against the targets in your profile.') + `
  <section class="hero" style="grid-template-columns:auto minmax(0,1fr);align-items:center">
    ${ring(c.score, { size: 168, stroke: 14, sub: c.grade })}
    <div><h1 style="margin-bottom:8px">Overall: ${h(c.grade)}</h1>
      <p class="soft" style="max-width:62ch">Based on the last 3 months: about <b>${money(c.avg_income, { cents: false })}</b> coming in and <b>${money(c.avg_expenses, { cents: false })}</b> going out each month, with <b>${money(c.liquid.net, { cents: false })}</b> in cash after card balances.</p>
      ${focus ? `<div class="callout info" style="margin-top:12px">${icon('sparkle', 16, 2)}<div><b>Where to focus next: ${h(focus.label.toLowerCase())}.</b> ${h(focus.advice)}</div></div>` : ''}</div>
  </section>
  <div class="grid g3">${c.metrics.map(m => card(null, `<div class="row between" style="margin-bottom:12px"><div class="row"><span class="t-ic" style="width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:var(--surface-2)">${icon(ICON[m.id] || 'info', 16)}</span><h2>${h(m.label)}</h2></div>${statusChip(m.status, m.status === 'good' ? 'Healthy' : m.status === 'warning' ? 'Watch' : 'Needs work')}</div>
    <div class="row between" style="align-items:baseline"><div class="t-value num" style="font-size:28px;font-weight:700;letter-spacing:-.03em">${h(m.display)}</div><span class="small muted">target ${h(m.target)}</span></div>
    <div style="margin:10px 0 12px">${bar(m.score / 100, { cls: m.status === 'good' ? 'good' : m.status === 'warning' ? 'warn' : 'over' })}</div>
    <p class="small soft" style="margin:0">${h(m.advice)}</p><a class="small" href="${LINK[m.id] || '#dashboard'}" style="display:inline-flex;align-items:center;gap:2px;margin-top:10px">Take a look ${icon('chevR', 13)}</a>`)).join('')}</div>`;
};

// ======================================================================
// money home (remittances)
// ======================================================================
views.home = async (main, q) => {
  let year = +(q.year || new Date().getFullYear());
  const draw = async () => {
    destroyCharts();
    const [r, fxd] = await Promise.all([api(`/remittances?year=${year}`), api('/fx')]);
    const sc = r.second_currency;
    const months = r.monthly.filter(m => year < new Date().getFullYear() || m.month <= thisMonth());
    const fam = r.by_category['Family Support'] || 0, own = r.by_category['International Transfer'] || 0;
    main.innerHTML = ph('Money home', 'Everything you send abroad: family support and transfers to your own accounts back home.',
      `<div class="seg"><button id="py">${icon('chevL', 15)}</button><button class="active">${year}</button><button id="ny">${icon('chevR', 15)}</button></div>`) + `
    <div class="tiles" style="margin-bottom:16px">
      <div class="tile"><div class="t-label"><span class="t-ic">${icon('send', 15)}</span>Sent in ${year}</div><div class="t-value">${money(r.total, { cents: false })}</div><div class="t-sub">${plural(r.count, 'transfer')}</div></div>
      <div class="tile"><div class="t-label"><span class="t-ic">${icon('globe', 15)}</span>${sc ? `In ${sc}` : 'Second currency'}</div><div class="t-value">${sc ? money(r.total_second, { cur: sc, cents: false }) : '—'}</div><div class="t-sub">${sc ? `at today's rate, 1 ${S.cur} = ${money(r.rate, { cur: sc, cents: true })}` : '<a href="#settings?tab=profile">Set a second currency</a>'}</div></div>
      <div class="tile"><div class="t-label"><span class="t-ic">${icon('calendar', 15)}</span>Monthly average</div><div class="t-value">${money(r.avg_month, { cents: false })}</div><div class="t-sub">${sc ? `≈ ${money(r.avg_month * (r.rate || 0), { cur: sc, cents: false })}` : ''}</div></div>
      <div class="tile"><div class="t-label"><span class="t-ic">${icon('chart', 15)}</span>Same period last year</div><div class="t-value">${money(r.same_period_last_year, { cents: false })}</div><div class="t-sub">${r.same_period_last_year ? deltaChip(r.total - r.same_period_last_year, { flat: 50 }) : 'no history'}</div></div>
    </div>
    <div class="grid g12">
      <div class="span-8">${card('By month', `<div class="chart"><canvas id="rm"></canvas></div>${legend([{ label: 'Family support', color: css('--s4') }, { label: 'To your own accounts', color: css('--s1') }])}`)}</div>
      <div class="span-4">${card('Split', `<div class="stack"><div><div class="row between small" style="margin-bottom:6px"><span style="font-weight:550">Family support</span><span class="num">${money(fam, { cents: false })}</span></div>${bar(fam / (r.total || 1), { color: css('--s4') })}<div class="tiny muted" style="margin-top:4px">Counted as spending in budgets and reports.</div></div>
        <div><div class="row between small" style="margin-bottom:6px"><span style="font-weight:550">To your own accounts</span><span class="num">${money(own, { cents: false })}</span></div>${bar(own / (r.total || 1), { color: css('--s1') })}<div class="tiny muted" style="margin-top:4px">Treated as a transfer: it's still your money, so it stays in net worth and out of spending.</div></div></div>
        <h3 style="margin-top:20px">Services used</h3><div class="list">${r.by_service.map(s => `<div class="li"><div class="grow main-t" style="font-weight:500">${h(s.merchant)}</div><span class="amt">${money(s.amount, { cents: false })}</span></div>`).join('') || '<div class="muted small">None yet.</div>'}</div>`)}</div>
      <div class="span-8">${card('Transfers', r.items.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Via</th><th>Type</th><th class="right">Amount</th>${sc ? `<th class="right">≈ ${sc}</th>` : ''}</tr></thead><tbody>${r.items.map(t => `<tr><td class="small nowrap">${fmtDate(t.date)}</td><td style="font-weight:550">${h(t.merchant)}<div class="tiny muted">${h(t.account)}</div></td><td><span class="chip">${h(t.category)}</span></td><td class="right num">${money(t.amount)}</td>${sc ? `<td class="right num muted">${money(t.amount * (r.rate || 0), { cur: sc, cents: false })}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
        : empty('No transfers home recorded this year. Wise, Remitly, Western Union, Xoom and Remit2India are picked up automatically.', 'send'))}</div>
      <div class="span-4">${card('Exchange rate', sc ? `<div class="t-value num" style="font-size:26px;font-weight:700">1 ${S.cur} = ${money(r.rate, { cur: sc, cents: true })}</div>
        <div class="small muted" style="margin:4px 0 12px">${(() => { const x = fxd.rates.find(z => z.currency === sc); return x ? `${x.source === 'ecb' ? 'ECB reference rate' : x.source === 'manual' ? 'Set by you' : 'Approximate default'} · updated ${fmtDate(x.updated_at.slice(0, 10))}` : ''; })()}</div>
        <div class="row"><input type="number" step="0.01" id="rate" value="${(r.rate || 0).toFixed(2)}" style="width:120px"><button class="btn sm" id="save-rate">Set rate</button><button class="btn sm ghost" id="refresh-rate">${icon('refresh', 14)} Refresh</button></div>
        <p class="tiny muted" style="margin-top:10px">Used to convert ${sc} accounts into ${S.cur} for net worth, and to show what you've sent in ${sc}. Your provider's rate will differ slightly.</p>` : empty('Set a second currency in your profile to see conversions.', 'globe', '<a class="btn sm" href="#settings?tab=profile">Open profile</a>'))}</div>
    </div>`;
    hydrateIcons(main);
    const famM = {}, ownM = {};
    r.items.forEach(t => { const k = t.date.slice(0, 7); (t.category === 'Family Support' ? famM : ownM)[k] = ((t.category === 'Family Support' ? famM : ownM)[k] || 0) + t.amount; });
    barChart($('#rm'), months.map(m => fmtMonth(m.month)), [{ label: 'Family support', data: months.map(m => famM[m.month] || 0), color: css('--s4') }, { label: 'To your own accounts', data: months.map(m => ownM[m.month] || 0), color: css('--s1') }], { stacked: true, thick: 22 });
    $('#py').onclick = () => { year--; draw(); }; $('#ny').onclick = () => { year++; draw(); };
    if ($('#save-rate')) $('#save-rate').onclick = async () => { await api(`/fx/${sc}`, { method: 'PUT', body: { per_home: +$('#rate').value } }); toast('Rate saved'); draw(); };
    if ($('#refresh-rate')) $('#refresh-rate').onclick = async () => { const x = await api('/fx/refresh', { method: 'POST' }); toast(x.ok ? `Rates updated (${x.date})` : 'Could not reach the rates service; set it manually.'); draw(); };
  };
  await draw();
};

// ======================================================================
// investments
// ======================================================================
views.investments = async (main) => {
  const [hold, ret] = await Promise.all([api('/holdings'), api('/retirement')]);
  const inv = S.accts.filter(a => a.type === 'investment' && !a.archived);
  const total = inv.reduce((s, a) => s + a.balance_home, 0);
  const byType = {}; hold.forEach(x => byType[x.type || 'other'] = (byType[x.type || 'other'] || 0) + x.value);
  main.innerHTML = ph('Investments', `${money(total, { cents: false })} across ${plural(inv.length, 'account')}`) + `
  <div class="grid g12">
    <div class="span-7">${card('Accounts', inv.length ? `<div>${inv.map(a => `<div class="acct-row" style="grid-template-columns:38px minmax(0,1fr) auto">${monoIc(a.name, `var(--s${TYPE_SLOT.investment})`, a.tax_type ? 'shield' : 'trending')}<div><div style="font-weight:600">${h(a.name)}</div><div class="small muted">${h(a.institution || '')}${a.tax_type ? ` · ${TAX_TYPES[a.tax_type]}` : ''} · ${pct(a.balance_home / (total || 1))} of portfolio</div></div><div class="bal">${money(a.balance_home, { cents: false })}</div></div>`).join('')}</div>` : empty('No investment accounts yet.', 'trending', '<a class="btn sm" href="#accounts">Add one</a>'))}</div>
    <div class="span-5">${card(`Contribution limits ${ret.year}`, ret.buckets.length ? `<div class="stack">${ret.buckets.map(b => `<div><div class="row between" style="margin-bottom:6px"><span style="font-weight:600">${h(b.label)}</span><span class="num small soft">${money(b.contributed, { cents: false })} / ${money(b.limit, { cents: false })}</span></div>${bar(b.pct, { cls: b.pct >= 1 ? 'good' : '', mark: b.expected_pct, markTip: 'Even pace to max out' })}
        <div class="small muted" style="margin-top:6px">${b.remaining > 0 ? `${money(b.remaining, { cents: false })} of room left. <b style="color:var(--text)">${money(b.per_paycheck_to_max, { cents: false })}/paycheck</b> maxes it out.` : 'Maxed out. Nice.'}</div></div>`).join('')}</div>
        <details style="margin-top:16px"><summary><span class="chev">${icon('chevR', 14)}</span>Edit limits</summary><form class="form" id="limits" style="margin-top:10px"><div class="two">${Object.entries(ret.limits).map(([k, v]) => `<label>${k.toUpperCase()}<input type="number" name="${k}" value="${v}"></label>`).join('')}</div><div class="form-actions"><button class="btn sm">Save</button></div></form></details>`
        : empty('Mark accounts as 401(k), IRA or HSA (Accounts → edit) to track how much room you have left this year.', 'shield'))}</div>
    <div class="span-12">${card('Holdings', hold.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Ticker</th><th>Name</th><th>Account</th><th class="right">Qty</th><th class="right">Price</th><th class="right">Value</th><th class="right">Gain</th></tr></thead><tbody>${hold.map(x => { const g = x.cost_basis != null ? x.value - x.cost_basis : null; return `<tr><td><b>${h(x.ticker)}</b></td><td>${h(x.name)}</td><td class="small muted">${h(x.account)}</td><td class="right num">${x.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td><td class="right num">${money(x.price)}</td><td class="right num">${money(x.value)}</td><td class="right num ${g == null ? 'muted' : g >= 0 ? 'pos' : 'bad'}">${g == null ? '—' : money(g, { sign: true })}</td></tr>`; }).join('')}</tbody></table></div>` : empty('Holdings appear here after you connect a brokerage through Plaid.', 'trending'))}</div>
  </div>`;
  const lf = $('#limits'); if (lf) lf.onsubmit = async e => { e.preventDefault(); await api('/retirement/limits', { method: 'PUT', body: Object.fromEntries(new FormData(lf)) }); toast('Limits saved'); render(); };
};

// ======================================================================
// insights
// ======================================================================
views.insights = async (main) => {
  const ins = await api('/insights');
  main.innerHTML = ph('Insights', 'Things worth a look, generated from your own data. Dismiss what you\'ve handled.') + card(null, ins.length ? ins.map(insightHtml).join('') : empty('All clear. Nothing needs your attention.', 'check'));
  bindDismiss(main);
};

// ======================================================================
// funding & costs (public transparency)
// ======================================================================
views.transparency = async (main) => {
  const [t, stats] = await Promise.all([
    fetch('transparency.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null),
    BACKEND ? fetch('relay/stats').then(r => r.ok ? r.json() : null).catch(() => null) : null,
  ]);
  if (!t) { main.innerHTML = ph('Funding & costs') + card(null, empty('No transparency.json published on this deployment.', 'heart')); return; }
  const cur = t.currency || 'USD';
  const sum = (arr, k) => (arr || []).reduce((s, x) => s + (+x.amount || 0), 0);
  const months = [...(t.months || [])].sort((a, b) => a.month.localeCompare(b.month));
  const totIn = months.reduce((s, m) => s + sum(m.income), 0), totOut = months.reduce((s, m) => s + sum(m.expenses), 0);
  const last = months[months.length - 1];
  const perConn = stats && stats.connections && last ? sum(last.expenses.filter(e => /plaid/i.test(e.item))) / stats.connections : null;
  main.innerHTML = ph('Funding & costs', `Ledger is free and open source. It's paid for by donations, and every dollar in and out is listed here. Last updated ${t.updated ? fmtDate(t.updated, { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}.`,
    (t.funding_links || []).filter(l => l.url).map(l => `<a class="btn primary" href="${h(l.url)}" target="_blank" rel="noopener">${icon('heart', 15)} ${h(l.label)}</a>`).join('')) + `
  <div class="tiles" style="margin-bottom:16px">
    <div class="tile"><div class="t-label"><span class="t-ic">${icon('arrowDown', 15)}</span>Raised to date</div><div class="t-value">${money(totIn, { cur, cents: false })}</div><div class="t-sub">${plural(months.length, 'month')} on record</div></div>
    <div class="tile"><div class="t-label"><span class="t-ic">${icon('arrowUp', 15)}</span>Spent to date</div><div class="t-value">${money(totOut, { cur, cents: false })}</div><div class="t-sub">${last ? `${money(sum(last.expenses), { cur, cents: false })} in ${fmtDate(last.month + '-01', { month: 'long' })}` : ''}</div></div>
    <div class="tile"><div class="t-label"><span class="t-ic">${icon('piggy', 15)}</span>Balance</div><div class="t-value ${totIn - totOut < 0 ? 'bad' : ''}">${money(totIn - totOut, { cur, cents: false })}</div><div class="t-sub">${last && sum(last.expenses) ? `≈ ${Math.max(0, (totIn - totOut) / sum(last.expenses)).toFixed(1)} months of runway` : 'runway shown once costs are recorded'}</div></div>
    <div class="tile"><div class="t-label"><span class="t-ic">${icon('bank', 15)}</span>Bank connections</div><div class="t-value">${stats ? stats.connections : '—'}</div><div class="t-sub">${stats ? `${plural(stats.users, 'person', )} connected${perConn != null ? ` · ${money(perConn, { cur })} each last month` : ''}` : 'live count from the relay'}</div></div>
  </div>
  <div class="grid g12">
    <div class="span-8">${card('Month by month', months.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Month</th><th>Item</th><th class="right">In</th><th class="right">Out</th></tr></thead><tbody>${[...months].reverse().map(m => `<tr><td colspan="4" style="background:var(--surface-2);font-weight:600;font-size:12px">${monthName(m.month)}</td></tr>${(m.income || []).map(x => `<tr><td></td><td>${h(x.source)}${x.note ? `<div class="tiny muted">${h(x.note)}</div>` : ''}</td><td class="right num pos">${money(+x.amount, { cur })}</td><td></td></tr>`).join('')}${(m.expenses || []).map(x => `<tr><td></td><td>${h(x.item)}${x.note ? `<div class="tiny muted">${h(x.note)}</div>` : ''}${x.receipt ? ` <a class="tiny" href="${h(x.receipt)}" target="_blank" rel="noopener">receipt</a>` : ''}</td><td></td><td class="right num">${money(+x.amount, { cur })}</td></tr>`).join('')}`).join('')}</tbody></table></div>` : empty('Nothing recorded yet.'))}</div>
    <div class="span-4">${card('How this works', `<div class="stack small soft">
      <p><b style="color:var(--text)">Your data never touches these costs.</b> It's encrypted in your browser and stored in your own Google Drive. Nobody running Ledger can read it.</p>
      <p><b style="color:var(--text)">What the money pays for.</b> Mostly Plaid, which charges per connected bank account each month. Hosting runs on Cloudflare's free tier.</p>
      <p><b style="color:var(--text)">Why there's a connection limit.</b> Each person can link a few banks so costs stay predictable. Statement import (including Indian banks) is free and unlimited.</p>
      <p><b style="color:var(--text)">Where these numbers come from.</b> A file in the public repository, updated by the admins through reviewed pull requests, so every change has a history.</p>
      <p><a href="https://github.com/saurav717/BudgetPlanning/blob/HEAD/transparency.json" target="_blank" rel="noopener">See the source file ${icon('chevR', 13)}</a></p></div>`)}</div>
  </div>`;
};

// ======================================================================
// settings
// ======================================================================
views.settings = async (main, q) => {
  const tab = q.tab || 'profile';
  const TABS = [['profile', 'Profile'], ['dashboard', 'Dashboard'], ['connections', 'Connections & import'], ['categories', 'Categories'], ['rules', 'Rules'], ['currencies', 'Currencies'], ['data', BACKEND ? 'Vault & data' : 'Data']];
  main.innerHTML = ph('Settings') + `<nav class="tabs">${TABS.map(([k, l]) => `<a href="#settings?tab=${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('')}</nav><div id="tab"></div>`;
  await SETTINGS[tab]($('#tab'));
  hydrateIcons(main);
};
const SETTINGS = {
  async profile(el) {
    const p = S.profile;
    el.innerHTML = `<div class="grid g12"><div class="span-7">${card('About you', `<form class="form" id="pf">
      <div class="two"><label>Name<input name="name" value="${h(p.name || '')}"></label><label>Pay frequency<select name="pay_frequency">${[['weekly', 'Weekly'], ['biweekly', 'Every two weeks'], ['semimonthly', 'Twice a month'], ['monthly', 'Monthly']].map(([v, l]) => `<option value="${v}" ${p.pay_frequency === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="two"><label>Main currency<select name="home_currency">${CURRENCIES.map(c => `<option ${c === p.home_currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label><label>Second currency<select name="second_currency"><option value="">None</option>${CURRENCIES.map(c => `<option ${c === p.second_currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>
      <div class="two"><label>Cash cushion<input type="number" name="min_cash_buffer" value="${p.min_cash_buffer ?? 1000}" step="100"><span class="hint">Forecast warns below this.</span></label><label>Emergency fund target (months)<input type="number" name="emergency_months" value="${p.emergency_months ?? 6}" min="1"></label></div>
      <div class="two"><label>Savings rate target (%)<input type="number" name="savings_rate_target" value="${Math.round((p.savings_rate_target ?? .2) * 100)}"></label><span></span></div>
      <h3 style="margin-top:6px">What you're working on</h3><div class="pick">${Object.entries(S.priorities).map(([k, v]) => `<label><input type="checkbox" name="priorities" value="${k}" ${(p.priorities || []).includes(k) ? 'checked' : ''}><span class="p-ic">${icon(PRIORITY_ICON[k] || 'sparkle', 16)}</span>${h(v)}</label>`).join('')}</div>
      <label class="check"><input type="checkbox" name="reset_layout"> Rearrange my dashboard to match these priorities</label>
      <div class="form-actions"><button class="btn primary">Save profile</button></div></form>`)}</div>
      <div class="span-5">${card('How this is used', `<div class="stack small soft"><p><b style="color:var(--text)">Currencies.</b> Every total is in your main currency. Accounts in your second currency are converted for net worth, and transfers home are shown in both.</p><p><b style="color:var(--text)">Pay frequency</b> sets per-paycheck targets, like how much to put in your 401(k) to max it out.</p><p><b style="color:var(--text)">Cushion and emergency target</b> drive the cash-forecast warning and your money checkup.</p><p><b style="color:var(--text)">Priorities</b> decide which dashboard widgets you see first.</p><p><button class="btn sm" id="rerun-onb">${icon('sparkle', 14)} Run setup again</button></p></div>`)}</div></div>`;
    $('#pf').onsubmit = async e => {
      e.preventDefault(); const fd = new FormData(e.target); const b = Object.fromEntries(fd.entries());
      b.priorities = fd.getAll('priorities'); b.min_cash_buffer = +b.min_cash_buffer; b.emergency_months = +b.emergency_months; b.savings_rate_target = +b.savings_rate_target / 100; b.reset_layout = fd.get('reset_layout') === 'on'; b.onboarded = true;
      await api('/profile', { method: 'PUT', body: b }); toast('Profile saved'); render();
    };
    $('#rerun-onb').onclick = () => { S.profile.onboarded = false; onboarding(); };
  },
  async dashboard(el) {
    el.innerHTML = card('Dashboard layout', `<p class="soft">Choose which widgets appear and in what order. You can also do this from the dashboard's <b>Customize</b> button.</p><button class="btn primary" id="cust">${icon('layout', 15)} Customize dashboard</button>`);
    $('#cust').onclick = () => customize();
  },
  async connections(el) {
    const [plaid, profiles] = await Promise.all([api('/plaid/status'), api('/import/profiles')]);
    el.innerHTML = `<div class="grid g2">${card('Bank connections (Plaid)', plaid.configured ? `<div class="row wrap" style="margin-bottom:14px"><span class="chip accent">${plaid.env}</span><span class="grow"></span><button class="btn primary" id="link-btn">${icon('link', 15)} Connect a bank</button>${plaid.env === 'sandbox' ? '<button class="btn" id="sandbox-btn">Add test bank</button>' : ''}<button class="btn" id="sync-now">${icon('refresh', 15)} Sync</button></div>
        <div class="list">${plaid.items.map(it => `<div class="li">${monoIc(it.institution_name || 'B', css('--s1'), 'bank')}<div class="grow"><div class="main-t">${h(it.institution_name || 'Institution')}</div><div class="sub-t">${it.accounts.map(a => h(a.name)).join(', ')}</div>${it.last_error ? `<div class="small bad">${h(it.last_error)}</div>` : `<div class="tiny muted">${it.last_synced_at ? 'synced ' + it.last_synced_at.slice(0, 16).replace('T', ' ') : 'never synced'}</div>`}</div><button class="btn sm" data-reauth="${it.id}">Re-auth</button><button class="btn sm ghost danger" data-unlink="${it.id}">Unlink</button></div>`).join('') || '<div class="muted small">No banks connected yet.</div>'}</div>`
      : BACKEND ? `<p class="soft">Automatic bank connections aren't enabled on this deployment${BACKEND.status().mode === 'demo' ? ' in demo mode. Sign in to connect banks' : ''}. Import statements instead; it's free and works for every bank, including Indian banks.</p>`
      : `<p class="soft">Connect your banks, cards and brokerages so transactions and balances update automatically.</p><ol class="small soft" style="padding-left:18px;line-height:1.7"><li>Get free keys at <a href="https://dashboard.plaid.com/signup" target="_blank" rel="noopener">dashboard.plaid.com</a>.</li><li>Restart Ledger with them:</li></ol><pre class="code">PLAID_CLIENT_ID=… PLAID_SECRET=… PLAID_ENV=sandbox ledger serve</pre><p class="small muted">Use <span class="code">PLAID_ENV=production</span> for real banks once Plaid approves your account. Until then, import CSVs.</p>`)}
      ${card('Import a statement', `<p class="small soft">Download a statement from your bank's website and drop it here. CSV and Excel both work, including ICICI, HDFC, SBI, Axis and Kotak statements. Duplicates are skipped, so overlapping imports are safe.</p>
        <form class="form" id="imp"><div class="two"><label>Into account${acctSelect(null, 'name="account_id"')}</label><label>Bank format<select name="profile"><option value="auto">Auto-detect</option><optgroup label="India">${profiles.filter(p => ['icici', 'hdfc', 'sbi', 'axis', 'kotak', 'india'].includes(p.name)).map(p => `<option value="${p.name}">${h(p.label)}</option>`).join('')}</optgroup><optgroup label="US & other">${profiles.filter(p => !['icici', 'hdfc', 'sbi', 'axis', 'kotak', 'india'].includes(p.name)).map(p => `<option value="${p.name}">${h(p.label)}</option>`).join('')}</optgroup></select></label></div>
        <div class="dropzone" id="dz">${icon('upload', 22)}<div style="margin-top:6px">Drop a CSV or Excel statement, or <label style="display:inline;color:var(--accent);cursor:pointer;font-weight:600">browse<input type="file" name="file" accept=".csv,.txt,.xls,.xlsx,text/csv" hidden></label></div><div id="fname" class="small" style="margin-top:4px;color:var(--text)"></div></div>
        <div class="form-actions"><button class="btn" type="button" id="preview">Preview</button><button class="btn primary">Import</button></div></form><div id="imp-result" style="margin-top:12px"></div>`)}</div>`;
    if ($('#link-btn', el)) $('#link-btn', el).onclick = () => plaidLink();
    if ($('#sync-now', el)) $('#sync-now', el).onclick = syncPlaid;
    if ($('#sandbox-btn', el)) $('#sandbox-btn', el).onclick = async () => { toast('Creating test bank…'); try { const r = await api('/plaid/sandbox-link', { method: 'POST', body: {} }); toast(`Linked ${r.institution}: ${plural(r.accounts.length, 'account')}`); render(); } catch (e) { toast(e.message); } };
    $$('[data-reauth]', el).forEach(b => b.onclick = () => plaidLink(+b.dataset.reauth));
    $$('[data-unlink]', el).forEach(b => b.onclick = async () => { if (await confirmModal('Unlink this bank? Accounts and history stay; syncing stops.', 'Unlink')) { await api(`/plaid/items/${b.dataset.unlink}`, { method: 'DELETE' }); render(); } });
    const imp = $('#imp', el), dz = $('#dz', el), fi = $('input[type=file]', imp);
    let file = null; const setFile = f => { file = f; $('#fname', el).textContent = f ? `${f.name} · ${(f.size / 1024).toFixed(0)} KB` : ''; };
    fi.onchange = () => { csvText = null; mapping = null; setFile(fi.files[0]); };
    dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); setFile(e.dataTransfer.files[0]); };
    let mapping = null, csvText = null;
    const go = async (dry) => {
      if (!file) return toast('Choose a file first');
      try {
        const text = csvText ??= await fileToCsv(file);
        const r = await api('/import-text', { method: 'POST', body: { account_id: +imp.account_id.value, profile: imp.profile.value, text, dry_run: dry, mapping } });
        if (!r.imported && !r.duplicates) return showMapper(text, r.errors[0]);
        $('#imp-result', el).innerHTML = `<div class="callout ${r.errors.length ? 'warning' : 'good'}">${icon(r.errors.length ? 'alert' : 'check', 16, 2)}<div><b>${dry ? 'Preview' : 'Imported'}:</b> ${r.imported} new, ${r.duplicates} duplicates skipped${r.transfer_pairs ? `, ${r.transfer_pairs} transfers matched` : ''} · format <span class="code">${r.profile}</span>${r.errors.length ? `<br>${r.errors.length} rows couldn't be read: ${r.errors.slice(0, 3).map(h).join('; ')}` : ''}</div></div>
          ${r.skipped ? `<div class="tiny muted" style="margin-top:6px">${plural(r.skipped, 'row')} without a date or amount skipped (headers, balances, summaries).</div>` : ''}
          ${r.columns ? `<div class="tiny muted">Read columns: ${Object.entries(r.columns).map(([k, v]) => `${k} = “${h(v)}”`).join(', ')} · <a href="#" id="remap">change</a></div>` : ''}
          <div class="list" style="margin-top:10px">${r.transactions.slice(0, 12).map(t => `<div class="li"><div class="grow"><div class="main-t">${h(t.merchant)}</div><div class="sub-t">${t.date} · ${h(catName(t.category_id))}</div></div><span class="amt">${amt(t.amount)}</span></div>`).join('')}</div>`;
        const rm = $('#remap', el); if (rm) rm.onclick = (e) => { e.preventDefault(); showMapper(text); };
        if (!dry) { toast(`Imported ${plural(r.imported, 'transaction')}`); setFile(null); fi.value = ''; csvText = null; mapping = null; }
      } catch (e) { toast(e.message); }
    };
    // When a file can't be read automatically, let the person point at the columns.
    const showMapper = async (text, why) => {
      const info = await api('/import/inspect', { method: 'POST', body: { text } });
      const opts = (sel) => `<option value="">—</option>${info.headers.map(x => `<option ${x === sel ? 'selected' : ''}>${h(x)}</option>`).join('')}`;
      const m = info.mapping || {};
      modal(`${mhead('Which column is which?', why ? h(why) : 'Pick the columns from your file.')}
        <div style="overflow-x:auto;margin-bottom:14px"><table class="plain small"><thead><tr>${info.headers.map(x => `<th>${h(x)}</th>`).join('')}</tr></thead><tbody>${info.sample.map(r => `<tr>${r.map(c => `<td class="nowrap">${h(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <form class="form"><div class="two"><label>Date<select name="date">${opts(m.date)}</select></label><label>Date format<select name="date_format"><option value="">Auto (day first)</option><option value="%d/%m/%Y">31/12/2026</option><option value="%d-%m-%Y">31-12-2026</option><option value="%d %b %Y">31 Dec 2026</option><option value="%d-%b-%Y">31-Dec-2026</option><option value="%d/%m/%y">31/12/26</option><option value="%m/%d/%Y">12/31/2026 (US)</option><option value="%Y-%m-%d">2026-12-31</option></select></label></div>
        <label>Description<select name="description">${opts(m.description)}</select></label>
        <div class="two"><label>Money out (debit)<select name="debit">${opts(m.debit)}</select></label><label>Money in (credit)<select name="credit">${opts(m.credit)}</select></label></div>
        <div class="two"><label>Or one amount column<select name="amount">${opts(m.amount)}</select></label><label>Dr/Cr column (if any)<select name="dr_cr">${opts(m.dr_cr)}</select></label></div>
        <label class="check"><input type="checkbox" name="negate"> Amounts are positive for spending (flip signs)</label>
        <div class="form-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Use these columns</button></div></form>`,
        (md, close) => $('form', md).onsubmit = (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.negate = f.negate === 'on'; Object.keys(f).forEach(k => f[k] === '' && delete f[k]); mapping = f; close(); go(true); }, 'wide');
    };
    $('#preview', el).onclick = () => go(true); imp.onsubmit = e => { e.preventDefault(); go(false); };
  },
  async categories(el) {
    const groups = {}; S.cats.filter(c => !c.archived).forEach(c => (groups[c.group] ||= []).push(c));
    el.innerHTML = card('Categories', `<div class="row between" style="margin:-6px 0 12px"><p class="small soft" style="margin:0">Type decides where a category sits on the Budget page. Rollover carries unspent money into next month.</p><button class="btn sm" id="add-cat">${icon('plus', 14)} Add</button></div>
      <div style="overflow-x:auto"><table><thead><tr><th>Category</th><th>Kind</th><th>Budget type</th><th>Rollover</th><th></th></tr></thead><tbody>${Object.entries(groups).map(([g, cs]) => `<tr><td colspan="5" style="background:var(--surface-2);font-weight:600;font-size:12px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${groupColor(g)};margin-right:8px"></span>${h(g)}</td></tr>${cs.map(c => `<tr><td>${h(c.name)}</td><td><span class="chip">${c.kind}</span></td><td>${c.kind === 'expense' ? `<select data-bt="${c.id}">${[['fixed', 'Fixed'], ['flex', 'Flexible'], ['non_monthly', 'Non-monthly']].map(([v, l]) => `<option value="${v}" ${c.budget_type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}</td><td>${c.kind === 'expense' ? `<label class="switch"><input type="checkbox" data-ro="${c.id}" ${c.rollover ? 'checked' : ''}><span></span></label>` : ''}</td><td class="right">${c.name !== 'Uncategorized' ? `<button class="icon-btn" data-delcat="${c.id}" title="Delete">${icon('trash', 15)}</button>` : ''}</td></tr>`).join('')}`).join('')}</tbody></table></div>`);
    $$('[data-bt]', el).forEach(s => s.onchange = async () => { await api(`/categories/${s.dataset.bt}`, { method: 'PATCH', body: { budget_type: s.value } }); toast('Saved'); });
    $$('[data-ro]', el).forEach(c => c.onchange = async () => { await api(`/categories/${c.dataset.ro}`, { method: 'PATCH', body: { rollover: c.checked } }); toast('Saved'); });
    $$('[data-delcat]', el).forEach(b => b.onclick = async () => { if (await confirmModal('Delete this category? Its transactions become Uncategorized.')) { await api(`/categories/${b.dataset.delcat}`, { method: 'DELETE' }); render(); } });
    $('#add-cat', el).onclick = () => modal(`${mhead('New category')}<form class="form"><label>Name<input name="name" required autofocus></label><div class="two"><label>Group<input name="group" list="groups" value="Lifestyle"><datalist id="groups">${Object.keys(groups).map(g => `<option>${h(g)}</option>`).join('')}</datalist></label><label>Kind<select name="kind"><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option></select></label></div>
      <div class="two"><label>Budget type<select name="budget_type"><option value="flex">Flexible</option><option value="fixed">Fixed</option><option value="non_monthly">Non-monthly</option></select></label><label class="check" style="align-self:end"><input type="checkbox" name="rollover"> Rollover</label></div><div class="form-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Create</button></div></form>`,
      (m, close) => $('form', m).onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.rollover = f.rollover === 'on'; try { await api('/categories', { method: 'POST', body: f }); close(); render(); } catch (err) { toast(err.message); } });
  },
  async rules(el) {
    const rules = await api('/rules');
    el.innerHTML = card(`Rules · ${rules.length}`, `<p class="small soft" style="margin-top:-6px">When a transaction's description contains the text, it gets the category (and a clean merchant name). Lower priority numbers win; rules you create are priority 1.</p>
      <div class="toolbar"><div class="search"><span>${icon('search', 16)}</span><input type="search" id="rule-q" placeholder="Filter rules…"></div><button class="btn sm" id="rerun">Re-run on uncategorized</button><button class="btn sm" id="match-tr">Match transfers</button><button class="btn sm primary" id="add-rule">${icon('plus', 14)} Add rule</button></div>
      <div style="max-height:560px;overflow:auto"><table id="rules-t"><tbody>${rules.map(r => `<tr data-rule="${h((r.pattern + ' ' + r.category + ' ' + r.rename_to).toLowerCase())}"><td><span class="code">${h(r.pattern)}</span>${r.is_regex ? ' <span class="chip">regex</span>' : ''}</td><td>→ <b style="font-weight:550">${h(r.category)}</b>${r.rename_to ? ` <span class="muted small">as “${h(r.rename_to)}”</span>` : ''}</td><td class="small muted num">${r.priority}</td><td class="right"><button class="icon-btn" data-delrule="${r.id}">${icon('x', 15)}</button></td></tr>`).join('')}</tbody></table></div>`);
    $('#rule-q', el).oninput = e => { const v = e.target.value.toLowerCase(); $$('#rules-t tr', el).forEach(tr => tr.style.display = tr.dataset.rule.includes(v) ? '' : 'none'); };
    $$('[data-delrule]', el).forEach(b => b.onclick = async () => { await api(`/rules/${b.dataset.delrule}`, { method: 'DELETE' }); b.closest('tr').remove(); });
    $('#rerun', el).onclick = async () => { const r = await api('/transactions/recategorize', { method: 'POST' }); toast(`Categorized ${plural(r.updated, 'transaction')}`); };
    $('#match-tr', el).onclick = async () => { const r = await api('/transactions/match-transfers', { method: 'POST' }); toast(`Matched ${plural(r.pairs, 'transfer pair')}`); };
    $('#add-rule', el).onclick = () => modal(`${mhead('New rule')}<form class="form"><label>When the description contains<input name="pattern" required autofocus placeholder="e.g. PATEL BROS"></label><div class="two"><label>Set category${catSelect(null, 'name="category_id"')}</label><label>Rename merchant to<input name="rename_to" placeholder="optional"></label></div>
      <label class="check"><input type="checkbox" name="is_regex"> Treat as a regular expression</label><div class="form-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Create & apply</button></div></form>`,
      (m, close) => $('form', m).onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.category_id = +f.category_id; f.is_regex = f.is_regex === 'on'; const r = await api('/rules', { method: 'POST', body: f }); close(); toast(`Rule applied to ${plural(r.applied_to, 'transaction')}`); render(); });
  },
  async currencies(el) {
    const fxd = await api('/fx');
    const home = fxd.rates.find(r => r.currency === fxd.home) || { per_usd: 1 };
    el.innerHTML = card('Exchange rates', `<div class="row between" style="margin:-6px 0 12px"><p class="small soft" style="margin:0">Rates convert foreign-currency accounts into ${fxd.home}. Refresh pulls daily ECB reference rates; set one by hand to override.</p><button class="btn sm" id="refresh">${icon('refresh', 14)} Refresh rates</button></div>
      <table><thead><tr><th>Currency</th><th class="right">Per 1 ${fxd.home}</th><th>Source</th><th>Updated</th><th></th></tr></thead><tbody>${fxd.rates.filter(r => r.currency !== fxd.home).map(r => `<tr><td><b>${r.currency}</b></td><td class="right"><input type="number" step="0.0001" data-cur="${r.currency}" value="${(r.per_usd / home.per_usd).toFixed(4)}" style="width:130px"></td><td class="small muted">${r.source === 'ecb' ? 'ECB' : r.source}</td><td class="small muted">${fmtDate(r.updated_at.slice(0, 10))}</td><td class="right"><button class="btn sm" data-save="${r.currency}">Save</button></td></tr>`).join('')}</tbody></table>`);
    $('#refresh', el).onclick = async () => { const r = await api('/fx/refresh', { method: 'POST' }); toast(r.ok ? `Updated ${r.updated} rates` : 'Rates service unreachable; set rates by hand.'); render(); };
    $$('[data-save]', el).forEach(b => b.onclick = async () => { await api(`/fx/${b.dataset.save}`, { method: 'PUT', body: { per_home: +$(`[data-cur="${b.dataset.save}"]`, el).value } }); toast('Saved'); render(); });
  },
  async data(el) {
    const tags = await api('/tags');
    const st = BACKEND ? BACKEND.status() : null;
    const vaultCard = !BACKEND ? card('Your data', `<p class="soft">Everything lives in one SQLite file on your computer. Nothing is sent anywhere except to Plaid (if connected) and the exchange-rate service when you press refresh.</p>`)
      : st.mode === 'demo' ? card('Demo mode', `<p class="soft">You're exploring sample data. Nothing is saved; closing this tab discards it. Reload and sign in with Google to create your own encrypted vault.</p><button class="btn primary" onclick="location.reload()">Sign in</button>`)
      : card('Your encrypted vault', `<dl class="kv" style="margin-bottom:14px"><dt>Google account</dt><dd>${h(st.user?.email || '')}</dd><dt>Stored in</dt><dd>Google Drive · hidden app folder</dd><dt>Encryption</dt><dd>AES-256-GCM · PBKDF2 600k</dd><dt>Last saved</dt><dd>${st.lastSaved ? st.lastSaved.toLocaleString() : '—'}</dd></dl>
        <p class="small soft">Only someone with your passphrase or recovery key can read this file. Google, and the people who run Ledger, see only scrambled bytes.</p>
        <div class="row wrap"><button class="btn" id="v-save">${icon('upload', 15)} Save now</button><button class="btn" id="v-backup">${icon('download', 15)} Download encrypted backup</button><button class="btn" id="v-pass">Change passphrase</button><button class="btn" id="v-lock">${icon('shield', 15)} Lock</button><button class="btn ghost" id="v-out">Sign out</button></div>
        <details style="margin-top:16px"><summary><span class="chev">${icon('chevR', 14)}</span>Delete my data</summary><p class="small soft" style="margin-top:8px">Removes the vault from your Google Drive. Bank connections should be unlinked first so they stop counting toward the project's Plaid bill.</p><button class="btn danger" id="v-del">${icon('trash', 15)} Delete vault from Google Drive</button></details>`);
    el.innerHTML = `<div class="grid g2">${vaultCard}${card('Export', `<p class="soft">Download your transactions as a spreadsheet anytime. It's your data.</p><button class="btn" data-export>${icon('download', 15)} Export all transactions (CSV)</button>`)}
      ${card('Tags', tags.length ? `<div class="row wrap" style="gap:6px">${tags.map(t => `<a class="chip ghost" href="#transactions?tag=${encodeURIComponent(t.name)}">${icon('tag', 11)} ${h(t.name)} <b>${t.count}</b></a>`).join('')}</div>` : '<p class="small muted">Tag transactions from their detail view, or in bulk from the Transactions list.</p>')}</div>`;
    if (BACKEND && st.mode === 'drive') {
      $('#v-save', el).onclick = async () => { await BACKEND.saveNow(); toast('Saved'); };
      $('#v-backup', el).onclick = () => BACKEND.downloadBackup();
      $('#v-pass', el).onclick = () => BACKEND.changePassphrase();
      $('#v-lock', el).onclick = () => BACKEND.lock();
      $('#v-out', el).onclick = () => BACKEND.signOut();
      $('#v-del', el).onclick = async () => { if (await confirmModal('Permanently delete your Ledger vault from Google Drive? Download a backup first if you might want it later.', 'Delete forever')) BACKEND.deleteVault(); };
    }
  },
};

hydrateIcons(document);
render();
})();
