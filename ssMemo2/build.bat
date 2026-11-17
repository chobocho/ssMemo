@echo off
chcp 949 > nul
setlocal
rem ssMemo2 build script for Windows. It puts only index.html into the release folder.
rem Usage: build.bat [release_dir]   (default: the release folder next to this script)
rem This file must stay cp949 + CRLF so the Korean messages below are readable in cmd.
rem Do not edit build.bat directly: edit scripts\build.bat.template, then run "npm run gen:bat".

set "ROOT_DIR=%~dp0"
set "RELEASE_DIR=%ROOT_DIR%release"
if not "%~1"=="" set "RELEASE_DIR=%~f1"

pushd "%ROOT_DIR%"
if errorlevel 1 exit /b 1

if exist "node_modules" goto :build
echo [ssMemo2] 의존성 설치 (npm ci)...
call npm ci
if errorlevel 1 goto :fail

:build
echo [ssMemo2] 단일 파일 빌드...
call npm run --silent build
if errorlevel 1 goto :fail

if exist "%RELEASE_DIR%" goto :copy
mkdir "%RELEASE_DIR%"
if errorlevel 1 goto :fail

:copy
copy /Y "dist\index.html" "%RELEASE_DIR%\index.html" > nul
if errorlevel 1 goto :fail

echo [ssMemo2] 빌드 완료: %RELEASE_DIR%\index.html
echo 실행: cd /d "%RELEASE_DIR%" 후 python -m http.server 8001 실행, http://localhost:8001 접속
popd
exit /b 0

:fail
echo [ssMemo2] 빌드 실패
popd
exit /b 1
