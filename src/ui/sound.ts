/**
 * Optional interface sounds, synthesised with WebAudio (no audio files):
 * paper, stamp, notification, safe, card, payment, document. Global on/off.
 */
import { useUI } from '@/state/ui';

export type SoundName = 'paper' | 'stamp' | 'notify' | 'safe' | 'card' | 'payment' | 'document' | 'error';

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noise(c: AudioContext, dur: number, gain: number, freq: number, q = 1, t0 = 0) {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(c.currentTime + t0);
}

function tone(c: AudioContext, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', t0 = 0, slideTo?: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + t0 + dur);
  g.gain.setValueAtTime(0.0001, c.currentTime + t0);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + t0);
  o.stop(c.currentTime + t0 + dur + 0.05);
}

export function play(name: SoundName) {
  if (!useUI.getState().sound) return;
  const c = ac();
  if (!c) return;
  switch (name) {
    case 'paper':
    case 'document':
      noise(c, 0.22, 0.25, 3200, 0.7);
      noise(c, 0.12, 0.12, 6000, 1, 0.08);
      break;
    case 'stamp':
      tone(c, 120, 0.18, 0.5, 'sine', 0, 55);
      noise(c, 0.08, 0.35, 900, 0.8);
      break;
    case 'notify':
      tone(c, 880, 0.35, 0.12, 'sine');
      tone(c, 1320, 0.45, 0.09, 'sine', 0.09);
      break;
    case 'safe':
      for (let i = 0; i < 4; i++) noise(c, 0.03, 0.4, 2500, 4, i * 0.07);
      tone(c, 90, 0.4, 0.3, 'triangle', 0.3, 60);
      break;
    case 'card':
      noise(c, 0.18, 0.2, 1800, 0.6);
      break;
    case 'payment':
      tone(c, 1568, 0.5, 0.1, 'triangle');
      tone(c, 2093, 0.6, 0.08, 'triangle', 0.06);
      break;
    case 'error':
      tone(c, 220, 0.25, 0.12, 'sawtooth', 0, 180);
      break;
  }
}
