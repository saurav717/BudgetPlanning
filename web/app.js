/* Ledger frontend: vanilla JS, hash router, Chart.js for charts. */
(() => {
const $ = (sel, el = document) => el.querySelector(sel);
const h = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = (v, opts = {}) => {
  if (v == null || isNaN(v)) return '—';
  const abs = Math.abs(v);
  const s = abs.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: opts.cents === false || abs >= 10000 ? 0 : 2, minimumFractionDigits: opts.cents === false || abs >= 10000 ? 0 : 2 });
  return (v < 0 ? '−' : (opts.sign && v > 0 ? '+' : '')) + s;
};
const pct = (v) => v == null ? '—' : Math.round(v * 100) + '%';
const fmtDate = (d) => { if (!d) return ''; const [y, m, dd] = d.split('-'); return new Date(+y, +m - 1, +dd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
const fmtMonth = (m) => { const [y, mm] = m.split('-'); return new Date(+y, +mm - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }); };
const monthName = (m) => { const [y, mm] = m.split('-'); return new Date(+y, +mm - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); };
const thisMonth = () => new Date().toISOString().slice(0, 7);
const shiftMonth = (m, d) => { const [y, mm] = m.split('-').map(Number); const dt = new Date(y, mm - 1 + d, 1); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`; };
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const SERIES = () => ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'].map(css);

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  const r = await fetch('/api' + path, init);
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) : r.statusText);
  return data;
}
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }
function modal(html, onMount) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
  const close = () => { root.innerHTML = ''; };
  $('.modal-bg', root).addEventListener('click', e => { if (e.target.classList.contains('modal-bg')) close(); });
  root.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  onMount && onMount($('.modal', root), close);
  return close;
}
const confirmModal = (text) => new Promise(res => modal(`<h2>Are you sure?</h2><p>${h(text)}</p><div class="form-actions"><button class="btn" data-close>Cancel</button><button class="btn danger" id="ok">Delete</button></div>`, (m, close) => { $('#ok', m).onclick = () => { close(); res(true); }; }));

// ---- charts ----
const charts = [];
function destroyCharts() { while (charts.length) charts.pop().destroy(); }
function chartDefaults() {
  Chart.defaults.color = css('--text-2'); Chart.defaults.borderColor = css('--border');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily; Chart.defaults.font.size = 11;
  Chart.defaults.plugins.legend.display = false; Chart.defaults.animation = false;
  Chart.defaults.plugins.tooltip.backgroundColor = css('--text'); Chart.defaults.plugins.tooltip.titleColor = css('--bg'); Chart.defaults.plugins.tooltip.bodyColor = css('--bg');
  Chart.defaults.plugins.tooltip.padding = 8; Chart.defaults.plugins.tooltip.cornerRadius = 6; Chart.defaults.plugins.tooltip.displayColors = false;
}
const axisMoney = { ticks: { callback: v => money(v, { cents: false }), maxTicksLimit: 5 }, grid: { color: css('--border'), drawTicks: false }, border: { display: false } };
const axisCat = { grid: { display: false }, border: { display: false } };
function mkChart(canvas, cfg) { const c = new Chart(canvas, cfg); charts.push(c); return c; }
function lineChart(canvas, labels, series, opts = {}) {
  const colors = SERIES();
  return mkChart(canvas, { type: 'line', data: { labels, datasets: series.map((s, i) => ({ label: s.label, data: s.data, borderColor: s.color || colors[i], backgroundColor: s.fill ? (s.color || colors[i]) + '22' : 'transparent', fill: !!s.fill, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25 })) },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { x: axisCat, y: { ...axisMoney, beginAtZero: !!opts.zero } },
      plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.parsed.y)}` } } } } });
}
function barChart(canvas, labels, series, opts = {}) {
  const colors = SERIES();
  return mkChart(canvas, { type: 'bar', data: { labels, datasets: series.map((s, i) => ({ label: s.label, data: s.data, backgroundColor: s.color || colors[i], borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: opts.thick || 28 })) },
    options: { indexAxis: opts.horizontal ? 'y' : 'x', maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: opts.horizontal ? { x: axisMoney, y: axisCat } : { x: { ...axisCat, stacked: !!opts.stacked }, y: { ...axisMoney, stacked: !!opts.stacked, beginAtZero: true } },
      plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(opts.horizontal ? c.parsed.x : c.parsed.y)}` } } } } });
}
const legend = (items) => `<div class="legend">${items.map((it, i) => `<span><i style="background:${it.color || SERIES()[i]}"></i>${h(it.label)}</span>`).join('')}</div>`;
const barHtml = (p, cls = '') => { const v = Math.min(1, Math.max(0, p || 0)); const k = cls || (p > 1 ? 'over' : p > 0.85 ? 'warn' : ''); return `<div class="bar"><i class="${k}" style="width:${v * 100}%"></i></div>`; };

// ---- state ----
let CATS = [], ACCTS = [];
async function loadRefs() { [CATS, ACCTS] = await Promise.all([api('/categories'), api('/accounts')]); }
const catName = (id) => (CATS.find(c => c.id === id) || {}).name || 'Uncategorized';
const catSelect = (selected, attrs = '') => {
  const groups = {};
  CATS.filter(c => !c.archived).forEach(c => (groups[c.kind === 'income' ? 'Income' : c.kind === 'transfer' ? 'Transfers' : c.group] ||= []).push(c));
  return `<select ${attrs}>${Object.entries(groups).map(([g, cs]) => `<optgroup label="${h(g)}">${cs.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${h(c.name)}</option>`).join('')}</optgroup>`).join('')}</select>`;
};
const acctSelect = (selected, attrs = '', allowNone = false) => `<select ${attrs}>${allowNone ? '<option value="">— none —</option>' : ''}${ACCTS.filter(a => !a.archived).map(a => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${h(a.name)}</option>`).join('')}</select>`;
const TYPE_LABEL = { checking: 'Checking', savings: 'Savings', credit: 'Credit cards', investment: 'Investments', loan: 'Loans', cash: 'Cash', other: 'Other' };

// ---- router ----
const views = {};
async function render() {
  destroyCharts();
  const [view, qs] = location.hash.replace('#', '').split('?');
  const name = views[view] ? view : 'dashboard';
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.view === name));
  const main = $('#main');
  main.innerHTML = '<div class="loading">Loading…</div>';
  try { await loadRefs(); chartDefaults(); await views[name](main, Object.fromEntries(new URLSearchParams(qs || ''))); }
  catch (e) { main.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${h(e.message)}</p></div>`; console.error(e); }
}
window.addEventListener('hashchange', render);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

