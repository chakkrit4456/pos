import { formatAmount } from './money.js';
import { formatDateTime } from './format.js';
import type { ReceiptSection, Settings } from './settings.js';

/** A printer-agnostic document: rendered to HTML in the browser and to a bitmap for ESC/POS. */
export type DocBlock =
  | { t: 'text'; text: string; align?: 'left' | 'center' | 'right'; size?: 1 | 2 | 3; bold?: boolean }
  | { t: 'row'; left: string; right: string; bold?: boolean; size?: 1 | 2 }
  | { t: 'line'; dashed?: boolean }
  | { t: 'image'; src: string; width?: number }
  | { t: 'qr'; data: string; size?: number; caption?: string }
  | { t: 'feed'; lines: number };

export interface PrintDoc {
  paper: '58' | '80' | 'A4';
  blocks: DocBlock[];
  openDrawer?: boolean;
  cut?: boolean;
}

export interface SaleLineView {
  id: string;
  name: string;
  qty: number;
  unitPrice: number;
  gross: number;
  lineDiscount: number;
  promoDiscount: number;
  net: number;
  modifiers: { name: string; priceDelta: number }[];
  note: string;
  custom?: Record<string, string>;
}

export interface SaleView {
  id: string;
  docNo: string;
  taxInvoiceNo: string | null;
  type: 'sale' | 'refund';
  status: string;
  createdAt: string;
  userName: string;
  branchName: string;
  tableName: string | null;
  customer: { name: string; phone: string; points: number } | null;
  lines: SaleLineView[];
  subtotal: number;
  discountTotal: number;
  billDiscount: number;
  promoDiscount: number;
  serviceCharge: number;
  vatableBase: number;
  vat: number;
  exemptAmount: number;
  rounding: number;
  total: number;
  paid: number;
  change: number;
  payments: { name: string; amount: number; kind: string }[];
  pointsEarned: number;
  pointsRedeemed: number;
  promotions: { name: string; amount: number }[];
  taxInvoice: { name: string; taxId: string; branch: string; address: string } | null;
  pricesIncludeVat: boolean;
  vatRate: number;
  vatEnabled: boolean;
  serviceChargeRate: number;
  voidReason: string | null;
  refOfDocNo?: string | null;
}

function qtyText(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, '');
}

