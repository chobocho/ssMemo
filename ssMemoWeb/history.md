# 작업 이력

날짜는 git 커밋 기준이 아닌 작업 항목 단위로 기록합니다.
신규 변경은 위쪽에 추가합니다.

## 2026-06-10

- 코드 리뷰에서 발견된 개선 포인트 8건 일괄 반영.
  1. 죽은 코드/중복 제거 — 테스트만 있고 미사용이던 `utils.findNextIndex`/`findPrevIndex`를 `note-search.js`가 실제로 사용하도록 교체(동일한 랩어라운드 검색 로직의 인라인 재구현 제거).
  2. `escapeHtml` 2벌 통일 — `AppAPI.escapeHtml`(DOM 기반)을 제거하고 `markdown.js`의 문자열 치환 구현을 import해 재사용.
  3. 마크다운 코드 스팬 리터럴 보존 — `` `**x**` `` 같은 코드 스팬 내부에 bold/italic/링크 치환이 적용되던 문제. 코드 스팬을 PUA(/) 플레이스홀더로 분리 후 마지막에 복원하는 방식으로 수정. 입력에 우연히 PUA 문자가 있어도 오작동하지 않도록 선제거. 단위 테스트 11건 추가.
  4. 검색 스크롤 성능 — `scrollToIndex`의 `split('\n')` 대형 배열 할당을 `utils.countNewlines`(charCode 루프, 할당 없음)로 교체. `notepad.js`의 `countLines`도 같은 헬퍼를 재사용하도록 정리. 단위 테스트 6건 추가.
  5. 단축키 안내 일치 — 도움말의 Ctrl+< / Ctrl+>가 실제로는 Shift 조합이라 `e.key`가 `'<'`/`'>'`로 들어와 동작하지 않던 것을 키 매치에 추가.
  6. 계산기 지수 표기 — `2e`처럼 지수 뒤 숫자가 없으면 `Number('2e') → NaN`이 조용히 출력되던 문제. e/E 뒤에 (부호 포함) 숫자가 실제로 이어질 때만 숫자 토큰으로 소비하도록 수정 — `2e`는 명확한 에러(미정의 변수/파서 에러). 단위 테스트 7건 추가.
  7. index.html 정리 — `lang="ko"`로 수정, 접근성을 해치는 `user-scalable=no`/`maximum-scale` 제거. 손으로 복붙돼 있던 파일 탭 7개 + 에디터 컨테이너 7개 블록을 `Notepad.buildTabSlots()`가 `MAX_FILE_TABS` 상수 기준으로 동적 생성하도록 변경(탭 개수를 상수 하나로 관리). 인라인 `onclick="closeFileTab(i)"`가 사라져 `window.closeFileTab` 전역 노출도 제거. `fileTabs`의 wrapStates/previewStates 키도 하드코딩 대신 루프 생성.
  8. 저장소 메서드 개명 — 날짜 키 시절 이름이던 `getNoteByDate`/`saveOrUpdateNoteByDate`를 실제 의미에 맞게 `getRecord`/`saveRecord`로 전 데이터 소스(IndexedDb/Memory/Rest)·AppAPI·호출처·테스트 일괄 변경. `bundle.py`의 낡은 산출물 파일명 주석도 수정.
  - 보류: 파일 탭의 원본 `ArrayBuffer` 보관 해제는 🔤 인코딩 변경 기능이 원본 바이트를 필요로 하므로 적용하지 않음(기능 제거 없이는 불가).
  - 검증: 신규/회귀 핵심 케이스 23건을 Node로 직접 실행해 전부 통과(markdown 코드 스팬·표·details·XSS 회귀, calc 지수·산술·factorial 회귀, utils 검색/카운트). 전체 src/test 모듈 구문 검사 통과, `build.sh` 단일 파일 번들(146.6KB) 재생성 및 번들 구문·내용 검사 통과.

