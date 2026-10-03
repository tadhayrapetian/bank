/**
 * Numbering conventions of the Exchequer of Aldermoor (all fictional):
 *  • Account numbers: "XA" realm prefix (never a real IBAN country) + mod-97 check digits
 *    + "AEX" bank code + 3-digit branch + 10-digit serial, e.g. XA27 AEX1 0300 0001 2345
 *  • Card numbers: SIGIL network, BIN 941x (national-use range), Luhn-valid
 *  • References: AEL-2026-10-K7Q2M9 (Aetherline), FX-…, CASE/ARC/2026/00417 …
 */
import { nextCounter } from '../db/db';
import { luhnCheckDigit, randomCode, randomDigits } from '../util/random';
import { now } from '../clock';

function lettersToDigits(s: string): string {
  return s.toUpperCase().replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
}

function mod97(numStr: string): number {
  let rem = 0;
  for (const ch of numStr) rem = (rem * 10 + Number(ch)) % 97;
  return rem;
}

export function accountCheckDigits(bban: string): string {
  const rearranged = lettersToDigits(bban + 'XA00');
  return String(98 - mod97(rearranged)).padStart(2, '0');
}

export function makeAccountNumber(branchNo: number, serial: number): string {
  const bban = `AEX${String(branchNo).padStart(3, '0')}${String(serial).padStart(10, '0')}`;
  return `XA${accountCheckDigits(bban)}${bban}`;
}

export function normalizeAccountNumber(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

export function isValidAccountNumber(input: string): boolean {
  const n = normalizeAccountNumber(input);
  if (!/^XA\d{2}AEX\d{13}$/.test(n)) return false;
  const rearranged = lettersToDigits(n.slice(4) + n.slice(0, 4));
  return mod97(rearranged) === 1;
}

export function formatAccountNumber(n: string): string {
  return normalizeAccountNumber(n).replace(/(.{4})/g, '$1 ').trim();
}

export async function nextAccountNumber(branchNo: number): Promise<string> {
  const serial = await nextCounter('account-serial', 100_000);
  return makeAccountNumber(branchNo, serial);
}

/** External (other realm) account identifiers just need a plausible shape. */
export function isPlausibleExternalAccount(input: string): boolean {
  return /^[A-Z0-9 -]{8,34}$/i.test(input.trim());
}

/* ── Cards ── */
export function makeCardNumber(typeDigit: number): string {
  const partial = `941${typeDigit}${randomDigits(11)}`;
  return partial + luhnCheckDigit(partial);
}

export function formatCardNumber(n: string, masked = false): string {
  const digits = n.replace(/\D/g, '');
  const shown = masked ? '•••• •••• •••• ' + digits.slice(-4) : digits.replace(/(.{4})/g, '$1 ').trim();
  return shown;
}

/* ── References & registry numbers ── */
export function txRef(prefix = 'AEL'): string {
  const d = now();
  return `${prefix}-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}-${randomCode(7)}`;
}

export async function docNumber(prefix: string): Promise<string> {
  const n = await nextCounter(`doc-${prefix}`, 1);
  return `${prefix}-${now().getUTCFullYear()}-${String(n).padStart(6, '0')}`;
}

export async function caseNumber(dept: string): Promise<string> {
  const n = await nextCounter(`case-${dept}`, 400);
  return `CASE/${dept}/${now().getUTCFullYear()}/${String(n).padStart(5, '0')}`;
}

export async function registryNumber(): Promise<string> {
  const n = await nextCounter('registry', 7700);
  return `REG № ${n}-ALD/${String(now().getUTCFullYear()).slice(2)}`;
}

export function archiveCode(dept: string): string {
  return `ARC·${dept}·${randomCode(3)}-${randomDigits(4)}`;
}

export function shelfMark(): string {
  const halls = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const h = halls[Math.floor(Math.random() * halls.length)];
  return `Hall ${h} · Shelf ${1 + Math.floor(Math.random() * 40)} · Box ${1 + Math.floor(Math.random() * 12)}`;
}
