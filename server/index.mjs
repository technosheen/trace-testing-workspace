import express from "express";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import YAML from "yaml";
import { db, save, id, now, event, dataDir } from "./store.mjs";
import { planCases, checkKinds } from "./checks.mjs";
import { validateTarget } from "./policy.mjs";
import { runSession, cancel, isRunning, active } from "./runner.mjs";
import { demo, product } from "./demo.mjs";
import { createAiPlanner } from "./ai.mjs";

import { hosted, authenticated, verifyPassword } from "./auth.mjs";
const app = express();
const ai = createAiPlanner({ db, save });
const port = Number(process.env.PORT || 4310);
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const origins = new Set([
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);
app.use((req, res, next) => {
  if (hosted && req.path === "/api/health" && req.method === "GET")
    return res.json({ status: "ok" });
  if (hosted && !/^\/demo(?:\/|$)/.test(req.path) && !authenticated(req))
    return res.status(401).json({ error: "Authentication required." });
  if (!hosted && !hosts.has(req.headers.host))
    return res.status(403).json({ error: "Local workspace only." });
  if (
    req.path.startsWith("/api") &&
    req.headers.origin &&
    !origins.has(req.headers.origin)
  )
    return res.status(403).json({ error: "Untrusted origin." });
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use(express.json({ limit: "64kb" }));
const text = z.string().trim().min(1).max(500);
const environmentSchema = z.object({
  name: text.max(80),
  url: z.url().max(2000),
  description: z.string().max(1000).default(""),
});
const sessionSchema = z.object({
  name: text.max(120),
  environmentId: text,
  mode: z.enum(["smoke", "accessibility", "navigation"]).default("smoke"),
  brief: z.string().max(3000).default(""),
  expectedText: z.string().max(200).default(""),
  generation: z.enum(["standard", "ai"]).default("standard"),
  includeKnowledge: z.boolean().default(false),
});
function required(items, value) {
  const item = items.find((item) => item.id === value);
  if (!item) {
    const error = new Error("Not found.");
    error.status = 404;
    throw error;
  }
  return item;
}
function newSession(input, draft) {
  const env = required(db.environments, input.environmentId);
  const session = {
    id: id(),
    name: input.name,
    environmentId: env.id,
    environmentName: env.name,
    url: env.url,
    mode: input.mode,
    brief: input.brief,
    status: "ready",
    createdAt: now(),
    updatedAt: now(),
    cases: draft?.cases || planCases(input.mode, input.expectedText),
    ...(draft ? { generation: draft.generation } : {}),
    findings: [],
    activity: [],
    history: [],
  };
  db.sessions.unshift(session);
  event(
    session,
    "Planner",
    `${session.cases.length} checks planned for ${env.name}. Review the cases, then start a browser run.`,
  );
  return session;
}
if (!db.sessions.length) {
  newSession({
    name: "Website smoke test",
    environmentId: "demo",
    mode: "smoke",
    brief:
      "Check the demo storefront for navigation, accessibility, and mobile layout defects.",
    expectedText: "",
  });
  newSession({
    name: "Navigation and accessibility",
    environmentId: "demo",
    mode: "accessibility",
    brief: "Verify the page structure and accessible names.",
    expectedText: "",
  });
}
app.get("/api/workspace", (req, res) =>
  res.json({
    ...db,
    service: {
      mode: hosted ? "hosted" : "local",
      engine: "Playwright browser checks",
      activeRuns: active.size,
      ai: ai.status(),
    },
  }),
);
app.get("/api/health", (req, res) =>
  res.json({ status: "ok", activeRuns: active.size }),
);
app.get("/api/auth/session", (req, res) =>
  res.json({ authenticated: true, hosted }),
);
app.post("/api/auth/login", (req, res) => {
  if (!hosted) return res.json({ authenticated: true });
  const result = verifyPassword(
    req.body.password,
    req.headers["x-trace-client"] || req.ip,
  );
  res.status(result.status).json(result);
});
if (process.env.TRACE_TEST === "1") {
  let browserWrites = 0,
    privateReads = 0;
  app.post("/demo/write", (req, res) => {
    browserWrites++;
    res.json({ ok: true });
  });
  app.get("/api/private-counter", (req, res) => {
    privateReads++;
    res.json({ ok: true });
  });
  app.get("/api/test-counters", (req, res) =>
    res.json({ browserWrites, privateReads }),
  );
  app.get("/demo/redirect", (req, res) => res.redirect("/api/private-counter"));
  app.get("/demo/policy", (req, res) =>
    res.send(
      '<!doctype html><html><head><title>Policy fixture</title></head><body><main><h1>Network guard fixture</h1><img alt="Redirect probe" src="/demo/redirect"><script>fetch("/demo/write",{method:"POST"}).catch(()=>{});fetch("/api/private-counter").catch(()=>{});</script></main></body></html>',
    ),
  );
}
app.post("/api/environments", async (req, res) => {
  const input = environmentSchema.parse(req.body);
  await validateTarget(input.url);
  const env = { ...input, id: id(), createdAt: now() };
  db.environments.push(env);
  save();
  res.status(201).json(env);
});
app.patch("/api/environments/:id", async (req, res) => {
  const env = required(db.environments, req.params.id);
  if (env.id === "demo")
    throw new Error(
      "The built-in demo environment is fixed. Add your own environment.",
    );
  const input = environmentSchema.parse(req.body);
  await validateTarget(input.url);
  Object.assign(env, input);
  save();
  res.json(env);
});
app.delete("/api/environments/:id", (req, res) => {
  if (req.params.id === "demo")
    throw new Error("Keep the built-in demo environment.");
  if (db.schedules.some((s) => s.environmentId === req.params.id))
    throw new Error("Remove schedules using this environment first.");
  required(db.environments, req.params.id);
  db.environments = db.environments.filter((e) => e.id !== req.params.id);
  save();
  res.json({ ok: true });
});
app.post("/api/sessions", async (req, res) => {
  const input = sessionSchema.parse(req.body);
  const env = required(db.environments, input.environmentId);
  const draft =
    input.generation === "ai"
      ? await ai.generate(input, env, db.knowledge)
      : undefined;
  // Generation creates a reviewable plan; it never starts a browser run.
  res.status(201).json(newSession(input, draft));
});
app.get("/api/sessions/:id", (req, res) =>
  res.json(required(db.sessions, req.params.id)),
);
app.patch("/api/sessions/:id", (req, res) => {
  const session = required(db.sessions, req.params.id);
  if (isRunning(session)) throw new Error("Wait for the active run to finish.");
  const input = z.object({ name: text.max(120) }).parse(req.body);
  session.name = input.name;
  session.updatedAt = now();
  save();
  res.json(session);
});
app.delete("/api/sessions/:id", (req, res) => {
  const session = required(db.sessions, req.params.id);
  if (isRunning(session)) throw new Error("Stop the active run first.");
  db.sessions = db.sessions.filter((s) => s.id !== session.id);
  save();
  res.json({ ok: true });
});
app.post("/api/sessions/:id/run", async (req, res) =>
  res.json(await runSession(required(db.sessions, req.params.id))),
);
app.post("/api/sessions/:id/cancel", (req, res) => {
  const session = required(db.sessions, req.params.id);
  cancel(session);
  res.json(session);
});
app.post("/api/sessions/:id/cases", (req, res) => {
  const session = required(db.sessions, req.params.id);
  if (session.status !== "ready")
    throw new Error(
      "Cases can be added to a planned session. Create a new session to change a completed plan.",
    );
  if (session.cases.length >= 25)
    throw new Error("A session can contain up to 25 checks.");
  const input = z
    .object({
      name: text.max(120),
      kind: z.enum(["text", "selector"]),
      value: text.max(200),
    })
    .parse(req.body);
  const acceptance =
    input.kind === "text"
      ? `Visible page text contains “${input.value}”.`
      : `A visible element matches CSS selector ${input.value}.`;
  session.cases.push({
    ...input,
    id: id(),
    acceptance,
    preconditions: ["Target page is reachable."],
    steps: ["Open the environment URL.", acceptance],
    status: "not_run",
    controls: [],
    evidence: [],
    result: null,
  });
  event(session, "Planner", `Added case: ${input.name}`);
  res.status(201).json(session);
});
app.delete("/api/sessions/:id/cases/:caseId", (req, res) => {
  const session = required(db.sessions, req.params.id);
  if (session.status !== "ready")
    throw new Error("Only planned cases can be removed.");
  required(session.cases, req.params.caseId);
  if (session.cases.length === 1) throw new Error("Keep at least one case.");
  session.cases = session.cases.filter((c) => c.id !== req.params.caseId);
  save();
  res.json(session);
});
app.patch("/api/sessions/:id/findings/:findingId", (req, res) => {
  const session = required(db.sessions, req.params.id);
  if (isRunning(session))
    throw new Error("Review findings after the run finishes.");
  const finding = required(session.findings, req.params.findingId);
  const input = z
    .object({
      triage: z.enum([
        "OPEN",
        "ACCEPTED",
        "DUPLICATE",
        "WORKS_AS_INTENDED",
        "CANNOT_REPRODUCE",
      ]),
      note: z.string().max(1000).default(""),
    })
    .parse(req.body);
  Object.assign(finding, input, { reviewedAt: now() });
  event(
    session,
    "Reviewer",
    `${finding.name}: ${input.triage.toLowerCase().replaceAll("_", " ")}${input.note ? " — " + input.note : ""}`,
  );
  res.json(session);
});
app.get("/api/sessions/:id/export", (req, res) => {
  const session = required(db.sessions, req.params.id);
  const format = req.query.format || "json";
  if (format === "yaml") {
    // Trace's executable manifest, not a claim of Momentic YAML compatibility.
    const manifest = {
      schema: "trace/test/v1",
      name: session.name,
      url: session.url,
      policy: "read-only",
      checks: session.cases.map((c) => ({
        id: c.id,
        kind: c.kind,
        name: c.name,
        acceptance: c.acceptance,
        ...(c.value ? { value: c.value } : {}),
      })),
    };
    res
      .type("application/yaml")
      .attachment(
        `${session.name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.trace.yaml`,
      )
      .send(YAML.stringify(manifest));
  } else res.attachment("trace-report.json").json(session);
});
app.post("/api/import", async (req, res) => {
  const body = z
    .object({ yaml: z.string().max(50000), environmentId: text })
    .parse(req.body);
  const parsed = YAML.parse(body.yaml, { maxAliasCount: 0 });
  const manifest = z
    .object({
      schema: z.literal("trace/test/v1"),
      name: text.max(120),
      checks: z
        .array(
          z
            .object({
              kind: z.enum(checkKinds),
              name: text.max(120),
              acceptance: text,
              value: z.string().max(200).optional(),
            })
            .refine(
              (v) => !["text", "selector"].includes(v.kind) || Boolean(v.value),
              "Text and selector checks require a value.",
            ),
        )
        .min(1)
        .max(25),
    })
    .parse(parsed);
  const session = newSession({
    name: manifest.name,
    environmentId: body.environmentId,
    mode: "smoke",
    brief: "Imported Trace regression manifest.",
    expectedText: "",
  });
  session.cases = manifest.checks.map((c) => ({
    ...c,
    id: id(),
    preconditions: ["Target page is reachable."],
    steps: ["Open the target.", c.acceptance],
    status: "not_run",
    controls: [],
    evidence: [],
    result: null,
  }));
  save();
  res.status(201).json(session);
});
app.post("/api/knowledge", (req, res) => {
  const input = z
    .object({
      title: text.max(120),
      content: z.string().trim().min(1).max(10000),
    })
    .parse(req.body);
  const item = { ...input, id: id(), createdAt: now() };
  db.knowledge.unshift(item);
  save();
  res.status(201).json(item);
});
app.delete("/api/knowledge/:id", (req, res) => {
  required(db.knowledge, req.params.id);
  db.knowledge = db.knowledge.filter((k) => k.id !== req.params.id);
  save();
  res.json({ ok: true });
});
app.post("/api/schedules", (req, res) => {
  const input = z
    .object({
      name: text.max(120),
      environmentId: text,
      mode: z.enum(["smoke", "accessibility", "navigation"]),
      intervalHours: z.number().int().min(1).max(168),
    })
    .parse(req.body);
  required(db.environments, input.environmentId);
  const item = {
    ...input,
    id: id(),
    enabled: true,
    nextRunAt: new Date(
      Date.now() + input.intervalHours * 3600000,
    ).toISOString(),
    createdAt: now(),
    lastRunId: null,
  };
  db.schedules.push(item);
  save();
  res.status(201).json(item);
});
app.patch("/api/schedules/:id", (req, res) => {
  const schedule = required(db.schedules, req.params.id);
  Object.assign(schedule, z.object({ enabled: z.boolean() }).parse(req.body));
  schedule.nextRunAt = new Date(
    Date.now() + schedule.intervalHours * 3600000,
  ).toISOString();
  save();
  res.json(schedule);
});
app.delete("/api/schedules/:id", (req, res) => {
  required(db.schedules, req.params.id);
  db.schedules = db.schedules.filter((s) => s.id !== req.params.id);
  save();
  res.json({ ok: true });
});
app.get("/demo/product.svg", (req, res) =>
  res.type("image/svg+xml").send(product),
);
app.get("/demo/about", (req, res) =>
  res.send(
    '<!doctype html><html lang="en"><head><title>Our story — Fieldwork</title></head><body><main><h1>Our story</h1><p>Everyday essentials, thoughtfully made.</p><a href="/demo">Back to the shop</a></main></body></html>',
  ),
);
app.get("/demo/missing", (req, res) =>
  res
    .status(404)
    .send(
      '<!doctype html><html><head><title>Page not found</title></head><body><main><h1>Shipping page not found</h1><p>This is an intentional defect in the Trace demo.</p><a href="/demo">Back to the shop</a></main></body></html>',
    ),
);
app.get("/demo", (req, res) => res.send(demo));
app.use(
  "/artifacts",
  express.static(path.join(dataDir, "artifacts"), {
    dotfiles: "deny",
    index: false,
  }),
);
app.use("/api", (req, res) =>
  res.status(404).json({ error: "API route not found." }),
);
if (!hosted && fs.existsSync("dist/index.html")) {
  app.use(express.static("dist"));
  app.get("/{*path}", (req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
}
app.use((error, req, res, next) => {
  const status = error.status || 400;
  res.status(status).json({
    error:
      error instanceof z.ZodError
        ? error.issues.map((i) => i.message).join(" ")
        : error.message || "Request failed.",
  });
});
const server = app.listen(port, hosted ? "0.0.0.0" : "127.0.0.1", () =>
  console.log(`Trace service: http://127.0.0.1:${port}`),
);
let ticking = false;
const timer = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    for (const schedule of db.schedules) {
      if (
        !schedule.enabled ||
        Date.parse(schedule.nextRunAt) > Date.now() ||
        active.size >= 2
      )
        continue;
      const previous = db.sessions.find((s) => s.id === schedule.lastRunId);
      if (previous && isRunning(previous)) continue;
      try {
        const session = newSession({
          name: schedule.name,
          environmentId: schedule.environmentId,
          mode: schedule.mode,
          brief: "Scheduled browser audit.",
          expectedText: "",
        });
        schedule.lastRunId = session.id;
        await runSession(session);
        schedule.lastError = null;
      } catch (error) {
        schedule.lastError = error.message;
      }
      schedule.nextRunAt = new Date(
        Date.now() + schedule.intervalHours * 3600000,
      ).toISOString();
      save();
    }
  } finally {
    ticking = false;
  }
}, 10000);
async function shutdown() {
  clearInterval(timer);
  for (const control of active.values()) {
    control.cancelled = true;
    await control.browser?.close().catch(() => {});
  }
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
