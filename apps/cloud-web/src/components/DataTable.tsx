import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { t } from '@flexpos/shared';
import { cn } from '@/lib/utils';
import { Badge, Button, Field, Input, Switch, Textarea } from '@/components/ui/core';
import { Dialog } from '@/components/ui/dialog';
import { MONEY_COLS, dateTime, money } from '~/lib/format';

export interface Column {
  name: string;
  /** POS column kind (id ref str short text big int real bool ts date) or a Postgres data type */
  kind?: string;
  type?: string;
  nullable?: boolean | string;
}

type Row = Record<string, unknown>;

const isBool = (c: Column) => c.kind === 'bool' || (c.kind === undefined && c.type === 'integer' && /^(active|disabled|revoked|taxable|is_|show_|required|exclusive|track_stock|bill_requested|online|open_drawer|system)/.test(c.name));
const isNum = (c: Column) => ['big', 'int', 'real', 'bool'].includes(c.kind ?? '') || /int|numeric|double|real/.test(c.type ?? '');
const isMoney = (c: Column) => MONEY_COLS.has(c.name) && (c.kind === 'big' || /bigint/.test(c.type ?? ''));
const isLong = (c: Column) => c.kind === 'text' || c.type === 'text';

export function cell(c: Column, v: unknown): string {
  if (v === null || v === undefined) return '';
  if (isMoney(c) && typeof v === 'number') return money(v);
  if (isBool(c)) return v ? '✓' : '—';
  if ((c.kind === 'ts' || /_at$/.test(c.name)) && typeof v === 'string' && /^\d{4}-/.test(v)) return dateTime(v);
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.startsWith('data:image') ? t('(รูปภาพ)') : s.length > 80 ? s.slice(0, 80) + '…' : s;
}

export function DataTable({ columns, rows, show, pending, rowKey = 'id', onEdit, onDelete }: { columns: Column[]; rows: Row[]; show?: string[]; pending?: Record<string, string>; rowKey?: string; onEdit?: (r: Row) => void; onDelete?: (r: Row) => void }) {
  const cols = show ? show.map((n) => columns.find((c) => c.name === n)).filter((c): c is Column => !!c) : columns;
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[640px] text-[14px]">
        <thead>
          <tr className="border-b border-line text-left text-[12px] text-muted">
            {cols.map((c) => <th key={c.name} className={cn('whitespace-nowrap px-3 py-2 font-medium', isNum(c) && 'text-right')}>{c.name}</th>)}
            {(onEdit || onDelete || pending) && <th className="w-[1%] px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const id = String(r[rowKey] ?? i);
            return (
              <tr key={id} className="border-b border-line-soft hover:bg-sunken">
                {cols.map((c) => <td key={c.name} className={cn('max-w-[320px] truncate px-3 py-2', isNum(c) && 'num text-right')}>{cell(c, r[c.name])}</td>)}
                {(onEdit || onDelete || pending) && (
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    {pending?.[id] && <Badge tone="warn" className="mr-2">{t('รอส่งไป POS')}</Badge>}
                    {onEdit && <button className="inline-grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink" onClick={() => onEdit(r)} aria-label={t('แก้ไข')}><Pencil className="h-4 w-4" /></button>}
                    {onDelete && <button className="inline-grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger" onClick={() => onDelete(r)} aria-label={t('ลบ')}><Trash2 className="h-4 w-4" /></button>}
                  </td>
                )}
              </tr>
            );
          })}
          {!rows.length && (
            <tr><td colSpan={cols.length + 1} className="px-3 py-10 text-center text-muted">{t('ไม่มีข้อมูล')}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Edit any row from its column metadata. Money columns are shown in baht. */
export function RowEditor({ open, title, columns, row, readOnly = [], onClose, onSave }: { open: boolean; title: string; columns: Column[]; row: Row | null; readOnly?: string[]; onClose: () => void; onSave: (values: Row) => Promise<void> }) {
  const [values, setValues] = useState<Row>({});
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState<Row | null>(null);
  if (open && row !== seed) {
    setSeed(row);
    setValues(row ?? {});
  }
  const set = (k: string, v: unknown) => setValues((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => !row || row[k] !== v));
      await onSave(row ? changed : values);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title={title} size="lg" footer={<><Button variant="ghost" onClick={onClose}>{t('ยกเลิก')}</Button><Button variant="primary" loading={busy} onClick={() => void save()}>{t('บันทึก')}</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        {columns.map((c) => {
          const v = values[c.name];
          const ro = readOnly.includes(c.name) || /(password_hash|token_hash|pin_hash)$/.test(c.name) && v === '••••••';
          if (isBool(c)) return <label key={c.name} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-[14px]"><span className="font-mono text-[13px]">{c.name}</span><Switch checked={!!v} disabled={ro} onChange={(x) => set(c.name, x ? 1 : 0)} label={c.name} /></label>;
          if (isLong(c) && typeof v === 'string' && v.startsWith('data:image')) return <Field key={c.name} label={c.name}><img src={v} alt="" className="h-20 w-20 rounded-lg object-cover" /></Field>;
          if (isLong(c)) return <Field key={c.name} label={<span className="font-mono">{c.name}</span>} className="md:col-span-2"><Textarea className="min-h-[72px] font-mono text-[13px]" disabled={ro} value={v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)} onChange={(e) => set(c.name, e.target.value)} /></Field>;
          if (isMoney(c)) return <Field key={c.name} label={<span className="font-mono">{c.name} (฿)</span>}><Input inputMode="decimal" disabled={ro} value={v == null ? '' : String(Number(v) / 100)} onChange={(e) => set(c.name, e.target.value === '' ? null : Math.round(Number(e.target.value) * 100))} /></Field>;
          return <Field key={c.name} label={<span className="font-mono">{c.name}</span>}><Input disabled={ro} inputMode={isNum(c) ? 'decimal' : undefined} value={v == null ? '' : String(v)} onChange={(e) => set(c.name, isNum(c) ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)} /></Field>;
        })}
      </div>
    </Dialog>
  );
}
