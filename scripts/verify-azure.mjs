import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const subscription = "6b8f4e09-06bd-4b5f-82cf-9929b711e066";
function az(args) {
  const result = spawnSync("az", [...args, "--subscription", subscription, "--only-show-errors", "-o", "json"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Azure verification credential operation failed.");
  return JSON.parse(result.stdout);
}
const fqdn = az(["containerapp", "show", "--resource-group", "trace-rg", "--name", "trace-app", "--query", "properties.configuration.ingress.fqdn"]);
const base = `https://${fqdn}`;
let cookie;
async function request(path, method = "GET", body) {
  return fetch(base + path, { method, signal: AbortSignal.timeout(30000), headers: { origin: base, "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
}
async function api(path, method = "GET", body) {
  const response = await request(path, method, body);
  assert.ok(response.ok, `${path} returned ${response.status}`);
  return response;
}
assert.deepEqual(await (await api("/api/health")).json(), { status: "ok" });
assert.match(await (await api("/")).text(), /<div id="root">/);
assert.equal((await request("/api/workspace")).status, 401);
const password = az(["keyvault", "secret", "show", "--vault-name", "trace9636vault", "--name", "workspace-password", "--query", "value"]);
const login = await api("/api/auth/login", "POST", { password });
cookie = login.headers.get("set-cookie").split(";")[0];
const workspace = await (await api("/api/workspace")).json();
const local = JSON.parse(readFileSync(".trace/workspace.json", "utf8"));
for (const session of local.sessions) assert.ok(workspace.sessions.some(s => s.id === session.id), "Migrated session missing");
for (const environment of local.environments) assert.ok(workspace.environments.some(e => e.id === environment.id), "Migrated environment missing");
let migratedEvidenceChecked = 0;
for (const session of local.sessions) {
  if (session.trace) { await api(session.trace); migratedEvidenceChecked++; }
  for (const finding of session.findings || []) for (const evidence of finding.evidence || []) {
    assert.match((await api(evidence.url)).headers.get("content-type"), /image\/png/);
    migratedEvidenceChecked++;
  }
}
if (process.argv.includes("--persistence-only")) {
  const sessionId = process.argv[process.argv.indexOf("--persistence-only") + 1];
  const result = await (await api(`/api/sessions/${sessionId}`)).json();
  assert.equal(result.status, "completed");
  await api(result.trace);
  console.log(JSON.stringify({ url: base, persistentSession: sessionId, originalSessions: local.sessions.length, status: "passed" }));
  process.exit(0);
}
const session = await (await api("/api/sessions", "POST", { name: "Azure deployment verification", environmentId: "demo", mode: "smoke" })).json();
await api(`/api/sessions/${session.id}/run`, "POST");
let result;
for (let i = 0; i < 180; i++) {
  result = await (await api(`/api/sessions/${session.id}`)).json();
  if (!["running", "cancelling"].includes(result.status)) break;
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert.equal(result.status, "completed");
assert.equal(result.cases.filter(c => c.status === "passed").length, 6);
assert.equal(result.findings.length, 3);
assert.ok(result.findings.every(f => f.reproduction === "reproduced"));
for (const finding of result.findings) for (const evidence of finding.evidence) assert.match((await api(evidence.url)).headers.get("content-type"), /image\/png/);
await api(result.trace);
assert.match((await api(`/api/sessions/${session.id}/export?format=yaml`)).headers.get("content-type"), /yaml/);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "__Host-trace", value: cookie.slice(cookie.indexOf("=") + 1), url: base, httpOnly: true, secure: true, sameSite: "Strict" }]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/#/sessions/${session.id}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Azure deployment verification", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  const screenshot = process.argv[2];
  if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
} finally { await browser.close(); }
await api("/api/auth/logout", "POST");
cookie = undefined;
assert.equal((await request(result.trace)).status, 401);
console.log(JSON.stringify({ url: base, sessionId: session.id, migratedSessions: local.sessions.length, migratedEnvironments: local.environments.length, migratedEvidenceChecked, checks: 9, passed: 6, intentionalDefectsReproduced: 3, evidenceProtected: true, frontendRendered: true }));
