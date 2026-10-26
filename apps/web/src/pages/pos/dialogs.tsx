import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Minus, Plus, Search, Trash2, UserPlus } from 'lucide-react';
import { editionAllows, resolveBasePrice, type Catalog, type CatalogProduct, type Discount, type Permission, t } from '@flexpos/shared';
import { api, errorMessage } from '@/lib/api';
import { money } from '@/lib/settings';
import { useSession } from '@/lib/session';
import { cn, qtyText } from '@/lib/utils';
import { Button, Field, Input, Segmented, Badge, EmptyState, Spinner } from '@/components/ui/core';
import { Dialog } from '@/components/ui/dialog';
import { MoneyInput, NumberInput, PinPad } from '@/components/ui/inputs';
import { cart, type CartCustomer, type CartLineState, type CartModifier } from './cart';
import { tn } from '@/lib/i18n';

/* ---------- Product options: variants, units, modifiers, qty, note ---------- */

export function OptionsDialog({ product, catalog, tierId, onClose }: { product: CatalogProduct | null; catalog: Catalog; tierId: string | null; onClose: () => void }) {
  const [variantId, setVariantId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [mods, setMods] = useState<CartModifier[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [openPrice, setOpenPrice] = useState(0);

  useEffect(() => {
    if (!product) return;
    setVariantId(product.variants.length === 1 ? product.variants[0]!.id : null);
    setUnitId(null);
    setQty(product.kind === 'weighted' ? 1 : 1);
    setNote('');
    setOpenPrice(product.price);
    // Preselect the first option of required single-choice groups.
    const groups = catalog.modifierGroups.filter((g) => product.modifierGroupIds.includes(g.id));
    setMods(groups.filter((g) => g.minSelect >= 1 && g.maxSelect === 1 && g.modifiers[0]).map((g) => g.modifiers[0]!));
  }, [product, catalog.modifierGroups]);

  if (!product) return null;
  const groups = catalog.modifierGroups.filter((g) => product.modifierGroupIds.includes(g.id));
  const base = product.kind === 'open_price' ? openPrice : resolveBasePrice(product, { variantId, unitId, tierId });
  const unitPrice = base + mods.reduce((a, m) => a + m.priceDelta, 0);
  const missing = groups.find((g) => mods.filter((m) => g.modifiers.some((x) => x.id === m.id)).length < g.minSelect);
  const needVariant = product.variants.length > 0 && !variantId;
  const weighted = product.kind === 'weighted';

  const toggle = (gId: string, m: CartModifier) => {
    const g = groups.find((x) => x.id === gId)!;
    const inGroup = mods.filter((x) => g.modifiers.some((y) => y.id === x.id));
    const has = mods.some((x) => x.id === m.id);
    if (has) setMods(mods.filter((x) => x.id !== m.id));
    else if (g.maxSelect === 1) setMods([...mods.filter((x) => !inGroup.includes(x)), m]);
    else if (g.maxSelect === 0 || inGroup.length < g.maxSelect) setMods([...mods, m]);
    else toast.info(t('“{0}” เลือกได้สูงสุด {1}', g.name, g.maxSelect));
  };

  const add = () => {
    const v = product.variants.find((x) => x.id === variantId);
    const u = product.units.find((x) => x.id === unitId);
    cart.add({
      productId: product.id,
      variantId,
      unitId,
      name: v ? `${product.name} (${v.name})` : u ? `${product.name} (${u.name})` : product.name,
      sku: v?.sku || product.sku,
      qty,
      unitPrice,
      priceOverridden: false,
      modifiers: mods,
      note: note.trim(),
      discount: null,
      categoryId: product.categoryId,
      taxable: product.taxable,
      kind: product.kind,
    });
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={product.name}
      description={product.sku ? `${product.sku}${weighted ? ` · ${money(product.price)}/${product.unit}` : ''}` : undefined}
      size="md"
      footer={
        <>
          <div className="mr-auto flex items-center gap-2">
            <QtyStepper value={qty} onChange={setQty} decimals={weighted ? 3 : 0} />
            {weighted && <span className="text-[14px] text-muted">{product.unit}</span>}
          </div>
          <Button variant="primary" size="lg" disabled={needVariant || !!missing || qty <= 0} onClick={add} className="min-w-[180px] justify-between">
            <span>{t('เพิ่มลงบิล')}</span>
            <span className="num">{money(Math.round(unitPrice * qty))}</span>
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 pb-2">
        {weighted && (
          <OptionGroup label={t('น้ำหนัก')}>
            {[0.1, 0.25, 0.5, 1, 2].map((w) => (
              <OptionButton key={w} active={qty === w} onClick={() => setQty(w)}>
                <span>{qtyText(w)} {product.unit}</span>
                <span className="num text-[13px] opacity-75">{money(Math.round(unitPrice * w))}</span>
              </OptionButton>
            ))}
          </OptionGroup>
        )}
        {weighted && (
          <Field label={t('หรือใส่น้ำหนักเป็นกรัม')}>
            <NumberInput autoFocus value={Math.round(qty * 1000)} onValue={(g) => setQty(Math.max(0, g) / 1000)} className="h-12 text-[18px]" />
          </Field>
        )}
        {product.kind === 'open_price' && (
          <Field label={t('ราคา (ราคาเปิด)')}>
            <MoneyInput autoFocus value={openPrice} onValue={setOpenPrice} className="h-12 text-[18px]" />
          </Field>
        )}
        {product.variants.length > 0 && (
          <OptionGroup label={t('ตัวเลือกสินค้า')} required>
            {product.variants.map((v) => (
              <OptionButton key={v.id} active={variantId === v.id} onClick={() => setVariantId(v.id)}>
                <span>{v.name}</span>
                <span className="num text-[13px] opacity-75">{money(v.price)}{v.stock !== null ? t(' · เหลือ {0}', qtyText(v.stock)) : ''}</span>
              </OptionButton>
            ))}
          </OptionGroup>
        )}
        {product.units.length > 0 && (
          <OptionGroup label={t('หน่วยขาย')}>
            <OptionButton active={!unitId} onClick={() => setUnitId(null)}>
              <span>{product.unit}</span>
              <span className="num text-[13px] opacity-75">{money(product.price)}</span>
            </OptionButton>
            {product.units.map((u) => (
              <OptionButton key={u.id} active={unitId === u.id} onClick={() => setUnitId(u.id)}>
                <span>{u.name} ({qtyText(u.factor)} {product.unit})</span>
                <span className="num text-[13px] opacity-75">{money(u.price)}</span>
              </OptionButton>
            ))}
          </OptionGroup>
        )}
        {groups.map((g) => (
          <OptionGroup key={g.id} label={g.name} required={g.minSelect > 0} hint={g.maxSelect > 1 ? t('เลือกได้สูงสุด {0}', g.maxSelect) : g.maxSelect === 0 ? t('เลือกได้หลายอย่าง') : undefined}>
            {g.modifiers.map((m) => (
              <OptionButton key={m.id} active={mods.some((x) => x.id === m.id)} onClick={() => toggle(g.id, m)}>
                <span>{m.name}</span>
                {m.priceDelta !== 0 && <span className="num text-[13px] opacity-75">+{money(m.priceDelta)}</span>}
              </OptionButton>
            ))}
          </OptionGroup>
        ))}
        <Field label={editionAllows('restaurant') ? t('หมายเหตุ (ส่งถึงครัว/พิมพ์บนใบเสร็จ)') : t('หมายเหตุ')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={editionAllows('restaurant') ? t('เช่น ไม่ใส่น้ำแข็ง') : undefined} maxLength={300} />
        </Field>
      </div>
    </Dialog>
  );
}

function OptionGroup({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[14px] font-semibold">
        {label}
        {required && <Badge tone="warn">{t('ต้องเลือก')}</Badge>}
        {hint && <span className="text-[12px] font-normal text-muted">{hint}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>
    </div>
  );
}

function OptionButton({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-pressed={active} className={cn('flex min-h-[56px] flex-col items-start justify-center gap-0.5 rounded-xl border px-3 py-2 text-left text-[15px] font-medium transition-colors disabled:opacity-40', active ? 'border-primary bg-soft text-soft-fg ring-1 ring-primary' : 'border-line-strong bg-surface hover:bg-sunken')}>
      {children}
    </button>
  );
}

export function QtyStepper({ value, onChange, decimals = 0, min = decimals ? 0.001 : 1 }: { value: number; onChange: (v: number) => void; decimals?: number; min?: number }) {
  const step = decimals ? 0.1 : 1;
  return (
    <div className="flex items-center overflow-hidden rounded-xl border border-line-strong">
      <button type="button" aria-label={t('ลดจำนวน')} onClick={() => onChange(Math.max(min, Math.round((value - step) * 1000) / 1000))} className="grid h-11 w-11 place-items-center bg-sunken hover:bg-line-soft">
        <Minus className="h-4 w-4" />
      </button>
      <NumberInput value={value} onValue={(v) => onChange(Math.max(0, v))} decimals={decimals} className="h-11 w-16 rounded-none border-0 text-center font-semibold focus:ring-0" aria-label={t('จำนวน')} />
      <button type="button" aria-label={t('เพิ่มจำนวน')} onClick={() => onChange(Math.round((value + step) * 1000) / 1000)} className="grid h-11 w-11 place-items-center bg-sunken hover:bg-line-soft">
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ---------- Manager PIN approval ---------- */

let pinRequest: ((r: { perm: Permission; reason: string }) => Promise<string | null>) | null = null;

/** Ask for a manager PIN when the current user lacks `perm`. Resolves to the PIN (or '' if not needed), or null when cancelled. */
export function useApproval() {
  const { can } = useSession();
  return async (perm: Permission, reason: string): Promise<string | null> => {
    if (can(perm)) return '';
    if (!pinRequest) return null;
    return pinRequest({ perm, reason });
  };
}

export function ApprovalHost() {
  const [req, setReq] = useState<{ perm: Permission; reason: string; resolve: (v: string | null) => void } | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pinRequest = (r) => new Promise((resolve) => setReq({ ...r, resolve }));
    return () => {
      pinRequest = null;
    };
  }, []);
  if (!req) return null;
  const close = (v: string | null) => {
    req.resolve(v);
    setReq(null);
    setError(undefined);
  };
  return (
    <Dialog open onOpenChange={(v) => !v && close(null)} title={t('ต้องให้ผู้จัดการอนุมัติ')} description={req.reason} size="sm">
      <div className="py-2">
        <PinPad
          busy={busy}
          error={error}
          onComplete={async (pin) => {
            setBusy(true);
            try {
              const r = await api.post<{ name: string; permissions: string[] }>('/api/auth/verify-pin', { pin });
              if (!r.permissions.includes(req.perm)) setError(t('{0} ไม่มีสิทธิ์อนุมัติรายการนี้', r.name));
              else {
                toast.success(t('อนุมัติโดย {0}', r.name));
                close(pin);
              }
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    </Dialog>
  );
}

/* ---------- Edit a cart line ---------- */

export function LineDialog({ line, onClose, onApprove }: { line: CartLineState | null; onClose: () => void; onApprove: (pin: string) => void }) {
  const approve = useApproval();
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);
  const [note, setNote] = useState('');
  const [disc, setDisc] = useState<Discount>({ kind: 'amount', value: 0 });
  useEffect(() => {
    if (!line) return;
    setQty(line.qty);
    setPrice(line.unitPrice);
    setNote(line.note);
    setDisc(line.discount ?? { kind: 'percent', value: 0 });
  }, [line]);
  if (!line) return null;
  const save = async () => {
    const priceChanged = price !== line.unitPrice && line.kind !== 'open_price';
    const discChanged = disc.value > 0 && JSON.stringify(disc) !== JSON.stringify(line.discount);
    if (priceChanged) {
      const pin = await approve('pos.price_override', t('แก้ราคา {0} เป็น {1}', line.name, money(price)));
      if (pin === null) return;
      if (pin) onApprove(pin);
    }
    if (discChanged) {
      const pin = await approve('pos.discount', t('ให้ส่วนลด {0}', line.name));
      if (pin === null) return;
      if (pin) onApprove(pin);
    }
    cart.update(line.id, {
      qty,
      unitPrice: price,
      priceOverridden: line.priceOverridden || priceChanged,
      note: note.trim(),
      discount: disc.value > 0 ? disc : null,
    });
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={line.name}
      size="sm"
      footer={
        <>
          <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => (cart.remove(line.id), onClose())}>{t('ลบรายการ')}</Button>
          <Button onClick={onClose}>{t('ยกเลิก')}</Button>
          <Button variant="primary" onClick={save}>{t('บันทึก')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <Field label={t('จำนวน')}>
          <QtyStepper value={qty} onChange={setQty} decimals={line.kind === 'weighted' ? 3 : 0} />
        </Field>
        <Field label={t('ราคาต่อหน่วย')} hint={line.kind === 'open_price' ? t('สินค้าราคาเปิด') : t('การแก้ราคาจะถูกบันทึกในประวัติการใช้งาน')}>
          <MoneyInput value={price} onValue={setPrice} />
        </Field>
        <Field label={t('ส่วนลดรายการ')}>
          <div className="flex gap-2">
            <Segmented value={disc.kind} onChange={(kind) => setDisc({ ...disc, kind })} options={[{ value: 'percent', label: '%' }, { value: 'amount', label: t('฿') }]} />
            {disc.kind === 'percent' ? (
              <NumberInput className="flex-1 text-right" decimals={2} value={disc.value} onValue={(value) => setDisc({ ...disc, value: Math.min(100, value) })} />
            ) : (
              <div className="flex-1">
                <MoneyInput value={disc.value} onValue={(value) => setDisc({ ...disc, value })} />
              </div>
            )}
          </div>
        </Field>
        <Field label={t('หมายเหตุ')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
      </div>
    </Dialog>
  );
}

/* ---------- Bill discount & coupon ---------- */

export function BillDiscountDialog({ open, onClose, onApprove }: { open: boolean; onClose: () => void; onApprove: (pin: string) => void }) {
  const approve = useApproval();
  const [d, setD] = useState<Discount>({ kind: 'percent', value: 0 });
  const [code, setCode] = useState('');
  useEffect(() => {
    if (open) {
      setD(cart.get().billDiscount ?? { kind: 'percent', value: 0 });
      setCode('');
    }
  }, [open]);
  const coupons = cart.get().couponCodes;
  const presets = [5, 10, 15, 20];
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={t('ส่วนลดท้ายบิล')}
      size="sm"
      footer={
        <>
          {cart.get().billDiscount && (
            <Button variant="ghost" className="mr-auto text-danger" onClick={() => (cart.patch({ billDiscount: null }), onClose())}>{t('ล้างส่วนลด')}</Button>
          )}
          <Button onClick={onClose}>{t('ยกเลิก')}</Button>
          <Button
            variant="primary"
            onClick={async () => {
              if (d.value > 0) {
                const pin = await approve('pos.discount', t('ให้ส่วนลดท้ายบิล'));
                if (pin === null) return;
                if (pin) onApprove(pin);
              }
              cart.patch({ billDiscount: d.value > 0 ? d : null });
              onClose();
            }}
          >{t('ใช้ส่วนลด')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <Segmented value={d.kind} onChange={(kind) => setD({ kind, value: 0 })} options={[{ value: 'percent', label: t('เปอร์เซ็นต์') }, { value: 'amount', label: t('จำนวนเงิน') }]} />
        {d.kind === 'percent' ? (
          <>
            <div className="grid grid-cols-4 gap-2">
              {presets.map((p) => (
                <Button key={p} variant={d.value === p ? 'primary' : 'secondary'} onClick={() => setD({ ...d, value: p })}>
                  {p}%
                </Button>
              ))}
            </div>
            <NumberInput className="h-12 text-right text-[18px]" decimals={2} value={d.value} onValue={(value) => setD({ ...d, value: Math.min(100, value) })} aria-label={t('ส่วนลด %')} />
          </>
        ) : (
          <MoneyInput className="h-12 text-[18px]" value={d.value} onValue={(value) => setD({ ...d, value })} aria-label={t('ส่วนลด บาท')} />
        )}
        <Field label={t('คูปองโปรโมชั่น')}>
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t('กรอกรหัสคูปอง')} />
            <Button
              disabled={!code.trim()}
              onClick={() => {
                if (!coupons.includes(code.trim())) cart.patch({ couponCodes: [...coupons, code.trim()] });
                setCode('');
                toast.success(t('เพิ่มคูปองแล้ว ระบบจะใช้ส่วนลดเมื่อเงื่อนไขครบ'));
              }}
            >{t('เพิ่ม')}</Button>
          </div>
          {coupons.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {coupons.map((c) => (
                <button key={c} onClick={() => cart.patch({ couponCodes: coupons.filter((x) => x !== c) })} className="rounded-full bg-soft px-3 py-1 font-mono text-[13px] text-soft-fg" title={t('แตะเพื่อลบ')}>
                  {c} ✕
                </button>
              ))}
            </div>
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/* ---------- Member picker ---------- */

interface CustomerRow {
  id: string;
  code: string;
  name: string;
  phone: string;
  points: number;
  credit_balance: number;
  group_id: string | null;
  group_name: string | null;
  discount_percent: number | null;
  tier_name: string | null;
  tax_id: string;
}

export function CustomerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '' });
  const { can } = useSession();
  const list = useQuery({
    queryKey: ['customers', 'pick', q],
    queryFn: () => api.get<{ items: CustomerRow[] }>('/api/customers', { q, pageSize: 20 }),
    enabled: open,
  });
  const groups = useQuery({ queryKey: ['customer-groups'], queryFn: () => api.get<{ id: string; price_tier_id: string | null }[]>('/api/customer-groups'), enabled: open });
  useEffect(() => {
    if (open) {
      setQ('');
      setCreating(false);
    }
  }, [open]);

  const pick = async (id: string) => {
    const c = await api.get<{ id: string; name: string; phone: string; points: number; groupId: string | null; creditBalance: number; creditLimit: number; taxId: string; taxName: string; taxBranch: string; address: string }>(`/api/customers/${id}`);
    const row = list.data?.items.find((r) => r.id === id);
    const g = groups.data?.find((x) => x.id === c.groupId);
    const customer: CartCustomer = {
      id: c.id,
      name: c.name,
      phone: c.phone,
      points: c.points,
      groupId: c.groupId,
      groupPercent: row?.discount_percent ?? 0,
      priceTierId: g?.price_tier_id ?? null,
      creditBalance: c.creditBalance,
      creditLimit: c.creditLimit,
      taxId: c.taxId,
      taxName: c.taxName || c.name,
      taxBranch: c.taxBranch,
      address: c.address,
    };
    cart.patch({ customer, pointsRedeemed: 0 });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title={t('เลือกสมาชิก')} description={t('ค้นหาด้วยชื่อ เบอร์โทร หรือรหัสสมาชิก')} size="md">
      {creating ? (
        <form
          className="flex flex-col gap-4 pb-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await api.post<{ id: string }>('/api/customers', { name: form.name, phone: form.phone });
              await list.refetch();
              await pick(r.id);
              toast.success(t('สมัครสมาชิกแล้ว'));
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          <Field label={t('ชื่อ')} required>
            <Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t('เบอร์โทร')}>
            <Input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCreating(false)}>{t('ย้อนกลับ')}</Button>
            <Button type="submit" variant="primary" disabled={!form.name.trim()}>{t('สมัครและเลือก')}</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3 pb-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <Input autoFocus className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ชื่อ / เบอร์โทร / รหัส')} />
            </div>
            {can('customers.manage') && (
              <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => (setCreating(true), setForm({ name: /^\d+$/.test(q) ? '' : q, phone: /^\d+$/.test(q) ? q : '' }))}>{t('สมัครใหม่')}</Button>
            )}
          </div>
          <div className="flex min-h-[240px] flex-col">
            {list.isLoading ? (
              <div className="grid flex-1 place-items-center">
                <Spinner />
              </div>
            ) : list.data?.items.length ? (
              list.data.items.map((c) => (
                <button key={c.id} onClick={() => void pick(c.id)} className="flex items-center gap-3 border-b border-line-soft px-2 py-3 text-left hover:bg-sunken">
                  <div className="flex flex-1 flex-col">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-[13px] text-muted">
                      {c.phone || '-'} · {c.code}
                      {c.group_name ? ` · ${c.group_name}` : ''}
                    </span>
                  </div>
                  {c.credit_balance > 0 && <Badge tone="warn">{tn('ค้าง {0}', money(c.credit_balance))}</Badge>}
                  <span className="num text-[14px] font-semibold text-primary">{tn('{0} แต้ม', c.points.toLocaleString())}</span>
                </button>
              ))
            ) : (
              <EmptyState title={t('ไม่พบสมาชิก')} body={q ? t('ไม่พบ “{0}” ลองค้นด้วยเบอร์โทร หรือกด “สมัครใหม่”', q) : t('ยังไม่มีสมาชิก')} />
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function useCatalogTier(customer: CartCustomer | null) {
  return useMemo(() => customer?.priceTierId ?? null, [customer?.priceTierId]);
}
