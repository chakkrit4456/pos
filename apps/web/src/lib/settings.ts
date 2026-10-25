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

const rgb = (hex: string) => hexToRgb(hex).join(' ');
const mix = (hex: string, toward: number, amount: number) => hexToRgb(hex).map((c) => Math.round(c + (toward - c) * amount)).join(' ');

export interface BrandLook {
  primary: string;
  accent: string;
  sidebar: string;
  appName: string;
  appLogo: string;
}

/** Colors, title and favicon from the brand settings. Also used on the login screen (public brand). */
export function applyBrand(b: BrandLook) {
  const root = document.documentElement;
  const [r, g, bl] = hexToRgb(b.primary);
  root.style.setProperty('--primary', rgb(b.primary));
  root.style.setProperty('--primary-hover', `${Math.round(r * 0.78)} ${Math.round(g * 0.78)} ${Math.round(bl * 0.78)}`);
  root.style.setProperty('--primary-fg', (0.299 * r + 0.587 * g + 0.114 * bl) / 255 > 0.62 ? '23 25 28' : '255 255 255');
  root.style.setProperty('--accent', rgb(b.accent));
  root.style.setProperty('--rail', rgb(b.sidebar));
  const [sr, sg, sb] = hexToRgb(b.sidebar);
  const lightRail = (0.299 * sr + 0.587 * sg + 0.114 * sb) / 255 > 0.6;
  root.style.setProperty('--rail-2', lightRail ? mix(b.sidebar, 0, 0.08) : mix(b.sidebar, 255, 0.14));
  // Readable text on any sidebar color
  root.style.setProperty('--rail-fg', lightRail ? '23 25 28' : '255 255 255');
  root.style.setProperty('--rail-muted', lightRail ? '95 99 104' : '180 183 188');
  root.style.setProperty('--rail-faint', lightRail ? '138 141 145' : '107 110 114');
  root.style.setProperty('--rail-hover', lightRail ? '0 0 0' : '255 255 255');
  document.title = b.appName || 'FlexPOS';
  let icon = document.querySelector<HTMLLinkElement>('link[rel=icon]');
  if (!icon) {
    icon = document.createElement('link');
    icon.rel = 'icon';
    document.head.appendChild(icon);
  }
  icon.href = b.appLogo || '/icon.svg';
}

/** Apply the store's brand look and theme. */
export function useTheme(settings: Settings) {
  const logo = settings.brand.appLogo || settings.store.logo;
  useEffect(() => {
    applyBrand({ ...settings.brand, appLogo: logo });
  }, [settings.brand, logo]);
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = settings.brand.theme === 'dark' || (settings.brand.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      root.classList.toggle('dark', dark);
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    document.documentElement.lang = settings.locale.language;
    return () => mq.removeEventListener('change', apply);
  }, [settings.brand.theme, settings.locale.language]);
}

/** App name + logo for headers (logo falls back to the store logo). */
export function useBrand() {
  const s = useSettings();
  return { appName: s.brand.appName || 'FlexPOS', logo: s.brand.appLogo || s.store.logo, poweredBy: s.brand.poweredBy };
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
