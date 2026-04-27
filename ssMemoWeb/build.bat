@echo off
REM ssMemoWeb 빌드 스크립트 (Windows)
REM 실행에 필요한 파일만 release 폴더로 복사합니다.
chcp 949 > nul
setlocal

set "ROOT_DIR=%~dp0"
set "RELEASE_DIR=%ROOT_DIR%release"

echo [ssMemoWeb] release 폴더 정리...
if exist "%RELEASE_DIR%" rmdir /S /Q "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%\src"
mkdir "%RELEASE_DIR%\src\data-sources"

echo [ssMemoWeb] 파일 복사...
copy /Y "%ROOT_DIR%index.html"               "%RELEASE_DIR%\"            > nul
copy /Y "%ROOT_DIR%readme.md"                "%RELEASE_DIR%\"            > nul
copy /Y "%ROOT_DIR%src\*.js"                 "%RELEASE_DIR%\src\"        > nul
copy /Y "%ROOT_DIR%src\style.css"            "%RELEASE_DIR%\src\"        > nul
copy /Y "%ROOT_DIR%src\data-sources\*.js"    "%RELEASE_DIR%\src\data-sources\" > nul

echo [ssMemoWeb] 빌드 완료: %RELEASE_DIR%
echo 실행: cd release ^&^& python -m http.server 8001

endlocal