// =============== DASHBOARD ===============
views.dashboard = async (main) => {
  const o = await api('/overview');
  const nw = o.net_worth, hist = o.net_worth_history, prev = hist[hist.length - 2];
  const delta = prev ? nw.net_worth - prev.net_worth : 0;
  const bs = o.budget_summary, sts = o.safe_to_spend;
  const cfThis = o.cashflow[o.cashflow.length - 1];
  main.innerHTML = `
  <div class="page-head"><div><h1>Dashboard</h1><div class="sub">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div></div>
    <div class="row"><a class="btn" href="#transactions?unreviewed=1">Review transactions</a><a class="btn primary" href="#settings">Add account</a></div></div>
  <div class="grid cols-4">
    <div class="card stat"><div class="label">Net worth</div><div class="value">${money(nw.net_worth)}</div><div class="delta ${delta >= 0 ? 'pos' : 'bad'}">${money(delta, { sign: true })} this month</div></div>
    <div class="card stat"><div class="label">Safe to spend <span class="muted" title="Checking balance − card balances − bills due before your next paycheck">ⓘ</span></div><div class="value ${sts.safe_to_spend < 0 ? 'bad' : ''}">${money(sts.safe_to_spend)}</div><div class="delta">${money(sts.liquid_cash)} cash · ${money(sts.upcoming_bills)} bills in ${sts.days_to_next_income}d · ${money(sts.card_balances)} on cards</div></div>
    <div class="card stat"><div class="label">Spent this month</div><div class="value">${money(bs.spent)}</div><div class="delta">of ${money(bs.planned_spending)} planned · ${pct(bs.month_progress)} of month gone</div>${barHtml(bs.planned_spending ? bs.spent / bs.planned_spending : 0)}</div>
    <div class="card stat"><div class="label">Income this month</div><div class="value">${money(cfThis.income)}</div><div class="delta">${bs.expected_income ? 'expecting ' + money(bs.expected_income) : 'no income budget set'}</div></div>
  </div>
  <div class="grid cols-3" style="margin-top:16px">
    <div class="card span-2"><div class="row between"><h2>Net worth</h2><span class="muted small">12 months</span></div><div class="chart"><canvas id="nw"></canvas></div></div>
    <div class="card"><h2>Insights</h2>${o.insights.length ? o.insights.map(insightHtml).join('') : '<div class="empty">Nothing to flag. Nice.</div>'}<div style="margin-top:8px"><a href="#insights" class="small">All insights →</a></div></div>
    <div class="card span-2"><div class="row between"><h2>Cash flow</h2><span class="muted small">6 months</span></div><div class="chart"><canvas id="cf"></canvas></div>${legend([{ label: 'Income' }, { label: 'Expenses', color: css('--s2') }])}</div>
    <div class="card"><h2>Spending by group</h2><div class="chart"><canvas id="sg"></canvas></div></div>
    <div class="card"><div class="row between"><h2>Budget</h2><a href="#budgets" class="small">Edit</a></div>
      ${o.budget_rows.length ? o.budget_rows.map(r => `<div style="margin-bottom:10px"><div class="row between small"><span>${h(r.category)}</span><span class="muted num">${money(r.actual, { cents: false })} / ${money(r.available, { cents: false })}</span></div>${barHtml(r.pct)}</div>`).join('') : '<div class="empty">No budgets yet. <a href="#budgets">Set some up</a>.</div>'}</div>
    <div class="card"><div class="row between"><h2>Upcoming</h2><a href="#recurring" class="small">All recurring</a></div>
      ${o.upcoming.length ? `<table>${o.upcoming.slice(0, 8).map(u => `<tr><td class="muted small" style="width:60px">${u.days_until < 0 ? '<span class="bad">overdue</span>' : u.days_until === 0 ? 'today' : 'in ' + u.days_until + 'd'}</td><td>${h(u.merchant)}</td><td class="right tx-amount ${u.amount > 0 ? 'pos' : ''}">${money(u.amount, { sign: true })}</td></tr>`).join('')}</table>` : '<div class="empty">No recurring items detected yet.</div>'}</div>
    <div class="card"><div class="row between"><h2>Recent</h2><a href="#transactions" class="small">All</a></div>
      <table>${o.recent.map(t => `<tr><td class="muted small" style="width:50px">${fmtDate(t.date)}</td><td>${h(t.merchant)}<div class="muted small">${h(t.category || '')}</div></td><td class="right tx-amount ${t.amount > 0 ? 'pos' : ''}">${money(t.amount, { sign: true })}</td></tr>`).join('')}</table></div>
  </div>`;
  lineChart($('#nw'), hist.map(x => fmtMonth(x.month)), [{ label: 'Net worth', data: hist.map(x => x.net_worth), fill: true }]);
  barChart($('#cf'), o.cashflow.map(x => fmtMonth(x.month)), [{ label: 'Income', data: o.cashflow.map(x => x.income) }, { label: 'Expenses', data: o.cashflow.map(x => x.expenses), color: css('--s2') }]);
  const sg = o.spending_by_group.slice(0, 6);
  barChart($('#sg'), sg.map(g => g.group), [{ label: 'Spent', data: sg.map(g => g.spent) }], { horizontal: true, thick: 18 });
  bindInsightActions(main);
};

function insightHtml(i) {
  const link = i.action ? `#${i.action.view}${i.action.search ? '?q=' + encodeURIComponent(i.action.search) : i.action.uncategorized ? '?uncategorized=1' : ''}` : null;
  return `<div class="insight"><span class="dot ${i.severity}"></span><div class="grow"><div class="title">${h(i.title)}</div><div class="body">${h(i.body)}</div></div><div class="actions">${link ? `<a class="btn small" href="${link}">View</a>` : ''}<button class="btn small" data-dismiss="${h(i.key)}" title="Dismiss">✕</button></div></div>`;
}
function bindInsightActions(root) { root.querySelectorAll('[data-dismiss]').forEach(b => b.onclick = async () => { await api('/insights/dismiss', { method: 'POST', body: { key: b.dataset.dismiss } }); b.closest('.insight').remove(); }); }

