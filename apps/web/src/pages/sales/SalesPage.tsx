import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, FileText, Printer, RotateCcw, Search, Download } from 'lucide-react';
import type { PrintDoc, SaleView } from '@flexpos/shared';
import { api, errorMessage } from '@/lib/api';
import { money, useFormatters, useSettings } from '@/lib/settings';
import { useSession } from '@/lib/session';
import { printInBrowser, printSaleReceipt, type PrinterInfo } from '@/lib/print';
import { cn, qtyText, todayStr, addDays, uuid } from '@/lib/utils';
import { Page } from '@/components/layout/AppShell';
import { Badge, Button, Checkbox, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, Select, SkeletonRows, Spinner } from '@/components/ui/core';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { PrintDocView } from '@/components/PrintDocView';
import { ApprovalHost, useApproval } from '../pos/dialogs';

interface Row {
  id: string;
  doc_no: string;
  tax_invoice_no: string | null;
  type: 'sale' | 'refund';
  status: string;
  total: number;
  created_at: string;
  table_name: string | null;
  user_name: string | null;
  customer_name: string | null;
}

const STATUS: Record<string, { label: string; tone: 'success' | 'danger' | 'warn' | 'info' | 'neutral' }> = {
  completed: { label: 'สำเร็จ', tone: 'success' },
  credit: { label: 'ค้างชำระ', tone: 'warn' },
  voided: { label: 'ยกเลิก', tone: 'danger' },
  refunded: { label: 'คืนทั้งบิล', tone: 'warn' },
  partial_refund: { label: 'คืนบางส่วน', tone: 'warn' },
};

