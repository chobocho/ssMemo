// ========================================
// file-utils 단위 테스트
// ========================================
import { hasAllowedExtension, isAllowedTextFile, isOversized } from '../src/file-utils.js';
import { CONSTANTS } from '../src/constants.js';
import { assertEqual, section } from './runner.js';

section('file-utils.js');

// hasAllowedExtension
assertEqual(hasAllowedExtension('a.txt'), true, '.txt 허용');
assertEqual(hasAllowedExtension('a.md'), true, '.md 허용');
assertEqual(hasAllowedExtension('A.MD'), true, '확장자 대문자 무시');
assertEqual(hasAllowedExtension('a.exe'), false, '.exe 불허');
assertEqual(hasAllowedExtension(''), false, '빈 문자열 불허');
assertEqual(hasAllowedExtension(null), false, 'null 불허');

// isAllowedTextFile (File 모방 객체 사용)
assertEqual(isAllowedTextFile({ name: 'a.txt', type: '' }), true,
    '확장자 일치하면 허용');
assertEqual(isAllowedTextFile({ name: 'noext', type: 'text/plain' }), true,
    'MIME이 text/plain이면 허용');
assertEqual(isAllowedTextFile({ name: 'noext', type: 'application/octet-stream' }), false,
    '확장자 없고 MIME도 텍스트 아니면 불허');
assertEqual(isAllowedTextFile(null), false, 'null 불허');

// isOversized
assertEqual(isOversized({ size: 1024 }), false, '작은 파일');
assertEqual(isOversized({ size: CONSTANTS.MAX_FILE_SIZE }), false, '경계 같음 OK');
assertEqual(isOversized({ size: CONSTANTS.MAX_FILE_SIZE + 1 }), true,
    '상한 초과는 oversized');
assertEqual(isOversized(null), false, 'null 안전 처리');
