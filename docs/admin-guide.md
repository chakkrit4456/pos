# คู่มือผู้ดูแลระบบ / ผู้จำหน่าย

## License
- เครื่องใหม่ได้ **ทดลองใช้ 14 วัน** (3 เครื่อง, 1 สาขา) หมดแล้วจะบันทึกการขายไม่ได้ แต่ดูข้อมูลและใส่ key ได้
- License key = payload ที่ลงลายเซ็น **Ed25519** ตรวจสอบในเครื่องได้โดยไม่ต้องออนไลน์ ผูกกับ Machine ID (หรือ `*` = ใช้ได้ทุกเครื่อง)
- ออก key (ผู้จำหน่ายเท่านั้น):
  ```bash
  node tools/license/issue.mjs --licensee "ร้านใบชา" --machine 8396-034B-E046-ED8E --plan pro --devices 5 --branches 3 --days 365
  ```
  ลูกค้าดู Machine ID และใส่ key ได้ที่ ตั้งค่า → License
- **กุญแจส่วนตัว** อยู่ที่ `.license-keys/private.pem` (ไม่อยู่ใน git) — สำรองเก็บไว้ที่ปลอดภัย ถ้าหายจะออก key ใหม่ไม่ได้ ถ้าหลุดต้องสร้างคู่กุญแจใหม่และปล่อยเวอร์ชันใหม่ (กุญแจสาธารณะอยู่ใน `apps/server/src/services/license.ts`)
- เปลี่ยนวิธีการ License ได้โดยแก้โมดูล `apps/server/src/services/license.ts` อย่างเดียว

## สำรองและกู้คืน
- สำรองอัตโนมัติทุก 24 ชม. (ปรับได้) เก็บ 14 ไฟล์ล่าสุด เป็นไฟล์ `.json.gz` ที่ใช้ได้กับทุกฐานข้อมูล
- ก่อนกู้คืนทุกครั้ง ระบบสำรองข้อมูลปัจจุบันเป็น `flexpos-pre-restore-*` ให้อัตโนมัติ
- แนะนำตั้งโฟลเดอร์สำรองไปไดรฟ์อื่น/โฟลเดอร์ที่ซิงก์ OneDrive/Google Drive

## ความปลอดภัย
- รหัสผ่าน argon2id, PIN เป็น HMAC ด้วย secret ของร้าน + จำกัดจำนวนครั้ง (10 ครั้ง/นาที)
- JWT อายุ 2 ชม. + refresh token หมุนเวียน 30 วัน, ปิดผู้ใช้/เปลี่ยนรหัสจะเพิกถอน session ทันที
- ราคา ส่วนลด ภาษี คำนวณซ้ำที่เซิร์ฟเวอร์ทุกบิล (ไม่เชื่อราคาจากหน้าจอ) การแก้ราคา/ส่วนลด/ยกเลิก/คืนสินค้าถูกบันทึก audit log
- ทุกการบันทึกบิล (บิล รายการ การชำระ สต็อก แต้ม เครดิต) อยู่ใน transaction เดียว และ idempotent ด้วย UUID ของบิล

## ทดสอบกับ PostgreSQL / MySQL
```bash
docker run -d --name flexpos-pg -e POSTGRES_PASSWORD=flexpos -e POSTGRES_USER=flexpos -e POSTGRES_DB=flexpos -p 54329:5432 postgres:16-alpine
docker run -d --name flexpos-mysql -e MYSQL_ROOT_PASSWORD=flexpos -e MYSQL_DATABASE=flexpos -e MYSQL_USER=flexpos -e MYSQL_PASSWORD=flexpos -p 33069:3306 mysql:8.4
TEST_PG=1 TEST_MYSQL=1 pnpm test
```

## ข้อจำกัดที่ทราบ
- ยืนยันยอด PromptPay อัตโนมัติไม่ได้ (ต้องใช้บริการ API ของธนาคาร) แคชเชียร์ตรวจยอดเข้าเองแล้วกดยืนยัน
- ไฟล์ติดตั้ง Windows ยังไม่ได้ลงลายเซ็นดิจิทัล (ต้องซื้อ Code Signing Certificate แล้วตั้งค่าใน electron-builder)
- โหมดข้อความภาษาไทยของเครื่องพิมพ์ใช้ code page 874 (`ESC t 70`) ซึ่งต่างกันตามรุ่น หากพิมพ์เพี้ยนให้ใช้โหมดภาพ
