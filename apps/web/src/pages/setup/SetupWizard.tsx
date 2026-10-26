import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Database, HardDrive, ImagePlus, Network, Search, Server } from 'lucide-react';
import { BUSINESS_TYPE_LABELS, BUSINESS_TYPES, isValidThaiTaxId, type AuthResponse, type BusinessType, type SetupStatus, t, getLanguage } from '@flexpos/shared';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn, imageToDataUrl } from '@/lib/utils';
import { Button, Field, Input, Switch, Textarea } from '@/components/ui/core';
import { NumberInput } from '@/components/ui/inputs';
import { switchLanguage, tn } from '@/lib/i18n';
import { applyCloudDraft, CloudChoice, cloudDraftOk, emptyCloudDraft } from '@/components/CloudChoice';

type DbMode = 'sqlite' | 'external' | 'lan';
const STEPS = [t('ภาษา'), t('ฐานข้อมูล'), t('ข้อมูลร้าน'), t('ประเภทธุรกิจ'), t('ภาษี'), t('บัญชีเจ้าของ'), t('แดชบอร์ดออนไลน์'), t('ข้อมูลเริ่มต้น')];

export default function SetupWizard({ status }: { status: SetupStatus }) {
  const qc = useQueryClient();
  const { accept } = useSession();
  const [step, setStep] = useState(status.configured ? 2 : 0);
  const [busy, setBusy] = useState(false);
  const [language, setLanguage] = useState<'th' | 'en'>(getLanguage());
  const [dbMode, setDbMode] = useState<DbMode>('sqlite');
  const [ext, setExt] = useState({ kind: 'postgres' as 'postgres' | 'mysql', host: 'localhost', port: 5432, user: '', password: '', database: 'flexpos', ssl: false });
  const [tested, setTested] = useState<string | null>(null);
  const [hostUrl, setHostUrl] = useState('');
  const [hosts, setHosts] = useState<{ name: string; url: string }[] | null>(null);
  const [store, setStore] = useState({ name: '', branchName: t('สำนักงานใหญ่'), address: '', taxId: '', phone: '', logo: '', promptPayId: '' });
  const [type, setType] = useState<BusinessType>('retail');
  const [tax, setTax] = useState({ vatEnabled: false, vatRate: 7, pricesIncludeVat: true, serviceChargeRate: 0 });
  const [owner, setOwner] = useState({ name: '', username: 'owner', password: '', password2: '', pin: '' });
  const [sampleData, setSampleData] = useState(true);
  const [cloud, setCloud] = useState(emptyCloudDraft());
  const hasLicense = status.license.state === 'active';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const testDb = () =>
    run(async () => {
      const r = await api.post<{ version: string }>('/api/setup/test-db', ext);
      setTested(r.version);
      toast.success(t('เชื่อมต่อฐานข้อมูลสำเร็จ'));
    });

  const saveDb = () =>
    run(async () => {
      if (dbMode === 'lan') {
        const r = await api.post<{ hostUrl: string }>('/api/setup/client', { hostUrl });
        toast.success(t('เชื่อมต่อเครื่อง Host แล้ว กำลังเปิดหน้าขายของเครื่อง Host'));
        window.location.href = r.hostUrl;
        return;
      }
      const r = await api.post<{ hasOwner: boolean }>('/api/setup/db', dbMode === 'sqlite' ? { kind: 'sqlite' } : ext);
      if (r.hasOwner) {
        toast.success(t('พบข้อมูลร้านเดิมในฐานข้อมูลนี้ กรุณาเข้าสู่ระบบ'));
        await qc.invalidateQueries({ queryKey: ['setup-status'] });
        return;
      }
      void qc.invalidateQueries({ queryKey: ['setup-status'] });
      setStep(2);
    });

  const discover = () =>
    run(async () => {
      setHosts(null);
      const r = await api.get<{ hosts: { name: string; url: string }[] }>('/api/setup/discover');
      setHosts(r.hosts);
      if (r.hosts[0]) setHostUrl(r.hosts[0].url);
    });

  const finish = () =>
    run(async () => {
      const r = await api.post<AuthResponse>('/api/setup/complete', {
        language,
        store,
        businessType: type,
        tax,
        owner: { name: owner.name, username: owner.username, password: owner.password, pin: owner.pin },
        sampleData,
      });
      accept(r);
      try {
        await applyCloudDraft(cloud);
        if (cloud.mode !== 'local') toast.success(t('เชื่อมต่อแดชบอร์ดออนไลน์แล้ว ข้อมูลกำลังทยอยส่งขึ้นเว็บ'));
      } catch (e) {
        toast.error(t('ตั้งค่าร้านเสร็จแล้ว แต่เชื่อมต่อแดชบอร์ดออนไลน์ไม่สำเร็จ: {0} ลองใหม่ได้ที่ ตั้งค่า → แดชบอร์ดออนไลน์', errorMessage(e)), { duration: 12000 });
      }
      await qc.invalidateQueries({ queryKey: ['setup-status'] });
      toast.success(t('ตั้งค่าร้านเรียบร้อย พร้อมขายแล้ว'));
    });

  const storeOk = store.name.trim().length > 0 && (!store.taxId || isValidThaiTaxId(store.taxId));
  const ownerErrors = {
    username: !/^[a-zA-Z0-9._-]{3,50}$/.test(owner.username) ? t('อย่างน้อย 3 ตัว (a-z 0-9 . _ -)') : undefined,
    password: owner.password && owner.password.length < 8 ? t('อย่างน้อย 8 ตัวอักษร') : undefined,
    password2: owner.password2 && owner.password !== owner.password2 ? t('รหัสผ่านไม่ตรงกัน') : undefined,
    pin: owner.pin && !/^\d{4,6}$/.test(owner.pin) ? t('ตัวเลข 4-6 หลัก') : undefined,
  };
  const ownerOk = owner.name.trim() && owner.password.length >= 8 && owner.password === owner.password2 && /^\d{4,6}$/.test(owner.pin) && !ownerErrors.username;

  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(status.configured ? 2 : 0, s - 1));

  return (
    <div className="min-h-full bg-canvas px-4 py-8 md:py-12">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-[18px] font-bold text-white">F</div>
          <div>
            <div className="text-[13px] text-muted">{tn('ตัวช่วยตั้งค่าร้าน · ขั้นตอน {0} จาก {1}', step + 1, STEPS.length)}</div>
            <h1 className="text-[24px] font-semibold">{t('ยินดีต้อนรับสู่ FlexPOS')}</h1>
          </div>
        </div>
        <ol className="flex gap-1.5" aria-label={t('ขั้นตอน')}>
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 flex-col gap-1.5">
              <span className={cn('h-1.5 rounded-full', i <= step ? 'bg-primary' : 'bg-line')} />
              <span className={cn('hidden text-[12px] md:block', i === step ? 'font-semibold text-ink' : 'text-faint')}>{s}</span>
            </li>
          ))}
        </ol>

        <div className="card flex flex-col gap-5 p-5 md:p-7">
          {step === 0 && (
            <StepBody title={t('เลือกภาษา')} sub={t('เปลี่ยนภายหลังได้ที่หน้าตั้งค่า')}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Choice active={language === 'th'} onClick={() => (setLanguage('th'), switchLanguage('th'))} title={t('ภาษาไทย')} body={t('แนะนำสำหรับร้านในประเทศไทย')} />
                <Choice active={language === 'en'} onClick={() => (setLanguage('en'), switchLanguage('en'))} title="English" body="Receipts and menus can still be in Thai" />
              </div>
            </StepBody>
          )}

          {step === 1 && (
            <StepBody title={t('เก็บข้อมูลไว้ที่ไหน')} sub={t('เลือกได้ตามขนาดร้าน ย้ายภายหลังได้ด้วยการสำรองและกู้คืนข้อมูล')}>
              <div className="grid gap-3 md:grid-cols-3">
                <Choice active={dbMode === 'sqlite'} onClick={() => setDbMode('sqlite')} icon={<HardDrive />} title={t('เก็บในเครื่องนี้')} badge={t('แนะนำ')} body={t('ใช้งานออฟไลน์ได้ 100% ไม่ต้องตั้งค่าเพิ่ม เครื่องอื่นในร้านเชื่อมเข้ามาได้')} />
                <Choice active={dbMode === 'external'} onClick={() => setDbMode('external')} icon={<Database />} title={t('ฐานข้อมูลของฉัน')} body={t('PostgreSQL หรือ MySQL/MariaDB บนเซิร์ฟเวอร์ของร้าน')} />
                <Choice active={dbMode === 'lan'} onClick={() => setDbMode('lan')} icon={<Network />} title={t('เชื่อมเครื่อง Host')} body={t('เครื่องนี้เป็นจุดขายเพิ่ม ใช้ข้อมูลจากเครื่องหลักในวง LAN')} />
              </div>
              {dbMode === 'external' && (
                <div className="grid gap-4 rounded-2xl border border-line bg-sunken p-4 md:grid-cols-2">
                  <Field label={t('ชนิดฐานข้อมูล')}>
                    <div className="flex gap-2">
                      {(['postgres', 'mysql'] as const).map((k) => (
                        <Button key={k} variant={ext.kind === k ? 'primary' : 'secondary'} onClick={() => { setExt({ ...ext, kind: k, port: k === 'postgres' ? 5432 : 3306 }); setTested(null); }}>
                          {k === 'postgres' ? 'PostgreSQL' : 'MySQL / MariaDB'}
                        </Button>
                      ))}
                    </div>
                  </Field>
                  <div className="grid grid-cols-[1fr_110px] gap-3">
                    <Field label="Host"><Input value={ext.host} onChange={(e) => { setExt({ ...ext, host: e.target.value }); setTested(null); }} /></Field>
                    <Field label="Port"><NumberInput value={ext.port} onValue={(port) => { setExt({ ...ext, port }); setTested(null); }} /></Field>
                  </div>
                  <Field label={t('ชื่อผู้ใช้')}><Input autoComplete="off" value={ext.user} onChange={(e) => { setExt({ ...ext, user: e.target.value }); setTested(null); }} /></Field>
                  <Field label={t('รหัสผ่าน')} hint={t('เก็บแบบเข้ารหัสในเครื่องนี้')}><Input type="password" autoComplete="new-password" value={ext.password} onChange={(e) => { setExt({ ...ext, password: e.target.value }); setTested(null); }} /></Field>
                  <Field label={t('ชื่อฐานข้อมูล')} hint={t('สร้างฐานข้อมูลว่างไว้ก่อน ระบบจะสร้างตารางให้อัตโนมัติ')}><Input value={ext.database} onChange={(e) => { setExt({ ...ext, database: e.target.value }); setTested(null); }} /></Field>
                  <div className="flex items-end justify-between gap-3">
                    <label className="flex items-center gap-3 text-[14px]"><Switch checked={ext.ssl} onChange={(ssl) => setExt({ ...ext, ssl })} label="SSL" />{t('ใช้ SSL')}</label>
                    <Button onClick={testDb} loading={busy} icon={<Server className="h-4 w-4" />}>{t('ทดสอบการเชื่อมต่อ')}</Button>
                  </div>
                  {tested && (
                    <div className="flex items-center gap-2 rounded-xl bg-soft px-3 py-2.5 text-[14px] text-soft-fg md:col-span-2">
                      <Check className="h-4 w-4" />{' '}{t('เชื่อมต่อสำเร็จ ·')}{' '}{tested.slice(0, 80)}
                    </div>
                  )}
                </div>
              )}
              {dbMode === 'lan' && (
                <div className="flex flex-col gap-3 rounded-2xl border border-line bg-sunken p-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label={t('ที่อยู่เครื่อง Host')} hint={t('เช่น http://192.168.1.10:4100 (ดูได้ที่ ตั้งค่า → อุปกรณ์ บนเครื่อง Host)')} className="min-w-[260px] flex-1">
                      <Input value={hostUrl} placeholder="http://192.168.1.10:4100" onChange={(e) => setHostUrl(e.target.value)} />
                    </Field>
                    <Button onClick={discover} loading={busy} icon={<Search className="h-4 w-4" />}>{t('ค้นหาอัตโนมัติ')}</Button>
                  </div>
                  {hosts && hosts.length === 0 && <p className="text-[14px] text-muted">{t('ไม่พบเครื่อง Host ในเครือข่าย ตรวจสอบว่าเครื่อง Host เปิดโปรแกรมอยู่และอยู่ใน Wi-Fi/LAN เดียวกัน แล้วกรอกที่อยู่เอง')}</p>}
                  {hosts?.map((h) => (
                    <button key={h.url} onClick={() => setHostUrl(h.url)} className={cn('flex items-center justify-between rounded-xl border px-4 py-3 text-left', hostUrl === h.url ? 'border-primary bg-soft' : 'border-line bg-surface')}>
                      <span className="font-medium">{h.name}</span>
                      <span className="font-mono text-[13px] text-muted">{h.url}</span>
                    </button>
                  ))}
                </div>
              )}
            </StepBody>
          )}

          {step === 2 && (
            <StepBody title={t('ข้อมูลร้าน')} sub={t('ใช้แสดงบนใบเสร็จและใบกำกับภาษี')}>
              <div className="flex flex-col gap-4 md:flex-row">
                <label className="flex h-[120px] w-[120px] flex-none cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border border-dashed border-line-strong bg-sunken text-[13px] text-muted hover:border-primary">
                  {store.logo ? <img src={store.logo} alt={t('โลโก้')} className="h-full w-full object-contain" /> : <><ImagePlus className="h-6 w-6" />{t('โลโก้ร้าน')}</>}
                  <input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setStore({ ...store, logo: await imageToDataUrl(f, 400) }); }} />
                </label>
                <div className="grid flex-1 gap-4 md:grid-cols-2">
                  <Field label={t('ชื่อร้าน')} required className="md:col-span-2"><Input autoFocus value={store.name} onChange={(e) => setStore({ ...store, name: e.target.value })} placeholder={t('เช่น คาเฟ่ใบชา')} /></Field>
                  <Field label={t('ชื่อสาขา')}><Input value={store.branchName} onChange={(e) => setStore({ ...store, branchName: e.target.value })} /></Field>
                  <Field label={t('เบอร์โทร')}><Input inputMode="tel" value={store.phone} onChange={(e) => setStore({ ...store, phone: e.target.value })} /></Field>
                </div>
              </div>
              <Field label={t('ที่อยู่')}><Textarea value={store.address} onChange={(e) => setStore({ ...store, address: e.target.value })} className="min-h-[72px]" /></Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t('เลขประจำตัวผู้เสียภาษี')} hint={t('13 หลัก (ถ้ามี)')} error={store.taxId && !isValidThaiTaxId(store.taxId) ? t('เลขผู้เสียภาษีไม่ถูกต้อง') : undefined}>
                  <Input inputMode="numeric" value={store.taxId} onChange={(e) => setStore({ ...store, taxId: e.target.value.replace(/\D/g, '').slice(0, 13) })} />
                </Field>
                <Field label={t('หมายเลข PromptPay')} hint={t('เบอร์มือถือหรือเลขผู้เสียภาษี ใช้สร้าง QR รับเงิน')}>
                  <Input inputMode="numeric" value={store.promptPayId} onChange={(e) => setStore({ ...store, promptPayId: e.target.value.replace(/\D/g, '').slice(0, 15) })} />
                </Field>
              </div>
            </StepBody>
          )}

          {step === 3 && (
            <StepBody title={t('ประเภทธุรกิจ')} sub={t('ระบบจะเปิดโมดูลและตั้งค่าเริ่มต้นที่เหมาะให้ ปรับเองได้ทุกอย่างภายหลัง')}>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {BUSINESS_TYPES.map((t) => (
                  <Choice key={t} active={type === t} onClick={() => { setType(t); if (t === 'restaurant') setTax((x) => ({ ...x, serviceChargeRate: 10 })); }} title={BUSINESS_TYPE_LABELS[t]} body={TYPE_HINT[t]} />
                ))}
              </div>
            </StepBody>
          )}

          {step === 4 && (
            <StepBody title={t('ภาษีและค่าบริการ')} sub={t('ถ้ายังไม่ได้จด VAT ให้ปิดไว้ก่อน เปิดภายหลังได้')}>
              <div className="flex flex-col rounded-2xl border border-line px-4">
                <Row label={t('จดทะเบียนภาษีมูลค่าเพิ่ม (VAT)')} hint={t('ออกใบกำกับภาษีอย่างย่อ/เต็มรูป และรายงานภาษีขาย')}><Switch checked={tax.vatEnabled} onChange={(v) => setTax({ ...tax, vatEnabled: v })} label="VAT" /></Row>
                {tax.vatEnabled && (
                  <>
                    <Row label={t('อัตรา VAT (%)')}><NumberInput className="w-24 text-right" decimals={2} value={tax.vatRate} onValue={(v) => setTax({ ...tax, vatRate: v })} /></Row>
                    <Row label={t('ราคาสินค้ารวม VAT แล้ว')} hint={t('ปิดถ้าต้องการบวก VAT เพิ่มตอนคิดเงิน')}><Switch checked={tax.pricesIncludeVat} onChange={(v) => setTax({ ...tax, pricesIncludeVat: v })} label={t('ราคารวม VAT')} /></Row>
                  </>
                )}
                <Row label={t('ค่าบริการ (Service charge %)')} hint={t('ใช้กับโหมดร้านอาหาร ใส่ 0 ถ้าไม่เก็บ')}><NumberInput className="w-24 text-right" decimals={2} value={tax.serviceChargeRate} onValue={(v) => setTax({ ...tax, serviceChargeRate: v })} /></Row>
              </div>
            </StepBody>
          )}

          {step === 5 && (
            <StepBody title={t('บัญชีเจ้าของร้าน')} sub={t('ใช้รหัสผ่านเข้าหน้าหลังร้าน และ PIN สำหรับสลับพนักงาน/อนุมัติรายการ')}>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t('ชื่อที่แสดง')} required><Input autoFocus value={owner.name} onChange={(e) => setOwner({ ...owner, name: e.target.value })} placeholder={t('เช่น นภัส')} /></Field>
                <Field label={t('ชื่อผู้ใช้')} required error={ownerErrors.username}><Input autoComplete="username" value={owner.username} onChange={(e) => setOwner({ ...owner, username: e.target.value.trim() })} /></Field>
                <Field label={t('รหัสผ่าน')} required error={ownerErrors.password}><Input type="password" autoComplete="new-password" value={owner.password} onChange={(e) => setOwner({ ...owner, password: e.target.value })} /></Field>
                <Field label={t('ยืนยันรหัสผ่าน')} required error={ownerErrors.password2}><Input type="password" autoComplete="new-password" value={owner.password2} onChange={(e) => setOwner({ ...owner, password2: e.target.value })} /></Field>
                <Field label={t('PIN (4-6 หลัก)')} required error={ownerErrors.pin} hint={t('ห้ามใช้ PIN ที่เดาง่าย เช่น 0000')}><Input inputMode="numeric" type="password" autoComplete="off" value={owner.pin} onChange={(e) => setOwner({ ...owner, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></Field>
              </div>
            </StepBody>
          )}

          {step === 6 && (
            <StepBody title={t('ดูข้อมูลร้านผ่านหน้าเว็บ')} sub={t('เลือกว่าจะเก็บสำเนาข้อมูลไว้ที่ไหนเพื่อดูแดชบอร์ดออนไลน์ เปลี่ยนภายหลังได้ที่หน้าตั้งค่า')}>
              <CloudChoice draft={cloud} onChange={setCloud} hasLicense={hasLicense} />
            </StepBody>
          )}

          {step === 7 && (
            <StepBody title={t('ข้อมูลเริ่มต้น')} sub={t('นำเข้าสินค้าจาก Excel/CSV ได้ที่หน้า สินค้า → นำเข้า หลังตั้งค่าเสร็จ')}>
              <div className="flex flex-col gap-3">
                <Choice active={sampleData} onClick={() => setSampleData(true)} title={t('ใส่ข้อมูลตัวอย่าง')} body={t('สินค้า หมวดหมู่{0} และสมาชิกตัวอย่างสำหรับ{1} ลบหรือแก้ไขได้ทั้งหมด', type === 'restaurant' || type === 'cafe' ? t(' โต๊ะ ตัวเลือกเสริม') : '', BUSINESS_TYPE_LABELS[type])} />
                <Choice active={!sampleData} onClick={() => setSampleData(false)} title={t('เริ่มจากร้านว่าง')} body={t('เพิ่มสินค้าเองหรือนำเข้าจาก Excel ในขั้นตอนถัดไป')} />
                <div className="mt-2 rounded-2xl bg-sunken p-4 text-[14px] text-ink-2">
                  <div className="mb-2 font-semibold">{t('สรุป')}</div>
                  <ul className="grid gap-1 md:grid-cols-2">
                    <li>{tn('ร้าน: {0}', store.name || '-')}</li>
                    <li>{tn('ประเภท: {0}', BUSINESS_TYPE_LABELS[type])}</li>
                    <li>VAT: {tax.vatEnabled ? `${tax.vatRate}% ${tax.pricesIncludeVat ? t('(รวมในราคา)') : t('(บวกเพิ่ม)')}` : t('ไม่จด')}</li>
                    <li>{tn('เจ้าของ: {0} ({1})', owner.name, owner.username)}</li>
                    <li>{tn('แดชบอร์ดออนไลน์: {0}', cloud.mode === 'cloud' ? 'FlexPOS Cloud' : cloud.mode === 'self' ? cloud.url : t('ไม่ใช้ (เก็บในเครื่องนี้อย่างเดียว)'))}</li>
                  </ul>
                </div>
              </div>
            </StepBody>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-line-soft pt-5">
            <Button variant="ghost" onClick={back} disabled={step === 0 || (status.configured && step === 2)}>{t('ย้อนกลับ')}</Button>
            {step === 1 ? (
              <Button variant="primary" size="lg" loading={busy} disabled={(dbMode === 'external' && !tested) || (dbMode === 'lan' && !hostUrl)} onClick={saveDb}>
                {dbMode === 'lan' ? t('เชื่อมต่อ') : t('ถัดไป')}
              </Button>
            ) : step === STEPS.length - 1 ? (
              <Button variant="primary" size="lg" loading={busy} onClick={finish}>{t('เริ่มใช้งาน')}</Button>
            ) : (
              <Button variant="primary" size="lg" onClick={next} disabled={(step === 2 && !storeOk) || (step === 5 && !ownerOk) || (step === 6 && !cloudDraftOk(cloud, hasLicense))}>{t('ถัดไป')}</Button>
            )}
          </div>
        </div>
        {step === 1 && dbMode === 'external' && !tested && <p className="text-center text-[13px] text-muted">{t('กด “ทดสอบการเชื่อมต่อ” ให้ผ่านก่อนจึงจะไปขั้นตอนถัดไปได้')}</p>}
      </div>
    </div>
  );
}

const TYPE_HINT: Record<BusinessType, string> = {
  retail: t('สแกนบาร์โค้ด ตัดสต็อก สินค้าชั่งน้ำหนัก'),
  restaurant: t('ผังโต๊ะ ส่งครัว ค่าบริการ แอปรับออเดอร์'),
  cafe: t('ตัวเลือกเครื่องดื่ม ขนาด ความหวาน สะสมแต้ม'),
  fashion: t('ไซซ์/สี แยกสต็อก สมาชิก'),
  service: t('ขายบริการ ไม่ตัดสต็อก นัดหมาย/สมาชิก'),
  other: t('เริ่มแบบพื้นฐาน ปรับเองทั้งหมด'),
};

function StepBody({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-[20px] font-semibold">{title}</h2>
        {sub && <p className="mt-1 text-[14px] text-muted">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function Choice({ active, onClick, title, body, icon, badge }: { active: boolean; onClick: () => void; title: string; body?: string; icon?: ReactNode; badge?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn('flex min-h-[88px] flex-col gap-1.5 rounded-2xl border p-4 text-left transition-colors', active ? 'border-primary bg-soft ring-1 ring-primary' : 'border-line bg-surface hover:border-line-strong hover:bg-sunken')}>
      <span className="flex items-center gap-2.5 text-[16px] font-semibold [&_svg]:h-5 [&_svg]:w-5 [&_svg]:text-primary">
        {icon}
        {title}
        {badge && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-fg">{badge}</span>}
        {active && <Check className="ml-auto h-5 w-5 text-primary" />}
      </span>
      {body && <span className="text-[13px] text-muted [text-wrap:pretty]">{body}</span>}
    </button>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-line-soft py-3.5 last:border-0">
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-medium">{label}</span>
        {hint && <span className="text-[13px] text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
