import { useState } from 'react';
import { toast } from 'sonner';
import { t } from '@flexpos/shared';
import { Button, Card, Field, Input, PageHeader } from '@/components/ui/core';
import { api, errorMessage } from '~/lib/api';
import { useSession } from '~/lib/session';

export default function Account() {
  const { user, logout } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.put('/api/auth/password', { current, next });
      toast.success(t('เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่'));
      await logout();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title={t('บัญชีของฉัน')} sub={user?.email} />
      <Card title={t('เปลี่ยนรหัสผ่าน')} className="max-w-[480px]">
        <Field label={t('รหัสผ่านปัจจุบัน')}><Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
        <Field label={t('รหัสผ่านใหม่')} hint={t('อย่างน้อย 8 ตัวอักษร')}><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Button variant="primary" className="self-start" loading={busy} disabled={!current || next.length < 8} onClick={() => void save()}>{t('บันทึก')}</Button>
      </Card>
    </>
  );
}
