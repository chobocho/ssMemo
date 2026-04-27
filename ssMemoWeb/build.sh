#!/usr/bin/env bash
# ssMemoWeb 빌드 스크립트 (Linux/macOS)
# 실행에 필요한 파일만 release 폴더로 복사합니다.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="${ROOT_DIR}/release"

echo "[ssMemoWeb] release 폴더 정리..."
rm -rf "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}/src/data-sources"

echo "[ssMemoWeb] 파일 복사..."
cp "${ROOT_DIR}/index.html"           "${RELEASE_DIR}/"
cp "${ROOT_DIR}/readme.md"            "${RELEASE_DIR}/"
cp "${ROOT_DIR}/src/"*.js             "${RELEASE_DIR}/src/"
cp "${ROOT_DIR}/src/style.css"        "${RELEASE_DIR}/src/"
cp "${ROOT_DIR}/src/data-sources/"*.js "${RELEASE_DIR}/src/data-sources/"

echo "[ssMemoWeb] 단일 파일 번들 생성..."
python3 "${ROOT_DIR}/bundle.py"

echo "[ssMemoWeb] 빌드 완료: ${RELEASE_DIR}"
echo "실행: cd release && python -m http.server 8001"
echo "단일 파일: ${RELEASE_DIR}/index.single.html (브라우저로 직접 열기 가능)"
