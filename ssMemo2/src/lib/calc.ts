// The calculator behind "run code": a few lines of arithmetic with variables, typed into a memo.
// Ported from ssMemoWeb's calc.js.
//
// Supported: + - * / // (integer division), parentheses, unary signs, variables, the functions
// sin cos tan factorial, and # comments. Integers are BigInt, so they keep every digit however
// long they get; a decimal number anywhere in an operation makes the result an ordinary number.
//
// Changed from the original:
// - Variables and functions are kept in Maps. On plain objects, names every object has
//   ("constructor", "toString") counted as defined, and toString(1) "worked".
// - Errors carry a code instead of a Korean sentence, so they can be shown in either language.
// - Input that is too long or nested too deeply is refused instead of freezing or crashing the page.

export type CalcValue = bigint | number;

export type CalcErrorCode =
  | 'source-too-long'
  /** Nested too deeply, or a result too large to compute. */
  | 'too-complex'
  | 'unknown-character'
  /** `detail` is the token, or empty if the input simply ended too early. */
  | 'unexpected-token'
  /** `detail` is what should have come next. */
  | 'expected-token'
  | 'undefined-variable'
  | 'unknown-function'
  | 'wrong-argument-count'
  | 'division-by-zero'
  | 'factorial-not-integer'
  | 'factorial-negative'
  | 'factorial-too-large';

export class CalcError extends Error {
  readonly code: CalcErrorCode;
  /** The name, character or limit the error is about; what a message needs to be specific. */
  readonly detail: string;

  constructor(code: CalcErrorCode, detail = '') {
    super(detail === '' ? code : `${code}: ${detail}`);
    this.name = 'CalcError';
    this.code = code;
    this.detail = detail;
  }
}

/** factorial(1000) has 2,568 digits and is instant; much beyond that the page would stall. */
export const FACTORIAL_LIMIT = 1000;
/** Enough for numbers with tens of thousands of digits, and little enough to run in an instant. */
export const MAX_SOURCE_LENGTH = 100_000;
// How deep parentheses, calls and signs may be nested. Far more than anyone types by hand, far
// less than what would overflow the call stack.
const MAX_NESTING_DEPTH = 200;

export interface CalcResult {
  /** One line per statement: the value, or "name = value" for an assignment. */
  outputs: string[];
  /** The given variables plus everything the code assigned. */
  environment: Map<string, CalcValue>;
}

/** A value as plain data: a BigInt as its digits, because JSON and IndexedDB keys have no BigInt. */
export type StoredCalcValue = { big: string } | { num: number };

// ---- tokens ----

type Token =
  | { kind: 'number'; text: string; isDecimal: boolean }
  | { kind: 'name'; text: string }
  | { kind: 'operator'; text: string }
  | { kind: 'newline' }
  | { kind: 'end' };

const SINGLE_CHARACTER_OPERATORS = '+-*/()=,';
const INTEGER_DIVISION = '//';

const isDigit = (character: string | undefined): boolean => character !== undefined && character >= '0' && character <= '9';
const isNameStart = (character: string): boolean =>
  (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || character === '_';

/** O(n) in the length of the source. */
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const length = source.length;
  let position = 0;
  while (position < length) {
    const character = source[position] ?? '';
    if (character === '#') {
      while (position < length && source[position] !== '\n') position++;
      continue;
    }
    if (character === '\n') {
      tokens.push({ kind: 'newline' });
      position++;
      continue;
    }
    if (character === ' ' || character === '\t' || character === '\r') {
      position++;
      continue;
    }

    if (isDigit(character)) {
      let end = position;
      let isDecimal = false;
      for (;;) {
        if (isDigit(source[end])) end++;
        else if (source[end] === '.' && !isDecimal) {
          isDecimal = true;
          end++;
        } else break;
      }
      // An exponent counts only if digits follow the "e" (and its sign). In "2e" the "e" stays a
      // name of its own, so a typo is reported instead of quietly becoming NaN.
      if (source[end] === 'e' || source[end] === 'E') {
        let exponent = end + 1;
        if (source[exponent] === '+' || source[exponent] === '-') exponent++;
        if (isDigit(source[exponent])) {
          isDecimal = true;
          end = exponent;
          while (isDigit(source[end])) end++;
        }
      }
      tokens.push({ kind: 'number', text: source.slice(position, end), isDecimal });
      position = end;
      continue;
    }

    if (isNameStart(character)) {
      let end = position;
      while (end < length && (isNameStart(source[end] ?? '') || isDigit(source[end]))) end++;
      tokens.push({ kind: 'name', text: source.slice(position, end) });
      position = end;
      continue;
    }

    if (source.startsWith(INTEGER_DIVISION, position)) {
      tokens.push({ kind: 'operator', text: INTEGER_DIVISION });
      position += INTEGER_DIVISION.length;
      continue;
    }
    if (SINGLE_CHARACTER_OPERATORS.includes(character)) {
      tokens.push({ kind: 'operator', text: character });
      position++;
      continue;
    }
    throw new CalcError('unknown-character', character);
  }
  tokens.push({ kind: 'end' });
  return tokens;
}

