import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, ShoppingBag } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { money } from '@/lib/settings';
import { useSession } from '@/lib/session';
import { cn, qtyText } from '@/lib/utils';
import { Page } from '@/components/layout/AppShell';
import { Badge, Button, EmptyState, ErrorState, PageHeader, SkeletonRows } from '@/components/ui/core';
import type { FloorData } from '../pos/BillPicker';

const mins = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));

export default function FloorPage() {
  const nav = useNavigate();
  const { can } = useSession();
  const [zone, setZone] = useState('all');
  const floor = useQuery({ queryKey: ['floor'], queryFn: () => api.get<FloorData>('/api/floor'), refetchInterval: 30_000 });
  const open = async (tableId: string | null, orderId?: string) => {
    try {
      const id = orderId ?? (await api.post<{ id: string }>('/api/orders', { tableId })).id;
      nav(`/pos?order=${id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const tables = (floor.data?.tables ?? []).filter((t) => zone === 'all' || t.zoneId === zone);
  const busy = floor.data?.tables.filter((t) => t.order).length ?? 0;
  return (
    <Page>
      <PageHeader
        title="โต๊ะ"
        sub={floor.data ? `ใช้งาน ${busy} / ${floor.data.tables.length} โต๊ะ · ยอดรอเก็บ ${money(floor.data.tables.reduce((a, t) => a + (t.order?.total ?? 0), 0))}` : ' '}
        actions={
          <>
            {can('settings.manage') && <Button onClick={() => nav('/settings/tables')}>จัดการโต๊ะ</Button>}
            <Button variant="primary" icon={<ShoppingBag className="h-4 w-4" />} onClick={() => void open(null)}>สั่งกลับบ้าน</Button>
          </>
        }
      />
      {floor.isLoading ? <SkeletonRows /> : floor.isError ? <ErrorState error={floor.error} onRetry={() => void floor.refetch()} /> : !floor.data?.tables.length ? (
        <EmptyState title="ยังไม่มีโต๊ะ" body="เพิ่มโซนและโต๊ะได้ที่ ตั้งค่า → โต๊ะและโซน" action={can('settings.manage') ? <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => nav('/settings/tables')}>เพิ่มโต๊ะ</Button> : undefined} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {[{ id: 'all', name: 'ทั้งหมด' }, ...floor.data.zones].map((z) => (
              <button key={z.id} onClick={() => setZone(z.id)} className={cn('h-10 rounded-full border px-4 text-[14px] font-medium', zone === z.id ? 'border-ink bg-ink text-surface' : 'border-line-strong bg-surface')}>{z.name}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {tables.map((t) => {
              const o = t.order;
              return (
                <button key={t.id} onClick={() => void open(t.id, o?.id)} className={cn('flex h-[124px] flex-col justify-between rounded-2xl border p-3.5 text-left transition-colors', o ? (o.billRequested ? 'border-danger/40 bg-danger-soft' : 'border-[#c9b98f] bg-[#fbf3df] dark:bg-warn-soft') : 'border-line bg-surface hover:bg-sunken')}>
                  <span className="flex items-start justify-between">
                    <span className="flex flex-col"><span className="text-[22px] font-semibold leading-tight">{t.name}</span>{zone === 'all' && t.zoneName && <span className="text-[12px] text-muted">{t.zoneName}</span>}</span>
                    {o?.readyCount ? <Badge tone="success">พร้อมเสิร์ฟ {o.readyCount}</Badge> : o?.billRequested ? <Badge tone="danger">เช็คบิล</Badge> : null}
                  </span>
                  {o ? (
                    <span className="flex flex-col">
                      <span className="num text-[16px] font-semibold">{money(o.total)}</span>
                      <span className="text-[12px] text-muted">{qtyText(o.items)} รายการ · {mins(o.openedAt)} นาที{o.waitingCount ? ` · รอ ${o.waitingCount}` : ''}</span>
                    </span>
                  ) : (
                    <span className="text-[13px] text-muted">ว่าง · {t.seats} ที่นั่ง</span>
                  )}
                </button>
              );
            })}
          </div>
          {floor.data.takeaway.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-[16px] font-semibold">กลับบ้าน / ไม่ระบุโต๊ะ</h2>
              <div className="grid gap-2 md:grid-cols-3">
                {floor.data.takeaway.map((o) => (
                  <button key={o.id} onClick={() => void open(null, o.id)} className="card flex items-center justify-between px-4 py-3 text-left hover:bg-sunken">
                    <span className="font-medium">{o.name}</span>
                    <span className="num text-[14px] text-muted">{money(o.total)} · {mins(o.openedAt)} นาที</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Page>
  );
}
