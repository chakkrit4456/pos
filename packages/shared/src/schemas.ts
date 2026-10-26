import { z } from 'zod';
import { ALL_PERMISSIONS, type Permission } from './permissions.js';
import { BUSINESS_TYPES } from './settings.js';
import { t } from './i18n.js';

const id = z.string().min(1).max(64);
const optId = id.nullable().optional();
const money = z.number().int();
const name = z.string().trim().min(1, t('กรุณากรอกชื่อ')).max(200);
const jsonRecord = z.record(z.string(), z.unknown());

export const discountSchema = z.object({
  kind: z.enum(['amount', 'percent']),
  value: z.number().min(0),
});

/* ---------- Setup & auth ---------- */

export const dbConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sqlite'), file: z.string().optional() }),
  z.object({
    kind: z.enum(['postgres', 'mysql']),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    user: z.string().min(1),
    password: z.string(),
    database: z.string().min(1),
    ssl: z.boolean().default(false),
  }),
]);
export type DbConfigInput = z.infer<typeof dbConfigSchema>;

export const setupCompleteSchema = z.object({
  language: z.enum(['th', 'en']),
  store: z.object({
    name,
    branchName: z.string().max(100).default(t('สำนักงานใหญ่')),
    address: z.string().max(500).default(''),
    taxId: z.string().max(20).default(''),
    phone: z.string().max(30).default(''),
    logo: z.string().max(400_000).default(''),
    promptPayId: z.string().max(20).default(''),
  }),
  businessType: z.enum(BUSINESS_TYPES),
  tax: z.object({
    vatEnabled: z.boolean(),
    vatRate: z.number().min(0).max(30),
    pricesIncludeVat: z.boolean(),
    serviceChargeRate: z.number().min(0).max(30),
  }),
  owner: z.object({
    name,
    username: z
      .string()
      .trim()
      .min(3, t('อย่างน้อย 3 ตัวอักษร'))
      .max(50)
      .regex(/^[a-zA-Z0-9._-]+$/, t('ใช้ได้เฉพาะ a-z 0-9 . _ -')),
    password: z.string().min(8, t('รหัสผ่านอย่างน้อย 8 ตัวอักษร')).max(200),
    pin: z.string().regex(/^\d{4,6}$/, t('PIN 4-6 หลัก')),
  }),
  sampleData: z.boolean().default(false),
});
export type SetupCompleteInput = z.infer<typeof setupCompleteSchema>;

export const loginSchema = z.object({ username: z.string().trim().min(1), password: z.string().min(1) });
export const pinLoginSchema = z.object({ pin: z.string().regex(/^\d{4,6}$/) });

/* ---------- Users & roles ---------- */

const permission = z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]]);

export const roleSchema = z.object({ name, permissions: z.array(permission) });

export const userSchema = z.object({
  name,
  username: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(8).max(200).optional().or(z.literal('')),
  pin: z
    .string()
    .regex(/^\d{4,6}$/)
    .optional()
    .or(z.literal('')),
  roleId: id,
  branchId: optId,
  active: z.boolean().default(true),
});

/* ---------- Catalog ---------- */

export const categorySchema = z.object({
  name,
  parentId: optId,
  color: z.string().max(20).default(''),
  sort: z.number().int().default(0),
  station: z.string().max(30).nullable().optional(),
  active: z.boolean().default(true),
});

export const PRODUCT_KINDS = ['standard', 'weighted', 'open_price', 'bundle', 'service'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const variantSchema = z.object({
  id: id.optional(),
  name,
  options: z.record(z.string(), z.string()).default({}),
  sku: z.string().max(64).default(''),
  barcode: z.string().max(64).default(''),
  price: money,
  cost: money.default(0),
  active: z.boolean().default(true),
});

export const productUnitSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(30),
  factor: z.number().positive(),
  price: money,
  barcode: z.string().max(64).default(''),
});

export const productSchema = z.object({
  name,
  sku: z.string().trim().max(64).default(''),
  categoryId: optId,
  kind: z.enum(PRODUCT_KINDS).default('standard'),
  unit: z.string().max(30).default(t('ชิ้น')),
  price: money.min(0),
  cost: money.min(0).default(0),
  taxable: z.boolean().default(true),
  trackStock: z.boolean().default(true),
  lowStock: z.number().min(0).default(0),
  color: z.string().max(20).default(''),
  image: z.string().max(400_000).default(''),
  active: z.boolean().default(true),
  showInPos: z.boolean().default(true),
  barcodes: z.array(z.string().trim().min(1).max(64)).default([]),
  variants: z.array(variantSchema).default([]),
  units: z.array(productUnitSchema).default([]),
  modifierGroupIds: z.array(id).default([]),
  bundleItems: z
    .array(z.object({ productId: id, variantId: optId, qty: z.number().positive() }))
    .default([]),
  tierPrices: z.array(z.object({ tierId: id, price: money.min(0) })).default([]),
  custom: jsonRecord.default({}),
});
export type ProductInput = z.infer<typeof productSchema>;

