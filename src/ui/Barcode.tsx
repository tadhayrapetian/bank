/** Code 128 barcode (JsBarcode) rendered into SVG. */
import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

export function Barcode({ value, height = 38, color = '#1b1a17', showText = true, width = 1.4 }: { value: string; height?: number; color?: string; showText?: boolean; width?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, { format: 'CODE128', height, width, displayValue: showText, fontSize: 10, font: 'IBM Plex Mono', margin: 0, background: 'transparent', lineColor: color, textMargin: 2 });
    } catch {
      /* unsupported characters: leave empty */
    }
  }, [value, height, color, showText, width]);
  return <svg ref={ref} role="img" aria-label={value} style={{ maxWidth: '100%', height: 'auto' }} />;
}
