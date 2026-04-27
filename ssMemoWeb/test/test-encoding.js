// ========================================
// 한글 인코딩 디코더 단위 테스트
// ========================================
import { decodeKoreanText, decodeWithEncoding } from '../src/encoding.js';
import { assertEqual, section } from './runner.js';

section('encoding.js');

const buf = arr => new Uint8Array(arr).buffer;

// UTF-8 자동 감지
{
    const r = decodeKoreanText(buf([0xEC, 0x95, 0x88, 0xEB, 0x85, 0x95]));
    assertEqual(r.encoding, 'UTF-8', 'UTF-8 자동 감지');
    assertEqual(r.text, '안녕', 'UTF-8 본문 디코드');
}

// CP949 자동 감지 (UTF-8 실패 → CP949)
{
    const r = decodeKoreanText(buf([0xBE, 0xC8, 0xB3, 0xE7]));
    assertEqual(r.encoding, 'CP949', 'CP949 자동 감지');
    assertEqual(r.text, '안녕', 'CP949 본문 디코드');
}

// Johab 자동 감지 (UTF-8 실패 + 0x84-0xA0 영역 다수)
{
    const word = [0xD0, 0x65, 0x8B, 0xAB]; // '한글'
    const arr = [];
    for (let i = 0; i < 5; i++) arr.push(...word);
    const r = decodeKoreanText(buf(arr));
    assertEqual(r.encoding, 'Johab', 'Johab 자동 감지');
    assertEqual(r.text, '한글한글한글한글한글', 'Johab 본문 디코드');
}

// 명시적 Johab 디코드: 다양한 음절
assertEqual(decodeWithEncoding(buf([0x88, 0x61]), 'Johab'), '가', 'Johab 가');
assertEqual(decodeWithEncoding(buf([0xD0, 0x65]), 'Johab'), '한', 'Johab 한');
assertEqual(decodeWithEncoding(buf([0x8B, 0xAB]), 'Johab'), '글', 'Johab 글');

// ASCII 보존
assertEqual(decodeWithEncoding(buf([0x61, 0x88, 0x61, 0x62]), 'Johab'), 'a가b',
    'Johab: ASCII와 한글 혼합');

// 빈 버퍼
assertEqual(decodeKoreanText(buf([])).text, '', '빈 버퍼는 빈 문자열');
