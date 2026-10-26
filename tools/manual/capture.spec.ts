import { test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { translate } from '../../packages/shared/src/i18n';

// SHOT_LANG=en captures the English UI (the wizard's language step switches it).
const lang = process.env.SHOT_LANG === 'en' ? 'en' : 'th';
const out = process.env.SHOT_DIR ?? fileURLToPath(new URL('../../docs/manual/images/', import.meta.url));
mkdirSync(out, { recursive: true });

/** UI text in the capture language (Thai source text is the key). */
const L = (th: string) => translate(th, lang);
const rx = (th: string, flags = '') => new RegExp(L(th).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), flags);
const sample =
  lang === 'en'
    ? { store: 'Baicha Café', branch: 'Main branch', address: '99 Sukhumvit Rd, Khlong Toei, Bangkok 10110', owner: 'Napat Jaidee' }
    : { store: 'คาเฟ่ใบชา', branch: 'สาขาหลัก', address: '99 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110', owner: 'นภัส ใจดี' };

async function settle(page: Page, ms = 700) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(ms);
}
async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  await settle(page);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: opts.fullPage ?? false });
}
async function go(page: Page, path: string, name: string) {
  await page.goto(path);
  await shot(page, name);
}
const next = (page: Page) => page.getByRole('button', { name: L('ถัดไป') }).click();