export const modifierGroupSchema = z.object({
  name,
  minSelect: z.number().int().min(0).default(0),
  maxSelect: z.number().int().min(0).default(1),
  modifiers: z
    .array(
      z.object({
        id: id.optional(),
        name: z.string().trim().min(1).max(100),
        priceDelta: money.default(0),
        active: z.boolean().default(true),
      }),
    )
    .min(1, t('ต้องมีตัวเลือกอย่างน้อย 1 รายการ')),
});

export const priceTierSchema = z.object({ name });

export const CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'select', 'checkbox', 'image'] as const;
export const customFieldSchema = z.object({
  entity: z.enum(['product', 'customer', 'supplier']),
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, t('ใช้ a-z 0-9 _ ขึ้นต้นด้วยตัวอักษร')),
  label: name,
  type: z.enum(CUSTOM_FIELD_TYPES),
  options: z.array(z.string().trim().min(1)).default([]),
  required: z.boolean().default(false),
  showInPos: z.boolean().default(false),
  showOnReceipt: z.boolean().default(false),
  showInReport: z.boolean().default(false),
  sort: z.number().int().default(0),
});

export const bulkProductSchema = z.object({
  ids: z.array(id).min(1),
  patch: z.object({
    categoryId: optId,
    active: z.boolean().optional(),
    showInPos: z.boolean().optional(),
    taxable: z.boolean().optional(),
    trackStock: z.boolean().optional(),
    priceChange: z
      .object({ mode: z.enum(['set', 'percent', 'amount']), value: z.number() })
      .optional(),
    color: z.string().max(20).optional(),
  }),
});

/* ---------- Customers & suppliers ---------- */

export const customerSchema = z.object({
  name,
  code: z.string().max(40).default(''),
  phone: z.string().max(30).default(''),
  email: z.string().email().or(z.literal('')).default(''),
  birthday: z.string().max(10).default(''),
  groupId: optId,
  tierId: optId,
  creditLimit: money.min(0).default(0),
  taxId: z.string().max(20).default(''),
  taxBranch: z.string().max(20).default(''),
  taxName: z.string().max(200).default(''),
  address: z.string().max(500).default(''),
  note: z.string().max(1000).default(''),
  custom: jsonRecord.default({}),
  active: z.boolean().default(true),
});

export const customerGroupSchema = z.object({
  name,
  discountPercent: z.number().min(0).max(100).default(0),
  priceTierId: optId,
});

export const memberTierSchema = z.object({
  name,
  minSpend: money.min(0).default(0),
  pointMultiplier: z.number().min(0).max(10).default(1),
});

export const supplierSchema = z.object({
  name,
  contact: z.string().max(100).default(''),
  phone: z.string().max(30).default(''),
  email: z.string().email().or(z.literal('')).default(''),
  taxId: z.string().max(20).default(''),
  address: z.string().max(500).default(''),
  custom: jsonRecord.default({}),
  active: z.boolean().default(true),
});

/* ---------- Stock ---------- */

export const stockDocSchema = z.object({
  type: z.enum(['receive', 'adjust', 'count', 'transfer']),
  branchId: optId,
  toBranchId: optId,
  supplierId: optId,
  note: z.string().max(500).default(''),
  lines: z
    .array(
      z.object({
        productId: id,
        variantId: optId,
        qty: z.number(),
        unitCost: money.min(0).default(0),
        lotNo: z.string().max(60).default(''),
        expiryDate: z.string().max(10).default(''),
      }),
    )
    .min(1, t('ต้องมีอย่างน้อย 1 รายการ')),
});

/* ---------- Promotions ---------- */

export const promotionSchema = z.object({
  name,
  type: z.enum(['percent', 'amount', 'bxgy', 'threshold', 'fixed_price']),
  priority: z.number().int().default(0),
  exclusive: z.boolean().default(false),
  value: z.number().min(0),
  scope: z.enum(['items', 'bill']).default('items'),
  productIds: z.array(id).default([]),
  categoryIds: z.array(id).default([]),
  customerGroupIds: z.array(id).default([]),
  branchIds: z.array(id).default([]),
  buyQty: z.number().int().min(0).default(0),
  getQty: z.number().int().min(0).default(0),
  getDiscountPercent: z.number().min(0).max(100).default(100),
  minSubtotal: money.min(0).default(0),
  maxDiscount: money.min(0).default(0),
  couponCode: z.string().trim().max(40).nullable().default(null),
  usageLimit: z.number().int().min(0).default(0),
  startsAt: z.string().nullable().default(null),
  endsAt: z.string().nullable().default(null),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  timeFrom: z.string().nullable().default(null),
  timeTo: z.string().nullable().default(null),
  active: z.boolean().default(true),
});

