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
