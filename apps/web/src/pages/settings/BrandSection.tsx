import { ImagePlus, LayoutGrid, Package, ShoppingCart, Users } from 'lucide-react';
import { useSettings } from '@/lib/settings';
import { cn, imageToDataUrl } from '@/lib/utils';
import { Card, Field, Input, Select, ToggleRow } from '@/components/ui/core';
import { BrandMark } from '@/components/BrandMark';
import { SaveBar, SectionTitle, useDraft } from './common';
import { t } from '@flexpos/shared';

const PRESETS: { name: string; primary: string; accent: string; sidebar: string }[] = [
  { name: t('เขียวใบชา'), primary: '#1d7a57', accent: '#2f9e74', sidebar: '#17191c' },
  { name: t('น้ำเงิน'), primary: '#1967b2', accent: '#3b8ae6', sidebar: '#0f1b2d' },
  { name: t('ม่วง'), primary: '#6d3fc0', accent: '#9a6cf0', sidebar: '#1d1533' },
  { name: t('ส้มอิฐ'), primary: '#c2410c', accent: '#f97316', sidebar: '#241612' },
  { name: t('แดง'), primary: '#b3261e', accent: '#e5484d', sidebar: '#230f0f' },
  { name: t('เขียวมิ้นต์'), primary: '#0f766e', accent: '#14b8a6', sidebar: '#0d1f1d' },
  { name: t('ทอง'), primary: '#a16207', accent: '#eab308', sidebar: '#1f1a0e' },
  { name: t('สว่าง'), primary: '#1d7a57', accent: '#2f9e74', sidebar: '#f6f5f1' },
];

function ColorField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-14 flex-none cursor-pointer rounded-lg border border-line-strong bg-surface" aria-label={label} />
        <Input value={value} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && onChange(e.target.value)} className="font-mono uppercase" maxLength={7} />
      </div>
    </Field>
  );
}

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

