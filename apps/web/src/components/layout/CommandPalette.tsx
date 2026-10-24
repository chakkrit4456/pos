import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as RD from '@radix-ui/react-dialog';
import { Package, Receipt, Search, CornerDownLeft } from 'lucide-react';
import type { Catalog } from '@flexpos/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { money } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { useNavItems } from './AppShell';

interface Item {
  id: string;
  label: string;
  sub?: string;
  icon: React.ReactNode;
  run: () => void;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const nav = useNavigate();
  const navItems = useNavItems();
  const { can } = useSession();
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => api.get<Catalog>('/api/catalog'), enabled: open, staleTime: 60_000 });
  const term = q.trim().toLowerCase();
  const bills = useQuery({
    queryKey: ['palette-bills', term],
    queryFn: () => api.get<{ items: { id: string; doc_no: string; total: number; created_at: string }[] }>('/api/sales', { q: term, pageSize: 5 }),
    enabled: open && term.length >= 3,
  });

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => {
      onOpenChange(false);
      nav(to);
    };
    const pages: Item[] = [
      ...navItems.map((n) => ({ id: n.to, label: n.label, sub: 'เมนู', icon: n.icon, run: go(n.to) })),
      ...(can('products.manage') ? [{ id: 'new-product', label: 'เพิ่มสินค้าใหม่', sub: 'คำสั่ง', icon: <Package />, run: go('/products/new') }] : []),
      ...(can('settings.manage')
        ? [
            { id: 'set-receipt', label: 'ออกแบบใบเสร็จ', sub: 'ตั้งค่า', icon: <Receipt />, run: go('/settings/receipt') },
            { id: 'set-printers', label: 'เครื่องพิมพ์', sub: 'ตั้งค่า', icon: <Receipt />, run: go('/settings/printers') },
            { id: 'set-staff', label: 'พนักงานและสิทธิ์', sub: 'ตั้งค่า', icon: <Receipt />, run: go('/settings/staff') },
            { id: 'set-backup', label: 'สำรองข้อมูล', sub: 'ตั้งค่า', icon: <Receipt />, run: go('/settings/backup') },
          ]
        : []),
    ];
    const matchPages = pages.filter((p) => !term || p.label.toLowerCase().includes(term));
    const products = term && catalog.data
      ? catalog.data.products
          .filter((p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || p.barcodes.includes(term))
          .slice(0, 6)
          .map((p) => ({ id: 'p' + p.id, label: p.name, sub: `${p.sku} · ${money(p.price)}`, icon: <Package />, run: go(can('products.manage') ? `/products/${p.id}` : '/pos') }))
      : [];
    const billItems = (bills.data?.items ?? []).map((b) => ({ id: 'b' + b.id, label: b.doc_no, sub: `บิล · ${money(b.total)}`, icon: <Receipt />, run: go(`/sales?open=${b.id}`) }));
    return [...matchPages, ...products, ...billItems];
  }, [navItems, term, catalog.data, bills.data, can, nav, onOpenChange]);

  useEffect(() => setIdx(0), [term]);

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-[rgb(23_25_28/0.35)]" />
        <RD.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-24px)] max-w-[600px] -translate-x-1/2 animate-pop-in overflow-hidden rounded-[18px] bg-surface shadow-pop">
          <RD.Title className="sr-only">ค้นหา</RD.Title>
          <RD.Description className="sr-only">ค้นหาเมนู สินค้า หรือบิล</RD.Description>
          <div className="flex items-center gap-3 border-b border-line-soft px-4">
            <Search className="h-5 w-5 text-faint" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setIdx((i) => Math.min(i + 1, items.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setIdx((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter') items[idx]?.run();
              }}
              placeholder="ค้นหาเมนู สินค้า หรือเลขที่บิล"
              className="h-14 flex-1 bg-transparent text-[16px] outline-none"
            />
          </div>
          <ul className="scroll-thin max-h-[56vh] overflow-y-auto p-2" role="listbox">
            {items.length === 0 && <li className="px-4 py-8 text-center text-[14px] text-muted">ไม่พบ “{q}”</li>}
            {items.map((it, i) => (
              <li key={it.id} role="option" aria-selected={i === idx}>
                <button
                  onMouseEnter={() => setIdx(i)}
                  onClick={it.run}
                  className={cn('flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:text-muted', i === idx && 'bg-sunken')}
                >
                  {it.icon}
                  <span className="flex-1 truncate text-[15px]">{it.label}</span>
                  {it.sub && <span className="truncate text-[13px] text-muted">{it.sub}</span>}
                  {i === idx && <CornerDownLeft className="h-4 w-4" />}
                </button>
              </li>
            ))}
          </ul>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
