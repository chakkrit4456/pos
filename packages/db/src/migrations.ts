import { sql, type Kysely, type Migration, type MigrationProvider } from 'kysely';
import type { Dialect } from './dialect.js';

type ColType = 'id' | 'ref' | 'str' | 'short' | 'text' | 'big' | 'int' | 'real' | 'bool' | 'ts' | 'date';
type ColDef = [name: string, type: ColType, opts?: { null?: boolean; pk?: boolean; default?: number }];

interface TableDef {
  name: string;
  cols: ColDef[];
  indexes?: { cols: string[]; unique?: boolean }[];
}

function colType(t: ColType, dialect: Dialect) {
  switch (t) {
    case 'id':
    case 'ref':
      return sql`varchar(36)`;
    case 'str':
      return sql`varchar(255)`;
    case 'short':
      return sql`varchar(64)`;
    case 'text':
      return dialect === 'mysql' ? sql`longtext` : sql`text`;
    case 'big':
      return sql`bigint`;
    case 'int':
    case 'bool':
      return sql`integer`;
    case 'real':
      return sql`double precision`;
    case 'ts':
      return sql`varchar(30)`;
    case 'date':
      return sql`varchar(10)`;
  }
}

async function createTable(db: Kysely<unknown>, dialect: Dialect, def: TableDef) {
  let b = db.schema.createTable(def.name).ifNotExists();
  for (const [name, type, opts = {}] of def.cols) {
    b = b.addColumn(name, colType(type, dialect), (c) => {
      let col = c;
      if (opts.pk) col = col.primaryKey();
      if (!opts.null && !opts.pk) col = col.notNull();
      if (opts.default !== undefined) col = col.defaultTo(opts.default);
      return col;
    });
  }
  await b.execute();
  for (const idx of def.indexes ?? []) {
    const idxName = `ix_${def.name}_${idx.cols.join('_')}`.slice(0, 60);
    let ib = db.schema.createIndex(idxName).on(def.name).columns(idx.cols);
    if (idx.unique) ib = ib.unique();
    if (dialect !== 'mysql') ib = ib.ifNotExists();
    await ib.execute();
  }
}

const B = (d = 0): { default: number } => ({ default: d });
const N = { null: true } as const;
const PK = { pk: true } as const;

