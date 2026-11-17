// Composition root: the only module that touches the real window and wires modules together.
import { readBuildId } from './app/buildInfo.ts';
import { describeEnvironment } from './app/diagnostics.ts';
import { mountEditor } from './editor/editorSetup.ts';
import { createAppShell } from './ui/appShell.ts';
import { copyToClipboard } from './ui/clipboard.ts';
import { createDiagnosticsPanel } from './ui/diagnosticsPanel.ts';
import { readEnvironment } from './ui/environment.ts';

const APP_NAME = 'ssMemo2';
const MOUNT_POINT_ID = 'app';
// Nothing is stored yet (storage arrives in roadmap phase 2), so the editor starts empty.
const INITIAL_TEXT = '';

function start(win: Window): void {
  const doc = win.document;
  const mountPoint = doc.getElementById(MOUNT_POINT_ID);
  if (!mountPoint) {
    throw new Error(`Mount point #${MOUNT_POINT_ID} is missing`);
  }

  const shell = createAppShell(doc, APP_NAME);

  const buildId = readBuildId(doc);
  const diagnostics = createDiagnosticsPanel(doc, (text) => copyToClipboard(win, text));
  const refresh = (): void => diagnostics.update(describeEnvironment(readEnvironment(win, buildId)));

  // Folding or unfolding the device and opening the on-screen keyboard both change the values.
  win.addEventListener('resize', refresh);
  win.visualViewport?.addEventListener('resize', refresh);

  refresh();
  shell.footer.append(diagnostics.element);
  mountPoint.append(shell.element);

  // Mounted after the shell is in the document so the editor can measure its real size at once.
  // It is not focused automatically: on a phone that would pop up the keyboard on every load.
  mountEditor(shell.editorHost, INITIAL_TEXT);
}

start(window);
