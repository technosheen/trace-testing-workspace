import { execFileSync } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import assert from "node:assert/strict";
const name = `trace-check-${Date.now()}`;
const password = "synthetic-container-test";
const salt = randomBytes(16).toString("hex");
const base = "http://127.0.0.1:5188", origin = "https://trace.test";
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let cookie;
async function api(path, method = "GET", body) {
  const response = await fetch(base + path, {
    method, headers: { ...(cookie ? { cookie } : {}), origin, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(response.ok, `${path}: ${response.status} ${response.ok ? "" : await response.text()}`);
  return response;
}
try {
  execFileSync("docker", ["run", "-d", "--name", name, "-p", "127.0.0.1:5188:8080", "--shm-size=1g",
    "-e", `TRACE_PASSWORD_HASH=scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
    "-e", `TRACE_RUNNER_KEY=${randomBytes(32).toString("hex")}`, "-e", `TRACE_SESSION_SECRET=${randomBytes(32).toString("hex")}`,
    "-e", `TRACE_PUBLIC_ORIGIN=${origin}`, "trace-full:hosting-check"], { stdio: "pipe" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + "/api/health")).ok) break; } catch {}
    await wait(100);
  }
  assert.match(await (await fetch(base)).text(), /<div id="root">/);
  assert.equal((await fetch(base + "/api/workspace")).status, 401);
  const login = await api("/api/auth/login", "POST", { password });
  cookie = login.headers.get("set-cookie").split(";")[0];
  const workspace = await (await api("/api/workspace")).json();
  assert.ok(workspace.environments.some(env => env.id === "demo"));
  const session = await (await api("/api/sessions", "POST", { name: "Full Azure container verification", environmentId: "demo", mode: "smoke" })).json();
  await api(`/api/sessions/${session.id}/run`, "POST");
  let result;
  for (let i = 0; i < 160; i++) {
    result = await (await api(`/api/sessions/${session.id}`)).json();
    if (result.status === "completed") break;
    await wait(500);
  }
  assert.equal(result.status, "completed");
  assert.equal(result.cases.filter(c => c.status === "passed").length, 6);
  assert.equal(result.findings.length, 3);
  assert.ok(result.findings.every(f => f.reproduction === "reproduced"));
  const artifact = result.findings[0].evidence[0].url;
  assert.match((await api(artifact)).headers.get("content-type"), /image\/png/);
  await api(result.trace);
  execFileSync("docker", ["restart", name], { stdio: "pipe" });
  await wait(2000);
  assert.equal((await (await api(`/api/sessions/${session.id}`)).json()).status, "completed");
  await api("/api/auth/logout", "POST");
  cookie = undefined;
  assert.equal((await fetch(base + artifact)).status, 401);
  console.log("Full container passed: frontend, sign-in, real Chromium run, three reproductions, protected screenshot/trace, durable restart, logout.");
} finally {
  execFileSync("docker", ["rm", "-f", name], { stdio: "pipe" });
}
