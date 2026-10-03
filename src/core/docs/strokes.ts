/**
 * Handwritten signature strokes. Signature pads record pointer paths in a
 * 300×100 box; for demo data we synthesise a flowing cursive flourish from
 * the signer's name (deterministic, so the same person signs the same way).
 */
import { hashSeed, prng } from '../util/random';

export const SIG_W = 300;
export const SIG_H = 100;

export function syntheticSignature(name: string): string {
  const r = prng(hashSeed(name));
  const letters = name.replace(/[^A-Za-z]/g, '').slice(0, 14) || 'Signature';
  let x = 18 + r() * 10;
  const baseline = 62 + r() * 6;
  let d = `M ${x.toFixed(1)} ${(baseline - 10).toFixed(1)}`;
  // initial capital loop
  d += ` C ${(x + 18).toFixed(1)} ${(baseline - 52).toFixed(1)}, ${(x + 34).toFixed(1)} ${(baseline - 30).toFixed(1)}, ${(x + 14).toFixed(1)} ${(baseline + 6).toFixed(1)}`;
  x += 20;
  for (let i = 0; i < letters.length; i++) {
    const up = /[bdfhklt]/i.test(letters[i]) ? 30 : 12;
    const w = 9 + r() * 9;
    const h = up + r() * 8;
    d += ` C ${(x + w * 0.3).toFixed(1)} ${(baseline - h).toFixed(1)}, ${(x + w * 0.7).toFixed(1)} ${(baseline - h * 0.6).toFixed(1)}, ${(x + w).toFixed(1)} ${(baseline + (r() - 0.5) * 6).toFixed(1)}`;
    x += w * 0.85;
    if (x > SIG_W - 40) break;
  }
  // underline flourish
  const ux = Math.min(x + 10, SIG_W - 10);
  d += ` C ${(ux + 8).toFixed(1)} ${(baseline + 10).toFixed(1)}, ${(ux - 60).toFixed(1)} ${(baseline + 24).toFixed(1)}, ${(20 + r() * 20).toFixed(1)} ${(baseline + 16).toFixed(1)}`;
  return d;
}
