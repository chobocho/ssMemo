import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALC_MEMORY_KEY, createCalcActions } from '../../src/app/calcActions.ts';
import type { CalcActions, CalcDialogAction, CalcNotice, CalcResultView } from '../../src/app/calcActions.ts';
import { createMemoryStorage } from '../../src/storage/memoryStorage.ts';
import { StorageError } from '../../src/storage/storagePort.ts';
import type { StoragePort } from '../../src/storage/storagePort.ts';

interface Harness {
  calc: CalcActions;
  storage: StoragePort;
  /** What the editor offers to run; undefined means no document is showing. */
  code: { value: { code: string; end: number } | undefined };
  /** The button the user presses in the result dialog; undefined closes it. */
  answer: { value: CalcDialogAction | undefined };
  results: CalcResultView[];
  errors: string[];
  inserted: { end: number; lines: string[] }[];
  notices: CalcNotice[];
  /** Runs `code` as if it were the line with the cursor. */
  run(code: string, end?: number): Promise<void>;
}

function createHarness(storage: StoragePort = createMemoryStorage()): Harness {
  const code: Harness['code'] = { value: undefined };
  const answer: Harness['answer'] = { value: undefined };
  const results: CalcResultView[] = [];
  const errors: string[] = [];
  const inserted: Harness['inserted'] = [];
  const notices: CalcNotice[] = [];
  const calc = createCalcActions({
    storage,
    getCode: () => code.value,
    insertResult: (end, lines) => inserted.push({ end, lines: [...lines] }),
    async showResult(view) {
      results.push({ outputs: [...view.outputs], memoryNames: [...view.memoryNames] });
      return answer.value;
    },
    async showError(errorCode, detail) {
      errors.push(detail === '' ? errorCode : `${errorCode}: ${detail}`);
    },
    onNotice: (notice) => notices.push(notice),
  });
  return {
    calc,
    storage,
    code,
    answer,
    results,
    errors,
    inserted,
    notices,
    async run(source, end = source.length) {
      code.value = { code: source, end };
      await calc.run();
    },
  };
}

test('the code is calculated and its result shown', async () => {
  const harness = createHarness();
  await harness.run('1 + 2\nx = 10');
  assert.deepEqual(harness.results, [{ outputs: ['3', 'x = 10'], memoryNames: [] }]);
  assert.deepEqual(harness.errors, []);
  assert.deepEqual(harness.notices, []);
});

test('with nothing to run the user is told how to use it, and no dialog opens', async () => {
  const harness = createHarness();
  await harness.calc.run();
  await harness.run('');
  await harness.run('   \n\t');
  assert.deepEqual(harness.notices, [{ kind: 'calc-nothing-to-run' }, { kind: 'calc-nothing-to-run' }, { kind: 'calc-nothing-to-run' }]);
  assert.deepEqual(harness.results, []);
});

test('code that only holds comments has no output but is still a valid run', async () => {
  const harness = createHarness();
  await harness.run('# just a note');
  assert.deepEqual(harness.results, [{ outputs: [], memoryNames: [] }]);
});

test('a mistake in the code is explained instead of shown as a result', async () => {
  const harness = createHarness();
  await harness.run('1 / 0');
  await harness.run('unknown + 1');
  assert.deepEqual(harness.errors, ['division-by-zero', 'undefined-variable: unknown']);
  assert.deepEqual(harness.results, []);
});

test('"insert" puts the result below the code as comment lines', async () => {
  const harness = createHarness();
  harness.answer.value = 'insert';
  await harness.run('x = 2\nx * 3', 11);
  assert.deepEqual(harness.inserted, [{ end: 11, lines: ['# x = 2', '# 6'] }]);
  // Inserting does not keep the variables.
  harness.answer.value = undefined;
  await harness.run('x');
  assert.deepEqual(harness.errors, ['undefined-variable: x']);
});