// =============== ACCOUNTS ===============
views.accounts = async (main) => {
  const [nw, plaid] = await Promise.all([api('/net-worth'), api('/plaid/status')]);
  const accts = ACCTS;
  const groups = {};
  accts.filter(a => !a.archived).forEach(a => (groups[a.type] ||= []).push(a));
  const archived = accts.filter(a => a.archived);
  main.innerHTML = `
  <div class="page-head"><div><h1>Accounts</h1><div class="sub">Net worth ${money(nw.current.net_worth)} · assets ${money(nw.current.assets)} · liabilities ${money(nw.current.liabilities)}</div></div>
    <div class="row">${plaid.configured ? '<button class="btn" id="link-btn">Connect a bank (Plaid)</button>' : ''}<button class="btn primary" id="add-acct">Add manual account</button></div></div>
  <div class="grid cols-3">
    <div class="card span-2"><h2>Net worth over time</h2><div class="chart tall"><canvas id="nw"></canvas></div>${legend([{ label: 'Net worth' }, { label: 'Assets', color: css('--s3') }, { label: 'Liabilities', color: css('--s2') }])}</div>
    <div class="card"><h2>Breakdown</h2><dl class="kv">${Object.entries(nw.current.by_type).map(([t, v]) => `<dt>${TYPE_LABEL[t] || t}</dt><dd class="${v < 0 ? '' : 'pos'}">${money(v)}</dd>`).join('')}</dl></div>
  </div>
  <div style="margin-top:20px">${Object.keys(groups).sort((a, b) => Object.keys(TYPE_LABEL).indexOf(a) - Object.keys(TYPE_LABEL).indexOf(b)).map(t => `
    <div class="card acct-group"><h3>${TYPE_LABEL[t] || t} <span class="muted" style="float:right;text-transform:none;letter-spacing:0">${money(groups[t].reduce((s, a) => s + a.balance, 0))}</span></h3>
      ${groups[t].map(a => `<div class="acct"><div><div class="name"><a href="#transactions?account_id=${a.id}">${h(a.name)}</a> ${a.plaid_item_id ? '<span class="chip">Plaid</span>' : ''} ${!a.include_in_net_worth ? '<span class="chip">excluded</span>' : ''}</div><div class="inst">${h(a.institution || '')}${a.balance_date ? ' · updated ' + fmtDate(a.balance_date) : ''} · ${a.tx_count} transactions</div></div>
        <div class="row"><div class="bal">${money(a.balance)}</div><button class="btn small" data-bal="${a.id}">Update balance</button><button class="btn small" data-edit="${a.id}">Edit</button></div></div>`).join('')}
    </div>`).join('')}
  ${archived.length ? `<details><summary>${archived.length} archived account(s)</summary>${archived.map(a => `<div class="acct"><div class="name">${h(a.name)}</div><div class="row"><div class="bal muted">${money(a.balance)}</div><button class="btn small" data-edit="${a.id}">Edit</button></div></div>`).join('')}</details>` : ''}
  </div>`;
  lineChart($('#nw'), nw.history.map(x => fmtMonth(x.month)), [{ label: 'Net worth', data: nw.history.map(x => x.net_worth) }, { label: 'Assets', data: nw.history.map(x => x.assets), color: css('--s3') }, { label: 'Liabilities', data: nw.history.map(x => -x.liabilities), color: css('--s2') }]);
  $('#add-acct').onclick = () => accountForm();
  if ($('#link-btn')) $('#link-btn').onclick = () => plaidLink();
  main.querySelectorAll('[data-bal]').forEach(b => b.onclick = () => {
    const a = accts.find(x => x.id === +b.dataset.bal);
    modal(`<h2>Update balance: ${h(a.name)}</h2><form class="form"><label>${a.is_liability ? 'Amount owed' : 'Balance'}<input type="number" step="0.01" name="balance" value="${Math.abs(a.balance)}" required autofocus></label><label>As of<input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}"></label><div class="form-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
      (m, close) => $('form', m).onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); await api(`/accounts/${a.id}/balance`, { method: 'POST', body: { balance: +f.get('balance'), date: f.get('date') } }); close(); toast('Balance updated'); render(); });
  });
  main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => accountForm(accts.find(x => x.id === +b.dataset.edit)));
};
function accountForm(a) {
  modal(`<h2>${a ? 'Edit account' : 'Add account'}</h2><form class="form">
    <label>Name<input name="name" value="${h(a?.name || '')}" required></label>
    <div class="two"><label>Type<select name="type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${a?.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>Institution<input name="institution" value="${h(a?.institution || '')}"></label></div>
    ${a ? '' : '<label>Current balance (enter what you owe for cards/loans)<input type="number" step="0.01" name="balance"></label>'}
    <label class="row" style="display:flex"><input type="checkbox" name="include_in_net_worth" ${!a || a.include_in_net_worth ? 'checked' : ''}> Include in net worth</label>
    ${a ? `<label class="row" style="display:flex"><input type="checkbox" name="archived" ${a.archived ? 'checked' : ''}> Archived (hidden from lists)</label>` : ''}
    <div class="form-actions">${a ? '<button class="btn danger" type="button" id="del">Delete account & transactions</button><span class="grow"></span>' : ''}<button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
    (m, close) => {
      $('form', m).onsubmit = async e => {
        e.preventDefault(); const f = new FormData(e.target);
        const body = { name: f.get('name'), type: f.get('type'), institution: f.get('institution'), include_in_net_worth: f.get('include_in_net_worth') === 'on' };
        try {
          if (a) { body.archived = f.get('archived') === 'on'; await api(`/accounts/${a.id}`, { method: 'PATCH', body }); }
          else { if (f.get('balance')) body.balance = +f.get('balance'); await api('/accounts', { method: 'POST', body }); }
          close(); toast('Saved'); render();
        } catch (err) { toast(err.message); }
      };
      if (a) $('#del', m).onclick = async () => { if (await confirmModal(`Delete ${a.name} and all ${a.tx_count} of its transactions?`)) { await api(`/accounts/${a.id}`, { method: 'DELETE' }); close(); render(); } };
    });
}
async function plaidLink(itemId) {
  try {
    const { link_token } = await api('/plaid/link-token', { method: 'POST', body: itemId ? { item_id: itemId } : {} });
    const handler = Plaid.create({ token: link_token, onSuccess: async (public_token) => {
      if (itemId) { toast('Re-authenticated. Syncing…'); await syncPlaid(); return; }
      toast('Linking… this can take a few seconds');
      try { const r = await api('/plaid/exchange', { method: 'POST', body: { public_token } }); toast(`Linked ${r.institution || 'bank'}: ${r.accounts.length} accounts, ${r.sync.added} transactions`); render(); }
      catch (e) { toast(e.message); }
    }, onExit: (err) => { if (err) toast(err.display_message || err.error_message || 'Link closed'); } });
    handler.open();
  } catch (e) { toast(e.message); }
}
async function syncPlaid() {
  const st = $('#sync-status'); st.textContent = 'syncing…';
  try { const r = await api('/plaid/sync', { method: 'POST' }); const added = r.results.reduce((s, x) => s + (x.added || 0), 0); const errs = r.results.filter(x => x.error); st.textContent = errs.length ? `${errs.length} error(s)` : `+${added}`; toast(errs.length ? errs[0].error : `Synced: ${added} new transactions`); render(); }
  catch (e) { st.textContent = ''; toast(e.message); }
}
$('#sync-btn').onclick = syncPlaid;

// =============== TRANSACTIONS ===============
views.transactions = async (main, q) => {
  const state = { q: q.q || '', account_id: q.account_id || '', category_id: q.category_id || '', uncategorized: q.uncategorized === '1', unreviewed: q.unreviewed === '1', start: q.start || '', end: q.end || '', tag: q.tag || '', offset: 0 };
  const selected = new Set();
  main.innerHTML = `<div class="page-head"><div><h1>Transactions</h1><div class="sub" id="tx-count"></div></div><div class="row"><a class="btn" href="/api/export/transactions.csv">Export CSV</a><button class="btn" id="add-tx">Add manual</button></div></div>
  <div class="card">
    <div class="toolbar"><input type="search" id="f-q" placeholder="Search merchant, description, notes, amount…" value="${h(state.q)}">
      <select id="f-acct"><option value="">All accounts</option>${ACCTS.map(a => `<option value="${a.id}" ${state.account_id == a.id ? 'selected' : ''}>${h(a.name)}</option>`).join('')}</select>
      <select id="f-cat"><option value="">All categories</option>${CATS.map(c => `<option value="${c.id}" ${state.category_id == c.id ? 'selected' : ''}>${h(c.name)}</option>`).join('')}</select>
      <input type="date" id="f-start" value="${state.start}"><input type="date" id="f-end" value="${state.end}">
      <label class="small"><input type="checkbox" id="f-unc" ${state.uncategorized ? 'checked' : ''}> Uncategorized</label>
      <label class="small"><input type="checkbox" id="f-unrev" ${state.unreviewed ? 'checked' : ''}> Needs review</label></div>
    <div class="bulkbar" id="bulk"><span id="bulk-n"></span>${catSelect(null, 'id="bulk-cat"')}<button class="btn small" id="bulk-apply">Set category</button><button class="btn small" id="bulk-review">Mark reviewed</button><button class="btn small" id="bulk-hide">Hide</button><input id="bulk-tag" placeholder="tag" style="width:100px"><button class="btn small" id="bulk-tag-btn">Tag</button></div>
    <div id="tx-table"></div><div class="row" style="justify-content:center;margin-top:12px"><button class="btn" id="more">Load more</button></div></div>`;
  let items = [], total = 0;
  const load = async (append = false) => {
    if (!append) { state.offset = 0; items = []; }
    const p = new URLSearchParams({ limit: 100, offset: state.offset });
    ['q', 'account_id', 'category_id', 'start', 'end', 'tag'].forEach(k => state[k] && p.set(k, state[k]));
    if (state.uncategorized) p.set('uncategorized', 'true'); if (state.unreviewed) p.set('unreviewed', 'true');
    const r = await api('/transactions?' + p); total = r.total; items = items.concat(r.items); state.offset = items.length;
    $('#tx-count').textContent = `${total.toLocaleString()} transactions${state.account_id ? ' · ' + (ACCTS.find(a => a.id == state.account_id) || {}).name : ''}`;
    $('#more').style.display = items.length < total ? '' : 'none';
    drawTable();
  };
  const drawTable = () => {
    $('#tx-table').innerHTML = items.length ? `<table><thead><tr><th class="checkbox-cell"><input type="checkbox" id="sel-all"></th><th>Date</th><th>Merchant</th><th>Category</th><th>Account</th><th class="right">Amount</th></tr></thead><tbody>
      ${items.map(t => `<tr class="clickable" data-id="${t.id}"><td class="checkbox-cell"><input type="checkbox" data-sel="${t.id}" ${selected.has(t.id) ? 'checked' : ''}></td><td class="muted num" style="white-space:nowrap">${fmtDate(t.date)}</td>
        <td><div>${h(t.merchant)} ${t.pending ? '<span class="chip pending">pending</span>' : ''}${t.transfer_pair_id ? '<span class="chip transfer">transfer</span>' : ''}${t.split_count ? '<span class="chip">split</span>' : ''}${t.tags.map(g => `<span class="chip tag">${h(g)}</span>`).join('')}</div>${t.notes ? `<div class="muted small">${h(t.notes)}</div>` : ''}</td>
        <td><span class="chip cat" data-catpick="${t.id}">${h(t.category || 'Uncategorized')}</span></td><td class="muted small">${h(t.account)}</td><td class="right tx-amount ${t.amount > 0 ? 'pos' : ''}">${money(t.amount, { sign: true })}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No transactions match.</div>';
    $('#tx-table').querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = (e) => { if (e.target.closest('input,[data-catpick]')) return; txDetail(items.find(t => t.id === +tr.dataset.id), () => load()); });
    $('#tx-table').querySelectorAll('[data-catpick]').forEach(el => el.onclick = () => quickCategory(items.find(t => t.id === +el.dataset.catpick), () => load()));
    $('#tx-table').querySelectorAll('[data-sel]').forEach(cb => cb.onchange = () => { cb.checked ? selected.add(+cb.dataset.sel) : selected.delete(+cb.dataset.sel); updateBulk(); });
    const all = $('#sel-all'); if (all) all.onchange = () => { items.forEach(t => all.checked ? selected.add(t.id) : selected.delete(t.id)); drawTable(); updateBulk(); };
  };
  const updateBulk = () => { $('#bulk').classList.toggle('show', selected.size > 0); $('#bulk-n').textContent = `${selected.size} selected`; };
  const bulk = async (body) => { await api('/transactions/bulk', { method: 'POST', body: { ids: [...selected], ...body } }); selected.clear(); updateBulk(); toast('Updated'); load(); };
  $('#bulk-apply').onclick = () => bulk({ category_id: +$('#bulk-cat').value });
  $('#bulk-review').onclick = () => bulk({ reviewed: true });
  $('#bulk-hide').onclick = () => bulk({ hidden: true });
  $('#bulk-tag-btn').onclick = () => $('#bulk-tag').value && bulk({ add_tag: $('#bulk-tag').value });
  let deb; $('#f-q').oninput = e => { state.q = e.target.value; clearTimeout(deb); deb = setTimeout(() => load(), 250); };
  $('#f-acct').onchange = e => { state.account_id = e.target.value; load(); }; $('#f-cat').onchange = e => { state.category_id = e.target.value; load(); };
  $('#f-start').onchange = e => { state.start = e.target.value; load(); }; $('#f-end').onchange = e => { state.end = e.target.value; load(); };
  $('#f-unc').onchange = e => { state.uncategorized = e.target.checked; load(); }; $('#f-unrev').onchange = e => { state.unreviewed = e.target.checked; load(); };
  $('#more').onclick = () => load(true);
  $('#add-tx').onclick = () => modal(`<h2>Add transaction</h2><form class="form"><div class="two"><label>Account${acctSelect(null, 'name="account_id"')}</label><label>Date<input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}" required></label></div>
    <label>Description<input name="description" required placeholder="e.g. Farmers market"></label><div class="two"><label>Amount (negative = spending)<input type="number" step="0.01" name="amount" required></label><label>Category${catSelect(null, 'name="category_id"')}</label></div>
    <label>Notes<input name="notes"></label><div class="form-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Add</button></div></form>`,
    (m, close) => $('form', m).onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.account_id = +f.account_id; f.amount = +f.amount; f.category_id = +f.category_id; await api('/transactions', { method: 'POST', body: f }); close(); toast('Added'); load(); });
  await load();
};
function quickCategory(t, done) {
  modal(`<h2>Categorize</h2><p class="muted">${h(t.merchant)} · ${money(t.amount)} · ${fmtDate(t.date)}</p><form class="form"><label>Category${catSelect(t.category_id, 'name="category_id" autofocus')}</label>
    <label class="row" style="display:flex"><input type="checkbox" name="create_rule" checked> Always categorize <b>“${h(t.merchant)}”</b> this way (creates a rule and applies it to past unreviewed transactions)</label>
    <label>Rule matches text<input name="rule_pattern" value="${h(t.merchant)}"></label>
    <div class="form-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
    (m, close) => $('form', m).onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); const r = await api(`/transactions/${t.id}`, { method: 'PATCH', body: { category_id: +f.get('category_id'), create_rule: f.get('create_rule') === 'on', rule_pattern: f.get('rule_pattern') } }); close(); toast(r.rule_applied_to ? `Saved · rule applied to ${r.rule_applied_to} transactions` : 'Saved'); done(); });
}
async function txDetail(t0, done) {
  const t = await api(`/transactions/${t0.id}`);
  modal(`<h2>${h(t.merchant)}</h2><div class="muted" style="margin:-10px 0 14px">${h(t.description)} · ${h(t.account)} · ${t.date}</div>
  <form class="form"><div class="two"><label>Merchant name<input name="merchant" value="${h(t.merchant)}"></label><label>Amount<input type="number" step="0.01" name="amount" value="${t.amount}"></label></div>
  <div class="two"><label>Category${catSelect(t.category_id, 'name="category_id"')}</label><label>Date<input type="date" name="date" value="${t.date}"></label></div>
  <label>Tags (comma-separated)<input name="tags" value="${h(t.tags.join(', '))}"></label><label>Notes<textarea name="notes" rows="2">${h(t.notes || '')}</textarea></label>
  <label class="row" style="display:flex"><input type="checkbox" name="hidden" ${t.hidden ? 'checked' : ''}> Hide from budgets & reports</label>
  <details><summary>Split into multiple categories ${t.splits.length ? `(${t.splits.length} splits)` : ''}</summary><div id="splits" style="margin-top:8px">${(t.splits.length ? t.splits : [{ amount: t.amount, category_id: t.category_id }]).map(s => splitRow(s)).join('')}</div><button class="btn small" type="button" id="add-split">+ split</button> <button class="btn small" type="button" id="save-splits">Save splits</button> <span class="muted small" id="split-sum"></span></details>
  <div class="form-actions"><button class="btn danger" type="button" id="del">Delete</button><span class="grow"></span><button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
    (m, close) => {
      $('form', m).onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); await api(`/transactions/${t.id}`, { method: 'PATCH', body: { merchant: f.get('merchant'), amount: +f.get('amount'), category_id: +f.get('category_id'), date: f.get('date'), notes: f.get('notes'), hidden: f.get('hidden') === 'on', tags: f.get('tags').split(',').map(s => s.trim()).filter(Boolean) } }); close(); toast('Saved'); done(); };
      $('#del', m).onclick = async () => { if (await confirmModal('Delete this transaction?')) { await api(`/transactions/${t.id}`, { method: 'DELETE' }); close(); done(); } };
      $('#add-split', m).onclick = () => $('#splits', m).insertAdjacentHTML('beforeend', splitRow({ amount: 0 }));
      $('#save-splits', m).onclick = async () => { const rows = [...m.querySelectorAll('.split-row')].map(r => ({ amount: +$('[name=s_amount]', r).value, category_id: +$('[name=s_cat]', r).value })); const sum = rows.reduce((s, r) => s + r.amount, 0); if (Math.abs(sum - t.amount) > 0.005) { $('#split-sum', m).textContent = `Splits total ${money(sum)}, must equal ${money(t.amount)}`; return; } try { await api(`/transactions/${t.id}/splits`, { method: 'PUT', body: rows.length > 1 ? rows : [] }); toast('Splits saved'); close(); done(); } catch (e) { toast(e.message); } };
    });
}
const splitRow = (s) => `<div class="row split-row" style="margin-bottom:6px"><input type="number" step="0.01" name="s_amount" value="${s.amount}" style="width:110px">${catSelect(s.category_id, 'name="s_cat"')}</div>`;

