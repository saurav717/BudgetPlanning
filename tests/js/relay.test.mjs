// Run: node --test tests/js
import test from 'node:test';
import assert from 'node:assert';
import worker from '../../relay/src/index.js';

class KV {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix }) { return { keys: [...this.m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
}
const USERS = { 'tok-alice': { email: 'alice@example.com', sub: '1' }, 'tok-bob': { email: 'bob@example.com', sub: '2' }, 'tok-other-app': { email: 'eve@example.com', sub: '3', aud: 'someone-else' } };
let plaidCalls = [];
let tokenSeq = 0;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
    const t = decodeURIComponent(url.split('access_token=')[1]);
    const u = USERS[t];
    if (!u) return new Response('{}', { status: 400 });
    return new Response(JSON.stringify({ aud: u.aud || 'client-123', email: u.email, email_verified: 'true', sub: u.sub }));
  }
  if (url.startsWith('https://sandbox.plaid.com')) {
    const body = JSON.parse(opts.body);
    plaidCalls.push({ path: new URL(url).pathname, body });
    const path = new URL(url).pathname;
    if (path === '/item/public_token/exchange') return new Response(JSON.stringify({ access_token: `access-sandbox-${++tokenSeq}`, item_id: 'i' + tokenSeq }));
    return new Response(JSON.stringify({ ok: true, path }));
  }
  throw new Error('unexpected fetch ' + url);
};
const mkEnv = (over = {}) => ({ PLAID_CLIENT_ID: 'cid', PLAID_SECRET: 'sec', PLAID_ENV: 'sandbox', GOOGLE_CLIENT_ID: 'client-123', USER_SALT: 's', MAX_ITEMS_PER_USER: '2', ADMIN_EMAILS: 'alice@example.com', LEDGER_KV: new KV(), ASSETS: { fetch: async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }) }, ...over });
const call = (env, path, token, body) => worker.fetch(new Request('https://ledger.example' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);

test('public config and stats', async () => {
  const env = mkEnv();
  const c = await (await call(env, '/relay/config')).json();
  assert.deepStrictEqual(c, { plaid: true, plaid_env: 'sandbox', max_items_per_user: 2, invite_only: false });
  const s = await call(env, '/relay/stats');
  assert.strictEqual(s.headers.get('Access-Control-Allow-Origin'), '*');
});

test('requires a Google token for this app', async () => {
  const env = mkEnv();
  assert.strictEqual((await call(env, '/relay/plaid/link/token/create', null, {})).status, 401);
  assert.strictEqual((await call(env, '/relay/plaid/link/token/create', 'tok-bogus', {})).status, 401);
  assert.strictEqual((await call(env, '/relay/plaid/link/token/create', 'tok-other-app', {})).status, 403);
});

test('injects keys and forces the user id; blocks unknown endpoints', async () => {
  const env = mkEnv(); plaidCalls = [];
  const r = await call(env, '/relay/plaid/link/token/create', 'tok-alice', { user: { client_user_id: 'spoofed' }, products: ['transactions', 'auth'], webhook: 'https://evil' });
  assert.strictEqual(r.status, 200);
  const sent = plaidCalls[0].body;
  assert.strictEqual(sent.client_id, 'cid'); assert.strictEqual(sent.secret, 'sec');
  assert.notStrictEqual(sent.user.client_user_id, 'spoofed'); assert.match(sent.user.client_user_id, /^[0-9a-f]{64}$/);
  assert.deepStrictEqual(sent.products, ['transactions']); assert.strictEqual(sent.webhook, undefined);
  assert.strictEqual((await call(env, '/relay/plaid/transfer/create', 'tok-alice', {})).status, 404);
  assert.strictEqual((await call(env, '/relay/plaid/processor/token/create', 'tok-alice', {})).status, 404);
});

test('ownership: only the creator can use an access token', async () => {
  const env = mkEnv();
  const ex = await (await call(env, '/relay/plaid/item/public_token/exchange', 'tok-alice', { public_token: 'p' })).json();
  assert.strictEqual((await call(env, '/relay/plaid/transactions/sync', 'tok-alice', { access_token: ex.access_token })).status, 200);
  assert.strictEqual((await call(env, '/relay/plaid/transactions/sync', 'tok-bob', { access_token: ex.access_token })).status, 403);
  assert.strictEqual((await call(env, '/relay/plaid/accounts/get', 'tok-alice', { access_token: 'access-made-up' })).status, 403);
});

test('per-user connection cap, removal frees a slot, stats and admin view', async () => {
  const env = mkEnv();
  const a = await (await call(env, '/relay/plaid/item/public_token/exchange', 'tok-alice', { public_token: 'p' })).json();
  await call(env, '/relay/plaid/item/public_token/exchange', 'tok-alice', { public_token: 'p' });
  const blocked = await call(env, '/relay/plaid/link/token/create', 'tok-alice', {});
  assert.strictEqual(blocked.status, 403); assert.strictEqual((await blocked.json()).error_code, 'LIMIT_REACHED');
  // update mode for an existing connection is still allowed at the cap
  assert.strictEqual((await call(env, '/relay/plaid/link/token/create', 'tok-alice', { access_token: a.access_token })).status, 200);
  assert.strictEqual((await call(env, '/relay/plaid/item/remove', 'tok-alice', { access_token: a.access_token })).status, 200);
  assert.strictEqual((await call(env, '/relay/plaid/link/token/create', 'tok-alice', {})).status, 200);
  await call(env, '/relay/plaid/item/public_token/exchange', 'tok-bob', { public_token: 'p' });
  const stats = await (await call(env, '/relay/stats')).json();
  assert.strictEqual(stats.users, 2); assert.strictEqual(stats.connections, 2); assert.strictEqual(stats.connections_created, 3);
  assert.strictEqual((await call(env, '/relay/admin/usage', 'tok-bob')).status, 403);
  const admin = await (await call(env, '/relay/admin/usage', 'tok-alice')).json();
  assert.strictEqual(admin.users.length, 2);
  assert.ok(!JSON.stringify(admin).includes('@'), 'no emails in admin view');
  assert.ok(![...env.LEDGER_KV.m.values()].join().includes('access-sandbox'), 'no raw access tokens stored');
});

test('invite-only mode and missing config', async () => {
  assert.strictEqual((await call(mkEnv({ ALLOWED_EMAILS: 'alice@example.com' }), '/relay/plaid/link/token/create', 'tok-bob', {})).status, 403);
  assert.strictEqual((await call(mkEnv({ PLAID_SECRET: '' }), '/relay/plaid/link/token/create', 'tok-alice', {})).status, 503);
  assert.strictEqual((await call(mkEnv({ LEDGER_KV: undefined }), '/relay/plaid/link/token/create', 'tok-alice', {})).status, 503);
  assert.strictEqual((await call(mkEnv({ PLAID_ENV: 'production' }), '/relay/plaid/sandbox/public_token/create', 'tok-alice', {})).status, 403);
});

test('serves assets with security headers', async () => {
  const r = await call(mkEnv(), '/');
  assert.strictEqual(r.headers.get('X-Frame-Options'), 'DENY');
  assert.strictEqual(await r.text(), '<html>');
});
