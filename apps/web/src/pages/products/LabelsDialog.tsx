import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import JsBarcode from 'jsbarcode';
import { Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/settings';
import { Button, Field, Select, Spinner } from '@/components/ui/core';
import { Dialog } from '@/components/ui/dialog';
import { NumberInput } from '@/components/ui/inputs';

interface Detail {
  id: string;
  name: string;
  sku: string;
  price: number;
  barcodes: string[];
  variants: { id: string; name: string; barcode: string; sku: string; price: number }[];
}

interface Label {
  key: string;
  name: string;
  code: string;
  price: number;
}

function BarcodeSvg({ code }: { code: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      const fmt = /^\d{13}$/.test(code) ? 'EAN13' : /^\d{8}$/.test(code) ? 'EAN8' : 'CODE128';
      JsBarcode(ref.current, code, { format: fmt, height: 34, width: 1.4, fontSize: 11, margin: 0, displayValue: true });
    } catch {
      JsBarcode(ref.current, code, { format: 'CODE128', height: 34, width: 1.4, fontSize: 11, margin: 0 });
    }
  }, [code]);
  return <svg ref={ref} />;
}

/** Print barcode stickers on a label printer or A4 label sheet. */
export function LabelsDialog({ open, ids, onClose }: { open: boolean; ids: string[]; onClose: () => void }) {
  const [copies, setCopies] = useState(1);
  const [size, setSize] = useState<'40x30' | '50x30' | 'a4'>('40x30');
  const details = useQuery({
    queryKey: ['label-details', ids],
    queryFn: () => Promise.all(ids.slice(0, 200).map((id) => api.get<Detail>(`/api/products/${id}`))),
    enabled: open && ids.length > 0,
  });
  const labels: Label[] = (details.data ?? []).flatMap((p) =>
    p.variants.length
      ? p.variants.filter((v) => v.barcode || v.sku).map((v) => ({ key: v.id, name: `${p.name} ${v.name}`, code: v.barcode || v.sku, price: v.price }))
      : (p.barcodes[0] || p.sku) ? [{ key: p.id, name: p.name, code: p.barcodes[0] || p.sku, price: p.price }] : [],
  );
  const missing = (details.data?.length ?? 0) > 0 && labels.length === 0;
  const print = () => {
    const sheet = document.getElementById('label-sheet');
    if (!sheet) return;
    const w = window.open('', '_blank', 'width=800,height=600');
    if (!w) return;
    const page = size === 'a4' ? '@page{size:A4;margin:8mm}' : `@page{size:${size.replace('x', 'mm ')}mm;margin:0}`;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><style>${page}body{margin:0;font-family:'IBM Plex Sans Thai',sans-serif}.l{box-sizing:border-box;${size === 'a4' ? 'width:63mm;height:34mm;display:inline-flex;' : `width:${size.split('x')[0]}mm;height:${size.split('x')[1]}mm;display:flex;page-break-after:always;`}flex-direction:column;align-items:center;justify-content:center;padding:1.5mm;overflow:hidden}.n{font-size:9px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.p{font-size:12px;font-weight:700}svg{max-width:100%;height:auto}</style></head><body>${sheet.innerHTML}</body></html>`);
    w.document.close();
    setTimeout(() => {
      w.focus();
      w.print();
      w.close();
    }, 400);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="พิมพ์สติกเกอร์บาร์โค้ด"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>ปิด</Button>
          <Button variant="primary" icon={<Printer className="h-4 w-4" />} disabled={!labels.length} onClick={print}>
            พิมพ์ {labels.length * copies} ดวง
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="ขนาดสติกเกอร์">
            <Select value={size} onChange={(e) => setSize(e.target.value as typeof size)}>
              <option value="40x30">40 × 30 มม. (เครื่องพิมพ์สติกเกอร์)</option>
              <option value="50x30">50 × 30 มม.</option>
              <option value="a4">กระดาษ A4 (3 × 8 ดวง)</option>
            </Select>
          </Field>
          <Field label="จำนวนต่อรายการ">
            <NumberInput value={copies} onValue={(v) => setCopies(Math.max(1, Math.min(100, v)))} />
          </Field>
        </div>
        {details.isLoading ? (
          <Spinner className="mx-auto my-8" />
        ) : missing ? (
          <p className="text-[14px] text-muted">สินค้าที่เลือกยังไม่มีบาร์โค้ดหรือ SKU — กด “สร้างบาร์โค้ด” ในหน้าแก้ไขสินค้าก่อน</p>
        ) : (
          <div id="label-sheet" className="flex max-h-[360px] flex-wrap gap-2 overflow-auto rounded-xl bg-sunken p-3">
            {labels.flatMap((l) =>
              Array.from({ length: copies }, (_, i) => (
                <div key={`${l.key}-${i}`} className="l flex w-[150px] flex-col items-center rounded-md border border-line bg-white p-1.5 text-black">
                  <span className="n w-full truncate text-center text-[9px]">{l.name}</span>
                  <BarcodeSvg code={l.code} />
                  <span className="p text-[12px] font-bold">{money(l.price)}</span>
                </div>
              )),
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
