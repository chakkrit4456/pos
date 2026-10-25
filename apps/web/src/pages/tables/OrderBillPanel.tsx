import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Minus, Printer, QrCode, Trash2, X } from 'lucide-react';
import { priceCart } from '@flexpos/shared';
import { api, errorMessage } from '@/lib/api';
import { money, useSettings } from '@/lib/settings';
import { cn, qtyText } from '@/lib/utils';
import { Badge, Button, ErrorState, Field, Input, Spinner } from '@/components/ui/core';
import { Dialog } from '@/components/ui/dialog';
import { useApproval } from '../pos/dialogs';
import { BillSlipDialog } from '@/components/BillSlipDialog';

interface Item {
  id: string;
  round_no: number;
  product_id: string;
  name: string;
  qty: number;
  unit_price: number;
  modifiers: { name: string }[];
  note: string;
  status: string;
  source: string;
  created_at: string;
  by: string | null;
  total: number;
}

export interface OrderView {
  id: string;
  tableName: string | null;
  name: string;
  status: string;
  guests: number;
  openedAt: string;
  openedBy: string;
  billRequested: boolean;
  total: number;
  items: Item[];
}

const STATUS: Record<string, { label: string; tone: 'warn' | 'success' | 'neutral' | 'info' | 'danger' }> = {
  sent: { label: 'ส่งครัวแล้ว', tone: 'info' },
  preparing: { label: 'กำลังทำ', tone: 'warn' },
  ready: { label: 'พร้อมเสิร์ฟ', tone: 'success' },
  served: { label: 'เสิร์ฟแล้ว', tone: 'neutral' },
  cancelled: { label: 'ยกเลิก', tone: 'danger' },
};

