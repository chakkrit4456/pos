import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Socket } from 'node:net';
import { createCanvas, GlobalFonts, loadImage, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import QRCode from 'qrcode';
import type { DocBlock, PrintDoc } from '@flexpos/shared';

const FONT_THAI = 'FlexPOS Thai';
const FONT_LATIN = 'FlexPOS Latin';
/** Thai glyphs first, Latin subset (digits, A-Z) as fallback. */
const FONT = `"${FONT_THAI}", "${FONT_LATIN}"`;
let fontsReady = false;

/** Register IBM Plex Sans Thai (thai + latin subsets) for bitmap rendering. */
export function ensureFonts(extraDir?: string): void {
  if (fontsReady) return;
  const dirs: string[] = [];
  if (extraDir) dirs.push(extraDir);
  if (process.env.FLEXPOS_FONTS_DIR) dirs.push(process.env.FLEXPOS_FONTS_DIR);
  try {
    const req = createRequire(import.meta.url);
    dirs.push(join(dirname(req.resolve('@fontsource/ibm-plex-sans-thai/package.json')), 'files'));
  } catch {
    /* bundled build passes extraDir */
  }
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      if (/(thai|latin)-(400|700)-normal\.woff2$/.test(f) && !f.includes('latin-ext')) {
        GlobalFonts.registerFromPath(join(d, f), f.includes('-thai-') && !f.includes('thai-latin') ? FONT_THAI : FONT_LATIN);
      }
    }
  }
  fontsReady = true;
}

export const DOTS: Record<string, number> = { '58': 384, '80': 576, A4: 576 };
const SIZES = { 1: 24, 2: 32, 3: 46 } as const;

function wrap(g: SKRSContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    // Thai has no spaces between words; break by characters when needed, keeping combining marks attached.
    const clusters = Array.from(para.matchAll(/[\s\S][ัิ-ฺ็-๎]*/g), (m) => m[0]);
    let line = '';
    for (const c of clusters) {
      const next = line + c;
      if (g.measureText(next).width > width && line) {
        const sp = line.lastIndexOf(' ');
        if (sp > 0 && sp > line.length - 12) {
          out.push(line.slice(0, sp));
          line = line.slice(sp + 1) + c;
        } else {
          out.push(line);
          line = c;
        }
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

function dither(g: SKRSContext2D, x: number, y: number, w: number, h: number) {
  const img = g.getImageData(x, y, w, h);
  const d = img.data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3]! / 255;
    lum[i] = 255 - a * (255 - (0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!));
  }
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const i = yy * w + xx;
      const old = lum[i]!;
      const nv = old < 128 ? 0 : 255;
      const err = old - nv;
      lum[i] = nv;
      if (xx + 1 < w) lum[i + 1]! += (err * 7) / 16;
      if (yy + 1 < h) {
        if (xx > 0) lum[i + w - 1]! += (err * 3) / 16;
        lum[i + w]! += (err * 5) / 16;
        if (xx + 1 < w) lum[i + w + 1]! += err / 16;
      }
    }
  for (let i = 0; i < w * h; i++) {
    const v = lum[i]! < 128 ? 0 : 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, x, y);
}

/** Render a PrintDoc to a 1-bit friendly canvas of the printer's width. */
export async function renderDoc(doc: PrintDoc, fontsDir?: string): Promise<Canvas> {
  ensureFonts(fontsDir);
  const width = DOTS[doc.paper] ?? 576;
  const canvas = createCanvas(width, 6000);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, width, 6000);
  g.fillStyle = '#000';
  g.textBaseline = 'top';
  const pad = 4;
  const inner = width - pad * 2;
  let y = 8;
  const font = (size: number, bold?: boolean) => (g.font = `${bold ? '700' : '400'} ${size}px ${FONT}`);

  const drawBlock = async (b: DocBlock) => {
    switch (b.t) {
      case 'text': {
        const size = SIZES[b.size ?? 1];
        font(size, b.bold);
        for (const line of wrap(g, b.text, inner)) {
          const w = g.measureText(line).width;
          const x = b.align === 'center' ? (width - w) / 2 : b.align === 'right' ? width - pad - w : pad;
          g.fillText(line, x, y);
          y += Math.round(size * 1.35);
        }
        break;
      }
      case 'row': {
        const size = SIZES[b.size ?? 1];
        font(size, b.bold);
        const rw = g.measureText(b.right).width;
        const lines = wrap(g, b.left, inner - rw - 12);
        lines.forEach((l, i) => {
          g.fillText(l, pad, y);
          if (i === 0 && b.right) g.fillText(b.right, width - pad - rw, y);
          y += Math.round(size * 1.35);
        });
        break;
      }
      case 'line': {
        const yy = y + 6;
        if (b.dashed) for (let x = pad; x < width - pad; x += 10) g.fillRect(x, yy, 6, 2);
        else g.fillRect(pad, yy, inner, 2);
        y += 16;
        break;
      }
      case 'feed':
        y += b.lines * 24;
        break;
      case 'image': {
        try {
          const img = await loadImage(b.src);
          const w = Math.min(b.width ?? 200, inner);
          const h = Math.round((img.height / img.width) * w);
          const x = Math.round((width - w) / 2);
          g.drawImage(img, x, y, w, h);
          dither(g, x, y, w, h);
          y += h + 8;
        } catch {
          /* ignore unreadable logo */
        }
        break;
      }
      case 'qr': {
        const size = Math.min(b.size ?? 220, inner);
        const url = await QRCode.toDataURL(b.data, { margin: 1, width: size, errorCorrectionLevel: 'M' });
        const img = await loadImage(url);
        g.drawImage(img, Math.round((width - size) / 2), y, size, size);
        y += size + 6;
        if (b.caption) {
          font(SIZES[1]);
          const w = g.measureText(b.caption).width;
          g.fillText(b.caption, (width - w) / 2, y);
          y += 32;
        }
        break;
      }
    }
  };
  for (const b of doc.blocks) {
    await drawBlock(b);
    if (y > 5800) break;
  }
  y += 24;
  const out = createCanvas(width, y);
  out.getContext('2d').drawImage(canvas, 0, 0);
  return out;
}

