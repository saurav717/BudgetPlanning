/* Browser mode: Google sign-in, encrypted vault in Google Drive, and the in-browser Python engine.
   In server mode (ledger serve) this file does nothing and the UI talks to the HTTP API. */
(() => {
'use strict';
const CFG = window.LEDGER_CONFIG || { mode: 'server' };
if (CFG.mode !== 'browser') { window.LedgerBackend = null; return; }

const $ = (s, el = document) => el.querySelector(s);
const h = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BASE = new URL('static/', location.href).href;
const RELAY = new URL((CFG.relayUrl || 'relay').replace(/\/?$/, '/'), location.href).href.replace(/\/$/, '');
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
const VAULT_NAME = 'ledger.vault.json';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

// ---------------- python engine (web worker) ----------------
const worker = new Worker(BASE + 'py-worker.js');
let seq = 0; const waiting = {};
let onProgress = () => {};
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'progress') { onProgress(m.text); return; }
  const w = waiting[m.id]; delete waiting[m.id];
  m.ok ? w.resolve(m.result) : w.reject(new Error(m.error));
};
const call = (msg) => new Promise((resolve, reject) => { const id = ++seq; waiting[id] = { resolve, reject }; worker.postMessage({ ...msg, id }); });

// ---------------- state ----------------
const S = { mode: null, token: null, tokenExp: 0, user: null, fileId: null, modified: null, dek: null, header: null,
  dirty: false, saving: false, lastSaved: null, error: null, relay: null };
const emit = () => window.dispatchEvent(new CustomEvent('ledger:status', { detail: status() }));
const status = () => ({ mode: S.mode, user: S.user, dirty: S.dirty, saving: S.saving, lastSaved: S.lastSaved, error: S.error });

// ---------------- google auth ----------------
let tokenClient = null, tokenWaiter = null;
function loadGis() {
  return new Promise((res, rej) => {
    if (window.google?.accounts?.oauth2) return res();
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  });
}
async function getToken(interactive) {
  if (S.token && Date.now() < S.tokenExp - 60e3) return S.token;
  await loadGis();
  tokenClient ||= google.accounts.oauth2.initTokenClient({ client_id: CFG.googleClientId, scope: SCOPES, callback: (r) => {
    const w = tokenWaiter; tokenWaiter = null;
    if (r.error) return w && w.reject(new Error(r.error_description || r.error));
    S.token = r.access_token; S.tokenExp = Date.now() + (+r.expires_in || 3600) * 1000;
    call({ type: 'token', token: S.token }).catch(() => {});
    w && w.resolve(S.token);
  }, error_callback: (e) => { const w = tokenWaiter; tokenWaiter = null; w && w.reject(new Error(e.message || e.type || 'Sign-in cancelled')); } });
  return new Promise((resolve, reject) => { tokenWaiter = { resolve, reject }; tokenClient.requestAccessToken({ prompt: interactive ? 'select_account' : '' }); });
}
async function gfetch(url, opts = {}) {
  const token = await getToken(false);
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  if (r.status === 401) { S.token = null; return gfetch(url, opts); }
  if (!r.ok) throw new Error(`Google Drive error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}

// ---------------- drive ----------------
async function findVault() {
  const q = encodeURIComponent(`name='${VAULT_NAME}' and trashed=false`);
  const r = await (await gfetch(`${DRIVE}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime,size)`)).json();
  return r.files && r.files[0] || null;
}
const downloadVault = async (id) => (await gfetch(`${DRIVE}/files/${id}?alt=media`)).text();
async function uploadVault(text) {
  if (S.fileId) {
    const meta = await (await gfetch(`${DRIVE}/files/${S.fileId}?fields=modifiedTime`)).json();
    if (S.modified && meta.modifiedTime !== S.modified) throw Object.assign(new Error('CONFLICT'), { remote: meta.modifiedTime });
    const r = await (await gfetch(`${UPLOAD}/files/${S.fileId}?uploadType=media&fields=id,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text })).json();
    S.modified = r.modifiedTime; return;
  }
  const boundary = 'ledger' + Math.random().toString(36).slice(2);
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: VAULT_NAME, parents: ['appDataFolder'], mimeType: 'application/json' })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
  const r = await (await gfetch(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })).json();
  S.fileId = r.id; S.modified = r.modifiedTime;
}

