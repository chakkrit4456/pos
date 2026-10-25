import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GripVertical, ImagePlus, Plus } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BUSINESS_TYPE_LABELS, BUSINESS_TYPES, RECEIPT_SECTION_LABELS, RECEIPT_SECTIONS, isValidThaiTaxId, type PrintDoc, type ReceiptSection as RS } from '@flexpos/shared';
import { api, errorMessage, registerName, setRegisterName } from '@/lib/api';
import { money, useSettings } from '@/lib/settings';
import { imageToDataUrl } from '@/lib/utils';
import { Badge, Button, Card, Field, Input, Select, Switch, Textarea, ToggleRow } from '@/components/ui/core';
import { Dialog } from '@/components/ui/dialog';
import { MoneyInput, NumberInput } from '@/components/ui/inputs';
import { PrintDocView } from '@/components/PrintDocView';
import { SaveBar, SectionTitle, useDraft } from './common';

export function StoreSection() {
  const d = useDraft('store');
  const settings = useSettings();
  const preview = useReceiptPreview({ store: d.draft });
  return (
    <>
      <SectionTitle title="ข้อมูลร้าน" sub="แสดงบนใบเสร็จ ใบกำกับภาษี และจอลูกค้า" />
      <div className="flex flex-wrap items-start gap-6">
        <Card className="min-w-0 max-w-[620px] flex-[1_1_360px]">
          <div className="flex flex-col gap-4 sm:flex-row">
            <label className="flex h-[104px] w-[104px] flex-none cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border border-dashed border-line-strong bg-sunken text-[12px] text-muted hover:border-primary">
              {d.draft.logo ? <img src={d.draft.logo} alt="โลโก้" className="h-full w-full object-contain" /> : <><ImagePlus className="h-6 w-6" />โลโก้</>}
              <input type="file" accept="image/*" className="sr-only" onChange={async (e) => e.target.files?.[0] && d.set('logo', await imageToDataUrl(e.target.files[0], 400))} />
            </label>
            <div className="grid flex-1 gap-3.5 md:grid-cols-2">
              <Field label="ชื่อร้าน" className="md:col-span-2"><Input value={d.draft.name} onChange={(e) => d.set('name', e.target.value)} /></Field>
              <Field label="เลขผู้เสียภาษี" error={d.draft.taxId && !isValidThaiTaxId(d.draft.taxId) ? 'เลขไม่ถูกต้อง' : undefined}><Input inputMode="numeric" className="num" value={d.draft.taxId} onChange={(e) => d.set('taxId', e.target.value.replace(/\D/g, '').slice(0, 13))} /></Field>
              <Field label="เบอร์โทร"><Input value={d.draft.phone} onChange={(e) => d.set('phone', e.target.value)} /></Field>
            </div>
          </div>
          {d.draft.logo && <Button size="sm" variant="ghost" className="self-start text-danger" onClick={() => d.set('logo', '')}>ลบโลโก้</Button>}
          <Field label="ที่อยู่"><Textarea value={d.draft.address} onChange={(e) => d.set('address', e.target.value)} className="min-h-[72px]" /></Field>
          <Field label="หมายเลข PromptPay" hint="เบอร์มือถือ 10 หลัก หรือเลขผู้เสียภาษี 13 หลัก ใช้สร้าง QR รับเงินอัตโนมัติ"><Input inputMode="numeric" className="num" value={d.draft.promptPayId} onChange={(e) => d.set('promptPayId', e.target.value.replace(/\D/g, '').slice(0, 15))} /></Field>
          <Field label="ประเภทธุรกิจ" hint="เปลี่ยนประเภทไม่ลบข้อมูล ใช้เพื่อการแนะนำเท่านั้น">
            <Select value={settings.businessType} onChange={async (e) => { await api.put('/api/settings', { businessType: e.target.value }); toast.success('บันทึกแล้ว'); }}>
              {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{BUSINESS_TYPE_LABELS[t]}</option>)}
            </Select>
          </Field>
        </Card>
        {preview && <div className="flex flex-col gap-2"><span className="text-[12px] text-faint">ตัวอย่างใบเสร็จ {settings.receipt.paper}{settings.receipt.paper === 'A4' ? '' : 'mm'}</span><PrintDocView doc={preview} /></div>}
      </div>
      <SaveBar dirty={d.dirty} saving={d.saving} onSave={() => void d.save()} onReset={d.reset} />
    </>
  );
}

