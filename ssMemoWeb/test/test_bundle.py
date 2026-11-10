#!/usr/bin/env python3
# bundle.py 파비콘 내장 검증 테스트
# 실행: 프로젝트 루트에서 python3 test/test_bundle.py
# - 실제 release/ 를 건드리지 않도록 임시 폴더에 프로젝트 사본을 만들어 번들러를 실행합니다.
# - 외부 라이브러리 없이 표준 라이브러리(unittest)만 사용합니다.

import base64
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAVICON_REL = Path('src/favicon.svg')
# 산출물에서 data URI 파비콘 <link>를 찾는 패턴 (base64 본문만 캡처)
ICON_LINK_RE = re.compile(
    r'<link\s+rel="icon"\s+type="image/svg\+xml"\s+'
    r'href="data:image/svg\+xml;base64,([A-Za-z0-9+/=]+)">'
)


def make_project_copy(tmp: Path) -> Path:
    """번들에 필요한 파일만 임시 폴더로 복사 — 테스트가 실제 산출물을 덮어쓰지 않게 하기 위함."""
    shutil.copy2(ROOT / 'bundle.py', tmp / 'bundle.py')
    shutil.copy2(ROOT / 'index.html', tmp / 'index.html')
    shutil.copytree(ROOT / 'src', tmp / 'src')
    return tmp


def run_bundle(project: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(project / 'bundle.py')],
        capture_output=True, text=True, encoding='utf-8',
    )


def read_output(project: Path) -> str:
    return (project / 'release' / 'index.html').read_text(encoding='utf-8')


class BundleFaviconTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.project = make_project_copy(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    # ---------- 정상 케이스 ----------
    def test_favicon_source_exists(self):
        self.assertTrue((ROOT / FAVICON_REL).is_file(), 'src/favicon.svg 파일이 있어야 함')

    def test_dev_index_references_favicon(self):
        html = (ROOT / 'index.html').read_text(encoding='utf-8')
        self.assertIn('<link rel="icon" type="image/svg+xml" href="./src/favicon.svg">', html,
                      '개발용 index.html 에서도 파비콘이 보여야 함')

    def test_bundle_embeds_favicon_as_data_uri(self):
        result = run_bundle(self.project)
        self.assertEqual(result.returncode, 0, result.stderr)
        html = read_output(self.project)
        match = ICON_LINK_RE.search(html)
        self.assertIsNotNone(match, '산출물에 data URI 파비콘 <link>가 있어야 함')
        decoded = base64.b64decode(match.group(1))
        self.assertEqual(decoded, (self.project / FAVICON_REL).read_bytes(),
                         '내장된 파비콘은 원본 SVG와 바이트 단위로 같아야 함')

    def test_bundle_has_no_external_favicon_reference(self):
        result = run_bundle(self.project)
        self.assertEqual(result.returncode, 0, result.stderr)
        html = read_output(self.project)
        self.assertNotIn('./src/favicon.svg', html, '외부 파일 참조가 남으면 안 됨')
        self.assertEqual(len(ICON_LINK_RE.findall(html)), 1, '파비콘 <link>는 정확히 1개')

    # ---------- 엣지 케이스 ----------
    def test_bundle_fails_when_favicon_missing(self):
        favicon = self.project / FAVICON_REL
        if favicon.exists():
            favicon.unlink()
        result = run_bundle(self.project)
        self.assertNotEqual(result.returncode, 0, '파비콘 원본이 없으면 빌드가 실패해야 함')
        self.assertIn('favicon.svg', result.stderr)

    def test_bundle_preserves_non_ascii_svg(self):
        # 한글 등 비 ASCII 문자가 포함돼도 깨지지 않아야 함 (base64 선택 이유)
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">'
               '<title>메모장 아이콘</title><rect width="8" height="8"/></svg>\n')
        (self.project / FAVICON_REL).write_text(svg, encoding='utf-8')
        result = run_bundle(self.project)
        self.assertEqual(result.returncode, 0, result.stderr)
        match = ICON_LINK_RE.search(read_output(self.project))
        self.assertIsNotNone(match)
        self.assertEqual(base64.b64decode(match.group(1)).decode('utf-8'), svg)


if __name__ == '__main__':
    unittest.main(verbosity=2)
