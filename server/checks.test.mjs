import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const temp = await mkdtemp(path.join(tmpdir(), "trace-checks-"));
const previousData = process.env.TRACE_DATA_DIR;
process.env.TRACE_DATA_DIR = temp;
const { check, planCases } = await import("./checks.mjs");
const { isolatedContext, open, runSession, isRunning } = await import("./runner.mjs");
const { db } = await import("./store.mjs");
const { guardedProxy } = await import("./proxy.mjs");

test("browser checks distinguish proven issues from incomplete observations", { timeout: 240000 }, async (t) => {
  const previousPort = process.env.PORT;
  const server = http.createServer((req, res) => {
    const name = req.url.split("/").at(-1);
    if (name === "hang") return;
    if (name === "unavailable") return req.socket.destroy();
    if (name === "notfound") { res.writeHead(404); return res.end("Missing"); }
    if (name === "badgateway") { res.writeHead(502); return res.end("Target gateway failed"); }
    if (name === "spoof") { res.writeHead(404, { "x-trace-network-error": "unavailable" }); return res.end("Missing"); }
    const links = {
      success: ["ok"],
      failure: ["notfound"],
      timeout: ["hang"],
      network: ["unavailable"],
      gateway: ["badgateway"],
      spoofed: ["spoof"],
      mixed: ["ok", "notfound", "unavailable"],
      bounded: ["ok1", "ok2", "ok3", "ok4", "ok5", "notfound"],
    }[name] || [];
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<title>Fixture</title><main><h1>Fixture</h1>${links.map(link => `<a href="/demo/${link}">${link}</a>`).join("")}</main>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  process.env.PORT = String(server.address().port);
  const base = `http://127.0.0.1:${process.env.PORT}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.TRACE_BROWSER_CHANNEL || "chrome", headless: true });
    async function inspect(name) {
      const url = `${base}/demo/${name}`;
      const context = await isolatedContext(browser, url);
      try {
        const { page, inputs } = await open(context, url);
        return await check(page, { kind: "links" }, inputs);
      } finally { await context.close(); }
    }
    await t.test("a successful response passes", async () => {
      const result = await inspect("success");
      assert.equal(result.status, "passed");
      assert.match(result.details.join("\n"), /200.*\/demo\/ok/);
    });
    await t.test("a real HTTP 404 is a proven issue", async () => {
      const result = await inspect("failure");
      assert.equal(result.status, "issues_found");
      assert.match(result.details.join("\n"), /404.*\/demo\/notfound/);
    });
    await t.test("a hanging destination blocks the check instead of reporting a bug", async () => {
      const result = await inspect("timeout");
      assert.equal(result.status, "blocked");
      assert.match(result.details.join("\n"), /Blocked or unavailable.*\/demo\/hang/);
    });
    await t.test("a dropped connection blocks the check instead of reporting a bug", async () => {
      const result = await inspect("network");
      assert.equal(result.status, "blocked");
      assert.match(result.details.join("\n"), /Blocked or unavailable.*\/demo\/unavailable/);
    });
    await t.test("no document response is incomplete rather than a proven HTTP failure", async () => {
      // HTTP navigations normally either respond or throw; exercise Playwright's
      // documented nullable response at the check boundary without a fake status.
      const page = {
        locator: () => ({ evaluateAll: async () => [`${base}/demo/ok`] }),
        context: () => ({ newPage: async () => ({ goto: async () => null, close: async () => {} }) }),
      };
      const result = await check(page, { kind: "links" }, { url: `${base}/demo/empty` });
      assert.equal(result.status, "blocked");
      assert.deepEqual(result.coverage, { eligible: 1, attempted: 1, passed: 0, failed: 0, blocked: 1, skipped: 0 });
    });
    await t.test("the guarded proxy preserves the provenance of its unavailable response", async () => {
      const proxy = await guardedProxy(true);
      let guardedBrowser;
      try {
        async function proxyResponse(url) {
          return await new Promise((resolve, reject) => {
            const request = http.request(proxy.url, { path: url }, response => {
              response.resume();
              response.on("end", () => resolve({ status: response.statusCode, headers: response.headers }));
            });
            request.on("error", reject);
            request.end();
          });
        }
        const unavailable = await proxyResponse(`${base}/demo/unavailable`);
        assert.equal(unavailable.status, 502);
        assert.equal(unavailable.headers["x-trace-network-error"], "unavailable");
        const blocked = await proxyResponse(`${base}/private`);
        assert.equal(blocked.status, 403);
        assert.equal(blocked.headers["x-trace-network-error"], "blocked");
        const spoofed = await proxyResponse(`${base}/demo/spoof`);
        assert.equal(spoofed.status, 404);
        assert.equal(spoofed.headers["x-trace-network-error"], undefined);
        guardedBrowser = await chromium.launch({ channel: process.env.TRACE_BROWSER_CHANNEL || "chrome", headless: true, proxy: { server: proxy.url, bypass: "<-loopback>" } });
        const context = await isolatedContext(guardedBrowser, `${base}/demo/network`);
        const { page, inputs } = await open(context, `${base}/demo/network`);
        const result = await check(page, { kind: "links" }, inputs);
        assert.equal(result.status, "blocked", JSON.stringify(result));
        assert.match(result.details.join("\n"), /unavailable/);
        for (const name of ["gateway", "spoofed"]) {
          const next = await open(context, `${base}/demo/${name}`);
          const observed = await check(next.page, { kind: "links" }, next.inputs);
          assert.equal(observed.status, "issues_found", "target HTTP errors remain proven even if they try to spoof proxy provenance");
        }
      } finally { await guardedBrowser?.close(); await proxy.close(); }
    });
    await t.test("mixed results retain the proven failure and disclose incomplete coverage", async () => {
      const result = await inspect("mixed");
      assert.equal(result.status, "issues_found");
      assert.match(result.summary, /1.*failed/);
      assert.match(result.summary, /1.*blocked/);
      assert.match(result.details.join("\n"), /200.*\/demo\/ok/);
      assert.match(result.details.join("\n"), /404.*\/demo\/notfound/);
      assert.match(result.details.join("\n"), /Blocked or unavailable.*\/demo\/unavailable/);
      assert.deepEqual(result.coverage, { eligible: 3, attempted: 3, passed: 1, failed: 1, blocked: 1, skipped: 0 });
    });
    await t.test("the five-link bound discloses links that were not checked", async () => {
      const result = await inspect("bounded");
      assert.equal(result.status, "passed");
      assert.deepEqual(result.coverage, { eligible: 6, attempted: 5, passed: 5, failed: 0, blocked: 0, skipped: 1 });
      assert.match(result.details.join("\n"), /1 additional links/);
    });
    await t.test("an image with an unresolved ARIA label reference still lacks alternative text", async () => {
      const page = await browser.newPage();
      try {
        await page.setContent('<img width="32" height="32" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2232%22 height=%2232%22/%3E" aria-labelledby="missing">');
        assert.equal(await page.getByRole("img", { name: "", exact: true }).count(), 1);
        const result = await check(page, { kind: "images" }, {});
        assert.equal(result.status, "issues_found");
        assert.equal(result.details.length, 1);
      } finally { await page.close(); }
    });
    await t.test("an empty associated label does not name a form control", async () => {
      const page = await browser.newPage();
      try {
        await page.setContent('<label for="empty"> </label><input id="empty">');
        assert.equal(await page.getByRole("textbox", { name: "", exact: true }).count(), 1);
        const result = await check(page, { kind: "labels" }, {});
        assert.equal(result.status, "issues_found");
        assert.deepEqual(result.details, ["input#empty"]);
      } finally { await page.close(); }
    });
    await t.test("valid image and label text alternatives continue to pass", async () => {
      const page = await browser.newPage();
      try {
        await page.setContent('<span id="description">Useful image</span><img width="32" height="32" aria-labelledby="description"><img width="32" height="32" alt=""><label for="named">Name</label><input id="named"><label for="icon"><img alt="Search" width="32" height="32"></label><input id="icon">');
        assert.equal((await check(page, { kind: "images" }, {})).status, "passed");
        assert.equal((await check(page, { kind: "labels" }, {})).status, "passed");
      } finally { await page.close(); }
    });
    await t.test("HTTP checks block absent or synthesized responses while retaining real server failures", async () => {
      assert.equal((await check(null, { kind: "http" }, { status: 0 })).status, "blocked");
      assert.equal((await check(null, { kind: "http" }, { status: 502, networkError: "unavailable" })).status, "blocked");
      assert.equal((await check(null, { kind: "http" }, { status: 403, networkError: "blocked" })).status, "blocked");
      assert.equal((await check(null, { kind: "http" }, { status: 404 })).status, "issues_found");
      assert.equal((await check(null, { kind: "http" }, { status: 200 })).status, "passed");
    });
    await t.test("all document checks block when navigation did not observe a target response", async () => {
      const page = await browser.newPage();
      try {
        await page.setContent('<title>Fixture</title><main><h1>Fixture</h1></main>');
        for (const context of [{ status: 0 }, { status: 502, networkError: "unavailable" }]) {
          for (const spec of [...planCases(), { kind: "text", value: "Missing" }, { kind: "selector", value: "#missing" }, { kind: "journey", actions: [] }]) {
            const result = await check(page, spec, { url: `${base}/demo/unavailable`, errors: [], ...context });
            assert.equal(result.status, "blocked", `${spec.kind} must not infer page bugs from an incomplete navigation`);
          }
        }
      } finally { await page.close(); }
    });
    await t.test("opening a page propagates network error provenance to the checks", async () => {
      const page = { on: () => {}, goto: async () => ({ url: () => `${base}/demo/policy`, status: () => 403, headers: () => ({ "x-trace-network-error": "blocked" }) }), waitForTimeout: async () => {} };
      const observed = await open({ newPage: async () => page }, `${base}/demo/policy`);
      assert.equal(observed.inputs.networkError, "blocked");
    });
    await t.test("journey navigation records a real HTTP error as an issue", async () => {
      const context = await isolatedContext(browser, `${base}/demo/success`);
      try {
        const { page, inputs } = await open(context, `${base}/demo/success`);
        const result = await check(page, { kind: "journey", actions: [{ action: "navigate", url: "/demo/notfound" }] }, inputs);
        assert.equal(result.status, "issues_found");
        assert.equal(result.stepResults[0].failureKind, "http_error");
      } finally { await context.close(); }
    });
    await t.test("journey navigation blocks a synthesized gateway error", async () => {
      const result = await check({ goto: async () => ({ url: () => `${base}/demo/unavailable`, status: () => 502, headers: () => ({ "x-trace-network-error": "unavailable" }) }) }, { kind: "journey", actions: [{ action: "navigate", url: "/demo/unavailable" }] }, { url: `${base}/demo/success` });
      assert.equal(result.status, "blocked");
      assert.equal(result.stepResults[0].failureKind, "tool_error");
    });
    await t.test("an encrypted target cannot spoof network guard provenance", async () => {
      const response = { url: () => "https://target.example/missing", status: () => 502, headers: () => ({ "x-trace-network-error": "unavailable" }) };
      const page = { on: () => {}, goto: async () => response, waitForTimeout: async () => {} };
      const observed = await open({ newPage: async () => page }, `${base}/demo/success`);
      assert.equal(observed.inputs.networkError, undefined);
      const result = await check(page, { kind: "journey", actions: [{ action: "navigate", url: "/demo/gateway" }] }, { url: `${base}/demo/success` });
      assert.equal(result.status, "issues_found");
      assert.equal(result.stepResults[0].failureKind, "http_error");
    });
    await t.test("the product runner creates a finding only for the proven HTTP failure", { timeout: 60000 }, async () => {
      for (const [name, status, findings] of [["success", "passed", 0], ["failure", "issues_found", 1], ["timeout", "blocked", 0], ["network", "blocked", 0]]) {
        const session = {
          id: `checks-${name}`, name, url: `${base}/demo/${name}`, status: "ready",
          cases: [{ id: `case-${name}`, name: "Internal navigation", kind: "links", acceptance: "Navigation returns a successful response.", steps: ["Open the page.", "Check links."] }],
          findings: [], activity: [], history: [],
        };
        db.sessions.push(session);
        await runSession(session);
        const deadline = Date.now() + 45000;
        while (isRunning(session) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(isRunning(session), false, "runner must finish");
        assert.equal(session.status, "completed", JSON.stringify(session.activity));
        assert.equal(session.cases[0].status, status);
        assert.equal(session.findings.length, findings);
        if (findings) assert.equal(session.findings[0].reproduction, "reproduced");
      }
      const smoke = { id: "checks-unavailable-smoke", name: "Unavailable target", url: `${base}/demo/unavailable`, status: "ready", cases: planCases(), findings: [], activity: [], history: [] };
      db.sessions.push(smoke);
      await runSession(smoke);
      const deadline = Date.now() + 45000;
      while (isRunning(smoke) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(isRunning(smoke), false);
      assert.equal(smoke.findings.length, 0);
      assert.equal(smoke.cases.length, 9);
      assert.ok(smoke.cases.every(spec => spec.status === "blocked"), JSON.stringify(smoke.cases));
    });
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (previousData === undefined) delete process.env.TRACE_DATA_DIR; else process.env.TRACE_DATA_DIR = previousData;
    if (previousPort === undefined) delete process.env.PORT; else process.env.PORT = previousPort;
    await rm(temp, { recursive: true, force: true });
  }
});
