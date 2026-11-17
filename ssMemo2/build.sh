#!/bin/sh
# ssMemo2 build script (Linux / macOS / Android).
# Builds the single-file app and puts only index.html into the release folder.
# Usage: ./build.sh [release_dir]   (default: the release folder next to this script)
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
OUTPUT_NAME="index.html"

# Resolve the target before changing directory so a relative path means what the caller expects.
case "${1:-}" in
  "") RELEASE_DIR="${ROOT_DIR}/release" ;;
  /*) RELEASE_DIR="$1" ;;
  *) RELEASE_DIR="$(pwd)/$1" ;;
esac

cd "${ROOT_DIR}"

if [ ! -d node_modules ]; then
  echo "[ssMemo2] 의존성 설치 (npm ci)..."
  npm ci
fi

echo "[ssMemo2] 단일 파일 빌드..."
npm run --silent build

# The folder is never emptied first: the caller may point this at a folder with other content.
mkdir -p "${RELEASE_DIR}"
cp "dist/${OUTPUT_NAME}" "${RELEASE_DIR}/${OUTPUT_NAME}"

echo "[ssMemo2] 빌드 완료: ${RELEASE_DIR}/${OUTPUT_NAME}"
echo "실행: cd \"${RELEASE_DIR}\" && python -m http.server 8001 후 http://localhost:8001 접속"
