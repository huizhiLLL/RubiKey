export function bytesToHex(bytes: number[]) {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

export function normalizeUuid(uuid: string) {
  return uuid.toLowerCase();
}

export function uniqueNumbers(values: readonly number[]) {
  return [...new Set(values)];
}

export function uniqueStrings(values: readonly string[]) {
  return [...new Set(values)];
}
