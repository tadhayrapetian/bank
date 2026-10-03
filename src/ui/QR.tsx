/** Real QR codes (qrcode library) and the Aetherline QR payload format. */
import { useEffect, useState } from 'react';
import QRCodeLib from 'qrcode';

export type QrKind = 'pay' | 'transfer' | 'receive' | 'account' | 'document' | 'verify' | 'invoice' | 'link';

/** aetherline://<kind>?k=v… — the payload understood by the QR scanner. */
export function qrPayload(kind: QrKind, params: Record<string, string | number | undefined>): string {
  const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  return `aetherline://${kind}${q ? '?' + q : ''}`;
}

export function parseQrPayload(text: string): { kind: QrKind; params: Record<string, string> } | null {
  const m = /^aetherline:\/\/([a-z]+)(?:\?(.*))?$/i.exec(text.trim());
  if (!m) return null;
  const params: Record<string, string> = {};
  for (const part of (m[2] ?? '').split('&')) {
    if (!part) continue;
    const [k, v = ''] = part.split('=');
    params[k] = decodeURIComponent(v);
  }
  return { kind: m[1].toLowerCase() as QrKind, params };
}

export function QRCode({ value, size = 160, fg = '#1b1a17', bg = 'transparent', label }: { value: string; size?: number; fg?: string; bg?: string; label?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    QRCodeLib.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: fg, light: bg === 'transparent' ? '#0000' : bg } })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(''));
    return () => {
      alive = false;
    };
  }, [value, fg, bg]);
  return <span role="img" aria-label={label ?? value} style={{ display: 'inline-block', width: size, height: size, lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: svg.replace('<svg', `<svg width="${size}" height="${size}"`) }} />;
}

export async function qrToDataUrl(value: string, size = 320): Promise<string> {
  return QRCodeLib.toDataURL(value, { width: size, margin: 2, errorCorrectionLevel: 'M' });
}
