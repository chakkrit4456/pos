import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Percent, Plus, X } from 'lucide-react';
import type { PromotionRule } from '@flexpos/shared';
import { api, errorMessage } from '@/lib/api';
import { money, useFormatters } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { Page } from '@/components/layout/AppShell';
import { Badge, Button, Checkbox, EmptyState, Field, Input, PageHeader, Select, SkeletonRows, Switch } from '@/components/ui/core';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { MoneyInput, NumberInput } from '@/components/ui/inputs';
import { ProductPicker } from '@/components/ProductPicker';
import { useCatalog } from '@/lib/catalog';

type Promo = PromotionRule & { usageCount: number; usageLimit: number };
type Edit = Omit<Promo, 'id' | 'usageCount'> & { id?: string };

const TYPE_LABEL: Record<PromotionRule['type'], string> = {
  percent: 'ลดเปอร์เซ็นต์',
  amount: 'ลดเป็นบาท',
  bxgy: 'ซื้อ X แถม Y',
  threshold: 'ซื้อครบยอด ลดเป็นบาท',
  fixed_price: 'ราคาพิเศษ',
};
const DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

const blank = (): Edit => ({
  name: '', type: 'percent', priority: 0, exclusive: false, value: 10, scope: 'items', productIds: [], categoryIds: [], customerGroupIds: [], branchIds: [],
  buyQty: 2, getQty: 1, getDiscountPercent: 100, minSubtotal: 0, maxDiscount: 0, couponCode: null, usageLimit: 0, startsAt: null, endsAt: null, daysOfWeek: [], timeFrom: null, timeTo: null, active: true,
});

function summary(p: Promo | Edit): string {
  switch (p.type) {
    case 'percent':
      return `ลด ${p.value}%${p.scope === 'bill' ? ' ทั้งบิล' : ''}${p.minSubtotal ? ` เมื่อซื้อครบ ${money(p.minSubtotal)}` : ''}`;
    case 'amount':
      return `ลด ${money(p.value)}${p.scope === 'bill' ? ' ต่อบิล' : ' ต่อชิ้น'}`;
    case 'bxgy':
      return `ซื้อ ${p.buyQty} ${p.getDiscountPercent >= 100 ? 'แถม' : `ลด ${p.getDiscountPercent}% อีก`} ${p.getQty}`;
    case 'threshold':
      return `ซื้อครบ ${money(p.minSubtotal)} ลด ${money(p.value)}`;
    case 'fixed_price':
      return `ราคาพิเศษ ${money(p.value)}/ชิ้น`;
  }
}

