import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Calendar, CheckSquare, Hash, Image, List, Package, Pencil, Plus, Receipt, ShoppingCart, BarChart3, Trash2, Truck, Type, Users, Sparkles, ArrowRight } from 'lucide-react';
import { CUSTOM_FIELD_TYPES } from '@flexpos/shared';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Badge, Button, Card, Checkbox, Field, Input, Textarea } from '@/components/ui/core';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { SectionTitle } from './common';

type Entity = 'product' | 'customer' | 'supplier';
type FType = (typeof CUSTOM_FIELD_TYPES)[number];

interface FieldDef {
  id: string;
  entity: Entity;
  key: string;
  label: string;
  type: FType;
  options: string[];
  required: boolean;
  showInPos: boolean;
  showOnReceipt: boolean;
  showInReport: boolean;
  sort: number;
}

type Draft = Partial<FieldDef> & { optionsText?: string; showKey?: boolean };

const TYPE: Record<FType, { label: string; icon: ReactNode; sample: string }> = {
  text: { label: 'ข้อความ', icon: <Type />, sample: 'เช่น ยี่ห้อ, หมายเหตุ' },
  number: { label: 'ตัวเลข', icon: <Hash />, sample: 'เช่น น้ำหนัก, ขนาด' },
  date: { label: 'วันที่', icon: <Calendar />, sample: 'เช่น วันหมดอายุ' },
  select: { label: 'ตัวเลือก', icon: <List />, sample: 'เลือกจากรายการ เช่น สี' },
  checkbox: { label: 'ช่องติ๊ก', icon: <CheckSquare />, sample: 'ใช่/ไม่ใช่ เช่น ยาควบคุม' },
  image: { label: 'รูปภาพ', icon: <Image />, sample: 'เช่น รูปใบอนุญาต' },
};

const ENTITY: Record<Entity, { label: string; icon: ReactNode; where: string }> = {
  product: { label: 'สินค้า', icon: <Package />, where: 'ช่องใหม่จะอยู่ในหน้า สินค้า → แก้ไขสินค้า' },
  customer: { label: 'ลูกค้า/สมาชิก', icon: <Users />, where: 'ช่องใหม่จะอยู่ในหน้า สมาชิก → ข้อมูลสมาชิก' },
  supplier: { label: 'ซัพพลายเออร์', icon: <Truck />, where: 'ช่องใหม่จะอยู่ในหน้า สต็อก → ซัพพลายเออร์' },
};

