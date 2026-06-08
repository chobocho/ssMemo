@echo off
REM ssMemoWeb 빌드 스크립트 (Windows)
REM release 폴더에 단일 index.html 파일을 산출합니다.
chcp 949 > nul
setlocal

set "ROOT_DIR=%~dp0"
set "RELEASE_DIR=%ROOT_DIR%release"

echo [ssMemoWeb] release 폴더 정리...
if exist "%RELEASE_DIR%" rmdir /S /Q "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%"

echo [ssMemoWeb] 단일 파일 번들 생성...
python "%ROOT_DIR%bundle.py"

echo [ssMemoWeb] 빌드 완료: %RELEASE_DIR%\index.html
echo 실행: 브라우저로 %RELEASE_DIR%\index.html 직접 열기
echo       또는 cd release ^&^& python -m http.server 8001

endlocal
