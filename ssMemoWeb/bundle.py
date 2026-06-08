#!/usr/bin/env python3
# ssMemoWeb 단일 파일 번들러
# - 모든 ES 모듈을 import/export 키워드만 제거하고 순서대로 이어 붙입니다.
# - CSS와 함께 release/index.single.html에 인라인합니다.
# - 외부 라이브러리 의존성 없음, Python 표준 라이브러리만 사용.

import re
from pathlib import Path

ROOT = Path(__file__).parent

# 의존성 위상 정렬 (의존되는 모듈이 먼저 위치)
MODULE_ORDER = [
    'src/state.js',
    'src/constants.js',
    'src/storage-config.js',
    'src/utils.js',
    'src/markdown.js',
    'src/file-utils.js',
    'src/encoding.js',
    'src/data-sources/indexeddb.js',
    'src/data-sources/rest.js',
    'src/data-sources/memory.js',
    'src/data-sources/index.js',
    'src/app-api.js',
    'src/note-search.js',
    'src/notepad.js',
    'src/main.js',
]

# 단일 라인 import/export만 사용한다는 가정 (현 코드베이스에 부합).
IMPORT_RE = re.compile(r'^\s*import\s+[^;]+;\s*$', re.MULTILINE)
EXPORT_DECL_RE = re.compile(
    r'^(\s*)export\s+(const|let|var|function|class|async\s+function)\s',
    re.MULTILINE
)
EXPORT_LIST_RE = re.compile(r'^\s*export\s*\{[^}]*\}\s*;?\s*$', re.MULTILINE)


def strip_module_syntax(code: str) -> str:
    code = IMPORT_RE.sub('', code)
    code = EXPORT_DECL_RE.sub(r'\1\2 ', code)
    code = EXPORT_LIST_RE.sub('', code)
    return code


def bundle_js() -> str:
    parts = []
    for rel in MODULE_ORDER:
        path = ROOT / rel
        if not path.exists():
            raise FileNotFoundError(f'모듈을 찾을 수 없습니다: {rel}')
        cleaned = strip_module_syntax(path.read_text(encoding='utf-8'))
        parts.append(f'\n/* === {rel} === */\n{cleaned}')
    return '\n'.join(parts)


def main() -> None:
    css = (ROOT / 'src/style.css').read_text(encoding='utf-8')
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    bundled_js = bundle_js()

    # 함수형 replacement를 사용해 백슬래시 escape 해석을 피합니다.
    html = re.sub(
        r'<link\s+rel="stylesheet"\s+href="\./src/style\.css">',
        lambda _m: f'<style>\n{css}\n</style>',
        html,
    )
    html = re.sub(
        r'<script\s+src="\./src/main\.js"\s+type="module"></script>',
        lambda _m: f'<script>\n{bundled_js}\n</script>',
        html,
    )

    out = ROOT / 'release' / 'index.html'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding='utf-8')
    size_kb = out.stat().st_size / 1024
    print(f'[bundle] 단일 산출물: {out} ({size_kb:.1f} KB)')


if __name__ == '__main__':
    main()
