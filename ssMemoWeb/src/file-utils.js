// ========================================
// 파일 검증 헬퍼 (DOM-free, testable)
// ========================================
import { ALLOWED_TEXT_EXTENSIONS, CONSTANTS } from './constants.js';

// 파일명이 허용된 텍스트 확장자 목록 중 하나로 끝나는지 검사 (대소문자 무시)
export function hasAllowedExtension(fileName) {
    if (!fileName) return false;
    const lower = fileName.toLowerCase();
    return ALLOWED_TEXT_EXTENSIONS.some(ext => lower.endsWith(ext));
}

// File 객체가 텍스트로 허용되는지: 확장자 OR MIME이 text/plain
export function isAllowedTextFile(file) {
    if (!file) return false;
    if (hasAllowedExtension(file.name)) return true;
    return file.type === 'text/plain';
}

// 파일 크기가 업로드 상한을 넘는지
export function isOversized(file) {
    if (!file) return false;
    return file.size > CONSTANTS.MAX_FILE_SIZE;
}