export default function PromotionsPage() {
  const qc = useQueryClient();
  const f = useFormatters();
  const list = useQuery({ queryKey: ['promotions'], queryFn: () => api.get<Promo[]>('/api/promotions') });
  const [edit, setEdit] = useState<Edit | null>(null);
  const toggle = async (p: Promo) => {
    try {
      const { id, usageCount: _u, ...rest } = p;
      await api.put(`/api/promotions/${id}`, { ...rest, active: !p.active });
      qc.invalidateQueries({ queryKey: ['promotions'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Page>
      <PageHeader title="โปรโมชั่น" sub="ระบบเลือกโปรตามลำดับความสำคัญ โปรที่ตั้ง “ไม่รวมกับโปรอื่น” จะใช้เดี่ยว" actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit(blank())}>สร้างโปรโมชั่น</Button>} />
      <div className="card overflow-hidden">
        {list.isLoading ? <SkeletonRows /> : !list.data?.length ? (
          <EmptyState icon={<Percent className="h-6 w-6" />} title="ยังไม่มีโปรโมชั่น" body="ส่วนลด % / บาท, ซื้อ X แถม Y, ซื้อครบยอด, ราคาพิเศษตามช่วงเวลา และคูปองโค้ด" action={<Button variant="primary" onClick={() => setEdit(blank())}>สร้างโปรแรก</Button>} />
        ) : list.data.map((p) => (
          <div key={p.id} className={cn('flex items-center gap-3 border-b border-line-soft px-5 py-3.5', !p.active && 'opacity-60')}>
            <button className="flex min-w-0 flex-1 flex-col text-left" onClick={() => { const { usageCount: _u, ...rest } = p; setEdit(rest); }}>
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {p.name}
                <Badge tone="info">{TYPE_LABEL[p.type]}</Badge>
                {p.couponCode && <Badge tone="dark">คูปอง {p.couponCode}</Badge>}
                {p.exclusive && <Badge tone="warn">ไม่รวมกับโปรอื่น</Badge>}
              </span>
              <span className="truncate text-[13px] text-muted">
                {summary(p)}
                {p.startsAt || p.endsAt ? ` · ${p.startsAt ? f.date(p.startsAt) : '…'} – ${p.endsAt ? f.date(p.endsAt) : '…'}` : ''}
                {p.timeFrom ? ` · ${p.timeFrom}-${p.timeTo}` : ''}
                {p.daysOfWeek.length ? ` · ${p.daysOfWeek.map((d) => DAYS[d]).join(' ')}` : ''}
                {` · ใช้ไป ${p.usageCount}${p.usageLimit ? `/${p.usageLimit}` : ''} ครั้ง`}
              </span>
            </button>
            <span className="text-[12px] text-muted">ลำดับ {p.priority}</span>
            <Switch size="sm" checked={p.active} onChange={() => void toggle(p)} label={`เปิดใช้ ${p.name}`} />
          </div>
        ))}
      </div>
      {edit && <PromoEditor value={edit} onClose={() => setEdit(null)} />}
    </Page>
  );
}

function PromoEditor({ value, onClose }: { value: Edit; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [p, setP] = useState<Edit>(value);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const { index } = useCatalog();
  const groups = useQuery({ queryKey: ['customer-groups'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/customer-groups') });
  const set = <K extends keyof Edit>(k: K, v: Edit[K]) => setP((x) => ({ ...x, [k]: v }));
  const cats = index?.catalog.categories ?? [];
  const toDateInput = (s: string | null) => (s ? s.slice(0, 10) : '');
  const save = async () => {
    setBusy(true);
    try {
      const { id, ...body } = p;
      if (id) await api.put(`/api/promotions/${id}`, body);
      else await api.post('/api/promotions', body);
      toast.success('บันทึกโปรโมชั่นแล้ว');
      qc.invalidateQueries({ queryKey: ['promotions'] });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const itemScoped = p.type === 'bxgy' || p.type === 'fixed_price' || ((p.type === 'percent' || p.type === 'amount') && p.scope === 'items');
  return (
    <>
      <Dialog
        open
        onOpenChange={(v) => !v && onClose()}
        title={p.id ? 'แก้ไขโปรโมชั่น' : 'สร้างโปรโมชั่น'}
        description={summary(p)}
        size="lg"
        footer={
          <>
            {p.id && (
              <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { const r = await confirm({ title: `ลบ “${p.name}”?`, danger: true, confirmText: 'ลบ' }); if (!r.ok) return; await api.del(`/api/promotions/${p.id}`); qc.invalidateQueries({ queryKey: ['promotions'] }); onClose(); }}>ลบ</Button>
            )}
            <Button onClick={onClose}>ยกเลิก</Button>
            <Button variant="primary" loading={busy} disabled={!p.name.trim()} onClick={() => void save()}>บันทึก</Button>
          </>
        }
      >
        <div className="grid gap-4 pb-3 md:grid-cols-2">
          <Field label="ชื่อโปรโมชั่น (แสดงบนใบเสร็จ)" required className="md:col-span-2"><Input autoFocus value={p.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="รูปแบบ">
            <Select value={p.type} onChange={(e) => set('type', e.target.value as Edit['type'])}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          {(p.type === 'percent' || p.type === 'amount') && (
            <Field label="ใช้กับ">
              <Select value={p.scope} onChange={(e) => set('scope', e.target.value as Edit['scope'])}>
                <option value="items">สินค้าที่เลือก (ทุกชิ้น)</option>
                <option value="bill">ทั้งบิล</option>
              </Select>
            </Field>
          )}
          {p.type === 'percent' && <Field label="ส่วนลด (%)"><NumberInput decimals={2} value={p.value} onValue={(v) => set('value', Math.min(100, v))} /></Field>}
          {(p.type === 'amount' || p.type === 'threshold') && <Field label={p.type === 'amount' && p.scope === 'items' ? 'ลดต่อชิ้น' : 'ลด (บาท)'}><MoneyInput value={p.value} onValue={(v) => set('value', v)} /></Field>}
          {p.type === 'fixed_price' && <Field label="ราคาพิเศษต่อชิ้น"><MoneyInput value={p.value} onValue={(v) => set('value', v)} /></Field>}
          {p.type === 'bxgy' && (
            <div className="grid grid-cols-3 gap-2 md:col-span-2">
              <Field label="ซื้อ (ชิ้น)"><NumberInput value={p.buyQty} onValue={(v) => set('buyQty', v)} /></Field>
              <Field label="ได้อีก (ชิ้น)"><NumberInput value={p.getQty} onValue={(v) => set('getQty', v)} /></Field>
              <Field label="ลดชิ้นที่ได้ (%)" hint="100 = แถมฟรี"><NumberInput value={p.getDiscountPercent} onValue={(v) => set('getDiscountPercent', Math.min(100, v))} /></Field>
            </div>
          )}
          <Field label={p.type === 'threshold' ? 'ยอดซื้อขั้นต่ำ' : 'ยอดซื้อขั้นต่ำ (ถ้ามี)'} required={p.type === 'threshold'}><MoneyInput value={p.minSubtotal} onValue={(v) => set('minSubtotal', v)} /></Field>
          <Field label="ลดสูงสุด" hint="0 = ไม่จำกัด"><MoneyInput value={p.maxDiscount} onValue={(v) => set('maxDiscount', v)} /></Field>

          {itemScoped && (
            <div className="flex flex-col gap-2 rounded-xl bg-sunken p-3 md:col-span-2">
              <span className="text-[13px] font-semibold text-muted">สินค้าที่ร่วมรายการ (ไม่เลือก = ทุกสินค้า)</span>
              <div className="flex flex-wrap gap-1.5">
                {cats.filter((c) => !c.parentId).map((c) => (
                  <button key={c.id} onClick={() => set('categoryIds', p.categoryIds.includes(c.id) ? p.categoryIds.filter((x) => x !== c.id) : [...p.categoryIds, c.id])} className={cn('h-9 rounded-full border px-3 text-[13px]', p.categoryIds.includes(c.id) ? 'border-primary bg-soft text-soft-fg' : 'border-line-strong bg-surface')}>
                    หมวด {c.name}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {p.productIds.map((id) => (
                  <span key={id} className="flex items-center gap-1 rounded-full bg-surface px-3 py-1 text-[13px]">
                    {index?.byId.get(id)?.name ?? 'สินค้าที่ถูกลบ'}
                    <button aria-label="นำออก" onClick={() => set('productIds', p.productIds.filter((x) => x !== id))}><X className="h-3.5 w-3.5" /></button>
                  </span>
                ))}
                <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setPicker(true)}>เลือกสินค้า</Button>
              </div>
            </div>
          )}

          <Field label="วันเริ่ม"><Input type="date" value={toDateInput(p.startsAt)} onChange={(e) => set('startsAt', e.target.value ? new Date(e.target.value + 'T00:00:00').toISOString() : null)} /></Field>
          <Field label="วันสิ้นสุด"><Input type="date" value={toDateInput(p.endsAt)} onChange={(e) => set('endsAt', e.target.value ? new Date(e.target.value + 'T23:59:59').toISOString() : null)} /></Field>
          <Field label="ช่วงเวลา (เช่น Happy hour)">
            <div className="flex items-center gap-2">
              <Input type="time" value={p.timeFrom ?? ''} onChange={(e) => set('timeFrom', e.target.value || null)} />
              <span>–</span>
              <Input type="time" value={p.timeTo ?? ''} onChange={(e) => set('timeTo', e.target.value || null)} />
            </div>
          </Field>
          <Field label="เฉพาะวัน (ไม่เลือก = ทุกวัน)">
            <div className="flex flex-wrap gap-1">
              {DAYS.map((d, i) => (
                <button key={d} onClick={() => set('daysOfWeek', p.daysOfWeek.includes(i) ? p.daysOfWeek.filter((x) => x !== i) : [...p.daysOfWeek, i])} className={cn('h-10 w-10 rounded-xl border text-[13px]', p.daysOfWeek.includes(i) ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong')}>
                  {d}
                </button>
              ))}
            </div>
          </Field>
          <Field label="รหัสคูปอง" hint="เว้นว่าง = ใช้อัตโนมัติ"><Input value={p.couponCode ?? ''} onChange={(e) => set('couponCode', e.target.value.toUpperCase() || null)} className="font-mono" /></Field>
          <Field label="จำกัดจำนวนครั้ง" hint="0 = ไม่จำกัด"><NumberInput value={p.usageLimit} onValue={(v) => set('usageLimit', Math.max(0, v))} /></Field>
          <Field label="ลำดับความสำคัญ" hint="เลขมากใช้ก่อน"><NumberInput value={p.priority} onValue={(v) => set('priority', v)} /></Field>
          {(groups.data?.length ?? 0) > 0 && (
            <Field label="เฉพาะกลุ่มลูกค้า (ไม่เลือก = ทุกคน)">
              <div className="flex flex-col">
                {groups.data!.map((g) => <Checkbox key={g.id} checked={p.customerGroupIds.includes(g.id)} onChange={(v) => set('customerGroupIds', v ? [...p.customerGroupIds, g.id] : p.customerGroupIds.filter((x) => x !== g.id))} label={g.name} />)}
              </div>
            </Field>
          )}
          <div className="flex flex-col gap-2 md:col-span-2">
            <Checkbox checked={p.exclusive} onChange={(v) => set('exclusive', v)} label="ไม่รวมกับโปรโมชั่นอื่น (ถ้าโปรนี้ใช้ได้ จะไม่ใช้โปรอื่นเพิ่ม)" />
            <Checkbox checked={p.active} onChange={(v) => set('active', v)} label="เปิดใช้งาน" />
          </div>
        </div>
      </Dialog>
      <ProductPicker open={picker} onClose={() => setPicker(false)} onPick={(x) => { if (!p.productIds.includes(x.productId)) set('productIds', [...p.productIds, x.productId]); setPicker(false); }} />
    </>
  );
}
