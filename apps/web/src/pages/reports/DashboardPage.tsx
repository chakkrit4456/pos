import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { t } from '@flexpos/shared';
import { api, errorMessage } from '@/lib/api';
import { useFormatters, useSettings } from '@/lib/settings';
import { Page } from '@/components/layout/AppShell';
import { Button, ErrorState } from '@/components/ui/core';
import { DashboardView, type Dash, type DashRange } from '@/components/DashboardView';

export default function DashboardPage() {
  const nav = useNavigate();
  const f = useFormatters();
  const settings = useSettings();
  const [range, setRange] = useState<DashRange>('today');
  const q = useQuery({ queryKey: ['dashboard', range], queryFn: () => api.get<Dash>('/api/reports/dashboard', { range }), refetchInterval: 60_000 });
  const d = q.data;

  const exportCsv = () => d && api.download('/api/reports/sales', { from: d.range.from, to: d.range.to, groupBy: range === 'today' ? 'hour' : 'day', format: 'csv' }).catch((e) => toast.error(errorMessage(e)));

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} className="h-full justify-center" />;

  return (
    <Page>
      <DashboardView
        d={d}
        range={range}
        onRange={setRange}
        modules={settings.modules}
        formatDate={f.date}
        actions={<Button onClick={() => void exportCsv()}>{t('ส่งออก CSV')}</Button>}
        onOrder={(id) => nav(`/pos?order=${id}`)}
        onStock={() => nav('/stock')}
      />
    </Page>
  );
}