export default function SalesPage() {
  const f = useFormatters();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(addDays(todayStr(), -6));
  const [to, setTo] = useState(todayStr());
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(params.get('open'));
  useEffect(() => {
    const o = params.get('open');
    if (o) {
      setOpen(o);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);
  const list = useQuery({
    queryKey: ['sales', q, from, to, status, page],
    queryFn: () => api.get<{ total: number; items: Row[] }>('/api/sales', { q, from: q ? undefined : from, to: q ? undefined : to, status, page, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });
  return (
    <Page>
      <PageHeader title="บิลขาย" sub="พิมพ์ซ้ำ ยกเลิกบิล คืนสินค้า หรือออกใบกำกับภาษีเต็มรูปย้อนหลัง" />
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[220px] flex-1 md:max-w-[320px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input className="pl-9" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="เลขที่บิล / ชื่อ / เบอร์สมาชิก" />
        </div>
        <Input type="date" className="w-auto" value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} aria-label="ตั้งแต่วันที่" />
        <Input type="date" className="w-auto" value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} aria-label="ถึงวันที่" />
        <Select className="w-auto" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="สถานะ">
          <option value="">ทุกสถานะ</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </div>
      <div className="card overflow-hidden">
        {list.isLoading ? <SkeletonRows /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !list.data?.items.length ? <EmptyState title="ไม่พบบิล" body="ลองเปลี่ยนช่วงวันที่หรือคำค้น" /> : list.data.items.map((s) => (
          <button key={s.id} onClick={() => setOpen(s.id)} className="flex w-full items-center gap-3 border-b border-line-soft px-5 py-3 text-left hover:bg-sunken">
            <span className="flex w-[150px] flex-none flex-col">
              <span className="font-mono text-[13px] font-medium">{s.doc_no}</span>
              <span className="text-[12px] text-muted">{f.dateTime(s.created_at)}</span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[14px]">{[s.table_name && `โต๊ะ ${s.table_name}`, s.customer_name, s.user_name].filter(Boolean).join(' · ') || '—'}</span>
              {s.tax_invoice_no && <span className="text-[12px] text-muted">ใบกำกับภาษี {s.tax_invoice_no}</span>}
            </span>
            {s.type === 'refund' ? <Badge tone="warn">ใบคืนสินค้า</Badge> : <Badge tone={STATUS[s.status]?.tone ?? 'neutral'}>{STATUS[s.status]?.label ?? s.status}</Badge>}
            <span className={cn('num w-28 text-right font-semibold', (s.status === 'voided' || s.type === 'refund') && 'text-muted line-through decoration-1')}>{s.type === 'refund' ? '-' : ''}{money(s.total)}</span>
          </button>
        ))}
        <Pagination page={page} pageSize={50} total={list.data?.total ?? 0} onPage={setPage} />
      </div>
      {open && <SaleDialog id={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
      <ApprovalHost />
    </Page>
  );
}

function SaleDialog({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const approve = useApproval();
  const settings = useSettings();
  const { can } = useSession();
  const sale = useQuery({ queryKey: ['sale', id], queryFn: () => api.get<SaleView & { refundable: { lineId: string; qty: number }[] }>(`/api/sales/${id}`) });
  const doc = useQuery({ queryKey: ['sale-doc', id], queryFn: () => api.get<PrintDoc>(`/api/sales/${id}/receipt`, { reprint: 1 }) });
  const printers = useQuery({ queryKey: ['printers'], queryFn: () => api.get<PrinterInfo[]>('/api/printers') });
  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: () => api.get<{ code: string; name: string; kind: string; active: boolean }[]>('/api/payment-methods') });
  const [mode, setMode] = useState<'view' | 'refund' | 'taxinv'>('view');
  const [refundQty, setRefundQty] = useState<Record<string, number>>({});
  const [refund, setRefund] = useState({ reason: '', methodCode: 'cash', restock: true });
  const [ti, setTi] = useState({ name: '', taxId: '', branch: 'สำนักงานใหญ่', address: '' });
  const [busy, setBusy] = useState(false);
  const s = sale.data;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sale', id] });
    qc.invalidateQueries({ queryKey: ['sale-doc', id] });
    qc.invalidateQueries({ queryKey: ['sales'] });
  };

  const doVoid = async () => {
    const r = await confirm({ title: `ยกเลิกบิล ${s!.docNo}?`, body: 'สต็อก แต้ม และยอดค้างชำระจะถูกคืนกลับ บิลยังคงอยู่ในระบบพร้อมสถานะยกเลิก', danger: true, confirmText: 'ยกเลิกบิล', reason: { label: 'เหตุผล', placeholder: 'เช่น คีย์ผิด ลูกค้าเปลี่ยนใจ' } });
    if (!r.ok) return;
    const pin = await approve('pos.void', `ยกเลิกบิล ${s!.docNo}`);
    if (pin === null) return;
    try {
      await api.post(`/api/sales/${id}/void`, { reason: r.reason, managerPin: pin || undefined });
      toast.success('ยกเลิกบิลแล้ว');
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const doRefund = async () => {
    const lines = Object.entries(refundQty).filter(([, q]) => q > 0).map(([lineId, qty]) => ({ lineId, qty }));
    if (!lines.length) return;
    const pin = await approve('pos.refund', `คืนสินค้าจากบิล ${s!.docNo}`);
    if (pin === null) return;
    setBusy(true);
    try {
      const r = await api.post<SaleView>(`/api/sales/${id}/refund`, { id: uuid(), lines, reason: refund.reason, methodCode: refund.methodCode, restock: refund.restock, managerPin: pin || undefined });
      toast.success(`ทำรายการคืนแล้ว ${r.docNo} · คืนเงิน ${money(r.total)}`);
      refresh();
      onOpen(r.id);
      setMode('view');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doTaxInv = async () => {
    setBusy(true);
    try {
      await api.post(`/api/sales/${id}/tax-invoice`, ti);
      toast.success('ออกใบกำกับภาษีเต็มรูปแล้ว');
      refresh();
      setMode('view');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={s ? `${s.type === 'refund' ? 'ใบคืนสินค้า' : 'บิล'} ${s.docNo}` : 'บิล'} description={s?.voidReason ? `ยกเลิก: ${s.voidReason}` : s?.refOfDocNo ? `อ้างอิงบิล ${s.refOfDocNo}` : undefined} size="xl">
      {!s ? (
        <Spinner className="mx-auto my-12" />
      ) : (
        <div className="flex flex-col gap-5 pb-3 md:flex-row">
          <div className="flex justify-center md:w-[320px] md:flex-none">{doc.data ? <PrintDocView doc={doc.data} /> : <Spinner className="my-10" />}</div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {mode === 'view' && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button icon={<Printer className="h-4 w-4" />} disabled={!can('pos.reprint')} onClick={() => printSaleReceipt(id, printers.data ?? [], { reprint: true }).then(() => toast.success('ส่งพิมพ์แล้ว')).catch((e) => toast.error(errorMessage(e)))}>พิมพ์ซ้ำ</Button>
                  <Button icon={<Download className="h-4 w-4" />} onClick={() => doc.data && void printInBrowser({ ...doc.data, paper: 'A4' })}>PDF / A4</Button>
                  {s.type === 'sale' && s.status !== 'voided' && (
                    <>
                      {settings.tax.vatEnabled && !s.taxInvoiceNo && <Button icon={<FileText className="h-4 w-4" />} onClick={() => setMode('taxinv')}>ออกใบกำกับภาษีเต็มรูป</Button>}
                      {s.status !== 'refunded' && <Button icon={<RotateCcw className="h-4 w-4" />} onClick={() => { setRefundQty({}); setMode('refund'); }}>คืนสินค้า</Button>}
                      {s.status !== 'refunded' && s.status !== 'partial_refund' && <Button variant="ghost" className="text-danger" icon={<Ban className="h-4 w-4" />} onClick={() => void doVoid()}>ยกเลิกบิล</Button>}
                    </>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-sunken p-4 text-[14px]">
                  <dt className="text-muted">พนักงาน</dt><dd>{s.userName}</dd>
                  {s.customer && (<><dt className="text-muted">สมาชิก</dt><dd>{s.customer.name}</dd></>)}
                  {s.tableName && (<><dt className="text-muted">โต๊ะ</dt><dd>{s.tableName}</dd></>)}
                  <dt className="text-muted">ชำระโดย</dt><dd>{s.payments.map((p) => `${p.name} ${money(p.amount)}`).join(', ')}</dd>
                  {s.taxInvoiceNo && (<><dt className="text-muted">ใบกำกับภาษี</dt><dd className="font-mono">{s.taxInvoiceNo}</dd></>)}
                </dl>
              </>
            )}
            {mode === 'refund' && (
              <div className="flex flex-col gap-3">
                <h3 className="font-semibold">เลือกรายการและจำนวนที่คืน</h3>
                {s.lines.map((l) => {
                  const max = s.refundable.find((r) => r.lineId === l.id)?.qty ?? 0;
                  return (
                    <div key={l.id} className="flex items-center gap-3 border-b border-line-soft py-2">
                      <span className="flex flex-1 flex-col"><span className="font-medium">{l.name}</span><span className="text-[12px] text-muted">ซื้อ {qtyText(l.qty)} · คืนได้ {qtyText(max)}</span></span>
                      <Select className="w-24" disabled={max <= 0} value={String(refundQty[l.id] ?? 0)} onChange={(e) => setRefundQty({ ...refundQty, [l.id]: Number(e.target.value) })} aria-label={`จำนวนคืน ${l.name}`}>
                        {Array.from({ length: Math.floor(max) + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                        {!Number.isInteger(max) && <option value={max}>{qtyText(max)}</option>}
                      </Select>
                      <Button size="sm" variant="ghost" disabled={max <= 0} onClick={() => setRefundQty({ ...refundQty, [l.id]: max })}>ทั้งหมด</Button>
                    </div>
                  );
                })}
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="เหตุผล" required><Input value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} /></Field>
                  <Field label="คืนเงินทาง">
                    <Select value={refund.methodCode} onChange={(e) => setRefund({ ...refund, methodCode: e.target.value })}>
                      {methods.data?.filter((m) => m.active).map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
                    </Select>
                  </Field>
                </div>
                <Checkbox checked={refund.restock} onChange={(restock) => setRefund({ ...refund, restock })} label="นำสินค้ากลับเข้าสต็อก" />
                <div className="flex justify-end gap-2">
                  <Button onClick={() => setMode('view')}>ยกเลิก</Button>
                  <Button variant="primary" loading={busy} disabled={!refund.reason.trim() || !Object.values(refundQty).some((q) => q > 0)} onClick={() => void doRefund()}>ยืนยันคืนสินค้า</Button>
                </div>
              </div>
            )}
            {mode === 'taxinv' && (
              <div className="flex flex-col gap-3">
                <h3 className="font-semibold">ออกใบกำกับภาษีเต็มรูป</h3>
                <Field label="ชื่อผู้ซื้อ / บริษัท" required><Input value={ti.name} onChange={(e) => setTi({ ...ti, name: e.target.value })} /></Field>
                <Field label="เลขประจำตัวผู้เสียภาษี (13 หลัก)" required><Input inputMode="numeric" value={ti.taxId} onChange={(e) => setTi({ ...ti, taxId: e.target.value.replace(/\D/g, '').slice(0, 13) })} /></Field>
                <Field label="สาขา"><Input value={ti.branch} onChange={(e) => setTi({ ...ti, branch: e.target.value })} /></Field>
                <Field label="ที่อยู่"><Input value={ti.address} onChange={(e) => setTi({ ...ti, address: e.target.value })} /></Field>
                <div className="flex justify-end gap-2">
                  <Button onClick={() => setMode('view')}>ยกเลิก</Button>
                  <Button variant="primary" loading={busy} disabled={!ti.name.trim() || ti.taxId.length !== 13} onClick={() => void doTaxInv()}>ออกใบกำกับภาษี</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
