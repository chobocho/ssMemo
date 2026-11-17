// Korean message catalog. The only source file where Korean text is allowed (a test enforces it).
import type { MessageKey } from './en.ts';

export const ko: Readonly<Record<MessageKey, string>> = {
  'diagnostics.title': 'ℹ️ 진단 정보',
  'diagnostics.copy': '📋 복사',
  'diagnostics.copied': '복사했습니다.',
  'diagnostics.copyFailed': '자동으로 복사하지 못했습니다. 목록을 선택해 두었으니 시스템 메뉴에서 복사하세요.',
};
