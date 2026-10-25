import { cloneElement, forwardRef, isValidElement, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Loader2, AlertTriangle, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@flexpos/shared';
import { tn } from '@/lib/i18n';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline-primary' | 'soft';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover border border-transparent',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-sunken',
  ghost: 'bg-transparent text-ink hover:bg-sunken border border-transparent',
  danger: 'bg-danger text-white hover:opacity-90 border border-transparent',
  'outline-primary': 'bg-surface text-primary border border-primary hover:bg-soft',
  soft: 'bg-soft text-soft-fg border border-transparent hover:brightness-95',
};
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm rounded-[10px] gap-1.5',
  md: 'h-11 px-4 text-[15px] rounded-xl gap-2',
  lg: 'h-12 px-5 text-[15px] rounded-xl gap-2',
  xl: 'h-16 px-6 text-[19px] rounded-[14px] gap-3',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background,transform,opacity] active:scale-[.98] disabled:pointer-events-none disabled:opacity-45',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(function IconButton({ label, className, size = 'md', ...rest }, ref) {
  const s = size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-12 w-12' : 'h-11 w-11';
  return <Button ref={ref} aria-label={label} title={label} size={size} className={cn(s, 'px-0', className)} {...rest} />;
});

const fieldBase =
  'w-full min-w-0 rounded-[10px] border border-line-strong bg-surface px-3 text-[15px] text-ink placeholder:text-faint transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:bg-sunken disabled:text-muted aria-[invalid=true]:border-danger';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(fieldBase, 'h-11', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, 'min-h-[88px] py-2.5', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(fieldBase, 'h-11 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235f6368' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, hint, error, children, className, required, htmlFor }: { label?: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string; required?: boolean; htmlFor?: string }) {
  const autoId = useId();
  // Link the label to a single form control child automatically (inputs, selects, MoneyInput…).
  let id = htmlFor;
  const isControl =
    isValidElement(children) && (typeof children.type !== 'string' || ['input', 'select', 'textarea'].includes(children.type));
  if (!id && isControl) {
    const el = children as React.ReactElement<{ id?: string; 'aria-invalid'?: boolean }>;
    id = el.props.id ?? autoId;
    children = cloneElement(el, { id, 'aria-invalid': error ? true : undefined });
  }
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-[13px] font-medium text-muted">
          {label}
          {required && <span className="text-danger"> *</span>}
        </label>
      )}
      {children}
      {error ? <span className="text-[13px] text-danger" role="alert">{error}</span> : hint ? <span className="text-[12px] text-faint">{hint}</span> : null}
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string; size?: 'sm' | 'md' }) {
  const w = size === 'sm' ? 'w-11 h-[26px]' : 'w-12 h-7';
  const k = size === 'sm' ? 'h-5 w-5' : 'h-[22px] w-[22px]';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('flex flex-none items-center rounded-full p-[3px] transition-colors disabled:opacity-50', w, checked ? 'justify-end bg-primary' : 'justify-start bg-line-strong')}
    >
      <span className={cn('rounded-full bg-white shadow-sm', k)} />
    </button>
  );
}

export function ToggleRow({ label, hint, checked, onChange, disabled }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-center gap-4 border-b border-line-soft py-3.5 last:border-0">
      <div className="flex flex-1 flex-col gap-0.5" id={id}>
        <span className="text-[15px] font-medium">{label}</span>
        {hint && <span className="text-[13px] text-muted">{hint}</span>}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={typeof label === 'string' ? label : undefined} />
    </div>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex min-h-[36px] cursor-pointer items-center gap-2.5 text-[14px]', disabled && 'opacity-50')}>
      <input type="checkbox" className="h-[18px] w-[18px] accent-[rgb(var(--primary))]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

type Tone = 'neutral' | 'success' | 'warn' | 'danger' | 'info' | 'dark';
const tones: Record<Tone, string> = {
  neutral: 'bg-canvas text-ink-2',
  success: 'bg-soft text-soft-fg',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  dark: 'bg-ink text-surface',
};
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12px] font-semibold', tones[tone], className)}>{children}</span>;
}

export function Card({ children, className, title, action, pad = true }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; pad?: boolean }) {
  return (
    <section className={cn('card flex min-w-0 flex-col', pad && 'gap-3.5 p-5', className)}>
      {(title || action) && (
        <div className={cn('flex items-center justify-between gap-3', !pad && 'px-5 pt-4')}>
          {title && <h2 className="text-[16px] font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-muted', className)} aria-label={t('กำลังโหลด')} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4', className)} />;
}

export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 p-4', className)} aria-busy="true" aria-label={t('กำลังโหลด')}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-6 py-12 text-center', className)}>
      {icon && <div className="mb-1 grid h-12 w-12 place-items-center rounded-2xl bg-canvas text-muted">{icon}</div>}
      <p className="text-[16px] font-semibold">{title}</p>
      {body && <p className="max-w-md text-[14px] text-muted [text-wrap:pretty]">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const msg = error instanceof Error ? error.message : t('โหลดข้อมูลไม่สำเร็จ');
  return (
    <div className={cn('flex flex-col items-center gap-2 px-6 py-12 text-center', className)} role="alert">
      <div className="mb-1 grid h-12 w-12 place-items-center rounded-2xl bg-danger-soft text-danger">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <p className="text-[16px] font-semibold">{t('โหลดข้อมูลไม่สำเร็จ')}</p>
      <p className="max-w-md text-[14px] text-muted">{msg}</p>
      {onRetry && (
        <Button className="mt-3" icon={<RotateCcw className="h-4 w-4" />} onClick={onRetry}>{t('ลองใหม่')}</Button>
      )}
    </div>
  );
}

export function PageHeader({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {sub && <div className="text-[14px] text-muted">{sub}</div>}
        <h1 className="mt-0.5 text-[26px] font-semibold leading-tight md:text-[28px]">{title}</h1>
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={cn('scroll-thin inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('h-9 whitespace-nowrap rounded-[9px] px-3.5 text-[14px] transition-colors', value === o.value ? 'bg-ink font-medium text-surface' : 'text-ink-2 hover:bg-sunken')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex h-11 flex-none items-center gap-2 whitespace-nowrap rounded-full border px-[18px] text-[15px] font-medium transition-colors',
        active ? 'border-ink bg-ink text-surface' : 'border-line-strong bg-surface text-ink hover:bg-sunken',
      )}
    >
      {children}
      {count !== undefined && <span className="text-[12px] opacity-70">{count}</span>}
    </button>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 text-[14px] text-muted">
      <span className="num">{tn('{0}–{1} จาก {2}', ((page - 1) * pageSize + 1).toLocaleString(), Math.min(page * pageSize, total).toLocaleString(), total.toLocaleString())}</span>
      <div className="flex gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('ก่อนหน้า')}</Button>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('ถัดไป')}</Button>
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap rounded-md border border-line-strong px-1.5 py-0.5 font-mono text-[12px] font-medium text-muted">{children}</span>;
}
