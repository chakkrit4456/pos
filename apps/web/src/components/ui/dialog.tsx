import * as RD from '@radix-ui/react-dialog';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, Field, Input } from './core';
import { t } from '@flexpos/shared';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
  hideClose,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  className?: string;
  hideClose?: boolean;
}) {
  const w = { sm: 'max-w-[420px]', md: 'max-w-[560px]', lg: 'max-w-[760px]', xl: 'max-w-[1000px]', full: 'max-w-[min(1200px,96vw)]' }[size];
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 animate-fade-in bg-[rgb(23_25_28/0.42)]" />
        <RD.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 animate-pop-in flex-col rounded-[20px] bg-surface shadow-pop focus:outline-none',
            w,
            className,
          )}
          onOpenAutoFocus={(e) => {
            // Let the first input get focus but avoid popping the keyboard on touch devices for buttons.
            const t = e.target as HTMLElement | null;
            if (t && !t.querySelector('input,textarea,select')) e.preventDefault();
          }}
        >
          <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-5">
            <div className="min-w-0">
              <RD.Title className="text-[19px] font-semibold leading-snug">{title}</RD.Title>
              {description ? <RD.Description className="mt-1 text-[14px] text-muted">{description}</RD.Description> : <RD.Description className="sr-only">{typeof title === 'string' ? title : 'dialog'}</RD.Description>}
            </div>
            {!hideClose && (
              <RD.Close asChild>
                <button className="-mr-2 grid h-10 w-10 flex-none place-items-center rounded-xl text-muted hover:bg-sunken" aria-label={t('ปิด')}>
                  <X className="h-5 w-5" />
                </button>
              </RD.Close>
            )}
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-3">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-soft px-6 py-4">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmText?: string;
  danger?: boolean;
  /** require a typed reason */
  reason?: { label: string; placeholder?: string };
}
type ConfirmResult = { ok: false } | { ok: true; reason: string };

const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<ConfirmResult>>(async () => ({ ok: false }));

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [reason, setReason] = useState('');
  const resolver = useRef<((r: ConfirmResult) => void) | null>(null);
  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    setReason('');
    return new Promise<ConfirmResult>((res) => (resolver.current = res));
  }, []);
  const close = (r: ConfirmResult) => {
    resolver.current?.(r);
    resolver.current = null;
    setOpts(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog
        open={!!opts}
        onOpenChange={(v) => !v && close({ ok: false })}
        title={opts?.title ?? ''}
        size="sm"
        footer={
          <>
            <Button onClick={() => close({ ok: false })}>{t('ยกเลิก')}</Button>
            <Button variant={opts?.danger ? 'danger' : 'primary'} disabled={!!opts?.reason && !reason.trim()} onClick={() => close({ ok: true, reason: reason.trim() })}>
              {opts?.confirmText ?? t('ยืนยัน')}
            </Button>
          </>
        }
      >
        {opts?.body && <div className="text-[15px] text-ink-2">{opts.body}</div>}
        {opts?.reason && (
          <Field label={opts.reason.label} className="mt-3">
            <Input autoFocus value={reason} placeholder={opts.reason.placeholder} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && reason.trim() && close({ ok: true, reason: reason.trim() })} />
          </Field>
        )}
      </Dialog>
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmCtx);
