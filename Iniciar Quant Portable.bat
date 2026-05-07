@echo off
setlocal
cd /d "%~dp0electron_quant\dist2\Quant-win32-x64"
start "" "%CD%\Quant.exe"
