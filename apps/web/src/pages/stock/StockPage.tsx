import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDownToLine, ClipboardCheck, Download, Plus, Search, SlidersHorizontal, Trash2, Truck, ArrowLeftRight } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { money, useFormatters, useSettings } from '@/lib/settings';
import { useSession } from '@/lib/session';
import { cn, qtyText } from '@/lib/utils';
import { Page } from '@/components/layout/AppShell';
import { Badge, Button, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, Segmented, Select, SkeletonRows, Textarea } from '@/components/ui/core';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { MoneyInput, NumberInput } from '@/components/ui/inputs';
import { ProductPicker, type PickedProduct } from '@/components/ProductPicker';
import { t } from '@flexpos/shared';
import { tn } from '@/lib/i18n';

interface StockRow {
  productId: string;
  variantId: string;
  name: string;
  sku: string;
  unit: string;
  category: string | null;
  qty: number;
  lowStock: number;
  avgCost: number;
  value: number;
  status: 'ok' | 'low' | 'out';
  lots: { lot_no: string; expiry_date: string; qty: number }[];
}

type DocType = 'receive' | 'adjust' | 'count' | 'transfer';
const DOC_LABEL: Record<DocType, string> = { receive: t('รับสินค้าเข้า'), adjust: t('ปรับสต็อก'), count: t('นับสต็อก'), transfer: t('โอนระหว่างสาขา') };
const MOVE_LABEL: Record<string, string> = { sale: t('ขาย'), refund: t('คืนสินค้า'), void: t('ยกเลิกบิล'), receive: t('รับเข้า'), adjust: t('ปรับ'), count: t('นับสต็อก'), transfer_in: t('โอนเข้า'), transfer_out: t('โอนออก') };

export default function StockPage() {
  const [tab, setTab] = useState<'levels' | 'docs' | 'moves' | 'suppliers'>('levels');
  const [doc, setDoc] = useState<DocType | null>(null);
  const { can } = useSession();
  return (
    <Page>
      <PageHeader
        title={t('สต็อก')}
        actions={
          can('stock.manage') && (
            <>
              <Button icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => setDoc('count')}>{t('นับสต็อก')}</Button>
              <Button icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setDoc('adjust')}>{t('ปรับสต็อก')}</Button>
              <TransferButton onClick={() => setDoc('transfer')} />
              <Button variant="primary" icon={<ArrowDownToLine className="h-4 w-4" />} onClick={() => setDoc('receive')}>{t('รับสินค้าเข้า')}</Button>
            </>
          )
        }
      />
      <Segmented className="self-start" value={tab} onChange={setTab} options={[{ value: 'levels', label: t('คงเหลือ') }, { value: 'docs', label: t('เอกสาร') }, { value: 'moves', label: t('ความเคลื่อนไหว') }, { value: 'suppliers', label: t('ซัพพลายเออร์') }]} />
      {tab === 'levels' && <Levels />}
      {tab === 'docs' && <Docs />}
      {tab === 'moves' && <Moves />}
      {tab === 'suppliers' && <Suppliers />}
      {doc && <DocEditor type={doc} onClose={() => setDoc(null)} />}
    </Page>
  );
}

function TransferButton({ onClick }: { onClick: () => void }) {
  const s = useSettings();
  if (!s.modules.multiBranch) return null;
  return <Button icon={<ArrowLeftRight className="h-4 w-4" />} onClick={onClick}>{t('โอนสาขา')}</Button>;
}