// =============== BUDGETS ===============
views.budgets = async (main, q) => {
  let month = q.month || thisMonth();
  const draw = async () => {
    destroyCharts();
    const bs = await api('/budgets?month=' + month);
    const s = bs.summary, t = bs.totals;
    const section = (title, type, rows) => rows.length || type !== 'income' ? `<div class="card" style="margin-top:16px"><div class="row between"><h2>${title}</h2><span class="muted small">${type === 'income' ? `${money(t.income_actual)} of ${money(t.income_budget)}` : `${money(t[type + '_actual'])} of ${money(t[type + '_budget'])}`}</span></div>
      <div class="budget-row muted small" style="border-bottom:1px solid var(--border)"><span>Category</span><span class="right">Budget</span><span class="right">${type === 'income' ? 'Received' : 'Spent'}</span><span class="right">${type === 'income' ? 'Still expected' : 'Remaining'}</span></div>
      ${rows.map(r => `<div class="budget-row"><div><div class="name">${h(r.category)} ${r.rollover ? `<span class="chip" title="Rollover from previous months">${money(r.rollover, { sign: true, cents: false })} rolled</span>` : ''}</div>${r.kind === 'expense' ? barHtml(r.pct) : ''}</div>
        <div class="right"><input type="number" step="1" data-cat="${r.category_id}" value="${r.budget ?? ''}" placeholder="—"></div><div class="right num">${money(r.actual)}</div>
        <div class="right num ${r.remaining == null ? 'muted' : r.remaining < 0 && r.kind === 'expense' ? 'bad' : ''}">${r.remaining == null ? '—' : money(r.kind === 'income' ? -r.remaining : r.remaining)}</div></div>`).join('')}</div>` : '';
    const rows = bs.rows;
    main.innerHTML = `<div class="page-head"><div><h1>Budget</h1><div class="sub">Fixed bills, flexible spending and non-monthly costs. Type a number to set a default budget; it applies every month.</div></div>
      <div class="row"><button class="btn" id="prev">‹</button><b style="min-width:150px;text-align:center">${monthName(month)}</b><button class="btn" id="next">›</button><button class="btn" id="suggest">Suggest from history</button></div></div>
    <div class="grid cols-4">
      <div class="card stat"><div class="label">Expected income</div><div class="value">${money(s.expected_income, { cents: false })}</div><div class="delta">${t.income_budget ? 'budgeted' : 'actual so far (set an income budget)'}</div></div>
      <div class="card stat"><div class="label">Planned spending</div><div class="value">${money(s.planned_spending, { cents: false })}</div><div class="delta">fixed ${money(t.fixed_budget, { cents: false })} · flex ${money(t.flex_budget, { cents: false })} · non-monthly ${money(t.non_monthly_budget, { cents: false })}</div></div>
      <div class="card stat"><div class="label">Left to budget</div><div class="value ${s.left_to_budget < 0 ? 'bad' : 'pos'}">${money(s.left_to_budget, { cents: false })}</div><div class="delta">${s.left_to_budget < 0 ? 'you are planning to spend more than you earn' : 'unallocated: savings or goals'}</div></div>
      <div class="card stat"><div class="label">Remaining this month</div><div class="value">${money(s.remaining, { cents: false })}</div><div class="delta">${money(s.spent, { cents: false })} spent · ${pct(s.month_progress)} of month gone${s.unbudgeted_spend ? ` · <span class="warn">${money(s.unbudgeted_spend, { cents: false })} unbudgeted</span>` : ''}</div>${barHtml(s.planned_spending ? s.spent / s.planned_spending : 0)}</div>
    </div>
    ${section('Income', 'income', rows.filter(r => r.kind === 'income'))}
    ${section('Fixed', 'fixed', rows.filter(r => r.kind === 'expense' && r.budget_type === 'fixed'))}
    ${section('Flexible', 'flex', rows.filter(r => r.kind === 'expense' && r.budget_type === 'flex'))}
    ${section('Non-monthly', 'non_monthly', rows.filter(r => r.kind === 'expense' && r.budget_type === 'non_monthly'))}
    <div class="card" style="margin-top:16px"><details><summary>Add a budget for a category not shown</summary><div class="row" style="margin-top:10px">${catSelect(null, 'id="new-cat"')}<input type="number" id="new-amt" placeholder="amount"><button class="btn" id="new-add">Add</button></div><p class="muted small">Change a category's type (fixed / flex / non-monthly) and rollover in <a href="#settings">Settings → Categories</a>.</p></details></div>`;
    $('#prev').onclick = () => { month = shiftMonth(month, -1); draw(); }; $('#next').onclick = () => { month = shiftMonth(month, 1); draw(); };
    main.querySelectorAll('input[data-cat]').forEach(inp => inp.onchange = async () => { await api('/budgets', { method: 'PUT', body: { category_id: +inp.dataset.cat, amount: inp.value === '' ? null : +inp.value, month: null } }); toast('Budget saved'); draw(); });
    $('#new-add').onclick = async () => { if (!$('#new-amt').value) return; await api('/budgets', { method: 'PUT', body: { category_id: +$('#new-cat').value, amount: +$('#new-amt').value, month: null } }); draw(); };
    $('#suggest').onclick = async () => { const sug = await api('/budgets/suggest'); modal(`<h2>Suggested budgets</h2><p class="muted">Average of your last 3 complete months. Applies as the default for categories you haven't budgeted.</p><table>${sug.map(s => `<tr><td>${h(s.category)}</td><td class="right num">${money(s.suggested, { cents: false })}</td></tr>`).join('')}</table><div class="form-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="apply">Apply all</button></div>`, (m, close) => $('#apply', m).onclick = async () => { const r = await api('/budgets/apply-suggestions', { method: 'POST' }); close(); toast(`Set ${r.set} budgets`); draw(); }); };
  };
  await draw();
};

