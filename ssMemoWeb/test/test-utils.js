// ========================================
// 순수 유틸 함수 단위 테스트
// 실행: 프로젝트 루트에서 python -m http.server 8001
//       후 http://localhost:8001/test/ 접속
// ========================================
import {
    splitTextIntoChunks,
    joinTextChunks,
    findNextIndex,
    findPrevIndex,
    CHUNK_DELIMITER,
} from '../src/utils.js';
import { assertEqual, section } from './runner.js';

section('utils.js');

assertEqual(
    splitTextIntoChunks('abcdef', 2),
    'ab' + CHUNK_DELIMITER + 'cd' + CHUNK_DELIMITER + 'ef',
    'splitTextIntoChunks: 6글자를 2단위로 나눔'
);
assertEqual(splitTextIntoChunks('abc', 10), 'abc',
    'splitTextIntoChunks: len보다 짧으면 원본 반환');
assertEqual(splitTextIntoChunks('', 5), '',
    'splitTextIntoChunks: 빈 문자열 처리');
assertEqual(splitTextIntoChunks('abc', 0), 'abc',
    'splitTextIntoChunks: len이 0이면 원본 반환');

const sample = 'AAA' + CHUNK_DELIMITER + 'BBB' + CHUNK_DELIMITER + 'CCC';
assertEqual(joinTextChunks(sample), 'AAABBBCCC',
    'joinTextChunks: 모든 delimiter 제거');
assertEqual(joinTextChunks('no-delim'), 'no-delim',
    'joinTextChunks: delimiter 없으면 원본 유지');

const roundTrip = joinTextChunks(splitTextIntoChunks('1234567890', 3));
assertEqual(roundTrip, '1234567890', 'split → join 라운드트립 일치');

assertEqual(findNextIndex('hello world hello', 'hello', 0), 0,
    'findNextIndex: 처음부터 검색');
assertEqual(findNextIndex('hello world hello', 'hello', 5), 12,
    'findNextIndex: 중간부터 검색하면 두 번째 매치');
assertEqual(findNextIndex('hello world hello', 'hello', 13), 0,
    'findNextIndex: 끝부터 검색해 못 찾으면 처음부터 랩어라운드');
assertEqual(findNextIndex('hello', 'xyz', 0), -1,
    'findNextIndex: 매치 없으면 -1');
assertEqual(findNextIndex('', 'a', 0), -1,
    'findNextIndex: 빈 컨텐츠는 -1');
assertEqual(findNextIndex('hello', '', 0), -1,
    'findNextIndex: 빈 쿼리는 -1');

assertEqual(findPrevIndex('hello world hello', 'hello', 16), 12,
    'findPrevIndex: 뒤에서부터 검색');
assertEqual(findPrevIndex('hello world hello', 'hello', 11), 0,
    'findPrevIndex: 두 번째 매치 이전부터 시작하면 첫 매치');
assertEqual(findPrevIndex('hello world hello', 'xyz', 16), -1,
    'findPrevIndex: 매치 없으면 -1');
assertEqual(findPrevIndex('hello', 'h', -1), -1,
    'findPrevIndex: startIndex<0이면 -1');
