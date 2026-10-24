import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useCatalog } from '@/lib/catalog';
import { money } from '@/lib/settings';
import { Input, Spinner } from './ui/core';
import { Dialog } from './ui/dialog';

export interface PickedProduct {
  productId: string;
  variantId: string | null;
  name: string;
  sku: string;
  cost?: number;
}

/** Search the catalog and pick a product (and variant) — used by stock documents and promotions. */
export function ProductPicker({ open, onClose, onPick, onlyTracked, title = 'เลือกสินค้า' }: { open: boolean; onClose: () => void; onPick: (p: PickedProduct) => void; onlyTracked?: boolean; title?: string }) {
  const { index, isLoading } = useCatalog();
  const [q, setQ] = useState('');
  const rows = useMemo((): (PickedProduct & { price: number; stock: number | null })[] => {
    if (!index) return [];
    const hit = q.trim() ? index.byCode.get(q.trim()) : undefined;
    const list = index.search(q, null, 60).filter((p) => !onlyTracked || p.trackStock || p.variants.length);
    return list.flatMap<PickedProduct & { price: number; stock: number | null }>((p) =>
      p.variants.length
        ? p.variants.filter((v) => !hit || hit.product.id !== p.id || !hit.variantId || hit.variantId === v.id).map((v) => ({ productId: p.id, variantId: v.id, name: `${p.name} (${v.name})`, sku: v.sku || p.sku, price: v.price, stock: v.stock }))
        : [{ productId: p.id, variantId: null, name: p.name, sku: p.sku, price: p.price, stock: p.stock }],
    );
  }, [index, q, onlyTracked]);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title={title} size="md">
      <div className="flex flex-col gap-3 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input
            autoFocus
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาหรือสแกนบาร์โค้ด"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && rows.length === 1) {
                onPick(rows[0]!);
                setQ('');
              }
            }}
          />
        </div>
        <div className="max-h-[50vh] min-h-[200px] overflow-y-auto">
          {isLoading ? (
            <Spinner className="mx-auto my-8" />
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-[14px] text-muted">ไม่พบสินค้า{onlyTracked ? ' (เฉพาะสินค้าที่ติดตามสต็อก)' : ''}</p>
          ) : (
            rows.map((r) => (
              <button
                key={r.productId + (r.variantId ?? '')}
                onClick={() => {
                  onPick(r);
                  setQ('');
                }}
                className="flex w-full items-center gap-3 border-b border-line-soft px-2 py-2.5 text-left hover:bg-sunken"
              >
                <span className="flex flex-1 flex-col">
                  <span className="font-medium">{r.name}</span>
                  <span className="font-mono text-[12px] text-muted">{r.sku}</span>
                </span>
                {r.stock !== null && <span className="num text-[13px] text-muted">คงเหลือ {r.stock}</span>}
                <span className="num text-[14px]">{money(r.price)}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