/** Live bill of one table: items by round, totals, and removing/reducing items. */
export function OrderBillPanel({ orderId, onClose }: { orderId: string; onClose?: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const settings = useSettings();
  const approve = useApproval();
  const q = useQuery({ queryKey: ['order', orderId], queryFn: () => api.get<OrderView>(`/api/orders/${orderId}`), refetchInterval: 10_000 });
  const [remove, setRemove] = useState<Item | null>(null);
  const [slip, setSlip] = useState(false);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const prev = useRef<Map<string, number> | null>(null);
  const o = q.data;

  // Highlight lines that changed since the last refresh (added or quantity changed elsewhere).
  useEffect(() => {
    if (!o) return;
    const now = new Map(o.items.filter((i) => i.status !== 'cancelled').map((i) => [i.id, i.qty]));
    if (prev.current) {
      const changed = [...now].filter(([id, qty]) => prev.current!.get(id) !== qty).map(([id]) => id);
      if (changed.length) {
        setFlash(new Set(changed));
        const t = setTimeout(() => setFlash(new Set()), 2500);
        prev.current = now;
        return () => clearTimeout(t);
      }
    }
    prev.current = now;
  }, [o]);
  useEffect(() => {
    prev.current = null;
  }, [orderId]);

  const live = useMemo(() => (o?.items ?? []).filter((i) => i.status !== 'cancelled'), [o]);
  const cancelled = useMemo(() => (o?.items ?? []).filter((i) => i.status === 'cancelled'), [o]);
  const rounds = useMemo(() => {
    const m = new Map<number, Item[]>();
    for (const i of live) m.set(i.round_no, [...(m.get(i.round_no) ?? []), i]);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [live]);
  const pricing = useMemo(
    () =>
      priceCart({
        lines: live.map((i) => ({ id: i.id, productId: i.product_id, name: i.name, qty: i.qty, unitPrice: i.unit_price, taxable: true })),
        config: { ...settings.tax, serviceChargeRate: settings.modules.restaurant ? settings.tax.serviceChargeRate : 0 },
      }),
    [live, settings.tax, settings.modules.restaurant],
  );

  if (q.isLoading) return <div className="grid min-h-[300px] place-items-center"><Spinner /></div>;
  if (q.isError || !o) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const open = o.status === 'open';
  const mins = Math.max(0, Math.round((Date.now() - new Date(o.openedAt).getTime()) / 60000));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-3 border-b border-line-soft px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2 text-[20px] font-semibold">
            {o.tableName ? `โต๊ะ ${o.tableName}` : o.name}
            {o.billRequested && <Badge tone="danger">ขอเช็คบิล</Badge>}
            {!open && <Badge>{o.status === 'paid' ? 'เก็บเงินแล้ว' : 'ยกเลิก'}</Badge>}
          </span>
          <span className="text-[13px] text-muted">
            {o.guests ? `${o.guests} คน · ` : ''}เปิด {new Date(o.openedAt).toTimeString().slice(0, 5)} · {mins} นาที · {o.openedBy}
          </span>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-soft px-2.5 py-1 text-[12px] font-medium text-soft-fg">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          อัปเดตสด
        </span>
        {onClose && (
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-sunken" aria-label="ปิด">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {rounds.length === 0 && <p className="py-10 text-center text-[14px] text-muted">ยังไม่มีรายการในบิลนี้</p>}
        {rounds.map(([round, items]) => (
          <div key={round} className="mb-3 overflow-hidden rounded-xl border border-line">
            <div className="flex items-center justify-between bg-sunken px-3.5 py-2 text-[12px] text-muted">
              <span>
                รอบ {round} · {new Date(items[0]!.created_at).toTimeString().slice(0, 5)} · {items[0]!.by}
                {items[0]!.source === 'app' && ' · จากแอป'}
              </span>
            </div>
            {items.map((i) => (
              <div key={i.id} className={cn('flex items-start gap-3 border-t border-line-soft px-3.5 py-2.5 transition-colors first:border-0', flash.has(i.id) && 'bg-soft')}>
                <span className="num min-w-[30px] pt-px text-[15px] font-semibold">{qtyText(i.qty)}×</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[15px]">{i.name}</span>
                  {(i.modifiers.length > 0 || i.note) && <span className="text-[12px] text-muted">{[...i.modifiers.map((m) => m.name), i.note && `* ${i.note}`].filter(Boolean).join(' · ')}</span>}
                  <span className="mt-1"><Badge tone={STATUS[i.status]?.tone ?? 'neutral'}>{STATUS[i.status]?.label ?? i.status}</Badge></span>
                </span>
                <span className="num pt-px text-[15px] font-medium">{money(i.total)}</span>
                {open && (
                  <Button size="sm" variant="ghost" className="-mr-2 text-danger" aria-label={`ลบ ${i.name}`} title="ลบ/ลดจำนวน" onClick={() => setRemove(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        ))}
        {cancelled.length > 0 && (
          <details className="mb-2 text-[13px] text-muted">
            <summary className="cursor-pointer py-1">รายการที่ยกเลิก ({cancelled.length})</summary>
            {cancelled.map((i) => (
              <div key={i.id} className="flex justify-between py-1 line-through">
                <span>{qtyText(i.qty)}× {i.name}</span>
                <span className="num">{money(i.total)}</span>
              </div>
            ))}
          </details>
        )}
      </div>

      <div className="num flex flex-col gap-1.5 border-t border-line-soft px-5 pb-5 pt-4">
        <Row label={`ยอดรวม (${qtyText(live.reduce((a, i) => a + i.qty, 0))} รายการ)`} value={money(pricing.subtotal)} />
        {pricing.serviceCharge > 0 && <Row label={`ค่าบริการ ${settings.tax.serviceChargeRate}%`} value={money(pricing.serviceCharge)} />}
        {settings.tax.vatEnabled && <Row label={`VAT ${settings.tax.vatRate}%${settings.tax.pricesIncludeVat ? ' (รวมในราคา)' : ''}`} value={money(pricing.vat)} />}
        <div className="mt-1 flex items-baseline justify-between">
          <span className="font-semibold">ยอดชำระ</span>
          <span className="text-[26px] font-bold">{money(pricing.total)}</span>
        </div>
        <p className="text-[12px] text-muted">ส่วนลดสมาชิกและโปรโมชั่นจะคำนวณตอนเก็บเงิน</p>
        {open && live.length > 0 && (
          <Button className="mt-2" icon={<QrCode className="h-4 w-4" />} onClick={() => setSlip(true)}>
            ใบแจ้งยอด + QR PromptPay (ระบุยอด)
          </Button>
        )}
        {open && (
          <div className="mt-2 flex gap-2">
            {rounds.length > 0 && (
              <Button icon={<Printer className="h-4 w-4" />} onClick={() => api.post(`/api/orders/${o.id}/reprint`, { round: rounds[rounds.length - 1]![0] }).then(() => toast.success('ส่งพิมพ์ใบออเดอร์รอบล่าสุดแล้ว')).catch((e) => toast.error(errorMessage(e)))}>
                พิมพ์ซ้ำ
              </Button>
            )}
            <Button variant="primary" size="lg" className="flex-1" disabled={!live.length} onClick={() => nav(`/pos?order=${o.id}`)}>
              เก็บเงิน {money(pricing.total)}
            </Button>
          </div>
        )}
      </div>

      {slip && <BillSlipDialog orderId={o.id} onClose={() => setSlip(false)} />}
      {remove && (
        <RemoveDialog
          item={remove}
          onClose={() => setRemove(null)}
          onConfirm={async (qty, reason) => {
            const cooking = ['preparing', 'ready', 'served'].includes(remove.status);
            const pin = cooking ? await approve('pos.void', `ลบ ${remove.name} ที่ครัวทำแล้ว`) : '';
            if (pin === null) return;
            try {
              const next = await api.post<OrderView>(`/api/orders/${o.id}/items/${remove.id}/qty`, { qty, reason, managerPin: pin || undefined });
              qc.setQueryData(['order', o.id], next);
              qc.invalidateQueries({ queryKey: ['orders'] });
              qc.invalidateQueries({ queryKey: ['floor'] });
              toast.success(qty === 0 ? `ลบ ${remove.name} ออกจากบิลแล้ว` : `ลด ${remove.name} เหลือ ${qtyText(qty)} แล้ว`);
              setRemove(null);
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[14px] text-muted">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

const REASONS = ['ลูกค้าเปลี่ยนใจ', 'สั่งผิด', 'ของหมด', 'รอนานเกินไป'];

function RemoveDialog({ item, onClose, onConfirm }: { item: Item; onClose: () => void; onConfirm: (qty: number, reason: string) => Promise<void> }) {
  const [removeQty, setRemoveQty] = useState(item.qty);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const whole = Number.isInteger(item.qty);
  const cooking = ['preparing', 'ready', 'served'].includes(item.status);
  const left = Math.round((item.qty - removeQty) * 1000) / 1000;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`ลบ “${item.name}” ออกจากบิล`}
      description={cooking ? 'รายการนี้ครัวเริ่มทำแล้ว ต้องใช้ PIN ผู้จัดการ' : 'ครัวจะเห็นว่ารายการนี้ถูกยกเลิก'}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim() || removeQty <= 0} onClick={async () => { setBusy(true); await onConfirm(left, reason.trim()); setBusy(false); }}>
            {left === 0 ? 'ลบทั้งรายการ' : `ลบ ${qtyText(removeQty)} ชิ้น`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {whole && item.qty > 1 && (
          <Field label={`จำนวนที่จะลบ (มี ${qtyText(item.qty)})`}>
            <div className="flex items-center gap-2">
              <Button aria-label="ลดจำนวนที่ลบ" disabled={removeQty <= 1} onClick={() => setRemoveQty(removeQty - 1)}><Minus className="h-4 w-4" /></Button>
              <span className="num w-12 text-center text-[20px] font-semibold">{removeQty}</span>
              <Button aria-label="เพิ่มจำนวนที่ลบ" disabled={removeQty >= item.qty} onClick={() => setRemoveQty(removeQty + 1)}>+</Button>
              <span className="text-[13px] text-muted">เหลือในบิล {qtyText(left)}</span>
            </div>
          </Field>
        )}
        <Field label="เหตุผล" required>
          <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ระบุเหตุผล" />
        </Field>
        <div className="flex flex-wrap gap-2">
          {REASONS.map((r) => (
            <button key={r} onClick={() => setReason(r)} className={cn('h-9 rounded-full border px-3 text-[13px]', reason === r ? 'border-primary bg-soft text-soft-fg' : 'border-line-strong')}>
              {r}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
