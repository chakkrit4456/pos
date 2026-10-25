import { Fragment, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, KeyRound, Plus } from 'lucide-react';
import { PERMISSION_GROUPS, PERMISSIONS, initials, type LicenseStatus, type Permission } from '@flexpos/shared';
import { api, errorMessage } from '@/lib/api';
import { useFormatters } from '@/lib/settings';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Badge, Button, Card, EmptyState, Field, Input, Pagination, Select, SkeletonRows, Switch, Textarea } from '@/components/ui/core';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { SaveBar, SectionTitle } from './common';

interface UserRow { id: string; username: string; name: string; roleId: string; roleName: string; roleCode: string; branchId: string | null; branchName: string | null; active: boolean; lastLoginAt: string | null; hasPin: boolean; permissionCount: number }
interface Role { id: string; code: string; name: string; permissions: Permission[]; system: boolean; userCount: number }

export function StaffSection() {
  const qc = useQueryClient();
  const f = useFormatters();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserRow[]>('/api/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/api/roles') });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/branches') });
  const [edit, setEdit] = useState<(Partial<UserRow> & { password?: string; pin?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      const body = { name: edit.name, username: edit.username, password: edit.password || '', pin: edit.pin || '', roleId: edit.roleId, branchId: edit.branchId || null, active: edit.active ?? true };
      if (edit.id) await api.put(`/api/users/${edit.id}`, body);
      else await api.post('/api/users', body);
      qc.invalidateQueries({ queryKey: ['users'] });
      setEdit(null);
      toast.success('บันทึกพนักงานแล้ว');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const isNew = !edit?.id;
  return (
    <>
      <SectionTitle title="พนักงาน" sub="พนักงานเข้าใช้ด้วย PIN เพื่อสลับคนได้เร็ว หรือชื่อผู้ใช้/รหัสผ่านสำหรับหลังร้าน" actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ active: true, roleId: roles.data?.find((r) => r.code === 'cashier')?.id })}>เพิ่มพนักงาน</Button>} />
      <Card pad={false}>
        {users.isLoading ? <SkeletonRows /> : users.data?.map((u) => (
          <button key={u.id} onClick={() => setEdit(u)} className={cn('flex w-full flex-wrap items-center gap-3.5 border-b border-line-soft px-5 py-3.5 text-left last:border-0 hover:bg-sunken', !u.active && 'opacity-55')}>
            <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-soft text-[14px] font-semibold text-soft-fg">{initials(u.name)}</span>
            <span className="flex min-w-[140px] flex-1 flex-col"><span className="font-medium">{u.name}</span><span className="text-[13px] text-muted">{u.username} · PIN {u.hasPin ? '••••' : 'ยังไม่ตั้ง'}</span></span>
            <span className="whitespace-nowrap rounded-full bg-canvas px-2.5 py-1 text-[13px] font-semibold">{u.roleName}</span>
            <span className="min-w-[190px] text-[13px] text-muted">{u.permissionCount} สิทธิ์{u.branchName ? ` · ${u.branchName}` : ''}{u.lastLoginAt ? ` · เข้าล่าสุด ${f.dateTime(u.lastLoginAt)}` : ''}</span>
            {!u.active && <Badge>ปิดใช้งาน</Badge>}
          </button>
        ))}
      </Card>
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} title={isNew ? 'เพิ่มพนักงาน' : `แก้ไข ${edit?.name}`} footer={<><Button onClick={() => setEdit(null)}>ยกเลิก</Button><Button variant="primary" loading={busy} disabled={!edit?.name?.trim() || !edit?.username?.trim() || !edit?.roleId || (isNew && (edit?.password?.length ?? 0) < 8)} onClick={() => void save()}>บันทึก</Button></>}>
        {edit && (
          <div className="grid gap-4 pb-2 md:grid-cols-2">
            <Field label="ชื่อที่แสดง" required><Input autoFocus value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="ชื่อผู้ใช้" required><Input autoComplete="off" value={edit.username ?? ''} onChange={(e) => setEdit({ ...edit, username: e.target.value.trim().toLowerCase() })} /></Field>
            <Field label={isNew ? 'รหัสผ่าน' : 'รหัสผ่านใหม่'} required={isNew} hint={isNew ? 'อย่างน้อย 8 ตัวอักษร' : 'เว้นว่างถ้าไม่เปลี่ยน'}><Input type="password" autoComplete="new-password" value={edit.password ?? ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
            <Field label={edit.hasPin ? 'PIN ใหม่' : 'PIN'} hint="ตัวเลข 4-6 หลัก ไม่ซ้ำกับคนอื่น"><Input inputMode="numeric" type="password" autoComplete="off" value={edit.pin ?? ''} onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></Field>
            <Field label="บทบาท" required><Select value={edit.roleId ?? ''} onChange={(e) => setEdit({ ...edit, roleId: e.target.value })}>{roles.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
            {(branches.data?.length ?? 0) > 1 && <Field label="สาขา" hint="เว้นว่าง = ทุกสาขา"><Select value={edit.branchId ?? ''} onChange={(e) => setEdit({ ...edit, branchId: e.target.value || null })}><option value="">ทุกสาขา</option>{branches.data!.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>}
            <label className="flex items-center justify-between md:col-span-2"><span>เปิดใช้งาน</span><Switch checked={edit.active ?? true} onChange={(active) => setEdit({ ...edit, active })} /></label>
          </div>
        )}
      </Dialog>
    </>
  );
}

export function RolesSection() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/api/roles') });
  const [draft, setDraft] = useState<Record<string, Permission[]>>({});
  const [newName, setNewName] = useState('');
  const perms = (r: Role) => draft[r.id] ?? r.permissions;
  const dirty = Object.keys(draft).length > 0;
  const toggle = (r: Role, p: Permission) => {
    if (r.code === 'owner') return;
    const cur = perms(r);
    setDraft({ ...draft, [r.id]: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] });
  };
  const save = async () => {
    try {
      for (const [id, permissions] of Object.entries(draft)) {
        const r = roles.data!.find((x) => x.id === id)!;
        await api.put(`/api/roles/${id}`, { name: r.name, permissions });
      }
      setDraft({});
      qc.invalidateQueries({ queryKey: ['roles'] });
      toast.success('บันทึกสิทธิ์แล้ว มีผลภายใน 15 วินาที');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <SectionTitle title="บทบาทและสิทธิ์" sub="กำหนดสิทธิ์รายข้อให้แต่ละบทบาท เจ้าของร้านมีสิทธิ์ทั้งหมดเสมอ" />
      <form className="flex max-w-[480px] gap-2" onSubmit={async (e) => { e.preventDefault(); try { await api.post('/api/roles', { name: newName, permissions: ['pos.sell'] }); setNewName(''); qc.invalidateQueries({ queryKey: ['roles'] }); } catch (err) { toast.error(errorMessage(err)); } }}>
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ชื่อบทบาทใหม่ เช่น หัวหน้ากะ" />
        <Button type="submit" disabled={!newName.trim()} icon={<Plus className="h-4 w-4" />}>เพิ่มบทบาท</Button>
      </form>
      <div className="card overflow-x-auto">
        {roles.isLoading ? <SkeletonRows /> : (
          <table className="w-full min-w-[720px] text-[14px]">
            <thead className="sticky top-0 bg-sunken">
              <tr>
                <th className="px-4 py-3 text-left text-[13px] font-medium text-muted">สิทธิ์</th>
                {roles.data?.map((r) => (
                  <th key={r.id} className="px-2 py-3 text-center text-[13px] font-semibold">
                    <div className="flex flex-col items-center gap-0.5">
                      {r.name}
                      <span className="text-[11px] font-normal text-muted">{r.userCount} คน</span>
                      {!r.system && !['owner', 'manager', 'cashier', 'kitchen'].includes(r.code) && (
                        <button className="text-[11px] font-normal text-danger" onClick={async () => { const c = await confirm({ title: `ลบบทบาท ${r.name}?`, danger: true, confirmText: 'ลบ' }); if (c.ok) { try { await api.del(`/api/roles/${r.id}`); qc.invalidateQueries({ queryKey: ['roles'] }); } catch (e) { toast.error(errorMessage(e)); } } }}>ลบ</button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map((g) => (
                <Fragment key={g.label}>
                  <tr><td colSpan={(roles.data?.length ?? 0) + 1} className="bg-canvas px-4 py-2 text-[12px] font-semibold text-muted">{g.label}</td></tr>
                  {g.keys.map((p) => (
                    <tr key={p} className="border-t border-line-soft">
                      <td className="px-4 py-2">{PERMISSIONS[p]}</td>
                      {roles.data?.map((r) => (
                        <td key={r.id} className="px-2 py-1 text-center">
                          <input type="checkbox" className="h-[18px] w-[18px] accent-[rgb(var(--primary))]" checked={perms(r).includes(p)} disabled={r.code === 'owner'} onChange={() => toggle(r, p)} aria-label={`${r.name}: ${PERMISSIONS[p]}`} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <SaveBar dirty={dirty} saving={false} onSave={() => void save()} onReset={() => setDraft({})} />
    </>
  );
}

export function LicenseSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['license'], queryFn: () => api.get<LicenseStatus>('/api/license') });
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const l = q.data;
  const label = { trial: 'ทดลองใช้', active: 'ใช้งานได้', expired: 'หมดอายุ', invalid: 'ไม่ถูกต้อง' } as const;
  return (
    <>
      <SectionTitle title="License" />
      {l && (
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={l.state === 'active' ? 'success' : l.state === 'trial' ? 'info' : 'danger'}>{label[l.state]}</Badge>
            <span className="text-[15px] font-semibold">{l.licensee ?? 'FlexPOS'} · แพ็กเกจ {l.plan}</span>
            {l.daysLeft !== null && <span className="text-[14px] text-muted">เหลือ {l.daysLeft} วัน</span>}
          </div>
          <div className="text-[14px] text-ink-2">รองรับ {l.maxDevices} เครื่อง · {l.maxBranches} สาขา</div>
          <div className="flex items-center gap-2 rounded-xl bg-sunken px-3 py-2.5">
            <KeyRound className="h-4 w-4 text-muted" />
            <span className="text-[13px] text-muted">Machine ID</span>
            <span className="font-mono text-[14px] font-semibold">{l.machineId}</span>
            <Button size="sm" variant="ghost" className="ml-auto" icon={<Copy className="h-4 w-4" />} onClick={() => void navigator.clipboard?.writeText(l.machineId).then(() => toast.success('คัดลอกแล้ว'))}>คัดลอก</Button>
          </div>
          <p className="text-[13px] text-muted">ส่ง Machine ID ให้ผู้จำหน่ายเพื่อขอ License key · การตรวจสอบทำในเครื่องโดยไม่ต้องใช้อินเทอร์เน็ต</p>
        </Card>
      )}
      <Card title="ใส่ License key">
        <Textarea className="font-mono text-[13px]" value={key} onChange={(e) => setKey(e.target.value)} placeholder="วาง License key ที่ได้รับ" />
        <Button variant="primary" className="self-start" loading={busy} disabled={key.trim().length < 20} onClick={async () => { setBusy(true); try { await api.post('/api/license/activate', { key: key.trim() }); toast.success('เปิดใช้งาน License แล้ว'); setKey(''); qc.invalidateQueries({ queryKey: ['license'] }); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }}>เปิดใช้งาน</Button>
      </Card>
    </>
  );
}

const ACTION_LABEL: Record<string, string> = {
  'auth.login': 'เข้าสู่ระบบ', 'sale.void': 'ยกเลิกบิล', 'sale.refund': 'คืนสินค้า', 'sale.discount': 'ให้ส่วนลด', 'sale.price_override': 'แก้ราคาขาย', 'sale.reprint': 'พิมพ์ซ้ำ', 'sale.tax_invoice': 'ออกใบกำกับภาษี',
  'product.create': 'เพิ่มสินค้า', 'product.update': 'แก้ไขสินค้า', 'product.price_change': 'เปลี่ยนราคาสินค้า', 'product.delete': 'ลบสินค้า', 'product.bulk_update': 'แก้ไขสินค้าหลายรายการ', 'product.import': 'นำเข้าสินค้า',
  'stock.receive': 'รับสินค้าเข้า', 'stock.adjust': 'ปรับสต็อก', 'stock.count': 'นับสต็อก', 'stock.transfer': 'โอนสต็อก', 'shift.open': 'เปิดกะ', 'shift.close': 'ปิดกะ', 'shift.cash_in': 'นำเงินเข้า', 'shift.cash_out': 'นำเงินออก',
  'settings.update': 'เปลี่ยนการตั้งค่า', 'user.create': 'เพิ่มพนักงาน', 'user.update': 'แก้ไขพนักงาน', 'role.update': 'แก้ไขสิทธิ์', 'backup.restore': 'กู้คืนข้อมูล', 'backup.create': 'สำรองข้อมูล', 'drawer.open': 'เปิดลิ้นชัก', 'order.item_cancel': 'ยกเลิกรายการอาหาร', 'order.cancel': 'ยกเลิกบิลโต๊ะ',
};

export function AuditSection() {
  const f = useFormatters();
  const { can } = useSession();
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['audit', action, page], queryFn: () => api.get<{ total: number; items: { id: string; user_name: string; action: string; entity_id: string; detail: Record<string, unknown>; ip: string; created_at: string }[] }>('/api/audit', { action, page, pageSize: 50 }), enabled: can('audit.view'), placeholderData: keepPreviousData });
  return (
    <>
      <SectionTitle title="บันทึกการใช้งาน" sub="ทุกการกระทำสำคัญถูกบันทึกไว้และแก้ไขไม่ได้" />
      <Select className="w-auto self-start" value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} aria-label="ประเภท">
        <option value="">ทุกการกระทำ</option>
        {['sale.', 'product.', 'stock.', 'shift.', 'settings.', 'user.', 'backup.'].map((p) => <option key={p} value={p}>{{ 'sale.': 'การขาย', 'product.': 'สินค้า', 'stock.': 'สต็อก', 'shift.': 'กะ', 'settings.': 'การตั้งค่า', 'user.': 'พนักงาน', 'backup.': 'สำรองข้อมูล' }[p]}</option>)}
      </Select>
      <div className="card overflow-hidden">
        {q.isLoading ? <SkeletonRows /> : !q.data?.items.length ? <EmptyState title="ยังไม่มีบันทึก" /> : q.data.items.map((a) => (
          <div key={a.id} className="flex flex-wrap items-start gap-3 border-b border-line-soft px-5 py-2.5 text-[14px]">
            <span className="w-[140px] flex-none text-muted">{f.dateTime(a.created_at)}</span>
            <span className="w-[120px] flex-none font-medium">{a.user_name}</span>
            <span className="flex min-w-[200px] flex-1 flex-col">
              <span>{ACTION_LABEL[a.action] ?? a.action}</span>
              <span className="break-all text-[12px] text-muted">{Object.entries(a.detail).filter(([, v]) => v !== undefined && v !== '').slice(0, 6).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')}</span>
            </span>
          </div>
        ))}
        <Pagination page={page} pageSize={50} total={q.data?.total ?? 0} onPage={setPage} />
      </div>
    </>
  );
}
