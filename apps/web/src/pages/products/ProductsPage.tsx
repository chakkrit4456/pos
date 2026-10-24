import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Upload, Plus, Search, GripVertical, Barcode } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, errorMessage } from '@/lib/api';
import { money, useSettings } from '@/lib/settings';
import { useSession } from '@/lib/session';
import { cn, qtyText } from '@/lib/utils';
import { Page } from '@/components/layout/AppShell';
import { Badge, Button, Checkbox, EmptyState, ErrorState, Input, PageHeader, Pagination, Segmented, Select, SkeletonRows, Switch } from '@/components/ui/core';
import { Dialog } from '@/components/ui/dialog';
import { MoneyInput, NumberInput } from '@/components/ui/inputs';
import { ImportDialog } from './ImportDialog';
import { CategoriesTab, ModifiersTab, TiersTab } from './CatalogTabs';
import { LabelsDialog } from './LabelsDialog';

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  price: number;
  cost: number;
  unit: string;
  kind: string;
  color: string;
  imageUrl: string;
  active: boolean;
  showInPos: boolean;
  trackStock: boolean;
  lowStock: number;
  categoryId: string | null;
  categoryName: string | null;
  stock: number | null;
  variantCount: number;
}

export interface CategoryRow {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  sort: number;
  station: string | null;
  active: boolean;
  productCount: number;
}

const TINTS = ['#e9dfd2', '#efe3d3', '#dcebd6', '#f3e3c3', '#d9e8f2', '#e6e1f0', '#f6dccb', '#efe4c8'];

export default function ProductsPage() {
  const [tab, setTab] = useState<'products' | 'categories' | 'modifiers' | 'tiers'>('products');
  return (
    <Page>
      <Segmented
        className="self-start"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'products', label: 'สินค้า' },
          { value: 'categories', label: 'หมวดหมู่' },
          { value: 'modifiers', label: 'ตัวเลือกเสริม' },
          { value: 'tiers', label: 'ระดับราคา' },
        ]}
      />
      {tab === 'products' && <ProductsTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'modifiers' && <ModifiersTab />}
      {tab === 'tiers' && <TiersTab />}
    </Page>
  );
}

