/** Random helpers: cryptographic IDs for records, seeded PRNG for reproducible demo data. */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I, L, O, U)

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function randomCode(len: number, alphabet = ALPHABET): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function randomDigits(len: number): string {
  return randomCode(len, '0123456789');
}

/** Prefixed unique id, e.g. TX-7K2M9Q4ZPA */
export function uid(prefix: string, len = 10): string {
  return `${prefix}-${randomCode(len)}`;
}

/** Verification code: K7Q2-M9XA-P4ZD */
export function verificationCode(): string {
  return `${randomCode(4)}-${randomCode(4)}-${randomCode(4)}`;
}

/** Mulberry32 seeded PRNG */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Standard normal sample from a uniform PRNG (Box–Muller). */
export function gaussian(rand: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

export function luhnCheckDigit(partial: string): number {
  let sum = 0;
  let double = true;
  for (let i = partial.length - 1; i >= 0; i--) {
    let d = Number(partial[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

export function luhnValid(num: string): boolean {
  const digits = num.replace(/\D/g, '');
  if (digits.length < 12) return false;
  return luhnCheckDigit(digits.slice(0, -1)) === Number(digits[digits.length - 1]);
}
