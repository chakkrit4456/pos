import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Database, Play, Plus } from 'lucide-react';
import { t } from '@flexpos/shared';
import { Badge, Button, Card, Field, Input, PageHeader, Pagination, Select, SkeletonRows, Switch, Textarea } from '@/components/ui/core';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { api, errorMessage } from '~/lib/api';
import { ago, dateTime } from '~/lib/format';
import { useLive } from '~/lib/live';
import { useSession } from '~/lib/session';
import { Tabs } from '~/components/Shell';
import { DataTable, RowEditor, type Column } from '~/components/DataTable';
import { roleLabel } from './Stores';
import { LicensesAdmin } from './Licenses';

type Tab = 'overview' | 'licenses' | 'stores' | 'users' | 'db' | 'logs';

export default function Admin() {
  const [tab, setTab] = useState<Tab>('overview');
  useLive('*');
  return (
    <>
      <PageHeader title={t('ผู้ดูแลระบบ')} sub="Superadmin" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: t('ภาพรวมระบบ') }, { id: 'licenses', label: 'License' }, { id: 'stores', label: t('ร้านทั้งหมด') }, { id: 'users', label: t('บัญชีผู้ใช้') }, { id: 'db', label: t('ฐานข้อมูล') }, { id: 'logs', label: 'Logs' }]} />
      {tab === 'overview' ? <Overview /> : tab === 'licenses' ? <LicensesAdmin /> : tab === 'stores' ? <StoresAdmin /> : tab === 'users' ? <UsersAdmin /> : tab === 'db' ? <DbBrowser /> : <Logs />}
    </>
  );
}

const run = async (fn: () => Promise<unknown>, ok?: string) => {
  try {
    await fn();
    if (ok) toast.success(ok);
    return true;
  } catch (e) {
    toast.error(errorMessage(e));
    return false;
  }
};

function Overview() {
  type O = { tenants: number; users: number; devices: number; devicesOnline: number; ingest24h: { batches: number; rows: number; errors: number }; dbBytes: number; uptimeSec: number; node: string };
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.get<O>('/api/admin/overview'), refetchInterval: 30_000 });
  const o = q.data;
  const tiles = o
    ? [
        [t('ร้าน'), o.tenants.toLocaleString()],
        [t('บัญชีผู้ใช้'), o.users.toLocaleString()],
        [t('เครื่อง POS ออนไลน์'), `${o.devicesOnline} / ${o.devices}`],
        [t('ข้อมูลเข้า 24 ชม.'), t('{0} แถว', o.ingest24h.rows.toLocaleString())],
        [t('ผิดพลาด 24 ชม.'), o.ingest24h.errors.toLocaleString()],
        [t('ขนาดฐานข้อมูล'), `${(o.dbBytes / 1024 ** 2).toFixed(1)} MB`],
        [t('เปิดเครื่องมา'), t('{0} ชม. {1} น.', Math.floor(o.uptimeSec / 3600), Math.floor((o.uptimeSec % 3600) / 60))],
        ['Node', o.node],
      ]
    : [];
  return !o ? <SkeletonRows /> : (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
      {tiles.map(([k, v]) => (
        <div key={k} className="card flex flex-col gap-1 px-5 py-4"><span className="text-[14px] text-muted">{k}</span><span className="num text-[24px] font-semibold">{v}</span></div>
      ))}
    </div>
  );
}

interface TenantRow { id: string; name: string; status: string; plan: string; note: string; schema: string; createdAt: string; lastSyncAt: string | null; lastSeenAt: string | null; online: boolean; posVersion: string | null; managers: string[]; members: number; devices: number }

