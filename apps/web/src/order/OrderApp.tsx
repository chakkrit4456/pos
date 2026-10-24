import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, ChevronLeft, ClipboardList, LayoutGrid, Minus, MoreHorizontal, Plus, Search, UserRound, X } from 'lucide-react';
import { effectiveBillDiscount, initials, priceCart, resolveBasePrice, type CatalogProduct } from '@flexpos/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useCatalog } from '@/lib/catalog';
import { useLive, useLiveInvalidation, useLiveStatus } from '@/lib/live';
import { useSession } from '@/lib/session';
import { money, useSettings, useTheme } from '@/lib/settings';
import { cn, qtyText, uuid } from '@/lib/utils';
import { PinPad } from '@/components/ui/inputs';
import { QrImage } from '@/components/PrintDocView';
import { useConfirm } from '@/components/ui/dialog';
import type { FloorData } from '@/pages/pos/BillPicker';
import type { OrderDetail } from '@/pages/pos/PosPage';

interface Line {
  key: string;
  productId: string;
  variantId: string | null;
  name: string;
  qty: number;
  unitPrice: number;
  modifiers: { id: string; name: string; priceDelta: number }[];
  note: string;
}

interface Pending {
  requestId: string;
  orderId: string;
  title: string;
  items: Line[];
  at: string;
  error?: string;
}

type Screen =
  | { s: 'tables' }
  | { s: 'table'; orderId: string }
  | { s: 'menu'; orderId: string }
  | { s: 'review'; orderId: string }
  | { s: 'sent'; orderId: string; title: string; printed: number; queued: boolean }
  | { s: 'bill'; orderId: string }
  | { s: 'orders' }
  | { s: 'notifications' }
  | { s: 'me' };

const PENDING_KEY = 'flexpos.order.pending';
const loadPending = (): Pending[] => {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') as Pending[];
  } catch {
    return [];
  }
};
const savePending = (p: Pending[]) => {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
};

const mins = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);

