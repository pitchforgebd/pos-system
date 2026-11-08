/**
 * A random v4 UUID that works everywhere a page can run. `crypto.randomUUID` exists only in a secure context
 * (https or localhost); a shop PC that opens the app over plain http on the local network does not have it,
 * and the sale button must not break there. `getRandomValues` works in every browser the app supports.
 */
export function newUuid(source: Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string } = globalThis.crypto): string {
  if (typeof source.randomUUID === "function") {
    return source.randomUUID();
  }
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