/** Live mock of the sidebar, a button and the login card using the draft colors. */
function Preview({ appName, logo, primary, accent, sidebar, loginTitle, loginSubtitle, storeName }: { appName: string; logo: string; primary: string; accent: string; sidebar: string; loginTitle: string; loginSubtitle: string; storeName: string }) {
  const light = lum(sidebar) > 0.6;
  const fg = light ? '#17191c' : '#ffffff';
  const muted = light ? '#5f6368' : '#b4b7bc';
  const btnFg = lum(primary) > 0.62 ? '#17191c' : '#ffffff';
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[12px] font-medium text-muted">{t('ตัวอย่างหน้าจอ (อัปเดตทันทีที่แก้)')}</span>
      <div className="flex h-[260px] overflow-hidden rounded-2xl border border-line shadow-lift">
        <div className="flex w-[150px] flex-none flex-col gap-1 p-2.5" style={{ background: sidebar, color: fg }}>
          <div className="mb-2 flex items-center gap-2">
            {logo ? <img src={logo} alt="" className="h-7 w-7 rounded-lg bg-white object-contain" /> : <span className="grid h-7 w-7 place-items-center rounded-lg text-[12px] font-bold text-white" style={{ background: accent }}>{(appName || 'F').slice(0, 1)}</span>}
            <span className="flex min-w-0 flex-col leading-tight"><span className="truncate text-[11px] font-semibold">{storeName || appName}</span><span className="truncate text-[9px]" style={{ color: muted }}>{appName}</span></span>
          </div>
          {[{ i: <ShoppingCart />, t: t('หน้าขาย'), on: true }, { i: <LayoutGrid />, t: t('โต๊ะ') }, { i: <Package />, t: t('สินค้า') }, { i: <Users />, t: t('สมาชิก') }].map((x) => (
            <div key={x.t} className="relative flex h-7 items-center gap-2 rounded-md px-2 text-[10px] [&_svg]:h-3 [&_svg]:w-3" style={{ background: x.on ? (light ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.1)') : undefined, color: x.on ? fg : muted }}>
              {x.on && <span className="absolute left-0 top-1.5 h-4 w-[2px] rounded-r" style={{ background: accent }} />}
              <span style={{ color: x.on ? accent : undefined }}>{x.i}</span>
              {x.t}
            </div>
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-2 bg-canvas p-3">
          <div className="text-[12px] font-semibold">{t('ภาพรวม')}</div>
          <div className="rounded-lg bg-surface p-2 shadow-card">
            <div className="text-[9px] text-muted">{t('ยอดขายวันนี้')}</div>
            <div className="text-[14px] font-semibold">{t('฿12,450')}</div>
            <div className="mt-1 h-1.5 w-2/3 rounded-full" style={{ background: accent }} />
          </div>
          <div className="mt-auto flex h-8 items-center justify-center rounded-lg text-[11px] font-semibold" style={{ background: primary, color: btnFg }}>{t('ชำระเงิน ฿185.00')}</div>
        </div>
      </div>
      <div className="flex items-center gap-2.5 rounded-2xl p-3" style={{ background: sidebar, color: fg }}>
        {logo ? <img src={logo} alt="" className="h-9 w-9 rounded-lg bg-white object-contain" /> : <span className="grid h-9 w-9 place-items-center rounded-lg font-bold text-white" style={{ background: accent }}>{(appName || 'F').slice(0, 1)}</span>}
        <span className="flex flex-col leading-tight">
          <span className="text-[13px] font-semibold">{loginTitle || storeName || appName}</span>
          <span className="text-[11px]" style={{ color: muted }}>{loginSubtitle || t('หน้าเข้าสู่ระบบ')}</span>
        </span>
      </div>
    </div>
  );
}

export function BrandSection() {
  const settings = useSettings();
  const brand = useDraft('brand');
  const locale = useDraft('locale');
  const b = brand.draft;
  const dirty = brand.dirty || locale.dirty;
  const logo = b.appLogo || settings.store.logo;
  return (
    <>
      <SectionTitle title={t('หน้าตาและภาษา')} sub={t('ปรับชื่อแอป โลโก้ สี และข้อความให้เป็นแบรนด์ของร้าน มีผลกับทุกเครื่องทันทีหลังบันทึก')} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={t('ชื่อและโลโก้')}>
            <div className="flex flex-col gap-4 sm:flex-row">
              <label className="flex h-[112px] w-[112px] flex-none cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border border-dashed border-line-strong bg-sunken text-[12px] text-muted hover:border-primary">
                {b.appLogo ? <img src={b.appLogo} alt={t('โลโก้แอป')} className="h-full w-full object-contain p-1" /> : <><ImagePlus className="h-6 w-6" />{t('อัปโหลดโลโก้')}</>}
                <input type="file" accept="image/*" className="sr-only" onChange={async (e) => e.target.files?.[0] && brand.set('appLogo', await imageToDataUrl(e.target.files[0], 512))} />
              </label>
              <div className="flex flex-1 flex-col gap-3">
                <Field label={t('ชื่อแอป')} hint={t('แสดงที่แถบเมนู แท็บเบราว์เซอร์ หน้าเข้าสู่ระบบ และแอปพนักงาน')}>
                  <Input value={b.appName} maxLength={40} onChange={(e) => brand.set('appName', e.target.value)} placeholder="FlexPOS" />
                </Field>
                <div className="flex flex-wrap gap-2 text-[13px]">
                  {b.appLogo && <button className="text-danger underline" onClick={() => brand.set('appLogo', '')}>{t('ลบโลโก้แอป')}</button>}
                  {!b.appLogo && settings.store.logo && <span className="flex items-center gap-2 text-muted"><BrandMark logo={settings.store.logo} className="h-6 w-6 rounded-md" />{t('ตอนนี้ใช้โลโก้ร้าน (ตั้งค่า → ข้อมูลร้าน)')}</span>}
                </div>
              </div>
            </div>
          </Card>

          <Card title={t('สี')}>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2">
              {PRESETS.map((p) => {
                const on = p.primary === b.primary && p.accent === b.accent && p.sidebar === b.sidebar;
                return (
                  <button key={p.name} onClick={() => brand.setDraft({ ...b, primary: p.primary, accent: p.accent, sidebar: p.sidebar })} aria-pressed={on} className={cn('flex items-center gap-2.5 rounded-xl border p-2.5 text-left text-[13px]', on ? 'border-primary ring-1 ring-primary' : 'border-line hover:bg-sunken')}>
                    <span className="flex flex-none overflow-hidden rounded-md border border-line">
                      <span className="h-7 w-3" style={{ background: p.sidebar }} />
                      <span className="h-7 w-3" style={{ background: p.primary }} />
                      <span className="h-7 w-3" style={{ background: p.accent }} />
                    </span>
                    {p.name}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <ColorField label={t('สีหลัก')} hint={t('ปุ่มสำคัญ เช่น ชำระเงิน')} value={b.primary} onChange={(v) => v.length === 7 && brand.set('primary', v)} />
              <ColorField label={t('สีเน้น')} hint={t('ไฮไลต์ เมนูที่เลือก กราฟ')} value={b.accent} onChange={(v) => v.length === 7 && brand.set('accent', v)} />
              <ColorField label={t('สีแถบเมนู')} hint={t('เข้มหรืออ่อนก็ได้ ตัวอักษรปรับให้อ่านง่ายเอง')} value={b.sidebar} onChange={(v) => v.length === 7 && brand.set('sidebar', v)} />
            </div>
            <Field label={t('ธีมพื้นหลัง')}>
              <Select value={b.theme} onChange={(e) => brand.set('theme', e.target.value as typeof b.theme)}>
                <option value="light">{t('สว่าง')}</option>
                <option value="dark">{t('มืด')}</option>
                <option value="system">{t('ตามเครื่อง')}</option>
              </Select>
            </Field>
          </Card>

          <Card title={t('หน้าเข้าสู่ระบบ')}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t('หัวข้อ')} hint={t('เว้นว่าง = ชื่อร้าน')}><Input value={b.loginTitle} maxLength={80} onChange={(e) => brand.set('loginTitle', e.target.value)} placeholder={settings.store.name} /></Field>
              <Field label={t('ข้อความรอง')}><Input value={b.loginSubtitle} maxLength={160} onChange={(e) => brand.set('loginSubtitle', e.target.value)} placeholder={t('เช่น ยินดีต้อนรับทีมงาน')} /></Field>
            </div>
            <div className="-my-2 flex flex-col">
              <ToggleRow label={t('แสดง “ระบบโดย {0}” ท้ายใบเสร็จ', b.appName || 'FlexPOS')} checked={b.poweredBy} onChange={(v) => brand.set('poweredBy', v)} />
            </div>
          </Card>

          <Card title={t('ภาษาและรูปแบบ')}>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label={t('ภาษา')}><Select value={locale.draft.language} onChange={(e) => locale.set('language', e.target.value as 'th' | 'en')}><option value="th">{t('ไทย')}</option><option value="en">English</option></Select></Field>
              <Field label={t('ปีในเอกสาร')}><Select value={locale.draft.era} onChange={(e) => locale.set('era', e.target.value as 'BE' | 'CE')}><option value="BE">{t('พ.ศ.')}</option><option value="CE">{t('ค.ศ.')}</option></Select></Field>
              <Field label={t('สัญลักษณ์เงิน')}><Input value={locale.draft.currencySymbol} onChange={(e) => locale.set('currencySymbol', e.target.value.slice(0, 4))} /></Field>
            </div>
          </Card>
        </div>
        <div className="xl:sticky xl:top-4">
          <Preview appName={b.appName || 'FlexPOS'} logo={logo} primary={b.primary} accent={b.accent} sidebar={b.sidebar} loginTitle={b.loginTitle} loginSubtitle={b.loginSubtitle} storeName={settings.store.name} />
        </div>
      </div>
      <SaveBar dirty={dirty} saving={brand.saving || locale.saving} onSave={() => void brand.save({ locale: locale.draft })} onReset={() => (brand.reset(), locale.reset())} />
    </>
  );
}
