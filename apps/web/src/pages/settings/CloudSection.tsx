import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CloudOff, ExternalLink, RefreshCw } from 'lucide-react';
import { t } from '@flexpos/shared';
import { api, errorMessage } from '@/lib/api';
import { useFormatters, useSettings } from '@/lib/settings';
import { tn } from '@/lib/i18n';
import { Badge, Button, Card, Spinner } from '@/components/ui/core';
import { useConfirm } from '@/components/ui/dialog';
import { applyCloudDraft, CloudChoice, cloudDraftOk, emptyCloudDraft } from '@/components/CloudChoice';
import { SectionTitle } from './common';

interface CloudStatus {
  mode: 'cloud' | 'self' | 'local' | null;
  url: string | null;
  connected: boolean;
  tenantName: string | null;
  email: string | null;
  pending: number;
  lastPushAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  online: boolean;
  defaultUrl: string;
}

export function CloudSection() {
  const qc = useQueryClient();
  const f = useFormatters();
  const settings = useSettings();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['cloud-status'], queryFn: () => api.get<CloudStatus>('/api/cloud/status'), refetchInterval: 10_000 });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(emptyCloudDraft(settings.store.name));
  const [busy, setBusy] = useState(false);
  const s = q.data;

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      await qc.invalidateQueries({ queryKey: ['cloud-status'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      await applyCloudDraft(draft);
      setEditing(false);
    }, draft.mode === 'local' ? t('ตั้งค่าเป็นเก็บข้อมูลในเครื่องนี้อย่างเดียวแล้ว') : t('เชื่อมต่อแดชบอร์ดออนไลน์แล้ว ข้อมูลกำลังทยอยส่งขึ้นเว็บ'));

  const disconnect = async () => {
    const c = await confirm({ title: t('หยุดส่งข้อมูลขึ้นเว็บ?'), body: t('แดชบอร์ดบนเว็บจะแสดงข้อมูลล่าสุดที่ส่งไปแล้วเท่านั้น ข้อมูลในเครื่องนี้ไม่ถูกลบ'), danger: true, confirmText: t('หยุดส่งข้อมูล') });
    if (!c.ok) return;
    await run(() => api.post('/api/cloud/local'), t('หยุดส่งข้อมูลขึ้นเว็บแล้ว'));
  };

  const webUrl = s?.url ?? s?.defaultUrl;
  return (
    <>
      <SectionTitle title={t('แดชบอร์ดออนไลน์')} sub={t('ดูยอดขายและรายงานของร้านผ่านหน้าเว็บจากที่ไหนก็ได้ เครื่อง POS ยังขายได้แม้ไม่มีอินเทอร์เน็ต')} />
      <Card>
        {!s ? (
          <Spinner />
        ) : s.connected ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={s.lastError ? 'warn' : 'success'}>{s.lastError ? t('ออฟไลน์ รอส่งข้อมูล') : t('เชื่อมต่อแล้ว')}</Badge>
              <span className="font-semibold">{s.tenantName}</span>
              <span className="text-[14px] text-muted">{s.mode === 'cloud' ? 'FlexPOS Cloud' : t('เซิร์ฟเวอร์ของร้าน')}</span>
            </div>
            <dl className="grid gap-3 text-[14px] md:grid-cols-2">
              <Item label={t('เว็บแดชบอร์ด')} value={<a className="inline-flex items-center gap-1 text-primary underline" href={webUrl ?? '#'} target="_blank" rel="noreferrer">{webUrl}<ExternalLink className="h-3.5 w-3.5" /></a>} />
              <Item label={t('บัญชีผู้จัดการ')} value={s.email ?? '-'} />
              <Item label={t('ส่งข้อมูลล่าสุด')} value={s.lastPushAt ? f.dateTime(s.lastPushAt) : s.lastOkAt ? f.dateTime(s.lastOkAt) : '-'} />
              <Item label={t('รายการรอส่ง')} value={tn('{0} รายการ', s.pending)} />
            </dl>
            {s.lastError && <p className="rounded-xl bg-warn-soft px-3 py-2.5 text-[14px] text-warn">{s.lastError}</p>}
            <div className="flex flex-wrap gap-2">
              <Button icon={<RefreshCw className="h-4 w-4" />} loading={busy} onClick={() => run(() => api.post('/api/cloud/sync-now'))}>{t('ส่งข้อมูลตอนนี้')}</Button>
              <Button variant="secondary" onClick={() => setEditing(true)}>{t('เปลี่ยนบัญชีหรือเซิร์ฟเวอร์')}</Button>
              <Button variant="ghost" icon={<CloudOff className="h-4 w-4" />} onClick={disconnect}>{t('หยุดส่งข้อมูลขึ้นเว็บ')}</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Badge tone="neutral" className="self-start">{s.mode === 'local' ? t('เก็บในเครื่องนี้อย่างเดียว') : t('ยังไม่ได้เลือก')}</Badge>
            <p className="text-[14px] text-ink-2">{t('ตอนนี้ดูแดชบอร์ดผ่านหน้าเว็บไม่ได้ เปิดใช้เพื่อให้ผู้จัดการดูยอดขายแบบเรียลไทม์จากมือถือหรือคอมพิวเตอร์เครื่องไหนก็ได้')}</p>
            {s.lastError && <p className="rounded-xl bg-warn-soft px-3 py-2.5 text-[14px] text-warn">{s.lastError}</p>}
            {!editing && <Button variant="primary" className="self-start" onClick={() => setEditing(true)}>{t('เปิดใช้แดชบอร์ดออนไลน์')}</Button>}
          </div>
        )}
      </Card>
      {editing && (
        <Card title={t('ตั้งค่าแดชบอร์ดออนไลน์')}>
          <div className="flex flex-col gap-4">
            <CloudChoice draft={draft} onChange={setDraft} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(false)}>{t('ยกเลิก')}</Button>
              <Button variant="primary" loading={busy} disabled={!cloudDraftOk(draft)} onClick={save}>{draft.mode === 'local' ? t('บันทึก') : t('เชื่อมต่อ')}</Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

function Item({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  );
}
