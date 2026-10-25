import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MonitorSmartphone, Printer } from 'lucide-react';
import { bankInfo, type PrintDoc } from '@flexpos/shared';
import { api, errorMessage, registerName } from '@/lib/api';
import { sendLive } from '@/lib/live';
import { printInBrowser } from '@/lib/print';
import { money, useSettings } from '@/lib/settings';
import { Button, ErrorState, Field, Select, Spinner } from './ui/core';
import { Dialog } from './ui/dialog';
import { PrintDocView } from './PrintDocView';

/** Check-bill slip for a table with an exact-amount PromptPay QR; print it or show it on the customer display. */
export function BillSlipDialog({ orderId, customerId, onClose }: { orderId: string; customerId?: string | null; onClose: () => void }) {
  const settings = useSettings();
  const qc = useQueryClient();
  const pp = settings.payments.accounts.filter((a) => a.promptPayId);
  const [accountId, setAccountId] = useState<string>((pp.find((a) => a.isDefault) ?? pp[0])?.id ?? '');
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['bill', orderId, customerId, accountId],
    queryFn: () => api.get<{ doc: PrintDoc; total: number; qr: string | null }>(`/api/orders/${orderId}/bill`, { customerId: customerId ?? undefined, accountId: accountId || undefined }),
  });
  const print = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ doc: PrintDoc; printed: boolean }>(`/api/orders/${orderId}/bill/print`, { customerId: customerId ?? null, accountId: accountId || null });
      if (!r.printed) await printInBrowser(r.doc);
      toast.success(r.printed ? 'ส่งพิมพ์ใบแจ้งยอดแล้ว' : 'เปิดหน้าต่างพิมพ์แล้ว');
      qc.invalidateQueries({ queryKey: ['floor'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const showOnDisplay = () => {
    if (!q.data) return;
    sendLive({ type: 'display.update', register: registerName(), payload: { state: 'pay', lines: [], subtotal: q.data.total, discount: 0, total: q.data.total, qr: q.data.qr, change: 0 } });
    toast.success('แสดง QR บนจอลูกค้าแล้ว');
  };
  const noAccount = !pp.length && !settings.store.promptPayId;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="ใบแจ้งยอด + QR PromptPay"
      description={q.data ? `ยอดชำระ ${money(q.data.total)} · QR ระบุยอดแล้ว ลูกค้าสแกนจ่ายได้ทันที` : undefined}
      size="md"
      footer={
        <>
          {settings.modules.customerDisplay && q.data?.qr && (
            <Button className="mr-auto" icon={<MonitorSmartphone className="h-4 w-4" />} onClick={showOnDisplay}>
              แสดงบนจอลูกค้า
            </Button>
          )}
          <Button onClick={onClose}>ปิด</Button>
          <Button variant="primary" icon={<Printer className="h-4 w-4" />} loading={busy} disabled={!q.data} onClick={() => void print()}>
            พิมพ์ใบแจ้งยอด
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4 pb-3">
        {noAccount && <p className="w-full rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] text-warn">ยังไม่ได้ตั้งค่าบัญชีรับเงิน ใบแจ้งยอดจะไม่มี QR — เพิ่มได้ที่ ตั้งค่า → บัญชีรับเงิน</p>}
        {pp.length > 1 && (
          <Field label="รับเงินเข้าบัญชี" className="w-full">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {pp.map((a) => <option key={a.id} value={a.id}>{a.accountName} · {bankInfo(a.bankCode).name}</option>)}
            </Select>
          </Field>
        )}
        {q.isLoading ? <Spinner className="my-10" /> : q.isError ? <ErrorState error={q.error} /> : q.data && <PrintDocView doc={q.data.doc} />}
      </div>
    </Dialog>
  );
}
