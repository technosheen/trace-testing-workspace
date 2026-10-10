import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
const cookieName = "__Host-trace";
const lifetime = 8 * 60 * 60;
function azureAuthorized(request, env, options) {
  if (!options.trustAzureAuthentication) return false;
  const provider = request.headers.get("x-ms-client-principal-idp");
  if (provider === "aad")
    return Boolean(
      env.TRACE_ENTRA_ALLOWED_OBJECT_ID &&
      request.headers.get("x-ms-client-principal-id") ===
        env.TRACE_ENTRA_ALLOWED_OBJECT_ID,
    );
  if (
    provider !== "cir2" ||
    !env.TRACE_ENTRA_CIR2_TENANT_ID ||
    !env.TRACE_ENTRA_EMAIL_DOMAIN
  )
    return false;
  const encoded = request.headers.get("x-ms-client-principal");
  if (!encoded || encoded.length > 32768) return false;
  try {
    const principal = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf8"),
    );
    if (principal.auth_typ !== "cir2" || !Array.isArray(principal.claims))
      return false;
    const claim = (...types) =>
      principal.claims.filter((c) => types.includes(c.typ)).map((c) => c.val);
    const tenants = claim(
      "tid",
      "http://schemas.microsoft.com/identity/claims/tenantid",
    );
    // An email suffix alone is not an identity boundary: require CIR2's verified tenant first.
    if (
      !tenants.length ||
      tenants.some((t) => t !== env.TRACE_ENTRA_CIR2_TENANT_ID)
    )
      return false;
    const addresses = claim(
      "email",
      "preferred_username",
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn",
    );
    return addresses.some(
      (value) =>
        typeof value === "string" &&
        /^[^@\s]+@[^@\s]+$/.test(value) &&
        value.split("@")[1].toLowerCase() ===
          env.TRACE_ENTRA_EMAIL_DOMAIN.toLowerCase(),
    );
  } catch {
    return false;
  }
}
function signature(value, key) {
  return createHmac("sha256", key).update(value).digest("base64url");
}
export function createSession(key, now = Date.now()) {
  const value = `${Math.floor(now / 1000) + lifetime}.${randomUUID()}`;
  return `${value}.${signature(value, key)}`;
}
export function validSession(value, key, now = Date.now()) {
  if (!value || value.length > 200) return false;
  const parts = value.split(".");
  if (parts.length !== 3 || !/^\d+$/.test(parts[0])) return false;
  const expiry = Number(parts[0]),
    current = Math.floor(now / 1000);
  if (expiry <= current || expiry > current + lifetime) return false;
  const expected = Buffer.from(signature(parts.slice(0, 2).join("."), key));
  const actual = Buffer.from(parts[2]);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
const json = (data, status = 200, headers = {}) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
export function createGateway(
  env = process.env,
  upstreamFetch = fetch,
  options = {},
) {
  return async function gateway(request) {
    try {
      const { TRACE_RUNNER_URL, TRACE_RUNNER_KEY, TRACE_SESSION_SECRET } = env;
      if (
        !TRACE_RUNNER_URL ||
        (TRACE_RUNNER_KEY || "").length < 32 ||
        (TRACE_SESSION_SECRET || "").length < 32
      )
        return json({ error: "Hosting configuration is incomplete." }, 503);
      const runner = new URL(TRACE_RUNNER_URL);
      if (
        (runner.protocol !== "https:" &&
          !(
            options.allowLocalRunner &&
            runner.origin === "http://127.0.0.1:4310"
          )) ||
        runner.username ||
        runner.password ||
        runner.pathname !== "/" ||
        runner.search ||
        runner.hash
      )
        return json({ error: "Runner must be an HTTPS origin." }, 503);
      const url = new URL(request.url);
      // Rewrite paths are validated before joining to the runner; arbitrary proxy targets are forbidden.
      const raw = url.searchParams.get("__trace_path") || url.pathname;
      if (
        !raw.startsWith("/") ||
        raw.includes("\\") ||
        /%2f|%5c|%2e/i.test(raw) ||
        raw.split("/").some((s) => s === "." || s === "..") ||
        !/^\/(api\/|artifacts\/|demo(?:\/|$))/.test(raw)
      )
        return json({ error: "Unknown route." }, 404);
      const mutation = !["GET", "HEAD"].includes(request.method);
      if (mutation && request.headers.get("origin") !== url.origin)
        return json({ error: "Untrusted origin." }, 403);
      const token = (request.headers.get("cookie") || "")
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith(cookieName + "="))
        ?.slice(cookieName.length + 1);
      const entra = env.TRACE_ENTRA_AUTH === "1";
      // Only Azure's ingress strips and injects these headers. Other hosts must never trust them.
      const authorized = entra
        ? azureAuthorized(request, env, options)
        : validSession(token, TRACE_SESSION_SECRET);
      if (raw === "/api/auth/session")
        return json({
          authenticated: authorized,
          hosted: true,
          provider: entra ? "entra" : "password",
          ...(entra
            ? {
                signInUrl: env.TRACE_ENTRA_EMAIL_DOMAIN
                  ? "/.auth/login/cir2"
                  : "/.auth/login/aad",
              }
            : {}),
        });
      if (raw === "/api/auth/logout" && request.method === "POST")
        return json(
          { ok: true, ...(entra ? { signOutUrl: "/.auth/logout" } : {}) },
          200,
          {
            "Set-Cookie": `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
          },
        );
      if (raw === "/api/auth/login" && request.method === "POST") {
        if (entra) return json({ error: "Use Microsoft sign-in." }, 401);
        if (Number(request.headers.get("content-length") || 0) > 2048)
          return json({ error: "Request too large." }, 413);
        const body = await request.text();
        if (Buffer.byteLength(body) > 2048)
          return json({ error: "Request too large." }, 413);
        const response = await upstreamFetch(
          new URL("/api/auth/login", runner),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${TRACE_RUNNER_KEY}`,
              "X-Trace-Client":
                request.headers.get("x-vercel-forwarded-for") || "unknown",
            },
            body,
            redirect: "manual",
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!response.ok)
          return json(
            {
              error:
                response.status === 429
                  ? "Too many sign-in attempts. Try again in a minute."
                  : "Sign-in failed.",
            },
            response.status === 429 ? 429 : 401,
          );
        return json({ authenticated: true }, 200, {
          "Set-Cookie": `${cookieName}=${createSession(TRACE_SESSION_SECRET)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${lifetime}`,
        });
      }
      if (raw.startsWith("/api/auth/"))
        return json({ error: "Unknown route." }, 404);
      if (!authorized) return json({ error: "Please sign in." }, 401);
      if (!["GET", "HEAD", "POST", "PATCH", "DELETE"].includes(request.method))
        return json({ error: "Method not allowed." }, 405);
      url.searchParams.delete("__trace_path");
      const target = new URL(
        raw + (url.searchParams.size ? "?" + url.searchParams.toString() : ""),
        runner,
      );
      if (target.origin !== runner.origin)
        return json({ error: "Unknown route." }, 404);
      const headers = new Headers({
        Authorization: `Bearer ${TRACE_RUNNER_KEY}`,
      });
      if (mutation) headers.set("Content-Type", "application/json");
      let body;
      if (mutation) {
        body = await request.text();
        const limit = raw === "/api/import" && request.method === "POST"
          ? 512 * 1024 : 65536;
        if (Buffer.byteLength(body) > limit)
          return json({ error: "Request too large." }, 413);
      }
      const response = await upstreamFetch(target, {
        method: request.method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(
          raw === "/api/sessions" && request.method === "POST" ? 75000 : 20000,
        ),
      });
      if (response.status >= 300 && response.status < 400)
        return json({ error: "Runner redirect refused." }, 502);
      const safeHeaders = new Headers({
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      for (const name of ["content-type", "content-disposition"]) {
        const v = response.headers.get(name);
        if (v) safeHeaders.set(name, v);
      }
      // Binary downloads stream through the gateway, protected by the same session.
      return new Response(response.body, {
        status: response.status,
        headers: safeHeaders,
      });
    } catch (error) {
      console.error("Trace gateway request failed:", error.name);
      return json({ error: "The testing service is unavailable." }, 502);
    }
  };
}
