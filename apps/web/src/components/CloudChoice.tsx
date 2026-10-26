import type { ReactNode } from 'react';
import { AlertTriangle, Check, Cloud, HardDrive, Server } from 'lucide-react';
import { DEFAULT_CLOUD_URL, t } from '@flexpos/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/core';

export type CloudMode = 'cloud' | 'self' | 'local';

export interface CloudDraft {
  mode: CloudMode;
  /** FlexPOS Cloud: key from the vendor (blank = use the license already installed) */
  licenseKey: string;
  /** own server */
  url: string;
  username: string;
  password: string;
  /** local only: the owner confirmed they understand there is no web dashboard */
  localAck: boolean;
}

export const emptyCloudDraft = (): CloudDraft => ({ mode: 'cloud', licenseKey: '', url: '', username: '', password: '', localAck: false });

/** hasLicense: this machine already has an activated license key */
export function cloudDraftOk(d: CloudDraft, hasLicense: boolean): boolean {
  if (d.mode === 'local') return d.localAck;
  if (d.mode === 'cloud') return hasLicense || d.licenseKey.trim().length > 20;
  return /^https?:\/\/\S+/.test(d.url.trim()) && d.username.trim().length >= 3 && d.password.length > 0;
}

/** Apply the choice on the POS server (which pairs with the cloud on our behalf). */
export async function applyCloudDraft(d: CloudDraft) {
  if (d.mode === 'local') return api.post('/api/cloud/local');
  return api.post<{ tenantId: string; tenantName: string }>(
    '/api/cloud/connect',
    d.mode === 'cloud' ? { mode: 'cloud', licenseKey: d.licenseKey.trim() || undefined } : { mode: 'self', url: d.url.trim(), username: d.username.trim(), password: d.password },
  );
}

export function CloudChoice({ draft, onChange, hasLicense }: { draft: CloudDraft; onChange: (d: CloudDraft) => void; hasLicense: boolean }) {
  const set = <K extends keyof CloudDraft>(k: K, v: CloudDraft[K]) => onChange({ ...draft, [k]: v });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Option active={draft.mode === 'cloud'} onClick={() => set('mode', 'cloud')} icon={<Cloud />} title={t('FlexPOS Cloud')} badge={t('แนะนำ')} body={t('ดูยอดขายผ่านเว็บได้ทุกที่ ไม่ต้องมีเซิร์ฟเวอร์เอง ข้อมูลสำรองไว้บนคลาวด์อีกชั้น')} />
        <Option active={draft.mode === 'self'} onClick={() => set('mode', 'self')} icon={<Server />} title={t('เซิร์ฟเวอร์ของร้านเอง')} body={t('ติดตั้ง FlexPOS Cloud บนเซิร์ฟเวอร์ของร้าน ข้อมูลออนไลน์อยู่ในความดูแลของร้านทั้งหมด')} />
        <Option active={draft.mode === 'local'} onClick={() => set('mode', 'local')} icon={<HardDrive />} title={t('เก็บในเครื่องนี้อย่างเดียว')} body={t('ไม่ส่งข้อมูลออกนอกเครื่อง แต่จะดูแดชบอร์ดผ่านเว็บไม่ได้')} />
      </div>

      {draft.mode === 'local' ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-warn-soft p-4 text-[14px]">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-warn" />
            <div className="flex flex-col gap-1">
              <span className="font-semibold">{t('คุณจะดูแดชบอร์ดและรายงานผ่านหน้าเว็บไม่ได้')}</span>
              <span className="text-ink-2">{t('ข้อมูลทั้งหมดอยู่ในเครื่องนี้เท่านั้น ถ้าเครื่องเสียหรือหาย ข้อมูลจะกู้คืนได้จากไฟล์สำรองเท่านั้น เปิดใช้แดชบอร์ดออนไลน์ภายหลังได้ที่ ตั้งค่า → แดชบอร์ดออนไลน์')}</span>
            </div>
          </div>
          <Checkbox checked={draft.localAck} onChange={(v) => set('localAck', v)} label={t('ฉันเข้าใจ และต้องการเก็บข้อมูลในเครื่องนี้อย่างเดียว')} />
        </div>
      ) : draft.mode === 'cloud' ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-sunken p-4">
          <div className="text-[13px] text-muted">
            {t('เข้าดูแดชบอร์ดได้ที่')} <span className="font-mono text-ink">{DEFAULT_CLOUD_URL}</span>
          </div>
          <Field label="License key" required={!hasLicense} hint={hasLicense ? t('เครื่องนี้มี License แล้ว เว้นว่างไว้เพื่อใช้ License เดิม') : t('ร้านจะถูกสร้างบนคลาวด์ครั้งแรกที่ใช้ key นี้ เครื่องต่อไปที่ใช้ key เดียวกันจะเข้าร้านเดิม')}>
            <Textarea className="min-h-[72px] font-mono text-[12px]" value={draft.licenseKey} placeholder={hasLicense ? t('(ใช้ License ที่ติดตั้งแล้ว)') : ''} onChange={(e) => set('licenseKey', e.target.value)} />
          </Field>
          <p className="text-[13px] text-muted">{t('บัญชีผู้จัดการสำหรับเข้าเว็บ ผู้ให้บริการเป็นผู้สร้างให้ เครื่อง POS ยังขายได้ตามปกติแม้อินเทอร์เน็ตหลุด รหัสผ่านและ PIN ของพนักงานไม่ถูกส่งออกจากเครื่อง')}</p>
        </div>
      ) : (
        <div className="grid gap-4 rounded-2xl border border-line bg-sunken p-4 md:grid-cols-2">
          <Field label={t('ที่อยู่เซิร์ฟเวอร์ของร้าน')} required hint={t('เช่น https://dashboard.myshop.com (ดูวิธีติดตั้งในคู่มือ FlexPOS Cloud)')} className="md:col-span-2">
            <Input value={draft.url} placeholder="https://" onChange={(e) => set('url', e.target.value)} />
          </Field>
          <Field label={t('ชื่อผู้ใช้ผู้จัดการ')} required hint={t('บัญชีที่ผู้ดูแลเซิร์ฟเวอร์สร้างให้')}>
            <Input autoComplete="username" value={draft.username} onChange={(e) => set('username', e.target.value)} />
          </Field>
          <Field label={t('รหัสผ่าน')} required>
            <Input type="password" autoComplete="current-password" value={draft.password} onChange={(e) => set('password', e.target.value)} />
          </Field>
        </div>
      )}
    </div>
  );
}

function Option({ active, onClick, title, body, icon, badge }: { active: boolean; onClick: () => void; title: string; body: string; icon: ReactNode; badge?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn('flex min-h-[88px] flex-col gap-1.5 rounded-2xl border p-4 text-left transition-colors', active ? 'border-primary bg-soft ring-1 ring-primary' : 'border-line bg-surface hover:border-line-strong hover:bg-sunken')}>
      <span className="flex items-center gap-2.5 text-[16px] font-semibold [&_svg]:h-5 [&_svg]:w-5 [&_svg]:text-primary">
        {icon}
        {title}
        {badge && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-fg">{badge}</span>}
        {active && <Check className="ml-auto h-5 w-5 text-primary" />}
      </span>
      <span className="text-[13px] text-muted [text-wrap:pretty]">{body}</span>
    </button>
  );
}
