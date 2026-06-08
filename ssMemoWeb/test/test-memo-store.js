// ========================================
// 멀티 메모 저장소 단위 테스트
// AppAPI를 메모리 폴백 모드로 구동해 IndexedDB 없이도 동작 검증.
// ========================================
import { MemorySource } from '../src/data-sources/memory.js';
import { CONSTANTS } from '../src/constants.js';
import { assertEqual, section } from './runner.js';

// AppAPI를 직접 import하지 않고, 메모 스토어 함수들이 사용하는 API를 stub.
// memo-store.js는 './app-api.js'에서 AppAPI를 import하므로, 모듈 캐시를 우회하기
// 위해 동적으로 import 후 _internal로 의존성을 주입한다.

section('memo-store.js — validateTitle');

const { validateTitle } = await import('../src/memo-store.js');

assertEqual(validateTitle(''),           '제목은 비어 있을 수 없습니다.', '빈 문자열');
assertEqual(validateTitle('   '),        '제목은 비어 있을 수 없습니다.', '공백만');
assertEqual(validateTitle('정상 제목'),    null, '정상 제목');
assertEqual(validateTitle(123),          '제목이 문자열이 아닙니다.', '숫자');
assertEqual(validateTitle('a\nb'),       '제목에 줄바꿈을 포함할 수 없습니다.', '줄바꿈 포함');
assertEqual(validateTitle('x'.repeat(101)), '제목은 100자 이내여야 합니다.', '100자 초과');
assertEqual(validateTitle('x'.repeat(100)), null, '100자 정확히는 허용');

section('memo-store.js — listMemos / saveMemo / deleteMemo (라이브)');

// 실제 listMemos/saveMemo 등은 AppAPI(IndexedDB or fallback)를 거치는데,
// 브라우저 IndexedDB가 살아있다면 storeName 'notes' 그대로 동작.
// 테스트 격리를 위해 'memo:__test_*' prefix 키만 다루고 끝나면 청소.
const { listMemos, saveMemo, deleteMemo, renameMemo, loadMemo } = await import('../src/memo-store.js');

const T = '__test_' + Date.now() + '_';
const t1 = T + 'a';
const t2 = T + 'b';

// 시작 전 잔여물 청소 (이전 실행 흔적이 있으면).
try { await deleteMemo(t1); } catch {}
try { await deleteMemo(t2); } catch {}

await saveMemo(t1, 'content-a');
await saveMemo(t2, 'content-b');

const loaded = await loadMemo(t1);
assertEqual(loaded.content, 'content-a', 'loadMemo: 저장한 내용 그대로');

const list = await listMemos();
const found = list.filter((m) => m.title === t1 || m.title === t2);
assertEqual(found.length, 2, 'listMemos: 두 메모 모두 조회됨');

// 이름 변경
const t1New = T + 'a-renamed';
await renameMemo(t1, t1New);
const after = await listMemos();
const titles = after.map((m) => m.title);
assertEqual(titles.includes(t1New), true,  'renameMemo: 새 제목 등록됨');
assertEqual(titles.includes(t1),    false, 'renameMemo: 옛 제목 제거됨');
const renamed = await loadMemo(t1New);
assertEqual(renamed.content, 'content-a', 'renameMemo: 내용은 보존');

// 중복 이름 거부
let dupErr = null;
try { await renameMemo(t2, t1New); } catch (e) { dupErr = e; }
assertEqual(dupErr instanceof Error, true, 'renameMemo: 중복 제목 시 throw');

// 삭제
await deleteMemo(t1New);
await deleteMemo(t2);
const finalList = await listMemos();
const stillThere = finalList.filter((m) => m.title === t1New || m.title === t2);
assertEqual(stillThere.length, 0, 'deleteMemo: 삭제 후 목록에서 사라짐');
