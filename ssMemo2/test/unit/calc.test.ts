// Ported from ssMemoWeb's test-calc.js. Errors are checked by their code rather than by their
// Korean message, because the message is now made by the translator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CalcError, FACTORIAL_LIMIT, MAX_SOURCE_LENGTH, formatValue, parseStoredEnvironment, runCode, toStoredEnvironment } from '../../src/lib/calc.ts';
import type { CalcErrorCode, CalcValue } from '../../src/lib/calc.ts';

const outputs = (source: string, initial?: ReadonlyMap<string, CalcValue>): string[] => runCode(source, initial).outputs;

function failsWith(code: CalcErrorCode, detail?: string): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof CalcError, `expected a CalcError, got ${String(error)}`);
    assert.equal(error.code, code);
    if (detail !== undefined) assert.equal(error.detail, detail);
    return true;
  };
}

// --- arithmetic -------------------------------------------------------------

test('the four operations, with exact integer results where possible', () => {
  assert.deepEqual(outputs('1 + 2'), ['3']);
  assert.deepEqual(outputs('10 - 7'), ['3']);
  assert.deepEqual(outputs('6 * 7'), ['42']);
  assert.deepEqual(outputs('20 / 4'), ['5']);
  assert.deepEqual(outputs('7 / 2'), ['3.5']);
});

test('integer division drops the remainder towards zero', () => {
  assert.deepEqual(outputs('7 // 2'), ['3']);
  assert.deepEqual(outputs('-7 // 2'), ['-3']);
  assert.deepEqual(outputs('7.9 // 2'), ['3']);
});

test('precedence, parentheses and signs', () => {
  assert.deepEqual(outputs('(1 + 2) * 3'), ['9']);
  assert.deepEqual(outputs('1 + 2 * 3'), ['7']);
  assert.deepEqual(outputs('-(3 + 4)'), ['-7']);
  assert.deepEqual(outputs('--5'), ['5']);
  assert.deepEqual(outputs('+5'), ['5']);
  assert.deepEqual(outputs('+-5'), ['-5']);
  assert.deepEqual(outputs('1 - -1'), ['2']);
});

test('integers keep every digit, however long', () => {
  const nines = '9'.repeat(5000);
  assert.deepEqual(outputs(`${nines} + 1`), [`1${'0'.repeat(5000)}`]);
  assert.deepEqual(outputs(`${'9'.repeat(2500)} * 2`), [`1${'9'.repeat(2499)}8`]);
  assert.deepEqual(outputs(`${nines} - ${nines}`), ['0']);
});

test('an integer and a decimal number give a decimal number', () => {
  assert.deepEqual(outputs('1 + 1.5'), ['2.5']);
  assert.deepEqual(outputs('1.5 + 1'), ['2.5']);
  assert.deepEqual(outputs('10 - 0.5'), ['9.5']);
  assert.deepEqual(outputs('2.5 * 4'), ['10']);
  assert.deepEqual(outputs('cos(0) + 5'), ['6']);
});

test('exponent notation, and an "e" that is not one', () => {
  assert.deepEqual(outputs('2e3'), ['2000']);
  assert.deepEqual(outputs('2E3'), ['2000']);
  assert.deepEqual(outputs('1.5e2'), ['150']);
  assert.deepEqual(outputs('2e+3'), ['2000']);
  assert.deepEqual(outputs('2e-2'), ['0.02']);
  // Without digits after it, "e" is a variable name: no silent NaN.
  assert.throws(() => runCode('2e'), failsWith('undefined-variable', 'e'));
  assert.throws(() => runCode('2e+'), failsWith('unexpected-token'));
});

// --- variables, functions, comments -----------------------------------------

test('variables are assigned and used, and each assignment is echoed', () => {
  assert.deepEqual(outputs('x = 10\ny = 20\nx + y'), ['x = 10', 'y = 20', '30']);
  assert.deepEqual(outputs('a = 3\nb = a * a\nb'), ['a = 3', 'b = 9', '9']);
});

