// Composition root: the only module that touches the real window and wires modules together.
import { readBuildId } from './app/buildInfo.ts';
import { createCommandRegistry } from './app/commands.ts';
import type { Command } from './app/commands.ts';
import { describeEnvironment } from './app/diagnostics.ts';
import { createDocumentStore, findTitleProblem } from './app/documentStore.ts';
import { createLocalFiles } from './app/localFiles.ts';
import {
  SAVE_STATE_KEYS,
  describeFileNotice,
  describeNotice,
  describeStorage,
  describeTitleProblem,
  formatEditorStats,
  formatTimestamp,
  temporaryModeKey,
} from './app/noticeText.ts';
import { createRandomId } from './app/randomId.ts';
import { createSessionStore } from './app/session.ts';
import { createSettingsStore, stepEditorFontSize } from './app/settings.ts';
import { formatShortcut } from './app/shortcut.ts';
import type { LanguageSetting, Settings } from './app/settings.ts';
import { adjacentTabId, createTabManager } from './app/tabManager.ts';
import { createWorkspace } from './app/workspace.ts';
import { mountEditorTabs } from './editor/editorTabs.ts';
import { createTranslator, resolveLocale } from './i18n/i18n.ts';
import { TEXT_ENCODINGS } from './lib/encoding.ts';
import type { TextEncoding } from './lib/encoding.ts';
import { isSafeModeRequested, openStorage } from './storage/openStorage.ts';
import type { DocumentMeta } from './storage/storagePort.ts';
import { createAppShell } from './ui/appShell.ts';
import { copyToClipboard } from './ui/clipboard.ts';
import { createCommandMenu } from './ui/commandMenu.ts';
import { createDiagnosticsPanel } from './ui/diagnosticsPanel.ts';
import { isApplePlatform, readEnvironment } from './ui/environment.ts';
import { installFileDrop } from './ui/fileDrop.ts';
import { createFileIo } from './ui/fileIo.ts';
import { createMemoManager } from './ui/memoManager.ts';
import { createModals } from './ui/modal.ts';
import { nextPaint } from './ui/nextPaint.ts';
import { createNoticeBar } from './ui/noticeBar.ts';
import { createStatusBar } from './ui/statusBar.ts';
import { createStatusIndicator } from './ui/statusIndicator.ts';
import { createTabBar } from './ui/tabBar.ts';
import { createToolbar } from './ui/toolbar.ts';

const APP_NAME = 'ssMemo2';
const MOUNT_POINT_ID = 'app';
// Save shortly after typing pauses, and at least this often while typing continues.
const AUTOSAVE_IDLE_DELAY_MS = 1500;
const AUTOSAVE_MAX_WAIT_MS = 10_000;
// The CSS variable the editor theme reads its text size from (see styles/tokens.css).
const EDITOR_FONT_SIZE_VARIABLE = '--editor-font-size';
// Set on the page while files are dragged over it (see styles/layout.css).
const DROP_TARGET_CLASS = 'is-drop-target';
// How long a message that merely confirms something stays on screen.
const INFO_NOTICE_DURATION_MS = 4000;
const MENU_COMMAND_ID = 'app.menu';
// Commands that get a button in the header, in display order. Tabs have their own controls.
const TOOLBAR_COMMAND_IDS: readonly string[] = [
  'memo.manage',
  'file.open',
  'file.save',
  'view.toggleWrap',
  'view.fontSmaller',
  'view.fontLarger',
  'settings.language',
  MENU_COMMAND_ID,
];
// Of those, the ones that leave the header on narrow screens. The menu still lists them.
const SECONDARY_TOOLBAR_COMMAND_IDS: ReadonlySet<string> = new Set([
  'view.toggleWrap',
  'view.fontSmaller',
  'view.fontLarger',
  'settings.language',
]);