function ProductsTab() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useSession();
  const settings = useSettings();
  const [q, setQ] = useState('');
  const [stock, setStock] = useState<'all' | 'low' | 'out'>('all');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [sortMode, setSortMode] = useState(false);
  const pageSize = sortMode ? 500 : 50;
  const manage = can('products.manage');

  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get<CategoryRow[]>('/api/categories') });
  const list = useQuery({
    queryKey: ['products', q, stock, categoryId, page, pageSize],
    queryFn: () => api.get<{ total: number; items: ProductRow[] }>('/api/products', { q, stock, categoryId, page, pageSize }),
    placeholderData: keepPreviousData,
  });

  const toggle = useMutation({
    mutationFn: (p: { id: string; active: boolean }) => api.patch(`/api/products/${p.id}/toggle`, { active: p.active }),
    onMutate: async (p) => {
      qc.setQueryData<{ total: number; items: ProductRow[] }>(['products', q, stock, categoryId, page, pageSize], (d) => d && { ...d, items: d.items.map((x) => (x.id === p.id ? { ...x, active: p.active } : x)) });
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });

  const items = list.data?.items ?? [];
  const allSel = items.length > 0 && items.every((i) => sel.has(i.id));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex((i) => i.id === e.active.id);
    const to = items.findIndex((i) => i.id === e.over!.id);
    const next = arrayMove(items, from, to);
    qc.setQueryData(['products', q, stock, categoryId, page, pageSize], { total: list.data!.total, items: next });
    try {
      await api.post('/api/products/reorder', { ids: next.map((i) => i.id) });
    } catch (err) {
      toast.error(errorMessage(err));
      qc.invalidateQueries({ queryKey: ['products'] });
    }
  };

  return (
    <>
      <PageHeader
        title="สินค้า"
        sub={list.data ? `${list.data.total.toLocaleString()} รายการ` : ' '}
        actions={
          <>
            <Button icon={<Download className="h-4 w-4" />} onClick={() => api.download('/api/products/export', { format: 'xlsx' }, 'products.xlsx').catch((e) => toast.error(errorMessage(e)))}>
              ส่งออก
            </Button>
            {manage && (
              <>
                <Button icon={<Upload className="h-4 w-4" />} onClick={() => setImportOpen(true)}>
                  นำเข้า Excel/CSV
                </Button>
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => nav('/products/new')}>
                  เพิ่มสินค้า
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 md:max-w-[360px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input className="pl-9" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="ค้นหาชื่อ SKU หรือบาร์โค้ด" />
        </div>
        <Select className="w-auto min-w-[160px]" value={categoryId} onChange={(e) => (setCategoryId(e.target.value), setPage(1))} aria-label="หมวดหมู่">
          <option value="">ทุกหมวด</option>
          {cats.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.parentId ? '— ' : ''}
              {c.name}
            </option>
          ))}
        </Select>
        {settings.modules.stock &&
          (['all', 'low', 'out'] as const).map((s) => (
            <button key={s} onClick={() => (setStock(s), setPage(1))} className={cn('h-10 whitespace-nowrap rounded-full border px-3.5 text-[14px] font-medium', stock === s ? 'border-ink bg-ink text-surface' : 'border-line-strong bg-surface')}>
              {{ all: 'ทั้งหมด', low: 'ใกล้หมด', out: 'หมดสต็อก' }[s]}
            </button>
          ))}
        {manage && (
          <Button className="ml-auto" variant={sortMode ? 'primary' : 'ghost'} icon={<GripVertical className="h-4 w-4" />} onClick={() => setSortMode(!sortMode)}>
            {sortMode ? 'เสร็จสิ้นการจัดเรียง' : 'จัดเรียงหน้าขาย'}
          </Button>
        )}
      </div>
      {sel.size > 0 && manage && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-ink px-4 py-2.5 text-surface">
          <span className="text-[14px] font-medium">เลือก {sel.size} รายการ</span>
          <div className="flex-1" />
          <Button size="sm" onClick={() => setBulkOpen(true)}>
            แก้ไขหลายรายการ
          </Button>
          <Button size="sm" icon={<Barcode className="h-4 w-4" />} onClick={() => setLabelsOpen(true)}>
            พิมพ์สติกเกอร์บาร์โค้ด
          </Button>
          <Button size="sm" variant="ghost" className="text-surface hover:bg-rail-2" onClick={() => setSel(new Set())}>
            ยกเลิก
          </Button>
        </div>
      )}
      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[32px_96px_minmax(0,2fr)_minmax(0,1fr)_110px_150px_80px] items-center gap-3 border-b border-line-soft bg-sunken px-5 py-3 text-[13px] font-medium text-muted md:grid">
          {sortMode ? <span /> : <Checkbox checked={allSel} onChange={(v) => setSel(v ? new Set(items.map((i) => i.id)) : new Set())} label={<span className="sr-only">เลือกทั้งหมด</span>} />}
          <span>SKU</span>
          <span>ชื่อสินค้า</span>
          <span>หมวด</span>
          <span className="text-right">ราคา</span>
          <span>สต็อก</span>
          <span className="text-right">ขายอยู่</span>
        </div>
        {list.isLoading ? (
          <SkeletonRows rows={8} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={q || categoryId || stock !== 'all' ? 'ไม่พบสินค้าตามเงื่อนไข' : 'ยังไม่มีสินค้า'}
            body={q ? `ไม่พบ “${q}”` : 'เพิ่มสินค้าทีละรายการ หรือนำเข้าจากไฟล์ Excel/CSV ได้ทีเดียวหลายพันรายการ'}
            action={manage && !q ? <Button variant="primary" onClick={() => setImportOpen(true)}>นำเข้าจาก Excel</Button> : undefined}
          />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onDragEnd(e)}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy} disabled={!sortMode}>
              {items.map((r, i) => (
                <ProductLine
                  key={r.id}
                  r={r}
                  tint={r.color || TINTS[i % TINTS.length]!}
                  sortMode={sortMode}
                  selected={sel.has(r.id)}
                  onSelect={(v) => setSel((s) => (v ? new Set(s.add(r.id)) : (s.delete(r.id), new Set(s))))}
                  onOpen={() => nav(`/products/${r.id}`)}
                  onToggle={manage ? (v) => toggle.mutate({ id: r.id, active: v }) : undefined}
                  showStock={settings.modules.stock}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
        <Pagination page={page} pageSize={pageSize} total={list.data?.total ?? 0} onPage={setPage} />
      </div>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <BulkDialog open={bulkOpen} ids={[...sel]} categories={cats.data ?? []} onClose={(done) => (setBulkOpen(false), done && setSel(new Set()))} />
      <LabelsDialog open={labelsOpen} ids={[...sel]} onClose={() => setLabelsOpen(false)} />
    </>
  );
}

function ProductLine({ r, tint, sortMode, selected, onSelect, onOpen, onToggle, showStock }: { r: ProductRow; tint: string; sortMode: boolean; selected: boolean; onSelect: (v: boolean) => void; onOpen: () => void; onToggle?: (v: boolean) => void; showStock: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: r.id });
  const badge = r.stock === null ? null : r.stock <= 0 ? <Badge tone="danger">หมด</Badge> : r.stock <= r.lowStock ? <Badge tone="warn">ใกล้หมด</Badge> : <Badge tone="success">ปกติ</Badge>;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line-soft px-5 py-2.5 text-[15px] hover:bg-sunken md:h-[60px] md:grid-cols-[32px_96px_minmax(0,2fr)_minmax(0,1fr)_110px_150px_80px] md:py-0', isDragging && 'relative z-10 bg-surface shadow-pop', !r.active && 'opacity-60')}
    >
      {sortMode ? (
        <button {...attributes} {...listeners} className="grid h-9 w-8 cursor-grab place-items-center text-faint" aria-label={`ลากเพื่อจัดเรียง ${r.name}`}>
          <GripVertical className="h-4 w-4" />
        </button>
      ) : (
        <Checkbox checked={selected} onChange={onSelect} label={<span className="sr-only">เลือก {r.name}</span>} />
      )}
      <span className="hidden font-mono text-[13px] font-medium text-muted md:block">{r.sku || '—'}</span>
      <button onClick={onOpen} className="flex min-w-0 items-center gap-3 text-left">
        {r.imageUrl ? <img src={r.imageUrl} alt="" className="h-9 w-9 flex-none rounded-[9px] object-cover" /> : <span className="h-9 w-9 flex-none rounded-[9px]" style={{ background: tint }} />}
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{r.name}</span>
          <span className="truncate text-[12px] text-muted md:hidden">
            {r.sku} · {money(r.price)}
          </span>
          {r.variantCount > 0 && <span className="text-[12px] text-muted">{r.variantCount} ตัวเลือก</span>}
        </span>
      </button>
      <span className="hidden truncate text-ink-2 md:block">{r.categoryName ?? '—'}</span>
      <span className="num hidden text-right font-medium md:block">{money(r.price)}</span>
      <span className="hidden items-center gap-2 md:flex">
        {showStock && r.trackStock ? (
          <>
            <span className="num min-w-[28px]">{qtyText(r.stock ?? 0)}</span>
            {badge}
          </>
        ) : (
          <span className="text-[13px] text-faint">ไม่ตัดสต็อก</span>
        )}
      </span>
      <span className="flex justify-end">{onToggle ? <Switch size="sm" checked={r.active} onChange={onToggle} label={`เปิดขาย ${r.name}`} /> : r.active ? 'เปิด' : 'ปิด'}</span>
    </div>
  );
}

