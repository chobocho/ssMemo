// Document ids. crypto.randomUUID exists only in secure contexts (https, localhost); a page opened
// through a LAN address does not have it, so a version 4 UUID is assembled by hand there.

/** The part of the Web Crypto API this module needs. */
export interface RandomSource {
  randomUUID?: () => string;
  getRandomValues(array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
}

const UUID_BYTE_LENGTH = 16;
const HEX_RADIX = 16;
const HEX_DIGITS_PER_BYTE = 2;
// RFC 4122: byte 6 carries the version (4 = random) and byte 8 the variant.
const VERSION_BYTE_INDEX = 6;
const VERSION_KEEP_MASK = 0x0f;
const VERSION_4_BITS = 0x40;
const VARIANT_BYTE_INDEX = 8;
const VARIANT_KEEP_MASK = 0x3f;
const VARIANT_BITS = 0x80;
// Lengths of the hex groups in the canonical 8-4-4-4-12 form.
const UUID_GROUP_LENGTHS: readonly number[] = [8, 4, 4, 4, 12];

export function createRandomId(crypto: RandomSource): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(UUID_BYTE_LENGTH));
  bytes[VERSION_BYTE_INDEX] = ((bytes[VERSION_BYTE_INDEX] ?? 0) & VERSION_KEEP_MASK) | VERSION_4_BITS;
  bytes[VARIANT_BYTE_INDEX] = ((bytes[VARIANT_BYTE_INDEX] ?? 0) & VARIANT_KEEP_MASK) | VARIANT_BITS;
  const hex = [...bytes].map((byte) => byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, '0')).join('');

  const groups: string[] = [];
  let offset = 0;
  for (const length of UUID_GROUP_LENGTHS) {
    groups.push(hex.slice(offset, offset + length));
    offset += length;
  }
  return groups.join('-');
}