async function start(win: Window): Promise<void> {
  const doc = win.document;
  const mountPoint = doc.getElementById(MOUNT_POINT_ID);
  if (!mountPoint) {
    throw new Error(`Mount point #${MOUNT_POINT_ID} is missing`);
  }

  // Storage comes first because the language is a stored setting: nothing can be labelled before
  // it has been read. The connection-lost message therefore gets its text later.
  let reportConnectionLost = (): void => undefined;
  // Never rejects: without a usable IndexedDB the app runs on memory, clearly marked as temporary.
  const opened = await openStorage({
    getIndexedDb: () => win.indexedDB,
    safeMode: isSafeModeRequested(win.location.search),
    onConnectionLost: () => reportConnectionLost(),
  });
  const settingsStore = createSettingsStore(opened.storage);
  let settings = await settingsStore.load();
  // Applies for the rest of this visit even if it cannot be stored.
  const updateSettings = (change: Partial<Settings>): void => {
    settings = { ...settings, ...change };
    void settingsStore.save(settings);
  };

  const useCommandKey = isApplePlatform(win);
  const describeShortcut = (shortcut: string): string => formatShortcut(shortcut, useCommandKey);

  const locale = resolveLocale(win.navigator.languages, settings.language);
  // Tells the browser which language the page is in (hyphenation, screen readers, spell check).
  doc.documentElement.lang = locale;
  const t = createTranslator(locale);

  const shell = createAppShell(doc, APP_NAME);
  const status = createStatusIndicator(doc);
  const notices = createNoticeBar(doc, t('notice.dismiss'), (remove) => win.setTimeout(remove, INFO_NOTICE_DURATION_MS));
  const modals = createModals(doc, { confirm: t('modal.confirm'), cancel: t('modal.cancel') });
  shell.header.append(status.element);
  shell.noticeHost.append(notices.element);
  mountPoint.append(shell.element);

  reportConnectionLost = () => notices.show(t('notice.connectionLost'));
  if (opened.mode === 'temporary') {
    status.showTemporaryBadge(t('storage.temporary'));
    notices.show(t(temporaryModeKey(opened.reason)));
    if (opened.error !== undefined) {
      console.warn('[ssMemo2] IndexedDB is unavailable; using temporary storage.', opened.error);
    }
  }

  const statusBar = createStatusBar(doc);
  const facts = { buildId: readBuildId(doc), storage: describeStorage(opened) };
  const diagnostics = createDiagnosticsPanel(doc, t, (text) => copyToClipboard(win, text));
  const refreshDiagnostics = (): void => diagnostics.update(describeEnvironment(readEnvironment(win, facts)));
  // Folding or unfolding the device and opening the on-screen keyboard both change the values.
  win.addEventListener('resize', refreshDiagnostics);
  win.visualViewport?.addEventListener('resize', refreshDiagnostics);
  refreshDiagnostics();
  shell.footer.append(statusBar.element, diagnostics.element);

  // A custom property, not a size computed here: the stylesheet decides what it applies to.
  const applyEditorFontSize = (sizeRem: number): void => {
    doc.documentElement.style.setProperty(EDITOR_FONT_SIZE_VARIABLE, `${sizeRem}rem`);
  };
  applyEditorFontSize(settings.editorFontSizeRem);

  const tabs = createTabManager();
  let editedSinceStart = false;
  // Mounted after the shell is in the document so the editor can measure its real size at once.
  // It is not focused automatically: on a phone that would pop up the keyboard on every load.
  const editor = mountEditorTabs(
    shell.editorHost,
    {
      onDocChange: (tabId) => {
        editedSinceStart = true;
        workspace.handleEdit(tabId);
      },
      onViewUpdate: () => refreshStatusBar(),
    },
    settings.lineWrapping,
  );

  const refreshStatusBar = (): void => {
    statusBar.setText(formatEditorStats(editor.getStats(), t, workspace.getActiveDocument()?.source));
  };

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

  const fileIo = createFileIo(win);
  const localFiles = createLocalFiles({
    openFile: (file) => workspace.openFile(file),
    onNotice: (notice) => notices.show(describeFileNotice(notice, t), notice.kind === 'file-saved' ? 'info' : 'warning'),
    getText: (tabId) => workspace.getText(tabId),
    saveAs: (suggestedName, bytes) => fileIo.saveAs(suggestedName, bytes),
    confirmConversion: (name, from, to) =>
      modals.confirm(t('file.convertConfirm', { name, from, to }), t('file.convertAccept', { to })),
    markSaved: async (tabId, saved) => {
      await workspace.markSavedToFile(tabId, saved);
      // The encoding shown for the file may have changed, and the editor saw no change to report.
      refreshStatusBar();
    },
    getActiveDocument: () => workspace.getActiveDocument(),
    redecode: (tabId, text, source) => workspace.redecode(tabId, text, source),
    chooseEncoding: (current) =>
      modals.choose<TextEncoding>(
        t('command.encoding'),
        TEXT_ENCODINGS.map((encoding) => ({ label: encoding, value: encoding })),
        current,
      ),
    showLoading: (fileName) => modals.busy(t('file.loading', { name: fileName })),
    yieldToUi: () => nextPaint(win),
  });
  installFileDrop(shell.element, {
    activeClass: DROP_TARGET_CLASS,
    onDrop: (files) => void localFiles.openFiles(files),
  });

  // --- what the commands do ---------------------------------------------------

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

  const openLocalFiles = async (): Promise<void> => {
    await localFiles.openFiles(await fileIo.pickFiles({ multiple: true }));
  };

  const renameMemo = async (meta: DocumentMeta): Promise<void> => {
    const title = await modals.prompt(t('manager.renamePrompt'), {
      initialValue: meta.title,
      validate: (value) => {
        const problem = findTitleProblem(value);
        return problem ? describeTitleProblem(problem, t) : undefined;
      },
    });
    if (title !== undefined) await workspace.renameMemo(meta.id, title);
  };
  const deleteMemo = async (meta: DocumentMeta): Promise<void> => {
    const confirmed = await modals.confirm(t('manager.deleteConfirm', { title: meta.title }), t('manager.delete'));
    if (confirmed) await workspace.deleteMemo(meta.id);
  };
  const showMemoManager = (): void => {
    void modals.open((close) => ({
      title: t('manager.title'),
      content: createMemoManager(doc, {
        labels: {
          newMemo: t('command.newMemo'),
          loading: t('manager.loading'),
          empty: t('manager.empty'),
          failed: t('manager.failed'),
          renameOf: (title) => t('manager.renameOf', { title }),
          deleteOf: (title) => t('manager.deleteOf', { title }),
          details: (meta) => t('manager.details', { time: formatTimestamp(meta.updatedAt, locale), count: meta.length }),
          corrupt: (count) => t('notice.corruptRecords', { count }),
        },
        // Pending edits are written first, so the list shows current sizes and times.
        listMemos: async () => {
          await workspace.flushAll();
          return workspace.listMemos();
        },
        onOpen: async (meta) => {
          await workspace.openMemo(meta.id);
        },
        onRename: renameMemo,
        onDelete: deleteMemo,
        onNew: () => {
          workspace.newMemo();
        },
        close: () => close(),
      }),
    }));
  };

  const toggleLineWrapping = (): void => {
    updateSettings({ lineWrapping: !settings.lineWrapping });
    editor.setLineWrapping(settings.lineWrapping);
    toolbar.refresh();
  };
  const stepFontSize = (direction: 1 | -1): void => {
    const sizeRem = stepEditorFontSize(settings.editorFontSizeRem, direction);
    if (sizeRem === settings.editorFontSizeRem) return;
    updateSettings({ editorFontSizeRem: sizeRem });
    applyEditorFontSize(sizeRem);
    // The editor caches line heights; they are wrong once the text size has changed.
    editor.remeasure();
  };
  const chooseLanguage = async (): Promise<void> => {
    const language = await modals.choose<LanguageSetting>(
      t('command.language'),
      [
        { label: t('language.auto'), value: 'auto' },
        { label: t('language.ko'), value: 'ko' },
        { label: t('language.en'), value: 'en' },
      ],
      settings.language,
    );
    if (language === undefined || language === settings.language) return;
    settings = { ...settings, language };
    await settingsStore.save(settings);
    await workspace.flushAll();
    // Every label on the page was created in the old language; reloading rebuilds them all.
    win.location.reload();
  };

  // Every command except the menu itself, for narrow screens where the toolbar shows only a few.
  const showMenu = (): void => {
    void modals.open((close) => ({
      title: t('command.menu'),
      content: createCommandMenu(doc, {
        commands: commands.list().filter((command) => command.id !== MENU_COMMAND_ID),
        t,
        formatShortcut: describeShortcut,
        // The menu is closed first: the command may open a dialog of its own.
        onPick: (command: Command) => {
          close();
          command.run();
        },
      }),
    }));
  };

  // Browsers keep Ctrl+T/W/N/Tab for themselves, so those shortcuts use Alt. Ctrl+O can be taken over.
  const commands = createCommandRegistry([
    { id: 'memo.manage', labelKey: 'command.manageMemos', icon: '📋', shortcuts: ['Alt-o'], run: showMemoManager },
    { id: 'file.open', labelKey: 'command.openFile', icon: '📂', shortcuts: ['Mod-o'], run: () => void openLocalFiles() },
    { id: 'file.save', labelKey: 'command.saveFile', icon: '💾', shortcuts: ['Mod-s'], run: () => void localFiles.saveToFile(false) },
    {
      id: 'file.saveAs',
      labelKey: 'command.saveFileAs',
      icon: '📑',
      shortcuts: ['Mod-Shift-s'],
      run: () => void localFiles.saveToFile(true),
    },
    { id: 'file.encoding', labelKey: 'command.encoding', icon: '🔤', shortcuts: [], run: () => void localFiles.changeEncoding() },
    { id: 'memo.new', labelKey: 'command.newMemo', icon: '➕', shortcuts: ['Alt-n'], run: () => workspace.newMemo() },
    { id: 'tab.close', labelKey: 'command.closeTab', icon: '✕', shortcuts: ['Alt-w'], run: closeActiveTab },
    { id: 'tab.next', labelKey: 'command.nextTab', icon: '▶', shortcuts: ['Alt-PageDown'], run: () => stepTab(1) },
    { id: 'tab.previous', labelKey: 'command.previousTab', icon: '◀', shortcuts: ['Alt-PageUp'], run: () => stepTab(-1) },
    {
      id: 'view.toggleWrap',
      labelKey: 'command.toggleWrap',
      icon: '↩️',
      shortcuts: ['Alt-z'],
      run: toggleLineWrapping,
      isOn: () => settings.lineWrapping,
    },
    { id: 'view.fontSmaller', labelKey: 'command.fontSmaller', icon: 'A−', shortcuts: [], run: () => stepFontSize(-1) },
    { id: 'view.fontLarger', labelKey: 'command.fontLarger', icon: 'A+', shortcuts: [], run: () => stepFontSize(1) },
    { id: 'settings.language', labelKey: 'command.language', icon: '🌐', shortcuts: [], run: () => void chooseLanguage() },
    { id: MENU_COMMAND_ID, labelKey: 'command.menu', icon: '☰', shortcuts: ['Alt-m'], run: showMenu },
  ]);

  const toolbar = createToolbar(
    doc,
    TOOLBAR_COMMAND_IDS.flatMap((id) => commands.get(id) ?? []),
    t,
    { secondaryIds: SECONDARY_TOOLBAR_COMMAND_IDS, formatShortcut: describeShortcut },
  );
  shell.header.insertBefore(toolbar.element, status.element);

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
