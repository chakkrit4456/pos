import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { money } from '@/lib/settings';
import { cn, qtyText, todayStr } from '@/lib/utils';
import { Page } from '@/components/layout/AppShell';
import { Badge, EmptyState, ErrorState, PageHeader, Segmented, SkeletonRows } from '@/components/ui/core';
import { Dialog } from '@/components/ui/dialog';
import { ApprovalHost } from '../pos/dialogs';
import { OrderBillPanel } from './OrderBillPanel';

interface OrderRow {
  id: string;
  name: string;
  status: string;
  opened_at: string;
  table_name: string | null;
  opened_by: string | null;
  total: number;
  itemCount: number;
  rounds: number;
  fromApp: boolean;
  pending: number;
  ready: number;
}

interface Printer { id: string; name: string; role: string; online: boolean; kind: string; queued: { id: string }[] }

export default function OrdersPage() {
  const nav = useNavigate();
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [selected, setSelected] = useState<string | null>(null);
  const [wide, setWide] = useState(() => matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = matchMedia('(min-width: 1024px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const orders = useQuery({ queryKey: ['orders', status], queryFn: () => api.get<OrderRow[]>('/api/orders', { status, date: status === 'all' ? todayStr() : undefined }), refetchInterval: 20_000 });
  const queue = useQuery({ queryKey: ['print-queue'], queryFn: () => api.get<Printer[]>('/api/print-queue'), refetchInterval: 20_000 });
  const kitchen = (queue.data ?? []).filter((p) => p.role === 'kitchen' || p.role === 'bar');
  const offline = kitchen.filter((p) => !p.online);
  const queued = kitchen.reduce((a, p) => a + p.queued.length, 0);
  const banner = !kitchen.length
    ? { tone: 'neutral' as const, text: 'ยังไม่ได้เชื่อมเครื่องพิมพ์ออเดอร์' }
    : offline.length
      ? { tone: 'danger' as const, text: `${offline.map((p) => p.name).join(', ')} ไม่พร้อม · รอพิมพ์ ${queued} ใบ` }
      : { tone: 'success' as const, text: `เครื่องพิมพ์ออเดอร์พร้อม (${kitchen.length})` };

  return (
    <Page>
      <PageHeader
        title="ออเดอร์"
        sub={`ส่งจากแอปพนักงานและหน้าร้าน · ${orders.data?.length ?? 0} ออเดอร์`}
        actions={
          <button onClick={() => nav('/settings/printers')} className={cn('flex h-10 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium', banner.tone === 'danger' ? 'bg-danger-soft text-danger' : banner.tone === 'success' ? 'bg-soft text-soft-fg' : 'bg-canvas text-muted')}>
            <span className={cn('h-2 w-2 rounded-full', banner.tone === 'danger' ? 'bg-danger' : banner.tone === 'success' ? 'bg-accent' : 'bg-faint')} />
            {banner.text}
          </button>
        }
      />
      <Segmented className="self-start" value={status} onChange={setStatus} options={[{ value: 'open', label: 'ยังไม่เก็บเงิน' }, { value: 'all', label: 'ทั้งหมดวันนี้' }]} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="card overflow-hidden">
          {orders.isLoading ? <SkeletonRows /> : orders.isError ? <ErrorState error={orders.error} onRetry={() => void orders.refetch()} /> : !orders.data?.length ? (
            <EmptyState title="ไม่มีออเดอร์" body="ออเดอร์จากแอปรับออเดอร์ (เปิด /order บนมือถือพนักงาน) และจากหน้าขายจะแสดงที่นี่" />
          ) : orders.data.map((o) => (
            <button
              key={o.id}
              onClick={() => setSelected(o.id)}
              aria-pressed={selected === o.id}
              className={cn('grid w-full grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-line-soft px-5 py-3.5 text-left transition-colors last:border-0 hover:bg-sunken', selected === o.id && 'bg-soft/60 shadow-[inset_3px_0_0_rgb(var(--primary))] hover:bg-soft/60')}
            >
              <span className="num flex flex-col"><span className="text-[15px] font-semibold">{new Date(o.opened_at).toTimeString().slice(0, 5)}</span><span className="font-mono text-[11px] text-muted">{o.id.slice(0, 8).toUpperCase()}</span></span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-[15px] font-semibold">{o.table_name ? `โต๊ะ ${o.table_name}` : o.name} <span className="text-[12px] font-normal text-muted">· {o.opened_by}</span></span>
                <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink-2">
                  {qtyText(o.itemCount)} รายการ · {o.rounds} รอบ
                  {o.fromApp && <Badge tone="info">แอป</Badge>}
                  {o.pending > 0 && <Badge tone="warn">กำลังทำ {o.pending}</Badge>}
                  {o.ready > 0 && <Badge tone="success">พร้อมเสิร์ฟ {o.ready}</Badge>}
                  {o.status !== 'open' && <Badge>{o.status === 'paid' ? 'เก็บเงินแล้ว' : 'ยกเลิก'}</Badge>}
                </span>
              </span>
              <span className="num text-right text-[16px] font-semibold">{money(o.total)}</span>
            </button>
          ))}
        </div>
        <aside className="card sticky top-0 hidden max-h-[calc(100vh-150px)] min-h-[420px] overflow-hidden lg:flex lg:flex-col">
          {selected ? <OrderBillPanel key={selected} orderId={selected} /> : <EmptyState className="my-auto" title="เลือกออเดอร์" body="แตะโต๊ะทางซ้ายเพื่อดูรายละเอียดบิล ลบรายการ หรือเก็บเงิน" />}
        </aside>
      </div>
      {selected && !wide && (
        <Dialog open onOpenChange={(v) => !v && setSelected(null)} title="รายละเอียดบิล" size="md" hideClose className="[&>div:nth-child(2)]:p-0">
          <div className="h-[78vh] min-w-0"><OrderBillPanel orderId={selected} onClose={() => setSelected(null)} /></div>
        </Dialog>
      )}
      <ApprovalHost />
    </Page>
  );
}