// =============== RECURRING ===============
views.recurring = async (main) => {
  const r = await api('/recurring');
  const today = new Date(); const y = today.getFullYear(), m = today.getMonth();
  const daysIn = new Date(y, m + 1, 0).getDate(), first = new Date(y, m, 1).getDay();
  const byDay = {};
  r.items.forEach(it => { const d = new Date(it.next_date + 'T00:00'); if (d.getFullYear() === y && d.getMonth() === m) (byDay[d.getDate()] ||= []).push(it); });
  const row = (it) => `<tr><td>${h(it.merchant)}<div class="muted small">${h(it.category || '')} · ${it.cadence} · seen ${it.occurrences}×</div></td><td class="muted small">${it.overdue ? '<span class="bad">overdue</span> ' : ''}${fmtDate(it.next_date)}</td><td class="right tx-amount ${it.amount > 0 ? 'pos' : ''}">${money(it.amount, { sign: true })}</td><td class="right muted num small">${money(it.monthly_equivalent)}/mo</td>
    <td class="right"><span class="chip">${it.status}</span> ${it.status !== 'ignored' ? `<button class="btn small" data-ign="${it.merchant_key}">Not recurring</button>` : `<button class="btn small" data-un="${it.merchant_key}">Restore</button>`}</td></tr>`;
  const exp = r.items.filter(i => i.kind === 'expense'), inc = r.items.filter(i => i.kind === 'income');
  main.innerHTML = `<div class="page-head"><div><h1>Recurring</h1><div class="sub">Bills, subscriptions and income detected from your history. Confirm or dismiss the guesses.</div></div></div>
  <div class="grid cols-3">
    <div class="card stat"><div class="label">Recurring expenses</div><div class="value">${money(r.monthly_expenses, { cents: false })}<span class="muted" style="font-size:14px">/mo</span></div><div class="delta">${exp.length} items · ${money(r.monthly_expenses * 12, { cents: false })}/yr</div></div>
    <div class="card stat"><div class="label">Recurring income</div><div class="value">${money(r.monthly_income, { cents: false })}<span class="muted" style="font-size:14px">/mo</span></div><div class="delta">${inc.length} sources</div></div>
    <div class="card stat"><div class="label">Subscriptions</div><div class="value">${money(-exp.filter(i => i.category === 'Subscriptions').reduce((s, i) => s + i.monthly_equivalent, 0), { cents: false })}<span class="muted" style="font-size:14px">/mo</span></div><div class="delta">${exp.filter(i => i.category === 'Subscriptions').map(i => h(i.merchant)).join(', ') || 'none detected'}</div></div>
  </div>
  <div class="grid cols-3" style="margin-top:16px">
    <div class="card span-2"><h2>${today.toLocaleDateString(undefined, { month: 'long' })} calendar</h2>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;font-size:12px">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<div class="muted small" style="text-align:center">${d}</div>`).join('')}
      ${Array.from({ length: first }, () => '<div></div>').join('')}
      ${Array.from({ length: daysIn }, (_, i) => i + 1).map(d => `<div style="min-height:58px;min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:6px;padding:4px;${d === today.getDate() ? 'background:var(--accent-soft)' : ''}"><div class="muted small">${d}</div>${(byDay[d] || []).map(it => `<div class="small ${it.amount > 0 ? 'pos' : ''}" title="${h(it.merchant)} ${money(it.amount)}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${h(it.merchant)} <span class="num">${money(it.amount, { cents: false })}</span></div>`).join('')}</div>`).join('')}</div></div>
    <div class="card"><h2>Mark something as recurring</h2><p class="muted small">Detection needs 3+ charges at a steady cadence. If something's missing, open the transaction and set its merchant name consistently, or confirm it here by merchant key.</p>
      <div class="row"><input id="conf-key" placeholder="merchant name"><button class="btn" id="conf-btn">Confirm</button></div></div>
  </div>
  <div class="card" style="margin-top:16px"><h2>Expenses</h2><table><thead><tr><th>Merchant</th><th>Next</th><th class="right">Amount</th><th class="right">Monthly</th><th></th></tr></thead>${exp.map(row).join('')}</table></div>
  <div class="card" style="margin-top:16px"><h2>Income</h2><table>${inc.map(row).join('') || '<tr><td class="empty">No recurring income detected.</td></tr>'}</table></div>`;
  main.querySelectorAll('[data-ign]').forEach(b => b.onclick = async () => { await api(`/recurring/${b.dataset.ign}/status`, { method: 'POST', body: { status: 'ignored' } }); render(); });
  main.querySelectorAll('[data-un]').forEach(b => b.onclick = async () => { await api(`/recurring/${b.dataset.un}/status`, { method: 'POST', body: { status: 'detected' } }); render(); });
  $('#conf-btn').onclick = async () => { const k = $('#conf-key').value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24); if (!k) return; await api(`/recurring/${k}/status`, { method: 'POST', body: { status: 'confirmed', display_name: $('#conf-key').value } }); toast('Confirmed'); render(); };
};

// =============== GOALS ===============
views.goals = async (main) => {
  const goals = await api('/goals');
  main.innerHTML = `<div class="page-head"><div><h1>Goals</h1><div class="sub">Link a goal to an account and progress tracks its balance automatically.</div></div><button class="btn primary" id="add">New goal</button></div>
  <div class="grid cols-3">${goals.map(g => `<div class="card goal"><div class="row between"><h2 style="margin:0">${h(g.name)}</h2><span class="chip">${g.kind === 'payoff' ? 'pay off' : 'save'}</span></div>
    <div class="pct" style="margin-top:8px">${pct(g.pct)} <span class="muted" style="font-size:13px;font-weight:400">${money(g.current, { cents: false })} of ${money(g.target_amount, { cents: false })}</span></div>${barHtml(g.pct, g.pct >= 1 ? 'good' : '')}
    <div class="meta" style="margin-top:8px">${g.remaining <= 0 ? '🎉 Done' : `${money(g.remaining, { cents: false })} to go${g.target_date ? ` by ${fmtDate(g.target_date)} (${g.months_left} mo)` : ''}${g.needed_per_month != null ? ` · need ${money(g.needed_per_month, { cents: false })}/mo` : ''}${g.monthly_contribution ? ` · contributing ${money(g.monthly_contribution, { cents: false })}/mo` : ''}${g.eta_months ? ` · ETA ${g.eta_months} mo` : ''}`}
    ${g.remaining > 0 && g.target_date ? `<div class="${g.on_track ? 'pos' : 'warn'}" style="margin-top:4px">${g.on_track ? '✓ On track' : '⚠ Behind — raise contribution or push the date'}</div>` : ''}</div>
    <div class="row" style="margin-top:10px"><button class="btn small" data-edit="${g.id}">Edit</button><button class="btn small danger" data-del="${g.id}">Remove</button></div></div>`).join('') || '<div class="card empty">No goals yet.</div>'}</div>`;
  const form = (g) => modal(`<h2>${g ? 'Edit goal' : 'New goal'}</h2><form class="form"><label>Name<input name="name" value="${h(g?.name || '')}" required></label>
    <div class="two"><label>Type<select name="kind"><option value="save" ${g?.kind === 'save' ? 'selected' : ''}>Save up</option><option value="payoff" ${g?.kind === 'payoff' ? 'selected' : ''}>Pay off debt</option></select></label><label>Target amount<input type="number" step="1" name="target_amount" value="${g?.target_amount || ''}" required></label></div>
    <div class="two"><label>Target date<input type="date" name="target_date" value="${g?.target_date || ''}"></label><label>Linked account (optional)${acctSelect(g?.account_id, 'name="account_id"', true)}</label></div>
    <div class="two"><label>Starting amount (if no account)<input type="number" step="1" name="starting_amount" value="${g?.starting_amount || 0}"></label><label>Monthly contribution<input type="number" step="1" name="monthly_contribution" value="${g?.monthly_contribution || 0}"></label></div>
    <div class="form-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
    (m, close) => $('form', m).onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.target_amount = +f.target_amount; f.starting_amount = +f.starting_amount; f.monthly_contribution = +f.monthly_contribution; f.account_id = f.account_id ? +f.account_id : null; f.target_date = f.target_date || null; await api(g ? `/goals/${g.id}` : '/goals', { method: g ? 'PATCH' : 'POST', body: f }); close(); render(); });
  $('#add').onclick = () => form();
  main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(goals.find(g => g.id === +b.dataset.edit)));
  main.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (await confirmModal('Remove this goal?')) { await api(`/goals/${b.dataset.del}`, { method: 'DELETE' }); render(); } });
};