const TEMPLATES: Record<Entity, { label: string; type: FType; options?: string[]; pos?: boolean; receipt?: boolean }[]> = {
  product: [
    { label: 'วันหมดอายุ', type: 'date', pos: true },
    { label: 'เลขทะเบียนยา', type: 'text', receipt: true },
    { label: 'ยี่ห้อ', type: 'text' },
    { label: 'ประเทศผู้ผลิต', type: 'text' },
    { label: 'ยาควบคุม (ต้องมีใบสั่งแพทย์)', type: 'checkbox', pos: true },
    { label: 'การรับประกัน', type: 'select', options: ['ไม่มี', '7 วัน', '3 เดือน', '1 ปี'], receipt: true },
  ],
  customer: [
    { label: 'LINE ID', type: 'text' },
    { label: 'ทะเบียนรถ', type: 'text' },
    { label: 'แพ้อาหาร/แพ้ยา', type: 'text' },
    { label: 'ช่องทางที่รู้จักร้าน', type: 'select', options: ['Facebook', 'TikTok', 'Google', 'เพื่อนแนะนำ', 'เดินผ่าน'] },
  ],
  supplier: [
    { label: 'เลขบัญชีธนาคาร', type: 'text' },
    { label: 'เครดิตเทอม (วัน)', type: 'number' },
    { label: 'วันส่งของประจำ', type: 'select', options: ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'] },
  ],
};

/** Field codes are internal; generate one from the label so users never have to think about it. */
function autoKey(label: string, taken: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1') || 'field';
  let k = base;
  let n = 2;
  while (taken.includes(k)) k = `${base}_${n++}`;
  return k;
}

export function CustomFieldsSection() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [entity, setEntity] = useState<Entity>('product');
  const [edit, setEdit] = useState<Draft | null>(null);
  const list = useQuery({ queryKey: ['custom-fields', 'all'], queryFn: () => api.get<FieldDef[]>('/api/custom-fields') });
  const all = list.data ?? [];
  const rows = all.filter((f) => f.entity === entity);
  const taken = all.filter((f) => f.entity === (edit?.entity ?? entity)).map((f) => f.key);

  const openNew = (t?: (typeof TEMPLATES)[Entity][number]) =>
    setEdit({ entity, type: t?.type ?? 'text', label: t?.label ?? '', optionsText: t?.options?.join('\n') ?? '', showInPos: !!t?.pos, showOnReceipt: !!t?.receipt, showInReport: true, required: false });

  const save = async () => {
    if (!edit?.label?.trim()) return;
    const key = edit.key || autoKey(edit.label, taken);
    const body = {
      entity: edit.entity,
      key,
      label: edit.label.trim(),
      type: edit.type,
      options: (edit.optionsText ?? edit.options?.join('\n') ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
      required: !!edit.required,
      showInPos: !!edit.showInPos,
      showOnReceipt: !!edit.showOnReceipt,
      showInReport: !!edit.showInReport,
      sort: edit.sort ?? rows.length,
    };
    try {
      if (edit.id) await api.put(`/api/custom-fields/${edit.id}`, body);
      else await api.post('/api/custom-fields', body);
      qc.invalidateQueries({ queryKey: ['custom-fields'] });
      toast.success(edit.id ? 'บันทึกแล้ว' : `เพิ่มช่อง “${body.label}” แล้ว · ${ENTITY[body.entity!].where}`);
      setEdit(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const usedTemplates = new Set(rows.map((r) => r.label));
  const templates = TEMPLATES[entity].filter((t) => !usedTemplates.has(t.label));

  return (
    <>
      <SectionTitle title="ฟิลด์เพิ่มเติม" sub="สร้างช่องกรอกข้อมูลเพิ่มเอง ให้เหมาะกับธุรกิจของคุณ โดยไม่ต้องแก้โปรแกรม" />

      {/* What is this? */}
      <Card className="overflow-hidden" pad={false}>
        <div className="grid gap-0 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4 p-6">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-primary"><Sparkles className="h-4 w-4" />ฟิลด์เพิ่มเติมคืออะไร</span>
            <p className="text-[15px] leading-relaxed text-ink-2 [text-wrap:pretty]">
              ปกติสินค้ามีแค่ชื่อ ราคา บาร์โค้ด ถ้าร้านของคุณต้องเก็บข้อมูลอื่น เช่น <b>วันหมดอายุ</b> ของร้านยา, <b>ยี่ห้อ</b> ของร้านอะไหล่ หรือ <b>LINE ID</b> ของลูกค้า ก็สร้างช่องใหม่ได้ที่นี่
            </p>
            <ol className="flex flex-col gap-2.5">
              {[
                { icon: <Plus />, text: 'สร้างช่องใหม่ (หรือเลือกจากตัวอย่างด้านล่าง)' },
                { icon: <Pencil />, text: 'ช่องนั้นจะโผล่ในฟอร์มกรอกข้อมูลสินค้า/ลูกค้าทันที' },
                { icon: <Receipt />, text: 'เลือกได้ว่าจะให้แสดงในหน้าขาย บนใบเสร็จ หรือในรายงาน' },
              ].map((s, i) => (
                <li key={i} className="flex items-center gap-3 text-[14px]">
                  <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-soft text-[13px] font-semibold text-soft-fg">{i + 1}</span>
                  {s.text}
                </li>
              ))}
            </ol>
          </div>
          {/* Illustration: a product form gaining a new field */}
          <div className="flex items-center justify-center bg-canvas p-6">
            <div className="w-full max-w-[300px] rounded-2xl border border-line bg-surface p-4 shadow-lift" aria-hidden>
              <div className="mb-3 text-[13px] font-semibold">แก้ไขสินค้า</div>
              <MockField label="ชื่อสินค้า" value="พาราเซตามอล 500 มก." />
              <MockField label="ราคาขาย" value="฿35.00" />
              <div className="relative mt-2 rounded-xl border-2 border-dashed border-primary bg-soft/50 p-2.5">
                <span className="absolute -top-2.5 right-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-fg">ช่องที่คุณสร้าง</span>
                <div className="text-[11px] font-medium text-soft-fg">วันหมดอายุ</div>
                <div className="mt-1 flex h-8 items-center rounded-lg border border-line bg-surface px-2 text-[12px]">31/12/2570</div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Entity tabs */}
      <div className="grid gap-2 sm:grid-cols-3" role="tablist">
        {(Object.keys(ENTITY) as Entity[]).map((e) => {
          const n = all.filter((f) => f.entity === e).length;
          return (
            <button key={e} role="tab" aria-selected={entity === e} onClick={() => setEntity(e)} className={cn('flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors [&_svg]:h-5 [&_svg]:w-5', entity === e ? 'border-primary bg-soft ring-1 ring-primary' : 'border-line bg-surface hover:bg-sunken')}>
              <span className={cn('grid h-10 w-10 flex-none place-items-center rounded-xl', entity === e ? 'bg-primary text-primary-fg' : 'bg-canvas text-ink-2')}>{ENTITY[e].icon}</span>
              <span className="flex flex-col">
                <span className="font-semibold">ช่องของ{ENTITY[e].label}</span>
                <span className="text-[12px] text-muted">{n ? `${n} ช่อง` : 'ยังไม่มี'}</span>
              </span>
            </button>
          );
        })}
      </div>

      <Card
        title={`ช่องข้อมูลเพิ่มเติมของ${ENTITY[entity].label}`}
        action={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openNew()}>สร้างช่องใหม่</Button>}
      >
        <p className="-mt-2 flex items-center gap-1.5 text-[13px] text-muted"><ArrowRight className="h-3.5 w-3.5" />{ENTITY[entity].where}</p>
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong p-6 text-center">
            <p className="font-semibold">ยังไม่มีช่องเพิ่มเติมของ{ENTITY[entity].label}</p>
            <p className="mt-1 text-[14px] text-muted">เริ่มจากตัวอย่างด้านล่างได้เลย กดแล้วปรับแต่งก่อนบันทึก</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {rows.map((f) => (
              <div key={f.id} className="flex items-center gap-3 border-b border-line-soft py-3 last:border-0">
                <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-canvas text-ink-2 [&_svg]:h-[18px] [&_svg]:w-[18px]">{TYPE[f.type].icon}</span>
                <button className="flex min-w-0 flex-1 flex-col text-left" onClick={() => setEdit(f)}>
                  <span className="font-medium">
                    {f.label} {f.required && <span className="text-[12px] font-normal text-danger">· จำเป็นต้องกรอก</span>}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    <Badge>{TYPE[f.type].label}{f.type === 'select' ? `: ${f.options.slice(0, 3).join(', ')}${f.options.length > 3 ? '…' : ''}` : ''}</Badge>
                    {f.showInPos && <Badge tone="info"><ShoppingCart className="h-3 w-3" />หน้าขาย</Badge>}
                    {f.showOnReceipt && <Badge tone="info"><Receipt className="h-3 w-3" />ใบเสร็จ</Badge>}
                    {f.showInReport && <Badge tone="info"><BarChart3 className="h-3 w-3" />รายงาน</Badge>}
                  </span>
                </button>
                <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(f)}>แก้ไข</Button>
                <Button size="sm" variant="ghost" className="text-danger" aria-label={`ลบ ${f.label}`} onClick={async () => { const r = await confirm({ title: `ลบช่อง “${f.label}”?`, body: 'ช่องนี้จะหายจากฟอร์ม ข้อมูลที่เคยกรอกจะไม่แสดงอีก', danger: true, confirmText: 'ลบ' }); if (r.ok) { await api.del(`/api/custom-fields/${f.id}`); qc.invalidateQueries({ queryKey: ['custom-fields'] }); } }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
        {templates.length > 0 && (
          <div className="flex flex-col gap-2 pt-1">
            <span className="text-[13px] font-semibold text-muted">ตัวอย่างที่ร้านค้ามักใช้ (กดเพื่อเพิ่ม)</span>
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <button key={t.label} onClick={() => openNew(t)} className="flex h-10 items-center gap-2 rounded-full border border-line-strong bg-surface px-3.5 text-[14px] hover:border-primary hover:bg-soft [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-muted">
                  {TYPE[t.type].icon}
                  {t.label}
                  <Plus className="!text-primary" />
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      <FieldEditor edit={edit} setEdit={setEdit} onSave={() => void save()} />
    </>
  );
}

function MockField({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-1 flex h-8 items-center rounded-lg border border-line px-2 text-[12px]">{value}</div>
    </div>
  );
}

function FieldEditor({ edit, setEdit, onSave }: { edit: Draft | null; setEdit: (d: Draft | null) => void; onSave: () => void }) {
  if (!edit) return null;
  const options = (edit.optionsText ?? edit.options?.join('\n') ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const invalid = !edit.label?.trim() || (edit.type === 'select' && options.length === 0);
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && setEdit(null)}
      title={edit.id ? `แก้ไขช่อง “${edit.label}”` : `สร้างช่องใหม่ของ${ENTITY[edit.entity ?? 'product'].label}`}
      size="lg"
      footer={
        <>
          <Button onClick={() => setEdit(null)}>ยกเลิก</Button>
          <Button variant="primary" disabled={invalid} onClick={onSave}>{edit.id ? 'บันทึก' : 'สร้างช่อง'}</Button>
        </>
      }
    >
      <div className="grid gap-5 pb-3 md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="flex flex-col gap-4">
          <Field label="1. ชื่อช่อง (ที่พนักงานจะเห็น)" required>
            <Input autoFocus value={edit.label ?? ''} onChange={(e) => setEdit({ ...edit, label: e.target.value })} placeholder="เช่น วันหมดอายุ" />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-muted">2. ข้อมูลแบบไหน</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CUSTOM_FIELD_TYPES.map((t) => (
                <button key={t} type="button" onClick={() => setEdit({ ...edit, type: t })} aria-pressed={edit.type === t} className={cn('flex flex-col gap-1 rounded-xl border p-2.5 text-left [&_svg]:h-4 [&_svg]:w-4', edit.type === t ? 'border-primary bg-soft ring-1 ring-primary' : 'border-line hover:bg-sunken')}>
                  <span className="flex items-center gap-1.5 text-[14px] font-medium">{TYPE[t].icon}{TYPE[t].label}</span>
                  <span className="text-[11px] text-muted">{TYPE[t].sample}</span>
                </button>
              ))}
            </div>
          </div>
          {edit.type === 'select' && (
            <Field label="ตัวเลือกให้เลือก (บรรทัดละ 1 ค่า)" required>
              <Textarea value={edit.optionsText ?? edit.options?.join('\n') ?? ''} onChange={(e) => setEdit({ ...edit, optionsText: e.target.value })} placeholder={'แดง\nเขียว\nน้ำเงิน'} />
            </Field>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-muted">3. ให้แสดงที่ไหนบ้าง</span>
            {edit.entity === 'product' && (
              <>
                <Checkbox checked={!!edit.showInPos} onChange={(showInPos) => setEdit({ ...edit, showInPos })} label="หน้าขาย — แคชเชียร์เห็นตอนขาย" />
                <Checkbox checked={!!edit.showOnReceipt} onChange={(showOnReceipt) => setEdit({ ...edit, showOnReceipt })} label="พิมพ์บนใบเสร็จ — ลูกค้าเห็น" />
              </>
            )}
            <Checkbox checked={!!edit.showInReport} onChange={(showInReport) => setEdit({ ...edit, showInReport })} label="ในรายงานและไฟล์ส่งออก" />
            <Checkbox checked={!!edit.required} onChange={(required) => setEdit({ ...edit, required })} label="บังคับกรอก (บันทึกไม่ได้ถ้าเว้นว่าง)" />
          </div>
          {!edit.id && (
            <button type="button" className="self-start text-[12px] text-muted underline" onClick={() => setEdit({ ...edit, showKey: !edit.showKey })}>
              ตั้งค่าขั้นสูง
            </button>
          )}
          {(edit.showKey || edit.id) && (
            <Field label="รหัสฟิลด์ (สำหรับนำเข้า/ส่งออกข้อมูล)" hint={edit.id ? 'เปลี่ยนไม่ได้หลังสร้าง' : 'เว้นว่างเพื่อสร้างให้อัตโนมัติ · a-z 0-9 _'}>
              <Input disabled={!!edit.id} className="font-mono" value={edit.key ?? ''} onChange={(e) => setEdit({ ...edit, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} placeholder="expiry_date" />
            </Field>
          )}
        </div>
        {/* Live preview */}
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium text-muted">ตัวอย่างที่จะเห็นในฟอร์ม</span>
          <div className="rounded-2xl border border-line bg-canvas p-4">
            <div className="rounded-xl bg-surface p-3 shadow-card">
              <div className="text-[12px] font-medium text-muted">
                {edit.label || 'ชื่อช่อง'}
                {edit.required && <span className="text-danger"> *</span>}
              </div>
              <div className="mt-1.5">
                {edit.type === 'checkbox' ? (
                  <span className="flex items-center gap-2 text-[13px]"><span className="h-4 w-4 rounded border border-line-strong" />{edit.label || 'ใช่'}</span>
                ) : edit.type === 'select' ? (
                  <div className="flex h-9 items-center justify-between rounded-lg border border-line px-2 text-[13px]">{options[0] ?? 'เลือก…'}<List className="h-3.5 w-3.5 text-muted" /></div>
                ) : edit.type === 'image' ? (
                  <div className="grid h-16 place-items-center rounded-lg border border-dashed border-line-strong text-[12px] text-muted">แนบรูป</div>
                ) : (
                  <div className="flex h-9 items-center rounded-lg border border-line px-2 text-[13px] text-faint">{edit.type === 'date' ? 'วว/ดด/ปปปป' : edit.type === 'number' ? '0' : 'พิมพ์ข้อความ'}</div>
                )}
              </div>
            </div>
            {edit.entity === 'product' && edit.showOnReceipt && (
              <div className="mt-3 rounded-lg border border-line bg-white p-2.5 font-mono text-[11px] text-ink-2">
                1× พาราเซตามอล ...... 35.00
                <div className="pl-3 text-muted">{edit.label || 'ชื่อช่อง'}: {edit.type === 'select' ? (options[0] ?? '…') : '…'}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
