import { z } from 'zod';
import { t } from './i18n.js';

export const BUSINESS_TYPES = ['retail', 'restaurant', 'cafe', 'fashion', 'service', 'other'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  retail: t('ร้านค้าปลีก / มินิมาร์ท'),
  restaurant: t('ร้านอาหาร'),
  cafe: t('คาเฟ่ / ร้านเครื่องดื่ม'),
  fashion: t('ร้านเสื้อผ้า / แฟชั่น'),
  service: t('ร้านบริการ'),
  other: t('อื่นๆ'),
};

export const RECEIPT_SECTIONS = [
  'logo',
  'storeName',
  'address',
  'taxId',
  'phone',
  'header',
  'docInfo',
  'customer',
  'items',
  'totals',
  'payments',
  'points',
  'promptpay',
  'footer',
] as const;
export type ReceiptSection = (typeof RECEIPT_SECTIONS)[number];

export const RECEIPT_SECTION_LABELS: Record<ReceiptSection, string> = {
  logo: t('โลโก้'),
  storeName: t('ชื่อร้าน'),
  address: t('ที่อยู่'),
  taxId: t('เลขผู้เสียภาษี'),
  phone: t('เบอร์โทร'),
  header: t('ข้อความหัวใบเสร็จ'),
  docInfo: t('เลขที่/วันที่/พนักงาน'),
  customer: t('ข้อมูลสมาชิก'),
  items: t('รายการสินค้า'),
  totals: t('สรุปยอด'),
  payments: t('การชำระเงิน'),
  points: t('แต้มสะสม'),
  promptpay: t('QR PromptPay (สำหรับบิลค้างชำระ)'),
  footer: t('ข้อความท้ายใบเสร็จ'),
};

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** A company account customers can pay into. Kept in settings until the admin changes it. */
export const bankAccountSchema = z.object({
  id: z.string().min(1).max(40),
  /** code from BANKS (shared/banks.ts) or 'OTHER' for foreign/other banks */
  bankCode: z.string().min(1).max(20),
  bankName: z.string().max(100).default(''),
  accountName: z.string().trim().min(1).max(120),
  accountNumber: z.string().trim().max(40).default(''),
  branch: z.string().max(80).default(''),
  /** phone (10), tax/citizen ID (13) or e-wallet ID (15). Empty = no PromptPay for this account */
  promptPayId: z.string().max(20).default(''),
  swift: z.string().trim().max(11).default(''),
  iban: z.string().trim().max(34).default(''),
  currency: z.string().max(3).default('THB'),
  showOnBill: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});
export type BankAccount = z.infer<typeof bankAccountSchema>;

