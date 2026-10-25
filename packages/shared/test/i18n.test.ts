import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage, t, tParts, translate, translateDeep } from '../src/index.js';

afterEach(() => setLanguage('th'));

describe('i18n', () => {
  it('returns the Thai key in Thai mode and fills placeholders', () => {
    expect(t('{0} รายการ', 3)).toBe('3 รายการ');
  });

  it('translates to English and keeps surrounding whitespace', () => {
    setLanguage('en');
    expect(t('{0} รายการ', 3)).toBe('3 items');
    expect(translate(' บันทึก ')).toBe(' Save ');
  });

  it('falls back to the key when there is no translation', () => {
    setLanguage('en');
    expect(t('ข้อความที่ไม่มีในพจนานุกรม')).toBe('ข้อความที่ไม่มีในพจนานุกรม');
  });

  it('keeps non-string parts in place', () => {
    setLanguage('en');
    const node = { el: 1 };
    expect(tParts('ลบ {0}?', [node])).toEqual(['Delete ', node, '?']);
  });

  it('translates stored defaults deeply', () => {
    expect(translateDeep({ a: ['เงินสด', 'cash'], b: { c: 'ไม่มี' } }, 'en')).toEqual({ a: ['Cash', 'cash'], b: { c: 'None' } });
  });
});