// ---- syntax tree ----

type Expression =
  | { kind: 'number'; text: string; isDecimal: boolean }
  | { kind: 'variable'; name: string }
  | { kind: 'call'; name: string; args: Expression[] }
  | { kind: 'negate'; operand: Expression }
  | { kind: 'binary'; operator: string; left: Expression; right: Expression };

/** `name` is set for an assignment. */
interface Statement {
  name: string | undefined;
  expression: Expression;
}

const END_TOKEN: Token = { kind: 'end' };

/** The text of a token for an error message; empty for the end of a line or of the input. */
function describe(token: Token): string {
  return token.kind === 'newline' || token.kind === 'end' ? '' : token.text;
}

/** Recursive descent: statements, then + -, then * / //, then signs, then numbers, names and parentheses. */
function parse(tokens: readonly Token[]): Statement[] {
  let position = 0;
  let depth = 0;
  const peek = (offset = 0): Token => tokens[position + offset] ?? END_TOKEN;
  const isOperator = (token: Token, ...operators: string[]): boolean => token.kind === 'operator' && operators.includes(token.text);
  const expectOperator = (operator: string): void => {
    if (!isOperator(peek(), operator)) throw new CalcError('expected-token', operator);
    position++;
  };
  /** Runs `parseInner` one nesting level down. */
  const nested = <T>(parseInner: () => T): T => {
    depth++;
    if (depth > MAX_NESTING_DEPTH) throw new CalcError('too-complex');
    const result = parseInner();
    depth--;
    return result;
  };

  function parsePrimary(): Expression {
    const token = peek();
    if (token.kind === 'number') {
      position++;
      return { kind: 'number', text: token.text, isDecimal: token.isDecimal };
    }
    if (token.kind === 'name') {
      position++;
      if (!isOperator(peek(), '(')) return { kind: 'variable', name: token.text };
      position++;
      const args: Expression[] = [];
      if (!isOperator(peek(), ')')) {
        args.push(nested(parseExpression));
        while (isOperator(peek(), ',')) {
          position++;
          args.push(nested(parseExpression));
        }
      }
      expectOperator(')');
      return { kind: 'call', name: token.text, args };
    }
    if (isOperator(token, '(')) {
      position++;
      const inner = nested(parseExpression);
      expectOperator(')');
      return inner;
    }
    throw new CalcError('unexpected-token', describe(token));
  }

  function parseUnary(): Expression {
    const token = peek();
    if (!isOperator(token, '-', '+')) return parsePrimary();
    position++;
    const operand = nested(parseUnary);
    return token.kind === 'operator' && token.text === '-' ? { kind: 'negate', operand } : operand;
  }

  function parseBinary(operators: readonly string[], parseOperand: () => Expression): Expression {
    let left = parseOperand();
    for (;;) {
      const token = peek();
      if (token.kind !== 'operator' || !operators.includes(token.text)) return left;
      position++;
      left = { kind: 'binary', operator: token.text, left, right: parseOperand() };
    }
  }

  const parseProduct = (): Expression => parseBinary(['*', '/', INTEGER_DIVISION], parseUnary);
  function parseExpression(): Expression {
    return parseBinary(['+', '-'], parseProduct);
  }

  const statements: Statement[] = [];
  const skipLineBreaks = (): void => {
    while (peek().kind === 'newline') position++;
  };
  skipLineBreaks();
  while (peek().kind !== 'end') {
    const first = peek();
    // "name = ..." is an assignment.
    if (first.kind === 'name' && isOperator(peek(1), '=')) {
      position += 2;
      statements.push({ name: first.text, expression: parseExpression() });
    } else {
      statements.push({ name: undefined, expression: parseExpression() });
    }
    skipLineBreaks();
  }
  return statements;
}

// ---- evaluation ----

const isInteger = (value: CalcValue): value is bigint => typeof value === 'bigint';

function divide(left: CalcValue, right: CalcValue): CalcValue {
  if (isInteger(left) && isInteger(right)) {
    if (right === 0n) throw new CalcError('division-by-zero');
    // Stays an exact integer when it divides evenly.
    return left % right === 0n ? left / right : Number(left) / Number(right);
  }
  if (Number(right) === 0) throw new CalcError('division-by-zero');
  return Number(left) / Number(right);
}

/** The quotient without its fraction, rounded towards zero for integers and decimals alike. */
function divideWhole(left: CalcValue, right: CalcValue): CalcValue {
  if (isInteger(left) && isInteger(right)) {
    if (right === 0n) throw new CalcError('division-by-zero');
    return left / right;
  }
  if (Number(right) === 0) throw new CalcError('division-by-zero');
  return Math.trunc(Number(left) / Number(right));
}

