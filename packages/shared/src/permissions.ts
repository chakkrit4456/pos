export const PERMISSIONS = {
  'pos.sell': 'ขายสินค้า',
  'pos.discount': 'ให้ส่วนลด',
  'pos.price_override': 'แก้ราคาขาย',
  'pos.void': 'ยกเลิกบิล',
  'pos.refund': 'คืนสินค้า',
  'pos.reprint': 'พิมพ์ใบเสร็จซ้ำ',
  'pos.open_drawer': 'เปิดลิ้นชักเงิน',
  'pos.credit_sale': 'ขายเชื่อ/ค้างชำระ',
  'shift.manage': 'เปิด/ปิดกะ และนำเงินเข้าออก',
  'tables.manage': 'จัดการโต๊ะและออเดอร์',
  'kitchen.view': 'จอครัว',
  'products.view': 'ดูสินค้า',
  'products.manage': 'จัดการสินค้า',
  'stock.view': 'ดูสต็อก',
  'stock.manage': 'รับเข้า/ปรับ/นับ/โอนสต็อก',
  'customers.view': 'ดูลูกค้า',
  'customers.manage': 'จัดการลูกค้า',
  'promotions.manage': 'จัดการโปรโมชั่น',
  'reports.view': 'ดูรายงาน',
  'reports.profit': 'ดูต้นทุนและกำไร',
  'users.manage': 'จัดการผู้ใช้และสิทธิ์',
  'settings.manage': 'ตั้งค่าระบบ',
  'audit.view': 'ดูบันทึกการใช้งาน',
  'backup.manage': 'สำรอง/กู้คืนข้อมูล',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const PERMISSION_GROUPS: { label: string; keys: Permission[] }[] = [
  {
    label: 'หน้าขาย',
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
  { label: 'กะและโต๊ะ', keys: ['shift.manage', 'tables.manage', 'kitchen.view'] },
  { label: 'สินค้าและสต็อก', keys: ['products.view', 'products.manage', 'stock.view', 'stock.manage'] },
  { label: 'ลูกค้าและโปรโมชั่น', keys: ['customers.view', 'customers.manage', 'promotions.manage'] },
  {
    label: 'ผู้ดูแล',
    keys: ['reports.view', 'reports.profit', 'users.manage', 'settings.manage', 'audit.view', 'backup.manage'],
  },
];

export const DEFAULT_ROLES: { code: string; name: string; permissions: Permission[] }[] = [
  { code: 'owner', name: 'เจ้าของ', permissions: ALL_PERMISSIONS },
  {
    code: 'manager',
    name: 'ผู้จัดการ',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'users.manage' && p !== 'backup.manage'),
  },
  {
    code: 'cashier',
    name: 'แคชเชียร์',
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
  { code: 'kitchen', name: 'พนักงานครัว', permissions: ['kitchen.view', 'tables.manage'] },
];