function StoresAdmin() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['admin', 'tenants'], queryFn: () => api.get<{ tenants: TenantRow[] }>('/api/admin/tenants') });
  const [edit, setEdit] = useState<Partial<TenantRow> & { managerUsername?: string; managerName?: string; managerPassword?: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin'] });
  const save = async () => {
    if (!edit) return;
    const ok = edit.id
      ? await run(() => api.patch(`/api/admin/tenants/${edit.id}`, { name: edit.name, status: edit.status, plan: edit.plan, note: edit.note }), t('บันทึกแล้ว'))
      : await run(() => api.post('/api/admin/tenants', { name: edit.name, plan: edit.plan ?? '', managerUsername: edit.managerUsername || undefined, managerName: edit.managerName || undefined, managerPassword: edit.managerPassword || undefined }), t('สร้างร้านแล้ว'));
    if (ok) {
      setEdit(null);
      refresh();
    }
  };
  const remove = async (r: TenantRow) => {
    const c = await confirm({ title: t('ลบร้าน {0} ถาวร?', r.name), body: t('ข้อมูลบนคลาวด์ของร้านนี้ทั้งหมดจะถูกลบ (ข้อมูลในเครื่อง POS ไม่ถูกลบ) พิมพ์ชื่อร้านเพื่อยืนยัน'), danger: true, confirmText: t('ลบถาวร'), reason: { label: t('ชื่อร้าน'), placeholder: r.name } });
    if (!c.ok) return;
    if (c.reason !== r.name.trim()) return void toast.error(t('ชื่อร้านไม่ตรงกัน'));
    if (await run(() => api.del(`/api/admin/tenants/${r.id}`), t('ลบร้านแล้ว'))) refresh();
  };
  return (
    <>
      <div className="flex justify-end"><Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ name: '', plan: '' })}>{t('สร้างร้าน')}</Button></div>
      <Card pad={false}>
        {!q.data ? <div className="p-5"><SkeletonRows /></div> : q.data.tenants.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3 last:border-0">
            <div className="flex min-w-0 flex-1 flex-col">
              <Link to={`/s/${r.id}`} className="font-semibold hover:underline">{r.name}</Link>
              <span className="truncate text-[13px] text-muted">{r.managers.join(', ') || t('ไม่มีผู้จัดการ')} · {t('{0} ผู้ใช้ · {1} เครื่อง', r.members, r.devices)} · {t('ข้อมูลล่าสุด {0}', ago(r.lastSyncAt))}</span>
            </div>
            {r.online ? <Badge tone="success">{t('ออนไลน์')}</Badge> : <Badge>{t('ออฟไลน์')}</Badge>}
            {r.status !== 'active' && <Badge tone="danger">{t('ระงับ')}</Badge>}
            {r.plan && <Badge tone="info">{r.plan}</Badge>}
            <Button size="sm" onClick={() => setEdit(r)}>{t('แก้ไข')}</Button>
            <Button size="sm" variant="ghost" onClick={() => void remove(r)}>{t('ลบ')}</Button>
          </div>
        ))}
      </Card>
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} title={edit?.id ? t('แก้ไขร้าน') : t('สร้างร้าน')} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>{t('ยกเลิก')}</Button><Button variant="primary" disabled={!edit?.name} onClick={() => void save()}>{t('บันทึก')}</Button></>}>
        {edit && (
          <div className="grid gap-3">
            <Field label={t('ชื่อร้าน')} required><Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label={t('แพ็กเกจ')}><Input value={edit.plan ?? ''} onChange={(e) => setEdit({ ...edit, plan: e.target.value })} /></Field>
            {edit.id ? (
              <>
                <label className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5 text-[14px]">{t('ระงับการใช้งาน')}<Switch checked={edit.status === 'suspended'} onChange={(v) => setEdit({ ...edit, status: v ? 'suspended' : 'active' })} label={t('ระงับ')} /></label>
                <Field label={t('บันทึกภายใน')}><Textarea value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Field>
                <p className="font-mono text-[12px] text-muted">schema: {edit.schema}</p>
              </>
            ) : (
              <>
                <Field label={t('ชื่อผู้ใช้ผู้จัดการ')} hint={t('ถ้ามีบัญชีอยู่แล้วจะถูกเพิ่มเป็นผู้จัดการร้านนี้')}><Input autoCapitalize="none" value={edit.managerUsername ?? ''} onChange={(e) => setEdit({ ...edit, managerUsername: e.target.value })} /></Field>
                <Field label={t('ชื่อผู้จัดการ')}><Input value={edit.managerName ?? ''} onChange={(e) => setEdit({ ...edit, managerName: e.target.value })} /></Field>
                <Field label={t('รหัสผ่าน (บัญชีใหม่)')}><Input type="password" autoComplete="new-password" value={edit.managerPassword ?? ''} onChange={(e) => setEdit({ ...edit, managerPassword: e.target.value })} /></Field>
              </>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

interface UserRow { id: string; username: string; name: string; isSuperadmin: boolean; disabled: boolean; createdAt: string; lastLoginAt: string | null; stores: { tenantId: string; name: string; role: string }[] }

function UsersAdmin() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { user: me } = useSession();
  const q = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api.get<{ users: UserRow[] }>('/api/admin/users') });
  const tenants = useQuery({ queryKey: ['admin', 'tenants'], queryFn: () => api.get<{ tenants: TenantRow[] }>('/api/admin/tenants') });
  const [edit, setEdit] = useState<(Partial<UserRow> & { password?: string }) | null>(null);
  const [member, setMember] = useState({ tenantId: '', role: 'viewer' });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin'] });
  const save = async () => {
    if (!edit) return;
    const ok = edit.id
      ? await run(() => api.patch(`/api/admin/users/${edit.id}`, { name: edit.name, username: edit.username, password: edit.password || undefined, disabled: edit.disabled, isSuperadmin: edit.isSuperadmin }), t('บันทึกแล้ว'))
      : await run(() => api.post('/api/admin/users', { name: edit.name, username: edit.username, password: edit.password, isSuperadmin: !!edit.isSuperadmin }), t('สร้างบัญชีแล้ว'));
    if (ok) {
      setEdit(null);
      refresh();
    }
  };
  const setRole = async (userId: string, tenantId: string, role: string | null) => {
    if (await run(() => api.put(`/api/admin/users/${userId}/memberships`, { tenantId, role }))) {
      refresh();
      setEdit((e) => e && { ...e, stores: role ? [...(e.stores ?? []).filter((s) => s.tenantId !== tenantId), { tenantId, role, name: tenants.data?.tenants.find((x) => x.id === tenantId)?.name ?? '' }] : (e.stores ?? []).filter((s) => s.tenantId !== tenantId) });
    }
  };
  return (
    <>
      <div className="flex justify-end"><Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ name: '', username: '', password: '' })}>{t('สร้างบัญชี')}</Button></div>
      <Card pad={false}>
        {!q.data ? <div className="p-5"><SkeletonRows /></div> : q.data.users.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3 last:border-0">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">{u.name} <span className="text-[13px] font-normal text-muted">{u.username}</span></span>
              <span className="truncate text-[13px] text-muted">{u.stores.map((s) => `${s.name} (${roleLabel(s.role)})`).join(', ') || t('ไม่มีร้าน')} · {t('เข้าระบบล่าสุด {0}', ago(u.lastLoginAt))}</span>
            </div>
            {u.isSuperadmin && <Badge tone="dark">Superadmin</Badge>}
            {u.disabled && <Badge tone="danger">{t('ปิดใช้งาน')}</Badge>}
            <Button size="sm" onClick={() => setEdit(u)}>{t('แก้ไข')}</Button>
            {u.id !== me?.id && <Button size="sm" variant="ghost" onClick={async () => { const c = await confirm({ title: t('ลบบัญชี {0}?', u.username), danger: true, confirmText: t('ลบ') }); if (c.ok && (await run(() => api.del(`/api/admin/users/${u.id}`)))) refresh(); }}>{t('ลบ')}</Button>}
          </div>
        ))}
      </Card>
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} title={edit?.id ? t('แก้ไขบัญชี') : t('สร้างบัญชี')} size="lg" footer={<><Button variant="ghost" onClick={() => setEdit(null)}>{t('ยกเลิก')}</Button><Button variant="primary" onClick={() => void save()}>{t('บันทึก')}</Button></>}>
        {edit && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t('ชื่อ')}><Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label={t('ชื่อผู้ใช้')} hint={t('ใช้เข้าสู่ระบบ เป็นอีเมลหรือชื่อก็ได้')}><Input autoCapitalize="none" value={edit.username ?? ''} onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></Field>
            <Field label={edit.id ? t('ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)') : t('รหัสผ่าน')}><Input type="password" autoComplete="new-password" value={edit.password ?? ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
            <div className="flex flex-col gap-2">
              <label className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5 text-[14px]">Superadmin<Switch checked={!!edit.isSuperadmin} onChange={(v) => setEdit({ ...edit, isSuperadmin: v })} label="superadmin" /></label>
              {edit.id && <label className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5 text-[14px]">{t('ปิดใช้งาน')}<Switch checked={!!edit.disabled} onChange={(v) => setEdit({ ...edit, disabled: v })} label={t('ปิดใช้งาน')} /></label>}
            </div>
            {edit.id && (
              <div className="flex flex-col gap-2 md:col-span-2">
                <span className="text-[14px] font-semibold">{t('ร้านที่เข้าถึงได้')}</span>
                {(edit.stores ?? []).map((s) => (
                  <div key={s.tenantId} className="flex items-center gap-2 text-[14px]">
                    <span className="flex-1">{s.name}</span>
                    <Select value={s.role} onChange={(e) => void setRole(edit.id!, s.tenantId, e.target.value)} className="h-9 w-auto"><option value="manager">{roleLabel('manager')}</option><option value="viewer">{roleLabel('viewer')}</option></Select>
                    <Button size="sm" variant="ghost" onClick={() => void setRole(edit.id!, s.tenantId, null)}>{t('นำออก')}</Button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={member.tenantId} onChange={(e) => setMember({ ...member, tenantId: e.target.value })} className="h-10 min-w-[200px] flex-1">
                    <option value="">{t('เลือกร้าน…')}</option>
                    {tenants.data?.tenants.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </Select>
                  <Select value={member.role} onChange={(e) => setMember({ ...member, role: e.target.value })} className="h-10 w-auto"><option value="manager">{roleLabel('manager')}</option><option value="viewer">{roleLabel('viewer')}</option></Select>
                  <Button size="sm" disabled={!member.tenantId} onClick={() => void setRole(edit.id!, member.tenantId, member.role)}>{t('เพิ่มสิทธิ์')}</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

function DbBrowser() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [schema, setSchema] = useState('public');
  const [table, setTable] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<{ row: Record<string, unknown> | null } | null>(null);
  const [sqlText, setSqlText] = useState('select * from tenants limit 20');
  const [result, setResult] = useState<{ rows: Record<string, unknown>[]; columns: string[]; ms: number; truncated: boolean } | null>(null);
  const pageSize = 50;
  const schemas = useQuery({ queryKey: ['admin', 'schemas'], queryFn: () => api.get<{ schemas: { name: string; label: string; tenantId: string | null }[] }>('/api/admin/db/schemas') });
  const tables = useQuery({ queryKey: ['admin', 'tables', schema], queryFn: () => api.get<{ tables: { name: string; rows: number; more: boolean }[] }>('/api/admin/db/tables', { schema }) });
  type Rows = { columns: Column[]; primaryKey: string[]; rows: Record<string, unknown>[]; total: number };
  const rows = useQuery({ queryKey: ['admin', 'rows', schema, table, search, page], queryFn: () => api.get<Rows>('/api/admin/db/rows', { schema, table, q: search, limit: pageSize, offset: (page - 1) * pageSize }), enabled: !!table });
  const pk = rows.data?.primaryKey ?? [];
  const keyOf = (r: Record<string, unknown>) => Object.fromEntries(pk.map((k) => [k, r[k]]));
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'rows'] });
  const isTenant = schema !== 'public';
  const save = async (values: Record<string, unknown>) => {
    const r = await api.post<{ queued: boolean }>('/api/admin/db/row', { schema, table, key: edit?.row ? keyOf(edit.row) : undefined, values }).catch((e) => { toast.error(errorMessage(e)); throw e; });
    toast.success(r.queued ? t('บันทึกแล้ว และจะส่งไปที่เครื่อง POS ของร้าน') : t('บันทึกแล้ว'));
    refresh();
  };
  const runSql = async () => {
    try {
      setResult(await api.post('/api/admin/db/query', { sql: sqlText }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const cols: Column[] = (rows.data?.columns ?? []).map((c) => ({ ...c, kind: undefined }));
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('ฐานข้อมูล')}>
          <Select value={schema} onChange={(e) => { setSchema(e.target.value); setTable(''); setPage(1); }} className="h-11 min-w-[240px]">
            {schemas.data?.schemas.map((s) => <option key={s.name} value={s.name}>{s.label} ({s.name.slice(0, 12)})</option>)}
          </Select>
        </Field>
        <Field label={t('ตาราง')}>
          <Select value={table} onChange={(e) => { setTable(e.target.value); setPage(1); }} className="h-11 min-w-[240px]">
            <option value="">{t('เลือกตาราง…')}</option>
            {tables.data?.tables.map((x) => <option key={x.name} value={x.name}>{x.name} ({x.rows.toLocaleString()}{x.more ? '+' : ''})</option>)}
          </Select>
        </Field>
        {table && <Field label={t('ค้นหา')} className="min-w-[200px] flex-1"><Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></Field>}
        {table && pk.length > 0 && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ row: null })}>{t('เพิ่มแถว')}</Button>}
      </div>
      {isTenant && table && <p className="text-[13px] text-muted">{t('ตารางข้อมูลหลัก (สินค้า ลูกค้า โปรโมชั่น ฯลฯ) ที่แก้ไขในฐานข้อมูลร้านจะถูกส่งไปเครื่อง POS ด้วย ตารางอื่นแก้ไขเฉพาะบนคลาวด์ และอาจถูกเขียนทับเมื่อ POS ส่งข้อมูลใหม่')}</p>}
      {table && (
        <Card pad={false}>
          {!rows.data ? <div className="p-5"><SkeletonRows /></div> : (
            <>
              <DataTable columns={cols} rows={rows.data.rows} show={cols.slice(0, 10).map((c) => c.name)} rowKey={pk[0] ?? 'id'} onEdit={pk.length ? (row) => setEdit({ row }) : undefined} onDelete={pk.length ? async (row) => { const c = await confirm({ title: t('ลบแถวนี้?'), body: JSON.stringify(keyOf(row)), danger: true, confirmText: t('ลบ') }); if (c.ok && (await run(() => api.post('/api/admin/db/delete', { schema, table, key: keyOf(row) }), t('ลบแล้ว')))) refresh(); } : undefined} />
              <Pagination page={page} pageSize={pageSize} total={rows.data.total} onPage={setPage} />
            </>
          )}
        </Card>
      )}
      {rows.data && <RowEditor open={!!edit} title={`${schema}.${table}`} columns={cols} row={edit?.row ?? null} onClose={() => setEdit(null)} onSave={save} />}

      <Card title={<span className="flex items-center gap-2"><Database className="h-4 w-4" />{t('คำสั่ง SQL (อ่านอย่างเดียว)')}</span>}>
        <p className="text-[13px] text-muted">{tn_schema()}</p>
        <Textarea className="min-h-[96px] font-mono text-[13px]" value={sqlText} onChange={(e) => setSqlText(e.target.value)} />
        <Button className="self-start" icon={<Play className="h-4 w-4" />} onClick={() => void runSql()}>{t('รัน')}</Button>
        {result && (
          <>
            <span className="text-[13px] text-muted">{t('{0} แถว · {1} ms', result.rows.length, result.ms)}{result.truncated ? t(' (แสดง 1,000 แถวแรก)') : ''}</span>
            <DataTable columns={result.columns.map((name) => ({ name }))} rows={result.rows} rowKey="__none" />
          </>
        )}
      </Card>
    </>
  );
}

const tn_schema = () => t('ข้อมูลแต่ละร้านอยู่ใน schema ของร้าน เช่น select * from "t_…".sales limit 10');

type LogResp = { items?: Record<string, unknown>[]; lines?: string[]; note?: string };

function Logs() {
  const [kind, setKind] = useState<'audit' | 'ingest' | 'pos' | 'app'>('audit');
  const [tenantId, setTenantId] = useState('');
  const [page, setPage] = useState(1);
  const tenants = useQuery({ queryKey: ['admin', 'tenants'], queryFn: () => api.get<{ tenants: TenantRow[] }>('/api/admin/tenants') });
  const limit = 100;
  const q = useQuery({
    queryKey: ['admin', 'logs', kind, tenantId, page],
    queryFn: () => (kind === 'app' ? api.get<LogResp>('/api/admin/logs/app', { lines: 500 }) : api.get<LogResp>(`/api/admin/logs/${kind}`, { tenantId: tenantId || undefined, limit, offset: (page - 1) * limit })),
    enabled: kind !== 'pos' || !!tenantId,
    refetchInterval: 15_000,
  });
  const data = q.data;
  const items = data?.items ?? [];
  const show: Record<string, string[]> = {
    audit: ['created_at', 'user_email', 'tenant_name', 'action', 'entity', 'entity_id', 'ip', 'detail'],
    ingest: ['created_at', 'tenant_name', 'device_name', 'rows', 'deleted', 'ms', 'tables', 'error'],
    pos: ['created_at', 'user_name', 'action', 'entity', 'entity_id', 'detail'],
  };
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('ประเภท')}>
          <Select value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setPage(1); }} className="h-11 min-w-[260px]">
            <option value="audit">{t('การใช้งานบนคลาวด์')}</option>
            <option value="ingest">{t('การรับข้อมูลจากเครื่อง POS')}</option>
            <option value="pos">{t('บันทึกการใช้งานที่เครื่อง POS')}</option>
            <option value="app">{t('log ของเซิร์ฟเวอร์')}</option>
          </Select>
        </Field>
        {kind !== 'app' && (
          <Field label={t('ร้าน')}>
            <Select value={tenantId} onChange={(e) => { setTenantId(e.target.value); setPage(1); }} className="h-11 min-w-[220px]">
              {kind !== 'pos' && <option value="">{t('ทุกร้าน')}</option>}
              {kind === 'pos' && <option value="">{t('เลือกร้าน…')}</option>}
              {tenants.data?.tenants.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <Card pad={false}>
        {kind === 'app' ? (
          <pre className="scroll-thin max-h-[70vh] overflow-auto p-4 font-mono text-[12px] leading-relaxed">{data?.note ?? data?.lines?.join('\n') ?? ''}</pre>
        ) : kind === 'pos' && !tenantId ? (
          <p className="px-5 py-8 text-center text-muted">{t('เลือกร้านเพื่อดูบันทึก')}</p>
        ) : !q.data ? <div className="p-5"><SkeletonRows /></div> : (
          <>
            <DataTable columns={(show[kind] ?? []).map((name) => ({ name, kind: name === 'created_at' ? 'ts' : undefined }))} rows={items} show={show[kind]} />
            <div className="flex justify-end gap-2 px-5 py-3">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('ก่อนหน้า')}</Button>
              <Button size="sm" disabled={items.length < limit} onClick={() => setPage(page + 1)}>{t('ถัดไป')}</Button>
            </div>
          </>
        )}
      </Card>
      <p className="text-[13px] text-muted">{t('อัปเดตอัตโนมัติทุก 15 วินาที · {0}', dateTime(new Date().toISOString()))}</p>
    </>
  );
}
