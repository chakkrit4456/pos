import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ChevronRight, Download, Folder, FolderOpen, FolderPlus, HardDrive, RotateCcw, Save, Upload, Usb } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useFormatters } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { Badge, Button, Card, EmptyState, Field, Input, Spinner, ToggleRow } from '@/components/ui/core';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { NumberInput } from '@/components/ui/inputs';
import { SaveBar, SectionTitle, useDraft } from './common';

const size = (b: number | null | undefined) => {
  if (b == null) return '';
  const gb = b / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(gb >= 100 ? 0 : 1)} GB` : `${Math.round(b / 1024 ** 2)} MB`;
};

interface Listing {
  path: string | null;
  parent: string | null;
  drives: { path: string; free: number | null; total: number | null }[];
  folders: { name: string; path: string }[];
  free?: number | null;
}

/** Browse drives and folders on the machine that runs the FlexPOS server. */
export function FolderPicker({ open, initial, onClose, onPick }: { open: boolean; initial?: string; onClose: () => void; onPick: (path: string) => void }) {
  const [path, setPath] = useState<string | null>(initial || null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['folders', path], queryFn: () => api.get<Listing>('/api/system/folders', { path: path ?? undefined }), enabled: open, retry: false });
  const crumbs = path ? path.split(/[\\/]/).filter(Boolean) : [];
  const sep = path?.includes('\\') ? '\\' : '/';
  const crumbPath = (i: number) => {
    const parts = crumbs.slice(0, i + 1);
    return sep === '\\' ? (parts.length === 1 ? `${parts[0]}\\` : parts.join('\\')) : '/' + parts.join('/');
  };
  const create = async () => {
    if (!path || !newName.trim()) return;
    try {
      const r = await api.post<{ path: string }>('/api/system/folders', { path, name: newName.trim() });
      setNewName('');
      setPath(r.path);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const choose = async () => {
    if (!path) return;
    setBusy(true);
    try {
      await api.post('/api/system/folders/check', { path });
      onPick(path);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="เลือกที่เก็บไฟล์สำรอง"
      description="เลือกไดรฟ์ แล้วเปิดโฟลเดอร์ที่ต้องการ (แนะนำไดรฟ์อื่นที่ไม่ใช่ไดรฟ์ติดตั้งโปรแกรม เช่น D:, แฟลชไดรฟ์ หรือโฟลเดอร์ OneDrive/Google Drive)"
      size="lg"
      footer={
        <>
          <span className="mr-auto truncate font-mono text-[13px] text-muted">{path ?? 'ยังไม่ได้เลือก'}</span>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" disabled={!path} loading={busy} onClick={() => void choose()}>
            ใช้โฟลเดอร์นี้
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-3">
        <nav className="flex flex-wrap items-center gap-1 text-[14px]" aria-label="ตำแหน่ง">
          <button onClick={() => setPath(null)} className={cn('rounded-lg px-2 py-1 hover:bg-sunken', !path && 'font-semibold')}>
            ไดรฟ์ทั้งหมด
          </button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="h-4 w-4 text-faint" />
              <button onClick={() => setPath(crumbPath(i))} className={cn('rounded-lg px-2 py-1 hover:bg-sunken', i === crumbs.length - 1 && 'font-semibold')}>
                {c}
              </button>
            </span>
          ))}
        </nav>
        <div className="min-h-[280px] rounded-xl border border-line">
          {q.isLoading ? (
            <Spinner className="mx-auto my-16" />
          ) : q.isError ? (
            <EmptyState title="เปิดโฟลเดอร์ไม่ได้" body={errorMessage(q.error)} action={<Button onClick={() => setPath(null)}>กลับไปเลือกไดรฟ์</Button>} />
          ) : !path ? (
            <div className="grid gap-2 p-3 sm:grid-cols-2">
              {q.data?.drives.map((d) => {
                const used = d.total && d.free != null ? 1 - d.free / d.total : null;
                const removable = !/^[CD]:/i.test(d.path) && d.path !== '/';
                return (
                  <button key={d.path} onClick={() => setPath(d.path)} className="flex items-center gap-3 rounded-xl border border-line p-3 text-left hover:border-primary hover:bg-soft/40">
                    <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-canvas text-ink-2">{removable ? <Usb className="h-5 w-5" /> : <HardDrive className="h-5 w-5" />}</span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="font-semibold">ไดรฟ์ {d.path.replace(/\\$/, '')}</span>
                      {used !== null && (
                        <>
                          <span className="h-1.5 overflow-hidden rounded-full bg-line-soft"><span className={cn('block h-full rounded-full', used > 0.9 ? 'bg-danger' : 'bg-accent')} style={{ width: `${used * 100}%` }} /></span>
                          <span className="text-[12px] text-muted">ว่าง {size(d.free)} จาก {size(d.total)}</span>
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex max-h-[340px] flex-col overflow-y-auto">
              {q.data?.parent && (
                <button onClick={() => setPath(q.data!.parent)} className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 text-left text-[14px] text-muted hover:bg-sunken">
                  <FolderOpen className="h-4 w-4" /> .. (ย้อนขึ้น)
                </button>
              )}
              {q.data?.folders.map((f) => (
                <button key={f.path} onDoubleClick={() => setPath(f.path)} onClick={() => setPath(f.path)} className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 text-left text-[14px] hover:bg-sunken">
                  <Folder className="h-4 w-4 text-warn" /> {f.name}
                </button>
              ))}
              {!q.data?.folders.length && <p className="px-4 py-8 text-center text-[14px] text-muted">ไม่มีโฟลเดอร์ย่อย · กด “ใช้โฟลเดอร์นี้” หรือสร้างโฟลเดอร์ใหม่ด้านล่าง</p>}
            </div>
          )}
        </div>
        {path && (
          <div className="flex gap-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ชื่อโฟลเดอร์ใหม่ เช่น FlexPOS-Backup" onKeyDown={(e) => e.key === 'Enter' && void create()} />
            <Button icon={<FolderPlus className="h-4 w-4" />} disabled={!newName.trim()} onClick={() => void create()}>
              สร้างโฟลเดอร์
            </Button>
          </div>
        )}
        {path && q.data?.free != null && <p className="text-[12px] text-muted">พื้นที่ว่างในไดรฟ์นี้ {size(q.data.free)}</p>}
      </div>
    </Dialog>
  );
}

interface BackupInfo {
  dir: string;
  defaultDir: string;
  chosenDir: string;
  fallback: boolean;
  free: number | null;
  items: { name: string; size: number; createdAt: string }[];
}

export function BackupSection() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const f = useFormatters();
  const d = useDraft('backup');
  const list = useQuery({ queryKey: ['backups'], queryFn: () => api.get<BackupInfo>('/api/backups') });
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const info = list.data;

  const restore = async (name: string | null, file?: File) => {
    const r = await confirm({ title: 'กู้คืนข้อมูล?', body: 'ข้อมูลปัจจุบันทั้งหมดจะถูกแทนที่ด้วยไฟล์สำรอง ระบบจะสำรองข้อมูลปัจจุบันไว้ให้ก่อนอัตโนมัติ', danger: true, confirmText: 'กู้คืน' });
    if (!r.ok) return;
    setBusy(true);
    try {
      const res = file ? await api.upload<{ rows: number }>('/api/backups/restore', file) : await api.post<{ rows: number }>('/api/backups/restore', {}, { name: name! });
      toast.success(`กู้คืนสำเร็จ ${res.rows.toLocaleString()} รายการ กำลังโหลดใหม่…`);
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const backupNow = async () => {
    setBusy(true);
    try {
      await api.post('/api/backups');
      toast.success('สำรองข้อมูลแล้ว');
      qc.invalidateQueries({ queryKey: ['backups'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const saveDir = async () => {
    await d.save();
    qc.invalidateQueries({ queryKey: ['backups'] });
  };

  const chosen = d.draft.dir;
  return (
    <>
      <SectionTitle title="สำรองและกู้คืนข้อมูล" sub="ไฟล์สำรองใช้ได้กับฐานข้อมูลทุกชนิด ใช้ย้ายจาก SQLite ไป PostgreSQL/MySQL ได้" actions={<Button variant="primary" loading={busy} icon={<Save className="h-4 w-4" />} onClick={() => void backupNow()}>สำรองตอนนี้</Button>} />

      {info?.fallback && (
        <div className="flex items-start gap-3 rounded-2xl bg-warn-soft p-4 text-warn" role="alert">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-none" />
          <div className="text-[14px]">
            <div className="font-semibold">เข้าถึงโฟลเดอร์ที่เลือกไม่ได้: {info.chosenDir}</div>
            ไดรฟ์อาจถูกถอดออก ระบบกำลังสำรองไว้ที่โฟลเดอร์ของโปรแกรมแทน ({info.dir}) เสียบไดรฟ์กลับหรือเลือกที่เก็บใหม่
          </div>
        </div>
      )}

      <Card title="ที่เก็บไฟล์สำรอง">
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-sunken p-4 sm:flex-row sm:items-center">
          <span className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-surface text-primary shadow-card">
            <HardDrive className="h-6 w-6" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[13px] text-muted">{chosen ? 'โฟลเดอร์ที่เลือก' : 'โฟลเดอร์ของโปรแกรม (ค่าเริ่มต้น)'}</span>
            <span className="break-all font-mono text-[14px] font-medium">{chosen || info?.defaultDir}</span>
            {info?.free != null && !d.dirty && <span className="text-[12px] text-muted">พื้นที่ว่าง {size(info.free)}</span>}
          </div>
          <div className="flex flex-none gap-2">
            <Button icon={<FolderOpen className="h-4 w-4" />} onClick={() => setPicker(true)}>
              เลือกไดรฟ์/โฟลเดอร์
            </Button>
            {chosen && (
              <Button variant="ghost" onClick={() => d.set('dir', '')}>
                ใช้ค่าเริ่มต้น
              </Button>
            )}
          </div>
        </div>
        {!chosen && <p className="text-[13px] text-warn">แนะนำ: เลือกไดรฟ์อื่นหรือแฟลชไดรฟ์ เพื่อไม่ให้ข้อมูลหายถ้าฮาร์ดดิสก์เครื่องนี้เสีย</p>}
      </Card>

      <Card title="สำรองอัตโนมัติ">
        <div className="-my-2 flex flex-col">
          <ToggleRow label="เปิดการสำรองอัตโนมัติ" hint="ระบบสำรองเองตามเวลาที่ตั้ง แม้ไม่มีใครกด" checked={d.draft.auto} onChange={(v) => d.set('auto', v)} />
        </div>
        {d.draft.auto && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="สำรองทุกๆ (ชั่วโมง)" hint="24 = วันละครั้ง">
              <NumberInput value={d.draft.intervalHours} onValue={(v) => d.set('intervalHours', Math.max(1, Math.min(168, v)))} />
            </Field>
            <Field label="เก็บไฟล์ไว้ (ไฟล์ล่าสุด)" hint="ไฟล์เก่ากว่านี้จะถูกลบอัตโนมัติ">
              <NumberInput value={d.draft.keep} onValue={(v) => d.set('keep', Math.max(1, Math.min(365, v)))} />
            </Field>
          </div>
        )}
      </Card>

      <Card
        title={`ไฟล์สำรอง${info?.items.length ? ` (${info.items.length})` : ''}`}
        action={
          <label className="inline-flex">
            <input type="file" accept=".gz,application/gzip" className="sr-only" onChange={(e) => e.target.files?.[0] && void restore(null, e.target.files[0])} />
            <span className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[10px] border border-line-strong px-3 text-sm font-medium hover:bg-sunken">
              <Upload className="h-4 w-4" />
              กู้คืนจากไฟล์อื่น
            </span>
          </label>
        }
      >
        {!info?.items.length ? (
          <EmptyState title="ยังไม่มีไฟล์สำรองในโฟลเดอร์นี้" body="กด “สำรองตอนนี้” เพื่อสร้างไฟล์แรก" />
        ) : (
          info.items.map((b) => (
            <div key={b.name} className="flex flex-wrap items-center gap-2 border-b border-line-soft py-2.5 last:border-0">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-medium">
                  {f.dateTime(b.createdAt)}
                  <Badge tone={b.name.includes('-auto-') ? 'info' : b.name.includes('pre-restore') ? 'warn' : 'neutral'}>{b.name.includes('-auto-') ? 'อัตโนมัติ' : b.name.includes('pre-restore') ? 'ก่อนกู้คืน' : 'กดเอง'}</Badge>
                </span>
                <span className="truncate font-mono text-[12px] text-muted">{b.name} · {(b.size / 1024).toFixed(0)} KB</span>
              </span>
              <Button size="sm" icon={<Download className="h-4 w-4" />} onClick={() => void api.download(`/api/backups/${encodeURIComponent(b.name)}`, undefined, b.name)}>ดาวน์โหลด</Button>
              <Button size="sm" icon={<RotateCcw className="h-4 w-4" />} disabled={busy} onClick={() => void restore(b.name)}>กู้คืน</Button>
            </div>
          ))
        )}
      </Card>

      <FolderPicker open={picker} initial={chosen || info?.dir} onClose={() => setPicker(false)} onPick={(p) => d.set('dir', p)} />
      <SaveBar dirty={d.dirty} saving={d.saving} onSave={() => void saveDir()} onReset={d.reset} />
    </>
  );
}
