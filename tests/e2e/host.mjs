// Local stand-in for Cloudflare: serves dist/ through the real Worker code, with Google + Plaid mocked.
// Usage: node tests/e2e/host.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../../relay/src/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.zip': 'application/zip', '.whl': 'application/zip' };
class KV { constructor() { this.m = new Map(); } async get(k) { return this.m.get(k) ?? null; } async put(k, v) { this.m.set(k, v); } async delete(k) { this.m.delete(k); } async list({ prefix }) { return { keys: [...this.m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } }
const env = {
  PLAID_CLIENT_ID: 'cid', PLAID_SECRET: 'sec', PLAID_ENV: 'sandbox', GOOGLE_CLIENT_ID: 'test-client', USER_SALT: 'salt',
  MAX_ITEMS_PER_USER: '3', ADMIN_EMAILS: 'alice@example.com', LEDGER_KV: new KV(),
  ASSETS: { fetch: async (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) return new Response('not found', { status: 404 });
    return new Response(fs.readFileSync(f), { headers: { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' } });
  } },
};
const realFetch = globalThis.fetch;
let seq = 0;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
    const t = decodeURIComponent(url.split('access_token=')[1]);
    return t === 'tok-alice' ? new Response(JSON.stringify({ aud: 'test-client', azp: 'test-client', email: 'alice@example.com', email_verified: 'true', sub: '42' })) : new Response('{}', { status: 400 });
  }
  if (url.startsWith('https://sandbox.plaid.com')) {
    const p = new URL(url).pathname, b = JSON.parse(opts.body || '{}');
    if (b.client_id !== 'cid' || b.secret !== 'sec') return new Response('{"error_code":"INVALID_API_KEYS"}', { status: 400 });
    const R = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
    if (p === '/sandbox/public_token/create') return R({ public_token: 'public-sandbox-1' });
    if (p === '/item/public_token/exchange') return R({ access_token: 'access-sandbox-' + (++seq), item_id: 'item-' + seq });
    if (p === '/item/get') return R({ item: { institution_id: 'ins_109508' } });
    if (p === '/institutions/get_by_id') return R({ institution: { name: 'First Platypus Bank' } });
    if (p === '/accounts/get') return R({ accounts: [
      { account_id: 'pa1', name: 'Plaid Checking', mask: '0000', type: 'depository', subtype: 'checking', balances: { current: 1250.5, iso_currency_code: 'USD' } },
      { account_id: 'pa2', name: 'Plaid Credit Card', mask: '3333', type: 'credit', subtype: 'credit card', balances: { current: 410, iso_currency_code: 'USD' } }] });
    if (p === '/transactions/sync') return R(b.cursor ? { added: [], modified: [], removed: [], next_cursor: b.cursor, has_more: false } : { added: [
      { transaction_id: 'pt1', account_id: 'pa1', amount: 12.5, date: '2026-10-28', name: 'Uber 063015 SF**POOL**', merchant_name: 'Uber', pending: false, personal_finance_category: { primary: 'TRANSPORTATION', detailed: 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES' } },
      { transaction_id: 'pt2', account_id: 'pa2', amount: 89.4, date: '2026-10-29', name: 'SparkFun', merchant_name: 'SparkFun', pending: false, personal_finance_category: { primary: 'GENERAL_MERCHANDISE', detailed: 'GENERAL_MERCHANDISE_ELECTRONICS' } }],
      modified: [], removed: [], next_cursor: 'c1', has_more: false });
    if (p === '/investments/holdings/get') return R({ error_code: 'PRODUCTS_NOT_SUPPORTED', error_message: 'no' }, 400);
    return R({ error_code: 'UNMOCKED', error_message: p }, 400);
  }
  return realFetch(url, opts);
};

const port = +(process.argv[2] || 8799);
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log('host on', port));
