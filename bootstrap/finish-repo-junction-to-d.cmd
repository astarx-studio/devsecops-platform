@echo off
REM Finish C: → D: repo junction. Run from an elevated-or-normal cmd AFTER
REM Cursor has Open Folder on D:\devsecops-platform (not the old C: path).
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0finish-repo-junction-to-d.ps1" %*
echo.
pause
