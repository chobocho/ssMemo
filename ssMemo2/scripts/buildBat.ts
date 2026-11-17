// Renders the UTF-8 build.bat template into the bytes Windows cmd needs: cp949 + CRLF.
//
// Node ships a cp949 decoder but no encoder. The encoding table is therefore derived by decoding
// every two-byte sequence of the KS X 1001 plane and inverting the result. That plane holds the
// 2,350 common Hangul syllables, which is all the build messages need; anything else is rejected
// loudly instead of being written as a wrong byte.

const KS_X_1001_FIRST_BYTE = 0xa1;
const KS_X_1001_LAST_BYTE = 0xfe;
const ASCII_LIMIT = 0x80;
const HEX_RADIX = 16;

type BytePair = readonly [lead: number, trail: number];

// O(94 * 94) decodes, done once when the module loads.
function buildReverseTable(): ReadonlyMap<string, BytePair> {
  const decoder = new TextDecoder('euc-kr', { fatal: true });
  const table = new Map<string, BytePair>();
  const pair = new Uint8Array(2);
  for (let lead = KS_X_1001_FIRST_BYTE; lead <= KS_X_1001_LAST_BYTE; lead++) {
    for (let trail = KS_X_1001_FIRST_BYTE; trail <= KS_X_1001_LAST_BYTE; trail++) {
      pair[0] = lead;
      pair[1] = trail;
      let character: string;
      try {
        character = decoder.decode(pair);
      } catch {
        continue; // unassigned position in the plane
      }
      if (!table.has(character)) {
        table.set(character, [lead, trail]);
      }
    }
  }
  return table;
}

const REVERSE_TABLE = buildReverseTable();

/**
 * Encodes `text` as cp949. ASCII passes through; any character outside ASCII and the
 * KS X 1001 plane throws, naming the character. O(n) time in the number of code points.
 */
export function encodeCp949(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < ASCII_LIMIT) {
      bytes.push(codePoint);
      continue;
    }
    const pair = REVERSE_TABLE.get(character);
    if (!pair) {
      const hex = codePoint.toString(HEX_RADIX).toUpperCase();
      throw new Error(`Character "${character}" (U+${hex}) cannot be encoded as cp949`);
    }
    bytes.push(pair[0], pair[1]);
  }
  return Uint8Array.from(bytes);
}

/** Converts the template's line endings to CRLF and encodes the result as cp949. */
export function renderBuildBat(template: string): Uint8Array {
  return encodeCp949(template.replace(/\r?\n/g, '\r\n'));
}
