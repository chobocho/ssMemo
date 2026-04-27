// ========================================
// 한글 인코딩 자동 감지/디코딩
// 지원: UTF-8, CP949(EUC-KR 호환), Johab(조합형)
// 외부 라이브러리 없음. UTF-8/EUC-KR은 브라우저의 TextDecoder를 사용하고,
// Johab은 KS X 1001 부속서 3의 조합형 한글 음절 비트 패턴을 직접 디코딩한다.
// ========================================

// UTF-8 디코드. 잘못된 바이트 시퀀스가 있으면 null 반환.
function tryUtf8(buffer) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        return null;
    }
}

function decodeCp949(buffer) {
    // 브라우저의 'euc-kr' 디코더는 실제로 windows-949(=CP949)를 사용한다.
    return new TextDecoder('euc-kr').decode(buffer);
}

// ----- Johab(조합형) 디코더 -----
// Hangul syllable bit layout: 1 IIIII MMMMM FFFFF (16-bit, MSB=1)
// 5-bit 인덱스 → 모던 한글 인덱스 변환 (-1 = 정의 안 됨)

const JOHAB_INITIAL = new Int8Array(32).fill(-1);
[[0x02,0],[0x03,1],[0x04,2],[0x05,3],[0x06,4],
 [0x07,5],[0x08,6],[0x09,7],[0x0A,8],[0x0B,9],
 [0x0C,10],[0x0D,11],[0x0E,12],[0x0F,13],[0x10,14],
 [0x11,15],[0x12,16],[0x13,17],[0x14,18]
].forEach(([k, v]) => { JOHAB_INITIAL[k] = v; });

const JOHAB_MEDIAL = new Int8Array(32).fill(-1);
[[0x03,0],[0x04,1],[0x05,2],[0x06,3],[0x07,4],
 [0x0A,5],[0x0B,6],[0x0C,7],[0x0D,8],[0x0E,9],
 [0x12,10],[0x13,11],[0x14,12],[0x15,13],[0x16,14],
 [0x1A,15],[0x1B,16],[0x1C,17],[0x1D,18],[0x1E,19],[0x1F,20]
].forEach(([k, v]) => { JOHAB_MEDIAL[k] = v; });

const JOHAB_FINAL = new Int8Array(32).fill(-1);
[[0x01,0],
 [0x02,1],[0x03,2],[0x04,3],[0x05,4],[0x06,5],[0x07,6],
 [0x0A,7],[0x0B,8],[0x0C,9],[0x0D,10],[0x0E,11],[0x0F,12],
 [0x12,13],[0x13,14],[0x14,15],[0x15,16],[0x16,17],[0x17,18],
 [0x1A,19],[0x1B,20],[0x1C,21],[0x1D,22],[0x1E,23],[0x1F,24]
].forEach(([k, v]) => { JOHAB_FINAL[k] = v; });

// 두 바이트가 Johab 한글 음절 영역인지 검사.
function isJohabHangulPair(b1, b2) {
    if (b1 < 0x84 || b1 > 0xD3) return false;
    return (b2 >= 0x41 && b2 <= 0x7E) || (b2 >= 0x81 && b2 <= 0xFE);
}

// Johab 2바이트 → Unicode codepoint, 매핑 안 되면 null.
function johabPairToUnicode(b1, b2) {
    const v = (b1 << 8) | b2;
    const init = (v >> 10) & 0x1F;
    const med = (v >> 5) & 0x1F;
    const fin = v & 0x1F;
    const ci = JOHAB_INITIAL[init];
    const mi = JOHAB_MEDIAL[med];
    const fi = JOHAB_FINAL[fin];
    if (ci < 0 || mi < 0 || fi < 0) return null;
    return 0xAC00 + ci * 588 + mi * 28 + fi;
}

function decodeJohab(buffer) {
    const bytes = new Uint8Array(buffer);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        const b1 = bytes[i];
        if (b1 < 0x80) {
            // ASCII 영역은 그대로 통과.
            out += String.fromCharCode(b1);
            continue;
        }
        const b2 = bytes[i + 1] ?? 0;
        if (isJohabHangulPair(b1, b2)) {
            const cp = johabPairToUnicode(b1, b2);
            if (cp != null) {
                out += String.fromCharCode(cp);
                i++;
                continue;
            }
        }
        // Johab 한글 음절이 아닌 2바이트(한자/특수기호 등)는 매핑이 까다로워
        // 대체 문자(U+FFFD)로 표시한다.
        out += '\uFFFD';
        if (b2 !== 0) i++;
    }
    return out;
}

// 바이트 분포로 Johab 가능성을 가늠한다.
// CP949(EUC-KR)는 보통 lead byte가 0xA1-0xFE에 분포하지만,
// Johab은 0x84-0xA0 영역도 활발히 사용한다.
function looksLikeJohab(buffer) {
    const bytes = new Uint8Array(buffer);
    let johabRange = 0; // 0x84-0xA0
    let euckrLeadOnly = 0; // 0xA1-0xFE
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b >= 0x84 && b <= 0xA0) johabRange++;
        else if (b >= 0xA1 && b <= 0xFE) euckrLeadOnly++;
    }
    // 0x84-0xA0 영역 바이트가 충분히 많고 EUC-KR 영역과 비슷하거나 많으면 Johab으로 판단.
    return johabRange >= 4 && johabRange >= euckrLeadOnly * 0.4;
}

export function decodeKoreanText(buffer) {
    const utf8 = tryUtf8(buffer);
    if (utf8 !== null) {
        return { text: utf8, encoding: 'UTF-8' };
    }
    if (looksLikeJohab(buffer)) {
        return { text: decodeJohab(buffer), encoding: 'Johab' };
    }
    return { text: decodeCp949(buffer), encoding: 'CP949' };
}

// 명시적 인코딩 지정용 헬퍼 (사용자 수동 선택 시).
export function decodeWithEncoding(buffer, encoding) {
    switch (encoding) {
        case 'UTF-8':
            return tryUtf8(buffer) ?? new TextDecoder('utf-8').decode(buffer);
        case 'CP949':
            return decodeCp949(buffer);
        case 'Johab':
            return decodeJohab(buffer);
        default:
            throw new Error(`알 수 없는 인코딩: ${encoding}`);
    }
}
