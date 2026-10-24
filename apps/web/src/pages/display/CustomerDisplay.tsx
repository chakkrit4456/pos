import { useCallback, useState } from 'react';
import type { CustomerDisplayPayload } from '@flexpos/shared';
import { errorMessage, registerName } from '@/lib/api';
import { useLive } from '@/lib/live';
import { useSession } from '@/lib/session';
import { money, useSettings, useTheme } from '@/lib/settings';
import { qtyText } from '@/lib/utils';
import { PinPad } from '@/components/ui/inputs';
import { QrImage } from '@/components/PrintDocView';

/** Second screen facing the customer: live cart, total, PromptPay QR and change. */
export default function CustomerDisplay() {
  const { user, loginPin } = useSession();
  const [error, setError] = useState<string>();
  const onPin = useCallback(async (pin: string) => {
    try {
      await loginPin(pin);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [loginPin]);
  if (!user) {
    return (
      <div className="grid min-h-full place-items-center bg-rail px-4 text-white">
        <div className="flex w-full max-w-[340px] flex-col items-center gap-4">
          <span className="text-[18px] font-semibold">จอลูกค้า · ใส่ PIN พนักงานเพื่อเชื่อมต่อ</span>
          <PinPad dark onComplete={onPin} error={error} />
        </div>
      </div>
    );
  }
  return <Display />;
}

function Display() {
  const settings = useSettings();
  useTheme(settings);
  const register = new URLSearchParams(location.search).get('register') || registerName();
  const [p, setP] = useState<CustomerDisplayPayload>({ state: 'idle', lines: [], subtotal: 0, discount: 0, total: 0, qr: null, change: 0 });
  useLive((e) => {
    if (e.type === 'display.update' && e.register === register) setP(e.payload);
  });
  const s = settings.store;
  if (p.state === 'idle' || (p.state === 'done' && p.change <= 0)) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-5 bg-canvas p-10 text-center">
        {s.logo ? <img src={s.logo} alt="" className="max-h-[180px] max-w-[320px] object-contain" /> : <div className="grid h-24 w-24 place-items-center rounded-3xl bg-primary text-[42px] font-bold text-primary-fg">{s.name.slice(0, 1)}</div>}
        <h1 className="text-[40px] font-semibold">{s.name}</h1>
        <p className="text-[20px] text-muted">{p.state === 'done' ? 'ขอบคุณที่ใช้บริการ' : 'ยินดีต้อนรับ'}</p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col bg-canvas lg:flex-row">
      <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto p-8">
        <h2 className="mb-4 text-[22px] font-semibold">{s.name}</h2>
        {p.lines.map((l, i) => (
          <div key={i} className="num flex items-baseline gap-4 border-b border-line-soft py-3 text-[22px]">
            <span className="w-14 font-semibold text-muted">{qtyText(l.qty)}×</span>
            <span className="flex-1">{l.name}</span>
            <span className="font-medium">{money(l.total)}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-none flex-col items-center justify-center gap-5 bg-surface p-10 lg:w-[460px]">
        {p.discount > 0 && <div className="num text-[20px] text-primary">ส่วนลด -{money(p.discount)}</div>}
        <div className="text-[20px] text-muted">{p.state === 'done' ? 'เงินทอน' : 'ยอดชำระ'}</div>
        <div className="num text-[64px] font-bold leading-none">{money(p.state === 'done' ? p.change : p.total)}</div>
        {p.qr && (
          <div className="flex flex-col items-center gap-2">
            <QrImage data={p.qr} size={260} className="rounded-xl border border-line p-2" />
            <span className="text-[18px] font-medium">สแกนจ่ายด้วย PromptPay</span>
          </div>
        )}
      </div>
    </div>
  );
}
