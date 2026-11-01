/**
 * Ledger's Cloudflare Worker.
 *
 *  - Serves the static web app (dist/) via the ASSETS binding.
 *  - /relay/plaid/*  Forwards a fixed list of Plaid API calls, adding the project's Plaid keys.
 *                    Callers must be signed in with Google through this app.
 *  - /relay/config   Public: what the relay offers (used by the web app).
 *  - /relay/stats    Public: aggregate usage, so funders can see what the money pays for.
 *  - /relay/admin/usage  Admins only: per-user connection counts (hashed ids, no names or emails).
 *
 * What the relay keeps (Workers KV, binding LEDGER_KV): for each bank connection, a hash of its Plaid
 * access token -> the hashed Google user id that created it, plus counters. No transactions, balances,
 * names or emails are stored, and nothing is logged. Bank data does pass through in memory while a sync runs.
 *
 * Configuration (wrangler.toml [vars] and `wrangler secret put`):
 *   PLAID_CLIENT_ID, PLAID_SECRET   secrets, the project's Plaid keys
 *   PLAID_ENV                       sandbox | production
 *   GOOGLE_CLIENT_ID                OAuth client the web app uses; tokens for other apps are rejected
 *   USER_SALT                       secret, salts the user-id hash
 *   MAX_ITEMS_PER_USER              bank connections per person (default 3), caps what each user can cost
 *   ALLOWED_EMAILS                  optional comma list; empty = any verified Google account
 *   ADMIN_EMAILS                    comma list allowed to read /relay/admin/usage
 */

const PLAID_HOSTS = { sandbox: 'https://sandbox.plaid.com', production: 'https://production.plaid.com' };

// The only Plaid endpoints the app may call, and the check each one gets.
const ROUTES = {
  '/link/token/create': 'link',
  '/item/public_token/exchange': 'exchange',
  '/sandbox/public_token/create': 'sandbox',
  '/institutions/get_by_id': 'open',
  '/item/get': 'owned',
  '/accounts/get': 'owned',
  '/accounts/balance/get': 'owned',
  '/transactions/sync': 'owned',
  '/investments/holdings/get': 'owned',
  '/item/remove': 'remove',
};
const ALLOWED_PRODUCTS = new Set(['transactions', 'investments', 'liabilities']);

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
const err = (status, code, message) => json({ error_code: code, error_message: message }, status);
const list = (s) => String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------- auth ----------------
const tokenCache = new Map();  // per-isolate cache so a sync's many calls verify the token once
async function verifyGoogle(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return { error: err(401, 'UNAUTHENTICATED', 'Sign in with Google first.') };
  const cached = tokenCache.get(token);
  let info = cached && cached.until > Date.now() ? cached.info : null;
  if (!info) {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token));
    if (!r.ok) return { error: err(401, 'INVALID_TOKEN', 'Your Google session expired. Sign in again.') };
    info = await r.json();
    tokenCache.set(token, { info, until: Date.now() + 5 * 60e3 });
    if (tokenCache.size > 5000) tokenCache.clear();
  }
  if (env.GOOGLE_CLIENT_ID && info.aud !== env.GOOGLE_CLIENT_ID && info.azp !== env.GOOGLE_CLIENT_ID)
    return { error: err(403, 'WRONG_APP', 'This token was issued to a different app.') };
  const email = String(info.email || '').toLowerCase();
  if (!email || String(info.email_verified) !== 'true') return { error: err(403, 'EMAIL_REQUIRED', 'A verified Google email is required.') };
  const allowed = list(env.ALLOWED_EMAILS);
  if (allowed.length && !allowed.includes(email)) return { error: err(403, 'NOT_INVITED', 'Bank connections are invite-only on this deployment. Ask an admin to add you.') };
  const uid = await sha256(`${env.USER_SALT || ''}:${info.sub || email}`);
  return { user: { uid, email, admin: list(env.ADMIN_EMAILS).includes(email) } };
}

// ---------------- KV bookkeeping ----------------
async function getJSON(kv, key, fallback) { const v = await kv.get(key); return v ? JSON.parse(v) : fallback; }
async function bumpStats(kv, dUsers, dConnections) {
  const s = await getJSON(kv, 'stats', { users: 0, connections: 0, connections_created: 0 });
  s.users = Math.max(0, s.users + dUsers);
  s.connections = Math.max(0, s.connections + dConnections);
  if (dConnections > 0) s.connections_created += dConnections;
  s.updated = new Date().toISOString();
  await kv.put('stats', JSON.stringify(s));
}

