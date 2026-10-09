import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import YAML from "yaml";
const subscription = "6b8f4e09-06bd-4b5f-82cf-9929b711e066";
const base =
  "https://trace-app.calmstone-23db89f2.eastus2.azurecontainerapps.io";
function az(args) {
  const result = spawnSync(
    "az",
    [
      ...args,
      "--subscription",
      subscription,
      "--only-show-errors",
      "-o",
      "json",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error("Azure authentication operation failed.");
  return JSON.parse(result.stdout);
}
let cookie;
async function api(path, method = "GET", body) {
  const response = await fetch(base + path, {
    method,
    signal: AbortSignal.timeout(80000),
    headers: {
      origin: base,
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(response.ok, `${path} returned ${response.status}`);
  return response;
}
const password = az([
  "keyvault",
  "secret",
  "show",
  "--vault-name",
  "trace9636vault",
  "--name",
  "workspace-password",
  "--query",
  "value",
]);
const login = await api("/api/auth/login", "POST", { password });
cookie = login.headers.get("set-cookie").split(";")[0];
const before = await (await api("/api/workspace")).json();
if (process.argv.includes("--preflight")) {
  assert.equal(
    before.service.activeRuns,
    0,
    "Wait for active browser runs before rolling out.",
  );
  assert.ok(
    before.schedules.every((s) => !s.enabled),
    "Pause active schedules before rolling out.",
  );
  await writeFile(
    "/tmp/trace-ai-workspace-before.json",
    JSON.stringify(before),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      activeRuns: 0,
      sessionsPreserved: before.sessions.length,
      schedulesPaused: true,
    }),
  );
  process.exit(0);
}
const preserved = JSON.parse(
  await readFile("/tmp/trace-ai-workspace-before.json", "utf8"),
);
for (const session of preserved.sessions) {
  const found = before.sessions.find((s) => s.id === session.id);
  assert.ok(found, "Previous session missing after deployment.");
  assert.equal(found.status, session.status);
  assert.equal(found.cases.length, session.cases.length);
  if (session.trace) await api(session.trace);
}
assert.ok(before.service.ai.configured);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  await context.addCookies([
    {
      name: "__Host-trace",
      value: cookie.slice(cookie.indexOf("=") + 1),
      url: base,
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    },
  ]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/#/settings`);
  await page
    .getByRole("heading", { name: "AI test generation", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Generate a test plan", exact: true })
    .click();
  await page
    .getByLabel(/^Session name/)
    .fill("Azure AI generation verification");
  await page.getByLabel(/^Environment/).selectOption("demo");
  await page
    .getByLabel(/^Testing brief/)
    .fill(
      'Create only three checks: homepage HTTP availability, a nonempty document title, and the exact visible phrase "Everyday essentials". Also note that submitting the newsletter signup is desired but cannot be executed by this read-only runner.',
    );
  await page.getByLabel(/^Expected visible text/).fill("Everyday essentials");
  const generated = page.waitForResponse(
    (r) =>
      r.url() === `${base}/api/sessions` && r.request().method() === "POST",
    { timeout: 80000 },
  );
  await page
    .getByRole("button", { name: "Generate test plan", exact: true })
    .click();
  const response = await generated;
  const session = await response.json();
  assert.equal(response.status(), 201, JSON.stringify(session));
  assert.ok(session.generation.at);
  assert.equal(session.status, "ready");
  assert.equal(session.runId, undefined);
  assert.ok(
    session.cases.every((c) => c.status === "not_run" && c.result === null),
  );
  assert.deepEqual(session.cases.map((c) => c.kind).sort(), [
    "http",
    "text",
    "title",
  ]);
  assert.ok(session.generation.limitations.some((v) => /newsletter/i.test(v)));
  await page
    .getByRole("heading", { name: session.name, exact: true })
    .waitFor();
  assert.ok(
    await page
      .getByText("AI draft · Azure OpenAI", { exact: true })
      .isVisible(),
  );
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  let completed;
  for (let i = 0; i < 90; i++) {
    completed = await (await api(`/api/sessions/${session.id}`)).json();
    if (!["running", "cancelling"].includes(completed.status)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(completed.status, "completed");
  assert.ok(completed.cases.every((c) => c.status === "passed"));
  await api(completed.trace);
  for (const c of completed.cases) for (const e of c.evidence) await api(e.url);
  const yaml = YAML.parse(
    await (await api(`/api/sessions/${session.id}/export?format=yaml`)).text(),
  );
  assert.equal(yaml.schema, "trace/test/v1");
  assert.equal(yaml.checks.length, 3);
  await page.getByRole("button", { name: "Run again", exact: true }).waitFor();
  if (process.argv[2])
    await page.screenshot({ path: process.argv[2], fullPage: true });
  await page.goto(`${base}/#/settings`);
  await page.getByText("Connected · Azure OpenAI", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      live: base,
      sessionId: session.id,
      preservedSessions: preserved.sessions.length,
      aiDraft: "generated",
      explicitRun: "completed",
      passed: 3,
      screenshotsAndTrace: "verified",
      yaml: "verified",
      settings: "connected",
      frontendErrors: 0,
    }),
  );
} finally {
  await browser.close();
}
