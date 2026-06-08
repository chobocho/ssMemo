// ========================================
// 멀티 메모 저장소
// - IndexedDB(또는 폴백)에 `memo:${title}` 키로 저장.
// - 레거시 NOTEPAD 단일 메모를 첫 실행 시 기본 메모로 마이그레이션.
// - 외부에는 title 기반 API만 노출. 키 형식은 본 모듈 내부에서만 다룬다.
// ========================================
import { AppAPI } from './app-api.js';
import { CONSTANTS } from './constants.js';

const PREFIX = CONSTANTS.MEMO_KEY_PREFIX;

const toKey = (title) => PREFIX + title;
const fromKey = (key) => key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key;

// 제목 검증 — 빈 문자열/공백만/내부 키와 충돌 가능한 문자 금지.
export function validateTitle(title) {
    if (typeof title !== 'string') return '제목이 문자열이 아닙니다.';
    const t = title.trim();
    if (!t) return '제목은 비어 있을 수 없습니다.';
    if (t.length > 100) return '제목은 100자 이내여야 합니다.';
    if (t.includes('\n') || t.includes('\r')) return '제목에 줄바꿈을 포함할 수 없습니다.';
    return null;
}

// 모든 메모 목록 반환. updatedAt 내림차순(최근 수정 먼저).
export async function listMemos() {
    const records = await AppAPI.listKeys(PREFIX);
    return records
        .map((r) => ({ title: fromKey(r.key), content: r.content, updatedAt: r.updatedAt }))
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function loadMemo(title) {
    const rec = await AppAPI.getNoteByDate(toKey(title));
    return { title, content: rec?.content || '', updatedAt: rec?.updatedAt || null };
}

export async function saveMemo(title, content) {
    return AppAPI.saveOrUpdateNoteByDate(toKey(title), content);
}

export async function deleteMemo(title) {
    return AppAPI.deleteKey(toKey(title));
}

// 제목 변경 — 새 키로 저장 후 옛 키 삭제 (원자성 X, 단일 사용자 로컬 환경에서 허용).
// 새 제목이 이미 존재하면 거부.
export async function renameMemo(oldTitle, newTitle) {
    if (oldTitle === newTitle) return;
    const existing = await AppAPI.getNoteByDate(toKey(newTitle));
    if (existing?.updatedAt) {
        throw new Error('같은 제목의 메모가 이미 존재합니다.');
    }
    const cur = await AppAPI.getNoteByDate(toKey(oldTitle));
    await AppAPI.saveOrUpdateNoteByDate(toKey(newTitle), cur?.content || '');
    await AppAPI.deleteKey(toKey(oldTitle));
}

// 레거시 NOTEPAD 단일 메모를 멀티 메모로 마이그레이션.
// 이미 멀티 메모가 하나라도 있으면 스킵 (재실행 안전).
// NOTEPAD에 콘텐츠가 있으면 DEFAULT_MEMO_TITLE로 이전, 비어 있어도 빈 기본 메모 생성.
// 반환값: 마이그레이션 후 사용할 기본 메모 title.
export async function ensureAtLeastOneMemo() {
    const memos = await listMemos();
    if (memos.length > 0) return memos[0].title;

    const legacy = await AppAPI.getNoteByDate(CONSTANTS.NOTEPAD_KEY);
    const content = legacy?.content || '';
    const title = CONSTANTS.DEFAULT_MEMO_TITLE;
    await saveMemo(title, content);
    // 레거시 키는 마이그레이션 후 제거 — 다음 부팅에서 빈 회귀 방지.
    try { await AppAPI.deleteKey(CONSTANTS.NOTEPAD_KEY); } catch { /* ignore */ }
    return title;
}
