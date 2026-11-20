@echo off
chcp 65001 >nul
setlocal
title Alaw - prepis Bangor
cd /d "%~dp0"
set "DATA=%LOCALAPPDATA%\AlawBangor"
set "VENV=%DATA%\venv"
set "VPY=%VENV%\Scripts\python.exe"
set "PY312=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"

if exist "%DATA%\pripraveno-1.txt" goto run

echo.
echo  Alaw - přepis Bangor: první spuštění
echo  Připravím vše potřebné. Jednou, trvá to pár minut, pak už se program spouští hned.
echo.

if exist "%PY312%" goto havepy
for /f "delims=" %%i in ('py -3.12 -c "import sys;print(sys.executable)" 2^>nul') do set "PY312=%%i"
if exist "%PY312%" goto havepy
echo  Instaluji Python 3.12 - Windows se může zeptat na povolení, potvrď ho.
winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
if exist "%PY312%" goto havepy
echo.
echo  Python se nepodařilo nainstalovat automaticky.
echo  Nainstaluj ho ručně ze stránky https://www.python.org/downloads/ - verzi 3.12 -
echo  a pak tento soubor spusť znovu.
pause
exit /b 1

:havepy
if not exist "%DATA%" mkdir "%DATA%"
if not exist "%VPY%" "%PY312%" -m venv "%VENV%"
if not exist "%VPY%" goto failed
echo  Instaluji přepisový program faster-whisper...
"%VPY%" -m pip install --disable-pip-version-check --upgrade pip
"%VPY%" -m pip install --disable-pip-version-check "faster-whisper==1.2.1" "av==16.1.0" "ctranslate2==4.9.0"
if errorlevel 1 goto failed
where nvidia-smi >nul 2>&1
if errorlevel 1 goto nogpu
echo  Našel jsem grafickou kartu NVIDIA - instaluji knihovny pro rychlý přepis, asi 1,3 GB...
"%VPY%" -m pip install --disable-pip-version-check nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"
:nogpu
echo hotovo> "%DATA%\pripraveno-1.txt"

:run
echo.
"%VPY%" "%~dp0alaw_bangor.py"
echo.
echo  Program skončil. Okno můžeš zavřít.
pause
exit /b 0

:failed
echo.
echo  Instalace se nepovedla. Zkontroluj připojení k internetu a spusť tento soubor znovu.
echo  Když to nepůjde ani napodruhé, pošli Claudovi text z tohoto okna.
pause
exit /b 1
