import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Plus, Radar, Trash2 } from 'lucide-react';
import { api, errorMessage, registerName } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Select, SkeletonRows, Switch, ToggleRow } from '@/components/ui/core';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { NumberInput } from '@/components/ui/inputs';
import { QrImage } from '@/components/PrintDocView';
import { SaveBar, SectionTitle, useDraft } from './common';
import { editionAllows, t } from '@flexpos/shared';
import { tn } from '@/lib/i18n';

interface Printer {
  id: string;
  name: string;
  kind: 'network' | 'system';
  address: string;
  port: number;
  paper: '58' | '80';
  role: 'receipt' | 'kitchen' | 'bar' | 'label';
  categoryIds: string[];
  textMode: 'image' | 'thai';
  openDrawer: boolean;
  active: boolean;
  online: boolean;
  lastError: string;
  queued: number;
}
const ROLE: Partial<Record<Printer['role'], string>> = editionAllows('restaurant')
  ? { receipt: t('ใบเสร็จ'), kitchen: t('ครัว'), bar: t('บาร์'), label: t('สติกเกอร์') }
  : { receipt: t('ใบเสร็จ'), label: t('สติกเกอร์') };

export function PrintersSection() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const kitchen = useDraft('kitchen');
  const list = useQuery({ queryKey: ['printers'], queryFn: () => api.get<Printer[]>('/api/printers'), refetchInterval: 20_000 });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get<{ id: string; name: string; parentId: string | null }[]>('/api/categories') });
  const [edit, setEdit] = useState<Partial<Printer> | null>(null);
  const [found, setFound] = useState<{ address: string; port: number }[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const kitchenPrinters = (list.data ?? []).filter((p) => p.active && (p.role === 'kitchen' || p.role === 'bar'));
  const offline = kitchenPrinters.filter((p) => !p.online && p.kind === 'network');
  const queued = kitchenPrinters.reduce((a, p) => a + p.queued, 0);

  const save = async () => {
    if (!edit) return;
    try {
      const body = { name: edit.name, kind: edit.kind, address: edit.address ?? '', port: edit.port ?? 9100, paper: edit.paper ?? '80', role: edit.role, categoryIds: edit.categoryIds ?? [], textMode: edit.textMode ?? 'image', openDrawer: !!edit.openDrawer, active: edit.active ?? true };
      if (edit.id) await api.put(`/api/printers/${edit.id}`, body);
      else await api.post('/api/printers', body);
      qc.invalidateQueries({ queryKey: ['printers'] });
      setEdit(null);
      toast.success(t('บันทึกเครื่องพิมพ์แล้ว'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const test = async (p: Printer) => {
    setBusy(p.id);
    try {
      await api.post(`/api/printers/${p.id}/test`);
      toast.success(t('พิมพ์ทดสอบที่ {0} แล้ว', p.name));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ['printers'] });
    }
  };
  const scan = async () => {
    setScanning(true);
    try {
      const r = await api.post<{ printers: { address: string; port: number }[] }>('/api/printers/discover');
      setFound(r.printers);
      if (!r.printers.length) toast.info(t('ไม่พบเครื่องพิมพ์ที่เปิดพอร์ต 9100 ในเครือข่ายนี้'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setScanning(false);
    }
  };

  return (
    <>
      <div className={cn('flex items-center gap-3 rounded-[14px] px-[18px] py-3.5', offline.length ? 'bg-danger-soft' : kitchenPrinters.length ? 'bg-soft' : 'bg-canvas')}>
        <span className={cn('h-2.5 w-2.5 flex-none rounded-full', offline.length ? 'bg-danger' : kitchenPrinters.length ? 'bg-accent' : 'bg-faint')} />
        <div className="flex flex-1 flex-col gap-0.5">
          <span className={cn('text-[15px] font-semibold', offline.length ? 'text-danger' : 'text-soft-fg')}>
            {offline.length ? t('{0} ไม่ตอบสนอง', offline.map((p) => p.name).join(', ')) : kitchenPrinters.length ? t('เครื่องพิมพ์ออเดอร์พร้อมใช้งาน') : t('ยังไม่มีเครื่องพิมพ์ออเดอร์')}
          </span>
          <span className="text-[13px] text-ink-2">{offline.length ? t('ใบที่รอพิมพ์ {0} ใบ จะพิมพ์อัตโนมัติเมื่อเครื่องกลับมา ตรวจสอบสายไฟ/สาย LAN', queued) : t('ออเดอร์จากแอปพนักงานและหน้าขายจะพิมพ์ที่เครื่องเหล่านี้อัตโนมัติ')}</span>
        </div>
      </div>
      <SectionTitle
        title={t('เครื่องพิมพ์')}
        sub={t('รองรับเครื่องพิมพ์ใบเสร็จ ESC/POS ผ่าน LAN/Wi-Fi (พอร์ต 9100) และเครื่องพิมพ์ที่ติดตั้งใน Windows (USB/Bluetooth)')}
        actions={
          <>
            <Button loading={scanning} icon={<Radar className="h-4 w-4" />} onClick={() => void scan()}>{t('ค้นหาในเครือข่าย')}</Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ kind: 'network', role: 'receipt', port: 9100, paper: '80', textMode: 'image', active: true, categoryIds: [] })}>{t('เพิ่มเครื่องพิมพ์')}</Button>
          </>
        }
      />
      {found && found.length > 0 && (
        <Card title={t('พบในเครือข่าย')}>
          {found.map((f) => (
            <div key={f.address} className="flex items-center justify-between border-b border-line-soft py-2 last:border-0">
              <span className="font-mono text-[14px]">{f.address}:{f.port}</span>
              <Button size="sm" disabled={list.data?.some((p) => p.address === f.address)} onClick={() => setEdit({ kind: 'network', address: f.address, port: f.port, role: 'kitchen', paper: '80', textMode: 'image', active: true, categoryIds: [], name: t('เครื่องพิมพ์ {0}', f.address.split('.').pop()) })}>
                {list.data?.some((p) => p.address === f.address) ? t('เพิ่มแล้ว') : t('เพิ่ม')}
              </Button>
            </div>
          ))}
        </Card>
      )}
      <div className="flex flex-col gap-2.5">
        {list.isLoading ? <SkeletonRows /> : !list.data?.length ? (
          <Card><EmptyState title={t('ยังไม่มีเครื่องพิมพ์')} body={t('ถ้าไม่ตั้งค่า ระบบจะพิมพ์ใบเสร็จผ่านหน้าต่างพิมพ์ของเบราว์เซอร์/Windows')} /></Card>
        ) : list.data.map((p) => (
          <div key={p.id} className={cn('flex flex-wrap items-center gap-3.5 rounded-2xl bg-surface px-[18px] py-4', p.kind === 'network' && !p.online && p.active ? 'border-2 border-danger/50' : 'border border-line')}>
            <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[16px] font-semibold">{p.name}</span>
                <Badge tone="info">{ROLE[p.role] ?? p.role}</Badge>
                {!p.active ? <Badge>{t('ปิด')}</Badge> : p.kind === 'network' ? p.online ? <Badge tone="success">{t('พร้อม')}</Badge> : <Badge tone="danger">{tn('ออฟไลน์{0}', p.queued ? t(' · รอ {0}', p.queued) : '')}</Badge> : <Badge>{t('เครื่องพิมพ์ Windows')}</Badge>}
              </div>
              <span className="text-[13px] text-muted">{p.paper}mm · {p.textMode === 'thai' ? t('โหมดข้อความ (CP874)') : t('โหมดภาพ (รองรับภาษาไทยทุกรุ่น)')}{p.categoryIds.length ? ` · ${p.categoryIds.map((c) => cats.data?.find((x) => x.id === c)?.name).filter(Boolean).join(', ')}` : ''}</span>
              <span className="font-mono text-[12px] text-faint">{p.kind === 'network' ? `${p.address}:${p.port}` : p.address || t('เครื่องพิมพ์เริ่มต้นของระบบ')}</span>
              {p.lastError && p.active && <span className="text-[12px] text-danger">{p.lastError}</span>}
            </div>
            {p.kind === 'network' && <Button loading={busy === p.id} onClick={() => void test(p)}>{t('ทดสอบพิมพ์')}</Button>}
            {p.queued > 0 && <Button onClick={() => void api.post(`/api/printers/${p.id}/retry`).then(() => qc.invalidateQueries({ queryKey: ['printers'] }))}>{t('ลองพิมพ์ใบค้าง')}</Button>}
            <Button onClick={() => setEdit(p)}>{t('ตั้งค่า')}</Button>
            <Button variant="ghost" className="text-danger" aria-label={t('ลบ {0}', p.name)} onClick={async () => { const r = await confirm({ title: t('ลบ {0}?', p.name), danger: true, confirmText: t('ลบ') }); if (r.ok) { await api.del(`/api/printers/${p.id}`); qc.invalidateQueries({ queryKey: ['printers'] }); } }}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
      <Card title={t('ใบออเดอร์ครัว')}>
        <div className="-my-2 flex flex-col">
          <ToggleRow label={t('พิมพ์ใบออเดอร์อัตโนมัติเมื่อกดส่งครัว')} checked={kitchen.draft.autoPrint} onChange={(v) => kitchen.set('autoPrint', v)} />
          <ToggleRow label={t('พิมพ์ใบที่ค้างอัตโนมัติเมื่อเครื่องพิมพ์กลับมา')} checked={kitchen.draft.reprintOnReconnect} onChange={(v) => kitchen.set('reprintOnReconnect', v)} />
          <ToggleRow label={t('แสดงตัวเลือกเสริมในใบออเดอร์')} hint={t('เช่น ใหญ่ · หวานน้อย')} checked={kitchen.draft.showModifiers} onChange={(v) => kitchen.set('showModifiers', v)} />
        </div>
      </Card>
      <SaveBar dirty={kitchen.dirty} saving={kitchen.saving} onSave={() => void kitchen.save()} onReset={kitchen.reset} />
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} title={edit?.id ? t('ตั้งค่าเครื่องพิมพ์') : t('เพิ่มเครื่องพิมพ์')} footer={<><Button onClick={() => setEdit(null)}>{t('ยกเลิก')}</Button><Button variant="primary" disabled={!edit?.name?.trim() || (edit?.kind === 'network' && !edit.address)} onClick={() => void save()}>{t('บันทึก')}</Button></>}>
        {edit && (
          <div className="grid gap-4 pb-2 md:grid-cols-2">
            <Field label={t('ชื่อ')} required className="md:col-span-2"><Input autoFocus value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder={t('เช่น เครื่องครัว')} /></Field>
            <Field label={t('ใช้สำหรับ')}><Select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Printer['role'], kind: e.target.value === 'receipt' || e.target.value === 'label' ? edit.kind : 'network' })}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label={t('การเชื่อมต่อ')}>
              <Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as Printer['kind'] })}>
                <option value="network">LAN / Wi-Fi (ESC/POS)</option>
                {(edit.role === 'receipt' || edit.role === 'label') && <option value="system">{t('เครื่องพิมพ์ที่ติดตั้งใน Windows (USB/Bluetooth)')}</option>}
              </Select>
            </Field>
            {edit.kind === 'network' ? (
              <div className="grid grid-cols-[1fr_100px] gap-2 md:col-span-2">
                <Field label="IP address" required><Input className="font-mono" value={edit.address ?? ''} onChange={(e) => setEdit({ ...edit, address: e.target.value.trim() })} placeholder="192.168.1.50" /></Field>
                <Field label="Port"><NumberInput value={edit.port ?? 9100} onValue={(port) => setEdit({ ...edit, port })} /></Field>
              </div>
            ) : (
              <Field label={t('ชื่อเครื่องพิมพ์ใน Windows')} hint={t('เว้นว่าง = ให้เลือกตอนพิมพ์ · ใส่ชื่อเพื่อพิมพ์อัตโนมัติในแอป FlexPOS บน Windows')} className="md:col-span-2"><Input value={edit.address ?? ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} placeholder={t('เช่น XP-80C')} /></Field>
            )}
            <Field label={t('ขนาดกระดาษ')}><Select value={edit.paper} onChange={(e) => setEdit({ ...edit, paper: e.target.value as '58' | '80' })}><option value="80">{t('80 มม.')}</option><option value="58">{t('58 มม.')}</option></Select></Field>
            {edit.kind === 'network' && (
              <Field label={t('การพิมพ์ภาษาไทย')} hint={t('โหมดภาพใช้ได้กับทุกเครื่อง ไม่ต้องมีฟอนต์ไทย')}>
                <Select value={edit.textMode} onChange={(e) => setEdit({ ...edit, textMode: e.target.value as 'image' | 'thai' })}><option value="image">{t('โหมดภาพ (แนะนำ)')}</option><option value="thai">{t('โหมดข้อความ (เครื่องมีฟอนต์ไทย CP874)')}</option></Select>
              </Field>
            )}
            {(edit.role === 'kitchen' || edit.role === 'bar') && (
              <div className="flex flex-col gap-1 md:col-span-2">
                <span className="text-[13px] font-medium text-muted">{t('พิมพ์เฉพาะหมวด (ไม่เลือก = รับทุกรายการที่ไม่มีเครื่องเฉพาะ)')}</span>
                <div className="grid grid-cols-2 md:grid-cols-3">
                  {cats.data?.map((c) => <Checkbox key={c.id} checked={(edit.categoryIds ?? []).includes(c.id)} onChange={(v) => setEdit({ ...edit, categoryIds: v ? [...(edit.categoryIds ?? []), c.id] : (edit.categoryIds ?? []).filter((x) => x !== c.id) })} label={c.name} />)}
                </div>
              </div>
            )}
            {edit.role === 'receipt' && edit.kind === 'network' && <Checkbox checked={!!edit.openDrawer} onChange={(openDrawer) => setEdit({ ...edit, openDrawer })} label={t('ต่อกับลิ้นชักเก็บเงิน (สั่งเปิดลิ้นชักเมื่อรับเงินสด)')} />}
            <label className="flex items-center justify-between md:col-span-2"><span>{t('เปิดใช้งาน')}</span><Switch checked={edit.active ?? true} onChange={(active) => setEdit({ ...edit, active })} /></label>
          </div>
        )}
      </Dialog>
    </>
  );
}