/** Encode a canvas as ESC/POS raster (GS v 0), chunked for printer buffer limits. */
export function rasterCommands(canvas: Canvas): Buffer {
  const g = canvas.getContext('2d');
  const { width, height } = canvas;
  const bytesPerRow = Math.ceil(width / 8);
  const px = g.getImageData(0, 0, width, height).data;
  const parts: Buffer[] = [];
  const CHUNK = 128;
  for (let top = 0; top < height; top += CHUNK) {
    const h = Math.min(CHUNK, height - top);
    const data = Buffer.alloc(bytesPerRow * h);
    for (let yy = 0; yy < h; yy++)
      for (let x = 0; x < width; x++) {
        const i = ((top + yy) * width + x) * 4;
        const l = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
        if (l < 150) data[yy * bytesPerRow + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    parts.push(Buffer.from([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, h & 0xff, h >> 8]), data);
  }
  return Buffer.concat(parts);
}

const ESC_INIT = Buffer.from([0x1b, 0x40]);
const CUT = Buffer.from([0x1b, 0x64, 0x03, 0x1d, 0x56, 0x42, 0x00]);
export const DRAWER_KICK = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);

/** TIS-620 (CP874) encoding for printers with a Thai code page. */
export function encodeTis620(s: string): Buffer {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c >= 0x0e01 && c <= 0x0e5b) out.push(c - 0x0e00 + 0xa0);
    else if (c === 0x0e3f) out.push(0xdf);
    else out.push(0x3f);
  }
  return Buffer.from(out);
}

function textCommands(doc: PrintDoc): Buffer {
  const cols = doc.paper === '58' ? 32 : 48;
  const parts: Buffer[] = [Buffer.from([0x1b, 0x74, 0x46])]; // ESC t 70 (CP874 on most Thai-market printers)
  const visibleLen = (s: string) => s.replace(/[ัิ-ฺ็-๎]/g, '').length;
  const line = (s: string, align: 'left' | 'center' | 'right' = 'left') => {
    parts.push(Buffer.from([0x1b, 0x61, align === 'center' ? 1 : align === 'right' ? 2 : 0]));
    parts.push(encodeTis620(s + '\n'));
  };
  for (const b of doc.blocks) {
    if (b.t === 'text') {
      parts.push(Buffer.from([0x1b, 0x45, b.bold ? 1 : 0, 0x1d, 0x21, (b.size ?? 1) > 1 ? 0x11 : 0]));
      line(b.text, b.align);
      parts.push(Buffer.from([0x1d, 0x21, 0, 0x1b, 0x45, 0]));
    } else if (b.t === 'row') {
      const space = Math.max(1, cols - visibleLen(b.left) - visibleLen(b.right));
      parts.push(Buffer.from([0x1b, 0x45, b.bold ? 1 : 0]));
      line(b.left + ' '.repeat(space) + b.right);
      parts.push(Buffer.from([0x1b, 0x45, 0]));
    } else if (b.t === 'line') line((b.dashed ? '-' : '=').repeat(cols));
    else if (b.t === 'feed') line('\n'.repeat(Math.max(0, b.lines - 1)));
    else if (b.t === 'qr') {
      const data = Buffer.from(b.data, 'ascii');
      const len = data.length + 3;
      parts.push(Buffer.from([0x1b, 0x61, 1]));
      parts.push(Buffer.from([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]));
      parts.push(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]));
      parts.push(Buffer.from([0x1d, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30]), data);
      parts.push(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30, 0x0a]));
      if (b.caption) line(b.caption, 'center');
    }
  }
  return Buffer.concat(parts);
}

export async function buildEscPos(doc: PrintDoc, mode: 'image' | 'thai', fontsDir?: string): Promise<Buffer> {
  const body = mode === 'thai' ? textCommands(doc) : rasterCommands(await renderDoc(doc, fontsDir));
  return Buffer.concat([ESC_INIT, body, doc.cut === false ? Buffer.alloc(0) : CUT, doc.openDrawer ? DRAWER_KICK : Buffer.alloc(0)]);
}

export function sendRaw(host: string, port: number, data: Buffer, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = new Socket();
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      s.destroy();
      if (err) reject(err);
      else resolve();
    };
    s.setTimeout(timeoutMs, () => finish(new Error('เครื่องพิมพ์ไม่ตอบสนอง (หมดเวลา)')));
    s.once('error', (e) => finish(new Error(`เชื่อมต่อเครื่องพิมพ์ไม่ได้: ${e.message}`)));
    s.connect(port, host, () => {
      s.write(data, (err) => {
        if (err) return finish(err);
        s.end(() => finish());
      });
    });
  });
}

export function probe(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new Socket();
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('error', () => done(false));
    s.connect(port, host, () => done(true));
  });
}
