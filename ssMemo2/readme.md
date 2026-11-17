# ssMemo2

브라우저에서 동작하는 메모장입니다. 빌드 결과는 `index.html` 파일 하나이고, 실행할 때 외부 서버·CDN·웹 폰트를 전혀 참조하지 않아 폐쇄망에서도 쓸 수 있습니다.

[ssMemoWeb](../ssMemoWeb)을 TypeScript와 CodeMirror 6로 다시 만드는 프로젝트입니다.

## 현재 상태

- **M2(저장과 복원)까지 완료**했습니다. 메모 하나를 편집하면 브라우저 IndexedDB에 자동 저장되고, 다시 열면 가장 최근 메모가 나옵니다. 여러 메모·탭·파일 열기는 아직 없습니다.
- 입력을 멈추고 약 1.5초 뒤, 계속 입력 중이면 늦어도 10초마다 저장합니다. 화면을 가리거나 닫을 때도 저장합니다.
- 같은 메모를 브라우저 탭 두 개에서 고치면, 늦게 저장한 쪽의 내용은 덮어쓰지 않고 "(충돌 사본)" 메모로 따로 저장합니다.
- 저장소를 쓸 수 없으면 **임시 모드**로 동작합니다. 주소 끝에 `?safe`를 붙이면 저장된 데이터를 건드리지 않고 임시 모드로 시작합니다.
- 화면 맨 아래 **ℹ️ 진단 정보**를 펼치면 빌드 ID와 기기 진단 정보가 나옵니다. 문구는 브라우저 언어에 따라 한국어 또는 영어로 나옵니다.
- 전체 계획과 진행 상황은 [TODO.md](TODO.md) 10절 로드맵에 있습니다.

## 필요한 것

- 빌드: Node.js 24 이상과 npm. 처음 한 번은 의존성 설치를 위해 인터넷이 필요합니다.
- 실행: 브라우저만 있으면 됩니다.

## 빌드와 실행

```bash
./build.sh            # Windows는 build.bat
cd release
python -m http.server 8001
```

- 브라우저에서 `http://localhost:8001`로 접속합니다.
  - `127.0.0.1`은 다른 출처로 취급되어 저장 데이터가 따로 관리됩니다.
  - 다른 기기에서 IP 주소로 접속하면 보안 컨텍스트가 아니어서 일부 기능(파일 제자리 저장 등)을 쓸 수 없습니다.
- `release/` 폴더에는 `index.html`만 복사됩니다.
- `./build.sh <폴더>`처럼 대상 폴더를 지정할 수 있습니다. 대상 폴더의 다른 파일은 지우지 않습니다.
- `build.bat`은 바이트와 구조만 검증했고, Windows에서 실제로 실행해 보지는 못했습니다.

## 개발

| 명령 | 하는 일 |
| --- | --- |
| `npm run check` | 타입 검사 (tsc) |
| `npm test` | 단위 테스트 |
| `npm run build` | `dist/index.html` 생성 |
| `npm run test:build` | 빌드 산출물과 빌드 스크립트 검증 |
| `npm run verify` | 위 네 가지를 순서대로 실행 |
| `npm run gen:bat` | `scripts/build.bat.template`에서 `build.bat`(cp949 + CRLF) 재생성 |

- 테스트는 Node 내장 러너로 `.ts` 파일을 그대로 실행합니다. 그래서 소스는 `enum`·`namespace`를 쓰지 않고, 상대 import에 `.ts` 확장자를 붙입니다.
- 타입 검사는 TypeScript 6.x를 씁니다. 7.x는 Android용 실행 파일이 없습니다.
- 빌드는 외부 참조(외부 `src`/`href`, `@import`, `fetch` 등)가 하나라도 있으면 실패합니다.
- `build.bat`은 직접 고치지 말고 템플릿을 고친 뒤 `npm run gen:bat`을 실행하세요.

## 폴더 구조

```
ssMemo2/
├── TODO.md              요구사항과 로드맵
├── history.html         작업 이력
├── build.sh, build.bat  빌드 스크립트
├── scripts/             빌드 도구 (esbuild 번들, 템플릿 인라인, build.bat 생성)
├── src/
│   ├── main.ts          조립 지점
│   ├── app/             DOM 없이 테스트 가능한 로직
│   ├── editor/          CodeMirror 6 설정 (cm6.ts만 CodeMirror를 import)
│   ├── i18n/            한·영 문구 카탈로그
│   ├── storage/         저장소 (IndexedDB, 메모리 폴백)
│   ├── ui/              화면 구성
│   ├── styles/          스타일 (크기 값은 tokens.css에만 정의)
│   └── assets/          파비콘
├── test/
│   ├── unit/            단위 테스트
│   ├── build/           빌드 산출물 테스트
│   ├── helpers/         테스트 공용 코드
│   └── manual/          브라우저 수동 점검표
└── release/index.html   배포 파일
```

## 수동 점검

화면 동작은 자동 테스트가 없습니다. 마일스톤마다 [test/manual/checklist.md](test/manual/checklist.md)로 PC, 폴드 접힘, 폴드 펼침에서 확인합니다.

## 라이선스

상위 폴더의 LICENSE 파일(MIT)을 따릅니다.
