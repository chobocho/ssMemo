// Composition root: the only module that touches the real document and wires modules together.
import { readBuildId } from './app/buildInfo.ts';

const APP_NAME = 'ssMemo2';
const MOUNT_POINT_ID = 'app';

function start(doc: Document): void {
  const mountPoint = doc.getElementById(MOUNT_POINT_ID);
  if (!mountPoint) {
    throw new Error(`Mount point #${MOUNT_POINT_ID} is missing`);
  }
  const heading = doc.createElement('h1');
  heading.textContent = APP_NAME;
  const buildLine = doc.createElement('p');
  buildLine.textContent = `build ${readBuildId(doc)}`;
  mountPoint.append(heading, buildLine);
}

start(document);
