# ssMemo2 구현 계획

> 구현을 시작하기 전에 승인된 계획입니다(2026-11-17). 설계 배경을 남기려고 내용은 그대로 두었습니다.
> 지금의 진행 상황과 남은 일은 [TODO.md](TODO.md) 10절에, 작업 이력은 [history.html](history.html)에 있습니다.
> 파일 이름 같은 세부는 구현하면서 달라진 곳이 있습니다(예: `scripts/build.ts` → `scripts/buildHtml.ts`).

## Context (배경)

- `ssMemo2/`에는 현재 `TODO.md`(요구사항)만 있고 코드는 없다. 전신인 `../ssMemoWeb`(순수 JS + `<textarea>` + 자체 `bundle.py`)을 **TypeScript + CodeMirror 6**로 다시 만드는 작업이다. ("Mirror6" = CodeMirror 6으로 해석)
- 목표 산출물: 실행 시 외부 참조가 전혀 없는 **단일 `index.html`**, IndexedDB 저장·이어하기·전체 JSON 백업, 탭, 로컬 파일 열기/저장, 한·영 다국어, 모바일·폴더블 대응.
- 이번 요청의 범위: TODO.md 기반 계획 수립 → ssMemoWeb의 좋은 아이디어 반영 → 그 계획을 TODO.md에 로드맵으로 기록. 이후 로드맵 순서대로 구현한다.

## 확정된 결정

| 항목 | 결정 |
|---|---|
| 폐쇄망 범위 | **실행만** 폐쇄망. 빌드는 인터넷 되는 기기에서 npm(`package-lock.json`으로 버전 고정) |
| 주석 언어 | 코드 주석·식별자는 **영어**. readme / history / 사용자 응답은 한글 |
| 이식 기능 | 인코딩 감지·전환, 마크다운 미리보기, 개인 단축키·기호·절취선, 계산기 **모두** |
| 계획 기록 | `TODO.md` 끝에 로드맵 절 추가 (기존 0~9절은 수정하지 않음) |

**제가 기본값으로 가정한 것 (다르면 승인 전에 알려 주세요)**

- CP949/Johab 파일을 저장하면 **UTF-8로 저장**하고 그 사실을 안내한다. 줄바꿈(CRLF/LF)과 BOM은 원본대로 유지한다.
- 대상 브라우저는 PC Chrome/Edge, 폴드의 Chrome과 삼성 인터넷. iOS는 되는 만큼만 지원한다.
- 이력은 TODO.md 규칙대로 `history.html`에 기록한다. 커밋 메시지는 영어 Conventional Commits(`feat(ssmemo2): …`).
- `release/index.html`은 마일스톤 완료 때만 커밋한다. `git push`는 마일스톤 보고 때 확인을 받고 실행한다.

## ssMemoWeb에서 가져오는 아이디어

| 구분 | 내용 |
|---|---|
| 그대로 가져옴 | 종료 시 전체 저장(`pagehide`/`visibilitychange`) + 미저장 시에만 이탈 경고 · 대용량 로딩 절차(10MB 제한, 200KB 이상 로딩 표시, 단계 사이 양보, `finally` 정리) · `encoding.js` · `markdown.js` · `calc.js` · `file-utils.js` · 파비콘 base64 내장 · 산출물 검증 테스트 |
| 고쳐서 가져옴 | 저장소 추상화 + 메모리 폴백(→ 상시 상태 배지, 임시 모드에서도 백업 가능) · Promise 모달(→ `<dialog>` 하나로 통일) · 탭(→ "메인 탭" 특례 없이 모든 탭 동일) · 단축키(→ 표 하나에서 키맵과 도움말을 함께 생성) · cp949 `build.bat`(→ 실패 시 중단) |
| 고치는 약점 | 제목이 DB 키라 이름 변경이 비원자적 → 고정 id · 저장 성공을 트랜잭션 완료 전에 보고 → `tx.oncomplete` 기준 · 한글 문자열 약 160곳 하드코딩 → 다국어 카탈로그 · 이어하기가 메모 1개만 복원 → 탭·커서까지 · 터치 영역 32px, 폴더블 미대응 → 재설계 · 프로그램적 편집이 실행 취소를 지움 → CM6 트랜잭션 |
| 가져오지 않음 | 줄번호·검색·줄바꿈 자체 구현(CM6가 대체) · `RestSource` · 수동 모듈 순서 번들러 · 평문 비밀번호가 든 `upload.sh` 방식 |

