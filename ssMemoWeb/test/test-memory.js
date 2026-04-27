// ========================================
// MemorySource 단위 테스트
// ========================================
import { MemorySource } from '../src/data-sources/memory.js';
import { assertEqual, section } from './runner.js';

section('data-sources/memory.js');

const ds = new MemorySource();
await ds.init();

// 비어있는 키 조회
const empty = await ds.getNoteByDate('MISSING');
assertEqual(empty.key, 'MISSING', 'getNoteByDate: 빈 키도 key 반환');
assertEqual(empty.content, '', 'getNoteByDate: 비어있을 때 content는 빈 문자열');
assertEqual(empty.updatedAt, null, 'getNoteByDate: 비어있을 때 updatedAt null');

// 저장 후 조회
await ds.saveOrUpdateNoteByDate('K1', 'hello world');
const got = await ds.getNoteByDate('K1');
assertEqual(got.content, 'hello world', '저장한 content 조회');
assertEqual(typeof got.updatedAt === 'string' && got.updatedAt.length > 0, true,
    '저장 후 updatedAt이 ISO 문자열');

// 갱신
await ds.saveOrUpdateNoteByDate('K1', 'updated');
const got2 = await ds.getNoteByDate('K1');
assertEqual(got2.content, 'updated', '같은 키 갱신');