export function DevicesSection() {
  const settings = useSettings();
  const info = useQuery({ queryKey: ['system-info'], queryFn: () => api.get<{ ips: string[]; dataDir: string; dbKind: string; port: number }>('/api/system/info') });
  const port = location.port || info.data?.port || 4100;
  const hosts = (info.data?.ips ?? []).map((ip) => `http://${ip}:${port}`);
  const base = hosts[0] ?? location.origin;
  const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => toast.success(t('คัดลอกแล้ว')));
  return (
    <>
      <SectionTitle title={t('อุปกรณ์และเครือข่าย')} sub={t('เปิดลิงก์เหล่านี้บนแท็บเล็ต มือถือ หรือคอมพิวเตอร์ในวง Wi-Fi/LAN เดียวกัน')} />
      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card title={t('เครื่อง Host (เครื่องนี้)')}>
          <div className="flex flex-col gap-1.5 text-[14px]">
            {hosts.length ? hosts.map((h) => <div key={h} className="flex items-center justify-between gap-2 rounded-lg bg-sunken px-3 py-2"><span className="min-w-0 break-all font-mono">{h}</span><Button size="sm" variant="ghost" icon={<Copy className="h-4 w-4" />} onClick={() => void copy(h)}>{t('คัดลอก')}</Button></div>) : <span className="text-muted">{t('ไม่พบที่อยู่ในเครือข่าย')}</span>}
            <span className="mt-1 text-[13px] text-muted">{tn('ฐานข้อมูล: {0} · จุดขายนี้: {1}', info.data?.dbKind === 'sqlite' ? t('SQLite ในเครื่อง') : info.data?.dbKind, registerName())}</span>
            <span className="break-all text-[12px] text-faint">{tn('ที่เก็บข้อมูล: {0}', info.data?.dataDir)}</span>
          </div>
        </Card>
        <Card title={t('แอปรับออเดอร์ (มือถือพนักงาน)')}>
          <div className="flex items-center gap-4">
            <QrImage data={`${base}/order`} size={128} className="flex-none rounded-lg border border-line" />
            <div className="flex min-w-0 flex-col gap-1.5 text-[14px]">
              <span>{t('สแกน QR ด้วยมือถือ Android/iPhone แล้วกด “เพิ่มไปยังหน้าจอหลัก” เพื่อใช้เหมือนแอป')}</span>
              <span className="break-all font-mono text-[13px] text-muted">{base}/order</span>
              {!settings.modules.restaurant && <Badge tone="warn">{t('เปิดโหมดร้านอาหารก่อนใช้งาน')}</Badge>}
            </div>
          </div>
        </Card>
        <Card title={t('จอแสดงผลฝั่งลูกค้า')}>
          <div className="flex items-center gap-4">
            <QrImage data={`${base}/display?register=${encodeURIComponent(registerName())}`} size={128} className="flex-none rounded-lg border border-line" />
            <div className="flex min-w-0 flex-col gap-1.5 text-[14px]">
              <span>{tn('เปิดบนจอที่สองหรือแท็บเล็ตที่หันหาลูกค้า จะแสดงรายการและ QR ชำระเงินของจุดขาย “{0}”', registerName())}</span>
              <span className="break-all font-mono text-[13px] text-muted">{base}/display?register={registerName()}</span>
              {!settings.modules.customerDisplay && <Badge tone="warn">{t('เปิดโมดูล “จอแสดงผลฝั่งลูกค้า” ก่อน')}</Badge>}
            </div>
          </div>
        </Card>
        <Card title={t('จุดขายเพิ่มเติม')}>
          <p className="text-[14px] text-ink-2">{t('ติดตั้ง FlexPOS บนเครื่องที่สอง แล้วเลือก “เชื่อมเครื่อง Host” ในตัวช่วยตั้งค่า หรือเปิดลิงก์ของเครื่อง Host ผ่านเบราว์เซอร์ได้ทันที เครื่องลูกขายต่อได้แม้ขาดการเชื่อมต่อชั่วคราว และส่งบิลอัตโนมัติเมื่อกลับมาออนไลน์')}</p>
          <a className="text-[14px] font-semibold text-primary" href="/display" target="_blank" rel="noreferrer">{t('เปิดจอลูกค้าบนเครื่องนี้ ›')}</a>
        </Card>
      </div>
    </>
  );
}