이식 시 고칠 기존 버그: `markdown.js`는 CRLF 입력에서 제목·목록이 깨짐, `calc.js`는 `constructor` 같은 이름이 오류 대신 계산됨.

## 툴체인과 빌드

- **번들 대상**: `@codemirror/state`, `view`, `commands`, `search` (실측 약 308KB 압축 전 minified). `codemirror` 메타 패키지와 `lang-markdown`은 쓰지 않는다.
- **개발 도구**: `esbuild`, `typescript@~6.0`, `@types/node@^24`, `fake-indexeddb`.
  - TypeScript 7은 Android용 바이너리가 없어 이 기기에서 실행되지 않으므로 6.x를 쓴다.
- **테스트**: Node 24 내장 `node:test` + 네이티브 TS 실행. 테스트 프레임워크 의존성 없음.
  - 그래서 소스는 `enum`/`namespace`/매개변수 프로퍼티를 쓰지 않고, 상대 import는 `.ts`로 끝나며, 타입은 `import type`으로 가져온다 (`erasableSyntaxOnly`, `verbatimModuleSyntax`).
- **tsconfig 2종**: `tsconfig.json`(src, DOM 타입), `tsconfig.test.json`(test·scripts, Node 타입). target/lib는 ES2022.
- **`scripts/build.ts`** — `buildHtml()`을 노출해 테스트에서 직접 호출한다.
  - esbuild IIFE + minify, `charset:'utf8'`, 소스맵 없음. CSS도 esbuild로 묶는다.
  - 템플릿 치환은 함수 치환자로 하고, 자리표시자마다 정확히 1회 치환됐는지 검사한다.
  - 인라인 JS 안의 `<!--`는 `\x3C!--`로 바꾼다. `<meta charset>`은 첫 1024바이트 안에 둔다.
  - 버전 + 내용 해시로 빌드 ID를 넣는다. CodeMirror MIT 고지는 도움말에 싣는다.
  - 산출물: `dist/index.html` → `build.sh`/`build.bat`이 `release/index.html`로 복사.
- **`build.bat`**: UTF-8 템플릿을 원본으로 두고 생성기가 cp949 + CRLF로 만든다. `.gitattributes`에 `build.bat -text`. `call npm …`과 `if errorlevel 1 exit /b 1` 사용.

## 구조

```
ssMemo2/
├── TODO.md  readme.md  history.html  package.json  tsconfig*.json  build.sh  build.bat
├── scripts/   build.ts  makeBuildBat.ts  build.bat.template
├── src/
│   ├── main.ts            조립 지점(전역 변수 없음, 구현체 연결은 여기서만)
│   ├── app/               documentStore  tabManager  sessionStore  settings  autosave  backup  commands
│   ├── storage/           storagePort  memoryStorage  indexedDbStorage  openStorage
│   ├── i18n/              i18n  messages  ko  en
│   ├── lib/               encoding  markdown  calc  fileUtils  chunk  async   (ssMemoWeb 이식, DOM 없음)
│   ├── editor/            cm6(유일한 CM6 import 지점)  editorController  keymap  urlOpen  phrases
│   ├── ui/                appShell  tabBar  toolbar  statusBar  modal  memoManager  helpDialog  preview  loading
│   ├── styles/            tokens.css  layout.css  components.css  editor.css
│   └── assets/favicon.svg   index.template.html
├── test/      unit/*.test.ts   build/*.test.ts   manual/checklist.md
└── release/index.html
```

## 핵심 설계

**저장소 (IndexedDB `ssMemo2` v1)**
- 저장소 3개: `docMeta`(id, kind, title, 시각, 길이, rev, source), `docBody`(id, content), `kv`(세션·설정·계산기 메모리).
  - 목록은 본문을 읽지 않는다. 메타와 본문은 한 트랜잭션으로 쓴다.
- 문서는 한 종류다: `kind: 'memo' | 'file'`, 파일이면 `source{fileName, encoding, eol, hasBom}`. 저장 안 된 로컬 파일도 같은 경로로 자동 저장·복원된다.
- id는 주입된 생성기(`randomUUID`, 없으면 `getRandomValues`)로 만든다. 제목은 필드라서 이름 변경이 `put` 한 번이다.
- 쓰기는 `tx.oncomplete`에서만 성공으로 본다. `onblocked`, `onversionchange`, 용량 초과를 처리한다.
- 폴백은 **열 때만** 결정한다(열기 타임아웃 포함). 세션 도중 빈 메모리 저장소로 바꾸지 않는다.
  - 상태 구분: 사용 불가(임시 모드 배지) · 쓰기 실패(문서는 미저장 유지 + 오류 표시) · 연결 끊김(새로고침 안내) · 손상 레코드(건너뛰고 개수 표시).
  - `?safe` URL로 임시 모드를 강제할 수 있다. 폴백을 직접 확인하는 수단이기도 하다.