// ---------------- saving ----------------
let saveTimer = null;
function scheduleSave() {
  if (S.mode !== 'drive') return;
  S.dirty = true; emit();
  clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 1200);
}
async function saveNow(force = false) {
  if (S.mode !== 'drive' || S.saving || (!S.dirty && !force)) return;
  S.saving = true; S.error = null; emit();
  try {
    const bytes = await call({ type: 'export' });
    S.dirty = false;  // edits made while uploading set it again
    await uploadVault(await VaultCrypto.seal(S.dek, S.header, bytes));
    S.lastSaved = new Date();
  } catch (e) {
    S.dirty = true;
    if (e.message === 'CONFLICT') { S.error = 'conflict'; conflictDialog(); }
    else { S.error = e.message; setTimeout(() => saveNow(), 15000); }
  } finally { S.saving = false; emit(); if (S.dirty && !S.error) scheduleSave(); }
}
window.addEventListener('beforeunload', (e) => { if (S.mode === 'drive' && (S.dirty || S.saving)) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });

function conflictDialog() {
  gate(`<h1>Changed on another device</h1><p class="soft">Your vault in Google Drive was updated somewhere else (another tab or device) after this page loaded. To avoid overwriting those changes, choose what to keep.</p>
    <div class="form-actions" style="margin-top:22px"><button class="btn" id="g-overwrite">Keep this device's version</button><button class="btn primary" id="g-reload">Load the newer version</button></div>`);
  $('#g-reload').onclick = () => { S.dirty = false; location.reload(); };
  $('#g-overwrite').onclick = async () => { S.modified = null; S.error = null; closeGate(); await saveNow(true); };
}

// ---------------- request API used by app.js ----------------
let readyResolve; const ready = new Promise(r => readyResolve = r);
async function request(method, path, query, body, contentType) {
  await ready;
  const r = await call({ type: 'request', method, path, query: query || '', body, contentType });
  if (r.changed) scheduleSave();
  return r;
}

// ---------------- gate UI (sign in / unlock / create) ----------------
let gateEl = null;
function gate(inner) {
  if (!gateEl) { gateEl = document.createElement('div'); gateEl.className = 'onb'; gateEl.id = 'gate'; document.body.appendChild(gateEl); }
  gateEl.innerHTML = `<div class="onb-card"><div class="row between"><div class="brand" style="padding:0"><span class="logo"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18 9.5 12.5l3.5 3.5L20 8"/><path d="M15 8h5v5"/></svg></span><span>Ledger</span></div>${S.user ? `<span class="muted small">${h(S.user.email)}</span>` : ''}</div>${inner}</div>`;
  const f = $('[autofocus]', gateEl); f && f.focus();
}
const closeGate = () => { gateEl && gateEl.remove(); gateEl = null; };
const busy = (text) => gate(`<div style="display:grid;place-items:center;gap:14px;padding:40px 0 18px"><span class="spinner"></span><div class="soft" id="g-progress">${h(text)}</div></div>`);
onProgress = (t) => { const p = $('#g-progress'); if (p) p.textContent = t; };
const errLine = (msg) => `<div class="callout serious small" style="margin-top:14px">${h(msg)}</div>`;

function welcome(err) {
  const can = !!CFG.googleClientId;
  gate(`<h1 style="margin-top:22px">Your money, private by design</h1>
    <p class="soft">Ledger is a free, open-source money tracker. Your data is encrypted in this browser with a passphrase only you know, then saved to a private folder in <b>your own Google Drive</b>. The people who run Ledger can't read it, and neither can Google.</p>
    <div class="stack" style="margin-top:22px">
      <button class="btn primary" id="g-signin" ${can ? '' : 'disabled'} style="justify-content:center;padding:12px"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#fff" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/></svg> Sign in with Google</button>
      <button class="btn" id="g-demo" style="justify-content:center;padding:12px">Explore with sample data</button>
    </div>
    ${can ? '' : errLine('Google sign-in is not configured on this deployment (missing LEDGER_GOOGLE_CLIENT_ID). The demo still works.')}
    ${err ? errLine(err) : ''}
    <p class="tiny muted" style="margin-top:18px">Sample data lives only in this tab and disappears when you close it. <a href="#transparency" id="g-transp">Funding &amp; costs</a> · <a href="https://github.com/saurav717/BudgetPlanning" target="_blank" rel="noopener">Source code</a></p>`);
  if (can) $('#g-signin').onclick = signIn;
  $('#g-demo').onclick = startDemo;
  $('#g-transp').onclick = (e) => { e.preventDefault(); startDemo().then(() => { location.hash = '#transparency'; }); };
}

