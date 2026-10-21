/**
 * PASSWORDS, with node's own crypto and nothing else.
 *
 * A work account has no phone, so it cannot sign in the way every other account
 * in this service does. Before this it had exactly one door -- a link mailed to
 * its address -- and an unconfigured mail provider meant that account had no
 * way in at all. Not a slower way in; none.
 *
 * scrypt rather than bcrypt or argon2 because both of those are native
 * dependencies and this one ships with the runtime. It is memory-hard, which is
 * the property that matters: a GPU farm does not get the thousand-fold
 * advantage over it that it gets over a plain hash.
 *
 * N = 16384 costs roughly a tenth of a second here. That is beneath notice for
 * somebody typing a password once and ruinous for somebody trying a dictionary.
 * The cost parameter is stored INSIDE the hash, so raising it later leaves
 * every existing password still verifiable rather than locking everybody out.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

const N = 16384;
const KEY_LEN = 64;
const SALT_LEN = 16;

/** Short enough to be refused for being short, long enough to be a password. */
export const MIN_LENGTH = 10;

export function passwordComplaint(password) {
  if (typeof password !== "string") return "A password is required.";
  if (password.length < MIN_LENGTH) {
    return `Use at least ${MIN_LENGTH} characters. Longer beats clever.`;
  }
  if (password.length > 200) return "That is longer than this will store.";
  return null;
}

export async function hashPassword(password) {
  const complaint = passwordComplaint(password);
  if (complaint) throw new Error(complaint);
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(password, salt, KEY_LEN, { N });
  return `scrypt$${N}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/**
 * Verify, in constant time, and never throw.
 *
 * A malformed or absent stored hash returns false rather than raising: an
 * account with no password must fail to sign in, not produce a 500 that tells
 * an attacker the account exists.
 */
export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const cost = Number(parts[1]);
  if (!Number.isInteger(cost) || cost < 1024) return false;
  try {
    const salt = Buffer.from(parts[2], "hex");
    const expected = Buffer.from(parts[3], "hex");
    const key = await scrypt(password, salt, expected.length, { N: cost });
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
