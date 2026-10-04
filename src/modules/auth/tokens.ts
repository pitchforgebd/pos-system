import { createHmac, randomBytes } from "node:crypto";

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) {
    throw new Error("AUTH_SECRET is missing");
  }
  return value;
}

export function newToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string) {
  return createHmac("sha256", secret()).update(token).digest("hex");
}
