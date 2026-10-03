/** Amounts in words for checks and official documents (English, Russian, Armenian). */
import { currencies } from './registry';
import type { Lang } from '../types';

/* ── English ── */
const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

function enBelow1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${EN_ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(EN_TENS[Math.floor(n / 10)] + (n % 10 ? '-' + EN_ONES[n % 10] : ''));
  } else if (n > 0) parts.push(EN_ONES[n]);
  return parts.join(' ');
}

function enWords(n: number): string {
  if (n === 0) return 'zero';
  const groups: string[] = [];
  let scale = 0;
  while (n > 0) {
    const g = n % 1000;
    if (g) groups.unshift(enBelow1000(g) + (EN_SCALES[scale] ? ' ' + EN_SCALES[scale] : ''));
    n = Math.floor(n / 1000);
    scale++;
  }
  return groups.join(' ');
}

/* ── Russian ── */
const RU_ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const RU_ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const RU_TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать',
  'семнадцать', 'восемнадцать', 'девятнадцать'];
const RU_TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const RU_HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
const RU_SCALES: [string, string, string, boolean][] = [
  ['', '', '', false],
  ['тысяча', 'тысячи', 'тысяч', true],
  ['миллион', 'миллиона', 'миллионов', false],
  ['миллиард', 'миллиарда', 'миллиардов', false],
  ['триллион', 'триллиона', 'триллионов', false],
];

function ruPlural(n: number, forms: [string, string, string]): string {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
  return forms[2];
}

function ruBelow1000(n: number, feminine: boolean): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(RU_HUNDREDS[Math.floor(n / 100)]);
    n %= 100;
  }
  if (n >= 10 && n < 20) parts.push(RU_TEENS[n - 10]);
  else {
    if (n >= 20) parts.push(RU_TENS[Math.floor(n / 10)]);
    if (n % 10) parts.push((feminine ? RU_ONES_F : RU_ONES_M)[n % 10]);
  }
  return parts.join(' ');
}

function ruWords(n: number): string {
  if (n === 0) return 'ноль';
  const groups: string[] = [];
  let scale = 0;
  while (n > 0) {
    const g = n % 1000;
    if (g) {
      const [one, few, many, fem] = RU_SCALES[scale];
      const word = ruBelow1000(g, fem);
      groups.unshift(scale ? `${word} ${ruPlural(g, [one, few, many])}` : word);
    }
    n = Math.floor(n / 1000);
    scale++;
  }
  return groups.join(' ');
}

/* ── Armenian ── */
const HY_ONES = ['', 'մեկ', 'երկու', 'երեք', 'չորս', 'հինգ', 'վեց', 'յոթ', 'ութ', 'ինը'];
const HY_TEENS = ['տասը', 'տասնմեկ', 'տասներկու', 'տասներեք', 'տասնչորս', 'տասնհինգ', 'տասնվեց', 'տասնյոթ', 'տասնութ', 'տասնինը'];
const HY_TENS = ['', '', 'քսան', 'երեսուն', 'քառասուն', 'հիսուն', 'վաթսուն', 'յոթանասուն', 'ութսուն', 'իննսուն'];
const HY_SCALES = ['', 'հազար', 'միլիոն', 'միլիարդ', 'տրիլիոն'];

function hyBelow1000(n: number, dropOne: boolean): string {
  const parts: string[] = [];
  if (n >= 100) {
    const h = Math.floor(n / 100);
    parts.push(h === 1 ? 'հարյուր' : `${HY_ONES[h]} հարյուր`);
    n %= 100;
  }
  if (n >= 10 && n < 20) parts.push(HY_TEENS[n - 10]);
  else if (n >= 20) parts.push(HY_TENS[Math.floor(n / 10)] + (n % 10 ? HY_ONES[n % 10] : ''));
  else if (n > 0 && !(dropOne && n === 1 && parts.length === 0)) parts.push(HY_ONES[n]);
  return parts.join(' ');
}

function hyWords(n: number): string {
  if (n === 0) return 'զրո';
  const groups: string[] = [];
  let scale = 0;
  while (n > 0) {
    const g = n % 1000;
    if (g) {
      const word = hyBelow1000(g, scale === 1);
      groups.unshift(scale ? `${word ? word + ' ' : ''}${HY_SCALES[scale]}` : word);
    }
    n = Math.floor(n / 1000);
    scale++;
  }
  return groups.join(' ');
}

export function numberToWords(n: number, lang: Lang): string {
  const int = Math.floor(Math.abs(n));
  if (lang === 'ru') return ruWords(int);
  if (lang === 'hy') return hyWords(int);
  return enWords(int);
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "One thousand two hundred thirty-four and 56/100 — US Dollar (USD)" */
export function amountInWords(minor: number, code: string, lang: Lang): string {
  const d = currencies.decimals(code);
  const div = Math.pow(10, d);
  const abs = Math.abs(minor);
  const major = Math.floor(abs / div);
  const frac = abs % div;
  const words = cap(numberToWords(major, lang));
  const name = currencies.get(code)?.name ?? code;
  const fracPart = d > 0 ? ` ${String(frac).padStart(d, '0')}/${div}` : '';
  const and = lang === 'ru' ? ' и' : lang === 'hy' ? ' և' : ' and';
  return d > 0 ? `${words}${and}${fracPart} — ${name} (${code})` : `${words} — ${name} (${code})`;
}