function Levels() {
  const settings = useSettings();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'out' | 'expiring'>('all');
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['stock', q, filter, page], queryFn: () => api.get<{ total: number; items: StockRow[]; valuation: number }>('/api/stock', { q, filter, page, pageSize: 100 }), placeholderData: keepPreviousData });
  const profit = can('reports.profit');
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 md:max-w-[360px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input className="pl-9" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder={t('ค้นหาสินค้า')} />
        </div>
        {(['all', 'low', 'out', ...(settings.modules.lotTracking ? ['expiring' as const] : [])] as const).map((f) => (
          <button key={f} onClick={() => (setFilter(f), setPage(1))} className={cn('h-10 rounded-full border px-3.5 text-[14px] font-medium', filter === f ? 'border-ink bg-ink text-surface' : 'border-line-strong bg-surface')}>
            {{ all: t('ทั้งหมด'), low: t('ใกล้หมด'), out: t('หมด'), expiring: t('ใกล้หมดอายุ') }[f]}
          </button>
        ))}
        {profit && list.data && <span className="num ml-auto text-[14px] text-muted">{tn('มูลค่าสต็อก {0}', money(list.data.valuation))}</span>}
        <Button icon={<Download className="h-4 w-4" />} onClick={() => api.download('/api/reports/stock', { format: 'xlsx' }).catch((e) => toast.error(errorMessage(e)))}>{t('ส่งออก')}</Button>
      </div>
      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_120px_120px_120px] gap-3 border-b border-line-soft bg-sunken px-5 py-3 text-[13px] font-medium text-muted md:grid">
          <span>{t('สินค้า')}</span><span>{t('หมวด')}</span><span className="text-right">{t('คงเหลือ')}</span><span className="text-right">{profit ? t('ต้นทุนเฉลี่ย') : ''}</span><span>{t('สถานะ')}</span>
        </div>
        {list.isLoading ? <SkeletonRows /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !list.data?.items.length ? (
          <EmptyState title={t('ไม่มีรายการ')} body={t('สินค้าที่เปิด “ติดตามสต็อก” จะแสดงที่นี่')} />
        ) : (
          list.data.items.map((r) => (
            <div key={r.productId + r.variantId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line-soft px-5 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_120px_120px_120px]">
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{r.name}</span>
                <span className="font-mono text-[12px] text-muted">{r.sku}</span>
                {r.lots.map((l) => <span key={l.lot_no} className="text-[12px] text-warn">{tn('ล็อต {0} หมดอายุ {1} ({2})', l.lot_no, l.expiry_date, qtyText(l.qty))}</span>)}
              </span>
              <span className="hidden truncate text-ink-2 md:block">{r.category ?? '—'}</span>
              <span className="num text-right font-semibold">{qtyText(r.qty)} <span className="text-[12px] font-normal text-muted">{r.unit}</span></span>
              <span className="num hidden text-right text-ink-2 md:block">{profit ? money(r.avgCost) : ''}</span>
              <span className="hidden md:block">{r.status === 'out' ? <Badge tone="danger">{t('หมด')}</Badge> : r.status === 'low' ? <Badge tone="warn">{t('ใกล้หมด')}</Badge> : <Badge tone="success">{t('ปกติ')}</Badge>}</span>
            </div>
          ))
        )}
        <Pagination page={page} pageSize={100} total={list.data?.total ?? 0} onPage={setPage} />
      </div>
    </>
  );
}

