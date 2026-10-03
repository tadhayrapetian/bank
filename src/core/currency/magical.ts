/**
 * Magical currencies of the realms surrounding Aldermoor.
 * They live in their own registry section (kind = 'magical', 4-letter codes)
 * so they can never collide with ISO 4217 codes. All values are fictional.
 */
import type { CurrencyDef } from './types';

export const MAGICAL_CURRENCIES: CurrencyDef[] = [
  {
    code: 'CRWN', name: 'Aldermoor Crown', symbol: 'Ȼ', decimals: 2, isoMinor: null,
    countries: ['Sovereign Commonwealth of Aldermoor'], kind: 'magical', status: 'active', position: 'prefix',
    defaultPerUSD: 0.74, region: 'magical', note: 'Sovereign coin of Aldermoor. 1 Crown = 100 shillings.',
  },
  {
    code: 'MSLV', name: 'Moonsilver Mark', symbol: 'ℳ', decimals: 2, isoMinor: null,
    countries: ['Moonward Isles'], kind: 'magical', status: 'active', position: 'prefix',
    defaultPerUSD: 2.4, region: 'magical', note: 'Struck from tide-silver; value waxes slightly at full moon.',
  },
  {
    code: 'EMBR', name: 'Ember Sovereign', symbol: 'Ɇ', decimals: 3, isoMinor: null,
    countries: ['Free Cities of the Ember Coast'], kind: 'magical', status: 'active', position: 'prefix',
    defaultPerUSD: 0.212, region: 'magical', note: 'Divided into 1,000 sparks.',
  },
  {
    code: 'RUNE', name: 'Runic Drachm', symbol: 'Ʀ', decimals: 0, isoMinor: null,
    countries: ['Highland Thanedom of Kaldrun'], kind: 'magical', status: 'active', position: 'suffix',
    defaultPerUSD: 38, region: 'magical', note: 'Indivisible carved tokens; no subunits.',
  },
  {
    code: 'STAR', name: 'Starlight Florin', symbol: '✶', decimals: 2, isoMinor: null,
    countries: ['Celestine Archipelago'], kind: 'magical', status: 'active', position: 'prefix',
    defaultPerUSD: 1.15, region: 'magical',
  },
  {
    code: 'GRFN', name: 'Griffin Ducat', symbol: 'Ɖ', decimals: 2, isoMinor: null,
    countries: ['Duchy of Griffonmere'], kind: 'magical', status: 'active', position: 'prefix',
    defaultPerUSD: 0.48, region: 'magical',
  },
  {
    code: 'VEIL', name: 'Veilgold Talent', symbol: 'Ⱦ', decimals: 4, isoMinor: null,
    countries: ['The Veiled Courts (inter-realm settlement)'], kind: 'magical', status: 'active', position: 'prefix',
    defaultPerUSD: 0.0125, region: 'magical', note: 'Settlement unit between realm treasuries.',
  },
  {
    code: 'MIRE', name: 'Mirefen Hexpenny', symbol: 'Hp', decimals: 2, isoMinor: null,
    countries: ['Mirefen Marches'], kind: 'magical', status: 'suspended', position: 'suffix',
    defaultPerUSD: 9.7, region: 'magical', note: 'Suspended by order of the Exchequer pending a warding inquiry.',
  },
];
