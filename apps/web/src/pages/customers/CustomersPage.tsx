import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Search, Trash2, Wallet } from 'lucide-react';
import { initials } from '@flexpos/shared';
import { api, errorMessage } from '@/lib/api';
import { money, useFormatters, useSettings } from '@/lib/settings';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Page } from '@/components/layout/AppShell';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, Segmented, Select, SkeletonRows, Spinner, Textarea } from '@/components/ui/core';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { MoneyInput, NumberInput } from '@/components/ui/inputs';
import { CustomFieldInput, type CustomFieldDef } from '../products/ProductEditor';

interface Row {
  id: string;
  code: string;
  name: string;
  phone: string;
  points: number;
  credit_balance: number;
  total_spent: number;
  visit_count: number;
  last_visit_at: string | null;
  group_name: string | null;
  tier_name: string | null;
}

interface Detail {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string;
  birthday: string;
  groupId: string | null;
  tierId: string | null;
  points: number;
  creditBalance: number;
  creditLimit: number;
  taxId: string;
  taxBranch: string;
  taxName: string;
  address: string;
  note: string;
  custom: Record<string, unknown>;
  totalSpent: number;
  visitCount: number;
  lastVisitAt: string | null;
  createdAt: string;
  pointMoves: { id: string; points: number; type: string; note: string; created_at: string }[];
  creditMoves: { id: string; amount: number; type: string; note: string; method: string; created_at: string }[];
  sales: { id: string; doc_no: string; type: string; status: string; total: number; created_at: string }[];
}

export default function CustomersPage() {
  const [tab, setTab] = useState<'list' | 'groups'>('list');
  return (
    <Page>
      <Segmented className="self-start" value={tab} onChange={setTab} options={[{ value: 'list', label: 'สมาชิก' }, { value: 'groups', label: 'กลุ่มและระดับ' }]} />
      {tab === 'list' ? <List /> : <Groups />}
    </Page>
  );
}