function useReceiptPreview(patch: object) {
  const [doc, setDoc] = useState<PrintDoc | null>(null);
  const key = JSON.stringify(patch);
  useEffect(() => {
    const t = setTimeout(() => {
      api.post<PrintDoc>('/api/settings/receipt-preview', JSON.parse(key) as object).then(setDoc).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [key]);
  return doc;
}

export function ReceiptSection() {
  const d = useDraft('receipt');
  const preview = useReceiptPreview({ receipt: d.draft });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const order: RS[] = [...d.draft.sections, ...RECEIPT_SECTIONS.filter((s) => !d.draft.sections.includes(s))];
  const toggle = (s: RS, on: boolean) => d.set('sections', on ? order.filter((x) => x === s || d.draft.sections.includes(x)) : d.draft.sections.filter((x) => x !== s));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(order, order.indexOf(e.active.id as RS), order.indexOf(e.over.id as RS));
    d.set('sections', next.filter((s) => d.draft.sections.includes(s)));
  };
  return (
    <>
      <SectionTitle title="ออกแบบใบเสร็จ" sub="ลากเพื่อเรียงลำดับ เปิด/ปิดส่วนต่างๆ ดูตัวอย่างได้ทันที" />
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 max-w-[620px] flex-[1_1_360px] flex-col gap-4">
          <Card title="ส่วนประกอบ" pad>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={order} strategy={verticalListSortingStrategy}>
                {order.map((s) => <SectionRow key={s} id={s} on={d.draft.sections.includes(s)} onToggle={(v) => toggle(s, v)} />)}
              </SortableContext>
            </DndContext>
          </Card>
          <Card title="ข้อความและรูปแบบ">
            <Field label="ข้อความหัวใบเสร็จ"><Input value={d.draft.header} onChange={(e) => d.set('header', e.target.value)} placeholder="เช่น เปิดทุกวัน 7:00–20:00" /></Field>
            <Field label="ข้อความท้ายใบเสร็จ"><Textarea value={d.draft.footer} onChange={(e) => d.set('footer', e.target.value)} className="min-h-[64px]" /></Field>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="ขนาดกระดาษ">
                <Select value={d.draft.paper} onChange={(e) => d.set('paper', e.target.value as typeof d.draft.paper)}>
                  <option value="58">58 มม.</option><option value="80">80 มม.</option><option value="A4">A4</option>
                </Select>
              </Field>
              <Field label="จำนวนสำเนา"><NumberInput value={d.draft.copies} onValue={(v) => d.set('copies', Math.max(1, Math.min(3, v)))} /></Field>
            </div>
            <div className="-my-1 flex flex-col">
              <ToggleRow label="พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน" checked={d.draft.autoPrint} onChange={(v) => d.set('autoPrint', v)} />
              <ToggleRow label="เปิดลิ้นชักเมื่อรับเงินสด" hint="ต้องใช้เครื่องพิมพ์เครือข่ายที่ต่อลิ้นชัก" checked={d.draft.openDrawerOnCash} onChange={(v) => d.set('openDrawerOnCash', v)} />
            </div>
          </Card>
          <Card title="เลขที่เอกสาร">
            <p className="-mt-2 text-[13px] text-muted">รูปแบบ: {'{prefix}'} {'{branch}'} {'{yyyy}'} {'{be}'} (พ.ศ.) {'{yy}'} {'{mm}'} {'{seq:5}'} (เลขรัน 5 หลัก) · รันเลขแยกตามสาขาอัตโนมัติ</p>
            <div className="grid gap-3 md:grid-cols-[120px_1fr]">
              <Field label="Prefix ใบเสร็จ"><Input value={d.draft.receiptPrefix} onChange={(e) => d.set('receiptPrefix', e.target.value)} /></Field>
              <Field label="รูปแบบเลขใบเสร็จ / ใบกำกับอย่างย่อ"><Input className="font-mono" value={d.draft.receiptPattern} onChange={(e) => d.set('receiptPattern', e.target.value)} /></Field>
              <Field label="Prefix ใบกำกับเต็มรูป"><Input value={d.draft.taxInvoicePrefix} onChange={(e) => d.set('taxInvoicePrefix', e.target.value)} /></Field>
              <Field label="รูปแบบเลขใบกำกับภาษีเต็มรูป (รันตามปี)"><Input className="font-mono" value={d.draft.taxInvoicePattern} onChange={(e) => d.set('taxInvoicePattern', e.target.value)} /></Field>
            </div>
          </Card>
        </div>
        {preview && <div className="sticky top-4 flex flex-col gap-2"><span className="text-[12px] text-faint">ตัวอย่าง</span><PrintDocView doc={preview} /></div>}
      </div>
      <SaveBar dirty={d.dirty} saving={d.saving} onSave={() => void d.save()} onReset={d.reset} />
    </>
  );
}

function SectionRow({ id, on, onToggle }: { id: RS; on: boolean; onToggle: (v: boolean) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="flex items-center gap-3 border-b border-line-soft bg-surface py-2.5 last:border-0">
      <button {...attributes} {...listeners} className="grid h-9 w-7 cursor-grab place-items-center text-faint" aria-label={`ลาก ${RECEIPT_SECTION_LABELS[id]}`}><GripVertical className="h-4 w-4" /></button>
      <span className="flex-1 text-[15px]">{RECEIPT_SECTION_LABELS[id]}</span>
      <Switch size="sm" checked={on} onChange={onToggle} label={RECEIPT_SECTION_LABELS[id]} />
    </div>
  );
}

export function TaxSection() {
  const d = useDraft('tax');
  return (
    <>
      <SectionTitle title="ภาษีและค่าบริการ" sub="มีผลกับบิลใหม่ทันที บิลเก่าไม่เปลี่ยน" />
      <Card className="max-w-[720px]">
        <div className="-my-2 flex flex-col">
          <ToggleRow label="จดทะเบียนภาษีมูลค่าเพิ่ม (VAT)" hint="ออกใบกำกับภาษี และรายงานภาษีขาย" checked={d.draft.vatEnabled} onChange={(v) => d.set('vatEnabled', v)} />
          {d.draft.vatEnabled && (
            <>
              <div className="flex items-center gap-4 border-b border-line-soft py-3.5"><span className="flex-1 text-[15px] font-medium">อัตรา VAT (%)</span><NumberInput className="w-24 text-right" decimals={2} value={d.draft.vatRate} onValue={(v) => d.set('vatRate', v)} /></div>
              <ToggleRow label="ราคาสินค้ารวม VAT แล้ว" hint={d.draft.pricesIncludeVat ? `ราคา ฿107 = สินค้า ฿100 + VAT ฿7` : `ราคา ฿100 + VAT ฿7 = จ่าย ฿107`} checked={d.draft.pricesIncludeVat} onChange={(v) => d.set('pricesIncludeVat', v)} />
            </>
          )}
          <div className="flex items-center gap-4 border-b border-line-soft py-3.5"><span className="flex flex-1 flex-col"><span className="text-[15px] font-medium">ค่าบริการ (Service charge %)</span><span className="text-[13px] text-muted">ใช้เมื่อเปิดโหมดร้านอาหาร</span></span><NumberInput className="w-24 text-right" decimals={2} value={d.draft.serviceChargeRate} onValue={(v) => d.set('serviceChargeRate', v)} /></div>
          <div className="flex items-center gap-4 py-3.5">
            <span className="flex flex-1 flex-col"><span className="text-[15px] font-medium">ปัดเศษยอดชำระ</span><span className="text-[13px] text-muted">แสดงเป็นบรรทัด “ปัดเศษ” บนใบเสร็จ</span></span>
            <Select className="w-[180px]" value={String(d.draft.roundingStep)} onChange={(e) => d.set('roundingStep', Number(e.target.value))}>
              <option value="0">ไม่ปัด</option><option value="25">ปัดเป็น 25 สตางค์</option><option value="50">ปัดเป็น 50 สตางค์</option><option value="100">ปัดเป็นบาท</option>
            </Select>
          </div>
        </div>
      </Card>
      <SaveBar dirty={d.dirty} saving={d.saving} onSave={() => void d.save()} onReset={d.reset} />
    </>
  );
}

interface Method { id: string; code: string; name: string; kind: string; active: boolean; sort: number }
const METHOD_PRESETS: { code: string; name: string; kind: string; hint?: string }[] = [
  { code: 'card', name: 'บัตรเครดิต/เดบิต', kind: 'other', hint: 'เครื่อง EDC' },
  { code: 'truemoney', name: 'TrueMoney Wallet', kind: 'other' },
  { code: 'shopeepay', name: 'ShopeePay', kind: 'other' },
  { code: 'linepay', name: 'Rabbit LINE Pay', kind: 'other' },
  { code: 'alipay', name: 'Alipay', kind: 'other', hint: 'ลูกค้าจีน' },
  { code: 'wechat', name: 'WeChat Pay', kind: 'other', hint: 'ลูกค้าจีน' },
  { code: 'intl_qr', name: 'QR ต่างประเทศ', kind: 'other', hint: 'แอปที่รองรับ Thai QR' },
  { code: 'transfer_intl', name: 'โอนต่างประเทศ (SWIFT)', kind: 'other' },
  { code: 'cheque', name: 'เช็ค', kind: 'other' },
  { code: 'voucher', name: 'บัตรกำนัล/คูปอง', kind: 'other' },
  { code: 'foreign_cash', name: 'เงินสดต่างประเทศ', kind: 'other', hint: 'บันทึกเป็นบาท' },
  { code: 'credit', name: 'ค้างชำระ (ลูกหนี้)', kind: 'credit' },
];

const KIND_LABEL: Record<string, string> = { cash: 'เงินสด (มีเงินทอน)', promptpay: 'PromptPay QR', credit: 'ค้างชำระ/ลูกหนี้', other: 'อื่นๆ (โอน บัตร ฯลฯ)' };

export function PaymentsSection() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['payment-methods'], queryFn: () => api.get<Method[]>('/api/payment-methods') });
  const [edit, setEdit] = useState<Partial<Method> | null>(null);
  const presets = METHOD_PRESETS.filter((p) => !list.data?.some((m) => m.code === p.code));
  const save = async (m: Partial<Method>) => {
    try {
      const body = { name: m.name, code: m.code, kind: m.kind, active: m.active ?? true, sort: m.sort ?? 99 };
      if (m.id) await api.put(`/api/payment-methods/${m.id}`, body);
      else await api.post('/api/payment-methods', body);
      qc.invalidateQueries({ queryKey: ['payment-methods'] });
      qc.invalidateQueries({ queryKey: ['catalog'] });
      setEdit(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <SectionTitle title="วิธีชำระเงิน" sub="เพิ่ม ซ่อน หรือเปลี่ยนชื่อได้ตามร้าน" actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ kind: 'other', active: true, code: '', name: '' })}>เพิ่มวิธีชำระ</Button>} />
      <Card className="max-w-[720px]" pad={false}>
        {list.data?.map((m) => (
          <div key={m.id} className="flex items-center gap-3 border-b border-line-soft px-5 py-3 last:border-0">
            <button className="flex flex-1 flex-col text-left" onClick={() => setEdit(m)}><span className="font-medium">{m.name}</span><span className="text-[13px] text-muted">{KIND_LABEL[m.kind] ?? m.kind} · {m.code}</span></button>
            <Switch size="sm" checked={m.active} disabled={m.code === 'cash'} onChange={(active) => void save({ ...m, active })} label={`เปิดใช้ ${m.name}`} />
          </div>
        ))}
      </Card>
      {presets.length > 0 && (
        <Card className="max-w-[720px]" title="เพิ่มวิธีชำระยอดนิยม">
          <p className="-mt-2 text-[13px] text-muted">กดเพื่อเพิ่ม · ตอนรับเงินจะบันทึกยอดและเลขอ้างอิง (เช่น เลขอนุมัติจากเครื่อง EDC หรือเลขรายการ)</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button key={p.code} onClick={() => void save({ code: p.code, name: p.name, kind: p.kind, active: true, sort: 20 })} className="flex h-10 items-center gap-1.5 rounded-full border border-line-strong px-3.5 text-[14px] hover:border-primary hover:bg-soft">
                <Plus className="h-4 w-4 text-primary" />
                {p.name}
                {p.hint && <span className="text-[12px] text-muted">· {p.hint}</span>}
              </button>
            ))}
          </div>
        </Card>
      )}
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} title={edit?.id ? 'แก้ไขวิธีชำระ' : 'เพิ่มวิธีชำระ'} size="sm" footer={<><Button onClick={() => setEdit(null)}>ยกเลิก</Button><Button variant="primary" disabled={!edit?.name?.trim() || !edit?.code?.trim()} onClick={() => edit && void save(edit)}>บันทึก</Button></>}>
        {edit && (
          <div className="flex flex-col gap-4 pb-2">
            <Field label="ชื่อที่แสดง" required><Input autoFocus value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="เช่น TrueMoney / บัตรของขวัญ" /></Field>
            <Field label="รหัส (ภาษาอังกฤษ)" hint="ใช้ในรายงาน เปลี่ยนไม่ได้หลังสร้าง"><Input disabled={!!edit.id} value={edit.code ?? ''} onChange={(e) => setEdit({ ...edit, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /></Field>
            <Field label="ประเภท">
              <Select disabled={edit.code === 'cash'} value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>
                {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="ลำดับ"><NumberInput value={edit.sort ?? 99} onValue={(sort) => setEdit({ ...edit, sort })} /></Field>
          </div>
        )}
      </Dialog>
    </>
  );
}

const MODULES: { key: keyof ReturnType<typeof useSettings>['modules']; label: string; hint: string }[] = [
  { key: 'stock', label: 'สต็อกสินค้า', hint: 'ตัดสต็อก รับเข้า นับสต็อก แจ้งเตือนใกล้หมด' },
  { key: 'members', label: 'สมาชิก', hint: 'สะสมแต้ม ส่วนลดสมาชิก ค้างชำระ' },
  { key: 'promotions', label: 'โปรโมชั่น', hint: 'ส่วนลดอัตโนมัติ ซื้อ X แถม Y คูปอง' },
  { key: 'restaurant', label: 'โหมดร้านอาหาร', hint: 'ผังโต๊ะ ส่งครัว ค่าบริการ แอปรับออเดอร์' },
  { key: 'kitchenDisplay', label: 'จอครัว (KDS)', hint: 'แสดงออเดอร์บนจอในครัวแทน/ร่วมกับเครื่องพิมพ์' },
  { key: 'customerDisplay', label: 'จอแสดงผลฝั่งลูกค้า', hint: 'แสดงรายการและ QR ชำระเงินบนจอที่สอง' },
  { key: 'multiBranch', label: 'หลายสาขา', hint: 'แยกสต็อกและรายงานตามสาขา โอนสินค้าระหว่างสาขา' },
  { key: 'lotTracking', label: 'ล็อตและวันหมดอายุ', hint: 'รับสินค้าเข้าพร้อมเลขล็อต ตัดสต็อกตามวันหมดอายุก่อน' },
];

export function ModulesSection() {
  const d = useDraft('modules');
  return (
    <>
      <SectionTitle title="โมดูลและฟีเจอร์" sub="ปิดสิ่งที่ไม่ใช้ เพื่อให้หน้าจอเรียบง่ายสำหรับพนักงาน" />
      <Card className="max-w-[720px]"><div className="-my-2 flex flex-col">{MODULES.map((m) => <ToggleRow key={m.key} label={m.label} hint={m.hint} checked={d.draft[m.key]} onChange={(v) => d.set(m.key, v)} />)}</div></Card>
      <SaveBar dirty={d.dirty} saving={d.saving} onSave={() => void d.save()} onReset={d.reset} />
    </>
  );
}

const HOTKEY_ACTIONS: { key: string; label: string; def: string }[] = [
  { key: 'search', label: 'ค้นหาสินค้า', def: 'F2' },
  { key: 'member', label: 'เลือกสมาชิก', def: 'F4' },
  { key: 'hold', label: 'พักบิล', def: 'F6' },
  { key: 'recall', label: 'เรียกบิล / เลือกโต๊ะ', def: 'F7' },
  { key: 'discount', label: 'ส่วนลดท้ายบิล', def: 'F8' },
  { key: 'drawer', label: 'เปิดลิ้นชัก', def: 'F9' },
  { key: 'pay', label: 'ชำระเงิน', def: 'F12' },
];

export function PosSection() {
  const pos = useDraft('pos');
  const points = useDraft('points');
  const settings = useSettings();
  const nav = useNavigate();
  const [register, setRegister] = useState(registerName());
  const keys = { ...Object.fromEntries(HOTKEY_ACTIONS.map((a) => [a.key, a.def])), ...pos.draft.hotkeys };
  const dirty = pos.dirty || points.dirty;
  return (
    <>
      <SectionTitle title="หน้าขาย" />
      <Card className="max-w-[760px]" title="เครื่องนี้">
        <Field label="ชื่อเครื่อง (จุดขาย)" hint="กะการทำงานแยกตามชื่อเครื่อง ตั้งให้ไม่ซ้ำกันในร้าน">
          <div className="flex gap-2"><Input value={register} onChange={(e) => setRegister(e.target.value)} /><Button onClick={() => { setRegisterName(register); toast.success('ตั้งชื่อเครื่องแล้ว'); }}>บันทึก</Button></div>
        </Field>
      </Card>
      <Card className="max-w-[760px]" title="การขาย">
        <div className="-my-2 flex flex-col">
          <ToggleRow label="ต้องเปิดกะก่อนขาย" hint="บังคับนับเงินทอนเริ่มต้นและปิดกะ" checked={pos.draft.requireShift} onChange={(v) => pos.set('requireShift', v)} />
          <ToggleRow label="อนุญาตขายเมื่อสต็อกไม่พอ (ติดลบ)" checked={pos.draft.allowNegativeStock} onChange={(v) => pos.set('allowNegativeStock', v)} />
          <ToggleRow label="แสดงรูปสินค้าในหน้าขาย" checked={pos.draft.showImages} onChange={(v) => pos.set('showImages', v)} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="ล็อกหน้าจออัตโนมัติ (นาที)" hint="0 = ไม่ล็อก"><NumberInput value={pos.draft.autoLockMinutes} onValue={(v) => pos.set('autoLockMinutes', Math.max(0, Math.min(240, v)))} /></Field>
          <Field label="จำนวนคอลัมน์สินค้า" hint="0 = อัตโนมัติตามขนาดจอ"><NumberInput value={pos.draft.gridColumns} onValue={(v) => pos.set('gridColumns', Math.max(0, Math.min(8, v)))} /></Field>
        </div>
        <Field label="ปุ่มธนบัตรลัด (บาท)" hint="คั่นด้วยเครื่องหมายจุลภาค">
          <Input value={pos.draft.quickNotes.map((n) => n / 100).join(', ')} onChange={(e) => pos.set('quickNotes', e.target.value.split(',').map((x) => Math.round(Number(x.trim()) * 100)).filter((n) => n > 0).slice(0, 8))} />
        </Field>
      </Card>
      <Card className="max-w-[760px]" title="คีย์ลัด">
        <div className="grid gap-2 md:grid-cols-2">
          {HOTKEY_ACTIONS.map((a) => (
            <div key={a.key} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
              <span className="text-[14px]">{a.label}</span>
              <Select className="h-10 w-24" value={keys[a.key]} onChange={(e) => pos.set('hotkeys', { ...pos.draft.hotkeys, [a.key]: e.target.value })} aria-label={`คีย์ลัด ${a.label}`}>
                {Array.from({ length: 12 }, (_, i) => `F${i + 1}`).map((k) => <option key={k} value={k}>{k}</option>)}
              </Select>
            </div>
          ))}
        </div>
      </Card>
      {settings.modules.members && (
        <Card className="max-w-[760px]" title="แต้มสะสม">
          <div className="-my-2 flex flex-col"><ToggleRow label="เปิดระบบแต้มสะสม" checked={points.draft.enabled} onChange={(v) => points.set('enabled', v)} /></div>
          {points.draft.enabled && (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="ซื้อทุกๆ (บาท) ได้ 1 แต้ม"><MoneyInput value={points.draft.earnPerSatang} onValue={(v) => points.set('earnPerSatang', Math.max(100, v))} /></Field>
              <Field label="1 แต้มมีมูลค่า" hint={`100 แต้ม = ${money(points.draft.pointValue * 100)}`}><MoneyInput value={points.draft.pointValue} onValue={(v) => points.set('pointValue', v)} /></Field>
            </div>
          )}
          <Button size="sm" variant="ghost" className="self-start" onClick={() => nav('/customers')}>จัดการกลุ่มและระดับสมาชิก ›</Button>
        </Card>
      )}
      <Badge tone="info" className="self-start">การตั้งค่าหน้าขายมีผลทุกเครื่องในร้าน ยกเว้นชื่อเครื่อง</Badge>
      <SaveBar dirty={dirty} saving={pos.saving || points.saving} onSave={() => void pos.save({ points: points.draft })} onReset={() => (pos.reset(), points.reset())} />
    </>
  );
}
