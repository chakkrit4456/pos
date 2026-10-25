import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, errorMessage } from '@/lib/api';
import { money } from '@/lib/settings';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, SkeletonRows, Switch } from '@/components/ui/core';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { MoneyInput, NumberInput } from '@/components/ui/inputs';
import type { CategoryRow } from './ProductsPage';
import { t } from '@flexpos/shared';
import { tn } from '@/lib/i18n';

const COLORS = ['', '#e9dfd2', '#dcebd6', '#f3e3c3', '#d9e8f2', '#e6e1f0', '#f6dccb', '#fde2e4', '#e2f0cb', '#cde7f0'];

export function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {COLORS.map((c) => (
        <button key={c || 'none'} type="button" onClick={() => onChange(c)} aria-label={c || t('อัตโนมัติ')} aria-pressed={value === c} className={`h-9 w-9 rounded-xl border ${value === c ? 'ring-2 ring-primary ring-offset-2' : 'border-line-strong'}`} style={{ background: c || 'repeating-linear-gradient(45deg,#fff,#fff 4px,#eee 4px,#eee 8px)' }} />
      ))}
    </div>
  );
}

/* ---------- Categories ---------- */

export function CategoriesTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const list = useQuery({ queryKey: ['categories'], queryFn: () => api.get<CategoryRow[]>('/api/categories') });
  const [edit, setEdit] = useState<Partial<CategoryRow> | null>(null);
  const [del, setDel] = useState<CategoryRow | null>(null);
  const [moveTo, setMoveTo] = useState('none');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const rows = list.data ?? [];
  const doDelete = async () => {
    if (!del) return;
    try {
      const r = await api.del<{ movedProducts: number }>(`/api/categories/${del.id}?moveTo=${encodeURIComponent(moveTo)}`);
      toast.success(t('ลบหมวด {0} แล้ว · ย้ายสินค้า {1} รายการ', del.name, r.movedProducts));
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      setDel(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const tops = rows.filter((r) => !r.parentId);
  const ordered = tops.flatMap((t) => [t, ...rows.filter((r) => r.parentId === t.id)]);

  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(ordered, ordered.findIndex((r) => r.id === e.active.id), ordered.findIndex((r) => r.id === e.over!.id));
    qc.setQueryData(['categories'], next);
    await api.post('/api/categories/reorder', { ids: next.map((r) => r.id) }).catch((err) => toast.error(errorMessage(err)));
    qc.invalidateQueries({ queryKey: ['categories'] });
  };

  const save = async () => {
    if (!edit?.name?.trim()) return;
    try {
      const body = { name: edit.name, parentId: edit.parentId || null, color: edit.color ?? '', sort: edit.sort ?? rows.length, station: edit.station || null, active: edit.active ?? true };
      if (edit.id) await api.put(`/api/categories/${edit.id}`, body);
      else await api.post('/api/categories', body);
      qc.invalidateQueries({ queryKey: ['categories'] });
      setEdit(null);
      toast.success(t('บันทึกหมวดหมู่แล้ว'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader title={t('หมวดหมู่')} sub={t('ลากเพื่อจัดลำดับที่แสดงในหน้าขาย · หมวดย่อยได้ 1 ระดับ')} actions={can('products.manage') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ active: true, color: '' })}>{t('เพิ่มหมวดหมู่')}</Button>} />
      <div className="card overflow-hidden">
        {list.isLoading ? (
          <SkeletonRows />
        ) : !rows.length ? (
          <EmptyState title={t('ยังไม่มีหมวดหมู่')} body={t('หมวดหมู่ช่วยให้แคชเชียร์หาสินค้าได้เร็วขึ้น และใช้แยกเครื่องพิมพ์ครัว/บาร์')} />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onDragEnd(e)}>
            <SortableContext items={ordered.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              {ordered.map((c) => (
                <SortRow key={c.id} id={c.id}>
                  <span className="h-8 w-8 flex-none rounded-lg border border-line" style={{ background: c.color || '#f6f5f1' }} />
                  <button className="flex flex-1 flex-col text-left" onClick={() => setEdit(c)}>
                    <span className="font-medium">
                      {c.parentId && <span className="text-faint">↳ </span>}
                      {c.name}
                    </span>
                    <span className="text-[13px] text-muted">{tn('{0} สินค้า{1}', c.productCount, c.station ? t(' · ส่งไปที่ {0}', c.station === 'bar' ? t('บาร์') : c.station === 'kitchen' ? t('ครัว') : c.station) : '')}</span>
                  </button>
                  {!c.active && <Badge>{t('ซ่อน')}</Badge>}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    aria-label={t('ลบ {0}', c.name)}
                    onClick={async () => {
                      if (c.productCount > 0) {
                        setDel(c);
                        setMoveTo('none');
                        return;
                      }
                      const r = await confirm({ title: t('ลบหมวด “{0}”?', c.name), body: rows.some((x) => x.parentId === c.id) ? t('หมวดย่อยจะถูกย้ายขึ้นไปอยู่ระดับเดียวกับหมวดนี้') : undefined, danger: true, confirmText: t('ลบ') });
                      if (!r.ok) return;
                      try {
                        await api.del(`/api/categories/${c.id}`);
                        qc.invalidateQueries({ queryKey: ['categories'] });
                        toast.success(t('ลบหมวด {0} แล้ว', c.name));
                      } catch (e) {
                        toast.error(errorMessage(e));
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </SortRow>
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
      <Dialog
        open={!!del}
        onOpenChange={(v) => !v && setDel(null)}
        title={t('ลบหมวด “{0}”', del?.name ?? '')}
        description={t('หมวดนี้มีสินค้า {0} รายการ สินค้าจะไม่ถูกลบ เลือกว่าจะย้ายไปไว้ที่ไหน', del?.productCount ?? 0)}
        size="sm"
        footer={
          <>
            <Button onClick={() => setDel(null)}>{t('ยกเลิก')}</Button>
            <Button variant="danger" onClick={() => void doDelete()}>{t('ย้ายสินค้าและลบหมวด')}</Button>
          </>
        }
      >
        <div className="pb-2">
          <Field label={t('ย้ายสินค้าไปที่')}>
            <Select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="none">{t('ไม่มีหมวด')}</option>
              {rows.filter((r) => r.id !== del?.id).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.parentId ? '— ' : ''}
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={edit?.id ? t('แก้ไขหมวดหมู่') : t('เพิ่มหมวดหมู่')}
        size="sm"
        footer={
          <>
            <Button onClick={() => setEdit(null)}>{t('ยกเลิก')}</Button>
            <Button variant="primary" onClick={() => void save()} disabled={!edit?.name?.trim()}>{t('บันทึก')}</Button>
          </>
        }
      >
        {edit && (
          <div className="flex flex-col gap-4 pb-2">
            <Field label={t('ชื่อหมวด')} required>
              <Input autoFocus value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label={t('อยู่ภายใต้หมวด')}>
              <Select value={edit.parentId ?? ''} onChange={(e) => setEdit({ ...edit, parentId: e.target.value || null })}>
                <option value="">{t('— หมวดหลัก —')}</option>
                {tops.filter((t) => t.id !== edit.id).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('ส่งออเดอร์ไปที่')} hint={t('ใช้แยกใบออเดอร์ไปเครื่องพิมพ์ครัว/บาร์')}>
              <Select value={edit.station ?? ''} onChange={(e) => setEdit({ ...edit, station: e.target.value || null })}>
                <option value="">{t('ครัว (ค่าเริ่มต้น)')}</option>
                <option value="kitchen">{t('ครัว')}</option>
                <option value="bar">{t('บาร์เครื่องดื่ม')}</option>
              </Select>
            </Field>
            <Field label={t('สีปุ่มในหน้าขาย')}>
              <ColorPicker value={edit.color ?? ''} onChange={(color) => setEdit({ ...edit, color })} />
            </Field>
            <label className="flex items-center justify-between">
              <span>{t('แสดงในหน้าขาย')}</span>
              <Switch checked={edit.active ?? true} onChange={(active) => setEdit({ ...edit, active })} />
            </label>
          </div>
        )}
      </Dialog>
    </>
  );
}

function SortRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="flex items-center gap-3 border-b border-line-soft bg-surface px-4 py-3">
      <button {...attributes} {...listeners} className="grid h-9 w-7 cursor-grab place-items-center text-faint" aria-label={t('ลากเพื่อจัดเรียง')}>
        <GripVertical className="h-4 w-4" />
      </button>
      {children}
    </div>
  );
}

/* ---------- Modifier groups ---------- */

interface ModGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: { id?: string; name: string; priceDelta: number; active: boolean }[];
}

export function ModifiersTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const list = useQuery({ queryKey: ['modifier-groups'], queryFn: () => api.get<ModGroup[]>('/api/modifier-groups') });
  const [edit, setEdit] = useState<ModGroup | null>(null);
  const save = async () => {
    if (!edit) return;
    try {
      const body = { name: edit.name, minSelect: edit.minSelect, maxSelect: edit.maxSelect, modifiers: edit.modifiers.filter((m) => m.name.trim()) };
      if (edit.id) await api.put(`/api/modifier-groups/${edit.id}`, body);
      else await api.post('/api/modifier-groups', body);
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      setEdit(null);
      toast.success(t('บันทึกแล้ว'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <PageHeader title={t('ตัวเลือกเสริม')} sub={t('เช่น ขนาด ความหวาน ท็อปปิ้ง — ผูกกับสินค้าได้ในหน้าแก้ไขสินค้า')} actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ id: '', name: '', minSelect: 0, maxSelect: 1, modifiers: [{ name: '', priceDelta: 0, active: true }] })}>{t('เพิ่มกลุ่มตัวเลือก')}</Button>} />
      {list.isLoading ? (
        <SkeletonRows />
      ) : !list.data?.length ? (
        <Card><EmptyState title={t('ยังไม่มีกลุ่มตัวเลือก')} body={t('สร้างกลุ่ม เช่น “ความหวาน” แล้วเพิ่มตัวเลือก หวานน้อย/ปกติ/ไม่หวาน')} /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.data.map((g) => (
            <Card key={g.id} title={g.name} action={<Button size="sm" onClick={() => setEdit(structuredClone(g))}>{t('แก้ไข')}</Button>}>
              <span className="text-[13px] text-muted">{g.minSelect > 0 ? t('ต้องเลือกอย่างน้อย {0}', g.minSelect) : t('ไม่บังคับ')} · {g.maxSelect === 0 ? t('เลือกได้ไม่จำกัด') : t('เลือกได้สูงสุด {0}', g.maxSelect)}</span>
              <div className="flex flex-wrap gap-1.5">
                {g.modifiers.map((m) => (
                  <Badge key={m.id} tone={m.active ? 'neutral' : 'warn'}>
                    {m.name}
                    {m.priceDelta ? ` +${money(m.priceDelta)}` : ''}
                  </Badge>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={edit?.id ? t('แก้ไขกลุ่มตัวเลือก') : t('เพิ่มกลุ่มตัวเลือก')}
        footer={
          <>
            {edit?.id && (
              <Button
                variant="ghost"
                className="mr-auto text-danger"
                onClick={async () => {
                  const r = await confirm({ title: t('ลบกลุ่ม “{0}”?', edit.name), body: t('สินค้าที่ใช้กลุ่มนี้จะไม่มีตัวเลือกนี้อีก'), danger: true, confirmText: t('ลบ') });
                  if (!r.ok) return;
                  await api.del(`/api/modifier-groups/${edit.id}`);
                  qc.invalidateQueries({ queryKey: ['modifier-groups'] });
                  setEdit(null);
                }}
              >{t('ลบกลุ่ม')}</Button>
            )}
            <Button onClick={() => setEdit(null)}>{t('ยกเลิก')}</Button>
            <Button variant="primary" onClick={() => void save()} disabled={!edit?.name.trim() || !edit?.modifiers.some((m) => m.name.trim())}>{t('บันทึก')}</Button>
          </>
        }
      >
        {edit && (
          <div className="flex flex-col gap-4 pb-2">
            <Field label={t('ชื่อกลุ่ม')} required>
              <Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder={t('เช่น ความหวาน')} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('ต้องเลือกอย่างน้อย')} hint={t('0 = ไม่บังคับ')}>
                <NumberInput value={edit.minSelect} onValue={(minSelect) => setEdit({ ...edit, minSelect: Math.max(0, minSelect) })} />
              </Field>
              <Field label={t('เลือกได้สูงสุด')} hint={t('0 = ไม่จำกัด')}>
                <NumberInput value={edit.maxSelect} onValue={(maxSelect) => setEdit({ ...edit, maxSelect: Math.max(0, maxSelect) })} />
              </Field>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-medium text-muted">{t('ตัวเลือก')}</span>
              {edit.modifiers.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={m.name} onChange={(e) => setEdit({ ...edit, modifiers: edit.modifiers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder={t('ชื่อตัวเลือก')} />
                  <div className="w-[130px] flex-none">
                    <MoneyInput value={m.priceDelta} onValue={(priceDelta) => setEdit({ ...edit, modifiers: edit.modifiers.map((x, j) => (j === i ? { ...x, priceDelta } : x)) })} aria-label={t('บวกราคา')} />
                  </div>
                  <Switch size="sm" checked={m.active} onChange={(active) => setEdit({ ...edit, modifiers: edit.modifiers.map((x, j) => (j === i ? { ...x, active } : x)) })} label={t('เปิดใช้')} />
                  <Button size="sm" variant="ghost" aria-label={t('ลบตัวเลือก')} onClick={() => setEdit({ ...edit, modifiers: edit.modifiers.filter((_, j) => j !== i) })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button size="sm" className="self-start" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ ...edit, modifiers: [...edit.modifiers, { name: '', priceDelta: 0, active: true }] })}>{t('เพิ่มตัวเลือก')}</Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

/* ---------- Price tiers ---------- */

export function TiersTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const list = useQuery({ queryKey: ['price-tiers'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/price-tiers') });
  const [name, setName] = useState('');
  return (
    <>
      <PageHeader title={t('ระดับราคา')} sub={t('เช่น ราคาส่ง ราคาสมาชิก — กำหนดราคาต่อสินค้าในหน้าแก้ไขสินค้า และผูกกับกลุ่มลูกค้า')} />
      <Card>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.post('/api/price-tiers', { name });
              setName('');
              qc.invalidateQueries({ queryKey: ['price-tiers'] });
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('ชื่อระดับราคาใหม่')} />
          <Button type="submit" variant="primary" disabled={!name.trim()}>{t('เพิ่ม')}</Button>
        </form>
        {list.data?.map((tk) => (
          <div key={tk.id} className="flex items-center justify-between border-b border-line-soft py-2.5 last:border-0">
            <span className="font-medium">{tk.name}</span>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              onClick={async () => {
                const r = await confirm({ title: t('ลบระดับราคา “{0}”?', tk.name), body: t('ราคาที่ตั้งไว้ในสินค้าทั้งหมดของระดับนี้จะถูกลบ'), danger: true, confirmText: t('ลบ') });
                if (!r.ok) return;
                await api.del(`/api/price-tiers/${tk.id}`);
                qc.invalidateQueries({ queryKey: ['price-tiers'] });
              }}
            >{t('ลบ')}</Button>
          </div>
        ))}
      </Card>
    </>
  );
}
