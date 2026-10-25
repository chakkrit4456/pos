import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { Badge, Button } from '@/components/ui/core';
import { Dialog } from '@/components/ui/dialog';
import { t } from '@flexpos/shared';
import { tn } from '@/lib/i18n';

interface ImportResult {
  summary: { total: number; create: number; update: number; invalid: number };
  rows: { row: number; data: Record<string, string>; errors: string[]; action: 'create' | 'update' }[];
  committed: boolean;
}

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = () => {
    setFile(null);
    setRes(null);
  };
  const check = async (f: File) => {
    setFile(f);
    setBusy(true);
    try {
      setRes(await api.upload<ImportResult>('/api/products/import', f, { commit: 0 }));
    } catch (e) {
      toast.error(errorMessage(e));
      setFile(null);
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await api.upload<ImportResult>('/api/products/import', file, { commit: 1 });
      toast.success(t('นำเข้าแล้ว: เพิ่ม {0} · อัปเดต {1} รายการ', r.summary.create, r.summary.update));
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
      reset();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const invalid = res?.rows.filter((r) => r.errors.length) ?? [];
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && (reset(), onClose())}
      title={t('นำเข้าสินค้าจาก Excel / CSV')}
      description={t('ระบบตรวจไฟล์ทั้งหมดก่อน จะบันทึกเมื่อทุกแถวถูกต้องเท่านั้น สินค้าที่ SKU ตรงกับของเดิมจะถูกอัปเดต')}
      size="lg"
      footer={
        <>
          <Button className="mr-auto" variant="ghost" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => api.download('/api/products/import-template', { format: 'xlsx' }, 'template.xlsx').catch((e) => toast.error(errorMessage(e)))}>{t('ดาวน์โหลดไฟล์ตัวอย่าง')}</Button>
          {res && <Button onClick={reset}>{t('เลือกไฟล์ใหม่')}</Button>}
          <Button variant="primary" disabled={!res || res.summary.invalid > 0 || res.summary.total === 0} loading={busy && !!res} onClick={() => void commit()}>{tn('นำเข้า {0} รายการ', res ? res.summary.total.toLocaleString() : '')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-3">
        {!res ? (
          <label className="flex h-[180px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong bg-sunken text-center hover:border-primary">
            <Upload className="h-7 w-7 text-muted" />
            <span className="font-semibold">{busy ? t('กำลังตรวจสอบไฟล์…') : t('เลือกไฟล์ .xlsx หรือ .csv')}</span>
            <span className="text-[13px] text-muted">{t('คอลัมน์ที่จำเป็น: ชื่อสินค้า, ราคาขาย · ใช้ไฟล์ตัวอย่างเพื่อความถูกต้อง')}</span>
            <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && void check(e.target.files[0])} />
          </label>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge>{file?.name}</Badge>
              <Badge tone="info">{tn('ทั้งหมด {0}', res.summary.total)}</Badge>
              <Badge tone="success">{tn('เพิ่มใหม่ {0}', res.summary.create)}</Badge>
              <Badge tone="neutral">{tn('อัปเดต {0}', res.summary.update)}</Badge>
              {res.summary.invalid > 0 && <Badge tone="danger">{tn('ผิดพลาด {0}', res.summary.invalid)}</Badge>}
            </div>
            {invalid.length > 0 ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-danger">
                  <AlertCircle className="h-4 w-4" />{' '}{t('แก้ไขแถวต่อไปนี้ในไฟล์ แล้วเลือกไฟล์ใหม่อีกครั้ง')}</div>
                <div className="max-h-[320px] overflow-auto rounded-xl border border-line">
                  {invalid.slice(0, 200).map((r) => (
                    <div key={r.row} className="flex gap-3 border-b border-line-soft px-3 py-2 text-[14px]">
                      <span className="num w-14 flex-none font-mono text-muted">{tn('แถว {0}', r.row)}</span>
                      <span className="w-40 flex-none truncate font-medium">{r.data.name || t('(ไม่มีชื่อ)')}</span>
                      <span className="text-danger">{r.errors.join(' · ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl bg-soft px-4 py-3 text-[14px] text-soft-fg">
                <CheckCircle2 className="h-4 w-4" />{' '}{t('ข้อมูลถูกต้องทั้งหมด พร้อมนำเข้า')}</div>
            )}
            <div className="max-h-[260px] overflow-auto rounded-xl border border-line text-[13px]">
              <table className="w-full">
                <thead className="sticky top-0 bg-sunken text-left text-muted">
                  <tr>
                    <th className="px-3 py-2">{t('แถว')}</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">{t('ชื่อ')}</th>
                    <th className="px-3 py-2">{t('หมวด')}</th>
                    <th className="px-3 py-2 text-right">{t('ราคา')}</th>
                    <th className="px-3 py-2">{t('การทำงาน')}</th>
                  </tr>
                </thead>
                <tbody>
                  {res.rows.slice(0, 100).map((r) => (
                    <tr key={r.row} className={r.errors.length ? 'bg-danger-soft' : ''}>
                      <td className="px-3 py-1.5 text-muted">{r.row}</td>
                      <td className="px-3 py-1.5 font-mono">{r.data.sku}</td>
                      <td className="px-3 py-1.5">{r.data.name}</td>
                      <td className="px-3 py-1.5">{r.data.category}</td>
                      <td className="num px-3 py-1.5 text-right">{r.data.price}</td>
                      <td className="px-3 py-1.5">{r.action === 'create' ? t('เพิ่มใหม่') : t('อัปเดต')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
