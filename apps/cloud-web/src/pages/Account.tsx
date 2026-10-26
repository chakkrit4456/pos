import { useState } from 'react';
import { toast } from 'sonner';
import { t } from '@flexpos/shared';
import { Button, Card, Field, Input, PageHeader } from '@/components/ui/core';
import { api, errorMessage, type User } from '~/lib/api';
import { useSession } from '~/lib/session';

/** Every account can change its own username and password. */
export default function Account() {
  const { user, logout, setUser } = useSession();
  const [username, setUsername] = useState(user?.username ?? '');
  const [confirmPw, setConfirmPw] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState<'name' | 'pw' | null>(null);

  const saveName = async () => {
    setBusy('name');
    try {
      setUser(await api.put<User>('/api/auth/username', { username, password: confirmPw }));
      setConfirmPw('');
      toast.success(t('เปลี่ยนชื่อผู้ใช้แล้ว ใช้ชื่อใหม่ในการเข้าสู่ระบบครั้งต่อไป'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const savePw = async () => {
    setBusy('pw');
    try {
      await api.put('/api/auth/password', { current, next });
      toast.success(t('เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่'));
      await logout();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <PageHeader title={t('บัญชีของฉัน')} sub={user?.name} />
      <div className="grid max-w-[980px] gap-4 md:grid-cols-2">
        <Card title={t('เปลี่ยนชื่อผู้ใช้')}>
          <Field label={t('ชื่อผู้ใช้ใหม่')}><Input autoCapitalize="none" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
          <Field label={t('ยืนยันด้วยรหัสผ่านปัจจุบัน')}><Input type="password" autoComplete="current-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} /></Field>
          <Button variant="primary" className="self-start" loading={busy === 'name'} disabled={username.trim().length < 3 || username.trim() === user?.username || !confirmPw} onClick={() => void saveName()}>{t('บันทึก')}</Button>
        </Card>
        <Card title={t('เปลี่ยนรหัสผ่าน')}>
          <Field label={t('รหัสผ่านปัจจุบัน')}><Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
          <Field label={t('รหัสผ่านใหม่')} hint={t('อย่างน้อย 8 ตัวอักษร')}><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          <Button variant="primary" className="self-start" loading={busy === 'pw'} disabled={!current || next.length < 8} onClick={() => void savePw()}>{t('บันทึก')}</Button>
        </Card>
      </div>
    </>
  );
}