test('capture manual screenshots', async ({ page, browser }) => {
  // ---- Setup wizard (real UI) ----
  await page.goto('/');
  if (lang === 'en') {
    // Picking English reloads the wizard in English
    await page.getByRole('button', { name: /English/ }).click();
    await page.getByRole('button', { name: L('ถัดไป') }).waitFor();
  }
  await shot(page, '01-setup-language');
  await next(page);
  await shot(page, '02-setup-database');
  await next(page);
  await page.getByLabel(L('ชื่อร้าน')).fill(sample.store);
  await page.getByLabel(L('ชื่อสาขา')).fill(sample.branch);
  await page.getByLabel(L('เบอร์โทร')).fill('02-123-4567');
  await page.getByLabel(L('ที่อยู่'), { exact: true }).fill(sample.address);
  await page.getByLabel(L('หมายเลข PromptPay')).fill('0812345678');
  await shot(page, '03-setup-store');
  await next(page);
  await page.getByRole('button', { name: rx('คาเฟ่ / ร้านเครื่องดื่ม') }).click();
  await shot(page, '04-setup-business');
  await next(page);
  await shot(page, '05-setup-tax');
  await next(page);
  await page.getByLabel(L('ชื่อที่แสดง')).fill(sample.owner);
  await page.getByLabel(L('ชื่อผู้ใช้')).fill('owner');
  await page.getByLabel(new RegExp('^' + rx('รหัสผ่าน').source)).fill('password123');
  await page.getByLabel(L('ยืนยันรหัสผ่าน')).fill('password123');
  await page.getByLabel(/PIN/).fill('2580');
  await shot(page, '06-setup-owner');
  await next(page);
  await shot(page, '06b-setup-cloud');
  // Screenshots run offline: keep data on this machine
  await page.getByRole('button', { name: rx('เก็บในเครื่องนี้อย่างเดียว') }).click();
  await page.getByText(L('ฉันเข้าใจ และต้องการเก็บข้อมูลในเครื่องนี้อย่างเดียว')).click();
  await shot(page, '06c-setup-cloud-local');
  await next(page);
  await shot(page, '07-setup-sample');
  await page.getByRole('button', { name: L('เริ่มใช้งาน') }).click();

  // ---- Shift (the wizard signs the owner in) ----
  await page.getByText(L('เปิดกะก่อนเริ่มขาย')).waitFor({ timeout: 30_000 });
  await page.getByLabel(L('เงินทอนเริ่มต้น')).fill('1000');
  await shot(page, '09-open-shift');
  await page.getByRole('button', { name: L('เปิดกะ'), exact: true }).click();

  // ---- POS sale ----
  await shot(page, '10-pos');
  await page.getByRole('button', { name: rx('อเมริกาโน่เย็น') }).click();
  await settle(page, 500);
  const addBtn = page.getByRole('button', { name: rx('เพิ่มลงบิล') });
  if (await addBtn.isVisible().catch(() => false)) {
    await shot(page, '11-pos-options');
    await addBtn.click();
  }
  await page.getByRole('button', { name: rx('บราวนี่') }).click();
  await settle(page, 400);
  if (await addBtn.isVisible().catch(() => false)) await addBtn.click();
  await shot(page, '12-pos-cart');
  await page.keyboard.press('F12');
  await page.getByLabel(L('จำนวนเงินที่รับ')).fill('200');
  await shot(page, '13-pay-cash');
  await page.getByRole('button', { name: 'PromptPay QR' }).click();
  await shot(page, '14-pay-promptpay');
  await page.getByRole('button', { name: L('เงินสด'), exact: true }).click();
  await page.getByLabel(L('จำนวนเงินที่รับ')).fill('200');
  const printBox = page.getByLabel(rx('พิมพ์ใบเสร็จ'));
  if (await printBox.isChecked().catch(() => false)) await printBox.uncheck();
  await page.getByRole('button', { name: L('ยืนยันการชำระ') }).click();
  await page.getByText(L('ชำระเงินเรียบร้อย')).waitFor();
  await shot(page, '15-pay-done');
  await page.keyboard.press('Enter');

  // ---- Tables / orders ----
  await go(page, '/tables', '16-tables');
  await page.getByRole('button', { name: /A1/ }).first().click().catch(() => undefined);
  await settle(page);
  for (const name of [rx('บราวนี่'), rx('น้ำดื่ม'), rx('โซดาเลมอน')]) {
    await page.getByRole('button', { name }).first().click();
    await settle(page, 400);
    const add = page.getByRole('button', { name: rx('เพิ่มลงบิล') });
    if (await add.isVisible().catch(() => false)) await add.click();
  }
  await shot(page, '17-table-open');
  await page.getByRole('button', { name: lang === 'en' ? /Send to kitchen/ : /ส่งครัว/ }).click();
  await settle(page, 1200);
  await go(page, '/orders', '18-orders');
  await page.getByText(/A1/).first().click();
  await shot(page, '19-orders-bill');
  await page.getByRole('button', { name: rx(lang === 'en' ? 'ใบแจ้งยอด + QR PromptPay' : 'ใบแจ้งยอด + QR') }).first().click();
  await settle(page, 1200);
  await shot(page, '20-bill-slip');
  await page.keyboard.press('Escape');
  await go(page, '/kitchen', '21-kitchen');

  // ---- Back office ----
  await go(page, '/dashboard', '22-dashboard');
  await go(page, '/products', '23-products');
  await page.getByRole('button', { name: rx('ลาเต้เย็น') }).first().click().catch(() => undefined);
  await shot(page, '24-product-editor');
  await page.goto('/products');
  await page.getByRole('tab', { name: L('หมวดหมู่') }).click();
  await shot(page, '25-categories');
  await go(page, '/stock', '26-stock');
  await go(page, '/customers', '27-customers');
  await go(page, '/promotions', '28-promotions');
  await go(page, '/sales', '29-sales');
  await go(page, '/reports', '30-reports');
  await go(page, '/shift', '31-shift');

  // ---- Settings ----
  for (const [id, n] of [
    ['store', '32'], ['receipt', '33'], ['tax', '34'], ['banks', '35'], ['payments', '36'], ['pos', '37'], ['modules', '38'],
    ['brand', '39'], ['printers', '40'], ['devices', '41'], ['tables', '42'], ['staff', '43'], ['roles', '44'],
    ['fields', '45'], ['backup', '46'], ['license', '47'], ['audit', '48'],
  ] as const) await go(page, `/settings/${id}`, `${n}-settings-${id}`);

  // ---- Staff order app on a phone ----
  await page.setViewportSize({ width: 390, height: 844 });
  await go(page, '/order', '49-order-app');
  await go(page, '/pos', '50-pos-phone');
  await page.setViewportSize({ width: 1024, height: 768 });
  await go(page, '/pos', '51-pos-tablet');

  // ---- Login screen as a new device sees it (it follows the store language) ----
  const fresh = await browser.newPage({ viewport: { width: 1366, height: 820 }, locale: lang === 'en' ? 'en-US' : 'th-TH' });
  await fresh.goto('/');
  await fresh.getByRole('tab', { name: rx('ชื่อผู้ใช้') }).waitFor().catch(() => undefined);
  await shot(fresh, '08-login-pin');
  await fresh.getByRole('tab', { name: rx('ชื่อผู้ใช้') }).click().catch(() => undefined);
  await shot(fresh, '08b-login-password');
  await fresh.close();
});
