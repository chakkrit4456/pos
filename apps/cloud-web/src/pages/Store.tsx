import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, RefreshCw, Search, WifiOff } from 'lucide-react';
import { t } from '@flexpos/shared';
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Pagination, Segmented, Select, SkeletonRows, Switch } from '@/components/ui/core';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { DashboardView, type Dash, type DashRange } from '@/components/DashboardView';
import { tn } from '@/lib/i18n';
import { api, errorMessage } from '~/lib/api';
import { ago, date, dateTime, localToday, money } from '~/lib/format';
import { useLive } from '~/lib/live';
import { Tabs } from '~/components/Shell';
import { DataTable, RowEditor, type Column } from '~/components/DataTable';
import { OnlineBadge, roleLabel } from './Stores';

interface Info {
  id: string;
  name: string;
  status: string;
  role: 'manager' | 'viewer' | 'superadmin';
  lastSyncAt: string | null;
  lastSeenAt: string | null;
  online: boolean;
  posVersion: string | null;
  modules: { restaurant: boolean; stock: boolean; multiBranch: boolean };
  branches: { id: string; name: string }[];
  devices: { id: string; name: string; appVersion: string; lastSeenAt: string | null; online: boolean; pending: number; createdAt: string }[];
  pendingCommands: number;
}

type Tab = 'dashboard' | 'reports' | 'data' | 'members' | 'devices' | 'activity';

export default function StorePage() {
  const { tid = '' } = useParams();
  const [tab, setTab] = useState<Tab>('dashboard');
  const live = useLive(tid);
  const info = useQuery({ queryKey: ['store', tid, 'info'], queryFn: () => api.get<Info>(`/api/stores/${tid}`), refetchInterval: 30_000 });
  if (info.isError) return <ErrorState error={info.error} onRetry={() => void info.refetch()} />;
  const s = info.data;
  const canManage = s?.role === 'manager' || s?.role === 'superadmin';
  const tabs: { id: Tab; label: string }[] = [
    { id: 'dashboard', label: t('ภาพรวม') },
    { id: 'reports', label: t('รายงาน') },
    { id: 'data', label: t('ข้อมูลร้าน') },
    ...(canManage ? [{ id: 'members' as const, label: t('พนักงานดูเว็บ') }, { id: 'devices' as const, label: t('เครื่อง POS') }] : []),
    { id: 'activity', label: t('การแก้ไขจากเว็บ') },
  ];
  return (
    <>
      <PageHeader title={s?.name ?? ' '} sub={s ? roleLabel(s.role) : ' '} actions={s && <><OnlineBadge online={s.online} lastSeenAt={s.lastSeenAt} />{live.connected && <Badge tone="info">{t('อัปเดตสด')}</Badge>}</>} />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {!s ? <SkeletonRows /> : tab === 'dashboard' ? <DashboardTab info={s} /> : tab === 'reports' ? <ReportsTab info={s} /> : tab === 'data' ? <DataTab info={s} /> : tab === 'members' ? <MembersTab info={s} /> : tab === 'devices' ? <DevicesTab info={s} /> : <ActivityTab info={s} />}
    </>
  );
}

function OfflineBanner({ info }: { info: Info }) {
  if (info.online) return null;
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-[14px] text-warn">
      <WifiOff className="mt-0.5 h-5 w-5 flex-none" />
      <span>{info.lastSyncAt ? tn('เครื่อง POS ออฟไลน์อยู่ กำลังแสดงข้อมูล ณ {0} ({1}) ข้อมูลใหม่จะขึ้นอัตโนมัติเมื่อเครื่องกลับมาออนไลน์', dateTime(info.lastSyncAt), ago(info.lastSyncAt)) : t('ยังไม่ได้รับข้อมูลจากเครื่อง POS เปิดเครื่อง POS และเชื่อมต่ออินเทอร์เน็ตเพื่อส่งข้อมูล')}</span>
    </div>
  );
}

function BranchPicker({ info, value, onChange }: { info: Info; value: string; onChange: (v: string) => void }) {
  if (info.branches.length < 2) return null;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-auto">
      <option value="all">{t('ทุกสาขา')}</option>
      {info.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </Select>
  );
}

