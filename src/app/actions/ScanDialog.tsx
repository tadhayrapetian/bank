/** QR scanner: live camera (jsQR), image upload, paste, or pick one of your own codes. Routes to the right flow. */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Upload, ClipboardPaste, ScanLine } from 'lucide-react';
import jsQR from 'jsqr';
import { Modal } from '@/ui/Modal';
import { Button, Field, Input, Alert, Segmented } from '@/ui/primitives';
import { parseQrPayload, qrToDataUrl, qrPayload } from '@/ui/QR';
import { useT } from '@/hooks/useT';
import { useUI } from '@/state/ui';
import { useLive } from '@/hooks/data';
import { useSession } from '@/state/session';
import { db } from '@/core/db/db';
import { play } from '@/ui/sound';

function decodeImageData(data: ImageData): string | null {
  const r = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
  return r?.data ?? null;
}

async function decodeFromUrl(url: string): Promise<string | null> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return decodeImageData(ctx.getImageData(0, 0, c.width, c.height));
}

export function ScanDialog({ onClose }: { onClose: () => void }) {
  const { t, tx } = useT();
  const nav = useNavigate();
  const openAction = useUI((s) => s.openAction);
  const me = useSession((s) => s.user);
  const [mode, setMode] = useState<'camera' | 'upload' | 'paste' | 'mine'>('mine');
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mine = useLive(async () => {
    if (!me) return [];
    const invoices = await db.invoices.where('recipientId').equals(me.id).filter((i) => i.status === 'sent' || i.status === 'overdue').limit(4).toArray();
    const links = await db.links.where('status').equals('active').filter((l) => l.ownerId !== me.id).limit(3).toArray();
    const docs = await db.documents.where('partyIds').equals(me.id).limit(3).toArray();
    return [
      ...invoices.map((i) => ({ label: `${t('qr.kinds.invoice')} ${i.number}`, payload: qrPayload('invoice', { id: i.id, amt: i.total, ccy: i.currency }) })),
      ...links.map((l) => ({ label: `${t('qr.kinds.link')} ${l.code}`, payload: qrPayload('link', { code: l.code }) })),
      ...docs.map((d) => ({ label: `${t('qr.kinds.verify')} ${d.number}`, payload: qrPayload('verify', { doc: d.id, code: d.verificationCode }) })),
    ];
  }, [me?.id], [] as { label: string; payload: string }[]);

  const handle = (raw: string) => {
    const p = parseQrPayload(raw);
    if (!p) {
      setStatus(t('qr.unknown'));
      play('error');
      return;
    }
    play('card');
    onClose();
    switch (p.kind) {
      case 'verify':
      case 'document':
        nav(`/verify?doc=${encodeURIComponent(p.params.doc ?? '')}&code=${encodeURIComponent(p.params.code ?? '')}`);
        break;
      case 'invoice':
        nav(`/invoices/${p.params.id}`);
        break;
      case 'link':
        nav(`/pay/${p.params.code}`);
        break;
      case 'pay':
      case 'transfer':
      case 'receive':
      case 'account':
        setTimeout(() => openAction('transfer', { mode: 'number', to: p.params.acct ?? '', ccy: p.params.ccy ?? '', amount: p.params.amt ? String(Number(p.params.amt) / 100) : '', desc: p.params.ref ?? '' }), 0);
        break;
      default:
        setStatus(t('qr.unknown'));
    }
  };

  useEffect(() => {
    if (mode !== 'camera') return;
    let raf = 0;
    let alive = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!alive) return stream.getTracks().forEach((tr) => tr.stop());
        streamRef.current = stream;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        const loop = () => {
          if (!alive) return;
          if (v.videoWidth) {
            c.width = v.videoWidth;
            c.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const r = decodeImageData(ctx.getImageData(0, 0, c.width, c.height));
            if (r) return handle(r);
          }
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch {
        setCamError(t('qr.cameraUnavailable'));
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <Modal open onClose={onClose} title={t('qr.scanTitle')} eyebrow={t('nav.qr')} footer={<Button onClick={onClose}>{t('common.close')}</Button>}>
      <Segmented label={t('qr.scanTitle')} value={mode} onChange={(m) => { setMode(m); setStatus(null); setCamError(null); }} options={[
        { value: 'mine', label: t('qr.fromMine') }, { value: 'camera', label: t('qr.camera') }, { value: 'upload', label: t('qr.upload') }, { value: 'paste', label: t('qr.paste') },
      ]} />
      {mode === 'camera' && (
        <div className="stack">
          <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#000', aspectRatio: '4 / 3' }}>
            <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} aria-label={t('qr.camera')} />
            <div aria-hidden style={{ position: 'absolute', inset: '18%', border: '2px solid var(--accent)', borderRadius: 10, boxShadow: '0 0 0 999px rgba(0,0,0,0.35)' }} />
            <ScanLine aria-hidden style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', color: 'var(--accent)' }} />
          </div>
          {camError && <Alert tone="warning">{camError}</Alert>}
        </div>
      )}
      {mode === 'upload' && (
        <Field label={t('qr.uploadLabel')} htmlFor="qr-file">
          <input id="qr-file" type="file" accept="image/*" className="input" style={{ paddingTop: 6 }} onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const url = URL.createObjectURL(file);
            const r = await decodeFromUrl(url).catch(() => null);
            URL.revokeObjectURL(url);
            if (r) handle(r);
            else setStatus(t('qr.notFound'));
          }} />
        </Field>
      )}
      {mode === 'paste' && (
        <div className="row" style={{ alignItems: 'end' }}>
          <Field label={t('qr.payload')} htmlFor="qr-text" className="grow"><Input id="qr-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="aetherline://pay?acct=…" className="mono" /></Field>
          <Button icon={<ClipboardPaste />} onClick={() => handle(text)} disabled={!text}>{t('qr.read')}</Button>
        </div>
      )}
      {mode === 'mine' && (
        <div className="stack-sm">
          <p className="small ink2">{t('qr.mineText')}</p>
          {mine.map((m) => (
            <button key={m.payload} type="button" className="list-item panel" onClick={async () => {
              // render the code to an image and decode it back — a real scan round-trip
              const url = await qrToDataUrl(m.payload);
              const r = await decodeFromUrl(url);
              if (r) handle(r);
              else setStatus(t('qr.notFound'));
            }}>
              <span className="glyph"><Camera /></span>
              <div className="li-main"><div className="li-title">{m.label}</div><div className="li-sub mono">{m.payload}</div></div>
            </button>
          ))}
          {!mine.length && <Alert tone="info">{t('qr.noneMine')}</Alert>}
        </div>
      )}
      {status && <Alert tone="warning">{status}</Alert>}
      <div className="xsmall muted">{t('qr.formats')} {(['pay', 'transfer', 'receive', 'account', 'document', 'verify', 'invoice'] as const).map((k) => tx(`qr.kinds.${k}`)).join(' · ')}</div>
      <span className="sr-only"><Upload /></span>
    </Modal>
  );
}
