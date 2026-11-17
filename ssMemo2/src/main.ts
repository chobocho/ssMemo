// Composition root: the only module that touches the real window and wires modules together.
import { readBuildId } from './app/buildInfo.ts';
import { createCommandRegistry } from './app/commands.ts';
import { describeEnvironment } from './app/diagnostics.ts';
import { createDocumentStore } from './app/documentStore.ts';
import { SAVE_STATE_KEYS, describeNotice, describeStorage, temporaryModeKey } from './app/noticeText.ts';
import { createRandomId } from './app/randomId.ts';
import { createSessionStore } from './app/session.ts';
import { adjacentTabId, createTabManager } from './app/tabManager.ts';
import { createWorkspace } from './app/workspace.ts';
import { mountEditorTabs } from './editor/editorTabs.ts';
import { createTranslator, resolveLocale } from './i18n/i18n.ts';
import { isSafeModeRequested, openStorage } from './storage/openStorage.ts';
import { createAppShell } from './ui/appShell.ts';
import { copyToClipboard } from './ui/clipboard.ts';
import { createDiagnosticsPanel } from './ui/diagnosticsPanel.ts';
import { isApplePlatform, readEnvironment } from './ui/environment.ts';
import { createModals } from './ui/modal.ts';
import { createNoticeBar } from './ui/noticeBar.ts';
import { createStatusIndicator } from './ui/statusIndicator.ts';
import { createTabBar } from './ui/tabBar.ts';

const APP_NAME = 'ssMemo2';
const MOUNT_POINT_ID = 'app';
// Save shortly after typing pauses, and at least this often while typing continues.
const AUTOSAVE_IDLE_DELAY_MS = 1500;
const AUTOSAVE_MAX_WAIT_MS = 10_000;

