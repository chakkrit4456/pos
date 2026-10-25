import { describe, expect, it } from 'vitest';
import { BANKS, buildBillDoc, crc16ccitt, DEFAULT_SETTINGS, mergeSettings, promptPayAccount, promptPayPayload } from '../src/index.js';

const settings = mergeSettings(DEFAULT_SETTINGS, {
  store: { name: 'ร้านทดสอบ', promptPayId: '0811111111' },
  payments: {
    accounts: [
      { id: 'x', bankCode: 'KBANK', accountName: 'ร้าน', accountNumber: '1234567890', promptPayId: '', isDefault: true },
      { id: 'y', bankCode: 'TMW', accountName: 'วอลเล็ต', promptPayId: '140000000000001' },
    ],
  },
});

describe('bank accounts', () => {
  it('lists all major Thai banks plus foreign', () => {
    for (const c of ['KBANK', 'SCB', 'BBL', 'KTB', 'BAY', 'TTB', 'GSB', 'OTHER']) expect(BANKS.some((b) => b.code === c)).toBe(true);
  });
  it('picks an account that actually has PromptPay', () => {
    expect(promptPayAccount(settings)?.account?.id).toBe('y');
    expect(promptPayAccount(mergeSettings(DEFAULT_SETTINGS, { store: { promptPayId: '0811111111' } }))?.promptPayId).toBe('0811111111');
    expect(promptPayAccount(DEFAULT_SETTINGS)).toBeNull();
  });
  it('builds e-wallet PromptPay payloads', () => {
    const p = promptPayPayload('140000000000001', 5000);
    expect(p).toContain('0315140000000000001');
    expect(crc16ccitt(p.slice(0, -4))).toBe(p.slice(-4));
  });
});

describe('bill slip', () => {
  it('contains items, total, exact-amount QR and transfer details', () => {
    const qr = promptPayPayload('0811111111', 13000);
    const doc = buildBillDoc(
      { title: 'โต๊ะ A1', orderNo: 'AB12', guests: 2, openedAt: new Date().toISOString(), lines: [{ qty: 2, name: 'บราวนี่', total: 13000, modifiers: [] }], subtotal: 13000, discount: 0, promotions: [], serviceCharge: 0, serviceChargeRate: 0, vat: 850, vatRate: 7, vatEnabled: true, pricesIncludeVat: true, total: 13000 },
      settings,
      { qrPayload: qr, accounts: [{ bankName: 'กสิกรไทย', accountName: 'ร้าน', accountNumber: '1234567890', branch: '', swift: 'KASITHBK', iban: '', promptPayId: '' }] },
    );
    const text = JSON.stringify(doc.blocks);
    expect(text).toContain('บราวนี่');
    expect(text).toContain('130.00');
    expect(doc.blocks.some((b) => b.t === 'qr' && b.data === qr)).toBe(true);
    expect(text).toContain('KASITHBK');
    expect(text).toContain('ไม่ใช่ใบเสร็จ');
  });
});