// =============== REPORTS ===============
views.reports = async (main, q) => {
  let months = +(q.months || 1), catId = q.category_id ? +q.category_id : null;
  const draw = async () => {
    destroyCharts();
    const [sp, cf, sk] = await Promise.all([api(`/reports/spending?months=${months}`), api('/reports/cashflow?months=12'), api(`/reports/sankey?months=${months}`)]);
    const trend = catId ? await api(`/reports/trend/${catId}?months=12`) : null;
    main.innerHTML = `<div class="page-head"><div><h1>Reports</h1><div class="sub">${sp.start} → ${sp.end}</div></div>
      <div class="pill-nav">${[1, 3, 6, 12].map(n => `<button data-m="${n}" class="${months === n ? 'active' : ''}">${n === 1 ? 'This month' : n + ' months'}</button>`).join('')}</div></div>
    <div class="grid cols-3">
      <div class="card span-3"><h2>Where the money went</h2><div class="muted small" style="margin-top:-8px;margin-bottom:8px">Income ${money(sk.income)} → spending ${money(sk.expenses)}${sk.income > sk.expenses ? ` → saved ${money(sk.income - sk.expenses)}` : ''}</div><svg class="sankey" id="sankey"></svg></div>
      <div class="card span-2"><h2>Income vs. expenses, 12 months</h2><div class="chart"><canvas id="cf"></canvas></div>${legend([{ label: 'Income' }, { label: 'Expenses', color: css('--s2') }, { label: 'Saved', color: css('--s3') }])}</div>
      <div class="card"><h2>Savings rate</h2><div class="chart"><canvas id="sr"></canvas></div></div>
      <div class="card"><h2>By group</h2><table>${sp.groups.map(g => `<tr><td>${h(g.group)}</td><td class="right num">${money(g.spent)}</td><td class="right muted small num">${pct(g.spent / (sk.expenses || 1))}</td></tr>`).join('')}</table></div>
      <div class="card"><h2>By category</h2><table>${sp.groups.flatMap(g => g.categories).sort((a, b) => b.spent - a.spent).slice(0, 14).map(c => `<tr class="clickable" data-cat="${c.category_id}"><td>${h(c.category)}<div class="muted small">${c.count} transactions</div></td><td class="right num">${money(c.spent)}</td></tr>`).join('')}</table></div>
      <div class="card"><h2>Top merchants</h2><table>${sp.merchants.map(m => `<tr class="clickable" data-q="${h(m.merchant)}"><td>${h(m.merchant)}<div class="muted small">${m.count}×</div></td><td class="right num">${money(m.spent)}</td></tr>`).join('')}</table></div>
      ${trend ? `<div class="card span-3"><div class="row between"><h2>${h(catName(catId))} by month</h2><button class="btn small" id="clear-trend">✕</button></div><div class="chart"><canvas id="trend"></canvas></div></div>` : ''}
    </div>`;
    barChart($('#cf'), cf.map(x => fmtMonth(x.month)), [{ label: 'Income', data: cf.map(x => x.income) }, { label: 'Expenses', data: cf.map(x => x.expenses), color: css('--s2') }, { label: 'Saved', data: cf.map(x => x.savings), color: css('--s3') }]);
    mkChart($('#sr'), { type: 'line', data: { labels: cf.map(x => fmtMonth(x.month)), datasets: [{ data: cf.map(x => x.savings_rate == null ? null : x.savings_rate * 100), borderColor: css('--s3'), borderWidth: 2, pointRadius: 0, tension: .25 }] }, options: { maintainAspectRatio: false, scales: { x: axisCat, y: { ticks: { callback: v => v + '%', maxTicksLimit: 5 }, grid: { color: css('--border'), drawTicks: false }, border: { display: false } } }, plugins: { tooltip: { callbacks: { label: c => c.parsed.y.toFixed(0) + '% saved' } } } } });
    if (trend) { barChart($('#trend'), trend.map(x => fmtMonth(x.month)), [{ label: 'Spent', data: trend.map(x => x.spent) }]); $('#clear-trend').onclick = () => { catId = null; draw(); }; }
    drawSankey($('#sankey'), sk.links);
    main.querySelectorAll('.pill-nav button').forEach(b => b.onclick = () => { months = +b.dataset.m; draw(); });
    main.querySelectorAll('[data-cat]').forEach(tr => tr.onclick = () => { catId = +tr.dataset.cat; draw(); });
    main.querySelectorAll('[data-q]').forEach(tr => tr.onclick = () => location.hash = '#transactions?q=' + encodeURIComponent(tr.dataset.q));
  };
  await draw();
};
function drawSankey(svg, links) {
  svg.innerHTML = '';
  if (!links.length) { svg.innerHTML = '<text x="20" y="30" class="muted">No data for this period.</text>'; return; }
  const W = svg.clientWidth || 900, H = 420, PAD = 8, NODE_W = 10;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  // layers: sources of 'Cash flow' = 0, 'Cash flow' = 1, groups = 2, categories = 3
  const layer = {}; const nodes = {};
  links.forEach(l => { nodes[l.source] ||= { name: l.source, out: 0, in: 0 }; nodes[l.target] ||= { name: l.target, out: 0, in: 0 }; nodes[l.source].out += l.value; nodes[l.target].in += l.value; });
  layer['Cash flow'] = 1;
  links.forEach(l => { if (l.target === 'Cash flow') layer[l.source] = 0; });
  links.forEach(l => { if (l.source === 'Cash flow') layer[l.target] = 2; });
  links.forEach(l => { if (layer[l.source] === 2 && layer[l.target] == null) layer[l.target] = 3; });
  const cols = [[], [], [], []];
  Object.values(nodes).forEach(n => { n.value = Math.max(n.in, n.out); n.layer = layer[n.name] ?? 3; cols[n.layer].push(n); });
  cols.forEach(c => c.sort((a, b) => b.value - a.value));
  const total = Math.max(...cols.map(c => c.reduce((s, n) => s + n.value, 0)));
  const usable = H - PAD * 2;
  const colX = [0, (W - 160) / 3, 2 * (W - 160) / 3, W - 160 - NODE_W].map(x => x + 10);
  cols.forEach((c, i) => { const gap = c.length > 1 ? Math.min(10, (usable * 0.2) / (c.length - 1)) : 0; const scale = (usable - gap * (c.length - 1)) / total; let y = PAD + (usable - (c.reduce((s, n) => s + n.value, 0) * scale + gap * (c.length - 1))) / 2; c.forEach(n => { n.x = colX[i]; n.y = y; n.h = Math.max(1, n.value * scale); n.scale = scale; n.oy = n.y; n.iy = n.y; y += n.h + gap; }); });
  const colors = SERIES(); const groupColor = {}; let ci = 0;
  cols[2].forEach(n => groupColor[n.name] = n.name === 'Saved' ? css('--s3') : colors[ci++ % 8]);
  const colorOf = (l) => groupColor[l.target] || groupColor[l.source] || css('--s1');
  let out = '';
  links.sort((a, b) => (nodes[a.source].y - nodes[b.source].y) || (nodes[a.target].y - nodes[b.target].y)).forEach(l => {
    const s = nodes[l.source], t = nodes[l.target]; const w = Math.max(1, l.value * s.scale);
    const x0 = s.x + NODE_W, x1 = t.x, y0 = s.oy + w / 2, y1 = t.iy + w / 2; s.oy += w; t.iy += w;
    const cx = (x0 + x1) / 2;
    out += `<path class="link" d="M${x0},${y0} C${cx},${y0} ${cx},${y1} ${x1},${y1}" stroke="${colorOf(l)}" stroke-width="${w}"><title>${h(l.source)} → ${h(l.target)}: ${money(l.value)}</title></path>`;
  });
  Object.values(nodes).forEach(n => {
    const fill = n.layer === 1 ? css('--text-2') : (groupColor[n.name] || (n.layer === 3 ? colorOf(links.find(l => l.target === n.name)) : css('--s1')));
    out += `<rect x="${n.x}" y="${n.y}" width="${NODE_W}" height="${n.h}" rx="2" fill="${fill}"><title>${h(n.name)}: ${money(n.value)}</title></rect>`;
    if (n.h >= 9 || n.layer <= 1) { const right = n.layer === 3; out += `<text x="${right ? n.x + NODE_W + 6 : n.x - 6}" y="${n.y + n.h / 2 + 4}" text-anchor="${right ? 'start' : 'end'}">${h(n.name)} <tspan class="muted" fill="${css('--muted')}">${money(n.value, { cents: false })}</tspan></text>`; }
  });
  svg.innerHTML = out;
}

