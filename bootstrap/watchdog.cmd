@echo off
REM Host entrypoint for Task Scheduler. Do not run inside a container.
setlocal
cd /d "%~dp0.."
set "GIT_BASH=C:\Program Files\Git\bin\bash.exe"
if not exist "%GIT_BASH%" set "GIT_BASH=C:\Program Files\Git\usr\bin\bash.exe"
if not exist "%GIT_BASH%" (
  echo [watchdog] Git bash.exe not found >&2
  exit /b 1
)
"%GIT_BASH%" -lc "./bootstrap/watchdog.sh"
exit /b %ERRORLEVEL%
