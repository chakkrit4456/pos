import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronDown, PackageSearch, QrCode, Search, Send, UserRound, X, WifiOff, CloudUpload } from 'lucide-react';
import { effectiveBillDiscount, priceCart, type CatalogProduct, type PromotionRule, type SaleInput, t } from '@flexpos/shared';
import { api, errorMessage, registerName } from '@/lib/api';
import { useBarcodeScanner, useCatalog } from '@/lib/catalog';
import { useSession } from '@/lib/session';
import { money, useSettings } from '@/lib/settings';
import { useLiveStatus, sendLive } from '@/lib/live';
import { onPendingChange, syncOutbox } from '@/lib/offline';
import type { PrinterInfo } from '@/lib/print';
import { cn, qtyText, uuid } from '@/lib/utils';
import { Button, Chip, EmptyState, ErrorState, Kbd, Spinner } from '@/components/ui/core';
import { useConfirm } from '@/components/ui/dialog';
import { cart, useCart, type CartOrder, type SentItem } from './cart';
import { ApprovalHost, BillDiscountDialog, CustomerDialog, LineDialog, OptionsDialog, useApproval } from './dialogs';
import { DoneDialog, PaymentDialog, type PayDone } from './PaymentDialog';
import { BillPicker, OpenShiftGate, SplitDialog } from './BillPicker';
import { BillSlipDialog } from '@/components/BillSlipDialog';
import { tn } from '@/lib/i18n';

const DEFAULT_KEYS: Record<string, string> = { search: 'F2', member: 'F4', hold: 'F6', recall: 'F7', discount: 'F8', drawer: 'F9', pay: 'F12' };

export interface ShiftInfo {
  id: string;
  number: number;
  openedBy: string;
  openedAt: string;
}

export interface OrderDetail {
  id: string;
  name: string;
  tableId: string | null;
  tableName: string | null;
  items: { id: string; round_no: number; product_id: string; variant_id: string | null; name: string; qty: number; unit_price: number; modifiers: { id: string; name: string; priceDelta: number }[]; note: string; status: string; by: string | null; created_at: string }[];
}

export function orderToCart(o: OrderDetail): CartOrder {
  return {
    id: o.id,
    name: o.tableName ? t('โต๊ะ {0}', o.tableName) : o.name,
    tableId: o.tableId,
    items: o.items
      .filter((i) => i.status !== 'cancelled')
      .map<SentItem>((i) => ({ id: i.id, round: i.round_no, productId: i.product_id, variantId: i.variant_id, name: i.name, qty: i.qty, unitPrice: i.unit_price, modifiers: i.modifiers, note: i.note, status: i.status, by: i.by, createdAt: i.created_at })),
  };
}

