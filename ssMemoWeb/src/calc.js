// ========================================
// ssMemo 코드 블럭 실행기
// 지원: 변수 대입, +, -, *, /, //, 괄호, sin/cos/tan, factorial(n<=1000), # 주석
// 정수는 BigInt로 처리해 5000자리 이상도 정확.
// 외부 라이브러리 의존 없이 순수 함수로 구현.
// ========================================

const FACTORIAL_LIMIT = 1000;

// ---- Tokenizer ----
function tokenize(source) {
    const tokens = [];
    let i = 0;
    const len = source.length;
    while (i < len) {
        const ch = source[i];
        if (ch === '#') {
            while (i < len && source[i] !== '\n') i++;
            continue;
        }
        if (ch === '\n') { tokens.push({ type: 'NL' }); i++; continue; }
        if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }

        if (ch >= '0' && ch <= '9') {
            let j = i;
            let hasDot = false;
            while (j < len) {
                const c = source[j];
                if (c >= '0' && c <= '9') { j++; continue; }
                if (c === '.' && !hasDot) { hasDot = true; j++; continue; }
                break;
            }
            if (j < len && (source[j] === 'e' || source[j] === 'E')) {
                hasDot = true;
                j++;
                if (j < len && (source[j] === '+' || source[j] === '-')) j++;
                while (j < len && source[j] >= '0' && source[j] <= '9') j++;
            }
            tokens.push({ type: 'NUM', value: source.slice(i, j), isFloat: hasDot });
            i = j;
            continue;
        }

        if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
            let j = i;
            while (j < len) {
                const c = source[j];
                if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                    (c >= '0' && c <= '9') || c === '_') { j++; continue; }
                break;
            }
            tokens.push({ type: 'ID', value: source.slice(i, j) });
            i = j;
            continue;
        }

        if (ch === '/' && source[i + 1] === '/') {
            tokens.push({ type: 'OP', value: '//' });
            i += 2;
            continue;
        }
        if ('+-*/()=,'.indexOf(ch) >= 0) {
            tokens.push({ type: 'OP', value: ch });
            i++;
            continue;
        }
        throw new Error(`알 수 없는 문자: "${ch}"`);
    }
    tokens.push({ type: 'EOF' });
    return tokens;
}

// ---- Parser (recursive descent) ----
function parse(tokens) {
    let pos = 0;
    const peek = (off = 0) => tokens[pos + off];
    const consume = () => tokens[pos++];
    const expect = (type, value) => {
        const t = peek();
        if (t.type !== type || (value !== undefined && t.value !== value)) {
            throw new Error(`기대한 토큰: ${value || type}, 실제: ${t.value || t.type}`);
        }
        return consume();
    };

    function parsePrimary() {
        const t = peek();
        if (t.type === 'NUM') {
            consume();
            return { type: 'Num', value: t.value, isFloat: t.isFloat };
        }
        if (t.type === 'ID') {
            consume();
            if (peek().type === 'OP' && peek().value === '(') {
                consume();
                const args = [];
                if (!(peek().type === 'OP' && peek().value === ')')) {
                    args.push(parseExpr());
                    while (peek().type === 'OP' && peek().value === ',') {
                        consume();
                        args.push(parseExpr());
                    }
                }
                expect('OP', ')');
                return { type: 'Call', name: t.value, args };
            }
            return { type: 'Var', name: t.value };
        }
        if (t.type === 'OP' && t.value === '(') {
            consume();
            const expr = parseExpr();
            expect('OP', ')');
            return expr;
        }
        throw new Error(`예상치 못한 토큰: ${t.value || t.type}`);
    }

    function parseUnary() {
        if (peek().type === 'OP' && (peek().value === '-' || peek().value === '+')) {
            const op = consume().value;
            return { type: 'Unary', op, expr: parseUnary() };
        }
        return parsePrimary();
    }

    function parseMul() {
        let left = parseUnary();
        while (peek().type === 'OP' &&
               (peek().value === '*' || peek().value === '/' || peek().value === '//')) {
            const op = consume().value;
            const right = parseUnary();
            left = { type: 'Bin', op, left, right };
        }
        return left;
    }

    function parseAdd() {
        let left = parseMul();
        while (peek().type === 'OP' && (peek().value === '+' || peek().value === '-')) {
            const op = consume().value;
            const right = parseMul();
            left = { type: 'Bin', op, left, right };
        }
        return left;
    }

    function parseExpr() { return parseAdd(); }

    function parseStatement() {
        // ID '=' ... 패턴이면 대입문
        if (peek().type === 'ID' && peek(1).type === 'OP' && peek(1).value === '=') {
            const name = consume().value;
            consume(); // '='
            return { type: 'Assign', name, expr: parseExpr() };
        }
        return { type: 'ExprStmt', expr: parseExpr() };
    }

    function parseProgram() {
        const statements = [];
        while (peek().type === 'NL') consume();
        while (peek().type !== 'EOF') {
            statements.push(parseStatement());
            while (peek().type === 'NL') consume();
        }
        return { type: 'Program', statements };
    }

    return parseProgram();
}

// ---- Evaluator ----
const isBig = (v) => typeof v === 'bigint';

