# 작업 이력

날짜는 git 커밋 기준이 아닌 작업 항목 단위로 기록합니다.
신규 변경은 위쪽에 추가합니다.

## 2026-04-27

- 마크다운 미리보기 하단 잘림 수정. `.note-editor-container`와 `.note-md-preview`에 `min-height: 0`, 미리보기에 `height: 100%`, 하단 padding을 14→32px로 늘리고 마지막 자식의 `margin-bottom`을 제거. flex 부모 안에서 overflow-y가 정확히 동작하도록 함.
- 단일 index.html 빌드 옵션 추가. `bundle.py`(Python 표준 라이브러리만 사용)가 ES 모듈을 위상 정렬해 import/export 키워드 제거 후 단일 `<script>`로 인라인, CSS도 `<style>`로 인라인하여 `release/index.single.html` 생성. build.sh / build.bat에서 자동 호출.
- 키맵/확장자 상수화. `ALLOWED_TEXT_EXTENSIONS`, `SYMBOL_SHORTCUTS`, `MAX_FILE_TABS`를 `constants.js`로 분리. 6개 if문으로 흩어져 있던 Ctrl+Shift+(A/C/O/R/X/Z) 기호 삽입을 단일 lookup으로 정리. 파일 검증 로직을 `src/file-utils.js`로 추출 (`hasAllowedExtension`/`isAllowedTextFile`/`isOversized`) — 단위 테스트 13건 통과.
- IndexedDB 실패 시 메모리 폴백 자동 전환. `src/data-sources/memory.js` 신규 작성, `AppAPI.init/get/save`를 try/catch로 감싸 한 번 실패하면 모든 호출이 `MemorySource`로 위임. 사용자에게 1회 경고 모달 표시.
- "메모장 초기화" (다시하기) 버튼 🗑️ 추가. `AppAPI.confirm` 헬퍼로 취소/확인 모달 제공 (위험 액션은 빨간색). 초기화 시 IndexedDB도 함께 비움.
- MemorySource 단위 테스트 4건 추가.
- 마크다운 렌더링 추가. 외부 의존 없이 `src/markdown.js` 자체 파서(헤더/굵게/기울임/코드/리스트/링크/인용/수평선) 작성. XSS 방지 위해 HTML 이스케이프 후 처리, javascript: 스킴 차단. .md 파일 탭에서만 📖 미리보기 토글 버튼 노출. 17개 단위 테스트 통과. 테스트 러너를 `test/runner.js`로 분리.
- 200KB 이상 파일 로드 시 ⏳ 오버레이 스피너 표시. `LOADING_SPINNER_THRESHOLD` 상수 추가. `loadFileFromDisk`/드래그앤드롭 분기 중복 코드를 `handleIncomingFile` 헬퍼로 통합. CSS `@keyframes spin` 추가.
- 테스트 인프라 추가 (`test/` 폴더). 순수 함수 `src/utils.js` 신규 작성: `splitTextIntoChunks`, `joinTextChunks`, `findNextIndex`, `findPrevIndex`. 17개 단위 테스트 모두 통과. `notepad.js`의 `splitNoteIntoChunks`가 새 유틸 사용하도록 리팩터링.
- build.sh / build.bat 추가. `release/` 폴더에 실행 파일만 복사. build.bat은 cp949(`chcp 949`)로 한글 안 깨지게 처리. `.gitignore`에 release/ 추가.
- readme.md / history.md 신규 작성. CLAUDE.md 요구사항(한글 README 유지, 작업 이력 기록) 충족.

## 이전 이력 (git 로그 요약)

- 텍스트 파일 다운로드 기능 추가 및 관련 예외 처리 로직 구현
- 단축키에 Ctrl+F 추가 (검색창 포커스)
- 버튼 호버 스타일 추가 및 버전 정보 업데이트
- 드래그 앤 드롭을 통한 파일 불러오기 기능 추가, UI 시각적 효과 및 파일 검증 로직 포함
- 탭 제목 표시 기준 변경 (최대 12글자), 버튼 스타일 오타 수정
- 파일 불러오기 시 파일 크기 및 확장자 검증 추가
- 다중 탭 지원을 위한 PageUp/PageDown 키 동작 로직 수정
- 탭 닫기 확인 알림 추가
- 탭별 강제 줄 바꿈 상태 관리 및 버튼 상태 동기화 로직 추가
- 강제 줄 바꿈 토글 기능 추가
- 모바일 UI 개선 및 키보드 단축키 핸들러 추가
- 탭별 글자수 및 버튼 표시/숨김 처리 기능 추가
- 탭 UI 추가 및 파일 관리 기능 구현
- 절취선 기능 추가 및 개선
- 검색 기능 수정: 기본적으로 시작부터 검색하도록 변경
- 윈도우 크기 변경 대응 코드 개선
- 메모장 메시지/도움말 한글화
- [Web] Initial version