async function signIn() {
  try {
    await getToken(true);
    busy('Looking for your vault…');
    S.user = await (await gfetch('https://www.googleapis.com/oauth2/v3/userinfo')).json();
    const file = await findVault();
    if (file) { S.fileId = file.id; S.modified = file.modifiedTime; unlockScreen(await downloadVault(file.id)); }
    else createScreen();
  } catch (e) { welcome(e.message); }
}

function unlockScreen(text, err, recovery = false) {
  gate(`<h1 style="margin-top:22px">Welcome back${S.user?.given_name ? ', ' + h(S.user.given_name) : ''}</h1>
    <p class="soft">${recovery ? 'Enter the recovery key you saved when you created your vault.' : 'Enter your passphrase to decrypt your data.'}</p>
    <form class="form" id="g-form" style="margin-top:18px"><label>${recovery ? 'Recovery key' : 'Passphrase'}<input name="secret" type="${recovery ? 'text' : 'password'}" autocomplete="${recovery ? 'off' : 'current-password'}" autofocus required ${recovery ? 'placeholder="XXXX-XXXX-…" style="font-family:ui-monospace,monospace"' : ''}></label>
      ${err ? errLine(err) : ''}
      <div class="form-actions"><button type="button" class="btn ghost" id="g-alt">${recovery ? 'Use passphrase' : 'Forgot passphrase?'}</button><span class="grow"></span><button type="button" class="btn ghost" id="g-out">Sign out</button><button class="btn primary">Unlock</button></div></form>`);
  $('#g-alt').onclick = () => unlockScreen(text, null, !recovery);
  $('#g-out').onclick = signOut;
  $('#g-form').onsubmit = async (e) => {
    e.preventDefault();
    const secret = new FormData(e.target).get('secret');
    busy('Decrypting…');
    let opened;
    try { opened = await VaultCrypto.open(text, secret, { recovery }); }
    catch (er) { return unlockScreen(text, er.message === 'WRONG_SECRET' ? (recovery ? 'That recovery key doesn\'t match.' : 'That passphrase doesn\'t match.') : er.message, recovery); }
    S.dek = opened.dek; S.header = opened.header;
    await boot({ data: opened.bytes.buffer });
    if (recovery) changePassphraseDialog(true);
  };
}

function createScreen(err) {
  gate(`<h1 style="margin-top:22px">Create your vault</h1>
    <p class="soft">Choose a passphrase. It encrypts everything before it leaves this browser. <b>We can't reset it</b>, so you'll also get a recovery key to keep somewhere safe.</p>
    <form class="form" id="g-form" style="margin-top:18px">
      <label>Passphrase<input name="p1" type="password" minlength="10" autocomplete="new-password" autofocus required><span class="hint">At least 10 characters. A short sentence works well.</span></label>
      <label>Repeat it<input name="p2" type="password" autocomplete="new-password" required></label>
      <label class="check"><input type="checkbox" name="demo"> Start with sample data so I can look around first</label>
      ${err ? errLine(err) : ''}
      <div class="form-actions"><button type="button" class="btn ghost" id="g-out">Sign out</button><span class="grow"></span><button class="btn primary">Create vault</button></div></form>`);
  $('#g-out').onclick = signOut;
  $('#g-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get('p1') !== f.get('p2')) return createScreen('The passphrases don\'t match.');
    if (String(f.get('p1')).length < 10) return createScreen('Use at least 10 characters.');
    busy('Creating your vault…');
    const v = await VaultCrypto.create(f.get('p1'));
    S.dek = v.dek; S.header = v.header;
    recoveryScreen(v.recoveryKey, () => boot({ demo: f.get('demo') === 'on', fresh: true }));
  };
}

