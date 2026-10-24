import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Printer } from 'lucide-react';
import type { PrintDoc } from '@flexpos/shared';
import { api, errorMessage } from '@/lib/api';
import { money, useFormatters, useSettings } from '@/lib/settings';
import { useSession } from '@/lib/session';
import { printInBrowser } from '@/lib/print';
import { addDays, cn, qtyText, todayStr } from '@/lib/utils';
import { Page } from '@/components/layout/AppShell';
import { Button, EmptyState, ErrorState, Input, PageHeader, Select, SkeletonRows } from '@/components/ui/core';

type Kind = 'day' | 'hour' | 'product' | 'category' | 'staff' | 'method' | 'branch' | 'vat' | 'adjustments';
const KINDS: { value: Kind; label: string }[] = [
  { value: 'day', label: 'ยอดขายรายวัน' },
  { value: 'hour', label: 'ยอดขายรายชั่วโมง' },
  { value: 'product', label: 'ตามสินค้า' },
  { value: 'category', label: 'ตามหมวดหมู่' },
  { value: 'staff', label: 'ตามพนักงาน' },
  { value: 'method', label: 'ตามวิธีชำระเงิน' },
  { value: 'branch', label: 'ตามสาขา' },
  { value: 'vat', label: 'รายงานภาษีขาย' },
  { value: 'adjustments', label: 'การยกเลิก / คืนสินค้า' },
];

interface SalesRow { key: string; label: string; qty: number; bills: number; gross: number; discount: number; net: number; vat: number; cost: number | null; profit: number | null }

const PRESETS = [
  { label: 'วันนี้', from: () => todayStr(), to: () => todayStr() },
  { label: 'เมื่อวาน', from: () => addDays(todayStr(), -1), to: () => addDays(todayStr(), -1) },
  { label: '7 วัน', from: () => addDays(todayStr(), -6), to: () => todayStr() },
  { label: 'เดือนนี้', from: () => todayStr().slice(0, 8) + '01', to: () => todayStr() },
  { label: 'เดือนก่อน', from: () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return todayStr(d); }, to: () => { const d = new Date(); d.setDate(0); return todayStr(d); } },
];

