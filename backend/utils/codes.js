import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I

/** e.g. BB-261102-7KQ4XZ: a prefix, today's date and 6 random characters. */
export function randomCode(prefix) {
  const date = new Date().toISOString().slice(2, 10).replaceAll("-", "");
  const random = Array.from(
    crypto.randomBytes(6),
    (b) => ALPHABET[b % ALPHABET.length],
  ).join("");
  return `${prefix}-${date}-${random}`;
}
