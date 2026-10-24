import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Volume2, VolumeX } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { cn, qtyText } from '@/lib/utils';
import { Button, EmptyState, ErrorState, Segmented, Spinner } from '@/components/ui/core';

interface KItem {
  id: string;
  order_id: string;
  round_no: number;
  name: string;
  qty: number;
  modifiers: string[];
  note: string;
  status: 'sent' | 'preparing' | 'ready';
  station: string;
  sent_at: string;
  title: string;
  by: string | null;
}

const age = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));

/** Kitchen display: tickets per order round; tap items to advance sent → preparing → ready. */
export default function KitchenPage() {
  const qc = useQueryClient();
  const [station, setStation] = useState<'all' | 'kitchen' | 'bar'>('all');
  const [sound, setSound] = useState(true);
  const [, tick] = useState(0);
  const q = useQuery({ queryKey: ['kitchen', station], queryFn: () => api.get<KItem[]>('/api/kitchen', { station: station === 'all' ? undefined : station }), refetchInterval: 15_000 });
  const lastCount = useRef(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const n = q.data?.filter((i) => i.status === 'sent').length ?? 0;
    if (sound && n > lastCount.current) {
      try {
        const ctx = new AudioContext();
        const o = ctx.createOscillator();
        o.frequency.value = 880;
        o.connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.15);
      } catch {
        /* audio blocked until interaction */
      }
    }
    lastCount.current = n;
  }, [q.data, sound]);

  const tickets = useMemo(() => {
    const m = new Map<string, { key: string; title: string; round: number; sentAt: string; by: string | null; items: KItem[] }>();
    for (const i of q.data ?? []) {
      const key = `${i.order_id}:${i.round_no}`;
      const t = m.get(key) ?? { key, title: i.title, round: i.round_no, sentAt: i.sent_at, by: i.by, items: [] };
      t.items.push(i);
      m.set(key, t);
    }
    return [...m.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  }, [q.data]);

  const setStatus = async (ids: string[], status: string) => {
    try {
      await api.post('/api/kitchen/items/status', { ids, status });
      qc.invalidateQueries({ queryKey: ['kitchen'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const next = (s: KItem['status']) => (s === 'sent' ? 'preparing' : s === 'preparing' ? 'ready' : 'served');

  return (
    <div className="flex h-full flex-col bg-rail text-white">
      <div className="flex flex-none flex-wrap items-center gap-3 px-5 py-3">
        <h1 className="text-[22px] font-semibold">จอครัว</h1>
        <Segmented value={station} onChange={setStation} className="border-[#3a3d42] bg-[#24272b] [&_button[aria-selected=false]]:text-[#a5a8ad]" options={[{ value: 'all', label: 'ทั้งหมด' }, { value: 'kitchen', label: 'ครัว' }, { value: 'bar', label: 'บาร์' }]} />
        <span className="text-[14px] text-[#a5a8ad]">{tickets.length} ใบ · รอ {q.data?.filter((i) => i.status !== 'ready').length ?? 0} รายการ</span>
        <Button variant="ghost" className="ml-auto text-white hover:bg-[#24272b]" icon={sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />} onClick={() => setSound(!sound)}>
          เสียงแจ้งเตือน
        </Button>
      </div>
      {q.isLoading ? <div className="grid flex-1 place-items-center"><Spinner /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : tickets.length === 0 ? (
        <EmptyState className="flex-1 justify-center text-white [&_p]:text-white" title="ไม่มีออเดอร์ค้าง" body="ออเดอร์ใหม่จะแสดงที่นี่ทันที" />
      ) : (
        <div className="scroll-thin grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 overflow-y-auto px-5 pb-5">
          {tickets.map((t) => {
            const a = age(t.sentAt);
            const allReady = t.items.every((i) => i.status === 'ready');
            return (
              <div key={t.key} className={cn('flex flex-col overflow-hidden rounded-2xl bg-surface text-ink', a >= 20 && !allReady && 'ring-4 ring-danger', a >= 10 && a < 20 && !allReady && 'ring-4 ring-warn')}>
                <div className={cn('flex items-center justify-between px-4 py-3', allReady ? 'bg-soft' : 'bg-sunken')}>
                  <span className="flex flex-col"><span className="text-[20px] font-bold">{t.title}</span><span className="text-[12px] text-muted">รอบ {t.round} · {t.by}</span></span>
                  <span className={cn('num text-[18px] font-semibold', a >= 20 ? 'text-danger' : a >= 10 ? 'text-warn' : 'text-muted')}>{a} นาที</span>
                </div>
                <div className="flex flex-col">
                  {t.items.map((i) => (
                    <button key={i.id} onClick={() => void setStatus([i.id], next(i.status))} className={cn('flex items-start gap-3 border-b border-line-soft px-4 py-3 text-left', i.status === 'ready' && 'bg-soft/60 text-muted line-through', i.status === 'preparing' && 'bg-warn-soft/60')}>
                      <span className="num min-w-[34px] text-[20px] font-bold">{qtyText(i.qty)}×</span>
                      <span className="flex flex-1 flex-col">
                        <span className="text-[17px] font-semibold">{i.name}</span>
                        {i.modifiers.length > 0 && <span className="text-[14px] text-ink-2">{i.modifiers.join(' · ')}</span>}
                        {i.note && <span className="text-[14px] font-semibold text-danger">* {i.note}</span>}
                      </span>
                      <span className="text-[12px] text-muted">{{ sent: 'ใหม่', preparing: 'กำลังทำ', ready: 'พร้อม' }[i.status]}</span>
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 p-3">
                  {allReady ? (
                    <Button className="flex-1" onClick={() => void setStatus(t.items.map((i) => i.id), 'served')}>เสิร์ฟแล้ว · เก็บใบ</Button>
                  ) : (
                    <Button variant="primary" className="flex-1" onClick={() => void setStatus(t.items.map((i) => i.id), 'ready')}>พร้อมเสิร์ฟทั้งใบ</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