// =============== INVESTMENTS ===============
views.investments = async (main) => {
  const [hold, nw] = await Promise.all([api('/holdings'), api('/net-worth')]);
  const inv = ACCTS.filter(a => a.type === 'investment' && !a.archived);
  const total = inv.reduce((s, a) => s + a.balance, 0);
  const byType = {}; hold.forEach(x => byType[x.type || 'other'] = (byType[x.type || 'other'] || 0) + x.value);
  main.innerHTML = `<div class="page-head"><div><h1>Investments</h1><div class="sub">${money(total)} across ${inv.length} accounts</div></div></div>
  <div class="grid cols-3">
    <div class="card span-2"><h2>Investment accounts</h2><table>${inv.map(a => `<tr><td>${h(a.name)}<div class="muted small">${h(a.institution || '')}</div></td><td class="right num">${money(a.balance)}</td><td class="right muted small">${pct(a.balance / (total || 1))}</td></tr>`).join('') || '<tr><td class="empty">No investment accounts. Add one in Accounts, or connect a brokerage via Plaid to pull holdings.</td></tr>'}</table></div>
    <div class="card"><h2>Allocation</h2>${Object.keys(byType).length ? `<div class="chart short"><canvas id="alloc"></canvas></div>` : '<div class="empty small">Holdings appear here after a Plaid sync of an investment account.</div>'}</div>
    <div class="card span-3"><h2>Holdings</h2>${hold.length ? `<table><thead><tr><th>Ticker</th><th>Name</th><th>Account</th><th class="right">Qty</th><th class="right">Price</th><th class="right">Value</th><th class="right">Gain</th></tr></thead>${hold.map(x => { const g = x.cost_basis != null ? x.value - x.cost_basis : null; return `<tr><td><b>${h(x.ticker)}</b></td><td>${h(x.name)}</td><td class="muted small">${h(x.account)}</td><td class="right num">${x.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td><td class="right num">${money(x.price)}</td><td class="right num">${money(x.value)}</td><td class="right num ${g == null ? 'muted' : g >= 0 ? 'pos' : 'bad'}">${g == null ? '—' : money(g, { sign: true })}</td></tr>`; }).join('')}</table>` : '<div class="empty">No holdings synced yet.</div>'}</div>
  </div>`;
  if (Object.keys(byType).length) barChart($('#alloc'), Object.keys(byType), [{ label: 'Value', data: Object.values(byType) }], { horizontal: true, thick: 18 });
};

// =============== INSIGHTS ===============
views.insights = async (main) => {
  const ins = await api('/insights');
  main.innerHTML = `<div class="page-head"><div><h1>Insights</h1><div class="sub">Things worth your attention, generated from your own data. Dismiss what you've handled.</div></div></div>
  <div class="card">${ins.length ? ins.map(insightHtml).join('') : '<div class="empty">All clear.</div>'}</div>`;
  bindInsightActions(main);
};

