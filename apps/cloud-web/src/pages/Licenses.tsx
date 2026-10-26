import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, KeyRound, Plus } from 'lucide-react';
import { t } from '@flexpos/shared';
import { Badge, Button, Card, EmptyState, Field, Input, SkeletonRows, Switch, Textarea } from '@/components/ui/core';
import { Dialog } from '@/components/ui/dialog';
import { NumberInput } from '@/components/ui/inputs';
import { tn } from '@/lib/i18n';
import { api, errorMessage } from '~/lib/api';
import { dateTime } from '~/lib/format';

interface LicenseRow {
  id: string;
  key: string;
  licensee: string;
  plan: string;
  maxDevices: number;
  maxBranches: number;
  note: string;
  revoked: boolean;
  createdAt: string;
  tenantId: string | null;
  tenantName: string | null;
  devicesUsed: number;
}

type Draft = { id?: string; licensee: string; plan: string; maxDevices: number; maxBranches: number; note: string; revoked: boolean };

const copy = async (key: string) => {
  try {
    await navigator.clipboard.writeText(key);
    toast.success(t('คัดลอก License key แล้ว ส่งให้ลูกค้าใส่ตอนเชื่อมต่อ FlexPOS Cloud'));
  } catch {
    toast.error(t('คัดลอกไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกเอง'));
  }
};

/** Superadmin: issue license keys, set and change the number of POS machines per store. */
export function LicensesAdmin() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'licenses'], queryFn: () => api.get<{ enabled: boolean; licenses: LicenseRow[] }>('/api/admin/licenses') });
  const [edit, setEdit] = useState<Draft | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      if (edit.id) {
        await api.patch(`/api/admin/licenses/${edit.id}`, { licensee: edit.licensee, plan: edit.plan, maxDevices: edit.maxDevices, maxBranches: edit.maxBranches, note: edit.note, revoked: edit.revoked });
        toast.success(t('บันทึกแล้ว เครื่อง POS ของร้านจะได้รับ License ใหม่อัตโนมัติเมื่อออนไลน์'));
      } else {
        const r = await api.post<{ key: string }>('/api/admin/licenses', { licensee: edit.licensee, plan: edit.plan, maxDevices: edit.maxDevices, maxBranches: edit.maxBranches, note: edit.note });
        setIssued(r.key);
      }
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['admin'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (q.data && !q.data.enabled) {
    return <EmptyState icon={<KeyRound />} title={t('เซิร์ฟเวอร์นี้ไม่ได้เปิดการออก License')} body={t('ตั้งค่า LICENSE_PRIVATE_KEY_FILE ใน /etc/flexpos-cloud.env แล้วรีสตาร์ต เครื่อง POS จะเชื่อมต่อด้วยบัญชีผู้จัดการแทน')} />;
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-muted">{t('1 License = 1 ร้าน ร้านถูกสร้างครั้งแรกที่เครื่อง POS เชื่อมต่อด้วย key นี้ เครื่องถัดไปที่ใช้ key เดียวกันจะเข้าร้านเดิมได้ไม่เกินจำนวนเครื่องที่กำหนด License ไม่มีวันหมดอายุ')}</p>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ licensee: '', plan: 'standard', maxDevices: 1, maxBranches: 1, note: '', revoked: false })}>{t('ออก License ใหม่')}</Button>
      </div>
      <Card pad={false}>
        {!q.data ? (
          <div className="p-5"><SkeletonRows /></div>
        ) : !q.data.licenses.length ? (
          <p className="px-5 py-8 text-center text-muted">{t('ยังไม่มี License')}</p>
        ) : (
          q.data.licenses.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3 last:border-0">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{l.licensee}</span>
                <span className="truncate text-[13px] text-muted">
                  {l.tenantId ? <Link to={`/s/${l.tenantId}`} className="underline">{l.tenantName}</Link> : t('ยังไม่ได้เชื่อมต่อ (ร้านจะถูกสร้างเมื่อเครื่องแรกเชื่อมต่อ)')} · {t('ออกเมื่อ {0}', dateTime(l.createdAt))}
                </span>
              </div>
              <Badge tone={l.devicesUsed >= l.maxDevices ? 'warn' : 'neutral'}>{tn('เครื่อง {0}/{1}', l.devicesUsed, l.maxDevices)}</Badge>
              {l.revoked && <Badge tone="danger">{t('ยกเลิกแล้ว')}</Badge>}
              <Button size="sm" icon={<Copy className="h-4 w-4" />} onClick={() => void copy(l.key)}>{t('คัดลอก key')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit({ id: l.id, licensee: l.licensee, plan: l.plan, maxDevices: l.maxDevices, maxBranches: l.maxBranches, note: l.note, revoked: l.revoked })}>{t('แก้ไข')}</Button>
            </div>
          ))
        )}
      </Card>

      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} title={edit?.id ? t('แก้ไข License') : t('ออก License ใหม่')} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>{t('ยกเลิก')}</Button><Button variant="primary" loading={busy} disabled={!edit?.licensee.trim()} onClick={() => void save()}>{edit?.id ? t('บันทึก') : t('ออก License')}</Button></>}>
        {edit && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t('ชื่อร้าน / ผู้ได้รับสิทธิ์')} required className="md:col-span-2"><Input value={edit.licensee} onChange={(e) => setEdit({ ...edit, licensee: e.target.value })} /></Field>
            <Field label={t('จำนวนเครื่อง POS')} hint={t('เพิ่มหรือลดภายหลังได้')}><NumberInput value={edit.maxDevices} onValue={(v) => setEdit({ ...edit, maxDevices: Math.max(1, Math.round(v)) })} /></Field>
            <Field label={t('จำนวนสาขา')}><NumberInput value={edit.maxBranches} onValue={(v) => setEdit({ ...edit, maxBranches: Math.max(1, Math.round(v)) })} /></Field>
            <Field label={t('แพ็กเกจ')}><Input value={edit.plan} onChange={(e) => setEdit({ ...edit, plan: e.target.value })} /></Field>
            {edit.id && <label className="flex items-center justify-between self-end rounded-xl border border-line px-3 py-2.5 text-[14px]">{t('ยกเลิก License นี้')}<Switch checked={edit.revoked} onChange={(v) => setEdit({ ...edit, revoked: v })} label={t('ยกเลิก')} /></label>}
            <Field label={t('บันทึกภายใน')} className="md:col-span-2"><Textarea value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Field>
          </div>
        )}
      </Dialog>

      <Dialog open={!!issued} onOpenChange={(v) => !v && setIssued(null)} title={t('ออก License แล้ว')} description={t('ส่ง key นี้ให้ลูกค้า ใส่ที่ ตั้งค่า → แดชบอร์ดออนไลน์ → FlexPOS Cloud (หรือตอนตั้งค่าร้าน)')} footer={<><Button variant="ghost" onClick={() => setIssued(null)}>{t('ปิด')}</Button><Button variant="primary" icon={<Copy className="h-4 w-4" />} onClick={() => issued && void copy(issued)}>{t('คัดลอก key')}</Button></>}>
        <Textarea readOnly className="min-h-[120px] font-mono text-[12px]" value={issued ?? ''} onFocus={(e) => e.target.select()} />
      </Dialog>
    </>
  );
}