export default function PosPage() {
  const settings = useSettings();
  const { user, can } = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const confirm = useConfirm();
  const approve = useApproval();
  const state = useCart();
  const { index, isLoading, isError, error, refetch } = useCatalog();
  const online = useLiveStatus();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [optionsFor, setOptionsFor] = useState<CatalogProduct | null>(null);
  const [editLine, setEditLine] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'pay' | 'customer' | 'discount' | 'bills' | 'split'>(null);
  const [done, setDone] = useState<PayDone | null>(null);
  const [pending, setPending] = useState(0);
  const [sending, setSending] = useState(false);
  const [slip, setSlip] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const shift = useQuery({ queryKey: ['shift', 'current'], queryFn: () => api.get<ShiftInfo | null>('/api/shifts/current'), staleTime: 30_000 });
  const promos = useQuery({ queryKey: ['promotions'], queryFn: () => api.get<(PromotionRule & { usageCount: number; usageLimit: number })[]>('/api/promotions'), staleTime: 60_000, enabled: settings.modules.promotions });
  const printers = useQuery({ queryKey: ['printers'], queryFn: () => api.get<PrinterInfo[]>('/api/printers'), staleTime: 60_000 });

  useEffect(() => onPendingChange(setPending), []);

  // Open a table bill passed from the floor plan (/pos?order=...)
  const orderParam = params.get('order');
  useEffect(() => {
    if (!orderParam) return;
    api
      .get<OrderDetail>(`/api/orders/${orderParam}`)
      .then((o) => {
        const cur = cart.get();
        if (cur.order?.id !== o.id) cart.replace({ order: orderToCart(o), lines: cur.order ? [] : cur.lines, customer: cur.customer });
        else cart.patch({ order: orderToCart(o) });
      })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setParams({}, { replace: true }));
  }, [orderParam, setParams]);

  const catalog = index?.catalog;
  const tierId = state.customer?.priceTierId ?? null;

  const topCats = useMemo(() => (catalog?.categories ?? []).filter((c) => !c.parentId), [catalog]);
  const products = useMemo(() => (index ? index.search(q, cat) : []), [index, q, cat]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    if (!index) return m;
    for (const c of topCats) m.set(c.id, index.search('', c.id, 100000).length);
    return m;
  }, [index, topCats]);
  const inCart = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of state.lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty);
    return m;
  }, [state.lines]);

  /** Sent order items + new lines, priced with the shared engine (the server recomputes authoritatively). */
  const pricing = useMemo(() => {
    const sent = (state.order?.items ?? []).map((i) => ({ id: 's' + i.id, productId: i.productId, categoryId: index?.byId.get(i.productId)?.categoryId ?? null, name: i.name, qty: i.qty, unitPrice: i.unitPrice, taxable: index?.byId.get(i.productId)?.taxable ?? true }));
    return priceCart({
      lines: [...sent, ...state.lines.map((l) => ({ id: l.id, productId: l.productId, categoryId: l.categoryId, name: l.name, qty: l.qty, unitPrice: l.unitPrice, taxable: l.taxable, discount: l.discount }))],
      billDiscount: effectiveBillDiscount(state.billDiscount, state.customer?.groupPercent ?? 0),
      config: { ...settings.tax, serviceChargeRate: settings.modules.restaurant ? settings.tax.serviceChargeRate : 0 },
      promotions: (promos.data ?? []).filter((p) => !p.usageLimit || p.usageCount < p.usageLimit),
      promoContext: { now: new Date(), branchId: user?.branchId ?? null, customerGroupId: state.customer?.groupId ?? null, couponCodes: state.couponCodes },
    });
  }, [state, settings.tax, settings.modules.restaurant, promos.data, index, user?.branchId]);

  const itemCount = state.lines.reduce((a, l) => a + l.qty, 0) + (state.order?.items.reduce((a, i) => a + i.qty, 0) ?? 0);
  const cartEmpty = itemCount === 0;

  // Customer display
  useEffect(() => {
    if (!settings.modules.customerDisplay) return;
    sendLive({
      type: 'display.update',
      register: registerName(),
      payload: {
        state: cartEmpty ? 'idle' : 'cart',
        lines: [...(state.order?.items ?? []).map((i) => ({ name: i.name, qty: i.qty, total: Math.round(i.qty * i.unitPrice) })), ...state.lines.map((l) => ({ name: l.name, qty: l.qty, total: Math.round(l.qty * l.unitPrice) }))],
        subtotal: pricing.subtotal,
        discount: pricing.discountTotal,
        total: pricing.total,
        qr: null,
        change: 0,
      },
    });
  }, [pricing, state.lines, state.order, cartEmpty, settings.modules.customerDisplay]);

  const addProduct = useCallback(
    (p: CatalogProduct, opts: { variantId?: string | null; unitId?: string | null } = {}) => {
      const groups = catalog?.modifierGroups.filter((g) => p.modifierGroupIds.includes(g.id)) ?? [];
      const needsDialog = (p.variants.length > 0 && !opts.variantId) || groups.length > 0 || p.kind === 'weighted' || p.kind === 'open_price' || (p.units.length > 0 && opts.unitId === undefined);
      if (needsDialog) {
        setOptionsFor(p);
        return;
      }
      const v = p.variants.find((x) => x.id === opts.variantId);
      const u = p.units.find((x) => x.id === opts.unitId);
      const price = u ? u.price : v ? v.price : tierId && p.tierPrices[tierId] !== undefined ? p.tierPrices[tierId]! : p.price;
      const stock = v ? v.stock : p.stock;
      if (stock !== null && stock <= 0 && !settings.pos.allowNegativeStock) {
        toast.error(t('{0} หมดสต็อก', p.name));
        return;
      }
      cart.add({ productId: p.id, variantId: v?.id ?? null, unitId: u?.id ?? null, name: v ? `${p.name} (${v.name})` : u ? `${p.name} (${u.name})` : p.name, sku: v?.sku || p.sku, unitPrice: price, priceOverridden: false, modifiers: [], note: '', discount: null, categoryId: p.categoryId, taxable: p.taxable, kind: p.kind });
    },
    [catalog, tierId, settings.pos.allowNegativeStock],
  );

  const onScan = useCallback(
    (code: string) => {
      if (!index || dialog || optionsFor) return;
      const hit = index.byCode.get(code) ?? index.byCode.get(code.toLowerCase());
      if (!hit) {
        toast.error(t('ไม่พบสินค้าบาร์โค้ด {0}', code));
        return;
      }
      addProduct(hit.product, { variantId: hit.variantId, unitId: hit.unitId });
      setQ('');
    },
    [index, addProduct, dialog, optionsFor],
  );
  useBarcodeScanner(onScan, !!index);

  const hold = useCallback(async () => {
    const s = cart.get();
    if (!s.lines.length) return;
    if (s.order) {
      toast.info(t('บิลโต๊ะถูกเก็บไว้ที่โต๊ะอยู่แล้ว กด “ส่งครัว” เพื่อบันทึกรายการเพิ่ม'));
      return;
    }
    const id = s.heldId ?? uuid();
    try {
      await api.post('/api/held', { id, name: s.heldName || s.customer?.name || t('บิลพัก {0}', new Date().toTimeString().slice(0, 5)), data: { ...s, saleId: s.saleId, managerPin: null } });
      cart.clear();
      qc.invalidateQueries({ queryKey: ['held'] });
      toast.success(t('พักบิลแล้ว เรียกคืนได้ที่ปุ่มชื่อบิล'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [qc]);

  const clearCart = useCallback(async () => {
    const s = cart.get();
    if (!s.lines.length && !s.order && !s.customer) return;
    if (s.lines.length) {
      const r = await confirm({ title: t('ล้างรายการทั้งหมด?'), body: s.order ? t('รายการที่ยังไม่ส่งครัวจะถูกลบ บิลโต๊ะยังอยู่') : t('รายการในตะกร้าจะถูกลบ'), confirmText: t('ล้าง'), danger: true });
      if (!r.ok) return;
    }
    cart.clear();
  }, [confirm]);

  const sendToKitchen = async () => {
    const s = cart.get();
    if (!s.order || !s.lines.length) return;
    setSending(true);
    try {
      const o = await api.post<OrderDetail & { printedTo: number }>(`/api/orders/${s.order.id}/items`, {
        requestId: uuid(),
        source: 'pos',
        items: s.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty, modifiers: l.modifiers, note: l.note })),
      });
      cart.patch({ lines: [], order: orderToCart(o) });
      toast.success(o.printedTo ? t('ส่งครัวแล้ว · พิมพ์ที่ {0} เครื่อง', o.printedTo) : t('ส่งครัวแล้ว'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const openDrawer = useCallback(async () => {
    const pin = await approve('pos.open_drawer', t('เปิดลิ้นชักเงินโดยไม่มีการขาย'));
    if (pin === null) return;
    try {
      await api.post('/api/drawer/open', { managerPin: pin || undefined });
      toast.success(t('เปิดลิ้นชักแล้ว'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [approve]);

  // Hotkeys
  useEffect(() => {
    const keys = { ...DEFAULT_KEYS, ...settings.pos.hotkeys };
    const onKey = (e: KeyboardEvent) => {
      if (!/^F\d{1,2}$/.test(e.key)) return;
      const action = Object.entries(keys).find(([, k]) => k === e.key)?.[0];
      if (!action) return;
      e.preventDefault();
      if (dialog || optionsFor) return;
      if (action === 'search') searchRef.current?.focus();
      else if (action === 'member' && settings.modules.members) setDialog('customer');
      else if (action === 'hold') void hold();
      else if (action === 'recall') setDialog('bills');
      else if (action === 'discount') setDialog('discount');
      else if (action === 'drawer') void openDrawer();
      else if (action === 'pay' && !cartEmpty) setDialog('pay');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settings.pos.hotkeys, settings.modules.members, dialog, optionsFor, cartEmpty, hold, openDrawer]);

  const buildLines = (): SaleInput['lines'] => {
    const s = cart.get();
    return [
      ...(s.order?.items ?? []).map((i) => ({ id: 's' + i.id, productId: i.productId, variantId: i.variantId, unitId: null, name: i.name, qty: i.qty, unitPrice: i.unitPrice, priceOverridden: false, modifiers: i.modifiers, note: i.note, discount: null })),
      ...s.lines.map((l) => ({ id: l.id, productId: l.productId, variantId: l.variantId, unitId: l.unitId, name: l.name, qty: l.qty, unitPrice: l.unitPrice, priceOverridden: l.priceOverridden, modifiers: l.modifiers, note: l.note, discount: l.discount })),
    ];
  };

  if (isLoading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }
  if (isError || !index || !catalog) return <ErrorState error={error} onRetry={() => void refetch()} className="h-full justify-center" />;

  const needShift = settings.pos.requireShift && shift.isSuccess && !shift.data;
  const editing = state.lines.find((l) => l.id === editLine) ?? null;
  const rounds = groupRounds(state.order?.items ?? []);
  const billTitle = state.order ? state.order.name : state.heldName || t('บิลใหม่');

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="flex h-[72px] flex-none items-center gap-4 border-b border-line bg-surface px-4 md:px-6">
        <div className="hidden min-w-0 flex-col sm:flex">
          <span className="truncate text-[17px] font-semibold">{settings.store.name}</span>
          <span className="truncate text-[13px] text-muted">{shift.data ? t('กะ #{0} · เปิดโดย {1} · {2}', shift.data.number, shift.data.openedBy, new Date(shift.data.openedAt).toTimeString().slice(0, 5)) : t('{0} · ยังไม่เปิดกะ', registerName())}</span>
        </div>
        <div className="ml-auto flex h-12 w-full max-w-[520px] items-center gap-2.5 rounded-xl border border-line-strong bg-sunken px-3.5">
          <Search className="h-4 w-4 flex-none text-faint" />
          <input
            ref={searchRef}
            data-scan-target="1"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const term = q.trim();
                const hit = index.byCode.get(term) ?? index.byCode.get(term.toLowerCase());
                if (hit) {
                  addProduct(hit.product, { variantId: hit.variantId, unitId: hit.unitId });
                  setQ('');
                } else if (products.length === 1) {
                  addProduct(products[0]!);
                  setQ('');
                }
              } else if (e.key === 'Escape') setQ('');
            }}
            placeholder={t('ค้นหาชื่อ, SKU หรือสแกนบาร์โค้ด')}
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
            aria-label={t('ค้นหาสินค้า')}
          />
          {q ? (
            <button onClick={() => setQ('')} aria-label={t('ล้างคำค้น')} className="text-faint">
              <X className="h-4 w-4" />
            </button>
          ) : (
            <Kbd>{settings.pos.hotkeys.search ?? 'F2'}</Kbd>
          )}
        </div>
        <ConnectionPill online={online} pending={pending} />
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-4 md:p-[20px_24px_24px]">
          <div className="scroll-thin flex flex-none gap-2 overflow-x-auto pb-1">
            <Chip active={!cat} onClick={() => setCat(null)} count={catalog.products.filter((p) => p.showInPos).length}>{t('ทั้งหมด')}</Chip>
            {topCats.map((c) => (
              <Chip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)} count={counts.get(c.id)}>
                {c.name}
              </Chip>
            ))}
          </div>
          <div className="scroll-thin grid min-h-0 flex-1 content-start gap-3 overflow-y-auto" style={{ gridTemplateColumns: settings.pos.gridColumns ? `repeat(${settings.pos.gridColumns}, minmax(0,1fr))` : 'repeat(auto-fill, minmax(136px, 1fr))' }}>
            {products.map((p) => (
              <ProductTile key={p.id} p={p} qty={inCart.get(p.id) ?? 0} showImage={settings.pos.showImages} onAdd={() => addProduct(p)} />
            ))}
            {products.length === 0 && (
              <div className="col-span-full">
                <EmptyState
                  icon={<PackageSearch className="h-6 w-6" />}
                  title={q ? t('ไม่พบสินค้าที่ตรงกับ “{0}”', q) : t('ยังไม่มีสินค้าในหมวดนี้')}
                  body={q ? t('ลองค้นด้วย SKU หรือสแกนบาร์โค้ด') : can('products.manage') ? t('เพิ่มสินค้าหรือนำเข้าจาก Excel ได้ที่หน้าสินค้า') : undefined}
                  action={!q && can('products.manage') ? <Button onClick={() => nav('/products/new')}>{t('เพิ่มสินค้า')}</Button> : undefined}
                />
              </div>
            )}
          </div>
        </section>

        <aside className="flex max-h-[55vh] min-h-0 w-full flex-none flex-col border-t border-line bg-surface md:max-h-none md:w-[320px] md:border-l md:border-t-0 xl:w-[380px]">
          <div className="flex items-center justify-between gap-2 border-b border-line-soft px-5 py-[18px]">
            <button onClick={() => setDialog('bills')} className="flex min-h-[48px] items-center gap-2.5 rounded-xl border border-line-strong bg-sunken px-3 py-1.5 text-left">
              <span className="flex flex-col">
                <span className="text-[17px] font-semibold leading-tight">{billTitle}</span>
                <span className="text-[13px] text-muted">{itemCount ? t('{0} รายการ', qtyText(itemCount)) : t('แตะเพื่อเลือกโต๊ะ/บิลที่พักไว้')}</span>
              </span>
              <ChevronDown className="h-4 w-4 text-muted" />
            </button>
            <div className="flex gap-1.5">
              <Button size="sm" className="h-10" onClick={() => void hold()} disabled={!state.lines.length || !!state.order}>{t('พักบิล')}</Button>
              <Button size="sm" className="h-10 text-danger" onClick={() => void clearCart()}>{t('ล้าง')}</Button>
            </div>
          </div>
          {settings.modules.members &&
            (state.customer ? (
              <div className="mx-5 mt-3 flex min-h-[48px] items-center gap-2.5 rounded-xl bg-soft px-3.5 text-soft-fg">
                <UserRound className="h-5 w-5" />
                <button className="flex flex-1 flex-col text-left" onClick={() => setDialog('customer')}>
                  <span className="text-[15px] font-semibold">{state.customer.name}</span>
                  <span className="text-[12px]">{tn('{0} แต้ม{1}', state.customer.points.toLocaleString(), state.customer.groupPercent ? t(' · ส่วนลดสมาชิก {0}%', state.customer.groupPercent) : '')}</span>
                </button>
                <button aria-label={t('นำสมาชิกออก')} onClick={() => cart.patch({ customer: null, pointsRedeemed: 0 })}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button onClick={() => setDialog('customer')} className="mx-5 mt-3 flex h-12 items-center gap-2.5 rounded-xl border border-dashed border-[#cfccc2] bg-sunken px-3.5 text-[14px] text-muted">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-soft font-semibold text-primary">+</span>{t('เลือกสมาชิก / สะสมแต้ม')}<span className="ml-auto">
                  <Kbd>{settings.pos.hotkeys.member ?? 'F4'}</Kbd>
                </span>
              </button>
            ))}
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-2">
            {rounds.map((r) => (
              <div key={r.round} className="flex flex-col border-b border-line-soft py-2.5">
                <div className="flex justify-between pb-1 text-[12px] text-muted">
                  <span>{tn('รอบ {0} · {1}{2}', r.round, r.time, r.by ? ` · ${r.by}` : '')}</span>
                  <span>{r.ready ? t('พร้อมเสิร์ฟ') : t('ส่งครัวแล้ว')}</span>
                </div>
                {r.items.map((i) => (
                  <div key={i.id} className="flex items-baseline gap-2.5 py-1 text-[15px] text-ink-2">
                    <span className="min-w-[26px] font-semibold">{qtyText(i.qty)}×</span>
                    <span className="flex-1">
                      {i.name}
                      {i.modifiers.length > 0 && <span className="block text-[12px] text-muted">{i.modifiers.map((m) => m.name).join(' · ')}</span>}
                    </span>
                    <span className="num">{money(Math.round(i.qty * i.unitPrice))}</span>
                  </div>
                ))}
              </div>
            ))}
            {state.order && state.lines.length > 0 && (
              <div className="flex items-center justify-between pt-3.5 text-[12px] font-semibold text-primary">
                <span>{t('สั่งเพิ่มที่เคาน์เตอร์')}</span>
                <span className="rounded-full bg-soft px-2 py-0.5">{t('ยังไม่ส่งครัว')}</span>
              </div>
            )}
            {state.lines.map((l) => (
              <div key={l.id} className="flex items-center gap-3 border-b border-line-soft py-3">
                <button className="flex min-w-0 flex-1 flex-col gap-0.5 text-left" onClick={() => setEditLine(l.id)}>
                  <span className="text-[15px] font-medium">{l.name}</span>
                  <span className="num text-[13px] text-muted">
                    {money(l.unitPrice)}
                    {l.kind === 'weighted' ? ` × ${qtyText(l.qty)}` : ''}
                    {l.modifiers.length > 0 && ` · ${l.modifiers.map((m) => m.name).join(', ')}`}
                  </span>
                  {(l.note || l.discount || l.priceOverridden) && (
                    <span className="text-[12px] text-warn">
                      {[l.note && `* ${l.note}`, l.discount && t('ลด {0}', l.discount.kind === 'percent' ? l.discount.value + '%' : money(l.discount.value)), l.priceOverridden && t('แก้ราคา')].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </button>
                {l.kind === 'weighted' ? (
                  <button onClick={() => setEditLine(l.id)} className="num h-10 rounded-[10px] border border-line-strong px-3 text-[14px] font-semibold">{tn('{0} กก.', qtyText(l.qty))}</button>
                ) : (
                  <div className="flex items-center overflow-hidden rounded-[10px] border border-line-strong">
                    <button onClick={() => cart.inc(l.id, -1)} className="h-10 w-10 bg-sunken text-[18px]" aria-label={t('ลด {0}', l.name)}>
                      −
                    </button>
                    <span className="num w-[34px] text-center font-semibold">{qtyText(l.qty)}</span>
                    <button onClick={() => cart.inc(l.id, 1)} className="h-10 w-10 bg-sunken text-[18px]" aria-label={t('เพิ่ม {0}', l.name)}>
                      +
                    </button>
                  </div>
                )}
                <span className="num w-[76px] text-right font-semibold">{money(Math.round(l.unitPrice * l.qty))}</span>
              </div>
            ))}
            {cartEmpty && (
              <div className="flex flex-col items-center gap-1.5 px-3 py-14 text-center">
                <span className="text-[16px] font-semibold">{t('ยังไม่มีรายการ')}</span>
                <span className="text-[14px] text-muted [text-wrap:pretty]">{t('แตะสินค้าทางซ้าย หรือสแกนบาร์โค้ดได้ทันทีโดยไม่ต้องคลิกช่องค้นหา')}</span>
              </div>
            )}
          </div>
          <div className="num flex flex-col gap-2 border-t border-line-soft px-5 pb-5 pt-4">
            <SumRow label={t('ยอดรวม')} value={money(pricing.subtotal)} />
            {pricing.lineDiscountTotal > 0 && <SumRow label={t('ส่วนลดรายการ')} value={`-${money(pricing.lineDiscountTotal)}`} accent />}
            {pricing.appliedPromotions.map((p) => (
              <SumRow key={p.id} label={p.name} value={`-${money(p.amount)}`} accent />
            ))}
            {pricing.billDiscountTotal > 0 && (
              <SumRow
                label={state.billDiscount ? t('ส่วนลดท้ายบิล{0}', state.billDiscount.kind === 'percent' ? ` ${state.billDiscount.value}%` : '') : t('ส่วนลดสมาชิก {0}%', state.customer?.groupPercent)}
                value={`-${money(pricing.billDiscountTotal)}`}
                accent
              />
            )}
            {pricing.serviceCharge > 0 && <SumRow label={t('ค่าบริการ {0}%', settings.tax.serviceChargeRate)} value={money(pricing.serviceCharge)} />}
            {settings.tax.vatEnabled && <SumRow label={`VAT ${settings.tax.vatRate}%${settings.tax.pricesIncludeVat ? t(' (รวมในราคา)') : ''}`} value={money(pricing.vat)} />}
            {pricing.rounding !== 0 && <SumRow label={t('ปัดเศษ')} value={money(pricing.rounding)} />}
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-[16px] font-semibold">{t('ยอดชำระ')}</span>
              <span className="text-[30px] font-bold">{money(pricing.total)}</span>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <Button size="lg" onClick={() => setDialog('discount')} disabled={cartEmpty}>{t('ส่วนลดบิล')}</Button>
              <Button size="lg" onClick={() => setDialog('split')} disabled={itemCount < 2}>{t('แยกบิล')}</Button>
            </div>
            {state.order && state.order.items.length > 0 && (
              <Button size="lg" icon={<QrCode className="h-4 w-4" />} onClick={() => setSlip(true)}>{t('ใบแจ้งยอด + QR')}</Button>
            )}
            {state.order && (
              <Button variant="outline-primary" size="lg" className="h-[52px] font-semibold" disabled={!state.lines.length} loading={sending} icon={<Send className="h-4 w-4" />} onClick={() => void sendToKitchen()}>{tn('ส่งครัว · เพิ่มเข้าบิล{0}', state.order.name)}</Button>
            )}
            <Button variant="primary" size="xl" className="h-16 justify-between px-[22px]" disabled={cartEmpty || !can('pos.sell')} onClick={() => setDialog('pay')}>
              <span>{tn('ชำระเงิน {0}', money(pricing.total))}</span>
              <span className="font-mono text-[13px] font-medium opacity-80">{settings.pos.hotkeys.pay ?? 'F12'}</span>
            </Button>
          </div>
        </aside>
      </div>

      {optionsFor && <OptionsDialog product={optionsFor} catalog={catalog} tierId={tierId} onClose={() => setOptionsFor(null)} />}
      {editing && <LineDialog line={editing} onClose={() => setEditLine(null)} onApprove={(pin) => cart.patch({ managerPin: pin })} />}
      <CustomerDialog open={dialog === 'customer'} onClose={() => setDialog(null)} />
      <BillDiscountDialog open={dialog === 'discount'} onClose={() => setDialog(null)} onApprove={(pin) => cart.patch({ managerPin: pin })} />
      <BillPicker open={dialog === 'bills'} onClose={() => setDialog(null)} />
      <SplitDialog open={dialog === 'split'} onClose={() => setDialog(null)} />
      <PaymentDialog
        open={dialog === 'pay'}
        onClose={() => setDialog(null)}
        state={state}
        pricing={pricing}
        methods={catalog.paymentMethods}
        settings={settings}
        printers={printers.data ?? []}
        buildLines={buildLines}
        onDone={(d) => {
          setDialog(null);
          setDone(d);
          cart.clear();
          qc.invalidateQueries({ queryKey: ['shift'] });
          if (d.sale) qc.invalidateQueries({ queryKey: ['catalog'] });
          sendLive({ type: 'display.update', register: registerName(), payload: { state: 'done', lines: [], subtotal: 0, discount: 0, total: d.total, qr: null, change: d.change } });
        }}
      />
      <DoneDialog done={done} printers={printers.data ?? []} onClose={() => (setDone(null), searchRef.current?.focus())} />
      {slip && state.order && <BillSlipDialog orderId={state.order.id} customerId={state.customer?.id} onClose={() => setSlip(false)} />}
      <ApprovalHost />
      {needShift && <OpenShiftGate onOpened={() => void shift.refetch()} />}
    </div>
  );
}

function groupRounds(items: SentItem[]) {
  const m = new Map<number, SentItem[]>();
  for (const i of items) m.set(i.round, [...(m.get(i.round) ?? []), i]);
  return [...m.entries()].map(([round, its]) => ({
    round,
    items: its,
    by: its[0]?.by ?? '',
    time: new Date(its[0]!.createdAt).toTimeString().slice(0, 5),
    ready: its.every((i) => i.status === 'ready' || i.status === 'served'),
  }));
}

function SumRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between text-[14px] text-muted">
      <span className="truncate pr-2">{label}</span>
      <span className={cn(accent && 'text-primary')}>{value}</span>
    </div>
  );
}

const TINTS = ['#e9dfd2', '#efe3d3', '#dcebd6', '#f3e3c3', '#d9e8f2', '#e6e1f0', '#f6dccb', '#efe4c8'];

function ProductTile({ p, qty, onAdd, showImage }: { p: CatalogProduct; qty: number; onAdd: () => void; showImage: boolean }) {
  const tint = p.color || TINTS[p.name.length % TINTS.length]!;
  const out = p.stock !== null && p.stock <= 0;
  const low = p.stock !== null && !out && p.stock <= p.lowStock;
  return (
    <button onClick={onAdd} className="group flex flex-col overflow-hidden rounded-[14px] border border-line bg-surface text-left transition-[border,box-shadow,transform] hover:border-accent hover:shadow-lift active:scale-[.98]">
      <div className="relative flex h-[84px] items-end justify-between p-2.5" style={{ background: tint }}>
        {showImage && p.image && <img src={p.image} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />}
        <span className="relative font-mono text-[12px] font-semibold text-[rgb(23_25_28/0.55)]">{p.sku}</span>
        {qty > 0 && <span className="num relative grid h-[26px] min-w-[26px] place-items-center rounded-full bg-ink px-1.5 text-[13px] font-semibold text-surface">{qtyText(qty)}</span>}
      </div>
      <div className="flex flex-col gap-0.5 px-3 pb-3 pt-2.5">
        <span className="line-clamp-2 text-[15px] font-medium leading-[1.3]">{p.name}</span>
        <span className="flex items-center justify-between gap-1">
          <span className="num text-[15px] font-semibold text-primary">
            {p.variants.length > 1 ? `${money(Math.min(...p.variants.map((v) => v.price)))}+` : money(p.price)}
            {p.kind === 'weighted' && <span className="text-[12px] font-normal text-muted">/{p.unit}</span>}
          </span>
          {out ? <span className="text-[11px] font-semibold text-danger">{t('หมด')}</span> : low ? <span className="text-[11px] font-semibold text-warn">{tn('เหลือ {0}', qtyText(p.stock!))}</span> : null}
        </span>
      </div>
    </button>
  );
}

function ConnectionPill({ online, pending }: { online: boolean; pending: number }) {
  if (pending > 0)
    return (
      <button onClick={() => void syncOutbox().then((r) => r.sent && toast.success(t('ส่งบิลค้าง {0} บิลแล้ว', r.sent)))} className="flex flex-none items-center gap-2 whitespace-nowrap rounded-full bg-warn-soft px-3 py-2 text-[13px] font-medium text-warn">
        <CloudUpload className="h-4 w-4" />{t('รอส่ง')}{' '}{pending}{' '}{t('บิล')}</button>
    );
  return online ? (
    <div className="hidden flex-none items-center gap-2 whitespace-nowrap rounded-full bg-soft px-3 py-2 text-[13px] font-medium text-soft-fg md:flex">
      <span className="h-2 w-2 rounded-full bg-accent" />{t('ออนไลน์')}</div>
  ) : (
    <div className="flex flex-none items-center gap-2 whitespace-nowrap rounded-full bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger">
      <WifiOff className="h-4 w-4" />{t('ออฟไลน์')}</div>
  );
}