- 코드 리뷰에서 발견된 버그 5건 일괄 수정.
  1. 종료 시 저장 보장 강화 — `beforeunload`의 async 핸들러는 브라우저가 promise를 기다려주지 않아 저장 시작 전에 페이지가 사라질 수 있고, 메인 메모만 저장(`save()`)해 더티 메모 탭이 누락되던 문제. `pagehide`/`visibilitychange(hidden)` 시점에 `saveAll()`(메인+모든 메모 탭)을 트리거하고, 미저장 변경이 남아 있으면 `beforeunload`에서 이탈 경고를 띄워 저장 완료 시간을 확보. `Notepad.hasUnsavedChanges()` 신설. `main.js`의 미사용 `state` import 제거.
  2. Ctrl+F 검색창 포커스가 동작하지 않던 문제 — 키 비교에 소문자 `'f'`가 빠져 Shift 없이 누르면 브라우저 기본 찾기 창이 뜨던 버그. 도움말 안내(Ctrl+F/Ctrl+I)와 실제 동작 일치.
  3. 문서 맨 위(Ctrl+6/H)/맨 아래(Ctrl+4/E) 이동이 파일·메모 탭에서 화면에 안 보이는 메인 에디터를 조작하던 문제 — `activeEditorContext()`로 현재 활성 탭 에디터를 대상으로 동작하도록 수정. PageUp/PageDown 분기도 같은 헬퍼로 통일해 중복 lookup 제거.
  4. 메모장 초기화 시 DB 저장이 실패해도 "초기화되었습니다"로 안내되던 문제 — 실패 시 에디터를 마지막 저장 내용으로 복원하고 실패 메시지를 표시(화면과 DB 불일치로 새로고침 시 내용이 부활하는 혼란 방지).
  5. 모달 ESC 닫기 미구현 — `AppAPI.choose` 주석에는 ESC 취소가 명시돼 있었으나 실제 핸들러가 없던 문제. `attachEscToClose` 헬퍼를 신설해 `showMessage`/`confirm`/`choose` 모두 ESC로 닫기 지원(모달이 겹치면 최상단만 반응, 닫힐 때 document 리스너 해제).
- 검증: 수정 모듈 3종(main/notepad/app-api) `node --check` 구문 통과, `build.sh` 단일 파일 번들(147.9KB) 재생성 및 번들 구문 검사 통과. 기존 단위 테스트가 import하는 순수 모듈은 변경 없음.

## 2026-06-08

