import QRCode from 'qrcode';
import type { DocBlock, PrintDoc } from '@flexpos/shared';
import { api } from './api';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

async function blockHtml(b: DocBlock): Promise<string> {
  switch (b.t) {
    case 'text': {
      const size = b.size === 3 ? 26 : b.size === 2 ? 16 : 12;
      return `<div style="text-align:${b.align ?? 'left'};font-size:${size}px;font-weight:${b.bold ? 700 : 400};white-space:pre-wrap;word-break:break-word">${esc(b.text)}</div>`;
    }
    case 'row':
      return `<div style="display:flex;justify-content:space-between;gap:8px;font-size:${b.size === 2 ? 15 : 12}px;font-weight:${b.bold ? 700 : 400}"><span style="word-break:break-word">${esc(b.left)}</span><span style="white-space:nowrap">${esc(b.right)}</span></div>`;
    case 'line':
      return `<div style="border-top:1px ${b.dashed ? 'dashed' : 'solid'} #555;margin:5px 0"></div>`;
    case 'feed':
      return `<div style="height:${b.lines * 10}px"></div>`;
    case 'image':
      return `<div style="text-align:center"><img src="${b.src}" style="max-width:${b.width ?? 160}px;max-height:120px" alt=""></div>`;
    case 'qr': {
      const url = await QRCode.toDataURL(b.data, { margin: 1, width: b.size ?? 180 });
      return `<div style="text-align:center"><img src="${url}" style="width:${Math.min(b.size ?? 180, 180)}px" alt="QR">${b.caption ? `<div style="font-size:11px">${esc(b.caption)}</div>` : ''}</div>`;
    }
  }
}

export async function docToHtml(doc: PrintDoc): Promise<string> {
  const parts = await Promise.all(doc.blocks.map(blockHtml));
  const width = doc.paper === '58' ? '48mm' : doc.paper === '80' ? '72mm' : '190mm';
  return `<div style="width:${width};font-family:'IBM Plex Sans Thai',sans-serif;color:#000;line-height:1.35">${parts.join('')}</div>`;
}

declare global {
  interface Window {
    flexpos?: { print(html: string, opts: { silent: boolean; deviceName?: string; pageWidthMm: number }): Promise<void> };
  }
}

/** Print via the browser (or Electron silent print). Used for system/USB printers and PDF. */
export async function printInBrowser(doc: PrintDoc, deviceName?: string) {
  const html = await docToHtml(doc);
  const page = doc.paper === '58' ? 58 : doc.paper === '80' ? 80 : 210;
  if (window.flexpos?.print) {
    await window.flexpos.print(html, { silent: !!deviceName, deviceName, pageWidthMm: page });
    return;
  }
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const d = frame.contentDocument!;
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${page === 210 ? 'A4' : `${page}mm auto`};margin:${page === 210 ? '12mm' : '2mm'}}body{margin:0}</style>${[...document.querySelectorAll('style,link[rel=stylesheet]')].map((n) => n.outerHTML).join('')}</head><body>${html}</body></html>`);
  d.close();
  await new Promise((r) => setTimeout(r, 350));
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 2000);
}

export interface PrinterInfo {
  id: string;
  kind: 'network' | 'system';
  role: string;
  name: string;
  address: string;
  active: boolean;
}

/** Print a sale receipt: network ESC/POS printer when configured, otherwise the browser/system printer. */
export async function printSaleReceipt(saleId: string, printers: PrinterInfo[], opts: { reprint?: boolean } = {}) {
  const receipt = printers.find((p) => p.active && p.role === 'receipt');
  if (receipt?.kind === 'network') {
    await api.post(`/api/sales/${saleId}/print`, { printerId: receipt.id, reprint: !!opts.reprint });
    return 'network';
  }
  const doc = await api.get<PrintDoc>(`/api/sales/${saleId}/receipt`, { reprint: opts.reprint ? 1 : undefined });
  await printInBrowser(doc, receipt?.kind === 'system' ? receipt.address || undefined : undefined);
  return 'browser';
}
