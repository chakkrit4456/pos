import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Settings } from '@flexpos/shared';
import { api, errorMessage } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import { Button } from '@/components/ui/core';
import { t } from '@flexpos/shared';
import { switchLanguage } from '@/lib/i18n';

/** Local draft of a settings slice with a save bar. */
export function useDraft<K extends keyof Settings>(key: K) {
  const settings = useSettings();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Settings[K]>(settings[key]);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(settings[key]), [settings, key]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings[key]);
  const save = async (extra?: Partial<Settings>) => {
    setSaving(true);
    try {
      const next = await api.put<Settings>('/api/settings', { [key]: draft, ...extra });
      qc.setQueryData(['settings'], next);
      toast.success(t('บันทึกการตั้งค่าแล้ว'));
      switchLanguage(next.locale.language);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const set = <F extends keyof Settings[K]>(f: F, v: Settings[K][F]) => setDraft((d) => ({ ...(d as object), [f]: v }) as unknown as Settings[K]);
  return { draft, setDraft, set, dirty, save, saving, reset: () => setDraft(settings[key]) };
}

export function SaveBar({ dirty, saving, onSave, onReset }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void }) {
  if (!dirty) return null;
  return (
    <div className="sticky bottom-3 z-10 flex items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-surface shadow-pop">
      <span className="flex-1 text-[14px]">{t('มีการเปลี่ยนแปลงที่ยังไม่บันทึก')}</span>
      <Button size="sm" variant="ghost" className="text-surface hover:bg-rail-2" onClick={onReset}>{t('ยกเลิก')}</Button>
      <Button size="sm" variant="primary" loading={saving} onClick={onSave}>{t('บันทึก')}</Button>
    </div>
  );
}

export function SectionTitle({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-[22px] font-semibold">{title}</h2>
        {sub && <p className="mt-0.5 text-[14px] text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