- 빌드 산출물을 `release/index.html` 단일 파일로 단순화. `build.sh`에서 다중 파일 복사 단계(index.html / readme.md / src/*.js / style.css / data-sources/*.js) 제거하고 `bundle.py`만 실행. `bundle.py` 출력 파일명을 `index.single.html` → `index.html`로 변경. `build.bat`도 동일하게 정리하고 cp949 + CRLF로 저장해 Windows cmd 한글 깨짐 방지. 산출물 91.1KB 단일 파일로 검증 완료.
- `readme.md` 빌드 안내를 단일 파일 산출 구조에 맞춰 갱신 (멀티 파일/`index.single.html` 표기 제거).
- 코드 블럭 실행 기능 추가 🧮. 에디터에서 텍스트를 드래그로 선택한 뒤 🧮 버튼 또는 Ctrl+Enter로 실행. 선택이 없으면 커서가 있는 줄을 자동 사용. 결과는 모달로 표시. `src/calc.js` 신규 작성 — 토크나이저/재귀하강 파서/평가기로 구성, 외부 의존 없음. 정수 연산은 BigInt로 5000자리 이상 정확. 지원: 변수 대입(`x = 1+2`), `+`/`-`/`*`/`/`(정확하면 BigInt, 아니면 부동소수점)/`//`(정수 몫), 괄호, 단항 부호, `sin`/`cos`/`tan`(라디안), `factorial(n)` (n ≤ 1000), `#` 주석. 36개 단위 테스트 모두 통과. 모달 본문에 `max-height: 60vh; overflow-y: auto` 추가해 큰 수 결과도 스크롤로 확인 가능.
- 도움말 패널에 코드 실행 예시 9건 추가 (사칙연산/`//`/변수/`factorial`/`sin`+`cos`).
- 코드 실행 결과 모달에 "📥 메모에 삽입" 옵션 추가. 클릭하면 코드 영역 끝에 `# 결과` 주석 라인으로 삽입 — 재실행 시 주석으로 자동 무시되므로 부작용 없음. `AppAPI.choose`를 재사용해 별도 모달 헬퍼 없이 구현. 메인 메모장에서만 활성, 읽기 전용 파일 탭은 단순 결과 모달만 표시. 도움말 패널에도 해당 동작 안내 한 줄 추가.
- 코드 블럭 실행기에 세션 메모리 추가. 모달 옵션 `💾 메모리에 저장`/`🗑️ 메모리 초기화` 신설. 매 실행 시 `calcMemory`가 `initialEnv`로 자동 주입되어 저장된 변수는 다음 실행에서 그대로 사용 가능 (읽기 자동, 쓰기는 명시적 저장만). 메모리에 변수가 있으면 결과 모달 본문 상단에 `[메모리: x, y]` 표기. 페이지 새로고침 시 초기화 (영속 저장 아님). `runCode(source, initialEnv)`가 원본 env를 변형하지 않음을 보장하는 단위 테스트 6건 추가.
- 코드 블럭 메모리를 IndexedDB에 영속 저장. `calc.js`에 `serializeEnv`/`deserializeEnv` 추가 — BigInt는 `{_big: "12345"}`, Number는 `{_num: 3.14}` 마커로 JSON 직렬화해 5000자리 정수까지 손실 없이 보존. 기존 `AppAPI.saveOrUpdateNoteByDate`/`getNoteByDate`를 `CALC_MEMORY_KEY` 키로 재사용 (IndexedDB 실패 시 메모리 폴백 그대로 동작). `Notepad.open()`에서 `await loadCalcMemory()`로 페이지 로드 직후 메모리 복원, 💾/🗑️ 액션 직후 `persistCalcMemory()`로 즉시 저장. 직렬화 라운드트립/잘못된 JSON 방어 단위 테스트 8건 추가.
- `readme.md` 갱신. 주요 기능에 마크다운 미리보기/인코딩 변경/코드 블럭 실행기 항목 추가. 단축키 표에 `Ctrl + Enter` 추가. "코드 블럭 실행 🧮" 섹션 신설(문법/모달 옵션/예시). 폴더 구조에 누락됐던 utils/markdown/encoding/file-utils/calc/data-sources(memory) 등 모듈 보강.
- 절취선(2000자 분할) 버튼 버그 2건 수정. ①절취선이 이미 들어간 메모를 다시 열면 버튼이 ➗(분할)로 잘못 표시되던 문제 — `Notepad.open()`/`resetNotePad()` 끝에 `syncSplitButtonState()`를 추가해 콘텐츠와 버튼 상태를 항상 동기화. ②절취선이 있는 메모를 2000자 이하로 줄이면 ➕ 클릭해도 절취선이 제거되지 않던 문제 — `splitNoteIntoChunks`의 `content.length <= len` 조기 반환이 join 경로까지 막던 것을 분리해, 절취선이 있으면 길이와 무관하게 항상 제거하도록 분기 재구성.
- 헤더 좌측 "📝 ssMemo" 타이틀 제거 — 아이콘 공간 확보. `.note-panel-title` 스팬과 관련 CSS 3곳(기본/모바일 미디어쿼리 2곳) 모두 삭제. 현재 메모 칩(`#current-memo-title`)이 헤더 좌측에 그대로 남아 메모 식별 가능.
- 테스트 인프라/커버리지 정리. ①`runner.js`의 `assertEqual`이 BigInt 결과를 `JSON.stringify`로 비교하다 throw로 깨지던 문제 수정 — `__bigint__` 마커 replacer 적용해 `test-calc.js`의 BigInt 단언이 정상 동작. ②공용 `assertThrows`를 `runner.js`로 승격, `test-calc.js`의 로컬 사본 제거. ③`decideChunkAction`을 `notepad.js`에서 `utils.js`로 추출(순수 함수) 후 `notepad.js`는 호출만 — Bug A/B 회귀를 영구 단위 테스트(8건)로 보호. ④`test-utils.js`에 `nextFrame` resolve 검증 추가. ⑤`test-memory.js`에 신규 `listKeys`/`deleteKey` 테스트 추가(prefix 필터, 미존재 키 삭제 안전성, 삭제 후 빈 레코드). ⑥`test-calc.js`에 빈/공백 입력, BigInt/Number 혼합 산술, 함수 중첩, 단항 `+`, 추가 파서 에러 케이스 보강. 총 약 200건 단언, 681줄.
- 툴바 정리: 파일 관련 아이콘 5개(📋/🗂️/💾/📥/🗑️)를 📁 파일 메뉴 1개로 통합. `Notepad.openFileMenu`가 `AppAPI.choose`를 재사용해 모달로 옵션 제공, 현재 탭(메인/파일)에 따라 [저장]/[메모 비우기]는 메인 전용으로 숨김. `updateButtonsVisibility`에서 더 이상 존재하지 않는 save/download 버튼 참조 제거. 툴바 11개 → 7개로 감소.
- 멀티 메모 기능 추가 (저장/불러오기/이름 변경/삭제). `src/memo-store.js` 신규 — IndexedDB에 `memo:${title}` 키로 저장, 제목 검증/리스트(최근 수정 순)/CRUD/리네임을 캡슐화. 데이터 소스(`IndexedDbSource`/`MemorySource`/`RestSource`)에 `listKeys(prefix)`/`deleteKey(key)` 추가, `AppAPI`에 폴백 처리 포함해 노출. 헤더에 현재 메모 제목 표시(`#current-memo-title`), 툴바 `📋 메모 관리` 버튼 추가 → 모달에서 [➕ 새 메모]/[열기/이름변경/삭제] 액션 제공. 텍스트 입력용 `promptText` 헬퍼 작성. `state.notepad.currentMemoTitle` 추가, 자동 저장은 현재 메모로 향함. 레거시 `NOTEPAD` 단일 메모는 첫 실행 시 `memo:기본 메모`로 마이그레이션 후 옛 키 제거(재실행 안전). `resetNotePad`는 메모 삭제 대신 현재 메모 본문만 비우도록 변경. `validateTitle` 단위 테스트 7건 + 브라우저 라이브 메모 CRUD 테스트 추가.

## 2026-04-28

- 6MB 한글 파일 로드 시 "디코딩 실패 + 로딩 애니메이션 무한 잔류" 버그 수정. 원인 1: `decodeJohab`의 `out += String.fromCharCode(...)` 누적이 6M번 반복되며 모바일 WebView에서 수십 초 동안 메인 스레드를 잠가 사용자 체감으론 "영구 멈춤". → `Uint16Array`에 codepoint를 채운 뒤 청크별 `String.fromCharCode.apply`로 한 번에 합치도록 재작성 (Node 기준 284ms → 71ms, 4배). 원인 2: `nextFrame()`이 페이지 백그라운드 등으로 rAF가 throttle되면 영구 pending → spinner 잔류. `setTimeout(100ms)` fallback 추가. 원인 3: `hideLoading()`이 `try/catch` 밖에 있어 그 사이 다른 예외가 발생하면 도달 못 함. `handleIncomingFile`/`changeEncoding` 모두 `finally` 블록으로 이동. 추가로 `looksGarbled(text)` 휴리스틱(앞 64KB의 U+FFFD 비율 1% 초과)을 도입해 자동 감지가 빗나갔다고 판단되면 결과 메시지에 "🔤 버튼으로 인코딩을 바꿔보세요" 힌트 표시. 단위 테스트 5건 추가.
- 인코딩 자동 감지가 틀렸을 때 수동 변경 메뉴 추가. 파일 슬롯에 원본 `buffer`를 보관하고, 파일 탭 활성 시 툴바에 🔤 버튼 노출. 클릭하면 `AppAPI.choose` 모달이 열려 UTF-8/CP949/Johab 중 선택 가능 — 현재 인코딩은 ✓ 표시 + 초록색 강조. 선택 시 같은 buffer를 `decodeWithEncoding`으로 재디코딩하고 슬롯/에디터/줄번호/마크다운 미리보기를 일괄 갱신. 큰 파일 재디코딩에도 단계별 `nextFrame()` yield를 적용해 메인 스레드 점유 방지. swap 시나리오 단위 테스트 3건 추가.
- 큰 파일 로드 시 메인 스레드 2초 점유 문제 완화. 5MB 파일 로드 후 `decodeKoreanText` → `replace(/\r\n/g)` → `editor.value =` → `refreshLineNumbers` → `switchTab`(`scrollHeight` 측정)이 한 동기 블록으로 붙어 스피너만 떠 있고 터치/스크롤이 멎던 문제. `src/utils.js`에 `nextFrame()` (rAF 기반 yield) 추가하고, `handleIncomingFile` 단계 사이마다 양보. `loadFileToEditor`도 async로 바꿔 `editor.value` 적용 후 한 프레임 양보 후 줄번호 렌더로 진행. 양보는 스피너가 뜨는 임계(파일 ≥200KB) 조건일 때만 활성화해 작은 파일에는 지연 없음.
- 큰 파일 입력 중 줄번호 재계산 비용 추가 절감. (1) `refreshLineNumbers(editor, el)` 헬퍼 도입 — 요소에 `__ssLineCount`를 캐싱하고 줄 수가 같으면 `textContent` 재할당과 `buildLineNumbersText` 호출을 모두 생략. 줄을 추가/삭제하지 않는 일반 키 입력에서 DOM 변경 0회. (2) 메인 에디터 `oninput`의 줄번호 갱신을 50ms trailing-edge debounce로 묶음. 5MB 파일에서 keystroke마다 발생하던 O(n) `countLines` 스캔이 입력이 멈출 때까지 합쳐지므로 입력 끊김 제거. 글자수/스크롤 동기/`isDirty`는 즉시 반영해 사용자 체감 반응성은 그대로 유지. `src/utils.js`에 `debounce(fn, ms)` 순수 함수와 단위 테스트 3건 추가. `updateLineNumbers`/`updateLineNumbersForEditor`/`loadFileToEditor`/`closeFileTab` 4개 경로 모두 새 헬퍼로 통일.
- 큰 파일 줄번호 렌더 성능 개선. 줄당 `<div>` N개 생성 + `innerHTML` 파싱(5000줄 기준 수백 ms 소요) 방식을 단일 텍스트 노드("1\n2\n...\nN")로 교체. `.line-numbers`에 `white-space: pre`를 추가하고 `line-height`(데스크톱 24px / 모바일 20px)를 textarea와 동일하게 유지해 시각적 1:1 정렬을 보존. `<div>`의 `padding-right`(8/6px)를 `.line-numbers` 자체로 이동. `src/utils.js`에 순수 함수 `buildLineNumbersText(count)`와 `notepad.js` 내 `countLines(text)` 헬퍼(`split` 배열 할당 없이 charCode 10 카운트) 추가. 3개 렌더 경로(`updateLineNumbers`/`loadFileToEditor`/`updateLineNumbersForEditor`) 및 `closeFileTab`의 `innerHTML='1'`까지 일괄 정리. 기존 `syncLineNumbersHeight`/스크롤 동기화/끝줄 패딩 보정 그대로 유효. 단위 테스트 4건 추가.

## 2026-04-27

- 마크다운 인라인 HTML 태그 `<b>`/`<i>`/`<u>`/`<br>` 허용 (속성 없는 형태만). `renderInline()`에서 escapeHtml 후의 리터럴 패턴(`&lt;b&gt;` 등)만 원래 태그로 복원하므로, 속성이 붙은 변형(`<b onclick=...>`)은 복원되지 않고 이스케이프 상태로 남아 XSS 차단. `<br>`은 `<br>`/`<br/>`/`<br />` 모두 허용. 단위 테스트 9건 추가.
- 마크다운 `<details>`/`<summary>` 접기 태그 지원. 기존 렌더러는 모든 HTML을 이스케이프해 접기가 동작하지 않던 문제. 정확한 패턴(`<details>`, `<details open>`, `</details>`, `<summary>...</summary>`)만 통과시키고 임의 속성은 차단. `<summary>` 내부는 인라인 마크다운 처리. 단위 테스트 9건 추가.
- 한글 인코딩 자동 감지 추가. `src/encoding.js`에서 UTF-8 → 실패 시 0x84-0xA0 영역 분포로 Johab(조합형) 여부 판정 → 아니면 CP949(EUC-KR)로 폴백. UTF-8/EUC-KR은 브라우저 `TextDecoder`를 쓰고, Johab은 KS X 1001 부속서 3 비트 패턴(`1 IIIII MMMMM FFFFF`)을 직접 디코드. 파일 로드 후 알림 모달에 감지된 인코딩 표시. 단위 테스트 9건 추가.
- 텍스트 파일 마지막 줄 정렬 버그 수정. (1) CRLF/CR 줄 끝을 LF로 정규화해 split 카운트와 textarea 시각 라인 수가 일치하도록 함. (2) `syncLineNumbersHeight` 추가 — 탭이 보이는 상태에서 textarea와 line-numbers의 scrollHeight를 측정해 차이만큼 line-numbers의 padding-bottom을 늘려 끝까지 스크롤해도 줄번호와 본문이 어긋나지 않도록 함. 탭 전환/줄바꿈 토글 후에도 재호출.
- 큰 파일 로딩 스피너 잔류 버그 수정. 스피너 z-index(10000) > 모달(9999)이라 "불러왔습니다" 모달 위를 스피너가 가려 사용자가 확인을 못 누르고 앱이 잠긴 상태가 됐던 문제. 메시지 표시 직전에 `hideLoading()`을 명시 호출하도록 변경.
- 마크다운 표 렌더링 추가 (GFM 형식). `| 헤더 |\n| --- |\n| 셀 |` 패턴을 `<table>/<thead>/<tbody>`로 변환. 셀 정렬(`:---`/`---:`/`:---:`) 지원, 표 외곽 가로 스크롤 가능. 13건 단위 테스트 통과.
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
