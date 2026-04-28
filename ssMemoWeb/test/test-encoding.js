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

// 사용자 수동 인코딩 변경 시나리오: 같은 buffer를 재디코딩해 손상된 텍스트가 회복되어야 한다
{
    const cp949bytes = buf([0xBE, 0xC8, 0xB3, 0xE7]); // '안녕'을 CP949로
    const auto = decodeKoreanText(cp949bytes);
    assertEqual(auto.encoding, 'CP949', '재디코딩 시나리오: CP949 자동 감지 sanity');
    // 사용자가 (잘못) UTF-8을 골라도 throw 없이 문자열을 반환해야 한다
    const wrongPick = decodeWithEncoding(cp949bytes, 'UTF-8');
    assertEqual(typeof wrongPick, 'string',
        '재디코딩 시나리오: 잘못된 인코딩 강제 선택도 문자열로 폴백');
    // 다시 CP949로 명시 선택하면 같은 buffer로부터 본문 복구
    assertEqual(decodeWithEncoding(cp949bytes, 'CP949'), '안녕',
        '재디코딩 시나리오: 같은 buffer를 명시 CP949로 재디코딩하면 본문 회복');
}
