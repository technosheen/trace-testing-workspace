import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import YAML from "yaml";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
test(
  "real browser workflow, reproduction, regression round-trip, cancellation and durable review",
  { timeout: 120000 },
  async (t) => {
    const temp = await mkdtemp(path.join(tmpdir(), "trace-test-"));
    const socket = net.createServer();
    await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    let child;
    let logs = "";
    async function launch() {
      child = spawn(process.execPath, ["server/index.mjs"], {
        env: {
          ...process.env,
          PORT: String(port),
          TRACE_DATA_DIR: temp,
          TRACE_TEST: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (d) => {
        logs += d;
      });
      child.stderr.on("data", (d) => {
        logs += d;
      });
      for (let i = 0; i < 60; i++) {
        try {
          if ((await fetch(`${base}/api/health`)).ok) return;
        } catch {}
        await delay(100);
      }
      throw new Error(`Service did not start: ${logs}`);
    }
    async function stop() {
      const stopped = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await stopped;
    }
    async function api(url, method = "GET", body) {
      const response = await fetch(`${base}/api${url}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await response.json();
      assert.equal(response.ok, true, JSON.stringify(result));
      return result;
    }
    async function finished(id) {
      for (let i = 0; i < 400; i++) {
        const s = await api(`/sessions/${id}`);
        if (!["running", "cancelling"].includes(s.status)) return s;
        await delay(150);
      }
      throw new Error("Run did not finish in 30 seconds.");
    }
    try {
      await launch();
      let session = await api("/sessions", "POST", {
        name: "Integration audit",
        environmentId: "demo",
        mode: "smoke",
      });
      await api(`/sessions/${session.id}/cases`, "POST", {
        name: "Shop copy exists",
        kind: "text",
        value: "Everyday essentials",
      });
      await api(`/sessions/${session.id}/run`, "POST");
      const duplicate = await fetch(`${base}/api/sessions/${session.id}/run`, {
        method: "POST",
      });
      assert.equal(duplicate.status, 400);
      session = await finished(session.id);
      assert.equal(
        session.status,
        "completed",
        JSON.stringify(session.activity.slice(-3)),
      );
      assert.equal(session.cases.length, 10);
      assert.equal(
        session.cases.filter((c) => c.status === "passed").length,
        7,
      );
      assert.deepEqual(
        session.findings.map((f) => f.reproduction),
        ["reproduced", "reproduced", "reproduced"],
      );
      for (const finding of session.findings) {
        assert.equal(finding.evidence.length, 2);
        for (const evidence of finding.evidence) {
          const r = await fetch(`${base}${evidence.url}`);
          assert.equal(r.status, 200);
          assert.match(r.headers.get("content-type"), /image\/png/);
        }
      }
      assert.equal((await fetch(`${base}${session.trace}`)).status, 200);
      const findingId = session.findings[0].id;
      await api(`/sessions/${session.id}/findings/${findingId}`, "PATCH", {
        triage: "ACCEPTED",
        note: "Reproduced and reviewed.",
      });
      const yaml = await fetch(
        `${base}/api/sessions/${session.id}/export?format=yaml`,
      ).then((r) => r.text());
      assert.equal(YAML.parse(yaml).schema, "trace/test/v1");
      const imported = await api("/import", "POST", {
        yaml,
        environmentId: "demo",
      });
      assert.equal(imported.cases.length, 10);
      assert.equal(imported.cases.at(-1).value, "Everyday essentials");
      const journeyManifest = { schema: "trace/test/v2", name: "Multi-step fixture", policy: "read-only", checks: [
        {kind: "journey", name: "Browse the story", acceptance: "Story heading appears after navigation.", actions: [
          {action: "navigate", url: "/demo/about"},
          {action: "assertUrl", value: "/demo/about"},
          {action: "assertText", target: {role: "heading", name: "Our story"}, value: "Our story"},
          {action: "click", target: {role: "link", name: "Back to the shop"}},
          {action: "assertUrl", value: "/demo"},
        ]},
        {kind: "journey", name: "Failed assertion stops steps", acceptance: "Missing copy produces a failure.", actions: [
          {action: "navigate", url: "/demo/about"},
          {action: "assertText", target: {selector: "h1"}, value: "Missing heading"},
          {action: "click", target: {role: "link", name: "Back to the shop"}},
        ]},
        {kind: "journey", name: "Fresh case remains isolated", acceptance: "Each journey begins at the environment.", actions: [
          {action: "assertUrl", value: "/demo"},
        ]}
      ]};
      const multi = await api("/import", "POST", {yaml: YAML.stringify(journeyManifest), environmentId: "demo"});
      await api(`/sessions/${multi.id}/run`, "POST");
      const multiRun = await finished(multi.id);
      assert.deepEqual(multiRun.cases.map(c => c.status), ["passed", "issues_found", "passed"]);
      assert.equal(multiRun.cases[0].result.stepResults.length, 5);
      assert.equal(multiRun.cases[1].result.stepResults.at(-1).status, "not_run");
      assert.equal(multiRun.findings[0].reproduction, "reproduced");
      assert(multiRun.cases[0].evidence.some(e => e.kind === "trace"));
      const multiYaml = await fetch(`${base}/api/sessions/${multi.id}/export?format=yaml`).then(r => r.text());
      const roundTrip = await api("/import", "POST", {yaml: multiYaml, environmentId: "demo"});
      assert.deepEqual(roundTrip.cases[0].actions, journeyManifest.checks[0].actions);
      const invalid = await fetch(`${base}/api/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: "schema: wrong", environmentId: "demo" }),
      });
      assert.equal(invalid.status, 400);
      for (const url of [
        "http://127.0.0.1:1",
        "http://169.254.169.254",
        "file:///etc/passwd",
      ]) {
        const r = await fetch(`${base}/api/environments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Unsafe", url }),
        });
        assert.equal(r.status, 400);
      }
      const badOrigin = await fetch(`${base}/api/knowledge`, {
        method: "POST",
        headers: {
          Origin: "https://untrusted.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "bad", content: "bad" }),
      });
      assert.equal(badOrigin.status, 403);
      const policyEnv = await api("/environments", "POST", {
        name: "Network guard fixture",
        url: `${base}/demo/policy`,
      });
      const policySession = await api("/import", "POST", {
        environmentId: policyEnv.id,
        yaml: YAML.stringify({
          schema: "trace/test/v1",
          name: "Network guards",
          checks: [
            {
              kind: "title",
              name: "Page loads",
              acceptance: "A title is present.",
            },
          ],
        }),
      });
      await api(`/sessions/${policySession.id}/run`, "POST");
      const policyRun = await finished(policySession.id);
      assert.equal(policyRun.status, "completed");
      assert.deepEqual(
        await api("/test-counters"),
        { browserWrites: 0, privateReads: 0 },
        "Browser writes, direct private requests, and private redirects must never reach the server.",
      );
      const knowledge = await api("/knowledge", "POST", {
        title: "Review guidance",
        content: "Treat decorative images explicitly.",
      });
      const schedule = await api("/schedules", "POST", {
        name: "Daily demo",
        environmentId: "demo",
        mode: "navigation",
        intervalHours: 24,
      });
      await api(`/schedules/${schedule.id}`, "PATCH", { enabled: false });
      await api(`/sessions/${imported.id}/run`, "POST");
      await api(`/sessions/${imported.id}/cancel`, "POST");
      const cancelled = await finished(imported.id);
      assert.equal(cancelled.status, "cancelled");
      await stop();
      const stored = JSON.parse(
        await readFile(path.join(temp, "workspace.json"), "utf8"),
      );
      assert.equal(
        stored.sessions.find((s) => s.id === session.id).findings[0].triage,
        "ACCEPTED",
      );
      assert.equal(
        stored.knowledge.find((k) => k.id === knowledge.id).content,
        "Treat decorative images explicitly.",
      );
      // Make a schedule due before restart, then verify the actual scheduler creates a run.
      const due = stored.schedules.find((s) => s.id === schedule.id);
      due.enabled = true;
      due.nextRunAt = new Date(0).toISOString();
      await writeFile(
        path.join(temp, "workspace.json"),
        JSON.stringify(stored),
      );
      await launch();
      const durable = await api(`/sessions/${session.id}`);
      assert.equal(durable.findings[0].note, "Reproduced and reviewed.");
      let scheduled;
      for (let i = 0; i < 100; i++) {
        const w = await api("/workspace");
        scheduled = w.schedules.find((s) => s.id === schedule.id);
        if (scheduled.lastRunId) break;
        await delay(150);
      }
      assert.ok(scheduled.lastRunId);
      const scheduledRun = await finished(scheduled.lastRunId);
      assert.equal(scheduledRun.status, "completed");
      assert.equal(scheduledRun.cases.length, 4);
      await api(`/sessions/${session.id}/run`, "POST");
      const rerun = await finished(session.id);
      assert.equal(rerun.history.length, 1);
      assert.equal(rerun.history[0].findings[0].triage, "ACCEPTED");
      t.diagnostic(
        "Verified 10 actual checks, three independent reproductions, screenshots, trace, review persistence, YAML round-trip, invalid inputs, local network guard, cancellation, schedule execution, and run history.",
      );
    } finally {
      if (child?.exitCode === null) await stop();
      await rm(temp, { recursive: true, force: true });
    }
  },
);