interface Branch { id: string; code: string; name: string; address: string; phone: string; tax_branch_no: string; active: number }

export function BranchesSection() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['branches'], queryFn: () => api.get<Branch[]>('/api/branches') });
  const [edit, setEdit] = useState<Partial<Branch> | null>(null);
  const save = async () => {
    try {
      const body = { code: edit!.code, name: edit!.name, address: edit!.address ?? '', phone: edit!.phone ?? '', taxBranchNo: edit!.tax_branch_no || '00000', active: edit!.active !== 0 };
      if (edit!.id) await api.put(`/api/branches/${edit!.id}`, body);
      else await api.post('/api/branches', body);
      qc.invalidateQueries({ queryKey: ['branches'] });
      setEdit(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <SectionTitle title={t('สาขา')} sub={t('แต่ละสาขามีสต็อก กะ และเลขที่เอกสารแยกกัน ข้อมูลรวมศูนย์ที่ฐานข้อมูลเดียว')} actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ code: String((list.data?.length ?? 0) + 1).padStart(2, '0'), active: 1 })}>{t('เพิ่มสาขา')}</Button>} />
      <Card pad={false}>
        {list.data?.map((b) => (
          <button key={b.id} onClick={() => setEdit(b)} className="flex w-full items-center gap-3 border-b border-line-soft px-5 py-3 text-left last:border-0 hover:bg-sunken">
            <span className="w-10 font-mono text-[13px] text-muted">{b.code}</span>
            <span className="flex flex-1 flex-col"><span className="font-medium">{b.name}</span><span className="text-[13px] text-muted">{tn('สาขาภาษี {0}{1}', b.tax_branch_no, b.phone ? ` · ${b.phone}` : '')}</span></span>
            {!b.active && <Badge>{t('ปิด')}</Badge>}
          </button>
        ))}
      </Card>
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} title={edit?.id ? t('แก้ไขสาขา') : t('เพิ่มสาขา')} footer={<><Button onClick={() => setEdit(null)}>{t('ยกเลิก')}</Button><Button variant="primary" disabled={!edit?.name?.trim() || !edit?.code?.trim()} onClick={() => void save()}>{t('บันทึก')}</Button></>}>
        {edit && (
          <div className="grid gap-4 pb-2 md:grid-cols-2">
            <Field label={t('รหัสสาขา')} required hint={t('ใช้ในเลขที่เอกสาร')}><Input value={edit.code ?? ''} onChange={(e) => setEdit({ ...edit, code: e.target.value.slice(0, 10) })} /></Field>
            <Field label={t('ชื่อสาขา')} required><Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label={t('เลขที่สาขา (ภาษี)')} hint={t('สำนักงานใหญ่ = 00000')}><Input value={edit.tax_branch_no ?? ''} onChange={(e) => setEdit({ ...edit, tax_branch_no: e.target.value })} /></Field>
            <Field label={t('เบอร์โทร')}><Input value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label={t('ที่อยู่')} className="md:col-span-2"><Input value={edit.address ?? ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
            <label className="flex items-center justify-between md:col-span-2"><span>{t('เปิดใช้งาน')}</span><Switch checked={edit.active !== 0} onChange={(v) => setEdit({ ...edit, active: v ? 1 : 0 })} /></label>
          </div>
        )}
      </Dialog>
    </>
  );
}
