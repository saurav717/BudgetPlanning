/* Ledger vault encryption (runs in browsers and in Node >= 20 for tests).

   A random 256-bit data key (DEK) encrypts the SQLite database with AES-GCM.
   The DEK is stored twice, wrapped (AES-GCM) by keys derived with PBKDF2-SHA256 from:
     - the user's passphrase
     - a random recovery key shown once at setup
   So either one unlocks the vault, changing the passphrase only re-wraps the DEK, and the
   file in Google Drive is useless to Google, the Ledger admins, or anyone without one of them. */
(function (root) {
  'use strict';
  const subtle = (root.crypto || globalThis.crypto).subtle;
  const rand = (n) => (root.crypto || globalThis.crypto).getRandomValues(new Uint8Array(n));
  const enc = new TextEncoder();
  const ITER = 600000;  // OWASP 2023 guidance for PBKDF2-SHA256
  const FORMAT = 'ledger-vault';

  const b64 = (u8) => { let s = ''; const c = 0x8000; for (let i = 0; i < u8.length; i += c) s += String.fromCharCode.apply(null, u8.subarray(i, i + c)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no 0/O/1/I to avoid misreading
  function newRecoveryKey() {
    // 160 random bits, base32-encoded into 32 characters, grouped for readability: ABCD-EFGH-...
    const bytes = rand(20);
    let bits = 0, acc = 0, out = '';
    for (const b of bytes) {
      acc = (acc << 8) | b; bits += 8;
      while (bits >= 5) { out += B32[(acc >> (bits - 5)) & 31]; bits -= 5; }
      acc &= (1 << bits) - 1;
    }
    return out.match(/.{4}/g).join('-');
  }
  const normRecovery = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normPass = (s) => String(s).normalize('NFKC');

  async function kek(secret, salt, iter) {
    const base = await subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
  }
  async function wrap(dek, secret, iter = ITER) {
    const salt = rand(16), iv = rand(12);
    const key = new Uint8Array(await subtle.wrapKey('raw', dek, await kek(secret, salt, iter), { name: 'AES-GCM', iv }));
    return { salt: b64(salt), iv: b64(iv), key: b64(key), iter };
  }
  async function unwrap(w, secret) {
    const k = await kek(secret, unb64(w.salt), w.iter || ITER);
    return subtle.unwrapKey('raw', unb64(w.key), k, { name: 'AES-GCM', iv: unb64(w.iv) }, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  }

  /** New vault: returns { dek, header, recoveryKey } */
  async function create(passphrase) {
    const dek = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const recoveryKey = newRecoveryKey();
    const header = { format: FORMAT, v: 1, created: new Date().toISOString(), cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256',
      wraps: { passphrase: await wrap(dek, normPass(passphrase)), recovery: await wrap(dek, normRecovery(recoveryKey)) } };
    return { dek, header, recoveryKey };
  }

  /** Encrypt database bytes into the JSON envelope stored in Drive. */
  async function seal(dek, header, bytes) {
    const iv = rand(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(FORMAT + ':v1') }, dek, bytes));
    return JSON.stringify({ ...header, saved: new Date().toISOString(), iv: b64(iv), data: b64(ct) });
  }

  /** Unlock with a passphrase or recovery key. Returns { dek, header, bytes }. Throws 'WRONG_SECRET' if neither matches. */
  async function open(text, secret, { recovery = false } = {}) {
    const env = typeof text === 'string' ? JSON.parse(text) : text;
    if (env.format !== FORMAT) throw new Error('Not a Ledger vault file');
    let dek;
    try { dek = await unwrap(recovery ? env.wraps.recovery : env.wraps.passphrase, recovery ? normRecovery(secret) : normPass(secret)); }
    catch (e) { throw new Error('WRONG_SECRET'); }
    const bytes = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv), additionalData: enc.encode(FORMAT + ':v1') }, dek, unb64(env.data)));
    const { iv, data, saved, ...header } = env;
    return { dek, header, bytes };
  }

  /** Replace the passphrase wrap (recovery key unchanged). */
  async function rewrapPassphrase(dek, header, newPassphrase) {
    return { ...header, wraps: { ...header.wraps, passphrase: await wrap(dek, normPass(newPassphrase)) } };
  }

  const api = { create, seal, open, rewrapPassphrase, newRecoveryKey, ITER };
  root.VaultCrypto = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
