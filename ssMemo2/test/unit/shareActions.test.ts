import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHARE_TEXT_LIMIT, createShareActions } from '../../src/app/shareActions.ts';
import type { ShareContent, ShareNotice, SharePort } from '../../src/app/shareActions.ts';

interface Harness {
  /** What was handed to the system, in order. */
  shared: ShareContent[];
  notices: ShareNotice['kind'][];
  share(): Promise<void>;
}

interface Setup {
  memo?: { title: string; text: string } | undefined;
  /** What the browser offers; left out for a browser without sharing. */
  port?: SharePort;
  /** Makes sharing end the way a browser reports it, e.g. "AbortError". */
  failWith?: string;
  filesSupported?: boolean;
}

function createHarness(setup: Setup = {}): Harness {
  const shared: ShareContent[] = [];
  const notices: ShareNotice['kind'][] = [];
  const port: SharePort = setup.port ?? {
    share: async (content) => {
      shared.push(content);
      if (setup.failWith !== undefined) throw Object.assign(new Error('share ended'), { name: setup.failWith });
    },
    canShare: (content) => content.files === undefined || setup.filesSupported === true,
  };
  const actions = createShareActions({
    port,
    getMemo: () => ('memo' in setup ? setup.memo : { title: 'Shopping', text: 'buy milk' }),
    createFile: (name, text) => new File([text], name, { type: 'text/plain' }),
    onNotice: (notice) => notices.push(notice.kind),
  });
  return { shared, notices, share: () => actions.share() };
}

test('the title and the text of the memo are handed to the system', async () => {
  const harness = createHarness();
  await harness.share();
  assert.deepEqual(harness.shared, [{ title: 'Shopping', text: 'buy milk' }]);
  assert.deepEqual(harness.notices, []);
});

test('sharing starts at once: a browser only allows it right after the tap that asked for it', () => {
  const harness = createHarness();
  // Not awaited on purpose. The system must have been asked before anything else is waited for.
  void harness.share();
  assert.equal(harness.shared.length, 1);
});

test('a browser that cannot share is said to be one', async () => {
  const harness = createHarness({ port: {} });
  await harness.share();
  assert.deepEqual(harness.notices, ['share-unsupported']);
});

test('an empty memo, or none at all, is not shared', async () => {
  for (const memo of [{ title: 'Shopping', text: '' }, undefined]) {
    const harness = createHarness({ memo });
    await harness.share();
    assert.deepEqual(harness.shared, []);
    assert.deepEqual(harness.notices, ['share-nothing']);
  }
});

test('backing out of the share sheet is not an error', async () => {
  const harness = createHarness({ failWith: 'AbortError' });
  await harness.share();
  assert.equal(harness.shared.length, 1);
  assert.deepEqual(harness.notices, []);
});

test('sharing that fails for another reason is reported', async () => {
  for (const failWith of ['NotAllowedError', 'DataError', 'TypeError']) {
    const harness = createHarness({ failWith });
    await harness.share();
    assert.deepEqual(harness.notices, ['share-failed'], failWith);
  }
});

test('a text up to the limit is shared as text', async () => {
  const text = 'x'.repeat(SHARE_TEXT_LIMIT);
  const harness = createHarness({ memo: { title: 'Long', text }, filesSupported: true });
  await harness.share();
  assert.deepEqual(harness.shared, [{ title: 'Long', text }]);
});

test('a longer text is shared as a text file named after the memo', async () => {
  const text = 'x'.repeat(SHARE_TEXT_LIMIT + 1);
  const harness = createHarness({ memo: { title: 'Notes: a/b', text }, filesSupported: true });
  await harness.share();
  assert.equal(harness.shared.length, 1);
  const [content] = harness.shared;
  // The text travels in the file only, not a second time beside it.
  assert.deepEqual(Object.keys(content ?? {}).sort(), ['files', 'title']);
  assert.equal(content?.title, 'Notes: a/b');
  const file = content?.files?.[0];
  assert.equal(await file?.text(), text);
  // A name the file system accepts.
  assert.equal(file?.name, 'Notes_ a_b.txt');
  assert.deepEqual(harness.notices, []);
});

test('a longer text is not shared where files cannot be shared, and the user is told what to do', async () => {
  const text = 'x'.repeat(SHARE_TEXT_LIMIT + 1);
  const withoutFiles = createHarness({ memo: { title: 'Long', text }, filesSupported: false });
  await withoutFiles.share();
  assert.deepEqual(withoutFiles.shared, []);
  assert.deepEqual(withoutFiles.notices, ['share-too-long']);

  // An older browser shares, but cannot say what it is able to share.
  const shared: ShareContent[] = [];
  const older = createHarness({ memo: { title: 'Long', text }, port: { share: async (content) => void shared.push(content) } });
  await older.share();
  assert.deepEqual(shared, []);
  assert.deepEqual(older.notices, ['share-too-long']);
});

test('the browser is asked through its own object, as its methods require', async () => {
  // navigator.share fails when it is called detached from navigator.
  class Browser implements SharePort {
    readonly shared: ShareContent[] = [];
    async share(content: ShareContent): Promise<void> {
      this.shared.push(content);
    }
    canShare(): boolean {
      return this.shared.length >= 0;
    }
  }
  const browser = new Browser();
  const text = 'x'.repeat(SHARE_TEXT_LIMIT + 1);
  for (const memo of [{ title: 'Short', text: 'hello' }, { title: 'Long', text }]) {
    const harness = createHarness({ memo, port: browser });
    await harness.share();
    assert.deepEqual(harness.notices, []);
  }
  assert.equal(browser.shared.length, 2);
});

test('sharing never rejects, whatever the browser does', async () => {
  const text = 'x'.repeat(SHARE_TEXT_LIMIT + 1);
  const throwing = createHarness({
    memo: { title: 'Long', text },
    port: {
      share: async () => undefined,
      canShare: () => {
        throw new Error('unexpected');
      },
    },
  });
  await throwing.share();
  assert.deepEqual(throwing.notices, ['share-too-long']);

  const synchronous = createHarness({
    port: {
      share: () => {
        throw new TypeError('thrown instead of rejected');
      },
    },
  });
  await synchronous.share();
  assert.deepEqual(synchronous.notices, ['share-failed']);
});
