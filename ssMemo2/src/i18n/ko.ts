// Korean message catalog. The only source file where Korean text is allowed (a test enforces it).
import type { MessageKey } from './en.ts';

export const ko: Readonly<Record<MessageKey, string>> = {
  'diagnostics.title': 'ℹ️ 진단 정보',
  'diagnostics.copy': '📋 복사',
  'diagnostics.copied': '복사했습니다.',
  'diagnostics.copyFailed': '자동으로 복사하지 못했습니다. 목록을 선택해 두었으니 시스템 메뉴에서 복사하세요.',

  'status.saved': '저장됨',
  'status.pending': '저장 전',
  'status.saving': '저장 중…',
  'status.failed': '저장 실패',
  'storage.temporary': '⚠️ 임시 모드',

  'command.newMemo': '새 메모',
  'command.closeTab': '탭 닫기',
  'command.nextTab': '다음 탭',
  'command.previousTab': '이전 탭',

  'tab.close': '{title} 닫기',
  'tab.closeUnsaved': '이 메모를 저장하지 못했습니다. 그래도 닫을까요? 저장되지 않은 변경 내용은 사라집니다.',
  'tab.closeDiscard': '저장하지 않고 닫기',

  'modal.confirm': '확인',
  'modal.cancel': '취소',

  'notice.dismiss': '닫기',
  'notice.temporaryUnavailable': '브라우저 저장소를 쓸 수 없어, 메모는 이 페이지를 닫을 때까지만 유지됩니다.',
  'notice.temporarySafeMode': '안전 모드(?safe)입니다. 저장된 메모를 불러오지 않고, 여기에 입력한 내용도 남지 않습니다.',
  'notice.loadFailed': '저장된 메모를 불러오지 못했습니다. 새 메모로 시작했고, 저장된 메모는 그대로 두었습니다.',
  'notice.corruptRecords': '손상된 메모 기록 {count}개를 건너뛰었습니다.',
  'notice.savedAsCopy': '다른 창에서 이 메모가 바뀌어, 입력한 내용을 "{title}" 메모로 따로 저장했습니다.',
  'notice.saveFailed': '메모를 저장하지 못했습니다. 입력한 내용은 화면에 남아 있지만 저장되지는 않았습니다.',
  'notice.saveFailedQuota': '브라우저 저장 공간이 가득 차서 메모를 저장하지 못했습니다.',
  'notice.connectionLost': '저장소 연결이 끊어졌습니다. 다시 저장하려면 페이지를 새로고침하세요.',
  'notice.tabLimit': '탭은 {max}개까지 열 수 있습니다. 먼저 탭을 하나 닫아 주세요.',
  'notice.memoMissing': '그 메모는 더 이상 존재하지 않습니다.',

  'memo.defaultTitle': '새 메모',
  'memo.conflictCopyTitle': '{title} (충돌 사본)',
};
