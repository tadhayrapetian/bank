/** Print, PDF export and file download helpers. Heavy libraries load on demand. */
export const EMBED = typeof __EMBED__ !== 'undefined' && __EMBED__;

/** Print one element as an official document (print stylesheet hides the app). */
export function printElement(el: HTMLElement | null) {
  if (!el) return;
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    document.body.appendChild(root);
  }
  root.innerHTML = '';
  root.appendChild(el.cloneNode(true));
  document.documentElement.classList.add('printing');
  const done = () => {
    document.documentElement.classList.remove('printing');
    root!.innerHTML = '';
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1500);
}

export async function elementToPng(el: HTMLElement, pixelRatio = 2): Promise<string> {
  const { toPng } = await import('html-to-image');
  return toPng(el, { pixelRatio, cacheBust: true, backgroundColor: getComputedStyle(el).backgroundColor || '#fbf6e8' });
}

export async function exportPdf(el: HTMLElement | null, filename: string) {
  if (!el) return;
  const [{ jsPDF }, png] = await Promise.all([import('jspdf'), elementToPng(el)]);
  const r = el.getBoundingClientRect();
  const landscape = r.width > r.height;
  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const w = pw - margin * 2;
  const h = Math.min(ph - margin * 2, (w * r.height) / r.width);
  const ww = (h * r.width) / r.height;
  pdf.setProperties({ title: filename, creator: 'Ledgerhall — Exchequer of Aldermoor (demo)' });
  pdf.addImage(png, 'PNG', (pw - ww) / 2, margin, ww, h);
  pdf.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

export function downloadText(filename: string, text: string, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => {
    const v = String(c ?? '');
    return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',')).join('\n');
}