// ---------------- plaid relay ----------------
async function plaid(request, env, path) {
  const kind = ROUTES[path];
  if (!kind) return err(404, 'NOT_ALLOWED', `Plaid endpoint ${path} is not available through this relay.`);
  if (request.method !== 'POST') return err(405, 'METHOD', 'POST only');
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) return err(503, 'NOT_CONFIGURED', 'Bank connections are not set up on this deployment.');
  const kv = env.LEDGER_KV;
  if (!kv && env.ALLOW_NO_KV !== 'true') return err(503, 'NO_STORAGE', 'Relay storage (LEDGER_KV) is not configured.');
  const { user, error } = await verifyGoogle(request, env);
  if (error) return error;
  let body;
  try { body = await request.json(); } catch (e) { return err(400, 'BAD_JSON', 'Body must be JSON.'); }
  delete body.client_id; delete body.secret;

  const userKey = `user:${user.uid}`;
  const record = kv ? await getJSON(kv, userKey, null) : null;
  const items = record ? record.items : [];
  const max = parseInt(env.MAX_ITEMS_PER_USER || '3', 10);
  let tokenHash = null;

  if (kind === 'link') {
    body.user = { client_user_id: user.uid };   // never trust the client's idea of who it is
    body.client_name = env.APP_NAME || 'Ledger';
    delete body.webhook;
    if (!body.access_token) {                    // a new connection (update mode re-auths an existing one)
      if (kv && items.length >= max) return err(403, 'LIMIT_REACHED', `You've connected ${items.length} of ${max} banks allowed per person on this deployment. Remove one first, or import a statement instead.`);
      body.products = (body.products || ['transactions']).filter(p => ALLOWED_PRODUCTS.has(p));
      body.optional_products = (body.optional_products || []).filter(p => ALLOWED_PRODUCTS.has(p));
    }
  }
  if (kind === 'sandbox' && (env.PLAID_ENV || 'sandbox') !== 'sandbox') return err(403, 'SANDBOX_ONLY', 'Only available in sandbox.');
  if (kind === 'owned' || kind === 'remove' || (kind === 'link' && body.access_token)) {
    if (typeof body.access_token !== 'string') return err(400, 'MISSING_TOKEN', 'access_token required');
    tokenHash = await sha256(body.access_token);
    if (kv) {
      const owner = await kv.get(`item:${tokenHash}`);
      if (owner !== user.uid) return err(403, 'NOT_YOURS', 'That bank connection belongs to a different account.');
    }
  }

  const host = PLAID_HOSTS[env.PLAID_ENV || 'sandbox'] || PLAID_HOSTS.sandbox;
  const r = await fetch(host + path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, client_id: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET }) });
  const text = await r.text();

  if (r.ok && kv) {
    if (kind === 'exchange') {
      const data = JSON.parse(text);
      const h = await sha256(data.access_token);
      await kv.put(`item:${h}`, user.uid);
      await kv.put(userKey, JSON.stringify({ items: [...items, h], since: record?.since || new Date().toISOString() }));
      await bumpStats(kv, record ? 0 : 1, 1);
    } else if (kind === 'remove') {
      await kv.delete(`item:${tokenHash}`);
      const left = items.filter(x => x !== tokenHash);
      await kv.put(userKey, JSON.stringify({ items: left, since: record?.since }));
      await bumpStats(kv, 0, -1);
    }
  }
  return new Response(text, { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

// ---------------- routes ----------------
async function relay(request, env, url) {
  const path = url.pathname.replace(/^\/relay/, '');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (path === '/config') return json({
    plaid: !!(env.PLAID_CLIENT_ID && env.PLAID_SECRET), plaid_env: env.PLAID_ENV || 'sandbox',
    max_items_per_user: parseInt(env.MAX_ITEMS_PER_USER || '3', 10), invite_only: list(env.ALLOWED_EMAILS).length > 0 });
  if (path === '/stats') {
    const s = env.LEDGER_KV ? await getJSON(env.LEDGER_KV, 'stats', null) : null;
    return json(s || { users: 0, connections: 0, connections_created: 0, updated: null }, 200, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' });
  }
  if (path === '/admin/usage') {
    const { user, error } = await verifyGoogle(request, env);
    if (error) return error;
    if (!user.admin) return err(403, 'ADMINS_ONLY', 'Admins only.');
    const out = [];
    if (env.LEDGER_KV) {
      let cursor;
      do {
        const page = await env.LEDGER_KV.list({ prefix: 'user:', cursor });
        for (const k of page.keys) { const v = await getJSON(env.LEDGER_KV, k.name, { items: [] }); out.push({ user: k.name.slice(5, 17), connections: v.items.length, since: v.since }); }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
    }
    return json({ users: out, stats: env.LEDGER_KV ? await getJSON(env.LEDGER_KV, 'stats', null) : null });
  }
  if (path.startsWith('/plaid/')) return plaid(request, env, path.slice('/plaid'.length));
  return err(404, 'NOT_FOUND', 'Unknown relay path');
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',  // Google sign-in and Plaid Link use popups
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/relay/')) {
        const res = await relay(request, env, url);
        for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
        return res;
      }
      const asset = await env.ASSETS.fetch(request);
      const res = new Response(asset.body, asset);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
      if (url.pathname.endsWith('.js') || url.pathname.endsWith('.zip') || url.pathname.endsWith('.whl') || url.pathname === '/' || url.pathname.endsWith('.html'))
        res.headers.set('Cache-Control', 'no-cache');  // always revalidate app code so updates roll out immediately
      return res;
    } catch (e) {
      return err(500, 'RELAY_ERROR', 'Something went wrong in the relay.');
    }
  },
};
export { ROUTES };
