import path from "node:path";
import { chromium } from "playwright";
import { dataDir, id, now, save, event } from "./store.mjs";
import { check } from "./checks.mjs";
import { validateTarget, isDemo, safeNavigation } from "./policy.mjs";
import { guardedProxy } from "./proxy.mjs";

export const active = new Map();
const artifacts = path.join(dataDir, "artifacts");
export const isRunning = (session) => active.has(session.id);
export function cancel(session) {
  const run = active.get(session.id);
  if (!run) throw new Error("No active run.");
  run.cancelled = true;
  session.status = "cancelling";
  event(
    session,
    "Runner",
    "Cancellation requested. Closing the active browser.",
  );
  run.browser?.close().catch(() => {});
}
async function isolatedContext(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  await context.routeWebSocket("**/*", (ws) => ws.close());
  await context.route("**/*", async (route) => {
    const request = route.request();
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method()))
        return await route.abort("blockedbyclient");
      const u = await validateTarget(request.url(), isDemo(new URL(url)));
      if (request.isNavigationRequest() && !safeNavigation(u))
        return await route.abort("blockedbyclient");
      // The guarded proxy validates and pins every outgoing connection,
      // including redirect hops that do not trigger this route callback.
      await route.continue();
    } catch {
      await route.abort("blockedbyclient").catch(() => {});
    }
  });
  context.setDefaultTimeout(10000);
  return context;
}
async function open(context, url) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  await page.waitForTimeout(750);
  return { page, inputs: { url, status: response?.status() || 0, errors } };
}
async function screenshot(page, prefix) {
  const filename = `${prefix}-${id()}.png`;
  await page.screenshot({
    path: path.join(artifacts, filename),
    fullPage: false,
    timeout: 10000,
  });
  return `/artifacts/${filename}`;
}
export async function runSession(session) {
  if (active.has(session.id))
    throw new Error("This session is already running.");
  if (active.size >= 2)
    throw new Error(
      "Two browser runs are already active. Wait for one to finish.",
    );
  if (!session.cases.length) throw new Error("Add at least one test case.");
  await validateTarget(session.url);
  // Recheck after asynchronous target validation to avoid duplicate concurrent starts.
  if (active.has(session.id) || active.size >= 2)
    throw new Error(
      "A run started while validating the target. Try again after it finishes.",
    );
  const control = { cancelled: false, browser: null };
  active.set(session.id, control);
  if (session.runId)
    session.history.push({
      runId: session.runId,
      at: session.finishedAt || session.startedAt,
      status: session.status,
      cases: structuredClone(session.cases),
      findings: structuredClone(session.findings),
    });
  session.runId = id();
  session.startedAt = now();
  session.finishedAt = null;
  session.status = "running";
  session.findings = [];
  session.trace = null;
  for (const spec of session.cases)
    Object.assign(spec, {
      status: "not_run",
      evidence: [],
      result: null,
      controls: [],
      durationMs: null,
    });
  event(
    session,
    "Planner",
    `Starting ${session.cases.length} browser checks. Form submissions and write requests are disabled.`,
  );
  execute(session, control).catch((error) => {
    session.status = "interrupted";
    event(session, "Runner", `Unexpected runner error: ${error.message}`);
    active.delete(session.id);
  });
  return session;
}
async function execute(session, control) {
  let browser, context, proxy;
  let terminalStatus = "blocked";
  const deadline = setTimeout(() => {
    control.cancelled = true;
    browser?.close().catch(() => {});
  }, Math.min(900000, Math.max(180000, session.cases.length * 15000)));
  try {
    proxy = await guardedProxy(isDemo(new URL(session.url)));
    browser = await chromium.launch({
      channel: process.env.TRACE_BROWSER_CHANNEL || "chrome",
      headless: true,
      proxy: { server: proxy.url, bypass: "<-loopback>" },
    });
    control.browser = browser;
    if (control.cancelled) return;
    context = await isolatedContext(browser, session.url);
    await context.tracing.start({ screenshots: true, snapshots: true });
    let { page, inputs } = await open(context, session.url);
    event(
      session,
      "Explorer",
      `Opened ${page.url()}. Browser isolated from your signed-in sessions.`,
    );
    for (const spec of session.cases) {
      if (control.cancelled) break;
      spec.status = "running";
      spec.startedAt = now();
      save();
      const start = Date.now();
      event(session, "Verifier", `Checking: ${spec.name}`, { caseId: spec.id });
      let journeyContext;
      const sharedPage = page, sharedInputs = inputs;
      try {
        if (spec.kind === "journey") {
          journeyContext = await isolatedContext(browser, session.url);
          await journeyContext.tracing.start({ screenshots: true, snapshots: true });
          const fresh = await open(journeyContext, session.url);
          page = fresh.page; inputs = fresh.inputs;
        }
        // Mobile checks temporarily change this page's viewport; reset for each case.
        await page.setViewportSize({ width: 1440, height: 960 });
        const result = await check(page, spec, inputs);
        spec.result = result;
        spec.status = result.status;
        spec.controls = [
          {
            name: spec.acceptance,
            status:
              result.status === "passed"
                ? "checked"
                : result.status === "blocked"
                  ? "out_of_scope"
                  : "failed",
          },
        ];
        spec.evidence.push({
          id: id(),
          at: now(),
          kind: "screenshot",
          url: await screenshot(page, session.runId),
          caption: `${spec.name} — initial observation`,
        });
        if (result.status === "issues_found") {
          const finding = {
            id: id(),
            caseId: spec.id,
            name: spec.name,
            kind: "bug",
            expected: spec.acceptance,
            actual: result.summary,
            details: result.details,
            reproSteps: [`Open ${session.url}`, ...spec.steps.slice(1)],
            reproduction: "checking",
            triage: "OPEN",
            createdAt: now(),
            evidence: [...spec.evidence],
            reproductionResult: null,
          };
          session.findings.push(finding);
          event(
            session,
            "Reproducer",
            `Rechecking “${spec.name}” in a fresh browser context.`,
            { findingId: finding.id },
          );
          let independent;
          try {
            independent = await isolatedContext(browser, session.url);
            const fresh = await open(independent, session.url);
            const retry = await check(fresh.page, spec, fresh.inputs);
            finding.reproductionResult = retry;
            finding.reproduction =
              retry.status === "issues_found"
                ? "reproduced"
                : retry.status === "passed"
                  ? "not_reproduced"
                  : "blocked";
            finding.evidence.push({
              id: id(),
              at: now(),
              kind: "screenshot",
              url: await screenshot(fresh.page, `${session.runId}-repro`),
              caption: `${spec.name} — independent reproduction`,
            });
            event(
              session,
              "Reproducer",
              `${finding.reproduction === "reproduced" ? "Reproduced" : "Not confirmed"}: ${retry.summary}`,
              { findingId: finding.id },
            );
          } catch (error) {
            finding.reproduction = "blocked";
            finding.reproductionResult = {
              status: "blocked",
              summary: error.message.split("\n")[0],
              details: [],
            };
          } finally {
            await independent?.close().catch(() => {});
          }
        }
        event(session, "Verifier", result.summary, {
          caseId: spec.id,
          status: result.status,
        });
      } catch (error) {
        spec.status = "blocked";
        spec.result = {
          status: "blocked",
          summary: control.cancelled
            ? "Run cancelled."
            : error.message.split("\n")[0],
          details: [],
        };
        event(session, "Verifier", `${spec.name}: ${spec.result.summary}`, {
          caseId: spec.id,
          status: "blocked",
        });
      }
      finally {
        if (journeyContext) {
          const filename = `${session.runId}-${spec.id}.zip`;
          await journeyContext.tracing.stop({path:path.join(artifacts,filename)}).then(() => spec.evidence.push({id:id(),at:now(),kind:"trace",url:`/artifacts/${filename}`,caption:`${spec.name} — journey trace`})).catch(() => {});
          await journeyContext.close().catch(() => {});
          page = sharedPage; inputs = sharedInputs;
        }
      }
      spec.durationMs = Date.now() - start;
      save();
    }
    if (!control.cancelled) {
      const filename = `${session.runId}.zip`;
      await context.tracing.stop({ path: path.join(artifacts, filename) });
      session.trace = `/artifacts/${filename}`;
      terminalStatus = "completed";
    } else terminalStatus = "cancelled";
  } catch (error) {
    terminalStatus = control.cancelled ? "cancelled" : "blocked";
    for (const spec of session.cases)
      if (["running", "not_run"].includes(spec.status)) {
        spec.status = "blocked";
        spec.result = {
          status: "blocked",
          summary: error.message.split("\n")[0],
          details: [],
        };
      }
    event(
      session,
      "Runner",
      control.cancelled
        ? "Run cancelled."
        : `Browser could not complete the run: ${error.message.split("\n")[0]}`,
    );
  } finally {
    clearTimeout(deadline);

    session.findings.forEach((f) => {
      if (f.reproduction === "checking") f.reproduction = "blocked";
    });
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await proxy?.close().catch(() => {});
    session.status = control.cancelled ? "cancelled" : terminalStatus;
    session.finishedAt = now();
    active.delete(session.id);
    event(
      session,
      "Runner",
      `Run ${session.status}. ${session.cases.filter((c) => c.status === "passed").length} passed, ${session.cases.filter((c) => c.status === "issues_found").length} found issues, ${session.cases.filter((c) => c.status === "blocked").length} blocked.`,
    );
  }
}