const TABLES_V1: TableDef[] = [
  { name: 'meta', cols: [['k', 'short', PK], ['v', 'text']] },
  { name: 'settings', cols: [['id', 'short', PK], ['data', 'text'], ['updated_at', 'ts']] },
  {
    name: 'branches',
    cols: [['id', 'id', PK], ['code', 'short'], ['name', 'str'], ['address', 'text'], ['phone', 'short'], ['tax_branch_no', 'short'], ['active', 'bool', B(1)], ['created_at', 'ts']],
  },
  { name: 'roles', cols: [['id', 'id', PK], ['code', 'short'], ['name', 'str'], ['permissions', 'text'], ['system', 'bool', B()]] },
  {
    name: 'users',
    cols: [
      ['id', 'id', PK], ['username', 'short'], ['name', 'str'], ['password_hash', 'str'], ['pin_hash', 'str', N],
      ['role_id', 'ref'], ['branch_id', 'ref', N], ['active', 'bool', B(1)], ['created_at', 'ts'], ['last_login_at', 'ts', N],
    ],
    indexes: [{ cols: ['username'], unique: true }, { cols: ['pin_hash'] }],
  },
  {
    name: 'refresh_tokens',
    cols: [['id', 'id', PK], ['user_id', 'ref'], ['token_hash', 'str'], ['expires_at', 'ts'], ['created_at', 'ts'], ['revoked', 'bool', B()]],
    indexes: [{ cols: ['token_hash'], unique: true }],
  },
  {
    name: 'categories',
    cols: [['id', 'id', PK], ['parent_id', 'ref', N], ['name', 'str'], ['color', 'short'], ['sort', 'int', B()], ['station', 'short', N], ['active', 'bool', B(1)]],
  },
  {
    name: 'products',
    cols: [
      ['id', 'id', PK], ['sku', 'short'], ['name', 'str'], ['category_id', 'ref', N], ['kind', 'short'], ['unit', 'short'],
      ['price', 'big', B()], ['cost', 'big', B()], ['taxable', 'bool', B(1)], ['track_stock', 'bool', B(1)], ['low_stock', 'real', B()],
      ['color', 'short'], ['image', 'text'], ['active', 'bool', B(1)], ['show_in_pos', 'bool', B(1)], ['sort', 'int', B()],
      ['custom', 'text'], ['created_at', 'ts'], ['updated_at', 'ts'], ['deleted_at', 'ts', N],
    ],
    indexes: [{ cols: ['sku'] }, { cols: ['category_id'] }, { cols: ['name'] }],
  },
  {
    name: 'product_barcodes',
    cols: [['id', 'id', PK], ['product_id', 'ref'], ['variant_id', 'ref', N], ['unit_id', 'ref', N], ['code', 'short']],
    indexes: [{ cols: ['code'], unique: true }, { cols: ['product_id'] }],
  },
  {
    name: 'product_variants',
    cols: [['id', 'id', PK], ['product_id', 'ref'], ['name', 'str'], ['options', 'text'], ['sku', 'short'], ['price', 'big', B()], ['cost', 'big', B()], ['active', 'bool', B(1)], ['sort', 'int', B()]],
    indexes: [{ cols: ['product_id'] }],
  },
  {
    name: 'product_units',
    cols: [['id', 'id', PK], ['product_id', 'ref'], ['name', 'short'], ['factor', 'real'], ['price', 'big', B()]],
    indexes: [{ cols: ['product_id'] }],
  },
  { name: 'price_tiers', cols: [['id', 'id', PK], ['name', 'str']] },
  {
    name: 'product_prices',
    cols: [['id', 'id', PK], ['product_id', 'ref'], ['tier_id', 'ref'], ['price', 'big', B()]],
    indexes: [{ cols: ['product_id', 'tier_id'], unique: true }],
  },
  { name: 'modifier_groups', cols: [['id', 'id', PK], ['name', 'str'], ['min_select', 'int', B()], ['max_select', 'int', B(1)]] },
  {
    name: 'modifiers',
    cols: [['id', 'id', PK], ['group_id', 'ref'], ['name', 'str'], ['price_delta', 'big', B()], ['sort', 'int', B()], ['active', 'bool', B(1)]],
    indexes: [{ cols: ['group_id'] }],
  },
  {
    name: 'product_modifier_groups',
    cols: [['id', 'id', PK], ['product_id', 'ref'], ['group_id', 'ref'], ['sort', 'int', B()]],
    indexes: [{ cols: ['product_id'] }],
  },
  {
    name: 'bundle_items',
    cols: [['id', 'id', PK], ['bundle_id', 'ref'], ['product_id', 'ref'], ['variant_id', 'ref', N], ['qty', 'real']],
    indexes: [{ cols: ['bundle_id'] }],
  },
  {
    name: 'custom_fields',
    cols: [
      ['id', 'id', PK], ['entity', 'short'], ['field_key', 'short'], ['label', 'str'], ['type', 'short'], ['options', 'text'],
      ['required', 'bool', B()], ['show_in_pos', 'bool', B()], ['show_on_receipt', 'bool', B()], ['show_in_report', 'bool', B()], ['sort', 'int', B()],
    ],
    indexes: [{ cols: ['entity', 'field_key'], unique: true }],
  },
  {
    name: 'stock_levels',
    cols: [['id', 'id', PK], ['product_id', 'ref'], ['variant_id', 'short'], ['branch_id', 'ref'], ['qty', 'real', B()], ['avg_cost', 'big', B()], ['updated_at', 'ts']],
    indexes: [{ cols: ['product_id', 'variant_id', 'branch_id'], unique: true }, { cols: ['branch_id'] }],
  },
  {
    name: 'stock_moves',
    cols: [
      ['id', 'id', PK], ['product_id', 'ref'], ['variant_id', 'short'], ['branch_id', 'ref'], ['type', 'short'], ['qty', 'real'],
      ['unit_cost', 'big', B()], ['balance_after', 'real'], ['ref_type', 'short'], ['ref_id', 'short'], ['lot_no', 'short'],
      ['expiry_date', 'date'], ['note', 'text'], ['user_id', 'ref', N], ['created_at', 'ts'],
    ],
    indexes: [{ cols: ['product_id', 'created_at'] }, { cols: ['branch_id', 'created_at'] }, { cols: ['ref_id'] }],
  },
  {
    name: 'stock_lots',
    cols: [['id', 'id', PK], ['product_id', 'ref'], ['variant_id', 'short'], ['branch_id', 'ref'], ['lot_no', 'short'], ['expiry_date', 'date'], ['qty', 'real', B()]],
    indexes: [{ cols: ['product_id', 'branch_id'] }, { cols: ['expiry_date'] }],
  },
  {
    name: 'stock_docs',
    cols: [
      ['id', 'id', PK], ['doc_no', 'short'], ['type', 'short'], ['branch_id', 'ref'], ['to_branch_id', 'ref', N], ['supplier_id', 'ref', N],
      ['note', 'text'], ['total_cost', 'big', B()], ['user_id', 'ref', N], ['created_at', 'ts'],
    ],
    indexes: [{ cols: ['created_at'] }],
  },
  {
    name: 'stock_doc_lines',
    cols: [
      ['id', 'id', PK], ['doc_id', 'ref'], ['product_id', 'ref'], ['variant_id', 'short'], ['qty', 'real'], ['system_qty', 'real', B()],
      ['unit_cost', 'big', B()], ['lot_no', 'short'], ['expiry_date', 'date'],
    ],
    indexes: [{ cols: ['doc_id'] }],
  },
  {
    name: 'suppliers',
    cols: [['id', 'id', PK], ['name', 'str'], ['contact', 'str'], ['phone', 'short'], ['email', 'str'], ['tax_id', 'short'], ['address', 'text'], ['custom', 'text'], ['active', 'bool', B(1)], ['created_at', 'ts']],
  },
  { name: 'customer_groups', cols: [['id', 'id', PK], ['name', 'str'], ['discount_percent', 'real', B()], ['price_tier_id', 'ref', N]] },
  { name: 'member_tiers', cols: [['id', 'id', PK], ['name', 'str'], ['min_spend', 'big', B()], ['point_multiplier', 'real', B(1)]] },
  {
    name: 'customers',
    cols: [
      ['id', 'id', PK], ['code', 'short'], ['name', 'str'], ['phone', 'short'], ['email', 'str'], ['birthday', 'date'],
      ['group_id', 'ref', N], ['tier_id', 'ref', N], ['points', 'big', B()], ['credit_balance', 'big', B()], ['credit_limit', 'big', B()],
      ['tax_id', 'short'], ['tax_branch', 'short'], ['tax_name', 'str'], ['address', 'text'], ['note', 'text'], ['custom', 'text'],
      ['total_spent', 'big', B()], ['visit_count', 'int', B()], ['last_visit_at', 'ts', N], ['active', 'bool', B(1)], ['created_at', 'ts'],
    ],
    indexes: [{ cols: ['phone'] }, { cols: ['code'] }, { cols: ['name'] }],
  },
  {
    name: 'point_moves',
    cols: [['id', 'id', PK], ['customer_id', 'ref'], ['sale_id', 'ref', N], ['points', 'big'], ['type', 'short'], ['note', 'text'], ['created_at', 'ts']],
    indexes: [{ cols: ['customer_id'] }],
  },
  {
    name: 'credit_moves',
    cols: [['id', 'id', PK], ['customer_id', 'ref'], ['sale_id', 'ref', N], ['amount', 'big'], ['type', 'short'], ['method', 'short'], ['note', 'text'], ['user_id', 'ref', N], ['created_at', 'ts']],
    indexes: [{ cols: ['customer_id'] }],
  },
  {
    name: 'promotions',
    cols: [
      ['id', 'id', PK], ['name', 'str'], ['type', 'short'], ['priority', 'int', B()], ['exclusive', 'bool', B()], ['value', 'real', B()],
      ['scope', 'short'], ['product_ids', 'text'], ['category_ids', 'text'], ['customer_group_ids', 'text'], ['branch_ids', 'text'],
      ['buy_qty', 'int', B()], ['get_qty', 'int', B()], ['get_discount_percent', 'real', B(100)], ['min_subtotal', 'big', B()],
      ['max_discount', 'big', B()], ['coupon_code', 'short', N], ['usage_limit', 'int', B()], ['usage_count', 'int', B()],
      ['starts_at', 'ts', N], ['ends_at', 'ts', N], ['days_of_week', 'short'], ['time_from', 'short', N], ['time_to', 'short', N],
      ['active', 'bool', B(1)], ['created_at', 'ts'],
    ],
  },
  { name: 'payment_methods', cols: [['id', 'id', PK], ['code', 'short'], ['name', 'str'], ['kind', 'short'], ['active', 'bool', B(1)], ['sort', 'int', B()]], indexes: [{ cols: ['code'], unique: true }] },
  {
    name: 'shifts',
    cols: [
      ['id', 'id', PK], ['number', 'int'], ['branch_id', 'ref'], ['register', 'short'], ['opened_by', 'ref'], ['opened_at', 'ts'],
      ['opening_cash', 'big', B()], ['closed_by', 'ref', N], ['closed_at', 'ts', N], ['counted_cash', 'big', N], ['expected_cash', 'big', N],
      ['status', 'short'], ['note', 'text'],
    ],
    indexes: [{ cols: ['branch_id', 'status'] }],
  },
  {
    name: 'cash_moves',
    cols: [['id', 'id', PK], ['shift_id', 'ref'], ['type', 'short'], ['amount', 'big'], ['reason', 'str'], ['user_id', 'ref'], ['created_at', 'ts']],
    indexes: [{ cols: ['shift_id'] }],
  },
  {
    name: 'sales',
    cols: [
      ['id', 'id', PK], ['doc_no', 'short'], ['tax_invoice_no', 'short', N], ['type', 'short'], ['status', 'short'], ['ref_sale_id', 'ref', N],
      ['branch_id', 'ref'], ['shift_id', 'ref', N], ['user_id', 'ref'], ['customer_id', 'ref', N], ['order_id', 'ref', N], ['table_name', 'short', N],
      ['subtotal', 'big', B()], ['line_discount', 'big', B()], ['promo_discount', 'big', B()], ['bill_discount', 'big', B()], ['discount_total', 'big', B()],
      ['service_charge', 'big', B()], ['vatable', 'big', B()], ['vat', 'big', B()], ['exempt', 'big', B()], ['rounding', 'big', B()], ['total', 'big', B()],
      ['cost_total', 'big', B()], ['paid', 'big', B()], ['change_amount', 'big', B()], ['points_earned', 'big', B()], ['points_redeemed', 'big', B()],
      ['promotions', 'text'], ['tax_invoice', 'text', N], ['pricing', 'text'], ['note', 'text'], ['biz_date', 'date'], ['hour', 'int'],
      ['created_at', 'ts'], ['voided_at', 'ts', N], ['voided_by', 'ref', N], ['void_reason', 'text', N],
    ],
    indexes: [
      { cols: ['doc_no'], unique: true },
      { cols: ['biz_date'] },
      { cols: ['created_at'] },
      { cols: ['customer_id'] },
      { cols: ['shift_id'] },
      { cols: ['branch_id', 'biz_date'] },
    ],
  },
  {
    name: 'sale_lines',
    cols: [
      ['id', 'id', PK], ['sale_id', 'ref'], ['product_id', 'ref'], ['variant_id', 'ref', N], ['category_id', 'ref', N], ['name', 'str'],
      ['sku', 'short'], ['qty', 'real'], ['base_qty', 'real'], ['unit_price', 'big'], ['unit_cost', 'big', B()], ['gross', 'big'], ['line_discount', 'big', B()],
      ['promo_discount', 'big', B()], ['bill_discount', 'big', B()], ['net', 'big'], ['vat', 'big', B()], ['taxable', 'bool', B(1)],
      ['modifiers', 'text'], ['note', 'text'], ['refunded_qty', 'real', B()],
    ],
    indexes: [{ cols: ['sale_id'] }, { cols: ['product_id'] }],
  },
  {
    name: 'sale_payments',
    cols: [
      ['id', 'id', PK], ['sale_id', 'ref'], ['method_code', 'short'], ['method_name', 'str'], ['kind', 'short'], ['amount', 'big'],
      ['ref', 'str'], ['shift_id', 'ref', N], ['biz_date', 'date'], ['created_at', 'ts'],
    ],
    indexes: [{ cols: ['sale_id'] }, { cols: ['shift_id'] }],
  },
  { name: 'sequences', cols: [['id', 'str', PK], ['value', 'big', B()]] },
  { name: 'held_bills', cols: [['id', 'id', PK], ['branch_id', 'ref'], ['user_id', 'ref'], ['name', 'str'], ['data', 'text'], ['created_at', 'ts']] },
  { name: 'zones', cols: [['id', 'id', PK], ['branch_id', 'ref'], ['name', 'str'], ['sort', 'int', B()]] },
  { name: 'tables', cols: [['id', 'id', PK], ['branch_id', 'ref'], ['zone_id', 'ref', N], ['name', 'short'], ['seats', 'int', B(4)], ['sort', 'int', B()]] },
  {
    name: 'orders',
    cols: [
      ['id', 'id', PK], ['branch_id', 'ref'], ['table_id', 'ref', N], ['name', 'str'], ['status', 'short'], ['guests', 'int', B()],
      ['opened_by', 'ref'], ['opened_at', 'ts'], ['closed_at', 'ts', N], ['sale_id', 'ref', N], ['bill_requested', 'bool', B()], ['note', 'text'],
    ],
    indexes: [{ cols: ['status'] }, { cols: ['table_id'] }],
  },
  {
    name: 'order_items',
    cols: [
      ['id', 'id', PK], ['order_id', 'ref'], ['round_no', 'int', B(1)], ['product_id', 'ref'], ['variant_id', 'ref', N], ['name', 'str'],
      ['qty', 'real'], ['unit_price', 'big'], ['modifiers', 'text'], ['note', 'text'], ['status', 'short'], ['station', 'short'],
      ['source', 'short'], ['created_by', 'ref'], ['created_at', 'ts'], ['sent_at', 'ts', N], ['ready_at', 'ts', N],
    ],
    indexes: [{ cols: ['order_id'] }, { cols: ['status'] }],
  },
  {
    name: 'printers',
    cols: [
      ['id', 'id', PK], ['branch_id', 'ref'], ['name', 'str'], ['kind', 'short'], ['address', 'str'], ['port', 'int', B(9100)],
      ['paper', 'short'], ['role', 'short'], ['category_ids', 'text'], ['text_mode', 'short'], ['open_drawer', 'bool', B()],
      ['active', 'bool', B(1)], ['online', 'bool', B()], ['last_error', 'text'],
    ],
  },
  {
    name: 'print_jobs',
    cols: [
      ['id', 'id', PK], ['printer_id', 'ref'], ['kind', 'short'], ['title', 'str'], ['payload', 'text'], ['status', 'short'],
      ['attempts', 'int', B()], ['error', 'text'], ['created_at', 'ts'], ['printed_at', 'ts', N],
    ],
    indexes: [{ cols: ['status'] }, { cols: ['printer_id'] }],
  },
  {
    name: 'notifications',
    cols: [
      ['id', 'id', PK], ['branch_id', 'ref'], ['user_id', 'ref', N], ['type', 'short'], ['title', 'str'], ['body', 'text'],
      ['ref_id', 'short'], ['created_at', 'ts'], ['read_at', 'ts', N],
    ],
    indexes: [{ cols: ['created_at'] }],
  },
  {
    name: 'audit_logs',
    cols: [
      ['id', 'id', PK], ['user_id', 'ref', N], ['user_name', 'str'], ['action', 'short'], ['entity', 'short'], ['entity_id', 'short'],
      ['detail', 'text'], ['ip', 'short'], ['created_at', 'ts'],
    ],
    indexes: [{ cols: ['created_at'] }, { cols: ['action'] }],
  },
  { name: 'idempotency', cols: [['id', 'str', PK], ['response', 'text'], ['created_at', 'ts']] },
];