- 같은 메모를 브라우저 탭 두 개에서 열면 저장 트랜잭션 안에서 `rev`를 비교하고, 충돌하면 사본으로 저장한 뒤 알린다.

**백업 JSON**
- `{ app, formatVersion, exportedAt, documents[], settings, calcMemory }`. 최상위 절은 선택 항목이고 읽기는 관대하게 한다.
- "교체"는 전체 검증 후 한 트랜잭션으로, "병합"은 덮어쓰지 않고 충돌 시 사본으로 가져온다.

**에디터와 탭**
- `EditorView` 하나, 탭마다 `EditorState` 하나(처음 활성화될 때 생성). `view.setState()`로 교체해 탭별 실행 취소와 선택 영역을 유지한다.
  - 스크롤 위치와 검색어는 교체할 때 넘겨준다. 설정 변경은 현재 뷰와 보관 중인 모든 상태에 적용한다.
- 미저장 여부는 `!state.doc.eq(savedDoc)`. 저장 시점으로 되돌리면 표시가 사라진다.
- Compartment는 줄바꿈·읽기 전용·문구에만 쓴다. 테마와 글자 크기는 CSS 변수로 처리한다.

**명령·단축키·다국어**
- 명령 표 하나에서 CM6 키맵, 툴바, 모바일 메뉴, 도움말을 모두 만든다. ssMemoWeb 단축키를 유지한다.
  - 알려진 충돌: `Ctrl+Shift+Z`(🟩 삽입)가 다시 실행을 가린다. 다시 실행은 `Ctrl+Y`로 두고 도움말에 적는다.
- `ko.ts`/`en.ts` 카탈로그와 `t(key, params)`. 언어는 설정 → `navigator.languages` → 영어 순으로 정한다. CM6 검색 패널 문구도 번역한다.
- 절취선 구분자(`<----------[절취선]---------->`)는 화면 문구가 아니라 문서 데이터이므로 언어와 무관하게 고정한다.

**파일**
- 다중 선택과 다중 드래그 앤 드롭으로 연다. 저장은 File System Access API가 있으면 제자리 저장, 없으면 다운로드.
- 원본 바이트는 메모리에만 두고, 편집했거나 세션 복원된 뒤에는 재디코딩을 막는다.

**화면**
- 뷰포트 메타에 `viewport-fit=cover`, `interactive-widget=resizes-content`. 높이는 `100dvh`, 여백은 `env(safe-area-inset-*)`.
- 토큰(CSS 변수)으로 크기를 정하고 터치 영역은 44px 이상. 폭 3단계(접힘·폰 / 펼친 폴드 / PC).
  - 실제 분기 폭은 M0에서 폴드의 접힘·펼침 뷰포트와 DPR을 확인한 뒤 확정한다.
- 아이콘은 이모지와 SVG만 쓴다. 좌표를 JS에서 지정하지 않는다.

## 로드맵 (항목 하나 = 커밋 하나, 실패하는 검사를 먼저 작성)

**Phase 0 — 기록·스캐폴드 → M0: 빌드 ID와 진단 정보가 보이는 페이지**
- 0.1 `TODO.md`에 10절(로드맵)·11절(가져온 아이디어) 추가, `.gitignore`, `history.html` 뼈대
- 0.2 `package.json`·lockfile·tsconfig 2종·샘플 테스트
- 0.3 빌드 파이프라인(`fillTemplate`, `buildHtml`) + 산출물 가드 테스트
- 0.4 `build.sh` + `build.bat` 생성기 + 바이트 검증 테스트 + `.gitattributes`
- 0.5 규칙 가드 테스트 + 진단 블록 + readme 뼈대

**Phase 1 — 워킹 스켈레톤 → M1: 에디터가 화면에 뜸**
- 1.1 디자인 토큰 + 반응형 레이아웃 셸
- 1.2 CodeMirror 6 마운트(줄번호·실행 취소·기본 키맵)

