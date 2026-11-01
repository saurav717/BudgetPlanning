// End-to-end test of the static site: Google sign-in, encrypted Drive vault, in-browser Python, relay.
// Needs: python scripts/build_web.py (with LEDGER_GOOGLE_CLIENT_ID=test-client) and node tests/e2e/host.mjs 8799
// Run:   node tests/e2e/browser.e2e.cjs [screenshot-dir]
const { chromium } = require('playwright');
const fs = require('fs');
const assert = require('assert');
const BASE = process.env.E2E_URL || 'http://127.0.0.1:8799/';
const SHOTS = process.argv[2];
const PASS = 'correct horse battery staple';
const HDFC = fs.readFileSync(__dirname + '/../../sample_data/hdfc_savings.csv', 'utf8');

// ---- fake Google Drive (appDataFolder), shared across page loads ----
const drive = { files: new Map(), seq: 0, writes: 0 };
const now = () => new Date(Date.now() + drive.writes).toISOString();
async function driveRoute(route) {
  const req = route.request(), url = new URL(req.url()), m = req.method();
  const ok = (body, ct = 'application/json') => route.fulfill({ status: 200, contentType: ct, body: typeof body === 'string' ? body : JSON.stringify(body) });
  if (req.headers()['authorization'] !== 'Bearer tok-alice') return route.fulfill({ status: 401, body: '{}' });
  if (url.pathname === '/oauth2/v3/userinfo') return ok({ sub: '42', email: 'alice@example.com', given_name: 'Saurav', name: 'Saurav C' });
  if (url.pathname === '/drive/v3/files' && m === 'GET') {
    assert.strictEqual(url.searchParams.get('spaces'), 'appDataFolder');
    return ok({ files: [...drive.files.values()].map(f => ({ id: f.id, modifiedTime: f.modifiedTime, size: String(f.content.length) })) });
  }
  let mm;
  if ((mm = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/))) {
    const f = drive.files.get(mm[1]);
    if (m === 'DELETE') { drive.files.delete(mm[1]); return route.fulfill({ status: 204, body: '' }); }
    if (!f) return route.fulfill({ status: 404, body: '{}' });
    if (url.searchParams.get('alt') === 'media') return ok(f.content);
    return ok({ id: f.id, modifiedTime: f.modifiedTime });
  }
  if (url.pathname === '/upload/drive/v3/files' && m === 'POST') {
    const body = req.postData(); const parts = body.split(/--ledger[a-z0-9]+/);
    const meta = JSON.parse(parts[1].split('\r\n\r\n')[1]); const content = parts[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
    assert.deepStrictEqual(meta.parents, ['appDataFolder']);
    const id = 'f' + (++drive.seq); drive.writes++;
    drive.files.set(id, { id, content, modifiedTime: now() });
    return ok({ id, modifiedTime: drive.files.get(id).modifiedTime });
  }
  if ((mm = url.pathname.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/)) && m === 'PATCH') {
    const f = drive.files.get(mm[1]); drive.writes++; f.content = req.postData(); f.modifiedTime = now();
    return ok({ id: f.id, modifiedTime: f.modifiedTime });
  }
  return route.fulfill({ status: 404, body: '{"unmocked":"' + url.pathname + '"}' });
}
const FAKE_GIS = `window.google = { accounts: { oauth2: {
  initTokenClient: (cfg) => ({ requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: 'tok-alice', expires_in: 3600 }), 10) }),
  revoke: (t, cb) => cb && cb() } } };`;

