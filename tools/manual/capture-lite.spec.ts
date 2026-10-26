import { test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Screenshots for the FlexPOS Lite guide (delivery/lite/images). Build and run with FLEXPOS_EDITION=lite.
const out = process.env.SHOT_DIR ?? fileURLToPath(new URL('../../delivery/lite/images/', import.meta.url));
mkdirSync(out, { recursive: true });

async function settle(page: Page, ms = 700) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(ms);
}
async function shot(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: join(out, `${name}.png`) });
}
async function go(page: Page, path: string, name: string) {
  await page.goto(path);
  await shot(page, name);
}
const next = (page: Page) => page.getByRole('button', { name: 'ถัดไป' }).click();
async function scan(page: Page, code: string) {
  await page.getByLabel('ค้นหาสินค้า').fill(code);
  await page.getByLabel('ค้นหาสินค้า').press('Enter');
  await settle(page, 300);
}

test('capture FlexPOS Lite screenshots', async ({ page }) => {
  // ---- Setup wizard ----
  await page.goto('/');
  await shot(page, '01-setup-language');
  await next(page);
  await shot(page, '02-setup-database');
  await next(page);
  await page.getByLabel('ชื่อร้าน').fill('ร้านชำป้าแดง');
  await page.getByLabel('เบอร์โทร').fill('081-234-5678');
  await page.getByLabel('ที่อยู่', { exact: true }).fill('12 หมู่ 3 ตำบลบ้านใหม่ อำเภอเมือง จังหวัดราชบุรี 70000');
  await page.getByLabel('หมายเลข PromptPay').fill('0812345678');
  await shot(page, '03-setup-store');
  await next(page);
  await shot(page, '04-setup-business');
  await next(page);
  await shot(page, '05-setup-tax');
  await next(page);
  await page.getByLabel('ชื่อที่แสดง').fill('ป้าแดง');
  await page.getByLabel('ชื่อผู้ใช้').fill('owner');
  await page.getByLabel(/^รหัสผ่าน/).fill('password123');
  await page.getByLabel('ยืนยันรหัสผ่าน').fill('password123');
  await page.getByLabel(/PIN/).fill('2580');
  await shot(page, '06-setup-owner');
  await next(page);
  await page.getByRole('button', { name: /เก็บในเครื่องนี้อย่างเดียว/ }).click();
  await page.getByText('ฉันเข้าใจ และต้องการเก็บข้อมูลในเครื่องนี้อย่างเดียว').click();
  await shot(page, '07-setup-cloud');
  await next(page);
  await shot(page, '08-setup-sample');
  await page.getByRole('button', { name: 'เริ่มใช้งาน' }).click();

  // ---- Shift ----
  await page.getByText('เปิดกะก่อนเริ่มขาย').waitFor({ timeout: 30_000 });
  await page.getByLabel('เงินทอนเริ่มต้น').fill('1000');
  await shot(page, '09-open-shift');
  await page.getByRole('button', { name: 'เปิดกะ', exact: true }).click();

  // ---- Scan-first checkout ----
  await shot(page, '10-pos-ready');
  await scan(page, '8850999320014');
  await scan(page, '3*8851959132012');
  await scan(page, '8851234567953');
  await scan(page, '2100123015009'); // label-scale code: minced pork, 1.500 kg
  await shot(page, '11-pos-cart');
  await page.getByRole('button', { name: 'เลือกสินค้า' }).click();
  await shot(page, '12-pos-browse');
  await page.getByRole('button', { name: /กล้วยหอม/ }).first().click();
  await shot(page, '13-pos-weigh');
  await page.getByRole('button', { name: /^0\.5/ }).first().click();
  await page.getByRole('button', { name: /เพิ่มลงบิล/ }).click();
  await settle(page, 400);
  await page.keyboard.press('F12');
  await page.getByLabel('จำนวนเงินที่รับ').fill('1000');
  await shot(page, '14-pay-cash');
  await page.getByRole('button', { name: 'PromptPay QR' }).click();
  await shot(page, '15-pay-promptpay');
  await page.getByRole('button', { name: 'เงินสด', exact: true }).click();
  await page.getByLabel('จำนวนเงินที่รับ').fill('1000');
  const printBox = page.getByLabel(/พิมพ์ใบเสร็จ/);
  if (await printBox.isChecked().catch(() => false)) await printBox.uncheck();
  await page.getByRole('button', { name: 'ยืนยันการชำระ' }).click();
  await page.getByText('ชำระเงินเรียบร้อย').waitFor();
  await shot(page, '16-pay-done');
  await page.keyboard.press('Enter');

  // ---- Back office ----
  await go(page, '/products', '17-products');
  await go(page, '/products/new?barcode=8859999999999', '18-product-new');
  await go(page, '/stock', '19-stock');
  await go(page, '/customers', '20-customers');
  await go(page, '/sales', '21-sales');
  await go(page, '/dashboard', '22-dashboard');
  await go(page, '/reports', '23-reports');
  await go(page, '/shift', '24-shift');
  await go(page, '/settings/pos', '25-settings-pos');
  await page.getByText('บาร์โค้ดจากตาชั่ง').scrollIntoViewIfNeeded();
  await shot(page, '26-settings-scale');
  await go(page, '/settings/printers', '27-settings-printers');
  await go(page, '/settings/staff', '28-settings-staff');
  await go(page, '/settings/backup', '29-settings-backup');
  await go(page, '/settings/license', '30-settings-license');
});
