import { createHash, randomBytes } from "node:crypto";

/** A random portal token for the link; only its SHA-256 hash is stored. */
export function newPortalToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