function factorial(value: CalcValue): bigint {
  if (!isInteger(value) && !Number.isInteger(value)) throw new CalcError('factorial-not-integer');
  const n = BigInt(value);
  if (n < 0n) throw new CalcError('factorial-negative');
  if (n > BigInt(FACTORIAL_LIMIT)) throw new CalcError('factorial-too-large', String(FACTORIAL_LIMIT));
  let result = 1n;
  for (let factor = 2n; factor <= n; factor++) result *= factor;
  return result;
}

const FUNCTIONS: ReadonlyMap<string, (argument: CalcValue) => CalcValue> = new Map([
  ['sin', (value: CalcValue): CalcValue => Math.sin(Number(value))],
  ['cos', (value: CalcValue): CalcValue => Math.cos(Number(value))],
  ['tan', (value: CalcValue): CalcValue => Math.tan(Number(value))],
  ['factorial', factorial],
]);
const FUNCTION_ARGUMENT_COUNT = 1;

function evaluate(expression: Expression, variables: ReadonlyMap<string, CalcValue>): CalcValue {
  switch (expression.kind) {
    case 'number':
      return expression.isDecimal ? Number(expression.text) : BigInt(expression.text);
    case 'variable': {
      const value = variables.get(expression.name);
      if (value === undefined) throw new CalcError('undefined-variable', expression.name);
      return value;
    }
    case 'call': {
      const run = FUNCTIONS.get(expression.name);
      if (!run) throw new CalcError('unknown-function', expression.name);
      const [argument] = expression.args;
      if (argument === undefined || expression.args.length !== FUNCTION_ARGUMENT_COUNT) {
        throw new CalcError('wrong-argument-count', expression.name);
      }
      return run(evaluate(argument, variables));
    }
    case 'negate':
      return -evaluate(expression.operand, variables);
    case 'binary': {
      const left = evaluate(expression.left, variables);
      const right = evaluate(expression.right, variables);
      const bothIntegers = isInteger(left) && isInteger(right);
      switch (expression.operator) {
        case '+':
          return bothIntegers ? left + right : Number(left) + Number(right);
        case '-':
          return bothIntegers ? left - right : Number(left) - Number(right);
        case '*':
          return bothIntegers ? left * right : Number(left) * Number(right);
        case '/':
          return divide(left, right);
        default:
          return divideWhole(left, right);
      }
    }
  }
}

export function formatValue(value: CalcValue): string {
  // String() writes whole numbers without a decimal point, and -0 as "0".
  return isInteger(value) ? value.toString() : String(value);
}

/**
 * Runs the code line by line. `initial` holds variables from earlier runs and is not changed.
 * Throws CalcError; nothing is returned from a run that failed part-way.
 */
export function runCode(source: string, initial: ReadonlyMap<string, CalcValue> = new Map()): CalcResult {
  if (source.length > MAX_SOURCE_LENGTH) throw new CalcError('source-too-long', String(MAX_SOURCE_LENGTH));
  try {
    const environment = new Map(initial);
    const outputs: string[] = [];
    for (const statement of parse(tokenize(source))) {
      const value = evaluate(statement.expression, environment);
      if (statement.name === undefined) {
        outputs.push(formatValue(value));
      } else {
        environment.set(statement.name, value);
        outputs.push(`${statement.name} = ${formatValue(value)}`);
      }
    }
    return { outputs, environment };
  } catch (error) {
    // The engine's own limits: a call stack that is too deep (a very long chain of operations),
    // or an integer too large to hold.
    if (error instanceof RangeError) throw new CalcError('too-complex');
    throw error;
  }
}

const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INTEGER_DIGITS_PATTERN = /^-?\d+$/;

/** The variables as plain data. Values that are not finite numbers cannot be stored and are left out. */
export function toStoredEnvironment(environment: ReadonlyMap<string, CalcValue>): Record<string, StoredCalcValue> {
  const entries: [string, StoredCalcValue][] = [];
  for (const [name, value] of environment) {
    if (isInteger(value)) entries.push([name, { big: value.toString() }]);
    else if (Number.isFinite(value)) entries.push([name, { num: value }]);
  }
  // fromEntries defines own properties, so a variable called "__proto__" is stored like any other.
  return Object.fromEntries(entries);
}

/** Reads what toStoredEnvironment wrote. Entries that make no sense are dropped one by one. */
export function parseStoredEnvironment(value: unknown): Map<string, CalcValue> {
  const environment = new Map<string, CalcValue>();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return environment;
  for (const [name, stored] of Object.entries(value)) {
    if (!VARIABLE_NAME_PATTERN.test(name) || typeof stored !== 'object' || stored === null) continue;
    const { big, num } = stored as { big?: unknown; num?: unknown };
    if (typeof big === 'string' && INTEGER_DIGITS_PATTERN.test(big)) environment.set(name, BigInt(big));
    else if (typeof num === 'number' && Number.isFinite(num)) environment.set(name, num);
  }
  return environment;
}
