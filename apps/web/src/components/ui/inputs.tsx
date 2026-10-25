import { forwardRef, useEffect, useState, type InputHTMLAttributes } from 'react';
import { Delete } from 'lucide-react';
import { bahtToSatang } from '@flexpos/shared';
import { cn } from '@/lib/utils';
import { Input } from './core';

const toText = (satang: number | null | undefined) => (satang == null ? '' : (satang / 100).toFixed(2).replace(/\.00$/, ''));

/** Money input that edits baht text and reports integer satang. */
export const MoneyInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number | null; onValue: (satang: number) => void; allowNegative?: boolean }>(
  function MoneyInput({ value, onValue, allowNegative, className, onBlur, ...rest }, ref) {
    const [text, setText] = useState(toText(value));
    const [focused, setFocused] = useState(false);
    useEffect(() => {
      if (!focused) setText(toText(value));
    }, [value, focused]);
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-faint">฿</span>
        <Input
          ref={ref}
          inputMode="decimal"
          className={cn('num pl-7 text-right', className)}
          value={text}
          onFocus={(e) => {
            setFocused(true);
            e.target.select();
          }}
          onBlur={(e) => {
            setFocused(false);
            setText(toText(value));
            onBlur?.(e);
          }}
          onChange={(e) => {
            const v = e.target.value.replace(/[^\d.,-]/g, '');
            setText(v);
            try {
              const s = bahtToSatang(v);
              if (allowNegative || s >= 0) onValue(s);
            } catch {
              /* keep typing */
            }
          }}
          {...rest}
        />
      </div>
    );
  },
);

export const NumberInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number; onValue: (n: number) => void; decimals?: number }>(
  function NumberInput({ value, onValue, decimals = 0, className, ...rest }, ref) {
    const [text, setText] = useState(String(value));
    const [focused, setFocused] = useState(false);
    useEffect(() => {
      if (!focused) setText(String(value));
    }, [value, focused]);
    return (
      <Input
        ref={ref}
        inputMode={decimals ? 'decimal' : 'numeric'}
        className={cn('num', className)}
        value={text}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const v = e.target.value.replace(decimals ? /[^\d.-]/g : /[^\d-]/g, '');
          setText(v);
          const n = Number(v);
          if (v !== '' && Number.isFinite(n)) onValue(decimals ? Math.round(n * 10 ** decimals) / 10 ** decimals : Math.trunc(n));
          else if (v === '') onValue(0);
        }}
        {...rest}
      />
    );
  },
);

/** On-screen keypad for touch: digits, dot, backspace. */
export function NumPad({ onKey, dot = true, className, dark }: { onKey: (k: string) => void; dot?: boolean; className?: string; dark?: boolean }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', dot ? '.' : '', '0', 'back'];
  return (
    <div className={cn('grid grid-cols-3 gap-2', className)}>
      {keys.map((k, i) =>
        k === '' ? (
          <span key={`blank-${i}`} />
        ) : (
        <button
          key={k}
          type="button"
          onClick={() => onKey(k)}
          aria-label={k === 'back' ? 'ลบ' : k}
          className={cn(
            'grid h-14 place-items-center rounded-2xl text-[22px] font-medium transition-colors active:scale-[.97]',
            dark ? 'bg-[#24272b] text-white active:bg-[#3a3d42]' : 'border border-line bg-surface hover:bg-sunken',
          )}
        >
          {k === 'back' ? <Delete className="h-6 w-6" /> : k}
        </button>
        ),
      )}
    </div>
  );
}

export function applyKey(current: string, k: string, maxLen = 12): string {
  if (k === 'back') return current.slice(0, -1);
  if (k === '.' && current.includes('.')) return current;
  if (current.includes('.') && current.split('.')[1]!.length >= 2) return current;
  if (current.length >= maxLen) return current;
  if (current === '0' && k !== '.') return k;
  return current + k;
}

/** PIN entry with dots; calls onComplete at the requested length. */
export function PinPad({ length = 4, onComplete, error, dark, busy }: { length?: number; onComplete: (pin: string) => void; error?: string; dark?: boolean; busy?: boolean }) {
  const [pin, setPin] = useState('');
  useEffect(() => {
    if (error) setPin('');
  }, [error]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 6 ? p + e.key : p));
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter' && pin.length >= 4) onComplete(pin);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pin, busy, onComplete]);
  useEffect(() => {
    if (pin.length === length) {
      onComplete(pin);
      setPin('');
    }
  }, [pin, length, onComplete]);
  return (
    <div className="flex w-full flex-col items-center gap-5">
      <div className="flex gap-3.5" aria-label={`ใส่แล้ว ${pin.length} หลัก`}>
        {Array.from({ length }, (_, i) => (
          <span key={i} className={cn('h-4 w-4 rounded-full border-2', dark ? 'border-[#7cc4a4]' : 'border-primary', i < pin.length && (dark ? 'bg-[#7cc4a4]' : 'bg-primary'))} />
        ))}
      </div>
      <span className={cn('h-5 text-[13px]', error ? 'text-danger' : dark ? 'text-[#a5a8ad]' : 'text-muted')}>{error ?? ''}</span>
      <NumPad dark={dark} dot={false} className="w-full max-w-[320px]" onKey={(k) => !busy && setPin((p) => (k === 'back' ? p.slice(0, -1) : p.length < 6 ? p + k : p))} />
    </div>
  );
}
