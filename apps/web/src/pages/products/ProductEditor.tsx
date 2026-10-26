import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Barcode, ImagePlus, Plus, Trash2, Wand2 } from 'lucide-react';
import { PRODUCT_KINDS, type Catalog, type ProductInput, type ProductKind, t } from '@flexpos/shared';
import { api, errorMessage } from '@/lib/api';
import { money, useSettings } from '@/lib/settings';
import { useSession } from '@/lib/session';
import { imageToDataUrl, qtyText } from '@/lib/utils';
import { Page } from '@/components/layout/AppShell';
import { Badge, Button, Card, Checkbox, ErrorState, Field, Input, Select, Spinner, Textarea, ToggleRow } from '@/components/ui/core';
import { useConfirm } from '@/components/ui/dialog';
import { MoneyInput, NumberInput } from '@/components/ui/inputs';
import { ColorPicker } from './CatalogTabs';
import type { CategoryRow } from './ProductsPage';
import { tn } from '@/lib/i18n';

const KIND_LABEL: Record<ProductKind, string> = {
  standard: t('สินค้าทั่วไป'),
  weighted: t('ชั่งน้ำหนัก (ขายตาม กก.)'),
  open_price: t('ราคาเปิด (กรอกราคาตอนขาย)'),
  bundle: t('สินค้าชุด (ตัดสต็อกส่วนประกอบ)'),
  service: t('บริการ (ไม่มีสต็อก)'),
};

export interface CustomFieldDef {
  id: string;
  entity: string;
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'image';
  options: string[];
  required: boolean;
}

type Form = ProductInput & { stock?: { branchId: string; variantId: string; qty: number; avgCost: number }[] };

const blank = (): Form => ({
  name: '',
  sku: '',
  categoryId: null,
  kind: 'standard',
  unit: t('ชิ้น'),
  price: 0,
  cost: 0,
  taxable: true,
  trackStock: true,
  lowStock: 0,
  color: '',
  image: '',
  active: true,
  showInPos: true,
  barcodes: [],
  variants: [],
  units: [],
  modifierGroupIds: [],
  bundleItems: [],
  tierPrices: [],
  custom: {},
});

