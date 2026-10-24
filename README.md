# FlexPOS

ระบบขายหน้าร้านสำเร็จรูปสำหรับร้านค้าปลีก ร้านอาหาร คาเฟ่ ร้านเสื้อผ้า และร้านบริการในประเทศไทย
A ready-made point-of-sale system for Thai retail shops, restaurants, cafés, fashion stores and service businesses.

## ความสามารถหลัก / Features

- **หน้าขาย** สแกนบาร์โค้ดได้ทันทีโดยไม่ต้องคลิกช่องค้นหา, ตัวเลือก/ท็อปปิ้ง, ไซซ์/สี, สินค้าชั่งน้ำหนัก, ราคาเปิด, หน่วยแพ็ค/ลัง, พักบิล แยกบิล รวมบิล, คีย์ลัด F1–F12, Ctrl+K
- **ชำระเงิน** เงินสดพร้อมเงินทอน, PromptPay QR (EMVCo), โอน, บัตร, แบ่งจ่ายหลายวิธี, ค้างชำระ, ใช้แต้ม — เพิ่ม/ซ่อนวิธีชำระเองได้
- **ภาษี** VAT รวม/แยก, ค่าบริการ, ปัดเศษ, ใบกำกับภาษีอย่างย่อ/เต็มรูป (ออกย้อนหลังได้), รายงานภาษีขาย
- **ใบเสร็จ** ออกแบบเองแบบลากวางพร้อมตัวอย่างสด, 58/80 มม./A4, เครื่องพิมพ์ ESC/POS ผ่าน LAN (พิมพ์ภาษาไทยได้ทุกรุ่นด้วยโหมดภาพ), เครื่องพิมพ์ USB/Bluetooth ผ่าน Windows, เปิดลิ้นชัก
- **สินค้า** หมวดหลายระดับ, ตัวเลือกสินค้า, ตัวเลือกเสริม, ระดับราคา, สินค้าชุด, **ฟิลด์เพิ่มเติมกำหนดเอง**, นำเข้า/ส่งออก Excel/CSV พร้อมตรวจข้อมูลก่อนบันทึก, แก้หลายรายการ, พิมพ์สติกเกอร์บาร์โค้ด
- **สต็อก** รับเข้า ปรับ นับ โอนสาขา, ล็อต/วันหมดอายุ, ประวัติทุกการเคลื่อนไหว, ต้นทุนถัวเฉลี่ย
- **สมาชิก** แต้มสะสม, กลุ่ม/ระดับสมาชิก, ส่วนลดอัตโนมัติ, ยอดค้างชำระ
- **โปรโมชั่น** ลด %/บาท, ซื้อ X แถม Y, ซื้อครบยอด, ราคาพิเศษตามช่วงเวลา, คูปอง, ลำดับความสำคัญ
- **ร้านอาหาร** ผังโต๊ะ ย้าย/รวม/แยกโต๊ะ, ส่งครัวพิมพ์แยกครัว/บาร์, จอครัว (KDS), **แอปรับออเดอร์บนมือถือ** (PWA), จอลูกค้า
- **กะ** เปิด/ปิดกะ นับเงิน นำเงินเข้า/ออก X/Z report
- **รายงาน** Dashboard, ยอดขายตามวัน/ชั่วโมง/สินค้า/หมวด/พนักงาน/วิธีชำระ/สาขา, กำไรขั้นต้น, ส่งออก Excel/CSV/PDF
- **ผู้ใช้** บทบาทและสิทธิ์รายข้อ, PIN สลับพนักงาน, ล็อกหน้าจออัตโนมัติ, อนุมัติด้วย PIN ผู้จัดการ, บันทึกการใช้งาน
- **ข้อมูล** SQLite ในเครื่อง (ออฟไลน์ 100%) หรือ PostgreSQL / MySQL ของร้าน, เครื่องลูกในวง LAN ขายต่อได้แม้หลุดเครือข่าย, สำรองอัตโนมัติ, License แบบตรวจสอบออฟไลน์

## โครงสร้าง / Layout

```
apps/server    Fastify API (Node.js) — ราคา/ภาษีคำนวณที่เซิร์ฟเวอร์เสมอ
apps/web       React + Vite + Tailwind (POS, หลังร้าน, /order แอปพนักงาน, /display จอลูกค้า)
apps/desktop   Electron สำหรับ Windows (รวมเซิร์ฟเวอร์ในตัว)
packages/shared  ตรรกะร่วม: คำนวณราคา/VAT/โปรโมชั่น, PromptPay, schema
packages/db    Kysely + migration เดียวใช้ได้กับ SQLite / PostgreSQL / MySQL
docs/          คู่มือผู้ใช้ ติดตั้ง และผู้ดูแล
tools/license  เครื่องมือออก License key (สำหรับผู้ขายเท่านั้น)
```

## เริ่มพัฒนา / Development

ต้องมี Node.js 20+ และ pnpm (`corepack enable`)

```bash
pnpm install
pnpm dev          # API http://localhost:4100 + เว็บ http://localhost:5173
```

เปิด http://localhost:5173 แล้วทำตามตัวช่วยตั้งค่า

## ทดสอบ / Tests

```bash
pnpm typecheck && pnpm lint
pnpm test                         # unit + integration (SQLite)
TEST_PG=1 TEST_MYSQL=1 pnpm test  # + PostgreSQL :54329 และ MySQL :33069 (ดู docs/admin-guide.md)
pnpm build && pnpm e2e            # Playwright end-to-end
```

## สร้างไฟล์ติดตั้ง / Release

```bash
pnpm desktop:dist                 # → apps/desktop/release/FlexPOS-Setup.exe
docker compose up -d --build      # เซิร์ฟเวอร์ + PostgreSQL ที่ http://<server>:4100
```

ดูรายละเอียดที่ [docs/install-guide.md](docs/install-guide.md) · คู่มือผู้ใช้ [docs/user-guide.md](docs/user-guide.md) · ผู้ดูแล [docs/admin-guide.md](docs/admin-guide.md)
