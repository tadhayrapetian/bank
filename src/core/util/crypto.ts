/** WebCrypto wrappers: password/PIN hashing (PBKDF2), ECDSA signatures, TOTP. */
import { randomCode } from './random';

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function newSalt(): string {
  return randomCode(16);
}

/** PBKDF2-SHA256. Iterations are kept moderate so demo seeding stays fast. */
export async function hashSecret(secret: string, salt: string, iterations = 20000): Promise<string> {
  const key = await subtle().importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations },
    key,
    256,
  );
  return b64(bits);
}

export async function verifySecret(secret: string, salt: string, hash: string): Promise<boolean> {
  return (await hashSecret(secret, salt)) === hash;
}

export async function sha256Async(text: string): Promise<string> {
  const d = await subtle().digest('SHA-256', enc.encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ── ECDSA P-256 document signatures ── */

export async function generateSigningKeys(): Promise<{ publicKey: JsonWebKey; privateKey: JsonWebKey }> {
  const pair = (await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKey = await subtle().exportKey('jwk', pair.publicKey);
  const privateKey = await subtle().exportKey('jwk', pair.privateKey);
  return { publicKey, privateKey };
}

export async function signText(privateJwk: JsonWebKey, text: string): Promise<string> {
  const key = await subtle().importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(text));
  return b64(sig);
}

export async function verifyText(publicJwk: JsonWebKey, text: string, signature: string): Promise<boolean> {
  try {
    const key = await subtle().importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64(signature) as BufferSource, enc.encode(text));
  } catch {
    return false;
  }
}

export function keyFingerprint(jwk: JsonWebKey): string {
  const x = (jwk.x ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (x.slice(0, 4) + ':' + x.slice(4, 8) + ':' + x.slice(8, 12) + ':' + x.slice(12, 16)) || 'N/A';
}

/* ── TOTP (RFC 6238) for the 2FA simulation ── */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret(): string {
  return randomCode(16, B32);
}

function base32Decode(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '').toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export async function totp(secret: string, atMs: number, step = 30): Promise<string> {
  const counter = Math.floor(atMs / 1000 / step);
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setUint32(0, Math.floor(counter / 0x100000000));
  dv.setUint32(4, counter >>> 0);
  const key = await subtle().importKey('raw', base32Decode(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await subtle().sign('HMAC', key, buf));
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

export async function verifyTotp(secret: string, code: string, atMs: number): Promise<boolean> {
  for (const drift of [0, -1, 1]) {
    if ((await totp(secret, atMs + drift * 30_000)) === code.trim()) return true;
  }
  return false;
}
