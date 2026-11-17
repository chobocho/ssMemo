// Composition root: the only module that touches the real window and wires modules together.
import type { ImportMode } from './app/backup.ts';
import { createBackupActions } from './app/backupActions.ts';
import { createCalcActions } from './app/calcActions.ts';
import type { CalcDialogAction } from './app/calcActions.ts';
import { readBuildId } from './app/buildInfo.ts';
import { COMMAND_DEFINITIONS, COMMAND_GROUPS, SYMBOL_COMMAND_IDS, bindCommands, iconOf } from './app/commandTable.ts';
import type { CommandId } from './app/commandTable.ts';
import { createCommandRegistry } from './app/commands.ts';
import type { Command } from './app/commands.ts';
import { describeEnvironment } from './app/diagnostics.ts';
import { createDocumentStore, findTitleProblem } from './app/documentStore.ts';
import { buildHelpGroups } from './app/helpContent.ts';
import { formatThirdPartyNotices } from './app/licenses.ts';
import { createLocalFiles } from './app/localFiles.ts';
import { createPreview } from './app/preview.ts';
import {
  SAVE_STATE_KEYS,
  describeBackupNotice,
  describeBackupSummary,
  describeCalcError,
  describeCalcNotice,
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
import { describeStorageFacts, readStorageFacts, requestPersistence } from './app/storageDurability.ts';
import type { StorageFacts } from './app/storageDurability.ts';
import { formatShortcut } from './app/shortcut.ts';
import type { LanguageSetting, Settings } from './app/settings.ts';
import { adjacentTabId, createTabManager } from './app/tabManager.ts';
import { createWorkspace } from './app/workspace.ts';
import {
  getCodeToRun,
  getSelectedUrl,
  getUrlToOpen,
  insertDivider,
  insertResultLines,
  insertText,
  toggleChunks,
} from './editor/editorActions.ts';
import { mountEditorTabs } from './editor/editorTabs.ts';
import { createSearchPhrases } from './editor/searchPhrases.ts';
import type { MessageKey } from './i18n/en.ts';
import { createTranslator, resolveLocale } from './i18n/i18n.ts';
import { CHUNK_DELIMITER, CHUNK_LABEL, DEFAULT_CHUNK_LENGTH } from './lib/chunks.ts';
import { TEXT_ENCODINGS } from './lib/encoding.ts';
import { escapeHtml, renderMarkdown } from './lib/markdown.ts';
import type { TextEncoding } from './lib/encoding.ts';
import { isSafeModeRequested, openStorage } from './storage/openStorage.ts';
import type { DocumentMeta } from './storage/storagePort.ts';
import { createAppShell } from './ui/appShell.ts';
import { createCalcErrorContent, createCalcResultContent } from './ui/calcDialog.ts';
import { copyToClipboard } from './ui/clipboard.ts';
import { createCommandMenu } from './ui/commandMenu.ts';
import { createDiagnosticsPanel } from './ui/diagnosticsPanel.ts';
import { isApplePlatform, readEnvironment } from './ui/environment.ts';
import { installFileDrop } from './ui/fileDrop.ts';
import { createFileIo } from './ui/fileIo.ts';
import { createHelpContent } from './ui/helpDialog.ts';
import { createMemoManager } from './ui/memoManager.ts';
import { createModals } from './ui/modal.ts';
import { nextPaint } from './ui/nextPaint.ts';
import { createPreviewPane } from './ui/previewPane.ts';
import { createNoticeBar } from './ui/noticeBar.ts';
import { createStatusBar } from './ui/statusBar.ts';
import { createStatusIndicator } from './ui/statusIndicator.ts';
import { createTabBar } from './ui/tabBar.ts';
import { createToolbar } from './ui/toolbar.ts';
import type { ToolbarTier } from './ui/toolbar.ts';

const APP_NAME = 'ssMemo2';
const MOUNT_POINT_ID = 'app';
// The page's built-in message for a failed start (see index.template.html and styles/boot.css).
const BOOT_MESSAGE_ID = 'boot-message';
const BOOT_FAILED_CLASS = 'boot-failed';
// Save shortly after typing pauses, and at least this often while typing continues.
const AUTOSAVE_IDLE_DELAY_MS = 1500;
const AUTOSAVE_MAX_WAIT_MS = 10_000;
// The CSS variable the editor theme reads its text size from (see styles/tokens.css).
const EDITOR_FONT_SIZE_VARIABLE = '--editor-font-size';
// Set on the page while files are dragged over it (see styles/layout.css).
const DROP_TARGET_CLASS = 'is-drop-target';
// How long a message that merely confirms something stays on screen.
const INFO_NOTICE_DURATION_MS = 4000;
// What the file dialog for importing a backup is limited to.
const BACKUP_FILE_TYPES = '.json,application/json';
// Set on the main area while the Markdown preview is on (see styles/layout.css).
const PREVIEWING_CLASS = 'is-previewing';
// Shown in the diagnostics until the browser has answered, and for good where it cannot be asked.
const UNKNOWN_STORAGE_FACTS: StorageFacts = { durability: 'unknown', usageBytes: undefined, quotaBytes: undefined };
// A page opened from a memo gets no handle on this page and is not told where it was opened from.
const NEW_TAB_FEATURES = 'noopener,noreferrer';
const FINE_POINTER_QUERY = '(pointer: fine)';
// The preview follows typing after this pause, and gives up on memos longer than this: rendering
// them would stall a phone at every pause.
const PREVIEW_DELAY_MS = 300;
const PREVIEW_MAX_CHARACTERS = 500_000;
const MENU_COMMAND_ID: CommandId = 'app.menu';
// Commands that get a button in the header, in display order. Tabs have their own controls.
const TOOLBAR_COMMAND_IDS: readonly CommandId[] = [
  'memo.manage',
  'file.open',
  'file.save',
  'search.open',
  'view.preview',
  'view.toggleWrap',
  'view.fontSmaller',
  'view.fontLarger',
  'settings.language',
  'help.show',
  MENU_COMMAND_ID,
];
// From which screen width a button is shown; the ones not listed are always there. The cover
// screen of a foldable has room for four, the unfolded screen (about 580 CSS px) for seven. The
// menu lists every command at any width.
const TOOLBAR_TIERS: ReadonlyMap<string, ToolbarTier> = new Map<CommandId, ToolbarTier>([
  ['search.open', 'medium'],
  ['view.preview', 'medium'],
  ['help.show', 'medium'],
  ['view.toggleWrap', 'wide'],
  ['view.fontSmaller', 'wide'],
  ['view.fontLarger', 'wide'],
  ['settings.language', 'wide'],
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
  const facts = { buildId: readBuildId(doc), storage: describeStorage(opened), storageDurability: describeStorageFacts(UNKNOWN_STORAGE_FACTS) };
  const diagnostics = createDiagnosticsPanel(doc, t, (text) => copyToClipboard(win, text));
  const refreshDiagnostics = (): void => diagnostics.update(describeEnvironment(readEnvironment(win, facts)));
  // Folding or unfolding the device and opening the on-screen keyboard both change the values.
  win.addEventListener('resize', refreshDiagnostics);
  win.visualViewport?.addEventListener('resize', refreshDiagnostics);
  refreshDiagnostics();
  // The diagnostics live in the help dialog; the footer is one line, so the editor keeps the room.
  shell.footer.append(statusBar.element);

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
      onViewUpdate: () => {
        refreshStatusBar();
        // Also called for cursor movements; the preview itself checks whether the text changed.
        preview.contentMayHaveChanged();
      },
    },
    { lineWrapping: settings.lineWrapping, phrases: createSearchPhrases(t), ariaLabel: t('editor.label') },
  );

  const timers = {
    setTimeout: (callback: () => void, delayMs: number): number => win.setTimeout(callback, delayMs),
    clearTimeout: (handle: unknown): void => win.clearTimeout(handle as number),
  };

  const previewPane = createPreviewPane(doc, {
    label: t('preview.label'),
    backLabel: t('preview.back'),
    onBack: () => {
      if (preview.isEnabled()) togglePreview();
    },
  });
  shell.previewHost.append(previewPane.element);
  const preview = createPreview({
    getContentKey: () => editor.getContentKey(),
    getText: () => {
      const tabId = editor.getActiveTabId();
      return tabId === undefined ? undefined : editor.getText(tabId);
    },
    render: renderMarkdown,
    show: (html) => previewPane.setHtml(html),
    tooLongHtml: (max) => `<p>${escapeHtml(t('preview.tooLong', { max }))}</p>`,
    maxLength: PREVIEW_MAX_CHARACTERS,
    delayMs: PREVIEW_DELAY_MS,
    timers,
  });

  // In temporary mode nothing is stored in the browser, so there is nothing to ask about.
  const storageManager = opened.mode === 'persistent' ? win.navigator.storage : undefined;
  const refreshStorageFacts = async (): Promise<void> => {
    facts.storageDurability = describeStorageFacts(await readStorageFacts(storageManager));
    refreshDiagnostics();
  };
  let persistenceRequested = false;
  // Once something of the user's is stored, the browser is asked not to evict it. Whether it
  // agrees is its decision (see storageDurability.ts); the answer shows up in the diagnostics.
  const protectStoredMemos = (): void => {
    if (persistenceRequested) return;
    persistenceRequested = true;
    void requestPersistence(storageManager).then(refreshStorageFacts);
  };
  void refreshStorageFacts();

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
    timers,
    onNotice: (notice) => notices.show(describeNotice(notice, t)),
    onSaveStateChange: (state) => {
      status.setSaveState(state === undefined ? '' : t(SAVE_STATE_KEYS[state]));
      if (state === 'saved') protectStoredMemos();
    },
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
  // The whole page takes drops, dialogs included: a file dropped anywhere else makes the browser
  // leave the app to show that file. While a dialog is open the drop is swallowed, not opened.
  installFileDrop(doc.body, {
    activeClass: DROP_TARGET_CLASS,
    onDrop: (files) => {
      if (!doc.querySelector('dialog[open]')) void localFiles.openFiles(files);
    },
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

  const backups = createBackupActions({
    storage: opened.storage,
    getSettings: () => settings,
    saveSettings: (imported) => settingsStore.save(imported),
    flushAll: () => workspace.flushAll(),
    saveAs: (suggestedName, bytes) => fileIo.saveAs(suggestedName, bytes),
    pickFile: async () => (await fileIo.pickFiles({ multiple: false, accept: BACKUP_FILE_TYPES }))[0],
    chooseMode: (summary) => {
      const choices: { label: string; value: ImportMode }[] = [{ label: t('backup.merge'), value: 'merge' }];
      // Replacing ends with a reload, and in temporary mode a reload would drop what was just imported.
      if (opened.mode === 'persistent') choices.push({ label: t('backup.replace'), value: 'replace' });
      return modals.choose<ImportMode>(describeBackupSummary(summary, t, locale), choices);
    },
    confirmReplace: (count) => modals.confirm(t('backup.replaceConfirm', { count }), t('backup.replaceAccept')),
    showBusy: () => modals.busy(t('backup.busy')),
    onNotice: (notice) => {
      // A complete export or import is merely confirmed; everything else needs to be read.
      const isPlainSuccess =
        (notice.kind === 'backup-exported' && notice.unreadable === 0) || (notice.kind === 'backup-imported' && notice.skipped === 0);
      notices.show(describeBackupNotice(notice, t), isPlainSuccess ? 'info' : 'warning');
    },
    // Tabs, titles and settings on screen all describe the memos that were just replaced.
    restart: () => win.location.reload(),
    now: () => new Date(),
    createId: () => createRandomId(win.crypto),
    buildId: facts.buildId,
    defaultTitle: t('memo.defaultTitle'),
    copyTitle: (title) => t('backup.importedCopyTitle', { title }),
  });

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
  const togglePreview = (): void => {
    const previewing = !preview.isEnabled();
    shell.main.classList.toggle(PREVIEWING_CLASS, previewing);
    preview.setEnabled(previewing);
    // The editor was hidden or changed its width; what it measured before no longer holds.
    editor.remeasure();
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

  // Edits made from a button or the menu leave the focus there; typing should go on in the memo.
  const editInPlace = (build: Parameters<typeof editor.apply>[0]): void => {
    editor.apply(build);
    editor.focus();
  };
  const symbolCommands = Object.fromEntries(
    SYMBOL_COMMAND_IDS.map((id) => [id, () => editInPlace((state) => insertText(state, iconOf(id)))]),
  ) as Record<(typeof SYMBOL_COMMAND_IDS)[number], () => void>;

  const hasCutLines = (): boolean => {
    const tabId = editor.getActiveTabId();
    return tabId !== undefined && (editor.getText(tabId) ?? '').includes(CHUNK_DELIMITER);
  };
  const toggleCutLines = (): void => {
    let action = 'none';
    editor.apply((state) => {
      const toggle = toggleChunks(state, DEFAULT_CHUNK_LENGTH);
      action = toggle.action;
      return toggle.spec;
    });
    if (action === 'none') notices.show(t('notice.chunksNotNeeded', { count: DEFAULT_CHUNK_LENGTH }), 'info');
    // With the cut line as the search text, "find next" jumps from part to part.
    if (action === 'split') editor.searchFor(CHUNK_LABEL);
  };

  const openUrl = (url: string): void => {
    win.open(url, '_blank', NEW_TAB_FEATURES);
  };
  const openUrlAtCursor = (): void => {
    const url = editor.read(getUrlToOpen);
    if (url === undefined) notices.show(t('notice.noUrl'), 'info');
    else openUrl(url);
  };
  // As in ssMemoWeb, a right click on a selected address opens it. Only with a mouse: on a touch
  // screen this event is the long press that selects text, and opening a page would get in its way.
  shell.editorHost.addEventListener('contextmenu', (event) => {
    const pointerType = (event as PointerEvent).pointerType as string | undefined;
    const isMouse = pointerType ? pointerType === 'mouse' : win.matchMedia(FINE_POINTER_QUERY).matches;
    const url = isMouse ? editor.read(getSelectedUrl) : undefined;
    if (url === undefined) return;
    event.preventDefault();
    openUrl(url);
  });

  const calc = createCalcActions({
    storage: opened.storage,
    getCode: () => editor.read(getCodeToRun),
    insertResult: (end, lines) => editInPlace((state) => insertResultLines(state, end, lines)),
    showResult: (view) =>
      modals.open<CalcDialogAction>((close) => ({
        title: t('calc.title'),
        content: createCalcResultContent(
          doc,
          view,
          {
            memory: (names) => t('calc.memory', { names }),
            noOutput: t('calc.noOutput'),
            insert: t('calc.insert'),
            save: t('calc.save'),
            clear: t('calc.clear'),
            close: t('modal.close'),
          },
          close,
        ),
      })),
    showError: async (code, detail) => {
      await modals.open((close) => ({
        title: t('calc.errorTitle'),
        content: createCalcErrorContent(doc, describeCalcError(code, detail, t), t('modal.close'), () => close()),
      }));
    },
    onNotice: (notice) => notices.show(describeCalcNotice(notice, t), notice.kind === 'calc-nothing-to-run' ? 'info' : 'warning'),
  });

  const showHelp = (): void => {
    refreshDiagnostics();
    // The usage may have grown since the page was opened; the panel updates when the answer is in.
    void refreshStorageFacts();
    void modals.open(() => ({
      title: t('command.help'),
      content: createHelpContent(doc, {
        groups: buildHelpGroups(COMMAND_DEFINITIONS, COMMAND_GROUPS, t, describeShortcut),
        notesTitle: t('help.notes'),
        notes: [
          t('help.note.autosave'),
          t('help.note.files'),
          t('help.note.redo', { redo: describeShortcut('Mod-y'), symbol: describeShortcut('Mod-Shift-z') }),
          t('help.note.calc'),
          t('help.note.url'),
          t('help.note.safe'),
        ],
        aboutTitle: t('help.about'),
        aboutText: t('help.build', { name: APP_NAME, build: facts.buildId }),
        licensesTitle: t('help.licenses'),
        licensesIntro: t('help.licensesIntro'),
        licensesText: formatThirdPartyNotices(),
        diagnostics: diagnostics.element,
      }),
    }));
  };

  const groupLabelKeys = new Map<string, MessageKey>(COMMAND_GROUPS.map((group) => [group.id, group.labelKey]));
  // Every command except the menu itself, for narrow screens where the toolbar shows only a few.
  const showMenu = (): void => {
    void modals.open((close) => ({
      title: t('command.menu'),
      content: createCommandMenu(doc, {
        commands: commands.list().filter((command) => command.id !== MENU_COMMAND_ID),
        t,
        groupLabel: (group) => t(groupLabelKeys.get(group) ?? 'group.app'),
        formatShortcut: describeShortcut,
        // The menu is closed first: the command may open a dialog of its own.
        onPick: (command: Command) => {
          close();
          command.run();
        },
      }),
    }));
  };

  const commands = createCommandRegistry(
    bindCommands({
      'memo.manage': showMemoManager,
      'memo.new': () => workspace.newMemo(),
      'tab.close': closeActiveTab,
      'tab.next': () => stepTab(1),
      'tab.previous': () => stepTab(-1),
      'file.open': () => void openLocalFiles(),
      'file.save': () => void localFiles.saveToFile(false),
      'file.saveAs': () => void localFiles.saveToFile(true),
      'file.encoding': () => void localFiles.changeEncoding(),
      'search.open': () => editor.openSearch(),
      'search.next': () => editor.findNext(),
      'search.previous': () => editor.findPrevious(),
      'move.start': () => editor.goToStart(),
      'move.end': () => editor.goToEnd(),
      'move.pageUp': () => editor.pageUp(),
      'move.pageDown': () => editor.pageDown(),
      'insert.divider': () => editInPlace(insertDivider),
      ...symbolCommands,
      'tools.calc': () => void calc.run(),
      'tools.chunks': { run: toggleCutLines, isOn: hasCutLines },
      'tools.openUrl': openUrlAtCursor,
      'view.preview': { run: togglePreview, isOn: () => preview.isEnabled() },
      'view.toggleWrap': { run: toggleLineWrapping, isOn: () => settings.lineWrapping },
      'view.fontSmaller': () => stepFontSize(-1),
      'view.fontLarger': () => stepFontSize(1),
      'backup.export': () => void backups.exportBackup(),
      'backup.import': () => void backups.importBackup(),
      'settings.language': () => void chooseLanguage(),
      'help.show': showHelp,
      'app.menu': showMenu,
    }),
  );

  const toolbar = createToolbar(
    doc,
    TOOLBAR_COMMAND_IDS.flatMap((id) => commands.get(id) ?? []),
    t,
    { tierOf: (id) => TOOLBAR_TIERS.get(id) ?? 'always', formatShortcut: describeShortcut, label: t('toolbar.label') },
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
      panel: shell.editorHost,
      labels: { newMemo: t('command.newMemo'), closeTab: (title) => t('tab.close', { title }) },
      onActivate: (tabId) => workspace.activateTab(tabId),
      onClose: (tabId) => void closeTab(tabId),
      onNew: () => workspace.newMemo(),
    }),
  );

  // The browser's own tab, its history and a screen reader's page list all show the page title;
  // with the memo's name in it, several open pages can be told apart.
  const updatePageTitle = (): void => {
    const activeTab = tabs.getTabs().find((tab) => tab.id === tabs.getActiveId());
    doc.title = activeTab ? `${activeTab.title} - ${APP_NAME}` : APP_NAME;
  };
  tabs.subscribe(updatePageTitle);

  await workspace.start();
  updatePageTitle();

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

start(window).then(
  () => window.document.getElementById(BOOT_MESSAGE_ID)?.remove(),
  (error: unknown) => {
    // Without this a failed start is a blank page and a rejected promise nobody sees.
    console.error('[ssMemo2] The app could not start.', error);
    window.document.getElementById(BOOT_MESSAGE_ID)?.classList.add(BOOT_FAILED_CLASS);
  },
);
