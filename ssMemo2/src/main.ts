// Composition root: the only module that touches the real window and wires modules together.
import { readBuildId } from './app/buildInfo.ts';
import { describeEnvironment } from './app/diagnostics.ts';
import { createDocumentStore } from './app/documentStore.ts';
import { createMemoSession } from './app/memoSession.ts';
import { SAVE_STATE_KEYS, describeNotice, describeStorage, temporaryModeKey } from './app/noticeText.ts';
import { createRandomId } from './app/randomId.ts';
import { mountEditor } from './editor/editorSetup.ts';
import { createTranslator, resolveLocale } from './i18n/i18n.ts';
import { isSafeModeRequested, openStorage } from './storage/openStorage.ts';
import { createAppShell } from './ui/appShell.ts';
import { copyToClipboard } from './ui/clipboard.ts';
import { createDiagnosticsPanel } from './ui/diagnosticsPanel.ts';
import { readEnvironment } from './ui/environment.ts';
import { createNoticeBar } from './ui/noticeBar.ts';
import { createStatusIndicator } from './ui/statusIndicator.ts';

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

  const store = createDocumentStore({
    storage: opened.storage,
    now: () => new Date(),
    createId: () => createRandomId(win.crypto),
    conflictCopyTitle: (title) => t('memo.conflictCopyTitle', { title }),
  });

  let editedSinceStart = false;
  // Mounted after the shell is in the document so the editor can measure its real size at once.
  // It is not focused automatically: on a phone that would pop up the keyboard on every load.
  const editor = mountEditor(shell.editorHost, () => {
    editedSinceStart = true;
    session.handleEdit();
  });

  const session = createMemoSession({
    store,
    editor,
    defaultTitle: t('memo.defaultTitle'),
    idleDelayMs: AUTOSAVE_IDLE_DELAY_MS,
    maxWaitMs: AUTOSAVE_MAX_WAIT_MS,
    timers: {
      setTimeout: (callback, delayMs) => win.setTimeout(callback, delayMs),
      clearTimeout: (handle) => win.clearTimeout(handle as number),
    },
    onNotice: (notice) => notices.show(describeNotice(notice, t)),
    onSaveStateChange: (state) => status.setSaveState(t(SAVE_STATE_KEYS[state])),
  });
  await session.start();

  // Save when the page is hidden or left. A phone browser may never fire "beforeunload", and
  // a save started from there would not be awaited anyway, so that event is only for the warning.
  const saveNow = (): void => {
    void session.flush();
  };
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') saveNow();
  });
  win.addEventListener('pagehide', saveNow);
  win.addEventListener('beforeunload', (event) => {
    // In temporary mode even a "saved" memo disappears with the page.
    const wouldLoseText = session.hasUnsavedChanges() || (opened.mode === 'temporary' && editedSinceStart);
    if (wouldLoseText) event.preventDefault();
  });
}

void start(window);