test('functions', () => {
  assert.deepEqual(outputs('factorial(0)'), ['1']);
  assert.deepEqual(outputs('factorial(5)'), ['120']);
  assert.deepEqual(outputs('factorial(20)'), ['2432902008176640000']);
  assert.equal(outputs(`factorial(${FACTORIAL_LIMIT})`)[0]?.length, 2568);
  assert.deepEqual(outputs('cos(0)'), ['1']);
  assert.deepEqual(outputs('sin(0)'), ['0']);
  assert.deepEqual(outputs('tan(0)'), ['0']);
  assert.deepEqual(outputs('factorial(factorial(3))'), ['720']);
  assert.deepEqual(outputs('factorial(3 + 2)'), ['120']);
});

test('comments and blank input produce nothing', () => {
  assert.deepEqual(outputs('# only a comment\n3 + 4'), ['7']);
  assert.deepEqual(outputs('1 + 2 # trailing comment'), ['3']);
  for (const source of ['# all comment', '', '   ', '\n\n\n', '# one\n# two']) assert.deepEqual(outputs(source), [], JSON.stringify(source));
});

test('Windows line endings separate statements like any other', () => {
  assert.deepEqual(outputs('x = 1\r\ny = 2\r\nx + y'), ['x = 1', 'y = 2', '3']);
});

// --- errors -----------------------------------------------------------------

test('each kind of mistake has its own error', () => {
  assert.throws(() => runCode('5 / 0'), failsWith('division-by-zero'));
  assert.throws(() => runCode('5 // 0'), failsWith('division-by-zero'));
  assert.throws(() => runCode('5 / 0.0'), failsWith('division-by-zero'));
  assert.throws(() => runCode(`factorial(${FACTORIAL_LIMIT + 1})`), failsWith('factorial-too-large', String(FACTORIAL_LIMIT)));
  assert.throws(() => runCode('factorial(-1)'), failsWith('factorial-negative'));
  assert.throws(() => runCode('factorial(1.5)'), failsWith('factorial-not-integer'));
  assert.throws(() => runCode('unknown'), failsWith('undefined-variable', 'unknown'));
  assert.throws(() => runCode('foo(1)'), failsWith('unknown-function', 'foo'));
  assert.throws(() => runCode('sin(1, 2)'), failsWith('wrong-argument-count', 'sin'));
  assert.throws(() => runCode('sin()'), failsWith('wrong-argument-count', 'sin'));
  assert.throws(() => runCode('1 +'), failsWith('unexpected-token'));
  assert.throws(() => runCode('@@@'), failsWith('unknown-character', '@'));
  assert.throws(() => runCode('(1 + 2'), failsWith('expected-token', ')'));
});

test('names that every JavaScript object has are not variables or functions', () => {
  // ssMemoWeb looked names up on plain objects, so "constructor" was "defined" and
  // toString(1) "worked".
  for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    assert.throws(() => runCode(name), failsWith('undefined-variable', name));
    assert.throws(() => runCode(`${name}(1)`), failsWith('unknown-function', name));
  }
});

