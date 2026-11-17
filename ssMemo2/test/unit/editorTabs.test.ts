// The per-tab editor logic only needs a few members of CodeMirror's EditorView, so it is tested
// here against a stand-in that keeps a state and applies transactions, without a DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redo, undo } from '@codemirror/commands';
import { StateEffect } from '@codemirror/state';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import { createEditorState } from '../../src/editor/editorSetup.ts';
import { createEditorTabs } from '../../src/editor/editorTabs.ts';
import type { EditorTabs, EditorViewPort } from '../../src/editor/editorTabs.ts';

const scrollMarker = StateEffect.define<number>();

interface Harness {
  tabs: EditorTabs;
  view: EditorViewPort;
  /** Simulates typing at the start of the visible document. */
  type(text: string): void;
  /** Scroll markers that were handed back to the view, in order. */
  restoredScrolls: number[];
  undo(): boolean;
  redo(): boolean;
}

function createHarness(): Harness {
  const restoredScrolls: number[] = [];
  let nextScrollMarker = 1;
  const view = {
    state: createEditorState(''),
    setState(state: EditorState) {
      view.state = state;
    },
    dispatch(spec: TransactionSpec) {
      const transaction = view.state.update(spec);
      for (const effect of transaction.effects) {
        if (effect.is(scrollMarker)) restoredScrolls.push(effect.value);
      }
      view.state = transaction.state;
    },
    // Each snapshot gets a new number, so a test can tell which one was restored.
    scrollSnapshot: () => scrollMarker.of(nextScrollMarker++),
  };
  const run = (command: typeof undo): boolean => command({ state: view.state, dispatch: (transaction) => view.dispatch(transaction) });
  return {
    tabs: createEditorTabs(view, (text) => createEditorState(text)),
    view,
    type: (text) => view.dispatch({ changes: { from: 0, insert: text }, userEvent: 'input.type' }),
    restoredScrolls,
    undo: () => run(undo),
    redo: () => run(redo),
  };
}

test('showing a tab for the first time displays its initial text', () => {
  const { tabs, view } = createHarness();
  tabs.show('a', 'text of a');
  assert.equal(view.state.doc.toString(), 'text of a');
  assert.equal(tabs.getActiveTabId(), 'a');
});

test('each tab keeps its own text, including edits, across switches', () => {
  const harness = createHarness();
  harness.tabs.show('a', 'alpha');
  harness.type('edited ');
  harness.tabs.show('b', 'beta');
  assert.equal(harness.view.state.doc.toString(), 'beta');
  harness.type('changed ');
  harness.tabs.show('a', 'ignored: the tab already exists');
  assert.equal(harness.view.state.doc.toString(), 'edited alpha');
  harness.tabs.show('b', '');
  assert.equal(harness.view.state.doc.toString(), 'changed beta');
});

test('undo history belongs to the tab it was made in', () => {
  // ssMemoWeb lost undo whenever text was set programmatically; here switching tabs keeps it.
  const harness = createHarness();
  harness.tabs.show('a', 'alpha');
  harness.type('1 ');
  harness.tabs.show('b', 'beta');
  harness.type('2 ');
  harness.tabs.show('a', '');

  assert.equal(harness.undo(), true);
  assert.equal(harness.view.state.doc.toString(), 'alpha');
  // Nothing more to undo in tab a: tab b's edit must not be reachable from here.
  assert.equal(harness.undo(), false);
  assert.equal(harness.redo(), true);
  assert.equal(harness.view.state.doc.toString(), '1 alpha');

  harness.tabs.show('b', '');
  assert.equal(harness.undo(), true);
  assert.equal(harness.view.state.doc.toString(), 'beta');
});

test('the selection is kept per tab', () => {
  const harness = createHarness();
  harness.tabs.show('a', 'alpha');
  harness.view.dispatch({ selection: { anchor: 1, head: 4 } });
  harness.tabs.show('b', 'beta');
  harness.view.dispatch({ selection: { anchor: 2 } });
  harness.tabs.show('a', '');
  assert.deepEqual([harness.view.state.selection.main.anchor, harness.view.state.selection.main.head], [1, 4]);
  harness.tabs.show('b', '');
  assert.equal(harness.view.state.selection.main.head, 2);
});

test('the scroll position of a tab is restored when coming back to it', () => {
  const harness = createHarness();
  harness.tabs.show('a', 'alpha');
  harness.tabs.show('b', 'beta'); // leaving a: snapshot 1
  assert.deepEqual(harness.restoredScrolls, []); // b is new, nothing to restore
  harness.tabs.show('a', ''); // leaving b: snapshot 2; back on a: restore 1
  assert.deepEqual(harness.restoredScrolls, [1]);
  harness.tabs.show('b', ''); // leaving a: snapshot 3; back on b: restore 2
  assert.deepEqual(harness.restoredScrolls, [1, 2]);
});

test('showing the tab that is already visible changes nothing', () => {
  const harness = createHarness();
  harness.tabs.show('a', 'alpha');
  harness.type('typed ');
  const stateBefore = harness.view.state;
  harness.tabs.show('a', 'different');
  assert.equal(harness.view.state, stateBefore);
  assert.deepEqual(harness.restoredScrolls, []);
});

test('getText returns the current text of any tab, visible or not', () => {
  const harness = createHarness();
  harness.tabs.show('a', 'alpha');
  harness.type('live ');
  assert.equal(harness.tabs.getText('a'), 'live alpha');
  harness.tabs.show('b', 'beta');
  assert.equal(harness.tabs.getText('a'), 'live alpha');
  assert.equal(harness.tabs.getText('b'), 'beta');
  assert.equal(harness.tabs.getText('missing'), undefined);
});

test('remove forgets a background tab', () => {
  const harness = createHarness();
  harness.tabs.show('a', 'alpha');
  harness.tabs.show('b', 'beta');
  harness.tabs.remove('a');
  assert.equal(harness.tabs.getText('a'), undefined);
  assert.equal(harness.tabs.getActiveTabId(), 'b');
  // Showing the id again starts from the given text, with nothing left over.
  harness.tabs.show('a', 'fresh');
  assert.equal(harness.view.state.doc.toString(), 'fresh');
  assert.equal(harness.undo(), false);
});

test('remove of the visible tab leaves no active tab until another one is shown', () => {
  const harness = createHarness();
  harness.tabs.show('a', 'alpha');
  harness.tabs.show('b', 'beta');
  harness.tabs.remove('b');
  assert.equal(harness.tabs.getActiveTabId(), undefined);
  assert.equal(harness.tabs.getText('b'), undefined);
  harness.tabs.show('a', '');
  assert.equal(harness.view.state.doc.toString(), 'alpha');
  // The removed tab must not have been written back when leaving it.
  assert.equal(harness.tabs.getText('b'), undefined);
});