function add(a, b) {
    if (isBig(a) && isBig(b)) return a + b;
    return Number(a) + Number(b);
}
function sub(a, b) {
    if (isBig(a) && isBig(b)) return a - b;
    return Number(a) - Number(b);
}
function mul(a, b) {
    if (isBig(a) && isBig(b)) return a * b;
    return Number(a) * Number(b);
}
function div(a, b) {
    if (isBig(a) && isBig(b)) {
        if (b === 0n) throw new Error('0으로 나눌 수 없습니다');
        if (a % b === 0n) return a / b;
        return Number(a) / Number(b);
    }
    const bn = Number(b);
    if (bn === 0) throw new Error('0으로 나눌 수 없습니다');
    return Number(a) / bn;
}
function floorDiv(a, b) {
    if (isBig(a) && isBig(b)) {
        if (b === 0n) throw new Error('0으로 나눌 수 없습니다');
        return a / b;
    }
    const bn = Number(b);
    if (bn === 0) throw new Error('0으로 나눌 수 없습니다');
    return Math.trunc(Number(a) / bn);
}
function neg(a) { return isBig(a) ? -a : -Number(a); }

function factorial(n) {
    const big = isBig(n) ? n : (Number.isInteger(n) ? BigInt(n) : null);
    if (big === null) throw new Error('factorial 인자는 정수여야 합니다');
    if (big < 0n) throw new Error('factorial은 음수에 대해 정의되지 않습니다');
    if (big > BigInt(FACTORIAL_LIMIT)) {
        throw new Error(`factorial은 ${FACTORIAL_LIMIT}까지만 지원합니다`);
    }
    let r = 1n;
    for (let i = 2n; i <= big; i++) r *= i;
    return r;
}

const FUNCTIONS = {
    sin: (n) => Math.sin(Number(n)),
    cos: (n) => Math.cos(Number(n)),
    tan: (n) => Math.tan(Number(n)),
    factorial,
};

function evalNode(node, env) {
    switch (node.type) {
        case 'Num':
            return node.isFloat ? Number(node.value) : BigInt(node.value);
        case 'Var':
            if (!(node.name in env)) throw new Error(`정의되지 않은 변수: ${node.name}`);
            return env[node.name];
        case 'Call': {
            const fn = FUNCTIONS[node.name];
            if (!fn) throw new Error(`알 수 없는 함수: ${node.name}`);
            if (node.args.length !== 1) throw new Error(`${node.name}은 인자 1개를 받습니다`);
            return fn(evalNode(node.args[0], env));
        }
        case 'Unary': {
            const v = evalNode(node.expr, env);
            return node.op === '-' ? neg(v) : v;
        }
        case 'Bin': {
            const l = evalNode(node.left, env);
            const r = evalNode(node.right, env);
            switch (node.op) {
                case '+':  return add(l, r);
                case '-':  return sub(l, r);
                case '*':  return mul(l, r);
                case '/':  return div(l, r);
                case '//': return floorDiv(l, r);
            }
            throw new Error(`알 수 없는 연산자: ${node.op}`);
        }
        case 'Assign': {
            const v = evalNode(node.expr, env);
            env[node.name] = v;
            return v;
        }
        case 'ExprStmt':
            return evalNode(node.expr, env);
    }
    throw new Error(`알 수 없는 노드: ${node.type}`);
}

export function formatValue(v) {
    if (typeof v === 'bigint') return v.toString();
    if (Number.isInteger(v)) return v.toString();
    return Number(v).toString();
}

// 변수 환경을 영속 저장(IndexedDB 등 텍스트 스토리지)에 보관할 수 있도록
// JSON 문자열로 직렬화. BigInt는 _big 마커로 보존해 복원 시 정확.
export function serializeEnv(env) {
    const out = {};
    for (const [k, v] of Object.entries(env)) {
        if (typeof v === 'bigint') out[k] = { _big: v.toString() };
        else if (typeof v === 'number' && Number.isFinite(v)) out[k] = { _num: v };
        // 이외 타입(undefined/NaN/Infinity/객체)은 저장 대상 아님 → 스킵
    }
    return JSON.stringify(out);
}

export function deserializeEnv(str) {
    const out = {};
    if (!str) return out;
    let parsed;
    try { parsed = JSON.parse(str); } catch { return out; }
    if (!parsed || typeof parsed !== 'object') return out;
    for (const [k, v] of Object.entries(parsed)) {
        if (!v || typeof v !== 'object') continue;
        if (typeof v._big === 'string') {
            try { out[k] = BigInt(v._big); } catch { /* skip */ }
        } else if (typeof v._num === 'number') {
            out[k] = v._num;
        }
    }
    return out;
}

export function runCode(source, initialEnv = {}) {
    const tokens = tokenize(source);
    const ast = parse(tokens);
    const env = { ...initialEnv };
    const outputs = [];
    let last;
    for (const stmt of ast.statements) {
        const v = evalNode(stmt, env);
        last = v;
        if (stmt.type === 'Assign') {
            outputs.push(`${stmt.name} = ${formatValue(v)}`);
        } else {
            outputs.push(formatValue(v));
        }
    }
    return { result: last, env, outputs };
}