test('such names are still usable as ordinary variables', () => {
  assert.deepEqual(outputs('constructor = 2\n__proto__ = 3\nconstructor * __proto__'), ['constructor = 2', '__proto__ = 3', '6']);
  // And assigning them has no effect on anything else.
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('a function name is not a variable, and a variable can share the name', () => {
  assert.throws(() => runCode('sin'), failsWith('undefined-variable', 'sin'));
  assert.deepEqual(outputs('sin = 2\nsin + cos(0)'), ['sin = 2', '3']);
});

test('nesting too deep to evaluate is an error, not a crash', () => {
  // Both stay under the length limit, so it is the nesting that is refused.
  assert.throws(() => runCode(`${'('.repeat(40_000)}1${')'.repeat(40_000)}`), failsWith('too-complex'));
  assert.throws(() => runCode(`${'-'.repeat(90_000)}1`), failsWith('too-complex'));
});

test('a source over the length limit is refused before any work is done', () => {
  assert.throws(() => runCode('1'.repeat(MAX_SOURCE_LENGTH + 1)), failsWith('source-too-long', String(MAX_SOURCE_LENGTH)));
  assert.equal(outputs('1'.repeat(MAX_SOURCE_LENGTH)).length, 1);
});

test('an error in a later line discards the whole run', () => {
  const memory = new Map<string, CalcValue>([['a', 1n]]);
  assert.throws(() => runCode('a = 2\nb = 1 / 0', memory), failsWith('division-by-zero'));
  assert.equal(memory.get('a'), 1n);
});

// --- memory -----------------------------------------------------------------

test('variables given from outside can be used, and are not changed by the run', () => {
  assert.deepEqual(outputs('x + 5', new Map([['x', 10n]])), ['15']);
  assert.deepEqual(outputs('y * 2', new Map([['y', 3.14]])), ['6.28']);

  const memory = new Map<string, CalcValue>([['a', 1n]]);
  const result = runCode('a = 99\nb = 2', memory);
  assert.deepEqual([...memory], [['a', 1n]]);
  assert.equal(result.environment.get('a'), 99n);
  assert.equal(result.environment.get('b'), 2n);
});

test('formatValue writes integers without a decimal point', () => {
  assert.equal(formatValue(42n), '42');
  assert.equal(formatValue(3.14), '3.14');
  assert.equal(formatValue(1.0), '1');
  assert.equal(formatValue(-0), '0');
});

test('variables survive being stored and read back, to the last digit', () => {
  const huge = BigInt('9'.repeat(5000));
  const environment = new Map<string, CalcValue>([['x', 12345678901234567890n], ['y', 3.14], ['z', 0n], ['huge', huge], ['negative', -5n]]);
  const stored = toStoredEnvironment(environment);
  // Plain data, so it can go into the browser storage and into a backup file.
  assert.deepEqual(JSON.parse(JSON.stringify(stored)), stored);
  assert.deepEqual(stored.x, { big: '12345678901234567890' });
  assert.deepEqual(stored.y, { num: 3.14 });
  const restored = parseStoredEnvironment(JSON.parse(JSON.stringify(stored)));
  assert.deepEqual([...restored], [...environment]);
  assert.deepEqual(outputs('x * 2', restored), ['24691357802469135780']);
});

test('values that cannot be stored are left out', () => {
  const environment = new Map<string, CalcValue>([['ok', 1.5], ['infinite', Number.POSITIVE_INFINITY], ['nan', Number.NaN]]);
  assert.deepEqual(toStoredEnvironment(environment), { ok: { num: 1.5 } });
});

test('damaged stored variables are dropped one by one', () => {
  for (const nothing of [undefined, null, 'text', 42, []]) assert.equal(parseStoredEnvironment(nothing).size, 0, String(nothing));
  const restored = parseStoredEnvironment({
    good: { big: '7' },
    alsoGood: { num: 2.5 },
    notANumber: { big: 'seven' },
    decimalAsBig: { big: '1.5' },
    wrongType: { num: '2' },
    infinite: { num: Number.POSITIVE_INFINITY },
    empty: {},
    primitive: 5,
    nothing: null,
    '1bad name': { big: '1' },
  });
  assert.deepEqual([...restored], [['good', 7n], ['alsoGood', 2.5]]);
});

test('a stored variable named like an object member is just a variable', () => {
  const restored = parseStoredEnvironment(JSON.parse('{"__proto__": {"big": "5"}, "constructor": {"num": 1}}'));
  assert.equal(restored.get('__proto__'), 5n);
  assert.equal(restored.get('constructor'), 1);
});