function recoveryScreen(key, next) {
  gate(`<h1 style="margin-top:22px">Save your recovery key</h1>
    <p class="soft">If you forget your passphrase, this is the only way back into your data. Store it in a password manager or print it. It won't be shown again.</p>
    <div style="margin:18px 0;padding:16px;border-radius:12px;background:var(--surface-2);font:600 17px/1.6 ui-monospace,monospace;letter-spacing:.04em;text-align:center;word-break:break-all" id="g-key">${h(key)}</div>
    <div class="row wrap"><button class="btn" id="g-copy">Copy</button><button class="btn" id="g-dl">Download as text file</button></div>
    <label class="check" style="margin-top:16px"><input type="checkbox" id="g-ok"> I've saved my recovery key somewhere safe</label>
    <div class="form-actions" style="margin-top:12px"><button class="btn primary" id="g-next" disabled>Continue</button></div>`);
  $('#g-copy').onclick = () => navigator.clipboard?.writeText(key);
  $('#g-dl').onclick = () => download(`ledger-recovery-key.txt`, `Ledger recovery key for ${S.user?.email || 'your vault'}\n\n${key}\n\nKeep this private. Anyone with it and access to your Google account can read your Ledger data.\n`, 'text/plain');
  $('#g-ok').onchange = (e) => { $('#g-next').disabled = !e.target.checked; };
  $('#g-next').onclick = next;
}

async function boot({ data, demo, fresh }) {
  busy('Starting…');
  try {
    S.relay = S.relay || await fetch(RELAY + '/config').then(r => r.ok ? r.json() : null).catch(() => null);
    const settings = S.mode === 'demo' || !S.relay?.plaid ? {} : { LEDGER_PLAID_RELAY: RELAY, PLAID_ENV: S.relay.plaid_env };
    await call({ type: 'init', data, demo, base: BASE, settings });
    if (S.token) await call({ type: 'token', token: S.token });
    S.mode ||= 'drive';
    if (S.mode === 'drive' && S.user?.given_name && fresh) {
      await call({ type: 'request', method: 'PUT', path: '/api/profile', body: { name: S.user.given_name } });
    }
    if (fresh) await saveNow(true);
    closeGate(); emit(); readyResolve();
  } catch (e) { gate(`<h1 style="margin-top:22px">Couldn't start</h1>${errLine(e.message)}<div class="form-actions" style="margin-top:16px"><button class="btn" onclick="location.reload()">Try again</button></div>`); }
}

async function startDemo() { S.mode = 'demo'; await boot({ demo: true }); }

function signOut() {
  try { S.token && google.accounts.oauth2.revoke(S.token, () => {}); } catch (e) {}
  S.dirty = false; location.hash = ''; location.reload();
}

function changePassphraseDialog(afterRecovery) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-bg"><div class="modal"><h2>${afterRecovery ? 'Set a new passphrase' : 'Change passphrase'}</h2>
    <p class="soft small" style="margin-top:6px">${afterRecovery ? 'You unlocked with your recovery key. Choose a new passphrase for next time; your recovery key keeps working.' : 'Your recovery key keeps working.'}</p>
    <form class="form" style="margin-top:14px"><label>New passphrase<input name="p1" type="password" minlength="10" required autofocus></label><label>Repeat it<input name="p2" type="password" required></label><div class="small bad" id="cp-err"></div>
    <div class="form-actions"><button type="button" class="btn" id="cp-cancel">${afterRecovery ? 'Later' : 'Cancel'}</button><button class="btn primary">Save</button></div></form></div></div>`;
  const close = () => { root.innerHTML = ''; };
  $('#cp-cancel', root).onclick = close;
  $('form', root).onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    if (f.get('p1') !== f.get('p2')) { $('#cp-err', root).textContent = 'They don\'t match.'; return; }
    S.header = await VaultCrypto.rewrapPassphrase(S.dek, S.header, f.get('p1'));
    await saveNow(true); close();
  };
  $('[autofocus]', root)?.focus();
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

window.LedgerBackend = {
  ready, request, status, onStatus: (fn) => window.addEventListener('ledger:status', (e) => fn(e.detail)),
  relay: () => S.relay,
  saveNow: () => saveNow(true),
  lock: () => { if (S.dirty) saveNow(true).finally(() => location.reload()); else location.reload(); },
  signOut, changePassphrase: () => changePassphraseDialog(false), download,
  downloadBackup: async () => download(`ledger-backup-${new Date().toISOString().slice(0, 10)}.vault.json`, await VaultCrypto.seal(S.dek, S.header, await call({ type: 'export' })), 'application/json'),
  deleteVault: async () => { if (S.fileId) await gfetch(`${DRIVE}/files/${S.fileId}`, { method: 'DELETE' }); S.dirty = false; signOut(); },
};

// kick off: start loading Python in the background while the person reads the welcome screen
call({ type: 'warm', base: BASE }).catch(() => {});
welcome();
})();