export const settingsSchema = z.object({
  businessType: z.enum(BUSINESS_TYPES).default('retail'),
  store: z
    .object({
      name: z.string().default(t('ร้านของฉัน')),
      address: z.string().default(''),
      taxId: z.string().default(''),
      phone: z.string().default(''),
      logo: z.string().default(''),
      promptPayId: z.string().default(''),
    })
    .default({}),
  tax: z
    .object({
      vatEnabled: z.boolean().default(false),
      vatRate: z.number().min(0).max(30).default(7),
      pricesIncludeVat: z.boolean().default(true),
      serviceChargeRate: z.number().min(0).max(30).default(0),
      roundingStep: z.number().int().min(0).max(100).default(0),
    })
    .default({}),
  locale: z
    .object({
      language: z.enum(['th', 'en']).default('th'),
      era: z.enum(['BE', 'CE']).default('BE'),
      currencySymbol: z.string().default(t('฿')),
    })
    .default({}),
  brand: z
    .object({
      appName: z.string().trim().max(40).default('FlexPOS'),
      /** data URL; empty = use the store logo */
      appLogo: z.string().max(400_000).default(''),
      primary: hex.default('#1d7a57'),
      accent: hex.default('#2f9e74'),
      sidebar: hex.default('#17191c'),
      theme: z.enum(['light', 'dark', 'system']).default('light'),
      loginTitle: z.string().max(80).default(''),
      loginSubtitle: z.string().max(160).default(''),
      poweredBy: z.boolean().default(true),
    })
    .default({}),
  payments: z
    .object({
      accounts: z.array(bankAccountSchema).max(20).default([]),
      /** print exact-amount PromptPay QR on table bill slips */
      billShowQr: z.boolean().default(true),
    })
    .default({}),
  modules: z
    .object({
      restaurant: z.boolean().default(false),
      stock: z.boolean().default(true),
      members: z.boolean().default(true),
      promotions: z.boolean().default(true),
      multiBranch: z.boolean().default(false),
      customerDisplay: z.boolean().default(false),
      kitchenDisplay: z.boolean().default(false),
      lotTracking: z.boolean().default(false),
    })
    .default({}),
  pos: z
    .object({
      allowNegativeStock: z.boolean().default(true),
      autoLockMinutes: z.number().int().min(0).max(240).default(0),
      requireShift: z.boolean().default(true),
      quickNotes: z.array(z.number().int().positive()).default([2000, 5000, 10000, 50000, 100000]),
      hotkeys: z.record(z.string(), z.string()).default({}),
      gridColumns: z.number().int().min(0).max(8).default(0),
      showImages: z.boolean().default(true),
    })
    .default({}),
  points: z
    .object({
      enabled: z.boolean().default(false),
      earnPerSatang: z.number().int().min(1).default(2500),
      pointValue: z.number().int().min(0).default(100),
    })
    .default({}),
  receipt: z
    .object({
      paper: z.enum(['58', '80', 'A4']).default('80'),
      sections: z.array(z.enum(RECEIPT_SECTIONS)).default([...RECEIPT_SECTIONS].filter((s) => s !== 'promptpay')),
      header: z.string().default(''),
      footer: z.string().default(t('ขอบคุณที่ใช้บริการ')),
      showProductFields: z.array(z.string()).default([]),
      receiptPattern: z.string().default('{prefix}{yy}{mm}-{seq:5}'),
      receiptPrefix: z.string().default('R'),
      taxInvoicePattern: z.string().default('{prefix}{branch}-{be}-{seq:6}'),
      taxInvoicePrefix: z.string().default('INV'),
      autoPrint: z.boolean().default(true),
      openDrawerOnCash: z.boolean().default(true),
      copies: z.number().int().min(1).max(3).default(1),
    })
    .default({}),
  kitchen: z
    .object({
      autoPrint: z.boolean().default(true),
      reprintOnReconnect: z.boolean().default(true),
      showModifiers: z.boolean().default(true),
    })
    .default({}),
  backup: z
    .object({
      auto: z.boolean().default(true),
      intervalHours: z.number().int().min(1).max(168).default(24),
      dir: z.string().default(''),
      keep: z.number().int().min(1).max(365).default(14),
      at: hhmm.default('23:30'),
    })
    .default({}),
});

export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };
export type SettingsPatch = DeepPartial<Settings>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function mergeSettings(base: Settings, patch: SettingsPatch | Record<string, unknown>): Settings {
  const merge = (a: unknown, b: unknown): unknown => {
    if (!isPlainObject(a) || !isPlainObject(b)) return b === undefined ? a : b;
    const out: Record<string, unknown> = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = merge(a[k], v);
    return out;
  };
  return settingsSchema.parse(merge(base, patch));
}

export function templateSettings(type: BusinessType): SettingsPatch {
  switch (type) {
    case 'restaurant':
      return {
        businessType: type,
        modules: { restaurant: true, kitchenDisplay: true, stock: false, members: true },
        tax: { serviceChargeRate: 10 },
        pos: { requireShift: true },
      };
    case 'cafe':
      return {
        businessType: type,
        modules: { restaurant: true, kitchenDisplay: false, stock: true, members: true },
        points: { enabled: true },
      };
    case 'fashion':
      return { businessType: type, modules: { stock: true, members: true, restaurant: false }, points: { enabled: true } };
    case 'service':
      return { businessType: type, modules: { stock: false, members: true, restaurant: false } };
    case 'retail':
      return {
        businessType: type,
        modules: { stock: true, members: true, restaurant: false },
        pos: { allowNegativeStock: false },
      };
    default:
      return { businessType: type };
  }
}

export const DEFAULT_PAYMENT_METHODS = [
  { code: 'cash', name: t('เงินสด'), kind: 'cash', sort: 0 },
  { code: 'promptpay', name: 'PromptPay QR', kind: 'promptpay', sort: 1 },
  { code: 'transfer', name: t('โอนเงิน'), kind: 'other', sort: 2 },
  { code: 'card', name: t('บัตรเครดิต/เดบิต'), kind: 'other', sort: 3 },
  { code: 'credit', name: t('ค้างชำระ (ลูกหนี้)'), kind: 'credit', sort: 4 },
] as const;

export type PaymentKind = 'cash' | 'promptpay' | 'credit' | 'points' | 'other';
