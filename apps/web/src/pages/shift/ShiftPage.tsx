import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDownCircle, ArrowUpCircle, Printer, Timer } from 'lucide-react';
import type { PrintDoc } from '@flexpos/shared';
import { api, errorMessage, registerName } from '@/lib/api';
import { money, useFormatters } from '@/lib/settings';
import { printInBrowser } from '@/lib/print';
import { cn } from '@/lib/utils';
import { Page } from '@/components/layout/AppShell';
import { Button, Card, EmptyState, Field, Input, PageHeader, SkeletonRows } from '@/components/ui/core';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { MoneyInput } from '@/components/ui/inputs';

interface Summary {
  id: string;
  number: number;
  register: string;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt: string | null;
  openedBy: string;
  closedBy: string | null;
  openingCash: number;
  countedCash: number | null;
  expectedCash: number | null;
  difference: number | null;
  cashSales: number;
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
  salesTotal: number;
  salesCount: number;
  refundTotal: number;
  voidTotal: number;
  voidCount: number;
  discountTotal: number;
  vatTotal: number;
  methods: { name: string; sales: number; refunds: number; count: number }[];
  moves: { id: string; type: 'in' | 'out'; amount: number; reason: string; at: string; by: string | null }[];
}

const NOTES = [100000, 50000, 10000, 5000, 2000, 1000, 500, 100, 50, 25];

