// ========================================
// 코드 블럭 실행기 단위 테스트
// ========================================
import { runCode, formatValue, serializeEnv, deserializeEnv } from '../src/calc.js';
import { assertEqual, section } from './runner.js';

section('calc.js — 기본 산술');

assertEqual(runCode('1 + 2').outputs, ['3'], '1 + 2 = 3');
assertEqual(runCode('10 - 7').outputs, ['3'], '10 - 7 = 3');
assertEqual(runCode('6 * 7').outputs, ['42'], '6 * 7 = 42');
assertEqual(runCode('20 / 4').outputs, ['5'], '20 / 4 = 5 (정확 나눗셈은 BigInt 유지)');
assertEqual(runCode('7 / 2').outputs, ['3.5'], '7 / 2 = 3.5 (부정확 나눗셈은 부동소수점)');
assertEqual(runCode('7 // 2').outputs, ['3'], '7 // 2 = 3 (정수 몫)');
assertEqual(runCode('-7 // 2').outputs, ['-3'], '-7 // 2 = -3 (truncation)');

section('calc.js — 괄호/우선순위/단항');

assertEqual(runCode('(1 + 2) * 3').outputs, ['9'], '(1 + 2) * 3 = 9');
assertEqual(runCode('1 + 2 * 3').outputs, ['7'], '1 + 2 * 3 = 7 (곱 우선)');
assertEqual(runCode('-(3 + 4)').outputs, ['-7'], '단항 - 적용');
assertEqual(runCode('--5').outputs, ['5'], '이중 단항');

section('calc.js — 변수');

assertEqual(
    runCode('x = 10\ny = 20\nx + y').outputs,
    ['x = 10', 'y = 20', '30'],
    '변수 설정 후 사용'
);
assertEqual(
    runCode('a = 3\nb = a * a\nb').outputs,
    ['a = 3', 'b = 9', '9'],
    '변수끼리 연산'
);

section('calc.js — 큰 수 (5000자리)');

const big5000 = '9'.repeat(5000);
const big5000Plus1 = '1' + '0'.repeat(5000);
assertEqual(runCode(`${big5000} + 1`).outputs, [big5000Plus1], '5000자리 + 1');
const big2500 = '9'.repeat(2500);
// (10^2500 - 1) * 2 = 2 * 10^2500 - 2 = "1" + "9"*2499 + "8" (총 2501자리)
const expectedMul = '1' + '9'.repeat(2499) + '8';
assertEqual(runCode(`${big2500} * 2`).outputs, [expectedMul], '2500자리 * 2');
assertEqual(runCode(`${big5000} - ${big5000}`).outputs, ['0'], '5000자리 자기 자신 - = 0');

section('calc.js — 함수');

assertEqual(runCode('factorial(0)').outputs, ['1'], 'factorial(0) = 1');
assertEqual(runCode('factorial(5)').outputs, ['120'], 'factorial(5) = 120');
assertEqual(runCode('factorial(20)').outputs, ['2432902008176640000'], 'factorial(20)');
// factorial(1000)은 정확히 2568자리
assertEqual(runCode('factorial(1000)').outputs[0].length, 2568, 'factorial(1000) 자리수');
assertEqual(runCode('cos(0)').outputs, ['1'], 'cos(0) = 1');
assertEqual(runCode('sin(0)').outputs, ['0'], 'sin(0) = 0');
assertEqual(runCode('tan(0)').outputs, ['0'], 'tan(0) = 0');

section('calc.js — 주석');

assertEqual(runCode('# 주석만\n3 + 4').outputs, ['7'], '한 줄 주석 무시');
assertEqual(runCode('1 + 2 # 인라인 주석').outputs, ['3'], '인라인 주석 무시');
assertEqual(runCode('# 모두 주석').outputs, [], '주석만 있으면 출력 없음');

section('calc.js — 에러 처리');

function assertThrows(fn, needle, label) {
    try {
        fn();
        assertEqual(true, false, `${label} (에러 발생 안 함)`);
    } catch (e) {
        const ok = e.message.includes(needle);
        assertEqual(ok ? needle : e.message, needle, label);
    }
}

assertThrows(() => runCode('5 / 0'), '0으로', '0 나눗셈 에러');
assertThrows(() => runCode('5 // 0'), '0으로', '0 정수나눗셈 에러');
assertThrows(() => runCode('factorial(1001)'), '1000', 'factorial 한도 초과');
assertThrows(() => runCode('factorial(-1)'), '음수', 'factorial 음수');
assertThrows(() => runCode('unknown'), '정의되지 않은', '미정의 변수');
assertThrows(() => runCode('foo(1)'), '알 수 없는 함수', '미정의 함수');
assertThrows(() => runCode('1 +'), '예상치 못한', '불완전 표현식');

section('calc.js — initialEnv (메모리)');

// 외부에서 주입한 변수가 코드에서 사용 가능
assertEqual(runCode('x + 5', { x: 10n }).outputs, ['15'], 'initialEnv의 BigInt 변수 사용');
assertEqual(runCode('y * 2', { y: 3.14 }).outputs, ['6.28'], 'initialEnv의 Number 변수 사용');

// initialEnv는 원본이 보존(불변)되어야 함
const memBefore = { a: 1n };
const r = runCode('a = 99\nb = 2', memBefore);
assertEqual(memBefore.a, 1n, 'initialEnv 원본 a는 보존됨');
assertEqual('b' in memBefore, false, 'initialEnv에 새 변수가 새지 않음');
// 반환된 env에는 신/구 변수 모두 포함
assertEqual(r.env.a, 99n, '반환 env에 갱신된 변수 포함');
assertEqual(r.env.b, 2n, '반환 env에 신규 변수 포함');

section('calc.js — formatValue');

assertEqual(formatValue(42n), '42', 'BigInt 포맷');
assertEqual(formatValue(3.14), '3.14', 'Number 포맷');
assertEqual(formatValue(1.0), '1', 'Number 정수형 포맷');

section('calc.js — serialize/deserialize (영속 저장)');

// 라운드트립: BigInt + Number 혼합
const env = { x: 12345678901234567890n, y: 3.14, z: 0n };
const ser = serializeEnv(env);
const back = deserializeEnv(ser);
assertEqual(back.x, 12345678901234567890n, '5000자리 BigInt 라운드트립');
assertEqual(back.y, 3.14, 'Number 라운드트립');
assertEqual(back.z, 0n, '0 BigInt 라운드트립');

// 5000자리 정확 보존
const big = BigInt('9'.repeat(5000));
const r5000 = deserializeEnv(serializeEnv({ huge: big }));
assertEqual(r5000.huge === big, true, '5000자리 BigInt 정확 보존');

// 빈 문자열/null/잘못된 JSON
assertEqual(deserializeEnv(''), {}, '빈 문자열은 빈 env');
assertEqual(deserializeEnv('not-json'), {}, '잘못된 JSON은 빈 env');
assertEqual(deserializeEnv('null'), {}, 'null도 빈 env');

// 직렬화된 값을 calc 실행에 주입 가능
const reloaded = deserializeEnv(serializeEnv({ a: 100n }));
assertEqual(runCode('a * 2', reloaded).outputs, ['200'], '직렬화/역직렬화 후 코드 실행');
