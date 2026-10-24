import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { money } from '@/lib/settings';
import { cn, qtyText, todayStr } from '@/lib/utils';
import { Page } from '@/components/layout/AppShell';
import { Badge, Button, EmptyState, ErrorState, PageHeader, Segmented, SkeletonRows } from '@/components/ui/core';

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

  const reprint = async (id: string, round: number) => {
    try {
      await api.post(`/api/orders/${id}/reprint`, { round });
      toast.success('ส่งพิมพ์ใบออเดอร์อีกครั้งแล้ว');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

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
      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[72px_120px_minmax(0,1fr)_140px_220px] gap-3.5 border-b border-line-soft bg-sunken px-5 py-3 text-[13px] font-medium text-muted md:grid">
          <span>เวลา</span><span>โต๊ะ</span><span>สถานะ</span><span className="text-right">ยอด</span><span />
        </div>
        {orders.isLoading ? <SkeletonRows /> : orders.isError ? <ErrorState error={orders.error} onRetry={() => void orders.refetch()} /> : !orders.data?.length ? (
          <EmptyState title="ไม่มีออเดอร์" body="ออเดอร์จากแอปรับออเดอร์ (เปิด /order บนมือถือพนักงาน) และจากหน้าขายจะแสดงที่นี่" />
        ) : orders.data.map((o) => (
          <div key={o.id} className="grid grid-cols-[1fr_auto] items-center gap-3.5 border-b border-line-soft px-5 py-3.5 md:grid-cols-[72px_120px_minmax(0,1fr)_140px_220px]">
            <span className="num hidden flex-col md:flex"><span className="text-[15px] font-semibold">{new Date(o.opened_at).toTimeString().slice(0, 5)}</span><span className="font-mono text-[11px] text-muted">{o.id.slice(0, 6).toUpperCase()}</span></span>
            <span className="flex flex-col"><span className="text-[15px] font-semibold">{o.table_name ? `โต๊ะ ${o.table_name}` : o.name}</span><span className="text-[12px] text-muted">{o.opened_by}</span></span>
            <span className="hidden flex-wrap items-center gap-1.5 text-[13px] text-ink-2 md:flex">
              {qtyText(o.itemCount)} รายการ · {o.rounds} รอบ
              {o.fromApp && <Badge tone="info">แอป</Badge>}
              {o.pending > 0 && <Badge tone="warn">กำลังทำ {o.pending}</Badge>}
              {o.ready > 0 && <Badge tone="success">พร้อมเสิร์ฟ {o.ready}</Badge>}
              {o.status !== 'open' && <Badge>{o.status === 'paid' ? 'เก็บเงินแล้ว' : 'ยกเลิก'}</Badge>}
            </span>
            <span className="num hidden text-right font-semibold md:block">{money(o.total)}</span>
            <span className="col-span-2 flex justify-end gap-1.5 md:col-span-1">
              {o.rounds > 0 && <Button size="sm" className="h-10" onClick={() => void reprint(o.id, o.rounds)}>พิมพ์ซ้ำ</Button>}
              {o.status === 'open' && <Button size="sm" variant="primary" className="h-10 px-3.5" onClick={() => nav(`/pos?order=${o.id}`)}>เก็บเงิน {money(o.total)}</Button>}
            </span>
          </div>
        ))}
      </div>
    </Page>
  );
}
