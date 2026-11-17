// Lets files be dropped onto the page to open them.
import type { PickedFile } from '../app/localFiles.ts';
import { toPickedFiles } from './fileIo.ts';

export interface FileDropOptions {
  /** Class set on the target while files are being dragged over it. */
  activeClass: string;
  onDrop(files: PickedFile[]): void;
}

// What a drag that carries files (rather than text or a link) lists among its types.
const FILES_TYPE = 'Files';

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes(FILES_TYPE) ?? false;
}

/**
 * Makes `target` accept dropped files. Drags of anything else are not touched, so dragging
 * text inside the editor keeps working.
 */
export function installFileDrop(target: HTMLElement, options: FileDropOptions): void {
  const { activeClass, onDrop } = options;

  const accept = (event: DragEvent): void => {
    if (!carriesFiles(event) || !event.dataTransfer) return;
    // Dropping is allowed only where "dragover" was cancelled.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    target.classList.add(activeClass);
  };

  // Listening in the capture phase puts this handler ahead of the editor's own. The editor would
  // otherwise read a dropped file itself and insert its content into the open memo.
  target.addEventListener('dragenter', accept, true);
  target.addEventListener('dragover', accept, true);

  target.addEventListener(
    'dragleave',
    (event) => {
      // Moving between elements inside the target also fires "dragleave"; only a real exit counts.
      // For drag events the related target is an element or nothing (the pointer left the window).
      const movedTo = event.relatedTarget as Node | null;
      if (!movedTo || !target.contains(movedTo)) {
        target.classList.remove(activeClass);
      }
    },
    true,
  );

  target.addEventListener(
    'drop',
    (event) => {
      if (!carriesFiles(event) || !event.dataTransfer) return;
      // Without this the browser leaves the app and shows the dropped file instead.
      event.preventDefault();
      event.stopPropagation();
      target.classList.remove(activeClass);
      const files = toPickedFiles(event.dataTransfer.files);
      if (files.length > 0) onDrop(files);
    },
    true,
  );
}
