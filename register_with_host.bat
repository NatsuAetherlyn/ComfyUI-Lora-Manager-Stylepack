@echo off
rem ============================================================
rem  ComfyUI-Lora-Manager-Stylepack: one-click host registration
rem  Double-click to run. Extra arguments are forwarded to
rem  scripts/register_with_host.py, e.g.:
rem      register_with_host.bat --check
rem      register_with_host.bat --restore
rem      register_with_host.bat <path-to-host-pack>
rem  NOTE: this file must stay GBK-encoded (default zh-CN codepage);
rem  do not re-save it as UTF-8.
rem ============================================================
setlocal EnableExtensions
cd /d "%~dp0"

set "SCRIPT=scripts\register_with_host.py"
if not exist "%SCRIPT%" (
    echo [错误] 没找到 %SCRIPT%
    echo        请把本 bat 放在 Stylepack 根目录下运行。
    pause
    exit /b 1
)

rem ---- 找一个可用的 Python --------------------------------------
set "PYEXE="
set "PYARGS="

where py >nul 2>&1
if not errorlevel 1 (
    py -3 --version >nul 2>&1
    if not errorlevel 1 (
        set "PYEXE=py"
        set "PYARGS=-3"
    )
)

if not defined PYEXE (
    python --version >nul 2>&1
    if not errorlevel 1 set "PYEXE=python"
)

rem 秋叶等整合包自带 python；ComfyUI portable 是 python_embeded
if not defined PYEXE if exist "%~dp0..\..\..\python\python.exe" (
    set "PYEXE=%~dp0..\..\..\python\python.exe"
)
if not defined PYEXE if exist "%~dp0..\..\..\python_embeded\python.exe" (
    set "PYEXE=%~dp0..\..\..\python_embeded\python.exe"
)

if not defined PYEXE (
    echo [错误] 没有找到可用的 Python。
    echo        请安装 Python 3.10+ 并勾选 "Add Python to PATH"，
    echo        或确认整合包目录下存在 python\python.exe。
    echo.
    pause
    exit /b 1
)

echo.
echo ========= Stylepack 主包注册 =========
echo Python: %PYEXE% %PYARGS%
echo.

"%PYEXE%" %PYARGS% "%SCRIPT%" %*
set "EC=%ERRORLEVEL%"

echo.
if "%EC%"=="0" (
    echo [完成] 若上方提示已打上补丁，请重启 ComfyUI 并硬刷新浏览器生效。
) else (
    echo [失败] 退出码 %EC% 。请截图上方完整输出，到仓库 Issues 页面反馈。
)
pause
exit /b %EC%
