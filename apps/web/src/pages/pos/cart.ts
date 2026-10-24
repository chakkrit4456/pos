import { useSyncExternalStore } from 'react';
import type { CatalogProduct, Discount } from '@flexpos/shared';
import { uuid } from '@/lib/utils';

export interface CartModifier {
  id: string;
  name: string;
  priceDelta: number;
}

export interface CartLineState {
  id: string;
  productId: string;
  variantId: string | null;
  unitId: string | null;
  name: string;
  sku: string;
  qty: number;
  /** unit price incl. modifiers (or the overridden price) */
  unitPrice: number;
  priceOverridden: boolean;
  modifiers: CartModifier[];
  note: string;
  discount: Discount | null;
  categoryId: string | null;
  taxable: boolean;
  kind: CatalogProduct['kind'];
}

export interface CartCustomer {
  id: string;
  name: string;
  phone: string;
  points: number;
  groupPercent: number;
  groupId: string | null;
  priceTierId: string | null;
  creditBalance: number;
  creditLimit: number;
  taxId: string;
  taxName: string;
  taxBranch: string;
  address: string;
}

export interface SentItem {
  id: string;
  round: number;
  productId: string;
  variantId: string | null;
  name: string;
  qty: number;
  unitPrice: number;
  modifiers: CartModifier[];
  note: string;
  status: string;
  by: string | null;
  createdAt: string;
}

export interface CartOrder {
  id: string;
  name: string;
  tableId: string | null;
  items: SentItem[];
}

export interface CartState {
  saleId: string;
  lines: CartLineState[];
  billDiscount: Discount | null;
  customer: CartCustomer | null;
  couponCodes: string[];
  pointsRedeemed: number;
  order: CartOrder | null;
  heldId: string | null;
  heldName: string;
  note: string;
  managerPin: string | null;
}

const empty = (): CartState => ({
  saleId: uuid(),
  lines: [],
  billDiscount: null,
  customer: null,
  couponCodes: [],
  pointsRedeemed: 0,
  order: null,
  heldId: null,
  heldName: '',
  note: '',
  managerPin: null,
});

const KEY = 'flexpos.cart';
function load(): CartState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty(), ...(JSON.parse(raw) as CartState), managerPin: null };
  } catch {
    /* ignore */
  }
  return empty();
}

let state = load();
const subs = new Set<() => void>();
function set(next: CartState) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...next, managerPin: null }));
  } catch {
    /* storage full / disabled */
  }
  subs.forEach((s) => s());
}

const sameLine = (a: CartLineState, b: Omit<CartLineState, 'id' | 'qty'>) =>
  a.productId === b.productId &&
  a.variantId === b.variantId &&
  a.unitId === b.unitId &&
  !a.priceOverridden &&
  !a.note &&
  !a.discount &&
  a.kind !== 'weighted' &&
  a.kind !== 'open_price' &&
  a.modifiers.map((m) => m.id).sort().join() === b.modifiers.map((m) => m.id).sort().join();

export const cart = {
  get: () => state,
  subscribe(fn: () => void) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  add(line: Omit<CartLineState, 'id' | 'qty'> & { qty?: number }) {
    const qty = line.qty ?? 1;
    const existing = state.lines.find((l) => sameLine(l, line));
    if (existing) {
      set({ ...state, lines: state.lines.map((l) => (l === existing ? { ...l, qty: l.qty + qty } : l)) });
      return existing.id;
    }
    const id = uuid();
    set({ ...state, lines: [...state.lines, { ...line, id, qty }] });
    return id;
  },
  setQty(id: string, qty: number) {
    if (qty <= 0) return cart.remove(id);
    set({ ...state, lines: state.lines.map((l) => (l.id === id ? { ...l, qty } : l)) });
  },
  inc(id: string, d: number) {
    const l = state.lines.find((x) => x.id === id);
    if (l) cart.setQty(id, Math.round((l.qty + d) * 1000) / 1000);
  },
  update(id: string, patch: Partial<CartLineState>) {
    set({ ...state, lines: state.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  },
  remove(id: string) {
    set({ ...state, lines: state.lines.filter((l) => l.id !== id) });
  },
  patch(p: Partial<CartState>) {
    set({ ...state, ...p });
  },
  clear() {
    set(empty());
  },
  /** Replace with a held/recalled bill. */
  replace(s: Partial<CartState>) {
    set({ ...empty(), ...s });
  },
};

export function useCart(): CartState {
  return useSyncExternalStore(cart.subscribe, cart.get, cart.get);
}
