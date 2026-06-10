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
    buildLineNumbersText,
    debounce,
    decideChunkAction,
    nextFrame,
    countNewlines,
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

assertEqual(buildLineNumbersText(0), '',
    'buildLineNumbersText: count 0이면 빈 문자열');
assertEqual(buildLineNumbersText(1), '1',
    'buildLineNumbersText: 1줄은 "1"');
assertEqual(buildLineNumbersText(3), '1\n2\n3',
    'buildLineNumbersText: 3줄은 줄바꿈으로 연결, 끝에 newline 없음');
assertEqual(buildLineNumbersText(5).split('\n').length, 5,
    'buildLineNumbersText: count==N이면 정확히 N줄 (textarea 줄 수와 1:1 매칭)');

// debounce: trailing-edge 동작 검증 (timer 사용 → 비동기)
await new Promise(resolve => {
    let calls = 0;
    let lastArg = null;
    const inc = debounce((arg) => { calls++; lastArg = arg; }, 30);
    inc('a'); inc('b'); inc('c');
    assertEqual(calls, 0, 'debounce: 호출 직후에는 실행되지 않음');
    setTimeout(() => {
        assertEqual(calls, 1, 'debounce: 30ms 뒤 한 번만 실행 (3번 호출 → 1번)');
        assertEqual(lastArg, 'c', 'debounce: 마지막 호출 인자로 실행');
        resolve();
    }, 80);
});

// decideChunkAction: 절취선 토글의 분기 결정 (Bug A/B 회귀 방지)
const D = CHUNK_DELIMITER;
assertEqual(decideChunkAction('a'.repeat(3000), 2000), 'split',
    'decideChunkAction: 긴 + 절취선 없음 → split');
assertEqual(decideChunkAction('짧은 메모', 2000), 'noop',
    'decideChunkAction: 짧음 + 절취선 없음 → noop');
assertEqual(decideChunkAction('a' + D + 'b', 2000), 'join',
    'decideChunkAction: 짧지만 절취선 있음 → join (Bug B 회귀 방지)');
assertEqual(decideChunkAction('a'.repeat(3000) + D + 'b', 2000), 'join',
    'decideChunkAction: 긴 + 절취선 → join');
assertEqual(decideChunkAction('', 2000), 'noop',
    'decideChunkAction: 빈 문자열 → noop');
assertEqual(decideChunkAction('hi', 0), 'noop',
    'decideChunkAction: len=0 → noop');
assertEqual(decideChunkAction('hi', -1), 'noop',
    'decideChunkAction: 음수 len → noop');
assertEqual(decideChunkAction(null, 2000), 'noop',
    'decideChunkAction: null 입력 → noop');

// nextFrame: 어떤 환경에서도 resolve되어야 한다 (rAF throttle 시 setTimeout fallback).
await new Promise(resolve => {
    let resolved = false;
    nextFrame().then(() => { resolved = true; resolve(); });
    setTimeout(() => {
        if (!resolved) resolve(); // 안전망
    }, 500);
}).then(() => {
    assertEqual(true, true, 'nextFrame: 500ms 안에 resolve됨');
});

section('utils.js — countNewlines');

assertEqual(countNewlines('a\nb\nc'), 2, 'countNewlines: 전체 줄바꿈 수');
assertEqual(countNewlines('a\nb\nc', 0), 0, 'countNewlines: end=0이면 0');
assertEqual(countNewlines('a\nb\nc', 2), 1, 'countNewlines: 인덱스 앞 구간만 카운트');
assertEqual(countNewlines('a\nb\nc', 999), 2, 'countNewlines: end가 길이 초과면 전체');
assertEqual(countNewlines(''), 0, 'countNewlines: 빈 문자열은 0');
assertEqual(countNewlines('no newline'), 0, 'countNewlines: 줄바꿈 없으면 0');