export default function ProductEditor() {
  const { id } = useParams();
  const isNew = !id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const settings = useSettings();
  const { can } = useSession();
  const [params] = useSearchParams();
  // /products/new?barcode=... comes from scanning an unknown code at the POS.
  const [f, setF] = useState<Form>(() => ({ ...blank(), barcodes: params.get('barcode') ? [params.get('barcode')!] : [] }));
  const [saving, setSaving] = useState(false);
  const [optionDefs, setOptionDefs] = useState<{ name: string; values: string }[]>([{ name: t('ไซซ์'), values: '' }]);

  const detail = useQuery({ queryKey: ['product', id], queryFn: () => api.get<Form>(`/api/products/${id}`), enabled: !isNew });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get<CategoryRow[]>('/api/categories') });
  const groups = useQuery({ queryKey: ['modifier-groups'], queryFn: () => api.get<{ id: string; name: string; modifiers: { name: string }[] }[]>('/api/modifier-groups') });
  const tiers = useQuery({ queryKey: ['price-tiers'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/price-tiers') });
  const fields = useQuery({ queryKey: ['custom-fields', 'product'], queryFn: () => api.get<CustomFieldDef[]>('/api/custom-fields', { entity: 'product' }) });
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => api.get<Catalog>('/api/catalog'), enabled: f.kind === 'bundle' });

  useEffect(() => {
    if (detail.data) setF({ ...blank(), ...detail.data });
  }, [detail.data]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const margin = f.price > 0 && f.cost > 0 ? Math.round(((f.price - f.cost) / f.price) * 1000) / 10 : null;
  const stockTotal = useMemo(() => (f.stock ?? []).reduce((a, s) => a + s.qty, 0), [f.stock]);

  const genBarcode = async (apply: (code: string) => void) => {
    try {
      const r = await api.post<{ code: string }>('/api/products/generate-barcode');
      apply(r.code);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const genVariants = () => {
    const defs = optionDefs.map((d) => ({ name: d.name.trim(), values: d.values.split(/[,،\n]/).map((v) => v.trim()).filter(Boolean) })).filter((d) => d.name && d.values.length);
    if (!defs.length) return toast.error(t('กรอกชื่อตัวเลือกและค่า เช่น ไซซ์: S, M, L'));
    let combos: Record<string, string>[] = [{}];
    for (const d of defs) combos = combos.flatMap((c) => d.values.map((v) => ({ ...c, [d.name]: v })));
    const existing = new Set(f.variants.map((v) => v.name));
    const add = combos
      .map((opts) => ({ name: Object.values(opts).join(' / '), options: opts, sku: f.sku ? `${f.sku}-${Object.values(opts).join('-')}` : '', barcode: '', price: f.price, cost: f.cost, active: true }))
      .filter((v) => !existing.has(v.name));
    set('variants', [...f.variants, ...add]);
    toast.success(t('เพิ่ม {0} ตัวเลือก', add.length));
  };

  const save = async () => {
    setSaving(true);
    try {
      const body: ProductInput = { ...f };
      delete (body as Form).stock;
      if (isNew) {
        const r = await api.post<{ id: string }>('/api/products', body);
        toast.success(t('เพิ่มสินค้าแล้ว'));
        qc.invalidateQueries({ queryKey: ['products'] });
        nav(`/products/${r.id}`, { replace: true });
      } else {
        await api.put(`/api/products/${id}`, body);
        toast.success(t('บันทึกแล้ว'));
        qc.invalidateQueries({ queryKey: ['products'] });
        qc.invalidateQueries({ queryKey: ['product', id] });
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!isNew && detail.isLoading) return <div className="grid h-full place-items-center"><Spinner /></div>;
  if (!isNew && detail.isError) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  const readOnly = !can('products.manage');
  const stockable = f.kind !== 'service' && f.kind !== 'bundle';

  return (
    <Page className="max-w-[1100px]">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => nav('/products')}>{t('สินค้า')}</Button>
        <h1 className="flex-1 truncate text-[24px] font-semibold">{isNew ? t('เพิ่มสินค้า') : f.name || t('แก้ไขสินค้า')}</h1>
        {!isNew && !readOnly && (
          <Button
            variant="ghost"
            className="text-danger"
            icon={<Trash2 className="h-4 w-4" />}
            onClick={async () => {
              const r = await confirm({ title: t('ลบ “{0}”?', f.name), body: t('ประวัติการขายยังอยู่ครบ บาร์โค้ดจะนำกลับมาใช้ได้'), danger: true, confirmText: t('ลบสินค้า') });
              if (!r.ok) return;
              await api.del(`/api/products/${id}`);
              qc.invalidateQueries({ queryKey: ['products'] });
              toast.success(t('ลบสินค้าแล้ว'));
              nav('/products');
            }}
          >{t('ลบ')}</Button>
        )}
        {!readOnly && (
          <Button variant="primary" size="lg" loading={saving} disabled={!f.name.trim()} onClick={() => void save()}>{t('บันทึก')}</Button>
        )}
      </div>

      <fieldset disabled={readOnly} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={t('ข้อมูลหลัก')}>
            <div className="flex flex-col gap-4 sm:flex-row">
              <label className="flex h-[112px] w-[112px] flex-none cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border border-dashed border-line-strong bg-sunken text-[12px] text-muted hover:border-primary">
                {f.image ? <img src={f.image} alt="" className="h-full w-full object-cover" /> : <><ImagePlus className="h-6 w-6" />{t('รูปสินค้า')}</>}
                <input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const file = e.target.files?.[0]; if (file) set('image', await imageToDataUrl(file, 320)); }} />
              </label>
              <div className="grid flex-1 gap-4 md:grid-cols-2">
                <Field label={t('ชื่อสินค้า')} required className="md:col-span-2">
                  <Input autoFocus={isNew} value={f.name} onChange={(e) => set('name', e.target.value)} />
                </Field>
                <Field label={t('SKU / รหัสสินค้า')}>
                  <Input value={f.sku} onChange={(e) => set('sku', e.target.value.trim())} className="font-mono" />
                </Field>
                <Field
                  label={
                    <span className="flex items-center justify-between">{t('หมวดหมู่')}<button
                        type="button"
                        className="text-[12px] font-semibold text-primary"
                        onClick={async () => {
                          const r = await confirm({ title: t('เพิ่มหมวดหมู่ใหม่'), confirmText: t('เพิ่ม'), reason: { label: t('ชื่อหมวด'), placeholder: t('เช่น เครื่องดื่มร้อน') } });
                          if (!r.ok) return;
                          try {
                            const c = await api.post<{ id: string }>('/api/categories', { name: r.reason, parentId: null, color: '', sort: cats.data?.length ?? 0, active: true });
                            await qc.invalidateQueries({ queryKey: ['categories'] });
                            set('categoryId', c.id);
                            toast.success(t('เพิ่มหมวด {0} แล้ว', r.reason));
                          } catch (e) {
                            toast.error(errorMessage(e));
                          }
                        }}
                      >{t('+ เพิ่มหมวดใหม่')}</button>
                    </span>
                  }
                >
                  <Select value={f.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value || null)}>
                    <option value="">{t('ไม่มีหมวด')}</option>
                    {cats.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.parentId ? '— ' : ''}
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>
            {f.image && (
              <Button size="sm" variant="ghost" className="self-start text-danger" onClick={() => set('image', '')}>{t('ลบรูป')}</Button>
            )}
            <div className="grid gap-4 md:grid-cols-3">
              <Field label={t('ประเภทสินค้า')} className="md:col-span-2">
                <Select value={f.kind} onChange={(e) => set('kind', e.target.value as ProductKind)}>
                  {PRODUCT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('หน่วยนับ')}>
                <Input value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder={t('ชิ้น / แก้ว / กก.')} />
              </Field>
              <Field label={f.kind === 'weighted' ? t('ราคาต่อ {0}', f.unit || t('กก.')) : f.variants.length ? t('ราคาตั้งต้น') : t('ราคาขาย')} required>
                <MoneyInput value={f.price} onValue={(v) => set('price', v)} />
              </Field>
              <Field label={t('ต้นทุน')} hint={margin !== null ? t('กำไรขั้นต้น {0}%', margin) : undefined}>
                <MoneyInput value={f.cost} onValue={(v) => set('cost', v)} />
              </Field>
              <Field label={t('ภาษี')}>
                <Select value={f.taxable ? '1' : '0'} onChange={(e) => set('taxable', e.target.value === '1')}>
                  <option value="1">{t('มี VAT')}</option>
                  <option value="0">{t('ยกเว้น VAT')}</option>
                </Select>
              </Field>
            </div>
            <Field label={t('สีปุ่มในหน้าขาย')}>
              <ColorPicker value={f.color} onChange={(c) => set('color', c)} />
            </Field>
          </Card>

          <Card title={t('บาร์โค้ด')} action={<Button size="sm" icon={<Wand2 className="h-4 w-4" />} onClick={() => void genBarcode((c) => set('barcodes', [...f.barcodes, c]))}>{t('สร้างบาร์โค้ด')}</Button>}>
            <p className="-mt-2 text-[13px] text-muted">{t('ใส่ได้หลายรหัสต่อสินค้า สแกนรหัสไหนก็ได้สินค้าเดียวกัน')}</p>
            {f.barcodes.map((b, i) => (
              <div key={i} className="flex gap-2">
                <Input className="font-mono" value={b} onChange={(e) => set('barcodes', f.barcodes.map((x, j) => (j === i ? e.target.value.trim() : x)))} />
                <Button variant="ghost" aria-label={t('ลบบาร์โค้ด')} onClick={() => set('barcodes', f.barcodes.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button size="sm" className="self-start" icon={<Barcode className="h-4 w-4" />} onClick={() => set('barcodes', [...f.barcodes, ''])}>{t('เพิ่มบาร์โค้ด')}</Button>
          </Card>

          {f.kind !== 'bundle' && (
            <Card title={t('ตัวเลือกสินค้า (ไซซ์/สี)')}>
              <p className="-mt-2 text-[13px] text-muted">{t('แต่ละตัวเลือกมีราคา บาร์โค้ด และสต็อกแยกกัน')}</p>
              {f.variants.length === 0 && (
                <div className="flex flex-col gap-2 rounded-xl bg-sunken p-3">
                  {optionDefs.map((d, i) => (
                    <div key={i} className="grid grid-cols-[140px_1fr] gap-2">
                      <Input value={d.name} placeholder={t('ชื่อตัวเลือก')} onChange={(e) => setOptionDefs(optionDefs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                      <Input value={d.values} placeholder={t('ค่า คั่นด้วย , เช่น S, M, L')} onChange={(e) => setOptionDefs(optionDefs.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} />
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    {optionDefs.length < 3 && (
                      <Button size="sm" onClick={() => setOptionDefs([...optionDefs, { name: optionDefs.length === 1 ? t('สี') : '', values: '' }])}>{t('+ เพิ่มชนิดตัวเลือก')}</Button>
                    )}
                    <Button size="sm" variant="primary" onClick={genVariants}>{t('สร้างตัวเลือกทั้งหมด')}</Button>
                  </div>
                </div>
              )}
              {f.variants.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-[14px]">
                    <thead className="text-left text-[12px] text-muted">
                      <tr>
                        <th className="pb-2">{t('ตัวเลือก')}</th>
                        <th className="pb-2">SKU</th>
                        <th className="pb-2">{t('บาร์โค้ด')}</th>
                        <th className="pb-2">{t('ราคา')}</th>
                        <th className="pb-2">{t('ต้นทุน')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {f.variants.map((v, i) => {
                        const upd = (patch: Partial<typeof v>) => set('variants', f.variants.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                        const st = f.stock?.filter((s) => s.variantId === v.id).reduce((a, s) => a + s.qty, 0);
                        return (
                          <tr key={v.id ?? i} className="border-t border-line-soft">
                            <td className="py-1.5 pr-2">
                              <Input value={v.name} onChange={(e) => upd({ name: e.target.value })} className="h-10" />
                              {st !== undefined && v.id && <span className="text-[12px] text-muted">{tn('สต็อก {0}', qtyText(st))}</span>}
                            </td>
                            <td className="py-1.5 pr-2"><Input value={v.sku} onChange={(e) => upd({ sku: e.target.value })} className="h-10 font-mono" /></td>
                            <td className="py-1.5 pr-2">
                              <div className="flex gap-1">
                                <Input value={v.barcode} onChange={(e) => upd({ barcode: e.target.value.trim() })} className="h-10 font-mono" />
                                <Button size="sm" variant="ghost" className="h-10 px-2" aria-label={t('สร้างบาร์โค้ด')} onClick={() => void genBarcode((code) => upd({ barcode: code }))}>
                                  <Wand2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                            <td className="w-[120px] py-1.5 pr-2"><MoneyInput value={v.price} onValue={(price) => upd({ price })} className="h-10" /></td>
                            <td className="w-[120px] py-1.5 pr-2"><MoneyInput value={v.cost} onValue={(cost) => upd({ cost })} className="h-10" /></td>
                            <td className="py-1.5">
                              <Button size="sm" variant="ghost" aria-label={t('ลบตัวเลือก')} onClick={() => set('variants', f.variants.filter((_, j) => j !== i))}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <Button size="sm" className="mt-2" icon={<Plus className="h-4 w-4" />} onClick={() => set('variants', [...f.variants, { name: '', options: {}, sku: '', barcode: '', price: f.price, cost: f.cost, active: true }])}>{t('เพิ่มตัวเลือก')}</Button>
                </div>
              )}
            </Card>
          )}

          {f.kind === 'bundle' && (
            <Card title={t('ส่วนประกอบของชุด')}>
              <p className="-mt-2 text-[13px] text-muted">{t('ขายชุดนี้ 1 ชุด จะตัดสต็อกส่วนประกอบตามจำนวนที่กำหนด')}</p>
              {f.bundleItems.map((b, i) => {
                const p = catalog.data?.products.find((x) => x.id === b.productId);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <Select value={b.productId} onChange={(e) => set('bundleItems', f.bundleItems.map((x, j) => (j === i ? { ...x, productId: e.target.value, variantId: null } : x)))}>
                      {catalog.data?.products.filter((x) => x.kind !== 'bundle' && x.id !== id).map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </Select>
                    {p && p.variants.length > 0 && (
                      <Select className="w-[160px]" value={b.variantId ?? ''} onChange={(e) => set('bundleItems', f.bundleItems.map((x, j) => (j === i ? { ...x, variantId: e.target.value || null } : x)))}>
                        <option value="">{t('เลือก')}</option>
                        {p.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </Select>
                    )}
                    <NumberInput className="w-20" decimals={3} value={b.qty} onValue={(qty) => set('bundleItems', f.bundleItems.map((x, j) => (j === i ? { ...x, qty } : x)))} aria-label={t('จำนวน')} />
                    <Button variant="ghost" aria-label={t('ลบ')} onClick={() => set('bundleItems', f.bundleItems.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
              <Button size="sm" className="self-start" icon={<Plus className="h-4 w-4" />} disabled={!catalog.data?.products.length} onClick={() => set('bundleItems', [...f.bundleItems, { productId: catalog.data!.products.find((x) => x.kind !== 'bundle')!.id, variantId: null, qty: 1 }])}>{t('เพิ่มส่วนประกอบ')}</Button>
            </Card>
          )}

          <Card title={t('หน่วยขายเพิ่มเติม (แพ็ค/ลัง)')}>
            <p className="-mt-2 text-[13px] text-muted">{tn('เช่น 1 แพ็ค = 6 {0} ราคาแพ็คละ ฿99 · ตัดสต็อกเป็น{1}ให้อัตโนมัติ', f.unit, f.unit)}</p>
            {f.units.map((u, i) => {
              const upd = (patch: Partial<typeof u>) => set('units', f.units.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[1fr_100px_130px_1fr_auto]">
                  <Input value={u.name} placeholder={t('ชื่อหน่วย')} onChange={(e) => upd({ name: e.target.value })} />
                  <NumberInput decimals={3} value={u.factor} onValue={(factor) => upd({ factor })} aria-label={t('จำนวน{0}ต่อหน่วย', f.unit)} />
                  <MoneyInput value={u.price} onValue={(price) => upd({ price })} aria-label={t('ราคา')} />
                  <Input value={u.barcode} placeholder={t('บาร์โค้ดหน่วยนี้')} className="font-mono" onChange={(e) => upd({ barcode: e.target.value.trim() })} />
                  <Button variant="ghost" aria-label={t('ลบหน่วย')} onClick={() => set('units', f.units.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            <Button size="sm" className="self-start" icon={<Plus className="h-4 w-4" />} onClick={() => set('units', [...f.units, { name: t('แพ็ค'), factor: 6, price: f.price * 6, barcode: '' }])}>{t('เพิ่มหน่วยขาย')}</Button>
          </Card>

          {(fields.data?.length ?? 0) > 0 && (
            <Card title={t('ข้อมูลเพิ่มเติม')}>
              <div className="grid gap-4 md:grid-cols-2">
                {fields.data!.map((fd) => (
                  <CustomFieldInput key={fd.id} def={fd} value={f.custom[fd.key]} onChange={(v) => set('custom', { ...f.custom, [fd.key]: v })} />
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title={t('การขาย')}>
            <div className="-my-2 flex flex-col">
              <ToggleRow label={t('เปิดขาย')} hint={t('ปิดเพื่อหยุดขายชั่วคราว')} checked={f.active} onChange={(v) => set('active', v)} />
              <ToggleRow label={t('แสดงในหน้าขาย')} hint={t('ปิดไว้ยังขายได้ด้วยการสแกน/ค้นหา')} checked={f.showInPos} onChange={(v) => set('showInPos', v)} />
            </div>
          </Card>
          {settings.modules.stock && stockable && (
            <Card title={t('สต็อก')}>
              <div className="-my-2 flex flex-col">
                <ToggleRow label={t('ติดตามสต็อก')} checked={f.trackStock} onChange={(v) => set('trackStock', v)} />
              </div>
              {f.trackStock && (
                <>
                  <Field label={t('แจ้งเตือนเมื่อคงเหลือต่ำกว่า')}>
                    <NumberInput decimals={3} value={f.lowStock} onValue={(v) => set('lowStock', v)} />
                  </Field>
                  {!isNew && (
                    <div className="flex items-center justify-between rounded-xl bg-sunken px-3 py-2.5 text-[14px]">
                      <span>{t('คงเหลือทุกสาขา')}</span>
                      <span className="num font-semibold">
                        {qtyText(stockTotal)} {f.unit}
                      </span>
                    </div>
                  )}
                  <p className="text-[12px] text-muted">{isNew ? t('บันทึกสินค้าก่อน แล้วรับสินค้าเข้าที่หน้า สต็อก → รับเข้า') : t('แก้ยอดสต็อกได้ที่หน้า สต็อก (ทุกการเปลี่ยนแปลงถูกบันทึกไว้)')}</p>
                </>
              )}
            </Card>
          )}
          {(groups.data?.length ?? 0) > 0 && (
            <Card title={t('ตัวเลือกเสริม')}>
              {groups.data!.map((g) => (
                <Checkbox
                  key={g.id}
                  checked={f.modifierGroupIds.includes(g.id)}
                  onChange={(v) => set('modifierGroupIds', v ? [...f.modifierGroupIds, g.id] : f.modifierGroupIds.filter((x) => x !== g.id))}
                  label={
                    <span>
                      {g.name} <span className="text-[12px] text-muted">({g.modifiers.map((m) => m.name).slice(0, 4).join(', ')})</span>
                    </span>
                  }
                />
              ))}
            </Card>
          )}
          {(tiers.data?.length ?? 0) > 0 && (
            <Card title={t('ราคาตามระดับ')}>
              <p className="-mt-2 text-[12px] text-muted">{tn('เว้นว่างเพื่อใช้ราคาปกติ ({0})', money(f.price))}</p>
              {tiers.data!.map((tk) => {
                const tp = f.tierPrices.find((x) => x.tierId === tk.id);
                return (
                  <Field key={tk.id} label={tk.name}>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <MoneyInput value={tp?.price ?? null} placeholder={t('ราคาปกติ')} onValue={(price) => set('tierPrices', [...f.tierPrices.filter((x) => x.tierId !== tk.id), { tierId: tk.id, price }])} />
                      </div>
                      {tp && (
                        <Button variant="ghost" aria-label={t('ใช้ราคาปกติ')} onClick={() => set('tierPrices', f.tierPrices.filter((x) => x.tierId !== tk.id))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </Field>
                );
              })}
            </Card>
          )}
          {!isNew && f.variants.length > 0 && <Badge tone="info">{tn('{0} ตัวเลือก', f.variants.length)}</Badge>}
        </div>
      </fieldset>
    </Page>
  );
}

export function CustomFieldInput({ def, value, onChange }: { def: CustomFieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const label = def.label;
  switch (def.type) {
    case 'number':
      return (
        <Field label={label} required={def.required}>
          <Input inputMode="decimal" value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value.replace(/[^\d.-]/g, ''))} />
        </Field>
      );
    case 'date':
      return (
        <Field label={label} required={def.required}>
          <Input type="date" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
    case 'select':
      return (
        <Field label={label} required={def.required}>
          <Select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
            <option value="">—</option>
            {def.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </Field>
      );
    case 'checkbox':
      return <Checkbox checked={!!value} onChange={onChange} label={label} />;
    case 'image':
      return (
        <Field label={label} required={def.required}>
          <div className="flex items-center gap-3">
            {typeof value === 'string' && value && <img src={value} alt="" className="h-14 w-14 rounded-lg object-cover" />}
            <input type="file" accept="image/*" onChange={async (e) => e.target.files?.[0] && onChange(await imageToDataUrl(e.target.files[0], 400))} />
          </div>
        </Field>
      );
    default:
      return (
        <Field label={label} required={def.required}>
          {String(value ?? '').length > 60 ? <Textarea value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} /> : <Input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />}
        </Field>
      );
  }
}
