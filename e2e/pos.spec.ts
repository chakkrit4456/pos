import { expect, test, type Page } from '@playwright/test';

async function pin(page: Page, code: string) {
  for (const d of code) await page.getByRole('button', { name: d, exact: true }).click();
}

test('setup → sell → pay cash → refund → close shift → dashboard', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  // Store setup through the API the wizard uses (the wizard UI itself is covered by manual QA).
  await request.post('/api/setup/db', { data: { kind: 'sqlite' } });
  const setup = await request.post('/api/setup/complete', {
    data: {
      language: 'th',
      store: { name: 'ร้านทดสอบ E2E', branchName: 'สาขาหลัก', address: '', taxId: '', phone: '', logo: '', promptPayId: '0812345678' },
      businessType: 'retail',
      tax: { vatEnabled: true, vatRate: 7, pricesIncludeVat: true, serviceChargeRate: 0 },
      owner: { name: 'เจ้าของ', username: 'owner', password: 'password123', pin: '2580' },
      sampleData: true,
    },
  });
  expect(setup.ok()).toBeTruthy();

  await page.goto('/');
  await expect(page.getByText('ใส่ PIN พนักงาน')).toBeVisible();
  await pin(page, '2580');

  await expect(page.getByText('เปิดกะก่อนเริ่มขาย')).toBeVisible();
  await page.getByLabel('เงินทอนเริ่มต้น').fill('1000');
  await page.getByRole('button', { name: 'เปิดกะ' }).click();

  // Tap a product and scan another by barcode (keyboard wedge).
  await page.getByRole('button', { name: /มันฝรั่งทอด/ }).click();
  await page.locator('body').click({ position: { x: 600, y: 760 } });
  await page.keyboard.type('8850999320014\n', { delay: 5 });
  const cart = page.locator('aside');
  await expect(cart.getByText('น้ำดื่ม 600 มล.')).toBeVisible();
  await expect(cart.getByText('฿27.00').last()).toBeVisible();

  await page.keyboard.press('F12');
  await page.getByLabel('จำนวนเงินที่รับ').fill('100');
  await expect(page.getByText('฿73.00')).toBeVisible();
  await page.getByRole('button', { name: 'ยืนยันการชำระ' }).click();
  await expect(page.getByText('ชำระเงินเรียบร้อย')).toBeVisible();
  await page.keyboard.press('Enter');

  // Refund one item from the bill history.
  await page.getByRole('link', { name: 'บิล' }).click();
  await page.getByText(/R01\d{4}-00001/).first().click();
  await page.getByRole('button', { name: 'คืนสินค้า' }).click();
  await page.getByLabel('จำนวนคืน น้ำดื่ม 600 มล.').selectOption('1');
  await page.getByLabel('เหตุผล').fill('ทดสอบคืนสินค้า');
  await page.getByRole('button', { name: 'ยืนยันคืนสินค้า' }).click();
  await expect(page.getByText(/ใบคืนสินค้า CN/)).toBeVisible();
  await page.keyboard.press('Escape');

  // Close the shift: expected cash = 1000 + 27 - 7 = 1020
  await page.getByRole('link', { name: 'กะ' }).click();
  await expect(page.getByText('฿1,020.00').first()).toBeVisible();
  await page.getByRole('button', { name: 'ปิดกะ' }).click();
  await page.getByLabel('นับได้รวม').fill('1020');
  await page.getByRole('button', { name: 'ยืนยันปิดกะ' }).click();
  await expect(page.getByRole('heading', { name: 'ปิดกะแล้ว' })).toBeVisible();
  await page.getByRole('button', { name: 'ยกเลิก' }).click();

  await page.getByRole('link', { name: 'ภาพรวม' }).click();
  await expect(page.getByText('ยอดขายสุทธิ')).toBeVisible();
  await expect(page.getByText('฿20.00').first()).toBeVisible();

  expect(errors.filter((e) => !e.includes('favicon'))).toEqual([]);
});

test('order app shows tables on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/order');
  await pin(page, '2580');
  await expect(page.getByText('ออเดอร์ของฉัน').or(page.getByRole('button', { name: 'โต๊ะ' }))).toBeVisible();
});