export default function OrderApp() {
  const { user, loginPin } = useSession();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const onPin = useCallback(
    async (pin: string) => {
      setBusy(true);
      setError(undefined);
      try {
        await loginPin(pin);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [loginPin],
  );
  useEffect(() => {
    const link = document.querySelector('link[rel=manifest]');
    link?.setAttribute('href', '/order.webmanifest');
    document.title = 'FlexPOS Order';
  }, []);
  if (!user) {
    return (
      <div className="mx-auto flex min-h-full max-w-[480px] flex-col gap-5 bg-rail px-6 pb-5 pt-7 text-white">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-[10px] bg-accent font-bold">F</div>
          <span className="font-semibold">FlexPOS Order</span>
        </div>
        <div className="mt-2 flex flex-col items-center gap-3.5">
          <span className="text-[20px] font-semibold">ใส่ PIN พนักงาน</span>
        </div>
        <div className="mt-auto">
          <PinPad dark onComplete={onPin} error={error} busy={busy} />
        </div>
      </div>
    );
  }
  return <Shell />;
}

function Shell() {
  const settings = useSettings();
  useTheme(settings);
  useLiveInvalidation();
  const [screen, setScreen] = useState<Screen>({ s: 'tables' });
  const [lines, setLines] = useState<Record<string, Line[]>>({});
  const [pending, setPending] = useState<Pending[]>(loadPending);
  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<{ id: string; read_at: string | null }[]>('/api/notifications'), refetchInterval: 60_000 });
  const unread = notes.data?.filter((n) => !n.read_at).length ?? 0;
  useLive((e) => {
    if (e.type === 'notification') {
      toast(e.title, { description: e.body });
      try {
        navigator.vibrate?.(200);
      } catch {
        /* unsupported */
      }
    }
  });
  useEffect(() => savePending(pending), [pending]);

  // Retry queued rounds (sent while offline). Server dedupes by requestId.
  const flush = useCallback(async () => {
    const list = loadPending();
    for (const p of list) {
      try {
        await api.post(`/api/orders/${p.orderId}/items`, { requestId: p.requestId, source: 'app', items: p.items.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty, modifiers: l.modifiers, note: l.note })) });
        setPending((cur) => cur.filter((x) => x.requestId !== p.requestId));
        toast.success(`ส่ง ${p.title} ที่ค้างไว้แล้ว`);
      } catch (e) {
        if (!(e instanceof ApiError && e.isNetwork)) setPending((cur) => cur.map((x) => (x.requestId === p.requestId ? { ...x, error: errorMessage(e) } : x)));
        break;
      }
    }
  }, []);
  useEffect(() => {
    const t = setInterval(() => void flush(), 15_000);
    return () => clearInterval(t);
  }, [flush]);

  const tab = screen.s === 'orders' ? 'orders' : screen.s === 'notifications' ? 'notifications' : screen.s === 'me' ? 'me' : 'tables';
  const showTabs = ['tables', 'orders', 'notifications', 'me'].includes(screen.s);
  return (
    <div className="mx-auto flex h-full max-w-[560px] flex-col bg-canvas">
      <div className="flex min-h-0 flex-1 flex-col">
        {screen.s === 'tables' && <Tables go={setScreen} />}
        {screen.s === 'table' && <TableDetail orderId={screen.orderId} go={setScreen} />}
        {screen.s === 'menu' && <Menu orderId={screen.orderId} lines={lines[screen.orderId] ?? []} setLines={(l) => setLines({ ...lines, [screen.orderId]: l })} go={setScreen} />}
        {screen.s === 'review' && (
          <Review
            orderId={screen.orderId}
            lines={lines[screen.orderId] ?? []}
            setLines={(l) => setLines({ ...lines, [screen.orderId]: l })}
            go={setScreen}
            queue={(p) => setPending((cur) => [...cur, p])}
          />
        )}
        {screen.s === 'sent' && <Sent {...screen} go={setScreen} />}
        {screen.s === 'bill' && <CheckBill orderId={screen.orderId} go={setScreen} />}
        {screen.s === 'orders' && <MyOrders pending={pending} retry={() => void flush()} discard={(id) => setPending((c) => c.filter((x) => x.requestId !== id))} />}
        {screen.s === 'notifications' && <Notifications go={setScreen} />}
        {screen.s === 'me' && <Me />}
      </div>
      {showTabs && (
        <nav className="flex flex-none border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]" aria-label="แท็บ">
          {[
            { id: 'tables', label: 'โต๊ะ', icon: <LayoutGrid className="h-5 w-5" />, go: { s: 'tables' } as Screen },
            { id: 'orders', label: 'ออเดอร์', icon: <ClipboardList className="h-5 w-5" />, go: { s: 'orders' } as Screen, badge: pending.length },
            { id: 'notifications', label: 'แจ้งเตือน', icon: <Bell className="h-5 w-5" />, go: { s: 'notifications' } as Screen, badge: unread },
            { id: 'me', label: 'ฉัน', icon: <UserRound className="h-5 w-5" />, go: { s: 'me' } as Screen },
          ].map((t) => (
            <button key={t.id} onClick={() => setScreen(t.go)} className={cn('relative flex h-[60px] flex-1 flex-col items-center justify-center gap-0.5 text-[12px]', tab === t.id ? 'font-semibold text-primary' : 'text-muted')}>
              {t.icon}
              {t.label}
              {!!t.badge && <span className="absolute right-[calc(50%-22px)] top-2 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[11px] font-semibold text-white">{t.badge}</span>}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

function Header({ title, sub, back, right }: { title: string; sub?: string; back?: () => void; right?: React.ReactNode }) {
  return (
    <div className="flex flex-none items-center gap-2.5 border-b border-line bg-surface px-4 py-3.5">
      {back && (
        <button onClick={back} className="grid h-10 w-10 place-items-center rounded-xl bg-canvas" aria-label="ย้อนกลับ">
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[17px] font-semibold">{title}</span>
        {sub && <span className="truncate text-[12px] text-muted">{sub}</span>}
      </div>
      {right}
    </div>
  );
}

function SyncPill() {
  const online = useLiveStatus();
  return (
    <span className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium', online ? 'bg-soft text-soft-fg' : 'bg-danger-soft text-danger')}>
      <span className={cn('h-[7px] w-[7px] rounded-full', online ? 'bg-accent' : 'bg-danger')} />
      {online ? 'ซิงก์แล้ว' : 'ออฟไลน์'}
    </span>
  );
}

function Tables({ go }: { go: (s: Screen) => void }) {
  const { user } = useSession();
  const [zone, setZone] = useState('all');
  const floor = useQuery({ queryKey: ['floor'], queryFn: () => api.get<FloorData>('/api/floor'), refetchInterval: 30_000 });
  const shift = useQuery({ queryKey: ['shift', 'current'], queryFn: () => api.get<{ number: number } | null>('/api/shifts/current').catch(() => null) });
  const open = async (tableId: string, orderId?: string) => {
    try {
      const id = orderId ?? (await api.post<{ id: string }>('/api/orders', { tableId })).id;
      go(orderId ? { s: 'table', orderId: id } : { s: 'menu', orderId: id });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const tables = (floor.data?.tables ?? []).filter((t) => zone === 'all' || t.zoneId === zone);
  return (
    <>
      <div className="flex flex-none items-center justify-between border-b border-line bg-surface px-5 pb-3 pt-4">
        <div className="flex flex-col">
          <span className="text-[20px] font-semibold">โต๊ะ</span>
          <span className="text-[13px] text-muted">{user?.name}{shift.data ? ` · กะ #${shift.data.number}` : ''}</span>
        </div>
        <SyncPill />
      </div>
      <div className="flex flex-none gap-1.5 overflow-x-auto px-5 py-3">
        {[{ id: 'all', name: 'ทั้งหมด' }, ...(floor.data?.zones ?? [])].map((z) => (
          <button key={z.id} onClick={() => setZone(z.id)} className={cn('h-10 flex-none whitespace-nowrap rounded-full border px-3.5 text-[14px] font-medium', zone === z.id ? 'border-ink bg-ink text-surface' : 'border-line-strong bg-surface')}>{z.name}</button>
        ))}
      </div>
      <div className="scroll-thin grid flex-1 auto-rows-min grid-cols-3 gap-2.5 overflow-y-auto px-5 pb-3">
        {floor.isLoading && Array.from({ length: 9 }, (_, i) => <div key={i} className="skeleton h-24 rounded-[14px]" />)}
        {tables.map((t) => {
          const o = t.order;
          const status = !o ? 'ว่าง' : o.billRequested ? 'เช็คบิล' : o.readyCount ? `พร้อมเสิร์ฟ ${o.readyCount}` : o.waitingCount ? `รออาหาร ${o.waitingCount}` : 'กำลังทาน';
          return (
            <button key={t.id} onClick={() => void open(t.id, o?.id)} className={cn('flex h-24 flex-col items-start justify-between rounded-[14px] border px-3 py-2.5 text-left', !o ? 'border-line bg-surface' : o.billRequested ? 'border-danger/40 bg-danger-soft' : o.readyCount ? 'border-primary/50 bg-soft' : 'border-[#c9b98f] bg-[#fbf3df] dark:bg-warn-soft')}>
              <span className="text-[20px] font-semibold">{t.name}</span>
              <span className="flex flex-col gap-px">
                <span className={cn('text-[12px] font-semibold', !o ? 'text-muted' : o.billRequested ? 'text-danger' : o.readyCount ? 'text-soft-fg' : 'text-warn')}>{status}</span>
                {o && <span className="num text-[12px] text-muted">{money(o.total)} · {mins(o.openedAt)}น.</span>}
              </span>
            </button>
          );
        })}
        {floor.data && !floor.data.tables.length && <p className="col-span-3 py-10 text-center text-[14px] text-muted">ยังไม่มีโต๊ะ ให้ผู้ดูแลเพิ่มที่ ตั้งค่า → โต๊ะและโซน</p>}
      </div>
    </>
  );
}

function useOrder(orderId: string) {
  return useQuery({ queryKey: ['order', orderId], queryFn: () => api.get<OrderDetail & { guests: number; openedAt: string; total: number; billRequested: boolean }>(`/api/orders/${orderId}`) });
}

function TableDetail({ orderId, go }: { orderId: string; go: (s: Screen) => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const o = useOrder(orderId);
  const [menu, setMenu] = useState(false);
  const [pick, setPick] = useState<'move' | 'merge' | null>(null);
  const floor = useQuery({ queryKey: ['floor'], queryFn: () => api.get<FloorData>('/api/floor'), enabled: !!pick });
  const d = o.data;
  const rounds = useMemo(() => {
    const m = new Map<number, NonNullable<typeof d>['items']>();
    for (const i of d?.items ?? []) if (i.status !== 'cancelled') m.set(i.round_no, [...(m.get(i.round_no) ?? []), i]);
    return [...m.entries()];
  }, [d]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['order', orderId] });
    qc.invalidateQueries({ queryKey: ['floor'] });
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  if (!d) return <Header title="กำลังโหลด…" back={() => go({ s: 'tables' })} />;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Header
        title={d.tableName ? `โต๊ะ ${d.tableName}` : d.name}
        sub={`${d.guests ? `${d.guests} คน · ` : ''}เปิด ${hhmm(d.openedAt)} · ${mins(d.openedAt)} นาที`}
        back={() => go({ s: 'tables' })}
        right={<button onClick={() => setMenu(true)} className="grid h-11 w-11 place-items-center rounded-xl border border-line-strong bg-surface" aria-label="เมนูเพิ่มเติม"><MoreHorizontal className="h-5 w-5" /></button>}
      />
      <div className="scroll-thin flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3">
        {rounds.map(([round, items]) => (
          <div key={round} className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-3.5">
            <div className="flex items-center justify-between text-[13px] text-muted">
              <span>รอบ {round} · {hhmm(items[0]!.created_at)} · {items[0]!.by}</span>
              <span className="text-[12px]">{items.every((i) => i.status === 'ready' || i.status === 'served') ? 'พร้อมเสิร์ฟ' : 'ส่งครัวแล้ว'}</span>
            </div>
            {items.map((i) => (
              <div key={i.id} className="flex items-baseline gap-2.5 text-[15px]">
                <span className="min-w-[26px] font-semibold">{qtyText(i.qty)}×</span>
                <span className="flex flex-1 flex-col"><span>{i.name}</span>{(i.modifiers.length > 0 || i.note) && <span className="text-[12px] text-muted">{[...i.modifiers.map((m) => m.name), i.note].filter(Boolean).join(' · ')}</span>}</span>
                <span className="num">{money(Math.round(i.qty * i.unit_price))}</span>
                <button
                  className="text-faint"
                  aria-label={`ยกเลิก ${i.name}`}
                  onClick={async () => {
                    const r = await confirm({ title: `ยกเลิก ${i.name}?`, body: i.status === 'sent' ? undefined : 'รายการนี้ครัวเริ่มทำแล้ว ต้องให้หัวหน้ากะใส่ PIN ที่ POS', danger: true, confirmText: 'ยกเลิกรายการ', reason: { label: 'เหตุผล' } });
                    if (r.ok) await act(() => api.post(`/api/orders/${orderId}/items/${i.id}/cancel`, { reason: r.reason }), 'ยกเลิกรายการแล้ว');
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ))}
        {!rounds.length && <p className="py-8 text-center text-[14px] text-muted">ยังไม่มีรายการ กด “สั่งเพิ่ม” เพื่อเลือกเมนู</p>}
        <div className="flex items-baseline justify-between px-1 pt-1"><span className="text-[14px] text-muted">ยอดสะสมของโต๊ะ</span><span className="num text-[22px] font-bold">{money(d.total)}</span></div>
        <span className="px-1 text-[12px] text-muted">รวมรายการที่สั่งจากแอปและเคาน์เตอร์ไว้ในบิลเดียว เก็บเงินครั้งเดียวที่ POS</span>
      </div>
      <div className="flex flex-none gap-2 border-t border-line bg-surface px-4 pb-4 pt-3">
        <button onClick={() => go({ s: 'bill', orderId })} disabled={!rounds.length} className="h-14 flex-1 whitespace-nowrap rounded-[14px] border border-line-strong bg-surface text-[15px] font-semibold disabled:opacity-40">ขอเช็คบิล</button>
        <button onClick={() => go({ s: 'menu', orderId })} className="h-14 flex-[1.4] whitespace-nowrap rounded-[14px] bg-primary text-[15px] font-semibold text-primary-fg">+ สั่งเพิ่ม</button>
      </div>
      {menu && (
        <div className="absolute inset-0 z-10 bg-[rgb(23_25_28/0.35)]" onClick={() => setMenu(false)}>
          <div className="absolute right-4 top-[62px] flex w-[230px] flex-col rounded-[14px] bg-surface p-1.5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <MenuItem onClick={() => (setMenu(false), setPick('move'))}>ย้ายโต๊ะ</MenuItem>
            <MenuItem onClick={() => (setMenu(false), setPick('merge'))}>รวมโต๊ะ</MenuItem>
            <MenuItem
              onClick={async () => {
                setMenu(false);
                const r = await confirm({ title: 'จำนวนลูกค้า', confirmText: 'บันทึก', reason: { label: 'จำนวนคน', placeholder: String(d.guests || 2) } });
                if (r.ok && /^\d+$/.test(r.reason)) await act(() => api.post(`/api/orders/${orderId}/guests`, { guests: Number(r.reason) }), 'บันทึกแล้ว');
              }}
            >
              แก้จำนวนลูกค้า
            </MenuItem>
            <MenuItem danger onClick={async () => { setMenu(false); const r = await confirm({ title: 'ยกเลิกบิลโต๊ะนี้?', body: 'ต้องให้หัวหน้ากะอนุมัติที่ POS ถ้ามีรายการแล้ว', danger: true, confirmText: 'ยกเลิกบิล', reason: { label: 'เหตุผล' } }); if (r.ok) { await act(() => api.post(`/api/orders/${orderId}/cancel`, { reason: r.reason }), 'ยกเลิกบิลแล้ว'); go({ s: 'tables' }); } }}>ขอยกเลิกบิล (ต้องมีหัวหน้ากะ)</MenuItem>
          </div>
        </div>
      )}
      {pick && (
        <div className="absolute inset-0 z-10 flex flex-col bg-canvas">
          <Header title={pick === 'move' ? 'ย้ายไปโต๊ะ' : 'รวมโต๊ะเข้าบิลนี้'} back={() => setPick(null)} />
          <div className="grid auto-rows-min grid-cols-3 gap-2.5 overflow-y-auto p-4">
            {floor.data?.tables.filter((t) => t.id !== d.tableId && (pick === 'move' ? !t.order : !!t.order)).map((t) => (
              <button key={t.id} onClick={async () => { setPick(null); await act(() => (pick === 'move' ? api.post(`/api/orders/${orderId}/move`, { tableId: t.id }) : api.post(`/api/orders/${orderId}/merge`, { fromId: t.order!.id })), pick === 'move' ? `ย้ายไปโต๊ะ ${t.name} แล้ว` : `รวมโต๊ะ ${t.name} แล้ว`); }} className="flex h-20 flex-col items-start justify-between rounded-[14px] border border-line bg-surface px-3 py-2 text-left">
                <span className="text-[18px] font-semibold">{t.name}</span>
                <span className="text-[12px] text-muted">{t.order ? money(t.order.total) : 'ว่าง'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return <button onClick={onClick} className={cn('flex h-12 items-center rounded-lg px-3 text-left text-[15px] hover:bg-sunken', danger && 'border-t border-line-soft text-danger')}>{children}</button>;
}

function Menu({ orderId, lines, setLines, go }: { orderId: string; lines: Line[]; setLines: (l: Line[]) => void; go: (s: Screen) => void }) {
  const { index } = useCatalog();
  const o = useOrder(orderId);
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [opt, setOpt] = useState<CatalogProduct | null>(null);
  const products = useMemo(() => (index ? index.search(q, cat, 300) : []), [index, q, cat]);
  const count = lines.reduce((a, l) => a + l.qty, 0);
  const total = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const qtyOf = (id: string) => lines.filter((l) => l.productId === id).reduce((a, l) => a + l.qty, 0);
  const add = (p: CatalogProduct) => {
    const groups = index?.catalog.modifierGroups.filter((g) => p.modifierGroupIds.includes(g.id)) ?? [];
    if (p.variants.length || groups.length || p.kind === 'weighted' || p.kind === 'open_price') return setOpt(p);
    const ex = lines.find((l) => l.productId === p.id && !l.variantId && !l.modifiers.length && !l.note);
    if (ex) setLines(lines.map((l) => (l === ex ? { ...l, qty: l.qty + 1 } : l)));
    else setLines([...lines, { key: uuid(), productId: p.id, variantId: null, name: p.name, qty: 1, unitPrice: p.price, modifiers: [], note: '' }]);
  };
  const title = o.data ? (o.data.tableName ? `โต๊ะ ${o.data.tableName}` : o.data.name) : '';
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Header title={`เมนู · ${title}`} back={() => go({ s: 'table', orderId })} />
      <div className="flex flex-none flex-col gap-2.5 bg-surface px-4 pb-3 pt-2">
        <div className="flex h-11 items-center gap-2 rounded-xl border border-line-strong bg-sunken px-3">
          <Search className="h-4 w-4 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาเมนู" className="flex-1 bg-transparent text-[15px] outline-none" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {[{ id: null as string | null, name: 'ทั้งหมด' }, ...(index?.catalog.categories.filter((c) => !c.parentId) ?? [])].map((c) => (
            <button key={c.id ?? 'all'} onClick={() => setCat(c.id)} className={cn('h-9 flex-none whitespace-nowrap rounded-full border px-3.5 text-[14px] font-medium', cat === c.id ? 'border-ink bg-ink text-surface' : 'border-line-strong')}>{c.name}</button>
          ))}
        </div>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto px-4 pb-24 pt-2">
        {products.map((p) => {
          const n = qtyOf(p.id);
          const out = p.stock !== null && p.stock <= 0;
          return (
            <button key={p.id} onClick={() => add(p)} className="flex w-full items-center gap-3 border-b border-line-soft py-3 text-left">
              <span className="h-12 w-12 flex-none overflow-hidden rounded-xl" style={{ background: p.color || '#efe3d3' }}>{p.image && <img src={p.image} alt="" className="h-full w-full object-cover" />}</span>
              <span className="flex flex-1 flex-col">
                <span className="text-[15px] font-medium">{p.name}</span>
                <span className="num text-[14px] font-semibold text-primary">{money(p.variants.length ? Math.min(...p.variants.map((v) => v.price)) : p.price)}{out && <span className="ml-2 text-[12px] font-normal text-danger">หมด</span>}</span>
              </span>
              {n > 0 ? <span className="num grid h-8 min-w-[32px] place-items-center rounded-full bg-ink px-2 text-[14px] font-semibold text-surface">{qtyText(n)}</span> : <span className="grid h-8 w-8 place-items-center rounded-full border border-line-strong"><Plus className="h-4 w-4" /></span>}
            </button>
          );
        })}
      </div>
      {count > 0 && (
        <button onClick={() => go({ s: 'review', orderId })} className="absolute inset-x-4 bottom-4 flex h-14 items-center justify-between rounded-[14px] bg-primary px-5 text-[16px] font-semibold text-primary-fg shadow-pop">
          <span>ตรวจออเดอร์ · {qtyText(count)} รายการ</span>
          <span className="num">{money(Math.round(total))}</span>
        </button>
      )}
      {opt && index && <OptionSheet p={opt} index={index} onClose={() => setOpt(null)} onAdd={(l) => (setLines([...lines, l]), setOpt(null))} />}
    </div>
  );
}

function OptionSheet({ p, index, onClose, onAdd }: { p: CatalogProduct; index: NonNullable<ReturnType<typeof useCatalog>['index']>; onClose: () => void; onAdd: (l: Line) => void }) {
  const groups = index.catalog.modifierGroups.filter((g) => p.modifierGroupIds.includes(g.id));
  const [variantId, setVariantId] = useState<string | null>(p.variants.length === 1 ? p.variants[0]!.id : null);
  const [mods, setMods] = useState(groups.filter((g) => g.minSelect >= 1 && g.maxSelect === 1 && g.modifiers[0]).map((g) => g.modifiers[0]!));
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const base = resolveBasePrice(p, { variantId });
  const unit = base + mods.reduce((a, m) => a + m.priceDelta, 0);
  const missing = groups.some((g) => mods.filter((m) => g.modifiers.some((x) => x.id === m.id)).length < g.minSelect) || (p.variants.length > 0 && !variantId);
  const toggle = (gid: string, m: (typeof mods)[number]) => {
    const g = groups.find((x) => x.id === gid)!;
    const inG = mods.filter((x) => g.modifiers.some((y) => y.id === x.id));
    if (mods.some((x) => x.id === m.id)) setMods(mods.filter((x) => x.id !== m.id));
    else if (g.maxSelect === 1) setMods([...mods.filter((x) => !inG.includes(x)), m]);
    else if (!g.maxSelect || inG.length < g.maxSelect) setMods([...mods, m]);
  };
  const v = p.variants.find((x) => x.id === variantId);
  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end bg-[rgb(23_25_28/0.4)]" onClick={onClose}>
      <div className="flex max-h-[88%] flex-col rounded-t-[22px] bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pb-2 pt-4"><span className="text-[18px] font-semibold">{p.name}</span><button onClick={onClose} aria-label="ปิด"><X className="h-5 w-5" /></button></div>
        <div className="flex flex-col gap-4 overflow-y-auto px-5 pb-3">
          {p.variants.length > 0 && (
            <OptGroup label="ตัวเลือก">
              {p.variants.map((x) => <Chip key={x.id} on={variantId === x.id} onClick={() => setVariantId(x.id)}>{x.name} · {money(x.price)}</Chip>)}
            </OptGroup>
          )}
          {groups.map((g) => (
            <OptGroup key={g.id} label={`${g.name}${g.minSelect ? ' *' : ''}`}>
              {g.modifiers.map((m) => <Chip key={m.id} on={mods.some((x) => x.id === m.id)} onClick={() => toggle(g.id, m)}>{m.name}{m.priceDelta ? ` +${money(m.priceDelta)}` : ''}</Chip>)}
            </OptGroup>
          ))}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุถึงครัว เช่น ไม่ใส่น้ำแข็ง" className="h-12 rounded-xl border border-line-strong px-3 text-[15px] outline-none focus:border-primary" />
        </div>
        <div className="flex items-center gap-3 border-t border-line-soft px-5 pb-5 pt-3">
          <div className="flex items-center rounded-xl border border-line-strong">
            <button className="grid h-12 w-12 place-items-center" aria-label="ลด" onClick={() => setQty(Math.max(1, qty - 1))}><Minus className="h-4 w-4" /></button>
            <span className="num w-8 text-center text-[17px] font-semibold">{qty}</span>
            <button className="grid h-12 w-12 place-items-center" aria-label="เพิ่ม" onClick={() => setQty(qty + 1)}><Plus className="h-4 w-4" /></button>
          </div>
          <button disabled={missing} onClick={() => onAdd({ key: uuid(), productId: p.id, variantId, name: v ? `${p.name} (${v.name})` : p.name, qty, unitPrice: unit, modifiers: mods, note: note.trim() })} className="flex h-12 flex-1 items-center justify-between rounded-xl bg-primary px-4 text-[15px] font-semibold text-primary-fg disabled:opacity-40">
            <span>เพิ่ม</span><span className="num">{money(unit * qty)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function OptGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-2"><span className="text-[14px] font-semibold">{label}</span><div className="flex flex-wrap gap-2">{children}</div></div>;
}
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={cn('min-h-[44px] rounded-xl border px-3.5 text-[14px] font-medium', on ? 'border-primary bg-soft text-soft-fg ring-1 ring-primary' : 'border-line-strong')}>{children}</button>;
}

function Review({ orderId, lines, setLines, go, queue }: { orderId: string; lines: Line[]; setLines: (l: Line[]) => void; go: (s: Screen) => void; queue: (p: Pending) => void }) {
  const o = useOrder(orderId);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const title = o.data ? (o.data.tableName ? `โต๊ะ ${o.data.tableName}` : o.data.name) : '';
  const total = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const send = async () => {
    setBusy(true);
    const requestId = uuid();
    try {
      const r = await api.post<{ printedTo: number }>(`/api/orders/${orderId}/items`, { requestId, source: 'app', items: lines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty, modifiers: l.modifiers, note: l.note })) });
      setLines([]);
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      qc.invalidateQueries({ queryKey: ['floor'] });
      const pq = await api.get<{ role: string; online: boolean }[]>('/api/print-queue').catch(() => []);
      go({ s: 'sent', orderId, title, printed: r.printedTo, queued: pq.some((p) => (p.role === 'kitchen' || p.role === 'bar') && !p.online) });
    } catch (e) {
      if (e instanceof ApiError && e.isNetwork) {
        queue({ requestId, orderId, title, items: lines, at: new Date().toISOString() });
        setLines([]);
        toast.warning('ยังส่งไม่ได้ เก็บออเดอร์ไว้ในเครื่องแล้ว จะส่งอัตโนมัติเมื่อเชื่อมต่อได้');
        go({ s: 'orders' });
      } else toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header title={`ตรวจออเดอร์ · ${title}`} back={() => go({ s: 'menu', orderId })} />
      <div className="scroll-thin flex-1 overflow-y-auto px-4 py-2">
        {lines.map((l) => (
          <div key={l.key} className="flex items-center gap-3 border-b border-line-soft py-3">
            <span className="flex flex-1 flex-col">
              <span className="text-[15px] font-medium">{l.name}</span>
              {(l.modifiers.length > 0 || l.note) && <span className="text-[12px] text-muted">{[...l.modifiers.map((m) => m.name), l.note && `* ${l.note}`].filter(Boolean).join(' · ')}</span>}
              <span className="num text-[13px] text-muted">{money(l.unitPrice)}</span>
            </span>
            <div className="flex items-center rounded-xl border border-line-strong">
              <button className="grid h-10 w-10 place-items-center" aria-label="ลด" onClick={() => setLines(l.qty <= 1 ? lines.filter((x) => x !== l) : lines.map((x) => (x === l ? { ...x, qty: x.qty - 1 } : x)))}><Minus className="h-4 w-4" /></button>
              <span className="num w-7 text-center font-semibold">{l.qty}</span>
              <button className="grid h-10 w-10 place-items-center" aria-label="เพิ่ม" onClick={() => setLines(lines.map((x) => (x === l ? { ...x, qty: x.qty + 1 } : x)))}><Plus className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
        {!lines.length && <p className="py-10 text-center text-[14px] text-muted">ยังไม่มีรายการ</p>}
      </div>
      <div className="flex flex-none flex-col gap-2 border-t border-line bg-surface px-4 pb-4 pt-3">
        <div className="flex justify-between"><span className="text-muted">รวมรอบนี้</span><span className="num text-[20px] font-bold">{money(Math.round(total))}</span></div>
        <button disabled={!lines.length || busy} onClick={() => void send()} className="h-14 rounded-[14px] bg-primary text-[16px] font-semibold text-primary-fg disabled:opacity-40">{busy ? 'กำลังส่ง…' : 'ส่งเข้าครัว'}</button>
      </div>
    </div>
  );
}

function Sent({ orderId, title, printed, queued, go }: { orderId: string; title: string; printed: number; queued: boolean; go: (s: Screen) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className={cn('grid h-16 w-16 place-items-center rounded-full text-[28px]', queued ? 'bg-warn-soft text-warn' : 'bg-soft text-primary')}>✓</div>
      <h2 className="text-[22px] font-semibold">ส่งออเดอร์ {title} แล้ว</h2>
      <p className="text-[14px] text-muted">{queued ? 'เครื่องพิมพ์ครัวยังไม่พร้อม ใบออเดอร์อยู่ในคิว จะพิมพ์อัตโนมัติเมื่อเครื่องกลับมา' : printed ? `พิมพ์ใบออเดอร์ที่ ${printed} เครื่องแล้ว` : 'ครัวเห็นออเดอร์บนจอครัวแล้ว'}</p>
      <div className="flex w-full max-w-[320px] flex-col gap-2">
        <button onClick={() => go({ s: 'table', orderId })} className="h-12 rounded-[14px] border border-line-strong bg-surface font-semibold">ดูโต๊ะนี้</button>
        <button onClick={() => go({ s: 'tables' })} className="h-12 rounded-[14px] bg-primary font-semibold text-primary-fg">กลับไปหน้าโต๊ะ</button>
      </div>
    </div>
  );
}

function CheckBill({ orderId, go }: { orderId: string; go: (s: Screen) => void }) {
  const o = useOrder(orderId);
  const settings = useSettings();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'sum' | 'qr'>('sum');
  const d = o.data;
  const pricing = useMemo(() => {
    if (!d) return null;
    return priceCart({
      lines: d.items.filter((i) => i.status !== 'cancelled').map((i) => ({ id: i.id, productId: i.product_id, name: i.name, qty: i.qty, unitPrice: i.unit_price, taxable: true })),
      billDiscount: effectiveBillDiscount(null, 0),
      config: { ...settings.tax, serviceChargeRate: settings.tax.serviceChargeRate },
    });
  }, [d, settings.tax]);
  const qr = useQuery({ queryKey: ['promptpay', pricing?.total], queryFn: () => api.get<{ payload: string }>('/api/promptpay', { amount: pricing!.total }), enabled: mode === 'qr' && !!pricing && pricing.total > 0, retry: false });
  const request = async () => {
    try {
      await api.post(`/api/orders/${orderId}/request-bill`, { value: true });
      qc.invalidateQueries({ queryKey: ['floor'] });
      toast.success('แจ้งแคชเชียร์แล้ว');
      go({ s: 'tables' });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  if (!d || !pricing) return <Header title="เช็คบิล" back={() => go({ s: 'table', orderId })} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <Header title={`เช็คบิล · ${d.tableName ? `โต๊ะ ${d.tableName}` : d.name}`} back={() => go({ s: 'table', orderId })} />
      <div className="mx-4 mt-3.5 flex rounded-xl bg-canvas p-1">
        {(['sum', 'qr'] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={cn('h-11 flex-1 rounded-[9px] text-[14px]', mode === m ? 'bg-surface font-semibold shadow-card' : '')}>{m === 'sum' ? 'สรุปรายการ' : 'QR PromptPay'}</button>)}
      </div>
      {mode === 'qr' ? (
        <div className="flex flex-1 flex-col items-center gap-3.5 px-6 py-5">
          <span className="text-[14px] text-muted">ให้ลูกค้าสแกนจ่าย</span>
          <span className="num text-[36px] font-bold">{money(pricing.total)}</span>
          {qr.data ? <QrImage data={qr.data.payload} size={232} className="rounded-2xl border border-line p-2" /> : qr.isError ? <span className="text-[14px] text-danger">{errorMessage(qr.error)}</span> : <div className="skeleton h-[232px] w-[232px]" />}
          <span className="text-center text-[12px] text-muted">แคชเชียร์ตรวจยอดเข้าแล้วกดยืนยันที่ POS เพื่อปิดบิลและพิมพ์ใบเสร็จ</span>
        </div>
      ) : (
        <div className="num flex flex-1 flex-col gap-2 overflow-y-auto px-5 py-4">
          {d.items.filter((i) => i.status !== 'cancelled').map((i) => <div key={i.id} className="flex justify-between py-1.5 text-[15px]"><span>{qtyText(i.qty)}× {i.name}</span><span>{money(Math.round(i.qty * i.unit_price))}</span></div>)}
          <div className="mt-1.5 flex flex-col gap-1.5 border-t border-line-soft pt-2.5 text-[14px] text-muted">
            <div className="flex justify-between"><span>ยอดรวม</span><span>{money(pricing.subtotal)}</span></div>
            {pricing.serviceCharge > 0 && <div className="flex justify-between"><span>ค่าบริการ {settings.tax.serviceChargeRate}%</span><span>{money(pricing.serviceCharge)}</span></div>}
            {settings.tax.vatEnabled && <div className="flex justify-between"><span>VAT {settings.tax.vatRate}%</span><span>{money(pricing.vat)}</span></div>}
          </div>
          <div className="mt-1 flex items-baseline justify-between"><span className="font-semibold">ยอดชำระ</span><span className="text-[26px] font-bold">{money(pricing.total)}</span></div>
          <span className="text-[12px] text-muted">ส่วนลดสมาชิก/โปรโมชั่นจะคำนวณที่ POS ตอนเก็บเงิน</span>
        </div>
      )}
      <div className="flex flex-col gap-2 border-t border-line-soft px-4 pb-4 pt-3.5">
        <button onClick={() => void request()} className="h-14 rounded-[14px] bg-primary text-[16px] font-semibold text-primary-fg">ส่งไปชำระที่เคาน์เตอร์</button>
      </div>
    </div>
  );
}

function MyOrders({ pending, retry, discard }: { pending: Pending[]; retry: () => void; discard: (id: string) => void }) {
  const orders = useQuery({ queryKey: ['orders', 'open'], queryFn: () => api.get<{ id: string; name: string; table_name: string | null; itemCount: number; total: number; opened_at: string; pending: number; ready: number }[]>('/api/orders', { status: 'open' }), refetchInterval: 20_000 });
  const pq = useQuery({ queryKey: ['print-queue'], queryFn: () => api.get<{ id: string; name: string; role: string; online: boolean; queued: { id: string; title: string }[] }[]>('/api/print-queue'), refetchInterval: 15_000 });
  const kitchen = (pq.data ?? []).filter((p) => p.role === 'kitchen' || p.role === 'bar');
  const off = kitchen.filter((p) => !p.online);
  const queued = kitchen.reduce((a, p) => a + p.queued.length, 0);
  const banner = off.length ? { bg: 'bg-danger-soft text-danger', dot: 'bg-danger', text: `${off.map((p) => p.name).join(', ')} ไม่พร้อม · รอพิมพ์ ${queued} ใบ` } : kitchen.length ? { bg: 'bg-soft text-soft-fg', dot: 'bg-accent', text: 'เครื่องพิมพ์ออเดอร์พร้อม' } : null;
  return (
    <>
      {banner && (
        <div className={cn('flex flex-none items-center gap-2.5 px-4 py-3 text-[14px] font-medium', banner.bg)}>
          <span className={cn('h-[9px] w-[9px] rounded-full', banner.dot)} />
          <span className="flex-1">{banner.text}</span>
          {off.length > 0 && <button onClick={() => void Promise.all(off.map((p) => api.post(`/api/printers/${p.id}/retry`))).then(() => pq.refetch())} className="h-9 rounded-[10px] bg-white/70 px-3 text-[13px] font-semibold text-ink">ลองอีกครั้ง</button>}
        </div>
      )}
      <div className="px-5 pb-2 pt-4"><span className="text-[20px] font-semibold">ออเดอร์ของฉัน</span></div>
      <div className="scroll-thin flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 pb-4">
        {pending.map((p) => (
          <div key={p.requestId} className="flex flex-col gap-1.5 rounded-[14px] border border-warn/40 bg-surface p-3.5">
            <div className="flex items-center justify-between"><span className="text-[16px] font-semibold">{p.title}</span><span className="rounded-full bg-warn-soft px-2.5 py-1 text-[12px] font-semibold text-warn">รอส่ง</span></div>
            <span className="text-[14px] text-ink-2">{p.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</span>
            <span className="text-[12px] text-muted">{hhmm(p.at)}{p.error ? ` · ${p.error}` : ' · จะส่งอัตโนมัติเมื่อเชื่อมต่อได้'}</span>
            <div className="flex gap-2"><button onClick={retry} className="h-9 rounded-lg border border-line-strong px-3 text-[13px]">ส่งตอนนี้</button>{p.error && <button onClick={() => discard(p.requestId)} className="h-9 rounded-lg px-3 text-[13px] text-danger">ทิ้ง</button>}</div>
          </div>
        ))}
        {orders.data?.map((o) => (
          <div key={o.id} className="flex flex-col gap-1.5 rounded-[14px] border border-line bg-surface p-3.5">
            <div className="flex items-center justify-between"><span className="text-[16px] font-semibold">{o.table_name ? `โต๊ะ ${o.table_name}` : o.name}</span><span className={cn('rounded-full px-2.5 py-1 text-[12px] font-semibold', o.ready ? 'bg-soft text-soft-fg' : o.pending ? 'bg-warn-soft text-warn' : 'bg-canvas text-muted')}>{o.ready ? `พร้อมเสิร์ฟ ${o.ready}` : o.pending ? `กำลังทำ ${o.pending}` : 'เสิร์ฟแล้ว'}</span></div>
            <span className="num text-[14px] text-ink-2">{qtyText(o.itemCount)} รายการ · {money(o.total)}</span>
            <span className="text-[12px] text-muted">เปิด {hhmm(o.opened_at)} · {mins(o.opened_at)} นาที</span>
          </div>
        ))}
        {!pending.length && !orders.data?.length && <p className="py-10 text-center text-[14px] text-muted">ยังไม่มีออเดอร์ที่เปิดอยู่</p>}
      </div>
    </>
  );
}

function Notifications({ go }: { go: (s: Screen) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<{ id: string; type: string; title: string; body: string; ref_id: string; created_at: string; read_at: string | null }[]>('/api/notifications') });
  const read = async (ids: string[]) => {
    await api.post('/api/notifications/read', { ids }).catch(() => undefined);
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  return (
    <>
      <div className="flex flex-none items-center justify-between border-b border-line bg-surface px-5 pb-3 pt-4">
        <span className="text-[20px] font-semibold">แจ้งเตือน</span>
        <button onClick={() => void read((q.data ?? []).filter((n) => !n.read_at).map((n) => n.id))} className="h-11 text-[14px] font-semibold text-primary">อ่านทั้งหมด</button>
      </div>
      <div className="scroll-thin flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
        {q.data?.map((n) => (
          <button key={n.id} onClick={() => { void read([n.id]); if (n.ref_id) go({ s: 'table', orderId: n.ref_id }); }} className={cn('flex w-full items-start gap-3 rounded-[14px] border p-3.5 text-left', n.read_at ? 'border-line bg-surface' : 'border-primary/30 bg-soft/50')}>
            <span className={cn('mt-1.5 h-2.5 w-2.5 flex-none rounded-full', n.read_at ? 'bg-line-strong' : n.type === 'ready' ? 'bg-accent' : 'bg-warn')} />
            <span className="flex flex-1 flex-col gap-0.5"><span className={cn('text-[15px]', !n.read_at && 'font-semibold')}>{n.title}</span><span className="text-[13px] text-muted">{n.body}</span></span>
            <span className="whitespace-nowrap text-[12px] text-muted">{hhmm(n.created_at)}</span>
          </button>
        ))}
        {q.data && !q.data.length && <p className="py-10 text-center text-[14px] text-muted">ยังไม่มีแจ้งเตือน · จะแจ้งเมื่ออาหารพร้อมเสิร์ฟหรือมีการเช็คบิล</p>}
      </div>
    </>
  );
}

function Me() {
  const { user, logout } = useSession();
  const settings = useSettings();
  const shift = useQuery({ queryKey: ['shift', 'current'], queryFn: () => api.get<{ openedAt: string; salesCount: number; salesTotal: number } | null>('/api/shifts/current').catch(() => null) });
  const orders = useQuery({ queryKey: ['orders', 'all-today'], queryFn: () => api.get<{ id: string }[]>('/api/orders', { status: 'all' }) });
  const [vibrate, setVibrate] = useState(() => localStorage.getItem('flexpos.order.vibrate') !== '0');
  return (
    <div className="scroll-thin flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-5">
      <div className="flex items-center gap-3 px-1">
        <span className="grid h-[52px] w-[52px] place-items-center rounded-full bg-soft text-[17px] font-semibold text-soft-fg">{initials(user?.name ?? '')}</span>
        <div className="flex flex-col"><span className="text-[18px] font-semibold">{user?.name}</span><span className="text-[13px] text-muted">{user?.roleName} · {settings.store.name}</span></div>
      </div>
      <div className="num grid grid-cols-3 gap-2 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-col"><span className="text-[12px] text-muted">เข้ากะ</span><span className="text-[18px] font-semibold">{shift.data ? hhmm(shift.data.openedAt) : '—'}</span></div>
        <div className="flex flex-col"><span className="text-[12px] text-muted">ออเดอร์วันนี้</span><span className="text-[18px] font-semibold">{orders.data?.length ?? '—'}</span></div>
        <div className="flex flex-col"><span className="text-[12px] text-muted">ยอดขายกะ</span><span className="text-[18px] font-semibold">{shift.data ? money(shift.data.salesTotal) : '—'}</span></div>
      </div>
      <div className="rounded-2xl border border-line bg-surface px-4 py-1">
        <div className="flex items-center gap-3 border-b border-line-soft py-3">
          <span className="flex flex-1 flex-col"><span className="text-[15px] font-medium">สั่นเมื่ออาหารพร้อม</span><span className="text-[12px] text-muted">แจ้งเตือนเมื่อครัวกด “พร้อมเสิร์ฟ”</span></span>
          <button role="switch" aria-checked={vibrate} onClick={() => { setVibrate(!vibrate); localStorage.setItem('flexpos.order.vibrate', vibrate ? '0' : '1'); }} className={cn('flex h-7 w-12 flex-none items-center rounded-full p-[3px]', vibrate ? 'justify-end bg-primary' : 'justify-start bg-line-strong')}><span className="h-[22px] w-[22px] rounded-full bg-white" /></button>
        </div>
        <div className="flex h-[52px] items-center justify-between border-b border-line-soft text-[15px]"><span>เครื่องพิมพ์ออเดอร์</span><span className="text-[13px] text-muted">แอดมินตั้งค่าที่ POS</span></div>
        <div className="flex h-[52px] items-center justify-between text-[15px]"><span>เวอร์ชันแอป</span><span className="text-[13px] text-muted">1.0.0</span></div>
      </div>
      <div className="flex gap-2">
        <button onClick={() => void logout()} className="h-[52px] flex-1 rounded-[14px] border border-line-strong bg-surface text-[15px]">เปลี่ยนผู้ใช้</button>
        <button onClick={() => void logout()} className="h-[52px] flex-1 rounded-[14px] border border-danger/30 bg-surface text-[15px] font-semibold text-danger">ออกจากระบบ</button>
      </div>
    </div>
  );
}