export default function ShiftPage() {
  const qc = useQueryClient();
  const f = useFormatters();
  const confirm = useConfirm();
  const cur = useQuery({ queryKey: ['shift', 'current'], queryFn: () => api.get<Summary | null>('/api/shifts/current') });
  const history = useQuery({ queryKey: ['shifts'], queryFn: () => api.get<{ id: string; number: number; register: string; status: string; opened_at: string; closed_at: string | null; opening_cash: number; counted_cash: number | null; expected_cash: number | null; opened_by: string }[]>('/api/shifts') });
  const [opening, setOpening] = useState(0);
  const [move, setMove] = useState<'in' | 'out' | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['shift'] });
    qc.invalidateQueries({ queryKey: ['shifts'] });
  };
  const printReport = async (id: string) => {
    try {
      await printInBrowser(await api.get<PrintDoc>(`/api/shifts/${id}/report`));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const s = cur.data;
  return (
    <Page className="max-w-[1100px]">
      <PageHeader title="กะการทำงาน" sub={`เครื่อง ${registerName()}`} actions={s && (
        <>
          <Button icon={<ArrowDownCircle className="h-4 w-4" />} onClick={() => setMove('in')}>นำเงินเข้า</Button>
          <Button icon={<ArrowUpCircle className="h-4 w-4" />} onClick={() => setMove('out')}>นำเงินออก</Button>
          <Button icon={<Printer className="h-4 w-4" />} onClick={() => void printReport(s.id)}>พิมพ์ X Report</Button>
          <Button variant="primary" onClick={() => setCloseOpen(true)}>ปิดกะ</Button>
        </>
      )} />
      {cur.isLoading ? <SkeletonRows /> : !s ? (
        <Card>
          <form className="flex flex-col items-start gap-4 md:flex-row md:items-end" onSubmit={async (e) => { e.preventDefault(); try { await api.post('/api/shifts/open', { openingCash: opening, register: registerName() }); toast.success('เปิดกะแล้ว'); refresh(); } catch (err) { toast.error(errorMessage(err)); } }}>
            <div className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-soft text-primary"><Timer className="h-6 w-6" /></div>
            <Field label="เงินทอนเริ่มต้นในลิ้นชัก" className="w-full md:w-64"><MoneyInput value={opening} onValue={setOpening} /></Field>
            <Button type="submit" variant="primary" size="lg">เปิดกะ</Button>
          </form>
        </Card>
      ) : (
        <ShiftSummary s={s} f={f} />
      )}
      <Card title="ประวัติกะ" pad>
        {!history.data?.length ? <EmptyState title="ยังไม่มีประวัติกะ" /> : history.data.map((h) => {
          const diff = h.counted_cash !== null && h.expected_cash !== null ? h.counted_cash - h.expected_cash : null;
          return (
            <button key={h.id} onClick={() => setView(h.id)} className="flex items-center gap-3 border-b border-line-soft py-2.5 text-left last:border-0 hover:bg-sunken">
              <span className="w-16 font-mono text-[13px]">#{h.number}</span>
              <span className="flex flex-1 flex-col">
                <span className="text-[14px] font-medium">{h.register} · {h.opened_by}</span>
                <span className="text-[12px] text-muted">{f.dateTime(h.opened_at)}{h.closed_at ? ` – ${f.dateTime(h.closed_at)}` : ' · เปิดอยู่'}</span>
              </span>
              {diff !== null && <span className={cn('num text-[14px] font-semibold', diff === 0 ? 'text-primary' : 'text-danger')}>{diff === 0 ? 'ตรง' : `${diff > 0 ? '+' : ''}${money(diff)}`}</span>}
            </button>
          );
        })}
      </Card>
      {move && s && <CashMoveDialog type={move} shiftId={s.id} onClose={(ok) => { setMove(null); if (ok) refresh(); }} />}
      {closeOpen && s && <CloseDialog s={s} onClose={async (closed) => { setCloseOpen(false); if (closed) { refresh(); const r = await confirm({ title: 'ปิดกะแล้ว', body: 'พิมพ์ Z Report สรุปปิดกะหรือไม่?', confirmText: 'พิมพ์' }); if (r.ok) void printReport(s.id); } }} />}
      {view && <HistoryDialog id={view} onClose={() => setView(null)} onPrint={() => void printReport(view)} />}
    </Page>
  );
}

function ShiftSummary({ s, f }: { s: Summary; f: ReturnType<typeof useFormatters> }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card title={`กะ #${s.number} · ${s.status === 'open' ? 'เปิดอยู่' : 'ปิดแล้ว'}`}>
        <p className="-mt-2 text-[13px] text-muted">เปิดโดย {s.openedBy} · {f.dateTime(s.openedAt)}{s.closedAt ? ` · ปิดโดย ${s.closedBy} ${f.dateTime(s.closedAt)}` : ''}</p>
        <div className="grid grid-cols-2 gap-2">
          <Big label={`ยอดขาย (${s.salesCount} บิล)`} value={money(s.salesTotal)} />
          <Big label="เงินสดที่ควรมีในลิ้นชัก" value={money(s.expectedCash ?? 0)} accent />
        </div>
        <Rows rows={[['ส่วนลด', s.discountTotal], ['ภาษีขาย', s.vatTotal], ['คืนสินค้า', s.refundTotal], [`ยกเลิก (${s.voidCount} บิล)`, s.voidTotal]]} />
      </Card>
      <Card title="เงินสด">
        <Rows rows={[['เงินทอนตั้งต้น', s.openingCash], ['รับเงินสด', s.cashSales], ['คืนเงินสด', -s.cashRefunds], ['นำเงินเข้า', s.cashIn], ['นำเงินออก', -s.cashOut]]} />
        {s.countedCash !== null && <Rows rows={[['นับได้จริง', s.countedCash], ['ส่วนต่าง', s.difference ?? 0]]} />}
        <div className="mt-1 text-[13px] font-semibold text-muted">แยกตามวิธีชำระ</div>
        <Rows rows={s.methods.map((m) => [`${m.name} (${m.count})`, m.sales - m.refunds])} />
        {s.moves.length > 0 && (
          <>
            <div className="mt-1 text-[13px] font-semibold text-muted">รายการนำเงินเข้า/ออก</div>
            {s.moves.map((m) => (
              <div key={m.id} className="flex justify-between text-[14px]"><span>{m.type === 'in' ? 'นำเข้า' : 'นำออก'} · {m.reason} <span className="text-muted">({m.by})</span></span><span className="num">{m.type === 'out' ? '-' : ''}{money(m.amount)}</span></div>
            ))}
          </>
        )}
      </Card>
    </div>
  );
}

function Big({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn('rounded-xl px-4 py-3', accent ? 'bg-soft' : 'bg-sunken')}>
      <div className="text-[13px] text-muted">{label}</div>
      <div className={cn('num text-[24px] font-semibold', accent && 'text-soft-fg')}>{value}</div>
    </div>
  );
}

function Rows({ rows }: { rows: [string, number][] }) {
  return (
    <div className="flex flex-col">
      {rows.map(([l, v]) => (
        <div key={l} className="flex justify-between border-b border-line-soft py-1.5 text-[14px] last:border-0"><span className="text-ink-2">{l}</span><span className="num font-medium">{money(v)}</span></div>
      ))}
    </div>
  );
}

