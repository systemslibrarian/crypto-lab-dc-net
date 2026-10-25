export type RandomBytes = (length: number) => Uint8Array;

function assertByteLength(length: number, label: string): void {
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

export function copyBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}

export function zeroBytes(length: number): Uint8Array {
  assertByteLength(length, "byte length");
  return new Uint8Array(length);
}

export function bytesToHex(value: Uint8Array): string {
  let result = "";
  for (const byte of value) {
    result += byte.toString(16).padStart(2, "0");
  }
  return result;
}

export function hexToBytes(value: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(value)) {
    throw new TypeError(
      "hex input must be a non-empty, even-length byte string",
    );
  }

  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return result;
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

export function isZeroBytes(value: Uint8Array): boolean {
  let combined = 0;
  for (const byte of value) combined |= byte;
  return combined === 0;
}

export function xorBytes(...values: readonly Uint8Array[]): Uint8Array {
  if (values.length === 0) {
    throw new RangeError("xorBytes requires at least one byte vector");
  }

  const width = values[0]!.length;
  assertByteLength(width, "byte-vector width");
  const result = new Uint8Array(width);

  for (const value of values) {
    if (value.length !== width) {
      throw new RangeError("all byte vectors must have the same width");
    }
    for (let index = 0; index < width; index += 1) {
      result[index] ^= value[index]!;
    }
  }

  return result;
}

export const secureRandomBytes: RandomBytes = (length) => {
  assertByteLength(length, "random byte length");
  const cryptoApi = globalThis.crypto;
  if (
    cryptoApi === undefined ||
    typeof cryptoApi.getRandomValues !== "function"
  ) {
    throw new Error("Web Crypto getRandomValues is unavailable");
  }
  return cryptoApi.getRandomValues(new Uint8Array(length));
};

export function sampleBytes(
  length: number,
  randomBytes: RandomBytes = secureRandomBytes,
): Uint8Array {
  assertByteLength(length, "random byte length");
  const sampled = randomBytes(length);
  if (!(sampled instanceof Uint8Array) || sampled.length !== length) {
    throw new RangeError(`random source must return exactly ${length} bytes`);
  }
  return copyBytes(sampled);
}