export default function ReportsPage() {
  const f = useFormatters();
  const settings = useSettings();
  const { user, can } = useSession();
  const [kind, setKind] = useState<Kind>('day');
  const [from, setFrom] = useState(todayStr().slice(0, 8) + '01');
  const [to, setTo] = useState(todayStr());
  const [branchId, setBranchId] = useState('');
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/branches'), enabled: settings.modules.multiBranch && !user?.branchId });
  const query = { from, to, branchId: branchId || undefined };
  const sales = useQuery({ queryKey: ['report', kind, from, to, branchId], queryFn: () => api.get<{ rows: SalesRow[]; total: SalesRow }>('/api/reports/sales', { ...query, groupBy: kind }), enabled: !['vat', 'adjustments'].includes(kind) });
  const vat = useQuery({ queryKey: ['report-vat', from, to, branchId], queryFn: () => api.get<{ items: { date: string; docNo: string; kind: string; customer: string; taxId: string; branch: string; base: number; vat: number; exempt: number; total: number; status: string }[]; total: { base: number; vat: number; exempt: number; total: number }; store: { name: string; taxId: string } }>('/api/reports/vat', query), enabled: kind === 'vat' });
  const adj = useQuery({ queryKey: ['report-adj', from, to, branchId], queryFn: () => api.get<{ items: { id: string; docNo: string; kind: string; total: number; at: string; by: string | null; reason: string | null }[] }>('/api/reports/adjustments', query), enabled: kind === 'adjustments' });
  const profit = can('reports.profit');
  const active = kind === 'vat' ? vat : kind === 'adjustments' ? adj : sales;

  const exportAs = (format: 'xlsx' | 'csv') => {
    const path = kind === 'vat' ? '/api/reports/vat' : kind === 'adjustments' ? '/api/reports/adjustments' : '/api/reports/sales';
    api.download(path, { ...query, groupBy: kind, format }).catch((e) => toast.error(errorMessage(e)));
  };

  const printPdf = () => {
    const title = KINDS.find((k) => k.value === kind)!.label;
    const blocks: PrintDoc['blocks'] = [
      { t: 'text', text: settings.store.name, bold: true, size: 2 },
      { t: 'text', text: `${title} · ${f.date(from)} – ${f.date(to)}` },
      ...(kind === 'vat' && settings.store.taxId ? [{ t: 'text' as const, text: `เลขประจำตัวผู้เสียภาษี ${settings.store.taxId}` }] : []),
      { t: 'line' },
    ];
    if (kind === 'vat' && vat.data) {
      for (const i of vat.data.items) blocks.push({ t: 'row', left: `${i.date} ${i.docNo} ${i.customer}${i.taxId ? ' ' + i.taxId : ''}${i.status ? ' (' + i.status + ')' : ''}`, right: `${money(i.base)} | VAT ${money(i.vat)}` });
      blocks.push({ t: 'line' }, { t: 'row', left: 'รวม', right: `${money(vat.data.total.base)} | VAT ${money(vat.data.total.vat)}`, bold: true });
    } else if (kind === 'adjustments' && adj.data) {
      for (const i of adj.data.items) blocks.push({ t: 'row', left: `${f.dateTime(i.at)} ${i.docNo} ${i.kind} · ${i.reason ?? ''}`, right: money(i.total) });
    } else if (sales.data) {
      for (const r of sales.data.rows) blocks.push({ t: 'row', left: `${r.label}${r.qty ? ` (${qtyText(r.qty)})` : ''}`, right: money(r.net) });
      blocks.push({ t: 'line' }, { t: 'row', left: 'รวม', right: money(sales.data.total.net), bold: true });
    }
    void printInBrowser({ paper: 'A4', blocks });
  };

  return (
    <Page>
      <PageHeader
        title="รายงาน"
        actions={
          <>
            <Button icon={<Printer className="h-4 w-4" />} onClick={printPdf}>พิมพ์ / PDF</Button>
            <Button icon={<Download className="h-4 w-4" />} onClick={() => exportAs('xlsx')}>Excel</Button>
            <Button onClick={() => exportAs('csv')}>CSV</Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-auto min-w-[200px]" value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="ประเภทรายงาน">
          {KINDS.filter((k) => k.value !== 'branch' || settings.modules.multiBranch).map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </Select>
        <Input type="date" className="w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="ตั้งแต่" />
        <span className="text-muted">–</span>
        <Input type="date" className="w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="ถึง" />
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => (setFrom(p.from()), setTo(p.to()))} className={cn('h-10 rounded-full border px-3 text-[13px]', from === p.from() && to === p.to() ? 'border-ink bg-ink text-surface' : 'border-line-strong bg-surface')}>{p.label}</button>
        ))}
        {branches.data && branches.data.length > 1 && (
          <Select className="w-auto" value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="สาขา">
            <option value="">สาขาปัจจุบัน</option>
            <option value="all">ทุกสาขา</option>
            {branches.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      </div>
      <div className="card overflow-x-auto">
        {active.isLoading ? <SkeletonRows /> : active.isError ? <ErrorState error={active.error} onRetry={() => void active.refetch()} /> : kind === 'vat' ? (
          !vat.data?.items.length ? <EmptyState title="ไม่มีเอกสารในช่วงนี้" /> : (
            <table className="num w-full min-w-[900px] text-[14px]">
              <thead className="bg-sunken text-left text-[12px] text-muted"><tr>{['วันที่', 'เลขที่', 'ประเภท', 'ผู้ซื้อ', 'เลขผู้เสียภาษี', 'มูลค่า', 'VAT', 'ยกเว้น', 'รวม'].map((h, i) => <th key={h} className={cn('px-4 py-3', i >= 5 && 'text-right')}>{h}</th>)}</tr></thead>
              <tbody>
                {vat.data.items.map((i, n) => (
                  <tr key={n} className={cn('border-t border-line-soft', i.status && 'text-faint line-through')}>
                    <td className="px-4 py-2">{f.date(i.date)}</td><td className="px-4 py-2 font-mono">{i.docNo}</td><td className="px-4 py-2">{i.kind}</td><td className="px-4 py-2">{i.customer}</td><td className="px-4 py-2 font-mono">{i.taxId}</td>
                    <td className="px-4 py-2 text-right">{money(i.base)}</td><td className="px-4 py-2 text-right">{money(i.vat)}</td><td className="px-4 py-2 text-right">{money(i.exempt)}</td><td className="px-4 py-2 text-right font-medium">{money(i.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-line font-semibold"><tr><td className="px-4 py-3" colSpan={5}>รวม {vat.data.items.length} เอกสาร</td><td className="px-4 py-3 text-right">{money(vat.data.total.base)}</td><td className="px-4 py-3 text-right">{money(vat.data.total.vat)}</td><td className="px-4 py-3 text-right">{money(vat.data.total.exempt)}</td><td className="px-4 py-3 text-right">{money(vat.data.total.total)}</td></tr></tfoot>
            </table>
          )
        ) : kind === 'adjustments' ? (
          !adj.data?.items.length ? <EmptyState title="ไม่มีการยกเลิกหรือคืนสินค้าในช่วงนี้" /> : adj.data.items.map((i) => (
            <div key={i.id} className="flex items-center gap-3 border-b border-line-soft px-5 py-3 text-[14px]">
              <span className="w-[140px] text-muted">{f.dateTime(i.at)}</span><span className="w-[130px] font-mono">{i.docNo}</span><span className="w-[90px]">{i.kind}</span>
              <span className="flex-1 text-ink-2">{i.reason} {i.by && <span className="text-muted">· {i.by}</span>}</span>
              <span className="num font-semibold">{money(i.total)}</span>
            </div>
          ))
        ) : !sales.data?.rows.length ? <EmptyState title="ยังไม่มียอดขายในช่วงนี้" /> : (
          <table className="num w-full min-w-[720px] text-[14px]">
            <thead className="bg-sunken text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-3">{KINDS.find((k) => k.value === kind)!.label.replace('ยอดขาย', '').replace('ตาม', '') || 'รายการ'}</th>
                {(kind === 'product' || kind === 'category') && <th className="px-4 py-3 text-right">จำนวน</th>}
                <th className="px-4 py-3 text-right">บิล</th>
                {kind !== 'method' && <th className="px-4 py-3 text-right">ส่วนลด</th>}
                <th className="px-4 py-3 text-right">ยอดขายสุทธิ</th>
                {kind !== 'method' && <th className="px-4 py-3 text-right">VAT</th>}
                {profit && kind !== 'method' && <><th className="px-4 py-3 text-right">ต้นทุน</th><th className="px-4 py-3 text-right">กำไรขั้นต้น</th></>}
              </tr>
            </thead>
            <tbody>
              {sales.data.rows.map((r) => (
                <tr key={r.key} className="border-t border-line-soft">
                  <td className="px-4 py-2.5">{kind === 'day' ? f.date(r.label) : r.label}</td>
                  {(kind === 'product' || kind === 'category') && <td className="px-4 py-2.5 text-right">{qtyText(r.qty)}</td>}
                  <td className="px-4 py-2.5 text-right">{r.bills.toLocaleString()}</td>
                  {kind !== 'method' && <td className="px-4 py-2.5 text-right text-ink-2">{money(r.discount)}</td>}
                  <td className="px-4 py-2.5 text-right font-semibold">{money(r.net)}</td>
                  {kind !== 'method' && <td className="px-4 py-2.5 text-right text-ink-2">{money(r.vat)}</td>}
                  {profit && kind !== 'method' && <><td className="px-4 py-2.5 text-right text-ink-2">{money(r.cost ?? 0)}</td><td className={cn('px-4 py-2.5 text-right font-medium', (r.profit ?? 0) < 0 && 'text-danger')}>{money(r.profit ?? 0)}</td></>}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line font-semibold">
              <tr>
                <td className="px-4 py-3">รวม</td>
                {(kind === 'product' || kind === 'category') && <td className="px-4 py-3 text-right">{qtyText(sales.data.total.qty)}</td>}
                <td className="px-4 py-3 text-right">{kind === 'product' || kind === 'category' || kind === 'method' ? '' : sales.data.total.bills.toLocaleString()}</td>
                {kind !== 'method' && <td className="px-4 py-3 text-right">{money(sales.data.total.discount)}</td>}
                <td className="px-4 py-3 text-right">{money(sales.data.total.net)}</td>
                {kind !== 'method' && <td className="px-4 py-3 text-right">{money(sales.data.total.vat)}</td>}
                {profit && kind !== 'method' && <><td className="px-4 py-3 text-right">{money(sales.data.total.cost ?? 0)}</td><td className="px-4 py-3 text-right">{money(sales.data.total.profit ?? 0)}</td></>}
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </Page>
  );
}
