# ssMemo (웹 버전)

브라우저에서 동작하는 가벼운 메모 앱입니다. 외부 라이브러리 의존 없이 단일 정적 사이트로 동작하며, 사용자 데이터는 브라우저의 IndexedDB에 저장되어 이어쓰기를 지원합니다.

## 주요 기능

- 메인 메모장 자동 저장 (3분 간격) 및 IndexedDB 영구 저장
- 최대 7개의 보조 파일 탭 (읽기 전용) — 텍스트 파일 불러오기/드래그 앤 드롭 지원
- 글자수 / 줄 번호 실시간 표시
- 강제 줄바꿈 토글, 절취선(2000자 단위 분할) 삽입
- 텍스트 검색 (다음/이전, 단축키 포함)
- 메모/파일 다운로드 (.txt)
- URL 드래그 + 우클릭으로 새 창 열기

## 실행 방법

외부 서버 없이 정적 파일만으로 동작합니다.

```bash
python -m http.server 8001
```

브라우저에서 `http://localhost:8001` 접속.

## 단축키

| 단축키 | 동작 |
| --- | --- |
| Ctrl + F / Ctrl + I | 검색창 포커스 |
| Ctrl + < / Ctrl + , | 이전 검색 결과 |
| Ctrl + > / Ctrl + . / Ctrl + N | 다음 검색 결과 |
| Ctrl + L | 구분선 삽입 |
| Ctrl + 6 / Ctrl + H | 문서 맨 위로 |
| Ctrl + 4 / Ctrl + E | 문서 맨 아래로 |
| Alt + B / PageUp | 페이지 위로 |
| Alt + F / PageDown | 페이지 아래로 |
| Ctrl + Shift + A | → 삽입 |
| Ctrl + Shift + C | ✅ 삽입 |
| Ctrl + Shift + O | □ 삽입 |
| Ctrl + Shift + R | ※ 삽입 |
| Ctrl + Shift + X | ❎ 삽입 |
| Ctrl + Shift + Z | 🟩 삽입 |

## 폴더 구조

```
ssMemoWeb/
├── index.html            # 진입점
├── src/
│   ├── main.js           # 앱 부트스트랩
│   ├── notepad.js        # 메모장/탭/파일 적재
│   ├── note-search.js    # 검색
│   ├── app-api.js        # 데이터/UI API 래퍼
│   ├── state.js          # 전역 상태
│   ├── constants.js      # 상수
│   ├── storage-config.js # 저장소 설정
│   ├── style.css
│   └── data-sources/
│       ├── index.js
│       ├── indexeddb.js
│       └── rest.js
├── readme.md             # 본 문서
└── history.md            # 작업 이력
```

## 빌드

`build.sh` (Linux/macOS) 또는 `build.bat` (Windows)을 실행하면 `release/` 폴더에 JS/CSS가 모두 인라인된 단일 파일 `release/index.html`이 생성됩니다. 더블 클릭으로 브라우저에서 바로 열 수 있고 (서버 불필요), 원한다면 `cd release && python -m http.server 8001`로 띄울 수도 있습니다.

단일 파일 번들은 `bundle.py` (Python 표준 라이브러리만 사용)가 ES 모듈을 위상 정렬 후 import/export 키워드를 제거하고 인라인합니다.

## 라이선스

상위 폴더의 LICENSE 파일을 따릅니다.
