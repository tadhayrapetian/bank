/**
 * i18n audit: every language must cover every English key with the same {placeholders};
 * every literal t('key') in the source must exist; JSX text must not be hard-coded.
 *   npm run check:i18n
 */
import fs from 'node:fs';
import path from 'node:path';
import { LANGUAGES, allKeys } from '../src/i18n';

type Flat = Map<string, string>;
function flatten(obj: unknown, prefix = '', out: Flat = new Map()): Flat {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') out.set(key, v);
      else flatten(v, key, out);
    }
  }
  return out;
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

let errors = 0;
let warnings = 0;
const err = (m: string) => { errors++; console.log(`  ✗ ${m}`); };
const warn = (m: string) => { warnings++; console.log(`  ! ${m}`); };

const en = flatten(LANGUAGES.find((l) => l.code === 'en')!.dict);
console.log(`English master: ${en.size} keys`);

for (const lang of LANGUAGES.filter((l) => l.code !== 'en')) {
  const d = flatten(lang.dict);
  const missing = [...en.keys()].filter((k) => !d.has(k));
  const extra = [...d.keys()].filter((k) => !en.has(k));
  const ph = [...d.entries()].filter(([k, v]) => en.has(k) && placeholders(en.get(k)!) !== placeholders(v));
  const same = [...d.entries()].filter(([k, v]) => en.get(k) === v && /[a-z]{4,}/.test(v));
  console.log(`\n${lang.nativeName} (${lang.code}): ${d.size}/${en.size} keys, ${missing.length} missing, ${extra.length} extra, ${ph.length} placeholder mismatches, ${same.length} identical to English`);
  missing.slice(0, 40).forEach((k) => err(`${lang.code} missing ${k}`));
  if (missing.length > 40) err(`${lang.code} … and ${missing.length - 40} more missing`);
  extra.forEach((k) => err(`${lang.code} extra key ${k}`));
  ph.forEach(([k, v]) => err(`${lang.code} ${k}: placeholders {${placeholders(en.get(k)!)}} vs {${placeholders(v)}} — "${v}"`));
  if (process.argv.includes('--verbose')) same.forEach(([k, v]) => warn(`${lang.code} ${k} untranslated? "${v}"`));
}

// Source scan
const keys = new Set(allKeys());
const namespaces = new Set([...keys].flatMap((k) => k.split('.').map((_, i, a) => a.slice(0, i + 1).join('.'))));
const files: string[] = [];
(function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'i18n' && e.name !== 'data') walk(p); }
    else if (/\.(tsx?|mts)$/.test(e.name)) files.push(p);
  }
})('src');

console.log(`\nSource scan: ${files.length} files`);
const ALLOWED_TEXT = /^(CSV|PDF|QR|SIGIL|ATM|IBAN|SWIFT|PIN|CVV|ID|OK|EUR|USD|CRWN|v\d+|[A-Z]{2,5}|[\d\s.,:%/+\-–—×·•#№()]+|Ctrl K|Ctrl K · /|⌘K|Esc|Enter|Tab|EXCHEQUER|FIDES·ARCANUM·AURUM|Promise)$/;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) if (!keys.has(m[1])) err(`${f}:${i + 1} unknown key '${m[1]}'`);
    for (const m of line.matchAll(/\btx?\(\s*`([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\.\$\{/g)) if (!namespaces.has(m[1])) err(`${f}:${i + 1} unknown namespace '${m[1]}.*'`);
    if (f.endsWith('.tsx')) {
      for (const m of line.matchAll(/>\s*([^<>{}\n]*[A-Za-z]{2}[^<>{}\n]*?)\s*</g)) {
        const text = m[1].trim();
        if (text && !ALLOWED_TEXT.test(text) && !/[(),?:;=[\]]|=>|&&|\bconst\b|\breturn\b/.test(text)) warn(`${f}:${i + 1} hard-coded text "${text.slice(0, 60)}"`);
      }
      for (const m of line.matchAll(/\b(aria-label|placeholder|title|alt)="([^"]*[A-Za-z]{3}[^"]*)"/g)) if (/\s/.test(m[2])) warn(`${f}:${i + 1} hard-coded ${m[1]}="${m[2]}"`);
    }
  });
}

console.log(`\n${errors} errors, ${warnings} warnings`);
process.exit(errors ? 1 : 0);
