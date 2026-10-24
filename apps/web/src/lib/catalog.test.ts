import { describe, expect, it, vi } from 'vitest';
import type { Catalog, CatalogProduct } from '@flexpos/shared';

vi.mock('./offline', () => ({ cacheCatalog: vi.fn(), cachedCatalog: vi.fn() }));
const { buildIndex } = await import('./catalog');

function bigCatalog(n: number): Catalog {
  const products: CatalogProduct[] = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, sku: `SKU${i}`, name: `สินค้าทดสอบ ${i} ${i % 7 === 0 ? 'กาแฟ' : 'ขนม'}`, categoryId: `c${i % 20}`, kind: 'standard', unit: 'ชิ้น', price: 1000 + i,
    taxable: true, color: '', image: '', barcodes: [String(8850000000000 + i)], variants: [], units: [], modifierGroupIds: [], tierPrices: {}, stock: null, trackStock: false, lowStock: 0, posFields: {}, sort: i, showInPos: true,
  }));
  return { products, categories: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, name: `หมวด ${i}`, parentId: null, color: '', sort: i })), modifierGroups: [], paymentMethods: [], version: '1' };
}

describe('catalog index performance (50,000 products)', () => {
  const idx = buildIndex(bigCatalog(50_000));
  it('searches by name in under 200ms', () => {
    const t = performance.now();
    const r = idx.search('กาแฟ 4999');
    const ms = performance.now() - t;
    expect(r.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(200);
  });
  it('finds a barcode instantly and puts it first', () => {
    const t = performance.now();
    const hit = idx.byCode.get('8850000049999');
    expect(performance.now() - t).toBeLessThan(5);
    expect(hit?.product.id).toBe('p49999');
    expect(idx.search('8850000049999')[0]?.id).toBe('p49999');
  });
  it('filters by category', () => {
    expect(idx.search('', 'c3', 100000).every((p) => p.categoryId === 'c3')).toBe(true);
  });
});
