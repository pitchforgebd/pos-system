import bcrypt from "bcryptjs";

function cost() {
  const parsed = Number(process.env.BCRYPT_COST ?? "12");
  if (!Number.isInteger(parsed) || parsed < 4 || parsed > 15) {
    return 12;
  }
  if (process.env.NODE_ENV === "production" && parsed < 12) {
    return 12;
  }
  return parsed;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, cost());
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

const dummies = new Map<number, Promise<string>>();

/** A hash of a password nobody has, at the same cost as a real one, to check against when the email is unknown so the time taken tells nothing (S9). */
export function dummyHash() {
  const at = cost();
  let hash = dummies.get(at);
  if (!hash) {
    hash = hashPassword(`no-one-has-this-${Math.random()}-${Date.now()}`);
    dummies.set(at, hash);
  }
  return hash;
}
