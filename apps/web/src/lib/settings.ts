import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, formatDateTime, formatMoney, type Settings } from '@flexpos/shared';
import { api } from './api';
import { useSession } from './session';

export function useSettings(): Settings {
  const { user } = useSession();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings'), enabled: !!user, staleTime: 60_000 });
  return q.data ?? DEFAULT_SETTINGS;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Apply the store's brand color and theme to CSS variables. */
export function useTheme(settings: Settings) {
  useEffect(() => {
    const root = document.documentElement;
    const [r, g, b] = hexToRgb(settings.brand.primary);
    root.style.setProperty('--primary', `${r} ${g} ${b}`);
    root.style.setProperty('--primary-hover', `${Math.round(r * 0.78)} ${Math.round(g * 0.78)} ${Math.round(b * 0.78)}`);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    root.style.setProperty('--primary-fg', lum > 0.62 ? '23 25 28' : '255 255 255');
    const apply = () => {
      const dark = settings.brand.theme === 'dark' || (settings.brand.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      root.classList.toggle('dark', dark);
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    document.documentElement.lang = settings.locale.language;
    return () => mq.removeEventListener('change', apply);
  }, [settings.brand.primary, settings.brand.theme, settings.locale.language]);
}

export const money = (satang: number) => formatMoney(satang);
export const moneyShort = (satang: number) => formatMoney(satang, { decimals: satang % 100 !== 0 });

export function useFormatters() {
  const s = useSettings();
  return {
    money: (v: number) => formatMoney(v, { symbol: s.locale.currencySymbol }),
    date: (d: string | Date) => formatDateTime(d, s.locale.era, { time: false }),
    dateTime: (d: string | Date) => formatDateTime(d, s.locale.era),
    era: s.locale.era,
  };
}
