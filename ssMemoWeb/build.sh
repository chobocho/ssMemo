#!/usr/bin/env bash
# ssMemoWeb 빌드 스크립트 (Linux/macOS)
# release 폴더에 단일 index.html 파일을 산출합니다.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="${ROOT_DIR}/release"

echo "[ssMemoWeb] release 폴더 정리..."
rm -rf "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"

echo "[ssMemoWeb] 단일 파일 번들 생성..."
python3 "${ROOT_DIR}/bundle.py"

echo "[ssMemoWeb] 빌드 완료: ${RELEASE_DIR}/index.html"
echo "실행: 브라우저로 ${RELEASE_DIR}/index.html 직접 열기"
echo "      또는 cd release && python -m http.server 8001"