async function start(win: Window): Promise<void> {
  const doc = win.document;
  const mountPoint = doc.getElementById(MOUNT_POINT_ID);
  if (!mountPoint) {
    throw new Error(`Mount point #${MOUNT_POINT_ID} is missing`);
  }

  const locale = resolveLocale(win.navigator.languages);
  // Tells the browser which language the page is in (hyphenation, screen readers, spell check).
  doc.documentElement.lang = locale;
  const t = createTranslator(locale);

  const shell = createAppShell(doc, APP_NAME);
  const status = createStatusIndicator(doc);
  const notices = createNoticeBar(doc, t('notice.dismiss'));
  const modals = createModals(doc, { confirm: t('modal.confirm'), cancel: t('modal.cancel') });
  shell.header.append(status.element);
  shell.noticeHost.append(notices.element);
  mountPoint.append(shell.element);

  // Never rejects: without a usable IndexedDB the app runs on memory, clearly marked as temporary.
  const opened = await openStorage({
    getIndexedDb: () => win.indexedDB,
    safeMode: isSafeModeRequested(win.location.search),
    onConnectionLost: () => notices.show(t('notice.connectionLost')),
  });
  if (opened.mode === 'temporary') {
    status.showTemporaryBadge(t('storage.temporary'));
    notices.show(t(temporaryModeKey(opened.reason)));
    if (opened.error !== undefined) {
      console.warn('[ssMemo2] IndexedDB is unavailable; using temporary storage.', opened.error);
    }
  }

  const facts = { buildId: readBuildId(doc), storage: describeStorage(opened) };
  const diagnostics = createDiagnosticsPanel(doc, t, (text) => copyToClipboard(win, text));
  const refreshDiagnostics = (): void => diagnostics.update(describeEnvironment(readEnvironment(win, facts)));
  // Folding or unfolding the device and opening the on-screen keyboard both change the values.
  win.addEventListener('resize', refreshDiagnostics);
  win.visualViewport?.addEventListener('resize', refreshDiagnostics);
  refreshDiagnostics();
  shell.footer.append(diagnostics.element);

  const tabs = createTabManager();
  let editedSinceStart = false;
  // Mounted after the shell is in the document so the editor can measure its real size at once.
  // It is not focused automatically: on a phone that would pop up the keyboard on every load.
  const editor = mountEditorTabs(shell.editorHost, (tabId) => {
    editedSinceStart = true;
    workspace.handleEdit(tabId);
  });

  const workspace = createWorkspace({
    store: createDocumentStore({
      storage: opened.storage,
      now: () => new Date(),
      createId: () => createRandomId(win.crypto),
      conflictCopyTitle: (title) => t('memo.conflictCopyTitle', { title }),
    }),
    sessionStore: createSessionStore(opened.storage),
    tabs,
    editor,
    createTabId: () => createRandomId(win.crypto),
    defaultTitle: t('memo.defaultTitle'),
    idleDelayMs: AUTOSAVE_IDLE_DELAY_MS,
    maxWaitMs: AUTOSAVE_MAX_WAIT_MS,
    timers: {
      setTimeout: (callback, delayMs) => win.setTimeout(callback, delayMs),
      clearTimeout: (handle) => win.clearTimeout(handle as number),
    },
    onNotice: (notice) => notices.show(describeNotice(notice, t)),
    onSaveStateChange: (state) => status.setSaveState(state === undefined ? '' : t(SAVE_STATE_KEYS[state])),
  });

  // A tab whose changes cannot be saved is closed only after the user agrees to lose them.
  const closeTab = async (tabId: string): Promise<void> => {
    if ((await workspace.closeTab(tabId)) !== 'unsaved') return;
    if (await modals.confirm(t('tab.closeUnsaved'), t('tab.closeDiscard'))) {
      await workspace.closeTab(tabId, true);
    }
  };
  const closeActiveTab = (): void => {
    const activeId = tabs.getActiveId();
    if (activeId !== undefined) void closeTab(activeId);
  };
  const stepTab = (step: 1 | -1): void => {
    const tabId = adjacentTabId(tabs, step);
    if (tabId !== undefined) workspace.activateTab(tabId);
  };

  // Browsers keep Ctrl+T/W/N/Tab for themselves, so tab shortcuts use Alt.
  const commands = createCommandRegistry([
    { id: 'memo.new', labelKey: 'command.newMemo', icon: '➕', shortcuts: ['Alt-n'], run: () => workspace.newMemo() },
    { id: 'tab.close', labelKey: 'command.closeTab', icon: '✕', shortcuts: ['Alt-w'], run: closeActiveTab },
    { id: 'tab.next', labelKey: 'command.nextTab', icon: '▶', shortcuts: ['Alt-PageDown'], run: () => stepTab(1) },
    { id: 'tab.previous', labelKey: 'command.previousTab', icon: '◀', shortcuts: ['Alt-PageUp'], run: () => stepTab(-1) },
  ]);
  const useCommandKey = isApplePlatform(win);
  // One handler on the document, so shortcuts work wherever the focus is (in ssMemoWeb they
  // only worked while the text area had it).
  doc.addEventListener('keydown', (event) => {
    // While a dialog is open, keys belong to the dialog.
    if (doc.querySelector('dialog[open]')) return;
    const command = commands.findByKeyEvent(event, useCommandKey);
    if (!command) return;
    event.preventDefault();
    command.run();
  });

  shell.tabBarHost.append(
    createTabBar(doc, {
      tabs,
      labels: { newMemo: t('command.newMemo'), closeTab: (title) => t('tab.close', { title }) },
      onActivate: (tabId) => workspace.activateTab(tabId),
      onClose: (tabId) => void closeTab(tabId),
      onNew: () => workspace.newMemo(),
    }),
  );

  await workspace.start();

  // Save when the page is hidden or left. A phone browser may never fire "beforeunload", and
  // a save started from there would not be awaited anyway, so that event is only for the warning.
  const saveNow = (): void => {
    void workspace.flushAll();
  };
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') saveNow();
  });
  win.addEventListener('pagehide', saveNow);
  win.addEventListener('beforeunload', (event) => {
    // In temporary mode even a "saved" memo disappears with the page.
    const wouldLoseText = workspace.hasUnsavedChanges() || (opened.mode === 'temporary' && editedSinceStart);
    if (wouldLoseText) event.preventDefault();
  });
}

void start(window);
