import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import type { SetupStatus } from '@flexpos/shared';
import { useSession } from '@/lib/session';
import { errorMessage } from '@/lib/api';
import { Button, Field, Input, Segmented } from '@/components/ui/core';
import { PinPad } from '@/components/ui/inputs';
import { BrandMark } from '@/components/BrandMark';

export function LoginPage({ status }: { status: SetupStatus }) {
  const { login, loginPin } = useSession();
  const [mode, setMode] = useState<'pin' | 'password'>('pin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [pinError, setPinError] = useState<string>();

  const onPin = useCallback(
    async (pin: string) => {
      setBusy(true);
      setPinError(undefined);
      try {
        await loginPin(pin);
      } catch (e) {
        setPinError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [loginPin],
  );

  return (
    <div className="grid min-h-full place-items-center bg-rail px-4 py-10 text-rail-fg">
      <div className="flex w-full max-w-[400px] flex-col gap-6">
        <div className="flex items-center gap-3">
          <BrandMark logo={status.brand?.appLogo} name={status.brand?.appName} />
          <div>
            <div className="text-[18px] font-semibold">{status.brand?.loginTitle || status.brand?.storeName || status.brand?.appName || 'FlexPOS'}</div>
            {status.brand?.loginSubtitle && <div className="text-[13px] text-[#c9ccd1]">{status.brand.loginSubtitle}</div>}
            <div className="text-[13px] text-[#a5a8ad]">v{status.version}{status.dbKind ? ` · ${status.dbKind === 'sqlite' ? 'ฐานข้อมูลในเครื่อง' : status.dbKind}` : ''}</div>
          </div>
        </div>
        <Segmented
          value={mode}
          onChange={setMode}
          className="self-start border-[#3a3d42] bg-[#24272b] [&_button[aria-selected=false]]:text-[#a5a8ad] [&_button[aria-selected=false]:hover]:bg-[#3a3d42]"
          options={[
            { value: 'pin', label: 'PIN พนักงาน' },
            { value: 'password', label: 'ชื่อผู้ใช้ / รหัสผ่าน' },
          ]}
        />
        {mode === 'pin' ? (
          <div className="flex flex-col items-center gap-3">
            <span className="text-[20px] font-semibold">ใส่ PIN พนักงาน</span>
            <PinPad dark onComplete={onPin} error={pinError} busy={busy} />
          </div>
        ) : (
          <form
            className="flex flex-col gap-4 rounded-2xl bg-surface p-5 text-ink"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await login(username, password);
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="ชื่อผู้ใช้" htmlFor="u">
              <Input id="u" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
            <Field label="รหัสผ่าน" htmlFor="p">
              <Input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!username || !password}>
              เข้าสู่ระบบ
            </Button>
            <p className="text-[12px] text-muted">ลืมรหัสผ่าน? ให้เจ้าของร้านตั้งรหัสใหม่ที่ ตั้งค่า → พนักงาน</p>
          </form>
        )}
      </div>
    </div>
  );
}
