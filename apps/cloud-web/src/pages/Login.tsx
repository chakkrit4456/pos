import { useState } from 'react';
import { Cloud } from 'lucide-react';
import { getLanguage, t } from '@flexpos/shared';
import { Button, Field, Input } from '@/components/ui/core';
import { switchLanguage } from '@/lib/i18n';
import { errorMessage } from '~/lib/api';
import { useSession } from '~/lib/session';

export default function Login() {
  const { login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid min-h-full place-items-center bg-canvas px-4 py-10">
      <form onSubmit={(e) => void submit(e)} className="card flex w-full max-w-[400px] flex-col gap-5 p-6 md:p-8">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-white"><Cloud className="h-5 w-5" /></span>
          <div>
            <h1 className="text-[22px] font-semibold">FlexPOS Cloud</h1>
            <p className="text-[14px] text-muted">{t('แดชบอร์ดร้านค้าออนไลน์')}</p>
          </div>
        </div>
        <Field label={t('อีเมล')}><Input type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={t('รหัสผ่าน')}><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <p className="rounded-xl bg-danger-soft px-3 py-2.5 text-[14px] text-danger" role="alert">{error}</p>}
        <Button type="submit" variant="primary" size="lg" loading={busy}>{t('เข้าสู่ระบบ')}</Button>
        <p className="text-[13px] text-muted">{t('ใช้อีเมลและรหัสผ่านที่ตั้งตอนเชื่อมต่อเครื่อง POS กับแดชบอร์ดออนไลน์ หรือบัญชีที่ผู้จัดการร้านเพิ่มให้')}</p>
        <button type="button" className="self-center text-[13px] text-muted underline" onClick={() => switchLanguage(getLanguage() === 'th' ? 'en' : 'th')}>{getLanguage() === 'th' ? 'English' : 'ภาษาไทย'}</button>
      </form>
    </div>
  );
}