export function buildReceiptDoc(
  sale: SaleView,
  settings: Settings,
  opts: { reprint?: boolean; promptPayPayload?: string | null; paper?: '58' | '80' | 'A4' } = {},
): PrintDoc {
  const r = settings.receipt;
  const s = settings.store;
  const era = settings.locale.era;
  const blocks: DocBlock[] = [];
  const isFull = !!sale.taxInvoice;
  const sections: ReceiptSection[] = r.sections;

  for (const sec of sections) {
    switch (sec) {
      case 'logo':
        if (s.logo) blocks.push({ t: 'image', src: s.logo, width: 160 });
        break;
      case 'storeName':
        blocks.push({ t: 'text', text: s.name, align: 'center', size: 2, bold: true });
        if (sale.branchName) blocks.push({ t: 'text', text: sale.branchName, align: 'center' });
        break;
      case 'address':
        if (s.address) blocks.push({ t: 'text', text: s.address, align: 'center' });
        break;
      case 'taxId':
        if (s.taxId && settings.tax.vatEnabled)
          blocks.push({ t: 'text', text: `เลขประจำตัวผู้เสียภาษี ${s.taxId}`, align: 'center' });
        break;
      case 'phone':
        if (s.phone) blocks.push({ t: 'text', text: `โทร ${s.phone}`, align: 'center' });
        break;
      case 'header': {
        const title =
          sale.type === 'refund'
            ? 'ใบลดหนี้ / ใบคืนสินค้า'
            : isFull
              ? 'ใบเสร็จรับเงิน/ใบกำกับภาษี'
              : settings.tax.vatEnabled
                ? 'ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ'
                : 'ใบเสร็จรับเงิน';
        blocks.push({ t: 'text', text: title, align: 'center', bold: true });
        if (r.header) blocks.push({ t: 'text', text: r.header, align: 'center' });
        if (opts.reprint) blocks.push({ t: 'text', text: '** สำเนา **', align: 'center', bold: true });
        if (sale.status === 'voided') blocks.push({ t: 'text', text: '** ยกเลิกแล้ว **', align: 'center', bold: true });
        break;
      }
      case 'docInfo':
        blocks.push({ t: 'line', dashed: true });
        blocks.push({ t: 'row', left: `เลขที่ ${sale.taxInvoiceNo ?? sale.docNo}`, right: formatDateTime(sale.createdAt, era, { shortYear: true }) });
        if (sale.refOfDocNo) blocks.push({ t: 'text', text: `อ้างอิงบิล ${sale.refOfDocNo}` });
        blocks.push({
          t: 'row',
          left: `พนักงาน ${sale.userName}`,
          right: sale.tableName ? `โต๊ะ ${sale.tableName}` : '',
        });
        break;
      case 'customer':
        if (sale.taxInvoice) {
          blocks.push({ t: 'line', dashed: true });
          blocks.push({ t: 'text', text: `ลูกค้า: ${sale.taxInvoice.name}` });
          blocks.push({ t: 'text', text: `เลขผู้เสียภาษี ${sale.taxInvoice.taxId} (${sale.taxInvoice.branch})` });
          if (sale.taxInvoice.address) blocks.push({ t: 'text', text: sale.taxInvoice.address });
        } else if (sale.customer) {
          blocks.push({ t: 'text', text: `สมาชิก: ${sale.customer.name}${sale.customer.phone ? ' · ' + sale.customer.phone : ''}` });
        }
        break;
      case 'items':
        blocks.push({ t: 'line', dashed: true });
        for (const l of sale.lines) {
          blocks.push({ t: 'row', left: `${qtyText(l.qty)}× ${l.name}`, right: formatAmount(l.gross) });
          for (const m of l.modifiers) {
            blocks.push({ t: 'row', left: `   + ${m.name}`, right: m.priceDelta ? formatAmount(m.priceDelta * l.qty) : '' });
          }
          if (l.qty !== 1) blocks.push({ t: 'text', text: `   @ ${formatAmount(l.unitPrice)}` });
          if (l.note) blocks.push({ t: 'text', text: `   * ${l.note}` });
          if (l.custom) for (const [k, v] of Object.entries(l.custom)) if (v) blocks.push({ t: 'text', text: `   ${k}: ${v}` });
          if (l.lineDiscount > 0) blocks.push({ t: 'row', left: '   ส่วนลด', right: `-${formatAmount(l.lineDiscount)}` });
        }
        break;
      case 'totals':
        blocks.push({ t: 'line', dashed: true });
        blocks.push({ t: 'row', left: 'รวม', right: formatAmount(sale.subtotal) });
        for (const p of sale.promotions) blocks.push({ t: 'row', left: p.name, right: `-${formatAmount(p.amount)}` });
        if (sale.billDiscount > 0) blocks.push({ t: 'row', left: 'ส่วนลดท้ายบิล', right: `-${formatAmount(sale.billDiscount)}` });
        if (sale.pointsRedeemed > 0) blocks.push({ t: 'row', left: `ใช้แต้ม ${sale.pointsRedeemed}`, right: '' });
        if (sale.serviceCharge > 0)
          blocks.push({ t: 'row', left: `ค่าบริการ ${sale.serviceChargeRate}%`, right: formatAmount(sale.serviceCharge) });
        if (sale.vatEnabled) {
          if (sale.pricesIncludeVat) {
            blocks.push({ t: 'row', left: 'มูลค่าก่อนภาษี', right: formatAmount(sale.vatableBase) });
            blocks.push({ t: 'row', left: `VAT ${sale.vatRate}%`, right: formatAmount(sale.vat) });
          } else {
            blocks.push({ t: 'row', left: `VAT ${sale.vatRate}%`, right: formatAmount(sale.vat) });
          }
          if (sale.exemptAmount > 0) blocks.push({ t: 'row', left: 'สินค้ายกเว้นภาษี', right: formatAmount(sale.exemptAmount) });
        }
        if (sale.rounding !== 0) blocks.push({ t: 'row', left: 'ปัดเศษ', right: formatAmount(sale.rounding) });
        blocks.push({ t: 'row', left: sale.type === 'refund' ? 'ยอดคืน' : 'ยอดสุทธิ', right: formatAmount(sale.total), bold: true, size: 2 });
        break;
      case 'payments':
        for (const p of sale.payments) blocks.push({ t: 'row', left: p.name, right: formatAmount(p.amount) });
        if (sale.change > 0) blocks.push({ t: 'row', left: 'เงินทอน', right: formatAmount(sale.change), bold: true });
        break;
      case 'points':
        if (sale.customer && (sale.pointsEarned > 0 || sale.pointsRedeemed > 0)) {
          blocks.push({ t: 'line', dashed: true });
          if (sale.pointsEarned > 0) blocks.push({ t: 'row', left: 'แต้มที่ได้รับ', right: String(sale.pointsEarned) });
          blocks.push({ t: 'row', left: 'แต้มคงเหลือ', right: String(sale.customer.points) });
        }
        break;
      case 'promptpay':
        if (opts.promptPayPayload) blocks.push({ t: 'qr', data: opts.promptPayPayload, size: 200, caption: 'สแกนเพื่อชำระผ่าน PromptPay' });
        break;
      case 'footer':
        if (r.footer) {
          blocks.push({ t: 'feed', lines: 1 });
          blocks.push({ t: 'text', text: r.footer, align: 'center' });
        }
        break;
    }
  }
  return { paper: opts.paper ?? r.paper, blocks, cut: true };
}

export interface KitchenTicketItem {
  qty: number;
  name: string;
  modifiers: string[];
  note: string;
}

export function buildKitchenTicket(t: {
  title: string;
  ticketNo: string;
  createdAt: string;
  by: string;
  station: string;
  items: KitchenTicketItem[];
  era?: 'BE' | 'CE';
  paper?: '58' | '80';
  reprint?: boolean;
}): PrintDoc {
  const blocks: DocBlock[] = [
    { t: 'text', text: t.title, align: 'center', size: 3, bold: true },
    { t: 'text', text: `#${t.ticketNo} · ${formatDateTime(t.createdAt, t.era ?? 'BE', { shortYear: true })}`, align: 'center' },
    { t: 'text', text: `รับโดย ${t.by}${t.station ? ' · ' + t.station : ''}`, align: 'center' },
  ];
  if (t.reprint) blocks.push({ t: 'text', text: '** พิมพ์ซ้ำ **', align: 'center', bold: true });
  blocks.push({ t: 'line', dashed: true });
  for (const i of t.items) {
    blocks.push({ t: 'text', text: `${qtyText(i.qty)} × ${i.name}`, size: 2, bold: true });
    if (i.modifiers.length) blocks.push({ t: 'text', text: `    ${i.modifiers.join(' · ')}` });
    if (i.note) blocks.push({ t: 'text', text: `    * ${i.note}` });
  }
  blocks.push({ t: 'line', dashed: true });
  blocks.push({ t: 'text', text: `รวม ${t.items.reduce((a, i) => a + i.qty, 0)} รายการ`, align: 'center' });
  return { paper: t.paper ?? '80', blocks, cut: true };
}
