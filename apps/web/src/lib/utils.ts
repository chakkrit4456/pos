import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { t } from '@flexpos/shared';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

export function todayStr(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return todayStr(d);
}

/** Read an image file, downscale to max size and return a JPEG/PNG data URL. */
export async function imageToDataUrl(file: File, max = 320): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(t('อ่านรูปภาพไม่ได้')));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function qtyText(q: number): string {
  return Number.isInteger(q) ? q.toLocaleString('th-TH') : q.toFixed(3).replace(/\.?0+$/, '');
}

export const isTouch = () => typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches;

let audio: AudioContext | null = null;
/** Short scanner beep: high for a hit, low for an unknown code. */
export function beep(ok = true) {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = ok ? 1800 : 320;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (ok ? 0.07 : 0.25));
  } catch {
    // no audio device: stay silent
  }
}
