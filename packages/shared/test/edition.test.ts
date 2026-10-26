import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, ean13CheckDigit, editionAllows, licenseFitsEdition, lockModules, parseScaleBarcode, type CatalogProduct } from '../src/index.js';

const product = (o: Partial<CatalogProduct>): CatalogProduct => ({
  id: 'p',
  sku: '',
  name: 'x',
  categoryId: null,
  kind: 'standard',
  unit: 'kg',
  price: 16000,
  taxable: true,
  color: '',
  image: '',
  barcodes: [],
  variants: [],
  units: [],
  modifierGroupIds: [],
  tierPrices: {},
  stock: null,
  trackStock: false,
  lowStock: 0,
  posFields: {},
  sort: 0,
  showInPos: true,
  ...o,
});

describe('editions', () => {
  it('full edition keeps everything', () => {
    expect(editionAllows('restaurant', 'full')).toBe(true);
    expect(lockModules({ restaurant: true, stock: true }, 'full')).toEqual({ restaurant: true, stock: true });
  });
  it('lite locks restaurant, kitchen, promotions, devices', () => {
    for (const f of ['restaurant', 'modifiers', 'customFields', 'customRoles', 'lanClient', 'promotions'] as const) expect(editionAllows(f, 'lite')).toBe(false);
    expect(lockModules({ restaurant: true, kitchenDisplay: true, promotions: true, stock: true }, 'lite')).toEqual({ restaurant: false, kitchenDisplay: false, promotions: false, stock: true });
  });
  it('lite keys are one-machine and never unlock the full edition', () => {
    expect(licenseFitsEdition({ plan: 'lite', machineId: 'AAAA-BBBB' }, 'lite')).toBe(true);
    expect(licenseFitsEdition({ plan: 'lite', machineId: '*' }, 'lite')).toBe(false);
    expect(licenseFitsEdition({ plan: 'lite', machineId: '*', licenseId: 'cloud' }, 'lite')).toBe(true);
    expect(licenseFitsEdition({ plan: 'pro', machineId: 'AAAA-BBBB' }, 'lite')).toBe(false);
    expect(licenseFitsEdition({ plan: 'lite', machineId: 'AAAA-BBBB' }, 'full')).toBe(false);
    expect(licenseFitsEdition({ plan: 'pro', machineId: '*' }, 'full')).toBe(true);
  });
});

describe('scale barcodes', () => {
  const cfg = DEFAULT_SETTINGS.pos.scaleBarcode;
  const pork = product({ sku: '00123', kind: 'weighted' });
  it('computes EAN-13 check digits', () => {
    expect(ean13CheckDigit('885099932001')).toBe(4);
    expect(ean13CheckDigit('210012301500')).toBe(9);
  });
  it('reads weight-embedded codes', () => {
    expect(parseScaleBarcode([pork], '2100123015009', cfg)).toEqual({ product: pork, qty: 1.5 });
  });
  it('reads price-embedded codes', () => {
    // 240.00 baht of 160 baht/kg pork = 1.5 kg
    const code = `210012324000`;
    expect(parseScaleBarcode([pork], code + ean13CheckDigit(code), { ...cfg, value: 'price' })?.qty).toBe(1.5);
  });
  it('leaves in-store prefix-20 codes alone', () => {
    expect(parseScaleBarcode([pork], '2000123015002', cfg)).toBeNull();
  });
  it('ignores ordinary barcodes, bad check digits and non-weighted items', () => {
    expect(parseScaleBarcode([pork], '8850999320014', cfg)).toBeNull();
    expect(parseScaleBarcode([pork], '2100123015003', cfg)).toBeNull();
    expect(parseScaleBarcode([product({ sku: '00123' })], '2100123015009', cfg)).toBeNull();
    expect(parseScaleBarcode([pork], '2100123015009', { ...cfg, enabled: false })).toBeNull();
  });
});
