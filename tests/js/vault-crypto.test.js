// Run: node --test tests/js
const test = require('node:test');
const assert = require('node:assert');
const V = require('../../web/vault-crypto.js');

test('create, seal and open with passphrase and recovery key', async () => {
  const { dek, header, recoveryKey } = await V.create('correct horse battery');
  assert.match(recoveryKey, /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);
  const data = new TextEncoder().encode('SQLite format 3\u0000 hello');
  const sealed = await V.seal(dek, header, data);
  assert.ok(!sealed.includes('hello'));
  const a = await V.open(sealed, 'correct horse battery');
  assert.deepStrictEqual(Buffer.from(a.bytes), Buffer.from(data));
  const b = await V.open(sealed, recoveryKey.toLowerCase().replace(/-/g, ' '), { recovery: true });
  assert.deepStrictEqual(Buffer.from(b.bytes), Buffer.from(data));
});

test('wrong passphrase is rejected and tampering is detected', async () => {
  const { dek, header } = await V.create('pw-one-123456');
  const sealed = await V.seal(dek, header, new Uint8Array([1, 2, 3]));
  await assert.rejects(V.open(sealed, 'pw-two-123456'), /WRONG_SECRET/);
  const env = JSON.parse(sealed);
  const d = Buffer.from(env.data, 'base64'); d[0] ^= 1; env.data = d.toString('base64');
  await assert.rejects(V.open(JSON.stringify(env), 'pw-one-123456'));
});

test('changing the passphrase keeps data and recovery key working', async () => {
  const { dek, header, recoveryKey } = await V.create('old-passphrase');
  const h2 = await V.rewrapPassphrase(dek, header, 'new-passphrase');
  const sealed = await V.seal(dek, h2, new Uint8Array([9, 9]));
  await assert.rejects(V.open(sealed, 'old-passphrase'), /WRONG_SECRET/);
  assert.deepStrictEqual([...(await V.open(sealed, 'new-passphrase')).bytes], [9, 9]);
  assert.deepStrictEqual([...(await V.open(sealed, recoveryKey, { recovery: true })).bytes], [9, 9]);
});

test('each save uses a fresh IV', async () => {
  const { dek, header } = await V.create('pw-pw-pw-pw');
  const a = JSON.parse(await V.seal(dek, header, new Uint8Array([1])));
  const b = JSON.parse(await V.seal(dek, header, new Uint8Array([1])));
  assert.notStrictEqual(a.iv, b.iv);
});
