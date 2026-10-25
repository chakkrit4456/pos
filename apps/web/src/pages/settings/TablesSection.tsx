import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LayoutGrid, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { Badge, Button, Card, EmptyState, Field, Input, Select } from '@/components/ui/core';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { NumberInput } from '@/components/ui/inputs';
import { SectionTitle } from './common';
import { t } from '@flexpos/shared';
import { tn } from '@/lib/i18n';

interface Zone { id: string; name: string; sort: number }
interface FloorTable { id: string; name: string; zoneId: string | null; seats: number; order: { total: number } | null }
interface Bulk { zoneId: string; prefix: string; from: number; to: number; seats: number }

/** Zones and their tables: each table lives in exactly one zone, shown inside that zone's card. */
export function TablesSection() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const zones = useQuery({ queryKey: ['zones'], queryFn: () => api.get<Zone[]>('/api/zones') });
  const floor = useQuery({ queryKey: ['floor'], queryFn: () => api.get<{ tables: FloorTable[] }>('/api/floor') });
  const [zoneName, setZoneName] = useState('');
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const [rename, setRename] = useState<Zone | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['zones'] });
    qc.invalidateQueries({ queryKey: ['floor'] });
    qc.invalidateQueries({ queryKey: ['orders'] });
  };
  const tables = floor.data?.tables ?? [];
  const byZone = (zid: string | null) => tables.filter((t) => t.zoneId === zid);
  const loose = byZone(null);

  const addZone = async () => {
    try {
      const r = await api.post<{ id: string }>('/api/zones', { name: zoneName.trim(), sort: zones.data?.length ?? 0 });
      setZoneName('');
      refresh();
      setBulk({ zoneId: r.id, prefix: '', from: 1, to: 6, seats: 4 });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const deleteZone = async (z: Zone) => {
    const ts = byZone(z.id);
    const busy = ts.filter((t) => t.order);
    const r = await confirm({
      title: t('ลบโซน “{0}”?', z.name),
      body: (
        <div className="flex flex-col gap-2">
          <span>{tn('โต๊ะ {0} โต๊ะในโซนนี้จะถูกลบไปด้วย', ts.length)}</span>
          {busy.length > 0 && <span className="font-semibold text-danger">{tn('มีบิลค้าง {0} บิล ({1}) จะถูกปิด (ยกเลิก) และบันทึกในประวัติการใช้งาน', busy.length, busy.map((t) => t.name).join(', '))}</span>}
        </div>
      ),
      danger: true,
      confirmText: busy.length ? t('ลบโซนและปิดบิล') : t('ลบโซน'),
    });
    if (!r.ok) return;
    try {
      const res = await api.del<{ tables: number; cancelledBills: number }>(`/api/zones/${z.id}`);
      toast.success(t('ลบโซน {0} แล้ว · ลบ {1} โต๊ะ{2}', z.name, res.tables, res.cancelledBills ? t(' · ปิดบิล {0} บิล', res.cancelledBills) : ''));
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const addBulk = async () => {
    if (!bulk) return;
    let ok = 0;
    for (let i = bulk.from; i <= bulk.to; i++) {
      try {
        await api.post('/api/tables', { name: `${bulk.prefix}${i}`, zoneId: bulk.zoneId || null, seats: bulk.seats, sort: i });
        ok++;
      } catch (e) {
        toast.error(errorMessage(e));
      }
    }
    if (ok) toast.success(t('เพิ่ม {0} โต๊ะแล้ว', ok));
    setBulk(null);
    refresh();
  };
  const deleteTable = async (tk: FloorTable) => {
    const r = await confirm({ title: t('ลบโต๊ะ {0}?', tk.name), danger: true, confirmText: t('ลบ') });
    if (!r.ok) return;
    await api.del(`/api/tables/${tk.id}`).catch((e) => toast.error(errorMessage(e)));
    refresh();
  };
  const moveTable = async (t: FloorTable, zoneId: string) => {
    try {
      await api.put(`/api/tables/${t.id}`, { name: t.name, zoneId, seats: t.seats, sort: 0 });
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <SectionTitle title={t('โต๊ะและโซน')} sub={t('แต่ละโต๊ะอยู่ในโซนเดียวเท่านั้น ชื่อโต๊ะซ้ำกันได้ถ้าอยู่คนละโซน (เช่น โซนใน · 1 กับ โซนนอก · 1)')} />
      <Card>
        <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), zoneName.trim() && void addZone())}>
          <Input value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder={t('ชื่อโซนใหม่ เช่น ระเบียง, ชั้น 2, ห้อง VIP')} aria-label={t('ชื่อโซนใหม่')} />
          <Button type="submit" variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!zoneName.trim()}>{t('เพิ่มโซน')}</Button>
        </form>
      </Card>

      {!zones.data?.length && !loose.length && <Card><EmptyState icon={<LayoutGrid className="h-6 w-6" />} title={t('ยังไม่มีโซนและโต๊ะ')} body={t('เริ่มจากเพิ่มโซน แล้วเพิ่มโต๊ะในโซนนั้น')} /></Card>}

      {zones.data?.map((z) => {
        const ts = byZone(z.id);
        return (
          <Card
            key={z.id}
            title={<span className="flex items-center gap-2">{z.name}<Badge>{tn('{0} โต๊ะ', ts.length)}</Badge></span>}
            action={
              <div className="flex gap-1.5">
                <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setBulk({ zoneId: z.id, prefix: '', from: ts.length + 1, to: ts.length + 4, seats: 4 })}>{t('เพิ่มโต๊ะ')}</Button>
                <Button size="sm" variant="ghost" aria-label={t('เปลี่ยนชื่อโซน {0}', z.name)} onClick={() => setRename(z)}><Pencil className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" className="text-danger" aria-label={t('ลบโซน {0}', z.name)} onClick={() => void deleteZone(z)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            }
          >
            {ts.length ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {ts.map((tk) => (
                  <div key={tk.id} className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5">
                    <span className="flex flex-col"><span className="text-[16px] font-semibold">{tk.name}</span><span className="text-[11px] text-muted">{tn('{0} ที่{1}', tk.seats, tk.order ? t(' · มีบิล') : '')}</span></span>
                    <button aria-label={t('ลบโต๊ะ {0}', tk.name)} disabled={!!tk.order} title={tk.order ? t('มีบิลเปิดอยู่') : t('ลบโต๊ะ')} className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-sunken hover:text-danger disabled:opacity-30" onClick={() => void deleteTable(tk)}><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[14px] text-muted">{t('ยังไม่มีโต๊ะในโซนนี้ · กด “เพิ่มโต๊ะ”')}</p>
            )}
          </Card>
        );
      })}

      {loose.length > 0 && (
        <Card title={<span className="flex items-center gap-2">{t('โต๊ะที่ยังไม่มีโซน')}<Badge tone="warn">{loose.length}</Badge></span>}>
          <p className="-mt-2 text-[13px] text-muted">{t('ย้ายเข้าโซนเพื่อไม่ให้สับสน')}</p>
          {loose.map((tk) => (
            <div key={tk.id} className="flex items-center gap-3 border-b border-line-soft py-2 last:border-0">
              <span className="flex-1 font-semibold">{tk.name}</span>
              {zones.data?.length ? (
                <Select className="w-48" value="" onChange={(e) => e.target.value && void moveTable(tk, e.target.value)} aria-label={t('ย้ายโต๊ะ {0}', tk.name)}>
                  <option value="">{t('ย้ายเข้าโซน…')}</option>
                  {zones.data.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </Select>
              ) : null}
              <Button size="sm" variant="ghost" className="text-danger" disabled={!!tk.order} onClick={() => void deleteTable(tk)} aria-label={t('ลบโต๊ะ {0}', tk.name)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </Card>
      )}

      <Dialog open={!!bulk} onOpenChange={(v) => !v && setBulk(null)} title={t('เพิ่มโต๊ะในโซน {0}', zones.data?.find((z) => z.id === bulk?.zoneId)?.name ?? '')} size="sm" footer={<><Button onClick={() => setBulk(null)}>{t('ยกเลิก')}</Button><Button variant="primary" disabled={!bulk || bulk.to < bulk.from} onClick={() => void addBulk()}>{tn('เพิ่ม {0} โต๊ะ', bulk ? Math.max(0, bulk.to - bulk.from + 1) : 0)}</Button></>}>
        {bulk && (
          <div className="grid grid-cols-2 gap-3 pb-2">
            <Field label={t('ชื่อนำหน้า (ถ้ามี)')}><Input value={bulk.prefix} onChange={(e) => setBulk({ ...bulk, prefix: e.target.value })} placeholder={t('เช่น A')} /></Field>
            <Field label={t('ที่นั่งต่อโต๊ะ')}><NumberInput value={bulk.seats} onValue={(seats) => setBulk({ ...bulk, seats })} /></Field>
            <Field label={t('ตั้งแต่เลข')}><NumberInput value={bulk.from} onValue={(from) => setBulk({ ...bulk, from })} /></Field>
            <Field label={t('ถึงเลข')}><NumberInput value={bulk.to} onValue={(to) => setBulk({ ...bulk, to: Math.min(to, bulk.from + 99) })} /></Field>
            <p className="col-span-2 text-[13px] text-muted">{tn('จะได้โต๊ะ: {0}{1} … {2}{3}', bulk.prefix, bulk.from, bulk.prefix, bulk.to)}</p>
          </div>
        )}
      </Dialog>
      <Dialog open={!!rename} onOpenChange={(v) => !v && setRename(null)} title={t('เปลี่ยนชื่อโซน')} size="sm" footer={<><Button onClick={() => setRename(null)}>{t('ยกเลิก')}</Button><Button variant="primary" disabled={!rename?.name.trim()} onClick={async () => { await api.put(`/api/zones/${rename!.id}`, { name: rename!.name, sort: rename!.sort }).catch((e) => toast.error(errorMessage(e))); setRename(null); refresh(); }}>{t('บันทึก')}</Button></>}>
        {rename && <div className="pb-2"><Field label={t('ชื่อโซน')}><Input autoFocus value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} /></Field></div>}
      </Dialog>
    </>
  );
}
