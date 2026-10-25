@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo ==========================================
echo   FlexPOS - ติดตั้งโปรแกรม
echo ==========================================

where node >nul 2>nul
if errorlevel 1 (
  echo [X] ไม่พบ Node.js กรุณาติดตั้ง Node.js 20 ขึ้นไปจาก https://nodejs.org แล้วเปิดไฟล์นี้อีกครั้ง
  pause
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 20 (
  echo [X] Node.js เวอร์ชันเก่าเกินไป ต้องเป็น 20 ขึ้นไป
  pause
  exit /b 1
)

echo [1/3] ติดตั้งแพ็กเกจ ...
call corepack pnpm install --frozen-lockfile
if errorlevel 1 goto fail

echo [2/3] สร้างหน้าเว็บ ...
call corepack pnpm --filter @flexpos/web build
if errorlevel 1 goto fail

echo [3/3] สร้างเซิร์ฟเวอร์ ...
call corepack pnpm --filter @flexpos/server build
if errorlevel 1 goto fail

echo.
echo [OK] ติดตั้งเสร็จแล้ว ดับเบิลคลิก start.bat เพื่อเปิดโปรแกรม
pause
exit /b 0

:fail
echo [X] ติดตั้งไม่สำเร็จ ดูข้อความด้านบน หรือดู docs\manual\README.md หัวข้อ "แก้ปัญหา"
pause
exit /b 1
