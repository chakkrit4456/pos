import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, ShoppingBag, Timer } from 'lucide-react';
import { api, errorMessage, registerName } from '@/lib/api';
import { money, useSettings } from '@/lib/settings';
import { cn, qtyText, uuid } from '@/lib/utils';
import { Button, EmptyState, Segmented, Spinner, Checkbox } from '@/components/ui/core';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { MoneyInput } from '@/components/ui/inputs';
import { cart, useCart, type CartState } from './cart';
import { orderToCart, type OrderDetail } from './PosPage';

export interface FloorData {
  zones: { id: string; name: string }[];
  tables: { id: string; name: string; zoneId: string | null; seats: number; order: { id: string; total: number; items: number; openedAt: string; billRequested: boolean; readyCount: number; waitingCount: number; guests: number } | null }[];
  takeaway: { id: string; name: string; total: number; items: number; openedAt: string }[];
}

interface Held {
  id: string;
  name: string;
  userName: string;
  createdAt: string;
  data: CartState;
}

const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));

/** Choose which bill to work on: a table, a takeaway order, or a held bill. */
export function BillPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useSettings();
  const state = useCart();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const restaurant = settings.modules.restaurant;
  const [tab, setTab] = useState<'tables' | 'held'>(restaurant ? 'tables' : 'held');
  const [zone, setZone] = useState<string | 'all'>('all');
  const [merge, setMerge] = useState(false);
  const floor = useQuery({ queryKey: ['floor'], queryFn: () => api.get<FloorData>('/api/floor'), enabled: open && restaurant });
  const held = useQuery({ queryKey: ['held'], queryFn: () => api.get<Held[]>('/api/held'), enabled: open });
  useEffect(() => {
    if (open) {
      setTab(restaurant ? 'tables' : 'held');
      setMerge(false);
    }
  }, [open, restaurant]);

  const openOrder = async (orderId: string | null, tableId: string | null) => {
    try {
      if (merge && state.order) {
        if (!orderId) return;
        const r = await confirm({ title: 'รวมบิล?', body: 'รายการของบิลที่เลือกจะย้ายมารวมกับบิลนี้', confirmText: 'รวมบิล' });
        if (!r.ok) return;
        const o = await api.post<OrderDetail>(`/api/orders/${state.order.id}/merge`, { fromId: orderId });
        cart.patch({ order: orderToCart(o) });
        toast.success('รวมบิลแล้ว');
        onClose();
        return;
      }
      const o = orderId ? await api.get<OrderDetail>(`/api/orders/${orderId}`) : await api.post<OrderDetail>('/api/orders', { tableId });
      const cur = cart.get();
      // Keep counter lines when moving them onto a table bill.
      cart.replace({ order: orderToCart(o), lines: cur.order ? [] : cur.lines, customer: cur.customer });
      qc.invalidateQueries({ queryKey: ['floor'] });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const newTakeaway = async () => {
    try {
      const o = await api.post<OrderDetail>('/api/orders', { tableId: null });
      const cur = cart.get();
      cart.replace({ order: orderToCart(o), lines: cur.order ? [] : cur.lines, customer: cur.customer });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const recall = async (h: Held) => {
    const cur = cart.get();
    if (cur.lines.length && !cur.order) {
      const r = await confirm({ title: 'มีรายการค้างในตะกร้า', body: 'ต้องการรวมรายการปัจจุบันเข้ากับบิลที่เรียกคืนหรือไม่? (ยกเลิก = ไม่เรียกคืน)', confirmText: 'รวมรายการ' });
      if (!r.ok) return;
      cart.replace({ ...h.data, heldId: h.id, heldName: h.name, lines: [...h.data.lines, ...cur.lines], managerPin: null });
    } else cart.replace({ ...h.data, heldId: h.id, heldName: h.name, managerPin: null });
    onClose();
  };

  const tables = (floor.data?.tables ?? []).filter((t) => zone === 'all' || t.zoneId === zone);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={merge ? 'เลือกบิลที่จะรวม' : 'เลือกบิล'}
      description={merge ? `รายการจะย้ายมารวมกับ${state.order?.name}` : 'รายการที่เลือกไว้จะไปรวมกับบิลเดิมของโต๊ะ'}
      size="lg"
      footer={
        <>
          {state.order && restaurant && (
            <Button className="mr-auto" variant={merge ? 'primary' : 'secondary'} onClick={() => setMerge(!merge)}>
              {merge ? 'ยกเลิกการรวม' : 'รวมโต๊ะเข้าบิลนี้'}
            </Button>
          )}
          {(state.order || state.heldId) && !merge && (
            <Button onClick={() => (cart.clear(), onClose())} icon={<Plus className="h-4 w-4" />}>
              บิลใหม่ (หน้าร้าน)
            </Button>
          )}
          {restaurant && !merge && (
            <Button variant="primary" onClick={() => void newTakeaway()} icon={<ShoppingBag className="h-4 w-4" />}>
              กลับบ้าน / ไม่ระบุโต๊ะ
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-3">
        {restaurant && !merge && (
          <Segmented value={tab} onChange={setTab} options={[{ value: 'tables', label: 'โต๊ะ' }, { value: 'held', label: `บิลที่พักไว้${held.data?.length ? ` (${held.data.length})` : ''}` }]} />
        )}
        {tab === 'tables' && restaurant ? (
          floor.isLoading ? (
            <Spinner className="mx-auto my-10" />
          ) : (
            <>
              {(floor.data?.zones.length ?? 0) > 1 && (
                <div className="flex flex-wrap gap-2">
                  {[{ id: 'all', name: 'ทั้งหมด' }, ...floor.data!.zones].map((z) => (
                    <button key={z.id} onClick={() => setZone(z.id)} className={cn('h-10 rounded-full border px-3.5 text-[14px] font-medium', zone === z.id ? 'border-ink bg-ink text-surface' : 'border-line-strong')}>
                      {z.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                {tables.map((t) => {
                  const current = state.order?.tableId === t.id;
                  const busy = !!t.order;
                  return (
                    <button
                      key={t.id}
                      disabled={(merge && (!busy || current)) || false}
                      onClick={() => void openOrder(t.order?.id ?? null, t.id)}
                      className={cn(
                        'flex h-[88px] flex-col items-start justify-between rounded-[14px] border px-3 py-2.5 text-left transition-colors disabled:opacity-35',
                        current ? 'border-2 border-primary bg-soft' : busy ? 'border-[#c9b98f] bg-[#fbf3df]' : 'border-line bg-surface hover:bg-sunken',
                      )}
                    >
                      <span className="text-[17px] font-semibold">{t.name}</span>
                      <span className={cn('num text-[12px]', busy ? 'text-warn' : 'text-muted')}>
                        {t.order ? `${money(t.order.total)} · ${minutesSince(t.order.openedAt)} นาที${t.order.billRequested ? ' · เช็คบิล' : ''}` : 'ว่าง'}
                      </span>
                    </button>
                  );
                })}
              </div>
              {(floor.data?.takeaway.length ?? 0) > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-[13px] font-semibold text-muted">กลับบ้าน / ไม่ระบุโต๊ะ</span>
                  {floor.data!.takeaway.map((o) => (
                    <button key={o.id} disabled={merge && state.order?.id === o.id} onClick={() => void openOrder(o.id, null)} className="flex items-center justify-between rounded-xl border border-line px-4 py-3 text-left hover:bg-sunken disabled:opacity-40">
                      <span className="font-medium">{o.name}</span>
                      <span className="num text-[14px] text-muted">
                        {qtyText(o.items)} รายการ · {money(o.total)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {tables.length === 0 && <EmptyState title="ยังไม่มีโต๊ะ" body="เพิ่มโต๊ะได้ที่ ตั้งค่า → โต๊ะและโซน" />}
            </>
          )
        ) : held.isLoading ? (
          <Spinner className="mx-auto my-10" />
        ) : held.data?.length ? (
          <div className="flex flex-col">
            {held.data.map((h) => (
              <div key={h.id} className="flex items-center gap-3 border-b border-line-soft py-3">
                <button className="flex flex-1 flex-col text-left" onClick={() => void recall(h)}>
                  <span className="font-medium">{h.name}</span>
                  <span className="text-[13px] text-muted">
                    {h.userName} · {new Date(h.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} · {qtyText(h.data.lines?.reduce((a, l) => a + l.qty, 0) ?? 0)} รายการ
                  </span>
                </button>
                <Button size="sm" onClick={() => void recall(h)}>
                  เรียกคืน
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  onClick={async () => {
                    const r = await confirm({ title: 'ลบบิลที่พักไว้?', body: h.name, danger: true, confirmText: 'ลบ' });
                    if (!r.ok) return;
                    await api.del(`/api/held/${h.id}`);
                    qc.invalidateQueries({ queryKey: ['held'] });
                  }}
                >
                  ลบ
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="ไม่มีบิลที่พักไว้" body="กด “พักบิล” เพื่อเก็บรายการไว้ก่อน แล้วเรียกคืนได้ที่นี่" />
        )}
      </div>
    </Dialog>
  );
}

/** Move selected items to a separate bill. */
export function SplitDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useCart();
  const qc = useQueryClient();
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setPick(new Set());
  }, [open]);
  const sent = state.order?.items ?? [];
  const toggle = (id: string) => setPick((p) => (p.has(id) ? (p.delete(id), new Set(p)) : new Set(p.add(id))));
  const total = sent.filter((i) => pick.has('s' + i.id)).reduce((a, i) => a + i.qty * i.unitPrice, 0) + state.lines.filter((l) => pick.has(l.id)).reduce((a, l) => a + l.qty * l.unitPrice, 0);

  const apply = async () => {
    setBusy(true);
    try {
      const sentIds = sent.filter((i) => pick.has('s' + i.id)).map((i) => i.id);
      const moveLines = state.lines.filter((l) => pick.has(l.id));
      if (sentIds.length && state.order) {
        const o = await api.post<OrderDetail>(`/api/orders/${state.order.id}/split`, { itemIds: sentIds });
        const rest = await api.get<OrderDetail>(`/api/orders/${state.order.id}`);
        // Continue with the new split bill (and carry selected counter lines into it).
        cart.replace({ order: orderToCart(o), lines: moveLines, customer: state.customer });
        if (state.lines.length - moveLines.length > 0) {
          await api.post('/api/held', { id: uuid(), name: `${rest.tableName ? 'โต๊ะ ' + rest.tableName : rest.name} (รายการเคาน์เตอร์)`, data: { lines: state.lines.filter((l) => !pick.has(l.id)) } });
        }
        qc.invalidateQueries({ queryKey: ['floor'] });
        toast.success('แยกบิลแล้ว กำลังเก็บเงินบิลที่แยก');
      } else {
        // Counter bill: keep the rest as a held bill and pay the selected part now.
        const rest = state.lines.filter((l) => !pick.has(l.id));
        await api.post('/api/held', { id: uuid(), name: `${state.heldName || 'บิล'} (ส่วนที่เหลือ)`, data: { ...state, lines: rest, saleId: uuid(), managerPin: null } });
        cart.patch({ lines: moveLines, saleId: uuid(), heldId: null });
        qc.invalidateQueries({ queryKey: ['held'] });
        toast.success('แยกบิลแล้ว ส่วนที่เหลือถูกพักไว้');
      }
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const allCount = sent.length + state.lines.length;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="แยกบิล"
      description="เลือกรายการที่จะชำระแยก ส่วนที่เหลือจะยังอยู่ในบิลเดิม"
      size="md"
      footer={
        <>
          <span className="num mr-auto text-[15px] font-semibold">บิลที่แยก {money(Math.round(total))}</span>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={busy} disabled={pick.size === 0 || pick.size === allCount} onClick={() => void apply()}>
            แยกบิล
          </Button>
        </>
      }
    >
      <div className="flex flex-col pb-3">
        {sent.map((i) => (
          <div key={i.id} className="border-b border-line-soft py-1">
            <Checkbox checked={pick.has('s' + i.id)} onChange={() => toggle('s' + i.id)} label={<span className="flex flex-1 justify-between gap-3"><span>{qtyText(i.qty)}× {i.name} <span className="text-[12px] text-muted">รอบ {i.round}</span></span><span className="num">{money(Math.round(i.qty * i.unitPrice))}</span></span>} />
          </div>
        ))}
        {state.lines.map((l) => (
          <div key={l.id} className="border-b border-line-soft py-1">
            <Checkbox checked={pick.has(l.id)} onChange={() => toggle(l.id)} label={<span className="flex flex-1 justify-between gap-3"><span>{qtyText(l.qty)}× {l.name}</span><span className="num">{money(Math.round(l.qty * l.unitPrice))}</span></span>} />
          </div>
        ))}
        {pick.size === allCount && allCount > 0 && <p className="pt-2 text-[13px] text-warn">เลือกทุกรายการแล้ว ไม่ต้องแยกบิล ให้ชำระตามปกติ</p>}
      </div>
    </Dialog>
  );
}

/** Blocking card shown on the POS until a shift is opened (when shifts are required). */
export function OpenShiftGate({ onOpened }: { onOpened: () => void }) {
  const [cash, setCash] = useState(0);
  const [busy, setBusy] = useState(false);
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-canvas/85 px-4 backdrop-blur-[2px]">
      <form
        className="card flex w-full max-w-[420px] flex-col gap-4 p-6 shadow-pop"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.post('/api/shifts/open', { openingCash: cash, register: registerName() });
            toast.success('เปิดกะแล้ว พร้อมขาย');
            onOpened();
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-soft text-primary">
          <Timer className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-[20px] font-semibold">เปิดกะก่อนเริ่มขาย</h2>
          <p className="mt-1 text-[14px] text-muted">นับเงินทอนในลิ้นชักแล้วกรอกยอดเริ่มต้น · เครื่อง {registerName()}</p>
        </div>
        <MoneyInput autoFocus value={cash} onValue={setCash} className="h-14 text-[22px] font-semibold" aria-label="เงินทอนเริ่มต้น" />
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          เปิดกะ
        </Button>
      </form>
    </div>
  );
}
