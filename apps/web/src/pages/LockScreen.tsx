import { useCallback, useState } from 'react';
import { useSession } from '@/lib/session';
import { errorMessage } from '@/lib/api';
import { PinPad } from '@/components/ui/inputs';
import { Button } from '@/components/ui/core';
import { BrandMark } from '@/components/BrandMark';
import { useBrand } from '@/lib/settings';
import { t } from '@flexpos/shared';
import { tn } from '@/lib/i18n';

/** Full-screen PIN overlay: quick staff switch and idle lock. */
export function LockScreen() {
  const { loginPin, user, logout } = useSession();
  const brand = useBrand();
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
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-rail/95 px-4 text-white backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('ล็อกหน้าจอ')}>
      <div className="flex w-full max-w-[360px] flex-col items-center gap-4">
        <BrandMark logo={brand.logo} name={brand.appName} className="h-12 w-12" />
        <div className="text-center">
          <div className="text-[20px] font-semibold">{t('หน้าจอถูกล็อก')}</div>
          <div className="text-[13px] text-[#a5a8ad]">{tn('ใส่ PIN เพื่อเข้าใช้งาน{0}', user ? t(' (ล่าสุด: {0})', user.name) : '')}</div>
        </div>
        <PinPad dark onComplete={onPin} error={error} busy={busy} />
        <Button variant="ghost" className="text-[#a5a8ad] hover:bg-[#24272b]" onClick={() => void logout()}>{t('ออกจากระบบ')}</Button>
      </div>
    </div>
  );
}
