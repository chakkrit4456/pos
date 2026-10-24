import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Catalog, CatalogProduct } from '@flexpos/shared';
import { api, ApiError } from './api';
import { cacheCatalog, cachedCatalog } from './offline';

export interface CatalogIndex {
  catalog: Catalog;
  byId: Map<string, CatalogProduct>;
  /** barcode / sku → hit */
  byCode: Map<string, { product: CatalogProduct; variantId: string | null; unitId: string | null }>;
  search(q: string, categoryId?: string | null, limit?: number): CatalogProduct[];
}

const fold = (s: string) => s.toLowerCase().normalize('NFC');

export function buildIndex(catalog: Catalog): CatalogIndex {
  const byId = new Map<string, CatalogProduct>();
  const byCode = new Map<string, { product: CatalogProduct; variantId: string | null; unitId: string | null }>();
  const hay: string[] = [];
  for (const p of catalog.products) {
    byId.set(p.id, p);
    for (const c of p.barcodes) byCode.set(c, { product: p, variantId: null, unitId: null });
    if (p.sku) byCode.set(fold(p.sku), { product: p, variantId: null, unitId: null });
    for (const v of p.variants) {
      for (const c of v.barcodes) byCode.set(c, { product: p, variantId: v.id, unitId: null });
      if (v.sku) byCode.set(fold(v.sku), { product: p, variantId: v.id, unitId: null });
    }
    for (const u of p.units) for (const c of u.barcodes) byCode.set(c, { product: p, variantId: null, unitId: u.id });
    hay.push(fold(`${p.name} ${p.sku} ${p.variants.map((v) => v.name + ' ' + v.sku).join(' ')}`));
  }
  const products = catalog.products;
  const childrenOf = new Map<string, string[]>();
  for (const c of catalog.categories) if (c.parentId) childrenOf.set(c.parentId, [...(childrenOf.get(c.parentId) ?? []), c.id]);
  const subtree = (id: string): Set<string> => {
    const out = new Set([id]);
    const stack = [id];
    while (stack.length) {
      for (const ch of childrenOf.get(stack.pop()!) ?? []) {
        if (out.has(ch)) continue;
        out.add(ch);
        stack.push(ch);
      }
    }
    return out;
  };
  return {
    catalog,
    byId,
    byCode,
    search(q, categoryId, limit = 400) {
      const term = fold(q.trim());
      const cats = categoryId ? subtree(categoryId) : null;
      const out: CatalogProduct[] = [];
      // An exact barcode/SKU hit goes first, then name/SKU substring matches.
      const exact = term ? (byCode.get(q.trim()) ?? byCode.get(term)) : undefined;
      // Every word must appear somewhere (any order): "ลาเต้ เย็น" finds "ลาเต้เย็น".
      const words = term.split(/\s+/).filter(Boolean);
      if (exact) out.push(exact.product);
      for (let i = 0; i < products.length && out.length < limit; i++) {
        const p = products[i]!;
        if (exact && p.id === exact.product.id) continue;
        if (cats && (!p.categoryId || !cats.has(p.categoryId))) continue;
        if (term ? !words.every((w) => hay[i]!.includes(w)) : !p.showInPos) continue;
        out.push(p);
      }
      return out;
    },
  };
}

/** Catalog for the POS: cached in IndexedDB so the till starts and sells while offline. */
export function useCatalog() {
  const q = useQuery({
    queryKey: ['catalog'],
    queryFn: async () => {
      try {
        const c = await api.get<Catalog>('/api/catalog');
        void cacheCatalog(c);
        return c;
      } catch (e) {
        if (e instanceof ApiError && e.isNetwork) {
          const c = await cachedCatalog();
          if (c) return c;
        }
        throw e;
      }
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const index = useMemo(() => (q.data ? buildIndex(q.data) : null), [q.data]);
  return { ...q, index };
}

/**
 * Detect USB barcode scanners (keyboard wedge): characters arriving faster than a person types,
 * ended by Enter. Works without focusing the search box. Ignored while typing in other inputs.
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let buf = '';
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) && !t.dataset.scanTarget;
      if (inField || e.ctrlKey || e.altKey || e.metaKey) return;
      const now = performance.now();
      if (now - last > 60) buf = '';
      last = now;
      if (e.key === 'Enter') {
        if (buf.length >= 3) {
          e.preventDefault();
          onScan(buf);
        }
        buf = '';
      } else if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onScan, enabled]);
}
