import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { DocBlock, PrintDoc } from '@flexpos/shared';
import { cn } from '@/lib/utils';

function Qr({ data, size = 160, caption }: { data: string; size?: number; caption?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    QRCode.toDataURL(data, { margin: 1, width: size * 2 }).then(setUrl, () => setUrl(''));
  }, [data, size]);
  return (
    <div className="flex flex-col items-center gap-1 py-1">
      {url ? <img src={url} width={Math.min(size, 180)} height={Math.min(size, 180)} alt="QR code" /> : <div style={{ width: size, height: size }} className="skeleton" />}
      {caption && <span className="text-[11px]">{caption}</span>}
    </div>
  );
}

export function QrImage({ data, size = 200, className }: { data: string; size?: number; className?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    QRCode.toDataURL(data, { margin: 1, width: size * 2, errorCorrectionLevel: 'M' }).then(setUrl, () => setUrl(''));
  }, [data, size]);
  return url ? <img src={url} width={size} height={size} alt="PromptPay QR" className={className} /> : <div style={{ width: size, height: size }} className={cn('skeleton', className)} />;
}

function Block({ b }: { b: DocBlock }) {
  switch (b.t) {
    case 'text':
      return (
        <div className={cn('whitespace-pre-wrap break-words', b.align === 'center' && 'text-center', b.align === 'right' && 'text-right', b.bold && 'font-bold', b.size === 2 && 'text-[15px]', b.size === 3 && 'text-[24px] leading-tight')}>
          {b.text}
        </div>
      );
    case 'row':
      return (
        <div className={cn('flex justify-between gap-2', b.bold && 'font-bold', b.size === 2 && 'text-[15px]')}>
          <span className="break-words">{b.left}</span>
          <span className="num whitespace-nowrap">{b.right}</span>
        </div>
      );
    case 'line':
      return <div className={cn('my-1 border-t', b.dashed ? 'border-dashed border-[#bdbab0]' : 'border-[#555]')} />;
    case 'feed':
      return <div style={{ height: b.lines * 10 }} />;
    case 'image':
      return (
        <div className="flex justify-center py-1">
          <img src={b.src} alt="" style={{ maxWidth: b.width ?? 160, maxHeight: 100 }} />
        </div>
      );
    case 'qr':
      return <Qr data={b.data} size={b.size} caption={b.caption} />;
  }
}

/** On-screen receipt preview that matches printed output. */
export function PrintDocView({ doc, className }: { doc: PrintDoc; className?: string }) {
  const width = doc.paper === '58' ? 220 : doc.paper === '80' ? 290 : 520;
  return (
    <div className={cn('rounded-md border border-line bg-white px-4 py-5 text-[12px] leading-[1.55] text-[#17191c] shadow-lift', className)} style={{ width }}>
      {doc.blocks.map((b, i) => (
        <Block key={i} b={b} />
      ))}
    </div>
  );
}
