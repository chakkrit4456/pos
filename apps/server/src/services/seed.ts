import type { BusinessType } from '@flexpos/shared';
import type { Tx } from '../context.js';
import { nowIso, uuid } from '../util.js';

interface SeedProduct {
  name: string;
  price: number;
  sku: string;
  barcode?: string;
  cost?: number;
  stock?: number;
  color?: string;
  unit?: string;
  kind?: 'standard' | 'weighted' | 'service';
  variants?: { name: string; price: number; options: Record<string, string> }[];
  modifiers?: string[];
}

interface SeedSet {
  categories: { name: string; color: string; station?: string; products: SeedProduct[] }[];
  modifierGroups?: { key: string; name: string; min: number; max: number; items: [string, number][] }[];
  zones?: { name: string; tables: string[] }[];
}

const SEEDS: Record<BusinessType, SeedSet> = {
  cafe: {
    modifierGroups: [
      { key: 'size', name: 'ขนาด', min: 1, max: 1, items: [['ปกติ', 0], ['ใหญ่', 1500]] },
      { key: 'sweet', name: 'ความหวาน', min: 0, max: 1, items: [['หวานน้อย', 0], ['หวานปกติ', 0], ['ไม่หวาน', 0]] },
      { key: 'milk', name: 'นม', min: 0, max: 1, items: [['นมวัว', 0], ['นมโอ๊ต', 1500], ['นมอัลมอนด์', 1500]] },
    ],
    categories: [
      {
        name: 'กาแฟ',
        color: '#e8dccb',
        station: 'bar',
        products: [
          { name: 'อเมริกาโน่เย็น', price: 6500, sku: 'C001', cost: 1800, modifiers: ['size', 'sweet'] },
          { name: 'ลาเต้ร้อน', price: 7500, sku: 'C002', cost: 2200, modifiers: ['size', 'milk'] },
          { name: 'ลาเต้เย็น', price: 8000, sku: 'C003', cost: 2400, modifiers: ['size', 'sweet', 'milk'] },
          { name: 'คาปูชิโน่', price: 7500, sku: 'C004', cost: 2200, modifiers: ['size', 'milk'] },
          { name: 'เอสเพรสโซ่', price: 5500, sku: 'C005', cost: 1500 },
        ],
      },
      {
        name: 'ชา',
        color: '#dcebd6',
        station: 'bar',
        products: [
          { name: 'มัทฉะลาเต้', price: 8500, sku: 'T001', cost: 2800, modifiers: ['size', 'sweet', 'milk'] },
          { name: 'ชาไทยเย็น', price: 6000, sku: 'T002', cost: 1500, modifiers: ['size', 'sweet'] },
          { name: 'ชาเขียวมะลิ', price: 5500, sku: 'T003', cost: 1200, modifiers: ['sweet'] },
        ],
      },
      {
        name: 'เบเกอรี่',
        color: '#f3e3c3',
        station: 'kitchen',
        products: [
          { name: 'ครัวซองต์เนยสด', price: 7500, sku: 'B001', cost: 3000, stock: 24 },
          { name: 'ชีสเค้กบลูเบอร์รี่', price: 11000, sku: 'B002', cost: 4500, stock: 12 },
          { name: 'บราวนี่', price: 6500, sku: 'B003', cost: 2000, stock: 18 },
          { name: 'บานอฟฟี่พาย', price: 9500, sku: 'B004', cost: 3500, stock: 8 },
        ],
      },
      {
        name: 'เครื่องดื่มอื่นๆ',
        color: '#d9e8f2',
        station: 'bar',
        products: [
          { name: 'โซดาเลมอน', price: 5000, sku: 'D001', cost: 1200 },
          { name: 'น้ำดื่ม', price: 1500, sku: 'D002', cost: 500, stock: 48, barcode: '8851952350017' },
        ],
      },
    ],
    zones: [
      { name: 'ในร้าน', tables: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'] },
      { name: 'ระเบียง', tables: ['B1', 'B2', 'B3'] },
    ],
  },
  restaurant: {
    modifierGroups: [
      { key: 'spicy', name: 'ความเผ็ด', min: 0, max: 1, items: [['ไม่เผ็ด', 0], ['เผ็ดน้อย', 0], ['เผ็ดมาก', 0]] },
      { key: 'extra', name: 'เพิ่มเติม', min: 0, max: 3, items: [['ไข่ดาว', 1000], ['พิเศษ', 2000], ['ข้าวเพิ่ม', 1000]] },
    ],
    categories: [
      {
        name: 'อาหารจานเดียว',
        color: '#f6dccb',
        station: 'kitchen',
        products: [
          { name: 'ข้าวกะเพราหมูสับ', price: 6000, sku: 'F001', cost: 2500, modifiers: ['spicy', 'extra'] },
          { name: 'ข้าวผัดกุ้ง', price: 7000, sku: 'F002', cost: 3000, modifiers: ['extra'] },
          { name: 'ผัดไทยกุ้งสด', price: 8000, sku: 'F003', cost: 3500, modifiers: ['spicy', 'extra'] },
          { name: 'ข้าวมันไก่', price: 5500, sku: 'F004', cost: 2200, modifiers: ['extra'] },
        ],
      },
      {
        name: 'กับข้าว',
        color: '#efe4c8',
        station: 'kitchen',
        products: [
          { name: 'ต้มยำกุ้งน้ำข้น', price: 18000, sku: 'G001', cost: 7000, modifiers: ['spicy'] },
          { name: 'แกงเขียวหวานไก่', price: 12000, sku: 'G002', cost: 4500, modifiers: ['spicy'] },
          { name: 'ปลากะพงทอดน้ำปลา', price: 32000, sku: 'G003', cost: 15000 },
          { name: 'ผัดผักบุ้งไฟแดง', price: 8000, sku: 'G004', cost: 2000, modifiers: ['spicy'] },
        ],
      },
      {
        name: 'เครื่องดื่ม',
        color: '#d9e8f2',
        station: 'bar',
        products: [
          { name: 'น้ำเปล่า', price: 1500, sku: 'W001', cost: 500 },
          { name: 'น้ำอัดลม', price: 2500, sku: 'W002', cost: 1200 },
          { name: 'ชาเย็น', price: 4500, sku: 'W003', cost: 1200 },
          { name: 'ข้าวสวย', price: 1500, sku: 'W004', cost: 300 },
        ],
      },
    ],
    zones: [
      { name: 'โซนใน', tables: ['1', '2', '3', '4', '5', '6', '7', '8'] },
      { name: 'โซนนอก', tables: ['9', '10', '11', '12'] },
      { name: 'ห้อง VIP', tables: ['V1', 'V2'] },
    ],
  },
  retail: {
    categories: [
      {
        name: 'เครื่องดื่ม',
        color: '#d9e8f2',
        products: [
          { name: 'น้ำดื่ม 600 มล.', price: 700, sku: 'R001', cost: 450, stock: 120, barcode: '8850999320014' },
          { name: 'โค้ก 325 มล.', price: 1700, sku: 'R002', cost: 1200, stock: 96, barcode: '8851959132012' },
          { name: 'ชาเขียว 500 มล.', price: 2000, sku: 'R003', cost: 1400, stock: 60, barcode: '8854698001012' },
          { name: 'กาแฟกระป๋อง', price: 1500, sku: 'R004', cost: 1000, stock: 4, barcode: '8851123212014' },
        ],
      },
      {
        name: 'ขนม',
        color: '#f3e3c3',
        products: [
          { name: 'มันฝรั่งทอด 50 ก.', price: 2000, sku: 'S001', cost: 1400, stock: 40, barcode: '8850718801015' },
          { name: 'ขนมปังแผ่น', price: 3500, sku: 'S002', cost: 2500, stock: 15, barcode: '8851234567892' },
          { name: 'ช็อกโกแลตแท่ง', price: 2500, sku: 'S003', cost: 1700, stock: 3, barcode: '8851234567908' },
        ],
      },
      {
        name: 'ของใช้',
        color: '#e6e1f0',
        products: [
          { name: 'สบู่ก้อน', price: 2500, sku: 'H001', cost: 1600, stock: 30, barcode: '8851234567915' },
          { name: 'ยาสีฟัน 150 ก.', price: 5900, sku: 'H002', cost: 4200, stock: 20, barcode: '8851234567922' },
          { name: 'ทิชชู่ม้วน 6 ม้วน', price: 8900, sku: 'H003', cost: 6500, stock: 10, barcode: '8851234567939' },
        ],
      },
      {
        name: 'ผักผลไม้ (ชั่งน้ำหนัก)',
        color: '#dcebd6',
        products: [
          { name: 'กล้วยหอม', price: 6000, sku: 'P001', cost: 3500, stock: 20, unit: 'กก.', kind: 'weighted' },
          { name: 'ส้มสายน้ำผึ้ง', price: 8000, sku: 'P002', cost: 5000, stock: 15, unit: 'กก.', kind: 'weighted' },
        ],
      },
    ],
  },
  fashion: {
    categories: [
      {
        name: 'เสื้อ',
        color: '#e6e1f0',
        products: [
          {
            name: 'เสื้อยืดคอกลม',
            price: 29000,
            sku: 'TS01',
            cost: 12000,
            stock: 0,
            variants: ['S', 'M', 'L', 'XL'].flatMap((s) =>
              ['ขาว', 'ดำ'].map((c) => ({ name: `${s} / ${c}`, price: s === 'XL' ? 32000 : 29000, options: { ไซซ์: s, สี: c } })),
            ),
          },
          {
            name: 'เสื้อเชิ้ตลินิน',
            price: 69000,
            sku: 'SH01',
            cost: 30000,
            variants: ['M', 'L'].map((s) => ({ name: s, price: 69000, options: { ไซซ์: s } })),
          },
        ],
      },
      {
        name: 'กางเกง',
        color: '#d9e8f2',
        products: [
          {
            name: 'กางเกงยีนส์ทรงตรง',
            price: 89000,
            sku: 'JN01',
            cost: 40000,
            variants: ['28', '30', '32', '34'].map((s) => ({ name: `เอว ${s}`, price: 89000, options: { เอว: s } })),
          },
        ],
      },
      {
        name: 'เครื่องประดับ',
        color: '#f3e3c3',
        products: [
          { name: 'หมวกแก๊ป', price: 25000, sku: 'AC01', cost: 9000, stock: 25 },
          { name: 'ถุงเท้า (แพ็ค 3)', price: 15000, sku: 'AC02', cost: 6000, stock: 40 },
        ],
      },
    ],
  },
  service: {
    categories: [
      {
        name: 'บริการ',
        color: '#dcebd6',
        products: [
          { name: 'ตัดผมชาย', price: 20000, sku: 'SV01', kind: 'service' },
          { name: 'สระไดร์', price: 15000, sku: 'SV02', kind: 'service' },
          { name: 'ทำสีผม', price: 120000, sku: 'SV03', kind: 'service' },
          { name: 'นวดไทย 1 ชม.', price: 30000, sku: 'SV04', kind: 'service' },
        ],
      },
      {
        name: 'สินค้า',
        color: '#f3e3c3',
        products: [
          { name: 'แชมพู 250 มล.', price: 35000, sku: 'PR01', cost: 18000, stock: 12 },
          { name: 'ทรีตเมนต์', price: 45000, sku: 'PR02', cost: 22000, stock: 8 },
        ],
      },
    ],
  },
  other: {
    categories: [
      {
        name: 'ทั่วไป',
        color: '#e3e1da',
        products: [
          { name: 'สินค้าตัวอย่าง A', price: 10000, sku: 'X001', cost: 6000, stock: 10 },
          { name: 'สินค้าตัวอย่าง B', price: 25000, sku: 'X002', cost: 15000, stock: 10 },
        ],
      },
    ],
  },
};

export async function seedSampleData(tx: Tx, type: BusinessType, branchId: string, userId: string): Promise<void> {
  const set = SEEDS[type];
  const now = nowIso();
  const groupIds = new Map<string, string>();
  for (const g of set.modifierGroups ?? []) {
    const gid = uuid();
    groupIds.set(g.key, gid);
    await tx.insertInto('modifier_groups').values({ id: gid, name: g.name, min_select: g.min, max_select: g.max }).execute();
    let sort = 0;
    for (const [name, price] of g.items) {
      await tx
        .insertInto('modifiers')
        .values({ id: uuid(), group_id: gid, name, price_delta: price, sort: sort++, active: 1 })
        .execute();
    }
  }
  let catSort = 0;
  let prodSort = 0;
  for (const c of set.categories) {
    const cid = uuid();
    await tx
      .insertInto('categories')
      .values({ id: cid, parent_id: null, name: c.name, color: c.color, sort: catSort++, station: c.station ?? null, active: 1 })
      .execute();
    for (const p of c.products) {
      const pid = uuid();
      const kind = p.kind ?? 'standard';
      const track = kind !== 'service' && (p.stock !== undefined || !!p.variants);
      await tx
        .insertInto('products')
        .values({
          id: pid,
          sku: p.sku,
          name: p.name,
          category_id: cid,
          kind,
          unit: p.unit ?? (kind === 'service' ? 'ครั้ง' : 'ชิ้น'),
          price: p.price,
          cost: p.cost ?? 0,
          taxable: 1,
          track_stock: track ? 1 : 0,
          low_stock: track ? 5 : 0,
          color: c.color,
          image: '',
          active: 1,
          show_in_pos: 1,
          sort: prodSort++,
          custom: '{}',
          created_at: now,
          updated_at: now,
          deleted_at: null,
        })
        .execute();
      if (p.barcode) {
        await tx.insertInto('product_barcodes').values({ id: uuid(), product_id: pid, variant_id: null, unit_id: null, code: p.barcode }).execute();
      }
      let mSort = 0;
      for (const key of p.modifiers ?? []) {
        const gid = groupIds.get(key);
        if (gid) await tx.insertInto('product_modifier_groups').values({ id: uuid(), product_id: pid, group_id: gid, sort: mSort++ }).execute();
      }
      const stockRows: { variant: string; qty: number; cost: number }[] = [];
      if (p.variants) {
        let vs = 0;
        for (const v of p.variants) {
          const vid = uuid();
          await tx
            .insertInto('product_variants')
            .values({
              id: vid,
              product_id: pid,
              name: v.name,
              options: JSON.stringify(v.options),
              sku: `${p.sku}-${vs + 1}`,
              price: v.price,
              cost: p.cost ?? 0,
              active: 1,
              sort: vs++,
            })
            .execute();
          stockRows.push({ variant: vid, qty: 10, cost: p.cost ?? 0 });
        }
      } else if (p.stock !== undefined) {
        stockRows.push({ variant: '', qty: p.stock, cost: p.cost ?? 0 });
      }
      for (const s of stockRows) {
        if (s.qty === 0) continue;
        await tx
          .insertInto('stock_levels')
          .values({ id: uuid(), product_id: pid, variant_id: s.variant, branch_id: branchId, qty: s.qty, avg_cost: s.cost, updated_at: now })
          .execute();
        await tx
          .insertInto('stock_moves')
          .values({
            id: uuid(),
            product_id: pid,
            variant_id: s.variant,
            branch_id: branchId,
            type: 'adjust',
            qty: s.qty,
            unit_cost: s.cost,
            balance_after: s.qty,
            ref_type: 'seed',
            ref_id: '',
            lot_no: '',
            expiry_date: '',
            note: 'ยอดยกมา (ข้อมูลตัวอย่าง)',
            user_id: userId,
            created_at: now,
          })
          .execute();
      }
    }
  }
  let zs = 0;
  for (const z of set.zones ?? []) {
    const zid = uuid();
    await tx.insertInto('zones').values({ id: zid, branch_id: branchId, name: z.name, sort: zs++ }).execute();
    let ts = 0;
    for (const t of z.tables) {
      await tx.insertInto('tables').values({ id: uuid(), branch_id: branchId, zone_id: zid, name: t, seats: 4, sort: ts++ }).execute();
    }
  }
  // Sample member tiers/groups
  await tx.insertInto('member_tiers').values([
    { id: uuid(), name: 'Silver', min_spend: 0, point_multiplier: 1 },
    { id: uuid(), name: 'Gold', min_spend: 500000, point_multiplier: 1.5 },
  ]).execute();
  const gid = uuid();
  await tx.insertInto('customer_groups').values({ id: gid, name: 'สมาชิกทั่วไป', discount_percent: 5, price_tier_id: null }).execute();
  await tx
    .insertInto('customers')
    .values({
      id: uuid(),
      code: 'M0001',
      name: 'คุณสมใจ ใจดี',
      phone: '0812345678',
      email: '',
      birthday: '',
      group_id: gid,
      tier_id: null,
      points: 120,
      credit_balance: 0,
      credit_limit: 0,
      tax_id: '',
      tax_branch: '',
      tax_name: '',
      address: '',
      note: '',
      custom: '{}',
      total_spent: 0,
      visit_count: 0,
      last_visit_at: null,
      active: 1,
      created_at: now,
    })
    .execute();
}
