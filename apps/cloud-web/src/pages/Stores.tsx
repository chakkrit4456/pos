import { Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Store } from 'lucide-react';
import { t } from '@flexpos/shared';
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '@/components/ui/core';
import { api } from '~/lib/api';
import { ago } from '~/lib/format';
import { useSession } from '~/lib/session';

export interface StoreSummary {
  id: string;
  name: string;
  status: string;
  role: 'manager' | 'viewer' | 'superadmin';
  lastSyncAt: string | null;
  lastSeenAt: string | null;
  online: boolean;
  posVersion: string | null;
}

export const roleLabel = (r: string) => (r === 'manager' ? t('ผู้จัดการ') : r === 'viewer' ? t('ผู้ดูข้อมูล') : t('ผู้ดูแลระบบ'));

export function OnlineBadge({ online, lastSeenAt }: { online: boolean; lastSeenAt: string | null }) {
  return online ? <Badge tone="success">{t('POS ออนไลน์')}</Badge> : <Badge tone="warn">{lastSeenAt ? t('POS ออฟไลน์ · {0}', ago(lastSeenAt)) : t('ยังไม่เคยส่งข้อมูล')}</Badge>;
}

export default function Stores() {
  const { user } = useSession();
  const q = useQuery({ queryKey: ['stores'], queryFn: () => api.get<{ stores: StoreSummary[] }>('/api/stores'), refetchInterval: 30_000 });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const stores = q.data?.stores;
  if (stores?.length === 1 && !user?.isSuperadmin) return <Navigate to={`/s/${stores[0]!.id}`} replace />;
  return (
    <>
      <PageHeader title={t('ร้านของฉัน')} sub={user?.email} />
      {!stores ? (
        <SkeletonRows />
      ) : !stores.length ? (
        <EmptyState icon={<Store />} title={t('ยังไม่มีร้านในบัญชีนี้')} body={t('เชื่อมต่อเครื่อง POS ที่ ตั้งค่า → แดชบอร์ดออนไลน์ หรือขอให้ผู้จัดการร้านเพิ่มบัญชีของคุณ')} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {stores.map((s) => (
            <Link key={s.id} to={`/s/${s.id}`} className="card flex items-center gap-4 p-5 hover:shadow-lift">
              <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-soft text-soft-fg"><Store className="h-5 w-5" /></span>
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="truncate text-[17px] font-semibold">{s.name}</span>
                <span className="flex flex-wrap gap-1.5">
                  <OnlineBadge online={s.online} lastSeenAt={s.lastSeenAt} />
                  <Badge>{roleLabel(s.role)}</Badge>
                  {s.status !== 'active' && <Badge tone="danger">{t('ระงับ')}</Badge>}
                </span>
                <span className="text-[13px] text-muted">{t('ข้อมูลล่าสุด {0}', ago(s.lastSyncAt))}</span>
              </span>
              <ChevronRight className="h-5 w-5 text-faint" />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
