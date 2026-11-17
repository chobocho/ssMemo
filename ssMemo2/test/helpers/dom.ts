// A DOM for unit tests of the UI modules. The modules take the Document as a parameter, so a
// test passes them this one instead of a browser's.
import { JSDOM } from 'jsdom';

interface DialogPolyfillTarget {
  showModal?: (this: HTMLDialogElement) => void;
  close?: (this: HTMLDialogElement) => void;
}

/**
 * jsdom has no <dialog> methods. This stand-in covers what the app's own code relies on: the
 * "open" attribute and the "close" event. Focus trapping, the top layer and closing on Escape
 * are the browser's job and are checked by hand (see test/manual/checklist.md).
 */
function installDialogStandIn(window: JSDOM['window']): void {
  const prototype = window.HTMLDialogElement.prototype as unknown as DialogPolyfillTarget;
  if (typeof prototype.showModal === 'function') return;
  prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  prototype.close = function close() {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new window.Event('close'));
  };
}

export interface TestDom {
  window: JSDOM['window'];
  document: Document;
}

export function createTestDom(): TestDom {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
  installDialogStandIn(dom.window);
  return { window: dom.window, document: dom.window.document };
}

/** Lets promise callbacks that were queued by an event handler run. */
export function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