function DashboardTab({ info }: { info: Info }) {
  const [range, setRange] = useState<DashRange>('today');
  const [branch, setBranch] = useState('all');
  const q = useQuery({ queryKey: ['store', info.id, 'dashboard', range, branch], queryFn: () => api.get<Dash & { syncedAt: string | null }>(`/api/stores/${info.id}/dashboard`, { range, branchId: branch }), refetchInterval: 60_000 });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <DashboardView
      d={q.data}
      range={range}
      onRange={setRange}
      modules={info.modules}
      formatDate={date}
      banner={<OfflineBanner info={info} />}
      actions={
        <>
          <BranchPicker info={info} value={branch} onChange={setBranch} />
          <span className="text-[13px] text-muted">{t('ข้อมูลล่าสุด {0}', ago(info.lastSyncAt))}</span>
        </>
      }
    />
  );
}

const GROUPS = ['day', 'hour', 'product', 'category', 'staff', 'method', 'branch'] as const;
const GROUP_LABEL: Record<(typeof GROUPS)[number], string> = { day: t('รายวัน'), hour: t('รายชั่วโมง'), product: t('สินค้า'), category: t('หมวด'), staff: t('พนักงาน'), method: t('วิธีชำระ'), branch: t('สาขา') };

function ReportsTab({ info }: { info: Info }) {
  const today = localToday();
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [groupBy, setGroupBy] = useState<(typeof GROUPS)[number]>('day');
  const [branch, setBranch] = useState('all');
  type R = { label: string; qty: number; bills: number; discount: number; net: number; vat: number; cost: number | null; profit: number | null };
  const q = useQuery({ queryKey: ['store', info.id, 'report', from, to, groupBy, branch], queryFn: () => api.get<{ rows: R[]; total: R }>(`/api/stores/${info.id}/reports/sales`, { from, to, groupBy, branchId: branch }) });
  return (
    <>
      <OfflineBanner info={info} />
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('ตั้งแต่')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t('ถึง')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <BranchPicker info={info} value={branch} onChange={setBranch} />
          <Segmented value={groupBy} onChange={setGroupBy} options={GROUPS.filter((g) => g !== 'branch' || info.branches.length > 1).map((g) => ({ value: g, label: GROUP_LABEL[g] }))} />
        </div>
        {q.isError ? (
          <ErrorState error={q.error} />
        ) : !q.data ? (
          <SkeletonRows />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="num w-full min-w-[640px] text-[14px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] text-muted">
                  <th className="px-3 py-2">{t('รายการ')}</th><th className="px-3 py-2 text-right">{t('จำนวน')}</th><th className="px-3 py-2 text-right">{t('บิล')}</th><th className="px-3 py-2 text-right">{t('ส่วนลด')}</th><th className="px-3 py-2 text-right">{t('ยอดขายสุทธิ')}</th><th className="px-3 py-2 text-right">VAT</th><th className="px-3 py-2 text-right">{t('กำไรขั้นต้น')}</th>
                </tr>
              </thead>
              <tbody>
                {[...q.data.rows, { ...q.data.total, label: t('รวม') }].map((r, i) => (
                  <tr key={i} className={i === q.data.rows.length ? 'font-semibold' : 'border-b border-line-soft'}>
                    <td className="px-3 py-2">{r.label}</td><td className="px-3 py-2 text-right">{r.qty || ''}</td><td className="px-3 py-2 text-right">{r.bills}</td><td className="px-3 py-2 text-right">{money(r.discount)}</td><td className="px-3 py-2 text-right">{money(r.net)}</td><td className="px-3 py-2 text-right">{money(r.vat)}</td><td className="px-3 py-2 text-right">{r.profit == null ? '-' : money(r.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

const DATA_TABLES: { id: string; label: string; show: string[]; manager?: boolean }[] = [
  { id: 'products', label: t('สินค้า'), show: ['sku', 'name', 'price', 'cost', 'active', 'updated_at'] },
  { id: 'categories', label: t('หมวดหมู่'), show: ['name', 'color', 'sort', 'active'] },
  { id: 'customers', label: t('ลูกค้า/สมาชิก'), show: ['code', 'name', 'phone', 'points', 'total_spent', 'active'] },
  { id: 'promotions', label: t('โปรโมชั่น'), show: ['name', 'type', 'value', 'coupon_code', 'active', 'starts_at', 'ends_at'] },
  { id: 'payment_methods', label: t('วิธีชำระเงิน'), show: ['code', 'name', 'kind', 'active'] },
  { id: 'suppliers', label: t('ผู้จำหน่าย'), show: ['name', 'contact', 'phone', 'email', 'active'] },
  { id: 'customer_groups', label: t('กลุ่มลูกค้า'), show: ['name', 'discount_percent'] },
  { id: 'sales', label: t('บิลขาย'), show: ['doc_no', 'type', 'status', 'total', 'biz_date', 'created_at'] },
  { id: 'shifts', label: t('กะ'), show: ['number', 'status', 'opened_at', 'closed_at', 'opening_cash', 'counted_cash'] },
  { id: 'stock_levels', label: t('สต็อกคงเหลือ'), show: ['product_id', 'branch_id', 'qty', 'updated_at'] },
  { id: 'branches', label: t('สาขา'), show: ['code', 'name', 'active'] },
  { id: 'audit_logs', label: t('บันทึกการใช้งานที่ POS'), show: ['created_at', 'user_name', 'action', 'entity', 'entity_id'], manager: true },
  { id: 'settings', label: t('การตั้งค่า (JSON)'), show: ['id', 'updated_at'] },
];

function DataTab({ info }: { info: Info }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const canManage = info.role !== 'viewer';
  const tables = DATA_TABLES.filter((d) => canManage || !d.manager);
  const [table, setTable] = useState('products');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<{ row: Record<string, unknown> | null } | null>(null);
  const def = tables.find((d) => d.id === table)!;
  const pageSize = 50;
  type Resp = { editable: boolean; columns: Column[]; rows: Record<string, unknown>[]; total: number; pending: Record<string, string> };
  const q = useQuery({ queryKey: ['store', info.id, 'data', table, search, page], queryFn: () => api.get<Resp>(`/api/stores/${info.id}/data/${table}`, { q: search, limit: pageSize, offset: (page - 1) * pageSize }) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['store', info.id, 'data'] });
  const save = async (values: Record<string, unknown>) => {
    try {
      await api.post(`/api/stores/${info.id}/data/${table}`, { row: { ...(edit?.row ? { id: edit.row.id } : {}), ...values } });
      toast.success(info.online ? t('บันทึกแล้ว กำลังส่งไปที่เครื่อง POS') : t('บันทึกแล้ว จะส่งไปที่เครื่อง POS เมื่อเครื่องออนไลน์'));
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  };
  const remove = async (row: Record<string, unknown>) => {
    const c = await confirm({ title: t('ลบรายการนี้?'), body: String(row.name ?? row.id), danger: true, confirmText: t('ลบ') });
    if (!c.ok) return;
    try {
      await api.del(`/api/stores/${info.id}/data/${table}/${String(row.id)}`);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const editable = !!q.data?.editable;
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('ข้อมูล')}>
          <Select value={table} onChange={(e) => { setTable(e.target.value); setPage(1); setSearch(''); }} className="h-11 min-w-[220px]">
            {tables.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </Select>
        </Field>
        <Field label={t('ค้นหา')} className="min-w-[220px] flex-1">
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" /><Input className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
        </Field>
        {editable && table !== 'settings' && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ row: null })}>{t('เพิ่ม')}</Button>}
      </div>
      {editable && <p className="text-[13px] text-muted">{t('การแก้ไขข้อมูลหลักจะถูกส่งไปที่เครื่อง POS อัตโนมัติ ข้อมูลการขาย กะ และสต็อกแก้ไขได้ที่เครื่อง POS เท่านั้น')}</p>}
      <Card pad={false}>
        {q.isError ? <ErrorState error={q.error} /> : !q.data ? <div className="p-5"><SkeletonRows /></div> : (
          <>
            <DataTable columns={q.data.columns} rows={q.data.rows} show={def.show} pending={q.data.pending} onEdit={editable ? (row) => setEdit({ row }) : undefined} onDelete={editable && table !== 'settings' ? (row) => void remove(row) : undefined} />
            <Pagination page={page} pageSize={pageSize} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {q.data && (
        <RowEditor open={!!edit} title={edit?.row ? t('แก้ไข {0}', def.label) : t('เพิ่ม {0}', def.label)} columns={q.data.columns.filter((c) => !['created_at', 'updated_at', 'deleted_at'].includes(c.name) && (c.name !== 'id' || !!edit?.row))} readOnly={['id']} row={edit?.row ?? null} onClose={() => setEdit(null)} onSave={save} />
      )}
    </>
  );
}

/** Managers add, edit and delete view-only staff accounts. Manager accounts belong to the superadmin. */
function MembersTab({ info }: { info: Info }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const su = info.role === 'superadmin';
  type M = { id: string; username: string; name: string; disabled: boolean; lastLoginAt: string | null; role: 'manager' | 'viewer'; addedAt: string; me: boolean };
  type Form = { id?: string; username: string; name: string; password: string; disabled: boolean; role: 'manager' | 'viewer' };
  const q = useQuery({ queryKey: ['store', info.id, 'members'], queryFn: () => api.get<{ members: M[] }>(`/api/stores/${info.id}/members`) });
  // POS staff, to reuse their name and username for a web account
  const posStaff = useQuery({ queryKey: ['store', info.id, 'data', 'users', 'all'], queryFn: () => api.get<{ rows: { id: string; name: string; username: string; active: number }[] }>(`/api/stores/${info.id}/data/users`, { limit: 500 }) });
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['store', info.id, 'members'] });
  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      if (form.id) {
        await api.patch(`/api/stores/${info.id}/members/${form.id}`, { name: form.name, username: form.username, password: form.password || undefined, disabled: form.disabled, ...(su ? { role: form.role } : {}) });
        toast.success(t('บันทึกแล้ว'));
      } else {
        await api.post(`/api/stores/${info.id}/members`, { username: form.username, name: form.name, password: form.password || undefined, role: su ? form.role : 'viewer' });
        toast.success(t('เพิ่มพนักงานแล้ว แจ้งชื่อผู้ใช้และรหัสผ่านให้พนักงานเพื่อเข้าดูแดชบอร์ด'));
      }
      setForm(null);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (m: M) => {
    const c = await confirm({ title: t('ลบ {0}?', m.name), body: t('พนักงานจะเข้าดูแดชบอร์ดของร้านไม่ได้อีก'), danger: true, confirmText: t('ลบ') });
    if (!c.ok) return;
    try {
      await api.del(`/api/stores/${info.id}/members/${m.id}`);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const editable = (m: M) => su || (m.role === 'viewer' && !m.me);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-muted">{t('เพิ่มบัญชีให้พนักงานเข้าดูแดชบอร์ดและรายงานของร้านนี้ได้ (ดูอย่างเดียว) ใช้ชื่อผู้ใช้และรหัสผ่านเดียวกับที่เครื่อง POS ก็ได้ บัญชีผู้จัดการเพิ่มได้โดยผู้ให้บริการเท่านั้น')}</p>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ username: '', name: '', password: '', disabled: false, role: 'viewer' })}>{t('เพิ่มพนักงาน')}</Button>
      </div>
      <Card pad={false}>
        {!q.data ? <div className="p-5"><SkeletonRows /></div> : (
          <div className="flex flex-col">
            {q.data.members.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3 last:border-0">
                <div className="flex min-w-0 flex-1 flex-col"><span className="font-medium">{m.name}{m.me && <span className="ml-2 text-[13px] text-muted">{t('(คุณ)')}</span>}</span><span className="truncate text-[13px] text-muted">{m.username} · {t('เข้าระบบล่าสุด {0}', ago(m.lastLoginAt))}</span></div>
                <Badge tone={m.role === 'manager' ? 'info' : 'neutral'}>{roleLabel(m.role)}</Badge>
                {m.disabled && <Badge tone="danger">{t('ปิดใช้งาน')}</Badge>}
                {editable(m) && (
                  <>
                    <Button size="sm" onClick={() => setForm({ id: m.id, username: m.username, name: m.name, password: '', disabled: m.disabled, role: m.role })}>{t('แก้ไข')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => void remove(m)}>{t('ลบ')}</Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      <Dialog
        open={!!form}
        onOpenChange={(v) => !v && setForm(null)}
        title={form?.id ? t('แก้ไขพนักงาน') : t('เพิ่มพนักงาน')}
        footer={<><Button variant="ghost" onClick={() => setForm(null)}>{t('ยกเลิก')}</Button><Button variant="primary" loading={busy} disabled={!form || form.username.trim().length < 3 || !form.name.trim() || (!form.id && form.password.length < 8)} onClick={() => void save()}>{t('บันทึก')}</Button></>}
      >
        {form && (
          <div className="grid gap-3">
            {!form.id && !!posStaff.data?.rows.length && (
              <Field label={t('ดึงจากพนักงานในเครื่อง POS')} hint={t('ใส่ชื่อและชื่อผู้ใช้ให้อัตโนมัติ แล้วตั้งรหัสผ่าน (จะใช้รหัสเดียวกับที่เครื่อง POS ก็ได้)')}>
                <Select value="" onChange={(e) => { const p = posStaff.data?.rows.find((r) => r.id === e.target.value); if (p) setForm({ ...form, name: p.name, username: p.username }); }} className="h-11">
                  <option value="">{t('เลือกพนักงาน…')}</option>
                  {posStaff.data.rows.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name} ({r.username})</option>)}
                </Select>
              </Field>
            )}
            <Field label={t('ชื่อ')} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={t('ชื่อผู้ใช้')} required hint={t('ใช้เข้าสู่ระบบ ห้ามซ้ำกับร้านอื่น ถ้าซ้ำให้เติมชื่อร้านต่อท้าย')}><Input autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
            <Field label={form.id ? t('ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)') : t('รหัสผ่าน')} required={!form.id} hint={t('อย่างน้อย 8 ตัวอักษร')}><Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            {form.id && <label className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5 text-[14px]">{t('ปิดใช้งาน')}<Switch checked={form.disabled} onChange={(v) => setForm({ ...form, disabled: v })} label={t('ปิดใช้งาน')} /></label>}
            {su && (
              <Field label={t('สิทธิ์')}>
                <Segmented value={form.role} onChange={(role) => setForm({ ...form, role })} options={[{ value: 'viewer', label: roleLabel('viewer') }, { value: 'manager', label: roleLabel('manager') }]} />
              </Field>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

function DevicesTab({ info }: { info: Info }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  return (
    <Card pad={false}>
      {info.devices.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3 last:border-0">
          <div className="flex min-w-0 flex-1 flex-col"><span className="font-medium">{d.name}</span><span className="text-[13px] text-muted">{t('เวอร์ชัน {0} · เชื่อมต่อเมื่อ {1}', d.appVersion || '-', dateTime(d.createdAt))}</span></div>
          <OnlineBadge online={d.online} lastSeenAt={d.lastSeenAt} />
          {d.pending > 0 && <Badge tone="warn">{t('รอส่ง {0} รายการ', d.pending)}</Badge>}
          <Button size="sm" variant="ghost" onClick={async () => { const c = await confirm({ title: t('ยกเลิกการเชื่อมต่อเครื่อง {0}?', d.name), body: t('เครื่องนี้จะส่งข้อมูลขึ้นเว็บไม่ได้จนกว่าจะเชื่อมต่อใหม่ที่หน้าตั้งค่าของเครื่อง'), danger: true, confirmText: t('ยกเลิกการเชื่อมต่อ') }); if (c.ok) { try { await api.del(`/api/stores/${info.id}/devices/${d.id}`); void qc.invalidateQueries({ queryKey: ['store', info.id, 'info'] }); } catch (e) { toast.error(errorMessage(e)); } } }}>{t('ยกเลิกการเชื่อมต่อ')}</Button>
        </div>
      ))}
      {!info.devices.length && <p className="px-5 py-8 text-center text-muted">{t('ยังไม่มีเครื่อง POS เชื่อมต่อ')}</p>}
    </Card>
  );
}

function ActivityTab({ info }: { info: Info }) {
  type C = { id: string; tbl: string; op: string; row_id: string; status: string; error: string | null; created_by: string; created_at: string; applied_at: string | null };
  const q = useQuery({ queryKey: ['store', info.id, 'commands'], queryFn: () => api.get<{ commands: C[] }>(`/api/stores/${info.id}/commands`) });
  return (
    <Card pad={false} title={<span className="flex items-center gap-2 px-5 pt-4">{t('การแก้ไขที่ส่งไปเครื่อง POS')}<button onClick={() => void q.refetch()} className="text-muted"><RefreshCw className="h-4 w-4" /></button></span>}>
      {!q.data ? <div className="p-5"><SkeletonRows /></div> : (
        <div className="flex flex-col">
          {q.data.commands.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-2.5 text-[14px] last:border-0">
              <Badge tone={c.status === 'applied' ? 'success' : c.status === 'rejected' ? 'danger' : 'warn'}>{c.status === 'applied' ? t('ส่งถึง POS แล้ว') : c.status === 'rejected' ? t('POS ปฏิเสธ') : t('รอส่ง')}</Badge>
              <span className="font-mono text-[13px]">{c.op} {c.tbl}</span>
              <span className="flex-1 truncate text-muted">{c.error ?? c.row_id}</span>
              <span className="text-[13px] text-muted">{c.created_by} · {dateTime(c.created_at)}</span>
            </div>
          ))}
          {!q.data.commands.length && <p className="px-5 py-8 text-center text-muted">{t('ยังไม่มีการแก้ไขจากเว็บ')}</p>}
        </div>
      )}
    </Card>
  );
}