export function migrationProvider(dialect: Dialect): MigrationProvider {
  const migrations: Record<string, Migration> = {
    '0001_initial': {
      async up(db) {
        for (const t of TABLES_V1) await createTable(db, dialect, t);
      },
      async down(db) {
        for (const t of [...TABLES_V1].reverse()) await db.schema.dropTable(t.name).ifExists().execute();
      },
    },
    '0002_sync': {
      // Change capture for cloud sync: triggers (installed only when a cloud target is set) append
      // the touched row id here; the sync agent drains it in seq order.
      async up(db) {
        await db.schema
          .createTable('sync_outbox')
          .ifNotExists()
          .addColumn('seq', dialect === 'postgres' ? 'bigserial' : dialect === 'mysql' ? 'bigint' : 'integer', (c) => (dialect === 'postgres' ? c.primaryKey() : c.primaryKey().autoIncrement()))
          .addColumn('tbl', sql`varchar(64)`, (c) => c.notNull())
          .addColumn('row_id', sql`varchar(64)`, (c) => c.notNull())
          .execute();
        await createTable(db, dialect, { name: 'sync_state', cols: [['k', 'short', PK], ['v', 'text']] });
      },
      async down(db) {
        await db.schema.dropTable('sync_outbox').ifExists().execute();
        await db.schema.dropTable('sync_state').ifExists().execute();
      },
    },
  };
  return { getMigrations: async () => migrations };
}

export const TABLE_NAMES = TABLES_V1.map((t) => t.name);

export type ColumnKind = ColType;
/** Column names and kinds per table, used to validate replicated rows. */
export const TABLE_COLUMNS: Record<string, { name: string; kind: ColumnKind; nullable: boolean; default?: number }[]> = Object.fromEntries(
  TABLES_V1.map((t) => [t.name, t.cols.map(([name, kind, opts = {}]) => ({ name, kind, nullable: !!opts.null, ...(opts.default !== undefined ? { default: opts.default } : {}) }))]),
);