test('closing the dialog changes nothing', async () => {
  const harness = createHarness();
  await harness.run('x = 5');
  assert.deepEqual(harness.inserted, []);
  assert.equal(await harness.storage.getValue(CALC_MEMORY_KEY), undefined);
});

test('"save" keeps the variables for later runs and stores them', async () => {
  const harness = createHarness();
  harness.answer.value = 'save';
  await harness.run('x = 5\ny = x * 2');
  assert.deepEqual(await harness.storage.getValue(CALC_MEMORY_KEY), { x: { big: '5' }, y: { big: '10' } });

  harness.answer.value = undefined;
  await harness.run('x + y');
  assert.deepEqual(harness.results.at(-1), { outputs: ['15'], memoryNames: ['x', 'y'] });
});

test('saving again adds to what is stored and updates what changed', async () => {
  const harness = createHarness();
  harness.answer.value = 'save';
  await harness.run('x = 1\ny = 2');
  await harness.run('y = 20\nz = 3');
  assert.deepEqual(await harness.storage.getValue(CALC_MEMORY_KEY), { x: { big: '1' }, y: { big: '20' }, z: { big: '3' } });
});

test('the dialog names the variables that were stored before this run', async () => {
  const harness = createHarness();
  harness.answer.value = 'save';
  await harness.run('a = 1');
  assert.deepEqual(harness.results.at(-1)?.memoryNames, []);
  await harness.run('b = 2');
  assert.deepEqual(harness.results.at(-1)?.memoryNames, ['a']);
});

test('"clear" forgets every stored variable', async () => {
  const harness = createHarness();
  harness.answer.value = 'save';
  await harness.run('x = 5');
  harness.answer.value = 'clear';
  await harness.run('1');
  assert.deepEqual(await harness.storage.getValue(CALC_MEMORY_KEY), {});
  harness.answer.value = undefined;
  await harness.run('x');
  assert.deepEqual(harness.errors, ['undefined-variable: x']);
});

test('stored variables are there again on the next visit', async () => {
  const storage = createMemoryStorage();
  const first = createHarness(storage);
  first.answer.value = 'save';
  await first.run(`big = ${'9'.repeat(60)}`);

  const second = createHarness(storage);
  await second.run('big + 1');
  assert.deepEqual(second.results.at(-1), { outputs: [`1${'0'.repeat(60)}`], memoryNames: ['big'] });
});

test('stored variables that cannot be read are treated as none', async () => {
  const damaged = createMemoryStorage();
  await damaged.setValue(CALC_MEMORY_KEY, 'not a memory');
  const harness = createHarness(damaged);
  await harness.run('1 + 1');
  assert.deepEqual(harness.results.at(-1), { outputs: ['2'], memoryNames: [] });

  const storage = createMemoryStorage();
  const broken = createHarness({
    ...storage,
    getValue: async () => {
      throw new StorageError('connection-lost', 'closed');
    },
  });
  await broken.run('1 + 1');
  assert.deepEqual(broken.results.at(-1), { outputs: ['2'], memoryNames: [] });
});

test('when the variables cannot be stored they still apply until the page is closed, and the user is told', async () => {
  const storage = createMemoryStorage();
  const harness = createHarness({
    ...storage,
    setValue: async () => {
      throw new StorageError('quota', 'full');
    },
  });
  harness.answer.value = 'save';
  await harness.run('x = 5');
  assert.deepEqual(harness.notices, [{ kind: 'calc-memory-not-saved' }]);
  harness.answer.value = undefined;
  await harness.run('x + 1');
  assert.deepEqual(harness.results.at(-1), { outputs: ['6'], memoryNames: ['x'] });
});

test('a failed run does not touch the stored variables', async () => {
  const harness = createHarness();
  harness.answer.value = 'save';
  await harness.run('x = 1');
  await harness.run('x = 2\ny = 1 / 0');
  harness.answer.value = undefined;
  await harness.run('x');
  assert.deepEqual(harness.results.at(-1)?.outputs, ['1']);
});
