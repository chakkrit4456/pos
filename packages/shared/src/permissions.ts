import { t } from './i18n.js';
export const PERMISSIONS = {
  'pos.sell': t('ขายสินค้า'),
  'pos.discount': t('ให้ส่วนลด'),
  'pos.price_override': t('แก้ราคาขาย'),
  'pos.void': t('ยกเลิกบิล'),
  'pos.refund': t('คืนสินค้า'),
  'pos.reprint': t('พิมพ์ใบเสร็จซ้ำ'),
  'pos.open_drawer': t('เปิดลิ้นชักเงิน'),
  'pos.credit_sale': t('ขายเชื่อ/ค้างชำระ'),
  'shift.manage': t('เปิด/ปิดกะ และนำเงินเข้าออก'),
  'tables.manage': t('จัดการโต๊ะและออเดอร์'),
  'kitchen.view': t('จอครัว'),
  'products.view': t('ดูสินค้า'),
  'products.manage': t('จัดการสินค้า'),
  'stock.view': t('ดูสต็อก'),
  'stock.manage': t('รับเข้า/ปรับ/นับ/โอนสต็อก'),
  'customers.view': t('ดูลูกค้า'),
  'customers.manage': t('จัดการลูกค้า'),
  'promotions.manage': t('จัดการโปรโมชั่น'),
  'reports.view': t('ดูรายงาน'),
  'reports.profit': t('ดูต้นทุนและกำไร'),
  'users.manage': t('จัดการผู้ใช้และสิทธิ์'),
  'settings.manage': t('ตั้งค่าระบบ'),
  'audit.view': t('ดูบันทึกการใช้งาน'),
  'backup.manage': t('สำรอง/กู้คืนข้อมูล'),
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const PERMISSION_GROUPS: { label: string; keys: Permission[] }[] = [
  {
    label: t('หน้าขาย'),
    keys: [
      'pos.sell',
      'pos.discount',
      'pos.price_override',
      'pos.void',
      'pos.refund',
      'pos.reprint',
      'pos.open_drawer',
      'pos.credit_sale',
    ],
  },
  { label: t('กะและโต๊ะ'), keys: ['shift.manage', 'tables.manage', 'kitchen.view'] },
  { label: t('สินค้าและสต็อก'), keys: ['products.view', 'products.manage', 'stock.view', 'stock.manage'] },
  { label: t('ลูกค้าและโปรโมชั่น'), keys: ['customers.view', 'customers.manage', 'promotions.manage'] },
  {
    label: t('ผู้ดูแล'),
    keys: ['reports.view', 'reports.profit', 'users.manage', 'settings.manage', 'audit.view', 'backup.manage'],
  },
];

export const DEFAULT_ROLES: { code: string; name: string; permissions: Permission[] }[] = [
  { code: 'owner', name: t('เจ้าของ'), permissions: ALL_PERMISSIONS },
  {
    code: 'manager',
    name: t('ผู้จัดการ'),
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'users.manage' && p !== 'backup.manage'),
  },
  {
    code: 'cashier',
    name: t('แคชเชียร์'),
    permissions: [
      'pos.sell',
      'pos.reprint',
      'shift.manage',
      'tables.manage',
      'products.view',
      'customers.view',
      'stock.view',
    ],
  },
  { code: 'kitchen', name: t('พนักงานครัว'), permissions: ['kitchen.view', 'tables.manage'] },
];