/* ---------- Sales ---------- */

export const saleLineSchema = z.object({
  id,
  productId: id,
  variantId: optId,
  unitId: optId,
  name: z.string().max(300),
  qty: z.number().refine((v) => v !== 0, t('จำนวนต้องไม่เป็นศูนย์')),
  unitPrice: money.min(0),
  priceOverridden: z.boolean().default(false),
  modifiers: z
    .array(z.object({ id, name: z.string(), priceDelta: money }))
    .default([]),
  note: z.string().max(300).default(''),
  discount: discountSchema.nullable().default(null),
});
export type SaleLineInput = z.infer<typeof saleLineSchema>;

export const salePaymentSchema = z.object({
  methodCode: z.string().min(1).max(40),
  amount: money.min(0),
  ref: z.string().max(100).default(''),
});

export const taxInvoiceSchema = z.object({
  name: z.string().trim().min(1, t('กรุณากรอกชื่อผู้ซื้อ')).max(200),
  taxId: z.string().trim().regex(/^\d{13}$/, t('เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก')),
  branch: z.string().max(40).default(t('สำนักงานใหญ่')),
  address: z.string().max(500).default(''),
});

export const saleSchema = z.object({
  /** Client-generated UUID; also the idempotency key for offline sync. */
  id: z.string().uuid(),
  lines: z.array(saleLineSchema).min(1, t('ยังไม่มีรายการ')),
  billDiscount: discountSchema.nullable().default(null),
  customerId: optId,
  couponCodes: z.array(z.string()).default([]),
  pointsRedeemed: z.number().int().min(0).default(0),
  payments: z.array(salePaymentSchema).min(1),
  orderId: optId,
  note: z.string().max(500).default(''),
  taxInvoice: taxInvoiceSchema.nullable().default(null),
  /** ISO time when the sale was made (offline sales keep their real time). */
  createdAt: z.string().optional(),
  managerPin: z.string().optional(),
});
export type SaleInput = z.infer<typeof saleSchema>;

export const quoteSchema = saleSchema.pick({ lines: true, billDiscount: true, customerId: true, couponCodes: true, pointsRedeemed: true });

export const voidSchema = z.object({ reason: z.string().trim().min(1, t('กรุณาระบุเหตุผล')).max(300), managerPin: z.string().optional() });

export const refundSchema = z.object({
  id: z.string().uuid(),
  lines: z.array(z.object({ lineId: id, qty: z.number().positive() })).min(1),
  reason: z.string().trim().min(1, t('กรุณาระบุเหตุผล')).max(300),
  methodCode: z.string().min(1),
  restock: z.boolean().default(true),
  managerPin: z.string().optional(),
});

export const holdSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(100).default(''),
  data: jsonRecord,
});

/* ---------- Shifts ---------- */

export const openShiftSchema = z.object({ openingCash: money.min(0), register: z.string().max(60).default('POS-1') });
export const cashMoveSchema = z.object({
  type: z.enum(['in', 'out']),
  amount: money.positive(),
  reason: z.string().trim().min(1).max(200),
});
export const closeShiftSchema = z.object({ countedCash: money.min(0), note: z.string().max(500).default('') });

/* ---------- Restaurant ---------- */

export const zoneSchema = z.object({ name, sort: z.number().int().default(0) });
export const tableSchema = z.object({
  name: z.string().trim().min(1).max(30),
  zoneId: optId,
  seats: z.number().int().min(0).max(100).default(4),
  sort: z.number().int().default(0),
});
export const orderItemsSchema = z.object({
  /** idempotency key for offline order app */
  requestId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: id,
        variantId: optId,
        qty: z.number().positive(),
        modifiers: z.array(z.object({ id, name: z.string(), priceDelta: money })).default([]),
        note: z.string().max(300).default(''),
      }),
    )
    .min(1),
  source: z.enum(['pos', 'app']).default('pos'),
});

/* ---------- Devices ---------- */

export const printerSchema = z.object({
  name,
  kind: z.enum(['network', 'system']),
  address: z.string().max(200).default(''),
  port: z.number().int().min(1).max(65535).default(9100),
  paper: z.enum(['58', '80']).default('80'),
  role: z.enum(['receipt', 'kitchen', 'bar', 'label']),
  categoryIds: z.array(id).default([]),
  textMode: z.enum(['image', 'thai']).default('image'),
  openDrawer: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const paymentMethodSchema = z.object({
  name,
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_]+$/),
  kind: z.enum(['cash', 'promptpay', 'credit', 'points', 'other']),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});

export const branchSchema = z.object({
  name,
  code: z.string().trim().min(1).max(10),
  address: z.string().max(500).default(''),
  phone: z.string().max(30).default(''),
  taxBranchNo: z.string().max(10).default('00000'),
  active: z.boolean().default(true),
});
