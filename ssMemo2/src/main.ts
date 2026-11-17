// Composition root: the only module that touches the real window and wires modules together.
import { readBuildId } from './app/buildInfo.ts';
import { describeEnvironment } from './app/diagnostics.ts';
import { copyToClipboard } from './ui/clipboard.ts';
import { createDiagnosticsPanel } from './ui/diagnosticsPanel.ts';
import { readEnvironment } from './ui/environment.ts';

const APP_NAME = 'ssMemo2';
const MOUNT_POINT_ID = 'app';

function start(win: Window): void {
  const doc = win.document;
  const mountPoint = doc.getElementById(MOUNT_POINT_ID);
  if (!mountPoint) {
    throw new Error(`Mount point #${MOUNT_POINT_ID} is missing`);
  }

  const buildId = readBuildId(doc);
  const panel = createDiagnosticsPanel(doc, APP_NAME, (text) => copyToClipboard(win, text));
  const refresh = (): void => panel.update(describeEnvironment(readEnvironment(win, buildId)));

  // Folding or unfolding the device and opening the on-screen keyboard both change the values.
  win.addEventListener('resize', refresh);
  win.visualViewport?.addEventListener('resize', refresh);

  refresh();
  mountPoint.append(panel.element);
}

start(window);