function CashMoveDialog({ type, shiftId, onClose }: { type: 'in' | 'out'; shiftId: string; onClose: (ok: boolean) => void }) {
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose(false)} title={type === 'in' ? 'นำเงินเข้าลิ้นชัก' : 'นำเงินออกจากลิ้นชัก'} size="sm" footer={<><Button onClick={() => onClose(false)}>ยกเลิก</Button><Button variant="primary" loading={busy} disabled={amount <= 0 || !reason.trim()} onClick={async () => { setBusy(true); try { await api.post(`/api/shifts/${shiftId}/cash`, { type, amount, reason }); toast.success('บันทึกแล้ว'); onClose(true); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }}>บันทึก</Button></>}>
      <div className="flex flex-col gap-4 pb-2">
        <Field label="จำนวนเงิน"><MoneyInput autoFocus value={amount} onValue={setAmount} className="h-12 text-[18px]" /></Field>
        <Field label="เหตุผล" required><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={type === 'in' ? 'เช่น เพิ่มเงินทอน' : 'เช่น จ่ายค่าน้ำแข็ง / ฝากธนาคาร'} /></Field>
      </div>
    </Dialog>
  );
}

function CloseDialog({ s, onClose }: { s: Summary; onClose: (closed: boolean) => void }) {
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [manual, setManual] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const counted = manual ?? NOTES.reduce((a, n) => a + n * (counts[n] ?? 0), 0);
  const diff = counted - (s.expectedCash ?? 0);
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose(false)}
      title="ปิดกะ · นับเงินในลิ้นชัก"
      description="นับธนบัตร/เหรียญแต่ละชนิด หรือกรอกยอดรวมเอง"
      size="lg"
      footer={
        <>
          <span className={cn('num mr-auto text-[15px] font-semibold', diff === 0 ? 'text-primary' : 'text-danger')}>ส่วนต่าง {diff > 0 ? '+' : ''}{money(diff)}</span>
          <Button onClick={() => onClose(false)}>ยกเลิก</Button>
          <Button variant="primary" loading={busy} disabled={diff !== 0 && !note.trim()} onClick={async () => { setBusy(true); try { await api.post(`/api/shifts/${s.id}/close`, { countedCash: counted, note }); toast.success('ปิดกะเรียบร้อย'); onClose(true); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }}>ยืนยันปิดกะ</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {NOTES.map((n) => (
            <label key={n} className="flex flex-col gap-1 rounded-xl border border-line p-2">
              <span className="num text-[13px] font-semibold">{money(n).replace('.00', '')}</span>
              <input inputMode="numeric" className="num h-10 rounded-lg border border-line-strong px-2 text-right text-[16px]" value={counts[n] ?? ''} onChange={(e) => { setManual(null); setCounts({ ...counts, [n]: Number(e.target.value.replace(/\D/g, '')) || 0 }); }} aria-label={`จำนวน ${n / 100} บาท`} />
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-sunken px-4 py-3"><div className="text-[13px] text-muted">ควรมี</div><div className="num text-[22px] font-semibold">{money(s.expectedCash ?? 0)}</div></div>
          <Field label="นับได้รวม"><MoneyInput value={counted} onValue={setManual} className="h-[52px] text-[20px] font-semibold" /></Field>
          <div className={cn('rounded-xl px-4 py-3', diff === 0 ? 'bg-soft' : 'bg-danger-soft')}><div className="text-[13px] text-muted">ส่วนต่าง</div><div className={cn('num text-[22px] font-semibold', diff === 0 ? 'text-soft-fg' : 'text-danger')}>{diff > 0 ? '+' : ''}{money(diff)}</div></div>
        </div>
        <Field label={diff !== 0 ? 'หมายเหตุ (จำเป็นเมื่อเงินไม่ตรง)' : 'หมายเหตุ'} required={diff !== 0}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function HistoryDialog({ id, onClose, onPrint }: { id: string; onClose: () => void; onPrint: () => void }) {
  const f = useFormatters();
  const q = useQuery({ queryKey: ['shift', id], queryFn: () => api.get<Summary>(`/api/shifts/${id}`) });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={q.data ? `กะ #${q.data.number} · ${q.data.register}` : 'กะ'} size="xl" footer={<Button icon={<Printer className="h-4 w-4" />} onClick={onPrint}>พิมพ์รายงาน</Button>}>
      <div className="pb-3">{q.data ? <ShiftSummary s={q.data} f={f} /> : <SkeletonRows />}</div>
    </Dialog>
  );
}
