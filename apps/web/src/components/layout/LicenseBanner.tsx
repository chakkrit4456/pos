import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { LicenseStatus } from '@flexpos/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t } from '@flexpos/shared';
import { tn } from '@/lib/i18n';

export function LicenseBanner() {
  const { can } = useSession();
  const q = useQuery({ queryKey: ['license'], queryFn: () => api.get<LicenseStatus>('/api/license'), staleTime: 10 * 60_000 });
  const l = q.data;
  if (!l) return null;
  const link = can('settings.manage') ? (
    <Link to="/settings/license" className="font-semibold underline">{t('ใส่ License key')}</Link>
  ) : (
    t('กรุณาติดต่อเจ้าของร้าน')
  );
  if (l.state === 'trial' && (l.daysLeft ?? 0) <= 7)
    return (
      <div className="flex-none bg-warn-soft px-4 py-2 text-center text-[13px] text-warn">{tn('ทดลองใช้เหลืออีก {0} วัน · {1}', l.daysLeft, link)}</div>
    );
  if (l.state === 'expired' || l.state === 'invalid')
    return (
      <div className="flex-none bg-danger-soft px-4 py-2 text-center text-[13px] text-danger" role="alert">
        {l.state === 'expired' ? t('สิทธิ์การใช้งานหมดอายุ ไม่สามารถบันทึกการขายได้') : t('License ไม่ถูกต้องสำหรับเครื่องนี้')} · {link}
      </div>
    );
  return null;
}