function List() {
  const f = useFormatters();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [debt, setDebt] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const list = useQuery({ queryKey: ['customers', q, debt, page], queryFn: () => api.get<{ total: number; items: Row[] }>('/api/customers', { q, debt: debt ? 1 : undefined, page, pageSize: 50 }), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="สมาชิก" sub={list.data ? `${list.data.total.toLocaleString()} คน` : ' '} actions={can('customers.manage') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen('new')}>เพิ่มสมาชิก</Button>} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 md:max-w-[360px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input className="pl-9" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="ชื่อ เบอร์โทร รหัส หรือเลขผู้เสียภาษี" />
        </div>
        <button onClick={() => (setDebt(!debt), setPage(1))} className={cn('h-10 rounded-full border px-3.5 text-[14px] font-medium', debt ? 'border-ink bg-ink text-surface' : 'border-line-strong bg-surface')}>มียอดค้างชำระ</button>
      </div>
      <div className="card overflow-hidden">
        {list.isLoading ? <SkeletonRows /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !list.data?.items.length ? (
          <EmptyState title={q ? 'ไม่พบสมาชิก' : 'ยังไม่มีสมาชิก'} body={q ? `ไม่พบ “${q}”` : 'สมัครสมาชิกได้จากหน้าขาย หรือกด “เพิ่มสมาชิก”'} />
        ) : (
          list.data.items.map((c) => (
            <button key={c.id} onClick={() => setOpen(c.id)} className="flex w-full items-center gap-3.5 border-b border-line-soft px-5 py-3 text-left hover:bg-sunken">
              <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-soft text-[14px] font-semibold text-soft-fg">{initials(c.name)}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{c.name}</span>
                <span className="truncate text-[13px] text-muted">{c.phone || '—'} · {c.code}{c.group_name ? ` · ${c.group_name}` : ''}{c.tier_name ? ` · ${c.tier_name}` : ''}</span>
              </span>
              {c.credit_balance > 0 && <Badge tone="warn">ค้าง {money(c.credit_balance)}</Badge>}
              <span className="hidden flex-col items-end md:flex">
                <span className="num text-[14px] font-semibold">{money(c.total_spent)}</span>
                <span className="text-[12px] text-muted">{c.visit_count} ครั้ง{c.last_visit_at ? ` · ล่าสุด ${f.date(c.last_visit_at)}` : ''}</span>
              </span>
              <span className="num w-20 text-right text-[14px] font-semibold text-primary">{c.points.toLocaleString()} แต้ม</span>
            </button>
          ))
        )}
        <Pagination page={page} pageSize={50} total={list.data?.total ?? 0} onPage={setPage} />
      </div>
      {open && <CustomerPanel id={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
    </>
  );
}

function CustomerPanel({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const f = useFormatters();
  const settings = useSettings();
  const { can } = useSession();
  const [tab, setTab] = useState<'info' | 'history' | 'points' | 'credit'>('info');
  const detail = useQuery({ queryKey: ['customer', id], queryFn: () => api.get<Detail>(`/api/customers/${id}`), enabled: !!id });
  const groups = useQuery({ queryKey: ['customer-groups'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/customer-groups') });
  const tiers = useQuery({ queryKey: ['member-tiers'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/member-tiers') });
  const fields = useQuery({ queryKey: ['custom-fields', 'customer'], queryFn: () => api.get<CustomFieldDef[]>('/api/custom-fields', { entity: 'customer' }) });
  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: () => api.get<{ code: string; name: string; kind: string; active: boolean }[]>('/api/payment-methods') });
  const [form, setForm] = useState<Partial<Detail>>({ custom: {} });
  const [busy, setBusy] = useState(false);
  const [adj, setAdj] = useState({ points: 0, note: '' });
  const [pay, setPay] = useState({ amount: 0, methodCode: 'cash' });
  useEffect(() => {
    if (detail.data) setForm(detail.data);
  }, [detail.data]);
  const manage = can('customers.manage');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['customer', id] });
    qc.invalidateQueries({ queryKey: ['customers'] });
  };
  const save = async () => {
    setBusy(true);
    try {
      const body = { name: form.name, code: form.code ?? '', phone: form.phone ?? '', email: form.email ?? '', birthday: form.birthday ?? '', groupId: form.groupId || null, tierId: form.tierId || null, creditLimit: form.creditLimit ?? 0, taxId: form.taxId ?? '', taxBranch: form.taxBranch ?? '', taxName: form.taxName ?? '', address: form.address ?? '', note: form.note ?? '', custom: form.custom ?? {} };
      if (id) await api.put(`/api/customers/${id}`, body);
      else await api.post('/api/customers', body);
      toast.success('บันทึกแล้ว');
      refresh();
      if (!id) onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const d = detail.data;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={id ? (d?.name ?? 'สมาชิก') : 'เพิ่มสมาชิก'}
      description={d ? `${d.code} · สมัคร ${f.date(d.createdAt)} · ซื้อ ${d.visitCount} ครั้ง รวม ${money(d.totalSpent)}` : undefined}
      size="lg"
      footer={
        tab === 'info' && manage ? (
          <>
            {id && (
              <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="h-4 w-4" />} onClick={async () => {
                const r = await confirm({ title: `ลบสมาชิก ${d?.name}?`, body: 'ประวัติการซื้อยังอยู่ในรายงาน', danger: true, confirmText: 'ลบ' });
                if (!r.ok) return;
                try { await api.del(`/api/customers/${id}`); refresh(); onClose(); } catch (e) { toast.error(errorMessage(e)); }
              }}>ลบ</Button>
            )}
            <Button onClick={onClose}>ปิด</Button>
            <Button variant="primary" loading={busy} disabled={!form.name?.trim()} onClick={() => void save()}>บันทึก</Button>
          </>
        ) : undefined
      }
    >
      {id && detail.isLoading ? <Spinner className="mx-auto my-10" /> : (
        <div className="flex flex-col gap-4 pb-3">
          {id && (
            <div className="grid grid-cols-3 gap-2">
              <Stat label="แต้มสะสม" value={(d?.points ?? 0).toLocaleString()} />
              <Stat label="ยอดค้างชำระ" value={money(d?.creditBalance ?? 0)} warn={(d?.creditBalance ?? 0) > 0} />
              <Stat label="ยอดซื้อรวม" value={money(d?.totalSpent ?? 0)} />
            </div>
          )}
          {id && <Segmented value={tab} onChange={setTab} options={[{ value: 'info', label: 'ข้อมูล' }, { value: 'history', label: 'ประวัติการซื้อ' }, ...(settings.points.enabled ? [{ value: 'points' as const, label: 'แต้ม' }] : []), { value: 'credit', label: 'ค้างชำระ' }]} />}
          {tab === 'info' && (
            <fieldset disabled={!manage} className="grid gap-4 md:grid-cols-2">
              <Field label="ชื่อ" required><Input autoFocus={!id} value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="เบอร์โทร"><Input inputMode="tel" value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="รหัสสมาชิก" hint="เว้นว่างเพื่อสร้างอัตโนมัติ"><Input value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
              <Field label="อีเมล"><Input type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="วันเกิด"><Input type="date" value={form.birthday ?? ''} onChange={(e) => setForm({ ...form, birthday: e.target.value })} /></Field>
              <Field label="กลุ่มลูกค้า">
                <Select value={form.groupId ?? ''} onChange={(e) => setForm({ ...form, groupId: e.target.value || null })}>
                  <option value="">—</option>
                  {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </Select>
              </Field>
              <Field label="ระดับสมาชิก" hint="ปรับขึ้นอัตโนมัติตามยอดซื้อ">
                <Select value={form.tierId ?? ''} onChange={(e) => setForm({ ...form, tierId: e.target.value || null })}>
                  <option value="">—</option>
                  {tiers.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </Select>
              </Field>
              <Field label="วงเงินเครดิต (ค้างชำระได้สูงสุด)" hint="0 = ไม่จำกัด"><MoneyInput value={form.creditLimit ?? 0} onValue={(creditLimit) => setForm({ ...form, creditLimit })} /></Field>
              <div className="rounded-xl bg-sunken p-3 md:col-span-2">
                <div className="mb-3 text-[13px] font-semibold text-muted">ข้อมูลออกใบกำกับภาษีเต็มรูป</div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="ชื่อผู้เสียภาษี / บริษัท"><Input value={form.taxName ?? ''} onChange={(e) => setForm({ ...form, taxName: e.target.value })} /></Field>
                  <Field label="เลขประจำตัวผู้เสียภาษี"><Input inputMode="numeric" value={form.taxId ?? ''} onChange={(e) => setForm({ ...form, taxId: e.target.value.replace(/\D/g, '').slice(0, 13) })} /></Field>
                  <Field label="สาขา"><Input value={form.taxBranch ?? ''} onChange={(e) => setForm({ ...form, taxBranch: e.target.value })} placeholder="สำนักงานใหญ่" /></Field>
                </div>
              </div>
              <Field label="ที่อยู่" className="md:col-span-2"><Textarea value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} className="min-h-[64px]" /></Field>
              <Field label="หมายเหตุ" className="md:col-span-2"><Input value={form.note ?? ''} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
              {fields.data?.map((fd) => <CustomFieldInput key={fd.id} def={fd} value={form.custom?.[fd.key]} onChange={(v) => setForm({ ...form, custom: { ...form.custom, [fd.key]: v } })} />)}
            </fieldset>
          )}
          {tab === 'history' && (
            <div className="flex flex-col">
              {d?.sales.length ? d.sales.map((s) => (
                <div key={s.id} className="flex items-center justify-between border-b border-line-soft py-2.5 text-[14px]">
                  <span><span className="font-mono">{s.doc_no}</span> <span className="text-muted">· {f.dateTime(s.created_at)}</span> {s.status === 'voided' && <Badge tone="danger">ยกเลิก</Badge>} {s.type === 'refund' && <Badge tone="warn">คืน</Badge>}</span>
                  <span className="num font-medium">{money(s.total)}</span>
                </div>
              )) : <EmptyState title="ยังไม่มีประวัติการซื้อ" />}
            </div>
          )}
          {tab === 'points' && (
            <div className="flex flex-col gap-3">
              {manage && (
                <div className="flex flex-wrap items-end gap-2 rounded-xl bg-sunken p-3">
                  <Field label="ปรับแต้ม (+/−)"><NumberInput value={adj.points} onValue={(points) => setAdj({ ...adj, points })} className="w-28" /></Field>
                  <Field label="เหตุผล" className="flex-1"><Input value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></Field>
                  <Button disabled={!adj.points || !adj.note.trim()} onClick={async () => { try { await api.post(`/api/customers/${id}/points`, adj); setAdj({ points: 0, note: '' }); refresh(); toast.success('ปรับแต้มแล้ว'); } catch (e) { toast.error(errorMessage(e)); } }}>บันทึก</Button>
                </div>
              )}
              {d?.pointMoves.map((m) => (
                <div key={m.id} className="flex justify-between border-b border-line-soft py-2 text-[14px]">
                  <span>{{ earn: 'ได้รับ', redeem: 'ใช้แต้ม', adjust: 'ปรับ', refund: 'คืนสินค้า', void: 'ยกเลิกบิล' }[m.type] ?? m.type} · <span className="text-muted">{m.note} · {f.dateTime(m.created_at)}</span></span>
                  <span className={cn('num font-semibold', m.points > 0 ? 'text-primary' : 'text-danger')}>{m.points > 0 ? '+' : ''}{m.points}</span>
                </div>
              ))}
            </div>
          )}
          {tab === 'credit' && (
            <div className="flex flex-col gap-3">
              {manage && (d?.creditBalance ?? 0) > 0 && (
                <div className="flex flex-wrap items-end gap-2 rounded-xl bg-warn-soft p-3">
                  <Field label="รับชำระหนี้"><MoneyInput value={pay.amount} onValue={(amount) => setPay({ ...pay, amount })} /></Field>
                  <Field label="ชำระด้วย">
                    <Select value={pay.methodCode} onChange={(e) => setPay({ ...pay, methodCode: e.target.value })}>
                      {methods.data?.filter((m) => m.active && m.kind !== 'credit').map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
                    </Select>
                  </Field>
                  <Button variant="primary" icon={<Wallet className="h-4 w-4" />} disabled={pay.amount <= 0} onClick={async () => { try { await api.post(`/api/customers/${id}/pay-credit`, pay); setPay({ amount: 0, methodCode: 'cash' }); refresh(); toast.success('รับชำระแล้ว'); } catch (e) { toast.error(errorMessage(e)); } }}>รับชำระ</Button>
                  <Button variant="ghost" onClick={() => setPay({ ...pay, amount: d!.creditBalance })}>ชำระทั้งหมด</Button>
                </div>
              )}
              {d?.creditMoves.length ? d.creditMoves.map((m) => (
                <div key={m.id} className="flex justify-between border-b border-line-soft py-2 text-[14px]">
                  <span>{{ sale: 'ซื้อเชื่อ', payment: 'ชำระหนี้', void: 'ยกเลิกบิล', refund: 'คืนสินค้า', adjust: 'ปรับ' }[m.type] ?? m.type} · <span className="text-muted">{m.note} · {f.dateTime(m.created_at)}</span></span>
                  <span className={cn('num font-semibold', m.amount > 0 ? 'text-warn' : 'text-primary')}>{m.amount > 0 ? '+' : ''}{money(m.amount)}</span>
                </div>
              )) : <EmptyState title="ไม่มีรายการค้างชำระ" />}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={cn('rounded-xl px-3 py-2.5', warn ? 'bg-warn-soft' : 'bg-sunken')}>
      <div className="text-[12px] text-muted">{label}</div>
      <div className={cn('num text-[18px] font-semibold', warn && 'text-warn')}>{value}</div>
    </div>
  );
}

function Groups() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const groups = useQuery({ queryKey: ['customer-groups'], queryFn: () => api.get<{ id: string; name: string; discount_percent: number; price_tier_id: string | null }[]>('/api/customer-groups') });
  const tiers = useQuery({ queryKey: ['member-tiers'], queryFn: () => api.get<{ id: string; name: string; min_spend: number; point_multiplier: number }[]>('/api/member-tiers') });
  const priceTiers = useQuery({ queryKey: ['price-tiers'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/price-tiers') });
  const [g, setG] = useState<{ id?: string; name: string; discountPercent: number; priceTierId: string | null } | null>(null);
  const [t, setT] = useState<{ id?: string; name: string; minSpend: number; pointMultiplier: number } | null>(null);
  const saveG = async () => {
    try {
      if (g!.id) await api.put(`/api/customer-groups/${g!.id}`, g);
      else await api.post('/api/customer-groups', g);
      qc.invalidateQueries({ queryKey: ['customer-groups'] });
      setG(null);
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const saveT = async () => {
    try {
      if (t!.id) await api.put(`/api/member-tiers/${t!.id}`, t);
      else await api.post('/api/member-tiers', t);
      qc.invalidateQueries({ queryKey: ['member-tiers'] });
      setT(null);
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="กลุ่มลูกค้า" action={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setG({ name: '', discountPercent: 0, priceTierId: null })}>เพิ่มกลุ่ม</Button>}>
        <p className="-mt-2 text-[13px] text-muted">ส่วนลดอัตโนมัติทั้งบิล และ/หรือใช้ระดับราคาพิเศษ</p>
        {groups.data?.map((x) => (
          <div key={x.id} className="flex items-center justify-between border-b border-line-soft py-2.5 last:border-0">
            <button className="text-left" onClick={() => setG({ id: x.id, name: x.name, discountPercent: x.discount_percent, priceTierId: x.price_tier_id })}>
              <div className="font-medium">{x.name}</div>
              <div className="text-[13px] text-muted">{x.discount_percent ? `ลด ${x.discount_percent}%` : 'ไม่มีส่วนลด'}{x.price_tier_id ? ` · ${priceTiers.data?.find((p) => p.id === x.price_tier_id)?.name ?? ''}` : ''}</div>
            </button>
            <Button size="sm" variant="ghost" className="text-danger" onClick={async () => { const r = await confirm({ title: `ลบกลุ่ม ${x.name}?`, danger: true, confirmText: 'ลบ' }); if (r.ok) { await api.del(`/api/customer-groups/${x.id}`); qc.invalidateQueries({ queryKey: ['customer-groups'] }); } }}>ลบ</Button>
          </div>
        ))}
      </Card>
      <Card title="ระดับสมาชิก" action={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setT({ name: '', minSpend: 0, pointMultiplier: 1 })}>เพิ่มระดับ</Button>}>
        <p className="-mt-2 text-[13px] text-muted">ขึ้นระดับอัตโนมัติเมื่อยอดซื้อสะสมถึงเกณฑ์ และได้แต้มเพิ่มตามตัวคูณ</p>
        {tiers.data?.map((x) => (
          <div key={x.id} className="flex items-center justify-between border-b border-line-soft py-2.5 last:border-0">
            <button className="text-left" onClick={() => setT({ id: x.id, name: x.name, minSpend: x.min_spend, pointMultiplier: x.point_multiplier })}>
              <div className="font-medium">{x.name}</div>
              <div className="text-[13px] text-muted">ยอดซื้อตั้งแต่ {money(x.min_spend)} · แต้ม ×{x.point_multiplier}</div>
            </button>
            <Button size="sm" variant="ghost" className="text-danger" onClick={async () => { const r = await confirm({ title: `ลบระดับ ${x.name}?`, danger: true, confirmText: 'ลบ' }); if (r.ok) { await api.del(`/api/member-tiers/${x.id}`); qc.invalidateQueries({ queryKey: ['member-tiers'] }); } }}>ลบ</Button>
          </div>
        ))}
      </Card>
      <Dialog open={!!g} onOpenChange={(v) => !v && setG(null)} title={g?.id ? 'แก้ไขกลุ่ม' : 'เพิ่มกลุ่มลูกค้า'} size="sm" footer={<><Button onClick={() => setG(null)}>ยกเลิก</Button><Button variant="primary" disabled={!g?.name.trim()} onClick={() => void saveG()}>บันทึก</Button></>}>
        {g && (
          <div className="flex flex-col gap-4 pb-2">
            <Field label="ชื่อกลุ่ม" required><Input autoFocus value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} /></Field>
            <Field label="ส่วนลดทั้งบิล (%)"><NumberInput decimals={2} value={g.discountPercent} onValue={(discountPercent) => setG({ ...g, discountPercent: Math.min(100, Math.max(0, discountPercent)) })} /></Field>
            <Field label="ระดับราคา">
              <Select value={g.priceTierId ?? ''} onChange={(e) => setG({ ...g, priceTierId: e.target.value || null })}>
                <option value="">ราคาปกติ</option>
                {priceTiers.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          </div>
        )}
      </Dialog>
      <Dialog open={!!t} onOpenChange={(v) => !v && setT(null)} title={t?.id ? 'แก้ไขระดับ' : 'เพิ่มระดับสมาชิก'} size="sm" footer={<><Button onClick={() => setT(null)}>ยกเลิก</Button><Button variant="primary" disabled={!t?.name.trim()} onClick={() => void saveT()}>บันทึก</Button></>}>
        {t && (
          <div className="flex flex-col gap-4 pb-2">
            <Field label="ชื่อระดับ" required><Input autoFocus value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></Field>
            <Field label="ยอดซื้อสะสมขั้นต่ำ"><MoneyInput value={t.minSpend} onValue={(minSpend) => setT({ ...t, minSpend })} /></Field>
            <Field label="ตัวคูณแต้ม"><NumberInput decimals={2} value={t.pointMultiplier} onValue={(pointMultiplier) => setT({ ...t, pointMultiplier })} /></Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
