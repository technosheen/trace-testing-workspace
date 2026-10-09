import { createHash, scryptSync, timingSafeEqual } from "node:crypto";
export const hosted = process.env.TRACE_HOSTED === "1";
export function equalSecret(a, b) {
  return timingSafeEqual(
    createHash("sha256")
      .update(a || "")
      .digest(),
    createHash("sha256")
      .update(b || "")
      .digest(),
  );
}
export function parsePasswordHash(value) {
  const [scheme, salt, hash, extra] = (value || "").split(":");
  if (
    scheme !== "scrypt" ||
    !/^[a-f0-9]{32}$/.test(salt || "") ||
    !/^[a-f0-9]{128}$/.test(hash || "") ||
    extra
  )
    throw new Error("Set TRACE_PASSWORD_HASH to a valid scrypt password hash.");
  return { salt, hash };
}
if (hosted) {
  if ((process.env.TRACE_RUNNER_KEY || "").length < 32)
    throw new Error(
      "Hosted mode requires TRACE_RUNNER_KEY of at least 32 characters.",
    );
  parsePasswordHash(process.env.TRACE_PASSWORD_HASH);
}
export function authenticated(req) {
  return equalSecret(
    req.headers.authorization,
    `Bearer ${process.env.TRACE_RUNNER_KEY}`,
  );
}
const attempts = new Map();
let windowStart = 0,
  total = 0;
export function verifyPassword(password, client) {
  const now = Date.now();
  if (now - windowStart > 60000) {
    windowStart = now;
    total = 0;
    attempts.clear();
  }
  const count = attempts.get(client) || 0;
  if (count >= 5 || total >= 30)
    return {
      status: 429,
      error: "Too many sign-in attempts. Try again in a minute.",
    };
  attempts.set(client, count + 1);
  total++;
  if (typeof password !== "string" || password.length > 256)
    return { status: 401, error: "Incorrect password." };
  const { salt, hash } = parsePasswordHash(process.env.TRACE_PASSWORD_HASH);
  const ok = timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(hash, "hex"),
  );
  return ok
    ? { status: 200, authenticated: true }
    : { status: 401, error: "Incorrect password." };
}