**Phase 2 — 저장 → M2: 새로고침해도 유지**
- 2.1 i18n · 2.2 StoragePort + MemoryStorage + 공용 계약 테스트 · 2.3 IndexedDbStorage CRUD
- 2.4 IndexedDB 실패 처리(abort, blocked, 손상 레코드, 용량, rev 충돌) · 2.5 저장소 열기 폴백 + `?safe`
- 2.6 documentStore · 2.7 autosave 스케줄러
- 2.8 메모 1개 연결(부팅 복원, 자동 저장, 종료 시 저장, 이탈 경고, 상태 배지)

**Phase 3 — 탭·관리 UI → M3: 여러 메모를 탭으로**
- 3.1 명령 레지스트리 · 3.2 tabManager · 3.3 탭별 EditorState 교체 · 3.4 settings · 3.5 sessionStore
- 3.6 모달 시스템 · 3.7 탭 바 · 3.8 메모 관리 · 3.9 상태바 + 줄바꿈 토글 + 언어 전환

**Phase 4 — 파일·백업 → M4**
- 4.1 `encoding.ts` 이식(+UTF-16 BOM) · 4.2 BOM/EOL 감지·보존 · 4.3 파일 열기 파이프라인
- 4.4 인코딩 전환 UI · 4.5 로컬 저장 · 4.6 백업 내보내기 · 4.7 백업 가져오기 · 4.8 백업 UI · 4.9 5MB 성능 점검

**Phase 5 — ssMemoWeb 이식 기능 → M5**
- 5.1 검색 · 5.2 앱 키맵 + 충돌 테스트 · 5.3 기호 삽입 + 구분선 · 5.4 도움말(명령 표에서 생성)
- 5.5 절취선 분할/합치기 · 5.6 `markdown.ts` 이식 · 5.7 미리보기 패널(넓은 화면은 나란히)
- 5.8 `calc.ts` 이식 · 5.9 계산 실행 + 결과 모달 + 변수 메모리 · 5.10 URL 열기

**Phase 6 — 마감 → M6: 릴리스**
- 6.1 모바일·폴더블 다듬기 · 6.2 접근성 · 6.3 readme 완성 · 6.4 릴리스 빌드 커밋

**Phase 7 — 추가 아이디어 (TODO 9절의 웹 검색 포함, 채택 여부는 M6에서 확인)**
- 저장소 영속 요청(`navigator.storage.persist`) · 다크/라이트 테마 · 휴지통 · Web Share · 백업 알림 · ssMemoWeb 구 데이터 가져오기 · CSP 메타

## 진행 방식

- 승인 후 첫 작업은 **Phase 0 전체(M0까지)** 이고, M0에서 멈춰 보고한다.
- 마일스톤 안에서는 항목마다 "테스트 작성(RED) → 구현(GREEN) → 검증 → `history.html` 기록 → 커밋"을 확인 없이 이어간다. 모호한 점이나 파괴적 작업이 나오면 멈춘다.
- `history.html`은 새 항목을 첫 `<h2>` 위에 넣는다. 항목당 12줄/800자 이하, 30개 또는 40KB를 넘으면 `history/archive/`로 옮긴다.

## 검증

- 항목마다: `npm run check`(tsc) → `npm test`(단위) → `npm run build` → 산출물 가드 테스트.
- 가드 테스트가 보는 것: 단일 파일, 외부 `src=`/`href=`/`@import`/`fetch(`/동적 `import(` 없음, 자리표시자 전부 치환, 두 번 빌드해도 같은 결과, 크기 상한, `build.bat`이 cp949 + CRLF.
- **화면은 이 환경에서 자동 검증할 수 없다(브라우저 없음).** 마일스톤마다 `test/manual/checklist.md`(항목 10개 이하, PC / 접힘 / 펼침 칸)로 직접 확인을 부탁드린다.
  - 실행: `./build.sh && cd release && python -m http.server 8001` 후 `http://localhost:8001`.
  - 실패한 항목 번호와 도움말의 진단 정보(복사 버튼)를 알려 주면 다음 Phase 전에 고친다.

## 알려 둘 제약

- `http://localhost:8001`로 접속해야 한다. `127.0.0.1`은 다른 출처라 DB가 따로이고, LAN IP로 접속하면 보안 컨텍스트가 아니라 제자리 저장이 안 된다.
- Node의 `euc-kr` 디코더는 브라우저와 달리 CP949 확장 글자를 못 읽는다. 그 부분은 단위 테스트 대신 수동 점검 항목으로 확인한다.
- 일부 단축키(`Ctrl+N` 등)는 브라우저가 선점해 동작하지 않을 수 있다. 도움말에 표시한다.
