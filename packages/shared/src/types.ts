import type { Permission } from './permissions.js';
import type { PaymentKind } from './settings.js';
import type { ProductKind } from './schemas.js';

export interface SessionUser {
  id: string;
  name: string;
  username: string;
  roleId: string;
  roleName: string;
  permissions: Permission[];
  branchId: string | null;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}

export interface SetupStatus {
  configured: boolean;
  dbKind: 'sqlite' | 'postgres' | 'mysql' | null;
  hasOwner: boolean;
  mode: 'host' | 'client';
  hostUrl: string | null;
  version: string;
  license: LicenseStatus;
  /** public branding for the login screen */
  brand: PublicBrand;
  /** UI language of the store */
  language: 'th' | 'en';
}

export interface PublicBrand {
  appName: string;
  appLogo: string;
  primary: string;
  accent: string;
  sidebar: string;
  loginTitle: string;
  loginSubtitle: string;
  storeName: string;
}

export interface LicenseStatus {
  state: 'trial' | 'active' | 'expired' | 'invalid';
  plan: string;
  maxDevices: number;
  maxBranches: number;
  daysLeft: number | null;
  licensee: string | null;
  machineId: string;
}

export interface CatalogModifier {
  id: string;
  name: string;
  priceDelta: number;
}

export interface CatalogModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: CatalogModifier[];
}

export interface CatalogVariant {
  id: string;
  name: string;
  sku: string;
  price: number;
  barcodes: string[];
  stock: number | null;
}

export interface CatalogUnit {
  id: string;
  name: string;
  factor: number;
  price: number;
  barcodes: string[];
}

/** Compact product shape that the POS keeps in memory for instant search. */
export interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  categoryId: string | null;
  kind: ProductKind;
  unit: string;
  price: number;
  taxable: boolean;
  color: string;
  image: string;
  barcodes: string[];
  variants: CatalogVariant[];
  units: CatalogUnit[];
  modifierGroupIds: string[];
  tierPrices: Record<string, number>;
  stock: number | null;
  trackStock: boolean;
  lowStock: number;
  posFields: Record<string, string>;
  sort: number;
  /** false = sellable by barcode/search but hidden from the product grid */
  showInPos: boolean;
}

export interface CatalogCategory {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  sort: number;
}

export interface PaymentMethodView {
  id: string;
  code: string;
  name: string;
  kind: PaymentKind;
  active: boolean;
  sort: number;
}

export interface Catalog {
  products: CatalogProduct[];
  categories: CatalogCategory[];
  modifierGroups: CatalogModifierGroup[];
  paymentMethods: PaymentMethodView[];
  version: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}

export type WsEvent =
  | { type: 'orders.changed'; tableId: string | null; orderId: string }
  | { type: 'kitchen.changed'; orderId: string }
  | { type: 'catalog.changed' }
  | { type: 'settings.changed' }
  | { type: 'printer.status'; printerId: string; online: boolean; queued: number }
  | { type: 'notification'; id: string; title: string; body: string; userId: string | null }
  | { type: 'display.update'; register: string; payload: CustomerDisplayPayload }
  | { type: 'sale.completed'; saleId: string; branchId: string | null };

export interface CustomerDisplayPayload {
  state: 'idle' | 'cart' | 'pay' | 'done';
  lines: { name: string; qty: number; total: number }[];
  subtotal: number;
  discount: number;
  total: number;
  qr: string | null;
  change: number;
}
