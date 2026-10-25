import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Plus, Printer, X, WifiOff, FileText } from 'lucide-react';
import { bankInfo, computeTender, maskAccount, pointsValue, type BankAccount, type PaymentMethodView, type PricingResult, type SaleInput, type SaleView, type Settings, t } from '@flexpos/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { money } from '@/lib/settings';
import { queueSale } from '@/lib/offline';
import { printSaleReceipt, printInBrowser, type PrinterInfo } from '@/lib/print';
import { sendLive } from '@/lib/live';
import { registerName } from '@/lib/api';
import { cn, uuid } from '@/lib/utils';
import { Button, Checkbox, Field, Input } from '@/components/ui/core';
import { NumberInput, NumPad, applyKey } from '@/components/ui/inputs';
import { QrImage } from '@/components/PrintDocView';
import { cart, type CartState } from './cart';
import * as RD from '@radix-ui/react-dialog';
import { tn } from '@/lib/i18n';

interface Tender {
  id: string;
  methodCode: string;
  amount: number;
  ref: string;
}

export interface PayDone {
  sale: SaleView | null;
  offline: boolean;
  change: number;
  total: number;
}

export function PaymentDialog({
  open,
  onClose,
  state,
  pricing,
  methods,
  settings,
  printers,
  buildLines,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  state: CartState;
  pricing: PricingResult;
  methods: PaymentMethodView[];
  settings: Settings;
  printers: PrinterInfo[];
  buildLines: () => SaleInput['lines'];
  onDone: (d: PayDone) => void;
}) {
  const usable = useMemo(
    () => methods.filter((m) => m.active && (m.kind !== 'credit' || !!state.customer) && m.kind !== 'points'),
    [methods, state.customer],
  );
  const [method, setMethod] = useState('cash');
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [cashText, setCashText] = useState('');
  const [ref, setRef] = useState('');
  const [print, setPrint] = useState(settings.receipt.autoPrint);
  const [busy, setBusy] = useState(false);
  const [points, setPoints] = useState(0);
  const [taxInv, setTaxInv] = useState<{ on: boolean; name: string; taxId: string; branch: string; address: string }>({ on: false, name: '', taxId: '', branch: t('สำนักงานใหญ่'), address: '' });
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setMethod(usable[0]?.code ?? 'cash');
    setTenders([]);
    setCashText('');
    setRef('');
    setPoints(state.pointsRedeemed);
    setPrint(settings.receipt.autoPrint);
    const c = state.customer;
    setTaxInv({ on: false, name: c?.taxName ?? '', taxId: c?.taxId ?? '', branch: c?.taxBranch || t('สำนักงานใหญ่'), address: c?.address ?? '' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const ppAccounts = settings.payments.accounts.filter((a) => a.promptPayId);
  const [ppAccountId, setPpAccountId] = useState('');
  useEffect(() => {
    if (open) setPpAccountId((ppAccounts.find((a) => a.isDefault) ?? ppAccounts[0])?.id ?? '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const transferAccounts = settings.payments.accounts.filter((a) => a.accountNumber && a.showOnBill);
  const pointsAmt = Math.min(pointsValue(points, settings.points), pricing.total);
  const total = pricing.total;
  const m = usable.find((x) => x.code === method);
  const kind = m?.kind ?? 'cash';
  const isTransfer = !!m && (m.code === 'transfer' || m.code === 'transfer_intl' || m.name.includes('โอน') || /transfer/i.test(m.name));
  const paidBefore = tenders.reduce((a, t) => a + t.amount, 0) + pointsAmt;
  const remaining = Math.max(0, total - paidBefore);
  const cashTyped = cashText ? Math.round(Number(cashText) * 100) : 0;
  const current = kind === 'cash' ? (cashText ? cashTyped : remaining) : remaining;

  const allTenders = [...tenders, ...(current > 0 || tenders.length === 0 ? [{ id: 'cur', methodCode: method, amount: current, ref }] : [])].filter((t) => t.amount > 0 || total === 0);
  const tender = computeTender(
    total - pointsAmt,
    allTenders.map((t) => ({ method: t.methodCode, amount: t.amount, allowsChange: usable.find((x) => x.code === t.methodCode)?.kind === 'cash' })),
  );
  const ok = tender.ok && (!taxInv.on || (taxInv.name.trim() && /^\d{13}$/.test(taxInv.taxId)));

  // PromptPay QR for the amount being paid now
  const qr = useQuery({
    queryKey: ['promptpay', current, ppAccountId],
    queryFn: () => api.get<{ payload: string; account: BankAccount | null }>('/api/promptpay', { amount: current, accountId: ppAccountId || undefined }),
    enabled: open && kind === 'promptpay' && current > 0,
    retry: false,
  });

  useEffect(() => {
    if (!open) return;
    sendLive({
      type: 'display.update',
      register: registerName(),
      payload: { state: 'pay', lines: [], subtotal: pricing.subtotal, discount: pricing.discountTotal, total, qr: kind === 'promptpay' ? (qr.data?.payload ?? null) : null, change: tender.change },
    });
  }, [open, kind, qr.data, total, tender.change, pricing.subtotal, pricing.discountTotal]);

  const addSplit = () => {
    if (current <= 0) return;
    setTenders([...tenders, { id: uuid(), methodCode: method, amount: Math.min(current, remaining || current), ref }]);
    setCashText('');
    setRef('');
  };

  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true);
    const payload: SaleInput = {
      id: state.saleId,
      lines: buildLines(),
      billDiscount: state.billDiscount,
      customerId: state.customer?.id ?? null,
      couponCodes: state.couponCodes,
      pointsRedeemed: points,
      payments: allTenders.map((t) => ({ methodCode: t.methodCode, amount: t.amount, ref: t.ref })),
      orderId: state.order?.id ?? null,
      note: state.note,
      taxInvoice: taxInv.on ? { name: taxInv.name.trim(), taxId: taxInv.taxId, branch: taxInv.branch, address: taxInv.address } : null,
      createdAt: new Date().toISOString(),
      managerPin: state.managerPin ?? undefined,
    };
    try {
      const sale = await api.post<SaleView>('/api/sales', payload);
      if (state.heldId) await api.del(`/api/held/${state.heldId}`).catch(() => undefined);
      // Browsers can only print through a blocking dialog; auto-print needs a configured printer or the desktop app.
      const canAutoPrint = !!window.flexpos || printers.some((p) => p.active && p.role === 'receipt');
      if (print && canAutoPrint) {
        printSaleReceipt(sale.id, printers).catch((e) => toast.error(t('พิมพ์ใบเสร็จไม่สำเร็จ: {0}', errorMessage(e)), { action: { label: t('ลองอีกครั้ง'), onClick: () => void printSaleReceipt(sale.id, printers) } }));
      }
      onDone({ sale, offline: false, change: sale.change, total: sale.total });
    } catch (e) {
      if (e instanceof ApiError && e.isNetwork && !state.order) {
        // Offline: keep the sale on this device and send it when the connection returns.
        await queueSale(payload);
        if (print) {
          await printInBrowser({
            paper: settings.receipt.paper,
            cut: true,
            blocks: [
              { t: 'text', text: settings.store.name, align: 'center', bold: true, size: 2 },
              { t: 'text', text: t('ใบรับเงินชั่วคราว (ออฟไลน์)'), align: 'center' },
              { t: 'line', dashed: true },
              ...payload.lines.map((l) => ({ t: 'row' as const, left: `${l.qty}× ${l.name}`, right: (Math.round(l.unitPrice * l.qty) / 100).toFixed(2) })),
              { t: 'line', dashed: true },
              { t: 'row', left: t('ยอดสุทธิ'), right: (total / 100).toFixed(2), bold: true, size: 2 },
              { t: 'text', text: t('ใบเสร็จฉบับจริงจะออกเมื่อระบบเชื่อมต่อได้'), align: 'center' },
            ],
          }).catch(() => undefined);
        }
        onDone({ sale: null, offline: true, change: tender.change, total });
      } else {
        toast.error(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const t = e.target as HTMLElement;
      // Buttons handle Enter themselves; other fields keep Enter for typing.
      if (t.tagName === 'BUTTON' || ((t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !t.dataset.cash)) return;
      e.preventDefault();
      void submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const notes = [{ label: t('พอดี'), v: remaining, exact: true }, ...settings.pos.quickNotes.map((n) => ({ label: money(n).replace('.00', ''), v: n, exact: false }))];

  return (
    <RD.Root open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 animate-fade-in bg-[rgb(23_25_28/0.45)]" />
        <RD.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[94vh] w-[calc(100vw-24px)] max-w-[860px] -translate-x-1/2 -translate-y-1/2 animate-pop-in flex-col overflow-hidden rounded-[20px] bg-surface shadow-pop md:flex-row">
          <RD.Title className="sr-only">{t('ชำระเงิน')}</RD.Title>
          <RD.Description className="sr-only">{t('เลือกวิธีชำระเงินและยืนยัน')}</RD.Description>
          <div className="flex flex-none gap-1.5 overflow-x-auto bg-canvas p-3 md:w-[220px] md:flex-col md:p-[20px_14px]">
            <span className="hidden px-2 pb-2 text-[13px] text-muted md:block">{t('วิธีชำระเงิน')}</span>
            {usable.map((x) => (
              <button
                key={x.code}
                onClick={() => {
                  setMethod(x.code);
                  setCashText('');
                }}
                className={cn('h-[52px] flex-none whitespace-nowrap rounded-xl border px-3.5 text-left text-[15px] font-medium', method === x.code ? 'border-primary bg-surface text-primary ring-1 ring-primary' : 'border-transparent hover:bg-surface')}
              >
                {x.name}
              </button>
            ))}
            {settings.points.enabled && state.customer && state.customer.points > 0 && (
              <div className="mt-auto hidden flex-col gap-1.5 rounded-xl bg-surface p-3 md:flex">
                <span className="text-[12px] text-muted">{tn('ใช้แต้ม (มี {0})', state.customer.points.toLocaleString())}</span>
                <NumberInput value={points} onValue={(v) => setPoints(Math.max(0, Math.min(v, state.customer!.points)))} className="h-10" aria-label={t('แต้มที่ใช้')} />
                <span className="num text-[12px] text-primary">= {money(pointsValue(points, settings.points))}</span>
              </div>
            )}
          </div>
          <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5 md:p-[24px_28px]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[14px] text-muted">{tenders.length || pointsAmt ? t('คงเหลือที่ต้องชำระ') : t('ยอดที่ต้องชำระ')}</div>
                <div className="num text-[40px] font-bold leading-[1.1]">{money(tenders.length || pointsAmt ? remaining : total)}</div>
                {(tenders.length > 0 || pointsAmt > 0) && <div className="num text-[13px] text-muted">{tn('ยอดรวม {0}', money(total))}</div>}
              </div>
              <RD.Close asChild>
                <button className="grid h-11 w-11 place-items-center rounded-xl border border-line-strong" aria-label={t('ปิด')} disabled={busy}>
                  <X className="h-5 w-5" />
                </button>
              </RD.Close>
            </div>

            {(tenders.length > 0 || pointsAmt > 0) && (
              <div className="flex flex-col gap-1.5 rounded-xl bg-sunken p-3 text-[14px]">
                {pointsAmt > 0 && (
                  <div className="flex justify-between">
                    <span>{tn('แต้มสะสม {0} แต้ม', points.toLocaleString())}</span>
                    <span className="num font-medium">{money(pointsAmt)}</span>
                  </div>
                )}
                {tenders.map((tk) => (
                  <div key={tk.id} className="flex items-center justify-between gap-2">
                    <span>{usable.find((x) => x.code === tk.methodCode)?.name}</span>
                    <span className="flex items-center gap-2">
                      <span className="num font-medium">{money(tk.amount)}</span>
                      <button className="text-faint hover:text-danger" aria-label={t('ลบ')} onClick={() => setTenders(tenders.filter((x) => x !== tk))}>
                        <X className="h-4 w-4" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {kind === 'cash' && (
              <div className="flex flex-col gap-3.5">
                <div className="grid grid-cols-3 gap-2">
                  {notes.map((n) => (
                    <button
                      key={n.label}
                      onClick={() => setCashText(n.exact ? (n.v / 100).toString() : ((cashTyped || 0) + n.v) / 100 + '')}
                      className="num h-14 rounded-xl border border-line-strong bg-surface text-[17px] font-semibold hover:border-primary"
                    >
                      {n.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col rounded-[14px] bg-canvas px-4 py-3.5">
                    <span className="text-[13px] text-muted">{t('รับเงิน')}</span>
                    <input
                      data-cash="1"
                      autoFocus
                      inputMode="decimal"
                      value={cashText}
                      placeholder={(remaining / 100).toFixed(2)}
                      onChange={(e) => setCashText(e.target.value.replace(/[^\d.]/g, ''))}
                      className="num w-full bg-transparent text-[24px] font-semibold outline-none placeholder:text-faint"
                      aria-label={t('จำนวนเงินที่รับ')}
                    />
                  </label>
                  <div className={cn('flex flex-col rounded-[14px] px-4 py-3.5', tender.change > 0 ? 'bg-soft' : 'bg-canvas')}>
                    <span className="text-[13px] text-muted">{t('เงินทอน')}</span>
                    <span className={cn('num text-[24px] font-bold', tender.change > 0 ? 'text-soft-fg' : 'text-ink')}>{money(tender.change)}</span>
                  </div>
                </div>
                <NumPad className="md:hidden" onKey={(k) => setCashText((c) => applyKey(c, k))} />
              </div>
            )}

            {kind === 'promptpay' && (
              <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
                <div className="grid h-[200px] w-[200px] flex-none place-items-center rounded-[14px] border border-line p-2">
                  {qr.data ? <QrImage data={qr.data.payload} size={184} /> : qr.isError ? <span className="px-3 text-center text-[13px] text-danger">{errorMessage(qr.error)}</span> : <div className="skeleton h-[184px] w-[184px]" />}
                </div>
                <div className="flex flex-col gap-2 text-[14px] text-ink-2">
                  <span className="text-[16px] font-semibold text-ink">{tn('สแกนเพื่อชำระ {0}', money(current))}</span>
                  {ppAccounts.length > 1 && (
                    <select value={ppAccountId} onChange={(e) => setPpAccountId(e.target.value)} className="h-10 rounded-lg border border-line-strong bg-surface px-2 text-[14px]" aria-label={t('บัญชีรับเงิน')}>
                      {ppAccounts.map((a) => <option key={a.id} value={a.id}>{a.accountName} · {bankInfo(a.bankCode).name}</option>)}
                    </select>
                  )}
                  <span>{tn('บัญชี: {0}', qr.data?.account?.accountName ?? settings.store.name)}</span>
                  {qr.data?.account && <span>{bankInfo(qr.data.account.bankCode).name}</span>}
                  <span className="text-[13px] text-muted">{t('ยอดเงินอยู่ใน QR แล้ว ลูกค้าไม่ต้องพิมพ์ยอด · ใช้ได้ทุกแอปธนาคาร')}</span>
                  {settings.modules.customerDisplay && (
                    <span className="flex items-center gap-2 text-primary">
                      <span className="h-2 w-2 rounded-full bg-accent" />{t('แสดงบนจอลูกค้าแล้ว')}</span>
                  )}
                  <span className="text-[13px] text-muted">{t('ตรวจสอบยอดเงินเข้าในแอปธนาคารก่อนกดยืนยัน')}</span>
                </div>
              </div>
            )}

            {kind === 'credit' && state.customer && (
              <div className="rounded-[14px] bg-warn-soft p-4 text-[15px] text-warn">{t('บันทึก')}{' '}{money(current)}{' '}{t('เป็นยอดค้างชำระของ')}{' '}{state.customer.name}
                <div className="mt-1 text-[13px]">{tn('ค้างอยู่ {0}{1}', money(state.customer.creditBalance), state.customer.creditLimit > 0 ? t(' · วงเงิน {0}', money(state.customer.creditLimit)) : '')}</div>
              </div>
            )}

            {kind === 'other' && isTransfer && transferAccounts.length > 0 && (
              <div className="flex flex-col gap-2 rounded-[14px] border border-line p-3">
                <span className="text-[13px] font-semibold text-muted">{t('ให้ลูกค้าโอนเข้าบัญชี')}</span>
                {transferAccounts.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 text-[14px]">
                    <span className="grid h-9 w-9 flex-none place-items-center rounded-lg text-[10px] font-bold text-white" style={{ background: bankInfo(a.bankCode).color }}>{a.bankCode.slice(0, 4)}</span>
                    <span className="flex flex-col">
                      <span className="font-semibold">{a.accountName}</span>
                      <span className="num text-muted">{a.bankCode === 'OTHER' ? a.bankName : bankInfo(a.bankCode).name} · {maskAccount(a.accountNumber)}{a.swift ? ` · SWIFT ${a.swift}` : ''}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {kind === 'other' && (
              <div className="flex flex-col gap-3">
                <div className="rounded-[14px] bg-canvas p-4 text-[15px] text-ink-2">{tn('บันทึกยอด {0} เป็น “{1}” แล้วกดยืนยัน', money(current), m?.name)}</div>
                <Field label={t('เลขอ้างอิง (ถ้ามี)')}>
                  <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t('เช่น เลขอนุมัติบัตร / เลขที่โอน')} maxLength={100} />
                </Field>
              </div>
            )}

            {remaining > 0 && current > 0 && current < remaining && kind !== 'cash' && (
              <p className="text-[13px] text-muted">{t('ชำระบางส่วนแล้วเลือกวิธีอื่นสำหรับยอดที่เหลือได้')}</p>
            )}

            {settings.tax.vatEnabled && (
              <div className="rounded-[14px] border border-line p-3">
                <Checkbox checked={taxInv.on} onChange={(on) => setTaxInv({ ...taxInv, on })} label={<span className="flex items-center gap-2"><FileText className="h-4 w-4" />{t('ออกใบกำกับภาษีเต็มรูป')}</span>} />
                {taxInv.on && (
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <Field label={t('ชื่อผู้ซื้อ / บริษัท')} required>
                      <Input value={taxInv.name} onChange={(e) => setTaxInv({ ...taxInv, name: e.target.value })} />
                    </Field>
                    <Field label={t('เลขประจำตัวผู้เสียภาษี')} required error={taxInv.taxId && !/^\d{13}$/.test(taxInv.taxId) ? t('ต้องเป็นตัวเลข 13 หลัก') : undefined}>
                      <Input inputMode="numeric" value={taxInv.taxId} onChange={(e) => setTaxInv({ ...taxInv, taxId: e.target.value.replace(/\D/g, '').slice(0, 13) })} />
                    </Field>
                    <Field label={t('สาขา')}>
                      <Input value={taxInv.branch} onChange={(e) => setTaxInv({ ...taxInv, branch: e.target.value })} />
                    </Field>
                    <Field label={t('ที่อยู่')}>
                      <Input value={taxInv.address} onChange={(e) => setTaxInv({ ...taxInv, address: e.target.value })} />
                    </Field>
                  </div>
                )}
              </div>
            )}

            <div className="mt-auto flex flex-wrap items-center gap-2.5 pt-2">
              <Checkbox checked={print} onChange={setPrint} label={t('พิมพ์ใบเสร็จ {0}', settings.receipt.paper === 'A4' ? 'A4' : settings.receipt.paper + 'mm')} />
              <div className="flex-1" />
              {kind !== 'cash' && current > 0 && current < total && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={addSplit}>{t('แบ่งจ่าย')}</Button>
              )}
              {kind === 'cash' && cashText && cashTyped < remaining && cashTyped > 0 && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={addSplit}>{t('รับเงินสดบางส่วน')}</Button>
              )}
              <Button ref={confirmRef} variant="primary" size="xl" className="min-w-[220px]" disabled={!ok} loading={busy} onClick={() => void submit()}>{t('ยืนยันการชำระ')}</Button>
            </div>
            {!tender.ok && tender.due > 0 && allTenders.length > 0 && <p className="text-right text-[13px] text-danger">{tn('ยังขาดอีก {0}', money(tender.due))}</p>}
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export function DoneDialog({ done, onClose, printers }: { done: PayDone | null; onClose: () => void; printers: PrinterInfo[] }) {
  useEffect(() => {
    if (!done) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done, onClose]);
  if (!done) return null;
  return (
    <RD.Root open onOpenChange={(v) => !v && onClose()}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-[rgb(23_25_28/0.45)]" />
        <RD.Content className="fixed left-1/2 top-1/2 z-50 flex w-[calc(100vw-24px)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 animate-pop-in flex-col items-center gap-4 rounded-[20px] bg-surface p-7 text-center shadow-pop">
          <div className={cn('grid h-14 w-14 place-items-center rounded-full', done.offline ? 'bg-warn-soft text-warn' : 'bg-soft text-primary')}>{done.offline ? <WifiOff className="h-7 w-7" /> : <Check className="h-7 w-7" />}</div>
          <RD.Title className="text-[20px] font-semibold">{done.offline ? t('บันทึกการขายไว้ในเครื่องแล้ว') : t('ชำระเงินเรียบร้อย')}</RD.Title>
          <RD.Description className="text-[14px] text-muted">
            {done.offline ? t('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ระบบจะส่งบิลนี้อัตโนมัติเมื่อกลับมาออนไลน์ โดยไม่เกิดบิลซ้ำ') : `${done.sale?.docNo}${done.sale?.taxInvoiceNo ? t(' · ใบกำกับภาษี {0}', done.sale.taxInvoiceNo) : ''}`}
          </RD.Description>
          {done.change > 0 && (
            <div className="w-full rounded-2xl bg-soft px-4 py-4">
              <div className="text-[14px] text-soft-fg">{t('เงินทอน')}</div>
              <div className="num text-[44px] font-bold leading-tight text-soft-fg">{money(done.change)}</div>
            </div>
          )}
          <div className="flex w-full gap-2">
            {done.sale && (
              <Button className="flex-1" size="lg" icon={<Printer className="h-4 w-4" />} onClick={() => printSaleReceipt(done.sale!.id, printers, { reprint: true }).catch((e) => toast.error(errorMessage(e)))}>{t('พิมพ์ซ้ำ')}</Button>
            )}
            <Button className="flex-[2]" variant="primary" size="lg" autoFocus onClick={onClose}>{t('บิลใหม่')}{' '}<span className="ml-1 font-mono text-[12px] opacity-80">Enter</span>
            </Button>
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export function resetCartAfterSale() {
  cart.clear();
}
