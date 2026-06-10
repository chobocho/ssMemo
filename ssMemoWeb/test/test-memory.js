// ========================================
// MemorySource 단위 테스트
// ========================================
import { MemorySource } from '../src/data-sources/memory.js';
import { assertEqual, section } from './runner.js';

section('data-sources/memory.js');

const ds = new MemorySource();
await ds.init();

// 비어있는 키 조회
const empty = await ds.getRecord('MISSING');
assertEqual(empty.key, 'MISSING', 'getRecord: 빈 키도 key 반환');
assertEqual(empty.content, '', 'getRecord: 비어있을 때 content는 빈 문자열');
assertEqual(empty.updatedAt, null, 'getRecord: 비어있을 때 updatedAt null');

// 저장 후 조회
await ds.saveRecord('K1', 'hello world');
const got = await ds.getRecord('K1');
assertEqual(got.content, 'hello world', '저장한 content 조회');
assertEqual(typeof got.updatedAt === 'string' && got.updatedAt.length > 0, true,
    '저장 후 updatedAt이 ISO 문자열');

// 갱신
await ds.saveRecord('K1', 'updated');
const got2 = await ds.getRecord('K1');
assertEqual(got2.content, 'updated', '같은 키 갱신');

// listKeys: 전체와 prefix 필터
const ds2 = new MemorySource();
await ds2.init();
await ds2.saveRecord('memo:a', 'A');
await ds2.saveRecord('memo:b', 'B');
await ds2.saveRecord('NOTEPAD', 'legacy');
await ds2.saveRecord('__CALC_MEMORY__', '{}');

const all = await ds2.listKeys();
assertEqual(all.length, 4, 'listKeys(): prefix 없으면 전체 반환');

const memos = await ds2.listKeys('memo:');
assertEqual(memos.length, 2, 'listKeys("memo:"): 두 메모만 반환');
assertEqual(memos.map((r) => r.key).sort(), ['memo:a', 'memo:b'],
    'listKeys("memo:"): 키 정확');
assertEqual(memos[0].content === 'A' || memos[1].content === 'A', true,
    'listKeys: content도 함께 반환');

const cal = await ds2.listKeys('__');
assertEqual(cal.length, 1, 'listKeys("__"): 내부 키 분리');

// deleteKey
await ds2.deleteKey('memo:a');
const afterDel = await ds2.listKeys('memo:');
assertEqual(afterDel.length, 1, 'deleteKey: 삭제 후 목록에서 사라짐');
assertEqual(afterDel[0].key, 'memo:b', 'deleteKey: 남은 키 정확');

// 존재하지 않는 키 삭제는 안전 (예외 없음)
const deletedMissing = await ds2.deleteKey('nonexistent');
assertEqual(typeof deletedMissing === 'boolean', true,
    'deleteKey: 미존재 키 삭제도 boolean 반환 (throw 없음)');

// 삭제된 키 다시 조회 → 빈 레코드
const reGet = await ds2.getRecord('memo:a');
assertEqual(reGet.content, '', 'getRecord: 삭제된 키는 빈 content');
assertEqual(reGet.updatedAt, null, 'getRecord: 삭제된 키는 updatedAt null');
