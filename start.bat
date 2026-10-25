@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if not exist "apps\server\dist\main.js" (
  echo [X] ยังไม่ได้ติดตั้ง กรุณาดับเบิลคลิก install.bat ก่อน
  pause
  exit /b 1
)
if "%PORT%"=="" set PORT=4100
set FLEXPOS_DATA_DIR=%~dp0data
set FLEXPOS_WEB_DIR=%~dp0apps\web\dist
set FLEXPOS_FONTS_DIR=%~dp0apps\server\dist\fonts
set NODE_ENV=production
echo FlexPOS กำลังทำงานที่ http://localhost:%PORT%  (ปิดหน้าต่างนี้ = ปิดโปรแกรม)
start "" "http://localhost:%PORT%"
node apps\server\dist\main.js
pause