// =============== SETTINGS ===============
views.settings = async (main) => {
  const [plaid, rules, profiles, tags] = await Promise.all([api('/plaid/status'), api('/rules'), api('/import/profiles'), api('/tags')]);
  main.innerHTML = `<div class="page-head"><div><h1>Settings</h1></div></div>
  <div class="grid cols-2">
    <div class="card"><h2>Connect banks with Plaid</h2>
      ${plaid.configured ? `<p class="muted small">Environment: <span class="code">${plaid.env}</span></p><div class="row"><button class="btn primary" id="link-btn">Connect a bank</button>${plaid.env === 'sandbox' ? '<button class="btn" id="sandbox-btn">Add sandbox test bank</button>' : ''}<button class="btn" id="sync-now">Sync now</button></div>
        <table style="margin-top:12px">${plaid.items.map(it => `<tr><td><b>${h(it.institution_name || 'Institution')}</b><div class="muted small">${it.accounts.map(a => h(a.name)).join(', ')}</div>${it.last_error ? `<div class="bad small">${h(it.last_error)}</div>` : ''}</td><td class="muted small">${it.last_synced_at ? 'synced ' + it.last_synced_at.slice(0, 16).replace('T', ' ') : 'never synced'}</td><td class="right"><button class="btn small" data-reauth="${it.id}">Re-authenticate</button> <button class="btn small danger" data-unlink="${it.id}">Unlink</button></td></tr>`).join('') || '<tr><td class="muted">No banks connected yet.</td></tr>'}</table>`
      : `<p>Plaid is not configured. Get free sandbox keys at <a href="https://dashboard.plaid.com/signup" target="_blank">dashboard.plaid.com</a>, then start the server with:</p><pre class="code" style="padding:10px;white-space:pre-wrap">PLAID_CLIENT_ID=… PLAID_SECRET=… PLAID_ENV=sandbox ledger serve</pre><p class="muted small">Production access requires Plaid approval (a short application). Until then, import CSVs below.</p>`}
    </div>
    <div class="card"><h2>Import a CSV</h2><p class="muted small">Download transactions from your bank's website, then drop the file here. Duplicates are skipped, so re-importing overlapping ranges is safe.</p>
      <form class="form" id="imp"><div class="two"><label>Into account${acctSelect(null, 'name="account_id"')}</label><label>Bank format<select name="profile"><option value="auto">Auto-detect</option>${profiles.map(p => `<option value="${p.name}">${p.name}</option>`).join('')}</select></label></div>
        <div class="dropzone" id="dz">Drop a CSV here or <label style="color:var(--accent);cursor:pointer">choose a file<input type="file" name="file" accept=".csv,text/csv" hidden></label><div id="fname" class="small" style="margin-top:4px"></div></div>
        <div class="form-actions"><button class="btn" type="button" id="preview">Preview</button><button class="btn primary">Import</button></div></form><div id="imp-result"></div></div>
    <div class="card"><div class="row between"><h2>Categories</h2><button class="btn small" id="add-cat">Add</button></div><p class="muted small">Budget type decides where a category lands on the Budget page. Rollover carries unspent money forward (good for Travel, Gifts).</p>
      <table><thead><tr><th>Name</th><th>Group</th><th>Type</th><th>Rollover</th><th></th></tr></thead>${CATS.filter(c => !c.archived).map(c => `<tr><td>${h(c.name)}</td><td class="muted small">${h(c.group)}</td><td>${c.kind === 'expense' ? `<select data-bt="${c.id}" class="small"><option value="fixed" ${c.budget_type === 'fixed' ? 'selected' : ''}>fixed</option><option value="flex" ${c.budget_type === 'flex' ? 'selected' : ''}>flex</option><option value="non_monthly" ${c.budget_type === 'non_monthly' ? 'selected' : ''}>non-monthly</option></select>` : `<span class="chip">${c.kind}</span>`}</td><td>${c.kind === 'expense' ? `<input type="checkbox" data-ro="${c.id}" ${c.rollover ? 'checked' : ''}>` : ''}</td><td class="right">${c.name !== 'Uncategorized' ? `<button class="btn small" data-delcat="${c.id}">✕</button>` : ''}</td></tr>`).join('')}</table></div>
    <div class="card"><div class="row between"><h2>Rules (${rules.length})</h2><button class="btn small" id="add-rule">Add rule</button></div><p class="muted small">Rules match text in the bank description or merchant and set the category (and optionally a clean merchant name). Lower priority number wins. Rules you create from a transaction get priority 1.</p>
      <div class="row" style="margin-bottom:8px"><input type="search" id="rule-q" placeholder="filter rules…" class="grow"><button class="btn small" id="rerun">Re-run on uncategorized</button><button class="btn small" id="match-tr">Match transfers</button></div>
      <div style="max-height:420px;overflow:auto"><table id="rules-t">${rules.map(r => `<tr data-rule="${h(r.pattern)} ${h(r.category)} ${h(r.rename_to)}"><td><span class="code">${h(r.pattern)}</span>${r.is_regex ? ' <span class="chip">regex</span>' : ''}</td><td>→ ${h(r.category)}${r.rename_to ? ` <span class="muted small">as “${h(r.rename_to)}”</span>` : ''}</td><td class="muted small num">${r.priority}</td><td class="right"><button class="btn small" data-delrule="${r.id}">✕</button></td></tr>`).join('')}</table></div></div>
    <div class="card"><h2>Tags</h2>${tags.length ? tags.map(t => `<a class="chip tag" href="#transactions?tag=${encodeURIComponent(t.name)}">${h(t.name)} · ${t.count}</a> `).join('') : '<span class="muted small">Add tags from a transaction\'s detail view, or in bulk.</span>'}</div>
    <div class="card"><h2>Your data</h2><p class="muted small">Everything lives in a single SQLite file on your machine (see <span class="code">ledger --help</span>). Back it up like any other file. <a href="/api/export/transactions.csv">Export all transactions as CSV</a>.</p></div>
  </div>`;
  if ($('#link-btn')) $('#link-btn').onclick = () => plaidLink();
  if ($('#sync-now')) $('#sync-now').onclick = syncPlaid;
  if ($('#sandbox-btn')) $('#sandbox-btn').onclick = async () => { toast('Creating sandbox item…'); try { const r = await api('/plaid/sandbox-link', { method: 'POST', body: {} }); toast(`Linked ${r.institution}: ${r.accounts.length} accounts, ${r.sync.added} transactions`); render(); } catch (e) { toast(e.message); } };
  main.querySelectorAll('[data-reauth]').forEach(b => b.onclick = () => plaidLink(+b.dataset.reauth));
  main.querySelectorAll('[data-unlink]').forEach(b => b.onclick = async () => { if (await confirmModal('Unlink this institution? Accounts and transactions are kept; syncing stops.')) { await api(`/plaid/items/${b.dataset.unlink}`, { method: 'DELETE' }); render(); } });
  // import
  const imp = $('#imp'), dz = $('#dz'), fileInput = $('input[type=file]', imp);
  let file = null;
  const setFile = (f) => { file = f; $('#fname').textContent = f ? `${f.name} (${(f.size / 1024).toFixed(0)} KB)` : ''; };
  fileInput.onchange = () => setFile(fileInput.files[0]);
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); setFile(e.dataTransfer.files[0]); };
  const doImport = async (dry) => {
    if (!file) { toast('Choose a CSV file first'); return; }
    const fd = new FormData(); fd.append('file', file); fd.append('account_id', imp.account_id.value); fd.append('profile', imp.profile.value); fd.append('dry_run', dry);
    try {
      const r = await api('/import', { method: 'POST', body: fd });
      $('#imp-result').innerHTML = `<p><b>${dry ? 'Preview' : 'Imported'}:</b> ${r.imported} new, ${r.duplicates} duplicates skipped${r.transfer_pairs ? `, ${r.transfer_pairs} transfers matched` : ''} · format <span class="code">${r.profile}</span></p>${r.errors.length ? `<p class="bad small">${r.errors.length} rows could not be parsed:<br>${r.errors.slice(0, 5).map(h).join('<br>')}</p>` : ''}
        <table>${r.transactions.slice(0, 15).map(t => `<tr><td class="muted small">${t.date}</td><td>${h(t.merchant)}<div class="muted small">${h(t.description)}</div></td><td class="muted small">${catName(t.category_id)}</td><td class="right num">${money(t.amount)}</td></tr>`).join('')}</table>`;
      if (!dry) { toast(`Imported ${r.imported} transactions`); setFile(null); fileInput.value = ''; }
    } catch (e) { toast(e.message); }
  };
  $('#preview').onclick = () => doImport(true); imp.onsubmit = e => { e.preventDefault(); doImport(false); };
  // categories
  main.querySelectorAll('[data-bt]').forEach(s => s.onchange = async () => { await api(`/categories/${s.dataset.bt}`, { method: 'PATCH', body: { budget_type: s.value } }); toast('Saved'); });
  main.querySelectorAll('[data-ro]').forEach(c => c.onchange = async () => { await api(`/categories/${c.dataset.ro}`, { method: 'PATCH', body: { rollover: c.checked } }); toast('Saved'); });
  main.querySelectorAll('[data-delcat]').forEach(b => b.onclick = async () => { if (await confirmModal('Delete this category? Its transactions become Uncategorized.')) { await api(`/categories/${b.dataset.delcat}`, { method: 'DELETE' }); render(); } });
  $('#add-cat').onclick = () => modal(`<h2>New category</h2><form class="form"><label>Name<input name="name" required></label><div class="two"><label>Group<input name="group" list="groups" value="Lifestyle"><datalist id="groups">${[...new Set(CATS.map(c => c.group))].map(g => `<option>${h(g)}</option>`).join('')}</datalist></label><label>Kind<select name="kind"><option value="expense">expense</option><option value="income">income</option><option value="transfer">transfer</option></select></label></div>
    <div class="two"><label>Budget type<select name="budget_type"><option value="flex">flex</option><option value="fixed">fixed</option><option value="non_monthly">non-monthly</option></select></label><label class="row" style="display:flex;align-self:end"><input type="checkbox" name="rollover"> Rollover</label></div><div class="form-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Create</button></div></form>`,
    (m, close) => $('form', m).onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.rollover = f.rollover === 'on'; try { await api('/categories', { method: 'POST', body: f }); close(); render(); } catch (err) { toast(err.message); } });
  // rules
  $('#rule-q').oninput = e => { const q = e.target.value.toLowerCase(); main.querySelectorAll('#rules-t tr').forEach(tr => tr.style.display = tr.dataset.rule.toLowerCase().includes(q) ? '' : 'none'); };
  main.querySelectorAll('[data-delrule]').forEach(b => b.onclick = async () => { await api(`/rules/${b.dataset.delrule}`, { method: 'DELETE' }); b.closest('tr').remove(); });
  $('#rerun').onclick = async () => { const r = await api('/transactions/recategorize', { method: 'POST' }); toast(`Categorized ${r.updated} transactions`); };
  $('#match-tr').onclick = async () => { const r = await api('/transactions/match-transfers', { method: 'POST' }); toast(`Matched ${r.pairs} transfer pairs`); };
  $('#add-rule').onclick = () => modal(`<h2>New rule</h2><form class="form"><label>When description contains<input name="pattern" required placeholder="e.g. WHOLEFDS"></label><div class="two"><label>Set category${catSelect(null, 'name="category_id"')}</label><label>Rename merchant to (optional)<input name="rename_to" placeholder="Whole Foods"></label></div>
    <label class="row" style="display:flex"><input type="checkbox" name="is_regex"> Pattern is a regular expression</label><div class="form-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Create & apply</button></div></form>`,
    (m, close) => $('form', m).onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.category_id = +f.category_id; f.is_regex = f.is_regex === 'on'; const r = await api('/rules', { method: 'POST', body: f }); close(); toast(`Rule created · applied to ${r.applied_to} transactions`); render(); });
};

render();
})();