function Docs() {
  const f = useFormatters();
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['stock-docs'], queryFn: () => api.get<{ id: string; doc_no: string; type: DocType; note: string; total_cost: number; created_at: string; supplier_name: string | null; user_name: string | null; to_branch_name: string | null }[]>('/api/stock/docs') });
  const detail = useQuery({ queryKey: ['stock-doc', open], queryFn: () => api.get<{ doc_no: string; type: DocType; note: string; lines: { id: string; name: string; variant_name: string | null; sku: string; qty: number; system_qty: number; unit_cost: number; lot_no: string }[] }>(`/api/stock/docs/${open}`), enabled: !!open });
  return (
    <div className="card overflow-hidden">
      {list.isLoading ? <SkeletonRows /> : !list.data?.length ? <EmptyState title={t('ยังไม่มีเอกสารสต็อก')} body={t('รับสินค้าเข้า ปรับ หรือนับสต็อก แล้วเอกสารจะแสดงที่นี่')} /> : list.data.map((d) => (
        <button key={d.id} onClick={() => setOpen(d.id)} className="flex w-full items-center gap-3 border-b border-line-soft px-5 py-3 text-left hover:bg-sunken">
          <span className="w-28 font-mono text-[13px] text-muted">{d.doc_no}</span>
          <span className="flex flex-1 flex-col">
            <span className="font-medium">{DOC_LABEL[d.type]}{d.supplier_name ? ` · ${d.supplier_name}` : ''}{d.to_branch_name ? ` → ${d.to_branch_name}` : ''}</span>
            <span className="text-[13px] text-muted">{f.dateTime(d.created_at)} · {d.user_name}{d.note ? ` · ${d.note}` : ''}</span>
          </span>
          {d.total_cost > 0 && <span className="num font-medium">{money(d.total_cost)}</span>}
        </button>
      ))}
      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)} title={detail.data ? `${DOC_LABEL[detail.data.type]} ${detail.data.doc_no}` : t('เอกสาร')} size="lg">
        <div className="pb-3">
          {detail.data?.note && <p className="mb-3 text-[14px] text-muted">{detail.data.note}</p>}
          <table className="w-full text-[14px]">
            <thead className="text-left text-[12px] text-muted"><tr><th className="pb-2">{t('สินค้า')}</th><th className="pb-2 text-right">{detail.data?.type === 'count' ? t('ในระบบ → นับได้') : t('จำนวน')}</th><th className="pb-2 text-right">{t('ต้นทุน/หน่วย')}</th></tr></thead>
            <tbody>
              {detail.data?.lines.map((l) => (
                <tr key={l.id} className="border-t border-line-soft">
                  <td className="py-2">{l.name}{l.variant_name ? ` (${l.variant_name})` : ''}{l.lot_no ? <span className="text-[12px] text-muted">{' '}{tn('· ล็อต {0}', l.lot_no)}</span> : null}</td>
                  <td className="num py-2 text-right">{detail.data!.type === 'count' ? `${qtyText(l.system_qty)} → ${qtyText(l.qty)}` : qtyText(l.qty)}</td>
                  <td className="num py-2 text-right">{l.unit_cost ? money(l.unit_cost) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Dialog>
    </div>
  );
}

function Moves() {
  const f = useFormatters();
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['stock-moves', type, page], queryFn: () => api.get<{ total: number; items: { id: string; type: string; qty: number; balance_after: number; note: string; created_at: string; name: string; variant_name: string | null; user_name: string | null }[] }>('/api/stock/moves', { type, page, pageSize: 100 }), placeholderData: keepPreviousData });
  return (
    <>
      <Select className="w-auto self-start" value={type} onChange={(e) => (setType(e.target.value), setPage(1))} aria-label={t('ประเภท')}>
        <option value="">{t('ทุกประเภท')}</option>
        {Object.entries(MOVE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select>
      <div className="card overflow-hidden">
        {list.isLoading ? <SkeletonRows /> : !list.data?.items.length ? <EmptyState title={t('ยังไม่มีความเคลื่อนไหว')} /> : list.data.items.map((m) => (
          <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 border-b border-line-soft px-5 py-2.5 text-[14px]">
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{m.name}{m.variant_name ? ` (${m.variant_name})` : ''}</span>
              <span className="truncate text-[12px] text-muted">{f.dateTime(m.created_at)} · {MOVE_LABEL[m.type] ?? m.type}{m.user_name ? ` · ${m.user_name}` : ''}{m.note ? ` · ${m.note}` : ''}</span>
            </span>
            <span className={cn('num font-semibold', m.qty > 0 ? 'text-primary' : 'text-danger')}>{m.qty > 0 ? '+' : ''}{qtyText(m.qty)}</span>
            <span className="num w-20 text-right text-muted">{tn('คงเหลือ {0}', qtyText(m.balance_after))}</span>
          </div>
        ))}
        <Pagination page={page} pageSize={100} total={list.data?.total ?? 0} onPage={setPage} />
      </div>
    </>
  );
}

interface Supplier { id: string; name: string; contact: string; phone: string; email: string; tax_id: string; address: string }

function Suppliers() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const list = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/api/suppliers') });
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null);
  const save = async () => {
    if (!edit?.name?.trim()) return;
    try {
      const body = { name: edit.name, contact: edit.contact ?? '', phone: edit.phone ?? '', email: edit.email ?? '', taxId: edit.tax_id ?? '', address: edit.address ?? '' };
      if (edit.id) await api.put(`/api/suppliers/${edit.id}`, body);
      else await api.post('/api/suppliers', body);
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      setEdit(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      {can('stock.manage') && <Button className="self-end" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({})}>{t('เพิ่มซัพพลายเออร์')}</Button>}
      <div className="card overflow-hidden">
        {list.isLoading ? <SkeletonRows /> : !list.data?.length ? <EmptyState icon={<Truck className="h-6 w-6" />} title={t('ยังไม่มีซัพพลายเออร์')} body={t('บันทึกผู้ขายเพื่อใช้ในเอกสารรับสินค้าเข้า')} /> : list.data.map((s) => (
          <div key={s.id} className="flex items-center gap-3 border-b border-line-soft px-5 py-3">
            <button className="flex flex-1 flex-col text-left" onClick={() => setEdit(s)}>
              <span className="font-medium">{s.name}</span>
              <span className="text-[13px] text-muted">{[s.contact, s.phone, s.email].filter(Boolean).join(' · ') || '—'}</span>
            </button>
            {can('stock.manage') && (
              <Button size="sm" variant="ghost" className="text-danger" aria-label={t('ลบ')} onClick={async () => { const r = await confirm({ title: t('ลบ {0}?', s.name), danger: true, confirmText: t('ลบ') }); if (r.ok) { await api.del(`/api/suppliers/${s.id}`); qc.invalidateQueries({ queryKey: ['suppliers'] }); } }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </div>
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} title={edit?.id ? t('แก้ไขซัพพลายเออร์') : t('เพิ่มซัพพลายเออร์')} footer={<><Button onClick={() => setEdit(null)}>{t('ยกเลิก')}</Button><Button variant="primary" disabled={!edit?.name?.trim()} onClick={() => void save()}>{t('บันทึก')}</Button></>}>
        {edit && (
          <div className="grid gap-4 pb-2 md:grid-cols-2">
            <Field label={t('ชื่อ')} required className="md:col-span-2"><Input autoFocus value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label={t('ผู้ติดต่อ')}><Input value={edit.contact ?? ''} onChange={(e) => setEdit({ ...edit, contact: e.target.value })} /></Field>
            <Field label={t('เบอร์โทร')}><Input value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label={t('อีเมล')}><Input type="email" value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label={t('เลขผู้เสียภาษี')}><Input value={edit.tax_id ?? ''} onChange={(e) => setEdit({ ...edit, tax_id: e.target.value })} /></Field>
            <Field label={t('ที่อยู่')} className="md:col-span-2"><Textarea value={edit.address ?? ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
          </div>
        )}
      </Dialog>
    </>
  );
}

interface DocLine extends PickedProduct {
  qty: number;
  unitCost: number;
  lotNo: string;
  expiryDate: string;
}

function DocEditor({ type, onClose }: { type: DocType; onClose: () => void }) {
  const qc = useQueryClient();
  const settings = useSettings();
  const [lines, setLines] = useState<DocLine[]>([]);
  const [note, setNote] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [toBranchId, setToBranchId] = useState('');
  const [picker, setPicker] = useState(true);
  const [busy, setBusy] = useState(false);
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/api/suppliers'), enabled: type === 'receive' });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api.get<{ id: string; name: string; active: number }[]>('/api/branches'), enabled: type === 'transfer' });
  const total = lines.reduce((a, l) => a + Math.round(l.qty * l.unitCost), 0);
  const lots = settings.modules.lotTracking && type === 'receive';
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ docNo: string }>('/api/stock/docs', { type, note, supplierId: supplierId || null, toBranchId: toBranchId || null, lines: lines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty, unitCost: l.unitCost, lotNo: l.lotNo, expiryDate: l.expiryDate })) });
      toast.success(t('บันทึก {0} แล้ว', r.docNo));
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['stock-docs'] });
      qc.invalidateQueries({ queryKey: ['stock-moves'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const qtyLabel = type === 'count' ? t('นับได้') : type === 'adjust' ? t('เพิ่ม(+)/ลด(−)') : t('จำนวน');
  return (
    <>
      <Dialog
        open
        onOpenChange={(v) => !v && onClose()}
        title={DOC_LABEL[type]}
        description={type === 'count' ? t('กรอกจำนวนที่นับได้จริง ระบบจะบันทึกส่วนต่างให้อัตโนมัติ') : type === 'adjust' ? t('ใส่ค่าติดลบเพื่อตัดสต็อก เช่น ของเสีย/หาย') : undefined}
        size="xl"
        footer={
          <>
            {type === 'receive' && <span className="num mr-auto font-semibold">{tn('รวม {0}', money(total))}</span>}
            <Button onClick={onClose}>{t('ยกเลิก')}</Button>
            <Button variant="primary" loading={busy} disabled={!lines.length || (type === 'transfer' && !toBranchId) || (type === 'adjust' && !note.trim())} onClick={() => void submit()}>{t('บันทึก')}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 pb-3">
          <div className="grid gap-3 md:grid-cols-2">
            {type === 'receive' && (
              <Field label={t('ซัพพลายเออร์')}>
                <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">{t('— ไม่ระบุ —')}</option>
                  {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
            )}
            {type === 'transfer' && (
              <Field label={t('โอนไปสาขา')} required>
                <Select value={toBranchId} onChange={(e) => setToBranchId(e.target.value)}>
                  <option value="">{t('เลือกสาขา')}</option>
                  {branches.data?.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label={type === 'adjust' ? t('เหตุผล') : t('หมายเหตุ')} required={type === 'adjust'}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'adjust' ? t('เช่น สินค้าเสียหาย / หมดอายุ') : t('เช่น เลขใบส่งของ')} />
            </Field>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[14px]">
              <thead className="text-left text-[12px] text-muted">
                <tr><th className="pb-2">{t('สินค้า')}</th><th className="w-[130px] pb-2">{qtyLabel}</th>{type === 'receive' && <th className="w-[140px] pb-2">{t('ต้นทุน/หน่วย')}</th>}{lots && <><th className="w-[120px] pb-2">{t('ล็อต')}</th><th className="w-[150px] pb-2">{t('วันหมดอายุ')}</th></>}<th className="w-10" /></tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const upd = (p: Partial<DocLine>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...p } : x)));
                  return (
                    <tr key={l.productId + (l.variantId ?? '')} className="border-t border-line-soft">
                      <td className="py-1.5 pr-2"><span className="font-medium">{l.name}</span> <span className="font-mono text-[12px] text-muted">{l.sku}</span></td>
                      <td className="py-1.5 pr-2"><NumberInput decimals={3} value={l.qty} onValue={(qty) => upd({ qty })} className="h-10" autoFocus={i === lines.length - 1} /></td>
                      {type === 'receive' && <td className="py-1.5 pr-2"><MoneyInput value={l.unitCost} onValue={(unitCost) => upd({ unitCost })} className="h-10" /></td>}
                      {lots && <><td className="py-1.5 pr-2"><Input value={l.lotNo} onChange={(e) => upd({ lotNo: e.target.value })} className="h-10" /></td><td className="py-1.5 pr-2"><Input type="date" value={l.expiryDate} onChange={(e) => upd({ expiryDate: e.target.value })} className="h-10" /></td></>}
                      <td><Button size="sm" variant="ghost" aria-label={t('ลบ')} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!lines.length && <p className="py-6 text-center text-[14px] text-muted">{t('ยังไม่มีรายการ กด “เพิ่มสินค้า” หรือสแกนบาร์โค้ด')}</p>}
          </div>
          <Button className="self-start" icon={<Plus className="h-4 w-4" />} onClick={() => setPicker(true)}>{t('เพิ่มสินค้า')}</Button>
        </div>
      </Dialog>
      <ProductPicker
        open={picker}
        onlyTracked
        onClose={() => setPicker(false)}
        onPick={(p) => {
          setLines((ls) => (ls.some((l) => l.productId === p.productId && l.variantId === p.variantId) ? ls.map((l) => (l.productId === p.productId && l.variantId === p.variantId ? { ...l, qty: l.qty + (type === 'count' ? 0 : 1) } : l)) : [...ls, { ...p, qty: type === 'count' ? 0 : 1, unitCost: 0, lotNo: '', expiryDate: '' }]));
          setPicker(false);
        }}
      />
    </>
  );
}
