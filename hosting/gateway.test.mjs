import test from "node:test";
import assert from "node:assert/strict";
import { createGateway, createSession, validSession } from "./gateway.mjs";
const env = {
  TRACE_RUNNER_URL: "https://runner.example.com",
  TRACE_RUNNER_KEY: "r".repeat(40),
  TRACE_SESSION_SECRET: "s".repeat(40),
};
const origin = "https://trace.example.com";
const cookie = () => `__Host-trace=${createSession(env.TRACE_SESSION_SECRET)}`;
const req = (path, options = {}) => new Request(origin + path, options);
test("local runner exception is explicit and restricted to the internal Azure port", async () => {
  const upstream = async () => Response.json({ ok: true });
  for (const runner of [
    "http://127.0.0.1:4310",
    "http://localhost:4310",
    "http://127.0.0.1:8080",
    "http://example.com",
  ]) {
    const localEnv = { ...env, TRACE_RUNNER_URL: runner };
    assert.equal(
      (await createGateway(localEnv, upstream)(req("/api/auth/session")))
        .status,
      503,
    );
    assert.equal(
      (
        await createGateway(localEnv, upstream, { allowLocalRunner: true })(
          req("/api/auth/session"),
        )
      ).status,
      runner === "http://127.0.0.1:4310" ? 200 : 503,
    );
  }
});
test("sessions reject tampering, expiry and key rotation", () => {
  const value = createSession(env.TRACE_SESSION_SECRET, 1000000);
  assert.ok(validSession(value, env.TRACE_SESSION_SECRET, 1000001));
  assert.equal(
    validSession(value + "x", env.TRACE_SESSION_SECRET, 1000001),
    false,
  );
  assert.equal(validSession(value, "rotated", 1000001), false);
  assert.equal(
    validSession(value, env.TRACE_SESSION_SECRET, 1000000 + 8 * 3600000),
    false,
  );
});
test("gateway protects data and evidence, rejects cross-origin writes and unsafe routes", async () => {
  let calls = 0;
  const gateway = createGateway(env, async () => {
    calls++;
    return Response.json({ ok: true });
  });
  for (const path of ["/api/workspace", "/artifacts/result.png", "/demo"])
    assert.equal((await gateway(req(path))).status, 401);
  assert.equal(
    (
      await gateway(
        req("/api/sessions", {
          method: "POST",
          headers: { cookie: cookie(), origin: "https://evil.example" },
        }),
      )
    ).status,
    403,
  );
  for (const path of [
    "/api/gateway?__trace_path=//evil.example/api/x",
    "/api/gateway?__trace_path=/api/%252e%252e/x",
    "/api/gateway?__trace_path=/other",
    "/api/auth/unknown",
  ])
    assert.equal(
      (await gateway(req(path, { headers: { cookie: cookie() } }))).status,
      404,
    );
  assert.equal(calls, 0);
  assert.equal((await createGateway({})(req("/api/workspace"))).status, 503);
});
test("sign-in sets secure cookie; proxy preserves exports without leaking credentials", async () => {
  let seen;
  const gateway = createGateway(env, async (target, options) => {
    seen = { target: String(target), options };
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="trace.zip"',
        "set-cookie": "upstream=secret",
      },
    });
  });
  const login = await gateway(
    req("/api/auth/login", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ password: "test-password" }),
    }),
  );
  assert.equal(login.status, 200);
  const set = login.headers.get("set-cookie");
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"])
    assert.ok(set.includes(flag));
  const response = await gateway(
    req("/api/gateway?__trace_path=/api/sessions/test/export&format=yaml", {
      headers: {
        cookie: set.split(";")[0],
        Authorization: "malicious",
        "x-other": "private",
      },
    }),
  );
  assert.equal(
    seen.target,
    "https://runner.example.com/api/sessions/test/export?format=yaml",
  );
  assert.equal(
    seen.options.headers.get("authorization"),
    `Bearer ${env.TRACE_RUNNER_KEY}`,
  );
  assert.equal(seen.options.headers.get("cookie"), null);
  assert.equal(seen.options.headers.get("x-other"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(
    [...new Uint8Array(await response.arrayBuffer())],
    [1, 2, 3],
  );
  const logout = await gateway(
    req("/api/auth/logout", {
      method: "POST",
      headers: { origin, cookie: cookie() },
    }),
  );
  assert.ok(logout.headers.get("set-cookie").includes("Max-Age=0"));
  const bad = createGateway(
    env,
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example" },
      }),
  );
  assert.equal(
    (await bad(req("/api/workspace", { headers: { cookie: cookie() } })))
      .status,
    502,
  );
});
test("Azure sign-in requires a trusted ingress and the authorized Microsoft identity", async () => {
  const entraEnv = {
    ...env,
    TRACE_ENTRA_AUTH: "1",
    TRACE_ENTRA_ALLOWED_OBJECT_ID: "sean-object-id",
  };
  let calls = 0;
  const upstream = async (_url, options) => {
    calls++;
    assert.equal(options.headers.get("x-ms-client-principal-id"), null);
    assert.equal(
      options.headers.get("authorization"),
      `Bearer ${env.TRACE_RUNNER_KEY}`,
    );
    return Response.json({ ok: true });
  };
  const headers = {
    "x-ms-client-principal-id": "sean-object-id",
    "x-ms-client-principal-idp": "aad",
  };
  assert.equal(
    (
      await createGateway(
        entraEnv,
        upstream,
      )(req("/api/workspace", { headers }))
    ).status,
    401,
  );
  const gateway = createGateway(entraEnv, upstream, {
    trustAzureAuthentication: true,
  });
  for (const bad of [
    {},
    { ...headers, "x-ms-client-principal-id": "other-user" },
    { ...headers, "x-ms-client-principal-idp": "google" },
    { cookie: cookie() },
  ]) {
    for (const path of ["/api/workspace", "/artifacts/result.png", "/demo"])
      assert.equal((await gateway(req(path, { headers: bad }))).status, 401);
  }
  assert.equal(calls, 0);
  assert.equal((await gateway(req("/api/workspace", { headers }))).status, 200);
  assert.equal(
    (
      await gateway(
        req("/api/sessions", {
          method: "POST",
          headers: { ...headers, origin: "https://evil.example" },
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await gateway(
        req("/api/auth/login", {
          method: "POST",
          headers: { ...headers, origin },
        }),
      )
    ).status,
    401,
  );
  assert.equal(
    (await (await gateway(req("/api/auth/session", { headers }))).json())
      .provider,
    "entra",
  );
  assert.equal(
    (
      await (
        await gateway(
          req("/api/auth/logout", {
            method: "POST",
            headers: { ...headers, origin },
          }),
        )
      ).json()
    ).signOutUrl,
    "/.auth/logout",
  );
});
test("CIR2 access requires its verified organization and an exact email domain", async () => {
  const cir2Env = {
    ...env,
    TRACE_ENTRA_AUTH: "1",
    TRACE_ENTRA_ALLOWED_OBJECT_ID: "owner",
    TRACE_ENTRA_CIR2_TENANT_ID: "cir2-tenant",
    TRACE_ENTRA_EMAIL_DOMAIN: "cir2.com",
  };
  let calls = 0;
  const gateway = createGateway(
    cir2Env,
    async () => {
      calls++;
      return Response.json({ ok: true });
    },
    { trustAzureAuthentication: true },
  );
  const headersFor = (email, tenant = "cir2-tenant", extra = []) => ({
    "x-ms-client-principal-idp": "cir2",
    "x-ms-client-principal": Buffer.from(
      JSON.stringify({
        auth_typ: "cir2",
        claims: [
          { typ: "tid", val: tenant },
          { typ: "email", val: email },
          ...extra,
        ],
      }),
    ).toString("base64"),
  });
  for (const address of ["user@cir2.com", "Other.User@CIR2.COM"])
    assert.equal(
      (await gateway(req("/api/workspace", { headers: headersFor(address) })))
        .status,
      200,
    );
  for (const headers of [
    headersFor("user@cir2.com", "attacker-tenant"),
    headersFor("user@cir2.com.evil.test"),
    headersFor("user@evilcir2.com"),
    headersFor("user@sub.cir2.com"),
    headersFor("user@@cir2.com"),
    headersFor("user@cir2.com "),
    headersFor("user@cir2.com", "cir2-tenant", [{ typ: "tid", val: "other" }]),
    {
      "x-ms-client-principal-idp": "cir2",
      "x-ms-client-principal": "not-json",
    },
    {
      "x-ms-client-principal-idp": "cir2",
      "x-ms-client-principal-name": "user@cir2.com",
    },
  ]) {
    for (const path of ["/api/workspace", "/artifacts/result.png", "/demo"])
      assert.equal((await gateway(req(path, { headers }))).status, 401);
  }
  assert.equal(calls, 2);
  assert.equal(
    (
      await createGateway(cir2Env)(
        req("/api/workspace", { headers: headersFor("user@cir2.com") }),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await gateway(
        req("/api/workspace", {
          headers: {
            "x-ms-client-principal-idp": "aad",
            "x-ms-client-principal-id": "owner",
          },
        }),
      )
    ).status,
    200,
  );
});
test('large YAML imports pass while oversized imports and other writes stay bounded', async () => {
  let calls = 0;
  const gateway = createGateway(env, async () => { calls++; return Response.json({ok:true}); });
  const post = (path,size) => req(path,{method:'POST',headers:{cookie:cookie(),origin},body:'x'.repeat(size)});
  assert.equal((await gateway(post('/api/import',150000))).status,200);
  assert.equal((await gateway(post('/api/import',512*1024+1))).status,413);
  assert.equal((await gateway(post('/api/sessions',65537))).status,413);
  assert.equal(calls,1);
});
