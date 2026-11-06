@echo off
chcp 65001 >nul
title Xu Ly Loi Ngrok Trung Phien (ERR_NGROK_108) - O Z:\ / Shared_NVMe

:: Ho tro chay truc tiep tu ca duong dan mang \\host.lan\Shared_NVMe\ lan o dia Z:\
pushd "%~dp0"

echo =====================================================================
echo   CONG CU TAT NGROK ^& KHOI DONG LAI BOT XE/TOUR NHA TRANG (Z:\)
echo   Thu muc dang chay: %CD%
echo =====================================================================
echo.

echo [1/4] Dang tat cac tien trinh ngrok.exe chay ngam...
taskkill /F /IM ngrok.exe /T 2>nul
if %errorlevel% equ 0 (
    echo   -^> Da tat ngrok.exe tren may nay!
) else (
    echo   -^> Khong co ngrok.exe nao dang chay ngam tren may nay.
)

echo.
echo [2/4] Dang thu gui lenh tat ngrok.exe sang may Host (host.lan)...
taskkill /S host.lan /F /IM ngrok.exe /T 2>nul
if %errorlevel% equ 0 (
    echo   -^> Da tat thanh cong ngrok.exe tren host.lan!
) else (
    echo   -^> Neu Ngrok van con treo tren may cu, hay:
    echo       + Chay file Z:\TAT_NGROK_MAY_CU.bat nay truc tiep tren May Cu, HOAC
    echo       + Bam Stop Agent tai: https://dashboard.ngrok.com/agents
)

echo.
echo [3/4] Tuy chon cap nhat Authtoken moi (De ngat ket noi may cu ngay lap tuc):
set /p NEW_TOKEN="Nhap Authtoken Ngrok moi (hoac bam Enter de bo qua): "
if not "%NEW_TOKEN%"=="" (
    if exist "Z:\ngrok.exe" (
        "Z:\ngrok.exe" config add-authtoken %NEW_TOKEN%
    ) else (
        ngrok config add-authtoken %NEW_TOKEN%
    )
    echo   -^> Da cap nhat Authtoken moi thanh cong!
)

echo.
echo [4/4] Dang khoi dong Server Bot (Port 3000) va Ngrok...
if exist "%~dp0server.js" (
    start "NhaTrang AI Bot Server (Port 3000)" cmd /k "pushd "%~dp0" && node server.js"
    timeout /t 2 /nobreak >nul
) else if exist "Z:\nhatrang-messenger-ai-bot\server.js" (
    start "NhaTrang AI Bot Server (Port 3000)" cmd /k "cd /d "Z:\nhatrang-messenger-ai-bot" && node server.js"
    timeout /t 2 /nobreak >nul
)

echo Dang mo Ngrok ket noi vao cong 3000...
if exist "%~dp0ngrok.exe" (
    "%~dp0ngrok.exe" http 3000
) else if exist "Z:\ngrok.exe" (
    "Z:\ngrok.exe" http 3000
) else (
    ngrok http 3000
)

popd
pause