function BulkDialog({ open, ids, categories, onClose }: { open: boolean; ids: string[]; categories: CategoryRow[]; onClose: (done: boolean) => void }) {
  const qc = useQueryClient();
  const [categoryId, setCategoryId] = useState<string>('__keep');
  const [active, setActive] = useState<'keep' | 'on' | 'off'>('keep');
  const [showInPos, setShowInPos] = useState<'keep' | 'on' | 'off'>('keep');
  const [priceMode, setPriceMode] = useState<'keep' | 'set' | 'percent' | 'amount'>('keep');
  const [priceValue, setPriceValue] = useState(0);
  const [busy, setBusy] = useState(false);
  const tri = (v: 'keep' | 'on' | 'off') => (v === 'keep' ? undefined : v === 'on');
  const patch = useMemo(
    () => ({
      ...(categoryId !== '__keep' ? { categoryId: categoryId || null } : {}),
      active: tri(active),
      showInPos: tri(showInPos),
      ...(priceMode !== 'keep' ? { priceChange: { mode: priceMode, value: priceValue } } : {}),
    }),
    [categoryId, active, showInPos, priceMode, priceValue],
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose(false)}
      title={`แก้ไข ${ids.length} รายการพร้อมกัน`}
      description="เว้นไว้เป็น “ไม่เปลี่ยน” สำหรับค่าที่ไม่ต้องการแก้"
      footer={
        <>
          <Button onClick={() => onClose(false)}>ยกเลิก</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post('/api/products/bulk', { ids, patch });
                toast.success(`อัปเดต ${ids.length} รายการแล้ว`);
                qc.invalidateQueries({ queryKey: ['products'] });
                onClose(true);
              } catch (e) {
                toast.error(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            บันทึก
          </Button>
        </>
      }
    >
      <div className="grid gap-4 pb-2">
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-muted">
          หมวดหมู่
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="__keep">ไม่เปลี่ยน</option>
            <option value="">ไม่มีหมวด</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        <TriSelect label="เปิดขาย" value={active} onChange={setActive} />
        <TriSelect label="แสดงในหน้าขาย" value={showInPos} onChange={setShowInPos} />
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-muted">
          ปรับราคา
          <div className="flex gap-2">
            <Select className="w-[180px]" value={priceMode} onChange={(e) => setPriceMode(e.target.value as typeof priceMode)}>
              <option value="keep">ไม่เปลี่ยน</option>
              <option value="set">ตั้งราคาเป็น</option>
              <option value="percent">ขึ้น/ลด %</option>
              <option value="amount">ขึ้น/ลด บาท</option>
            </Select>
            {priceMode === 'percent' ? <NumberInput decimals={2} value={priceValue} onValue={setPriceValue} className="flex-1" /> : priceMode !== 'keep' ? <div className="flex-1"><MoneyInput allowNegative={priceMode === 'amount'} value={priceValue} onValue={setPriceValue} /></div> : null}
          </div>
        </label>
      </div>
    </Dialog>
  );
}

function TriSelect({ label, value, onChange }: { label: string; value: 'keep' | 'on' | 'off'; onChange: (v: 'keep' | 'on' | 'off') => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[15px]">{label}</span>
      <Segmented value={value} onChange={onChange} options={[{ value: 'keep', label: 'ไม่เปลี่ยน' }, { value: 'on', label: 'เปิด' }, { value: 'off', label: 'ปิด' }]} />
    </div>
  );
}