(async () => {
  const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  await ctx.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_GIS }));
  await ctx.route('https://www.googleapis.com/**', driveRoute);
  await ctx.route('https://cdn.plaid.com/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|beforeunload/i.test(m.text())) errors.push(m.text()); });
  const shot = async (n, full = false) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });
  const backend = (method, path, body) => page.evaluate(([m, p, b]) => window.LedgerBackend.request(m, p, '', b == null ? null : JSON.stringify(b)), [method, path, body]);
  const waitSaved = () => page.waitForFunction(() => { const s = window.LedgerBackend.status(); return s.mode === 'drive' && !s.dirty && !s.saving && s.lastSaved; }, null, { timeout: 30000 });
  const step = (t) => console.log('•', t);

  step('welcome screen');
  await page.goto(BASE); await page.waitForSelector('#g-signin'); await shot('e2e_01_welcome');

  step('sign in -> no vault -> create one');
  await page.click('#g-signin'); await page.waitForSelector('input[name=p1]');
  await page.fill('input[name=p1]', PASS); await page.fill('input[name=p2]', PASS); await page.check('input[name=demo]');
  await shot('e2e_02_create');
  await page.click('#g-form button.primary'); await page.waitForSelector('#g-key');
  const recovery = (await page.textContent('#g-key')).trim();
  assert.match(recovery, /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);
  await shot('e2e_03_recovery');
  await page.check('#g-ok'); await page.click('#g-next');

  step('engine boots with sample data and saves an encrypted vault to Drive');
  await page.waitForSelector('#onb', { timeout: 90000 });  // first-run profile questions
  await waitSaved();
  assert.strictEqual(drive.files.size, 1);
  const stored = [...drive.files.values()][0].content;
  const env = JSON.parse(stored);
  assert.strictEqual(env.format, 'ledger-vault'); assert.ok(env.wraps.passphrase && env.wraps.recovery);
  for (const plain of ['Saurav', 'Swiggy', 'Netflix', 'Everyday Checking', 'SQLite format']) assert.ok(!stored.includes(plain), 'plaintext leaked: ' + plain);
  assert.strictEqual(await page.inputValue('#onb [name=name]'), 'Saurav');   // name prefilled from Google
  await page.selectOption('#onb [name=second_currency]', 'INR');
  await page.click('#onb button.primary'); await page.click('#onb button.primary');
  await page.click('#onb label:has(input[value=support_family])'); await page.click('#onb label:has(input[value=emergency_fund])');
  await page.click('#onb button.primary');
  await page.waitForSelector('.hero h1'); await page.waitForTimeout(1200);
  assert.match(await page.textContent('.hero h1'), /Saurav/);
  await waitSaved(); await shot('e2e_04_dashboard', true);

  step('import an HDFC statement into a new INR account');
  const acct = JSON.parse((await backend('POST', '/api/accounts', { name: 'HDFC Savings', type: 'savings', currency: 'INR', balance: 176198.10 })).body);
  const imp = JSON.parse((await backend('POST', '/api/import-text', { account_id: acct.id, profile: 'auto', text: HDFC })).body);
  assert.strictEqual(imp.profile, 'india'); assert.strictEqual(imp.imported, 10); assert.deepStrictEqual(imp.errors, []);
  await waitSaved();

  step('connect a (sandbox) bank through the Cloudflare relay');
  const link = await backend('POST', '/api/plaid/sandbox-link', {});
  assert.strictEqual(link.status, 200, link.body);
  const linked = JSON.parse(link.body);
  assert.strictEqual(linked.institution, 'First Platypus Bank'); assert.strictEqual(linked.sync.added, 2);
  const stats = await (await page.request.get(BASE + 'relay/stats')).json();
  assert.strictEqual(stats.connections, 1); assert.strictEqual(stats.users, 1);
  await waitSaved();
  const vaultAfter = [...drive.files.values()][0].content;
  assert.ok(!vaultAfter.includes('access-sandbox'), 'Plaid token must only exist inside the encrypted vault');

  step('settings & import screens');
  await page.goto(BASE + '#settings?tab=connections'); await page.waitForTimeout(1500); await shot('e2e_05_connections', true);
  await page.goto(BASE + '#settings?tab=data'); await page.waitForTimeout(1200); await shot('e2e_06_vault_settings');
  await page.goto(BASE + '#transparency'); await page.waitForTimeout(1500); await shot('e2e_07_transparency', true);

  step('reload: wrong passphrase rejected, right one restores everything');
  await page.goto(BASE); await page.click('#g-signin'); await page.waitForSelector('input[name=secret]');
  await shot('e2e_08_unlock');
  await page.fill('input[name=secret]', 'not my passphrase'); await page.click('#g-form button.primary');
  await page.waitForSelector('text=That passphrase doesn\'t match');
  await page.fill('input[name=secret]', PASS); await page.click('#g-form button.primary');
  await page.waitForSelector('.hero h1', { timeout: 90000 });
  const accts = JSON.parse((await backend('GET', '/api/accounts')).body);
  assert.ok(accts.some(a => a.name === 'HDFC Savings' && a.currency === 'INR'));
  assert.ok(accts.some(a => a.name.startsWith('Plaid Checking')));
  const prof = JSON.parse((await backend('GET', '/api/profile')).body);
  assert.strictEqual(prof.second_currency, 'INR');

  step('a sync after reload still works (token stored in the vault, relay checks ownership)');
  const sync = await backend('POST', '/api/plaid/sync', {});
  assert.strictEqual(sync.status, 200, sync.body);
  assert.ok(!JSON.parse(sync.body).results[0].error, sync.body);

  step('conflict detection when another device saved first');
  const f = [...drive.files.values()][0]; f.modifiedTime = '2099-01-01T00:00:00.000Z';
  await backend('PUT', '/api/profile', { name: 'Changed here' });
  await page.waitForSelector('text=Changed on another device', { timeout: 15000 });
  await shot('e2e_09_conflict');
  await page.click('#g-overwrite'); await waitSaved();

  step('recovery key unlock, then set a new passphrase');
  await page.goto(BASE); await page.click('#g-signin'); await page.waitForSelector('input[name=secret]');
  await page.click('#g-alt'); await page.fill('input[name=secret]', recovery.toLowerCase());
  await page.click('#g-form button.primary');
  await page.waitForSelector('text=Set a new passphrase', { timeout: 90000 });
  await page.fill('#modal-root input[name=p1]', 'brand new passphrase'); await page.fill('#modal-root input[name=p2]', 'brand new passphrase');
  await page.click('#modal-root button.primary'); await waitSaved();
  await page.goto(BASE); await page.click('#g-signin'); await page.waitForSelector('input[name=secret]');
  await page.fill('input[name=secret]', 'brand new passphrase'); await page.click('#g-form button.primary');
  await page.waitForSelector('.hero h1', { timeout: 90000 });

  step('demo mode saves nothing');
  const before = drive.writes;
  const demo = await ctx.newPage(); demo.on('pageerror', e => errors.push(e.message));
  await demo.goto(BASE); await demo.click('#g-demo'); await demo.waitForSelector('#onb, .hero h1', { timeout: 90000 });
  await demo.evaluate(() => window.LedgerBackend.request('PUT', '/api/profile', '', JSON.stringify({ name: 'Demo', onboarded: true })));
  await demo.waitForTimeout(2500);
  assert.strictEqual(drive.writes, before);

  assert.deepStrictEqual(errors, [], 'browser errors:\n' + errors.join('\n'));
  console.log('E2E PASSED');
  await browser.close();
})().catch(async (e) => { console.error('E2E FAILED:', e); process.exit(1); });
