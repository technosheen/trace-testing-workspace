import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const moduleUrl = new URL("./store.mjs", import.meta.url).href;
const fixture = () => ({ version: 1, environments: [], sessions: [], schedules: [], knowledge: [] });

function workspace(t, value = fixture()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trace-store-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (value !== null) fs.writeFileSync(path.join(dir, "workspace.json"), JSON.stringify(value, null, 2));
  return dir;
}

function run(dir, body = "console.log(JSON.stringify(store.db));") {
  return spawnSync(process.execPath, ["--input-type=module", "-e", `const store = await import(${JSON.stringify(moduleUrl)}); ${body}`], {
    env: { ...process.env, TRACE_DATA_DIR: dir }, encoding: "utf8",
  });
}

function read(dir, filename = "workspace.json") {
  return JSON.parse(fs.readFileSync(path.join(dir, filename), "utf8"));
}

test("a fresh workspace persists a valid backup that survives restart", (t) => {
  const dir = workspace(t, null);
  const first = run(dir);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(read(dir, "workspace.json.bak"), read(dir));
  const backup = fs.readFileSync(path.join(dir, "workspace.json.bak"));
  assert.equal(run(dir).status, 0);
  assert.deepEqual(fs.readFileSync(path.join(dir, "workspace.json.bak")), backup);
});

test("each successful save retains the previous committed snapshot", (t) => {
  const dir = workspace(t);
  const result = run(dir, `store.db.knowledge.push({id:"first"}); store.save(); store.db.knowledge.push({id:"second"}); store.save();`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(read(dir).knowledge, [{ id: "first" }, { id: "second" }]);
  assert.deepEqual(read(dir, "workspace.json.bak").knowledge, [{ id: "first" }]);
  assert.equal(run(dir).status, 0);
  assert.deepEqual(read(dir, "workspace.json.bak").knowledge, [{ id: "first" }]);
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.endsWith(".tmp")), []);
});

test("truncated primary fails closed and describes validated backup recovery and possible data loss", (t) => {
  const dir = workspace(t);
  fs.writeFileSync(path.join(dir, "workspace.json.bak"), JSON.stringify(fixture()));
  const damaged = '{"version":1,"sessions":[';
  fs.writeFileSync(path.join(dir, "workspace.json"), damaged);
  const backup = fs.readFileSync(path.join(dir, "workspace.json.bak"));
  const result = run(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /backup.*valid|valid.*backup/i);
  assert.match(result.stderr, /lose|loss/i);
  assert.match(result.stderr, /stop|stopped/i);
  assert.equal(fs.readFileSync(path.join(dir, "workspace.json"), "utf8"), damaged);
  assert.deepEqual(fs.readFileSync(path.join(dir, "workspace.json.bak")), backup);
});

test("missing primary with a backup fails closed instead of seeding away saved data", (t) => {
  const dir = workspace(t, null);
  const saved = fixture();
  saved.knowledge = [{ id: "existing" }];
  fs.writeFileSync(path.join(dir, "workspace.json.bak"), JSON.stringify(saved));
  const result = run(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /backup/i);
  assert.equal(fs.existsSync(path.join(dir, "workspace.json")), false);
  assert.deepEqual(read(dir, "workspace.json.bak").knowledge, [{ id: "existing" }]);
});

test("valid JSON with a malformed workspace is rejected without overwriting either file", (t) => {
  const malformed = { ...fixture(), sessions: "unexpected" };
  const dir = workspace(t, malformed);
  fs.writeFileSync(path.join(dir, "workspace.json.bak"), '{"also":"malformed"}');
  const primary = fs.readFileSync(path.join(dir, "workspace.json"));
  const backup = fs.readFileSync(path.join(dir, "workspace.json.bak"));
  const result = run(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid|malformed/i);
  assert.match(result.stderr, /no valid backup/i);
  assert.deepEqual(fs.readFileSync(path.join(dir, "workspace.json")), primary);
  assert.deepEqual(fs.readFileSync(path.join(dir, "workspace.json.bak")), backup);
});

test("unsupported versions and malformed run collections fail before a save", (t) => {
  for (const bad of [
    { ...fixture(), version: 999 },
    { ...fixture(), sessions: [{ id: "run", status: "running", cases: [], activity: null }] },
    { ...fixture(), sessions: [{ id: "run", status: "running", cases: [null], activity: [] }] },
  ]) {
    const dir = workspace(t, bad);
    const before = fs.readFileSync(path.join(dir, "workspace.json"));
    const result = run(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid|malformed|unsupported/i);
    assert.deepEqual(fs.readFileSync(path.join(dir, "workspace.json")), before);
  }
});

test("restart checkpoints interrupted runs and agent state without duplicating activity", (t) => {
  const saved = fixture();
  saved.sessions = [
    { id: "active", status: "cancelling", agent: { state: "running" }, cases: [{ id: "a", status: "running" }, { id: "b", status: "passed" }], activity: [] },
    { id: "done", status: "completed", cases: [{ status: "passed" }], activity: [] },
  ];
  const dir = workspace(t, saved);
  const first = run(dir);
  assert.equal(first.status, 0, first.stderr);
  const recovered = read(dir);
  assert.equal(recovered.sessions[0].status, "interrupted");
  assert.equal(recovered.sessions[0].agent.state, "interrupted");
  assert.deepEqual(recovered.sessions[0].cases.map((item) => item.status), ["blocked", "passed"]);
  assert.equal(recovered.sessions[0].activity.length, 1);
  assert.ok(recovered.sessions[0].updatedAt);
  assert.equal(recovered.sessions[1].status, "completed");
  assert.equal(run(dir).status, 0);
  assert.deepEqual(read(dir), recovered);
  assert.equal(read(dir, "workspace.json.bak").sessions[0].status, "cancelling");
});

test("invalid in-memory mutation cannot replace valid persisted data", (t) => {
  const dir = workspace(t);
  const result = run(dir, `store.db.sessions = null; try { store.save(); console.log("saved"); } catch (error) { console.log(error.code); }`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /TRACE_STORAGE_INVALID/);
  assert.deepEqual(read(dir), fixture());
});

test("a persistence failure latches unhealthy state and refuses later saves until reload", (t) => {
  const dir = workspace(t);
  const result = run(dir, `
    const fs = await import("node:fs");
    fs.writeFileSync(store.dataDir + "/workspace.json", JSON.stringify({...store.db, knowledge:[{id:"external"}]}));
    let firstError;
    try { store.save(); } catch (error) { firstError = error.code; }
    fs.writeFileSync(store.dataDir + "/workspace.json", JSON.stringify(store.db, null, 2));
    let retryError;
    try { store.save(); } catch (error) { retryError = error.code; }
    console.log(JSON.stringify({firstError, retryError, healthy:store.storageState.healthy}));
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {firstError:"TRACE_STORAGE_STALE", retryError:"TRACE_STORAGE_STALE", healthy:false});
});

test("backup publication failure preserves primary and cleans temporary files", (t) => {
  const dir = workspace(t);
  const result = run(dir, `
    const fs = await import("node:fs");
    const backup = ${JSON.stringify("workspace.json.bak")};
    fs.rmSync(store.dataDir + "/" + backup, {force:true});
    fs.mkdirSync(store.dataDir + "/" + backup);
    store.db.knowledge.push({id:"uncommitted"});
    try { store.save(); console.log("saved"); } catch (error) { console.log(error.code); }
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /saved/);
  assert.deepEqual(read(dir), fixture());
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.endsWith(".tmp")), []);
});

test("process death at primary publication leaves a complete old or new workspace and valid backup", (t) => {
  for (const phase of ["before", "after"]) {
    const dir = workspace(t);
    const result = run(dir, `
      const fs = (await import("node:fs")).default;
      const rename = fs.renameSync;
      fs.renameSync = (source, target) => {
        const publishingPrimary = target === store.dataDir + "/workspace.json";
        if (publishingPrimary && ${JSON.stringify(phase)} === "before") process.kill(process.pid, "SIGKILL");
        rename(source, target);
        if (publishingPrimary && ${JSON.stringify(phase)} === "after") process.kill(process.pid, "SIGKILL");
      };
      store.db.knowledge.push({id:"committed"}); store.save();
    `);
    assert.equal(result.signal, "SIGKILL");
    assert.deepEqual(read(dir).knowledge, phase === "before" ? [] : [{ id: "committed" }]);
    assert.deepEqual(read(dir, "workspace.json.bak").knowledge, []);
    assert.equal(run(dir).status, 0);
    assert.deepEqual(read(dir).knowledge, phase === "before" ? [] : [{ id: "committed" }]);
  }
});

test("a stale writer cannot overwrite another process's committed workspace or backup", async (t) => {
  const dir = workspace(t);
  fs.writeFileSync(path.join(dir, "workspace.json.bak"), JSON.stringify(fixture()));
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    const store = await import(${JSON.stringify(moduleUrl)});
    console.log("ready");
    process.stdin.once("data", () => {
      store.db.knowledge.push({id:"stale"});
      try { store.save(); console.log("saved"); } catch (error) { console.log(error.code, error.message); }
    });
  `], { env: { ...process.env, TRACE_DATA_DIR: dir }, stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());
  let output = "";
  let errorOutput = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { errorOutput += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`writer startup timed out: ${errorOutput}`)), 5000);
    child.stdout.once("data", () => { clearTimeout(timer); resolve(); });
    child.once("error", reject);
  });
  assert.match(output, /ready/);
  const other = run(dir, `store.db.knowledge.push({id:"newer"}); store.save();`);
  assert.equal(other.status, 0, other.stderr);
  const backup = fs.readFileSync(path.join(dir, "workspace.json.bak"));
  const exit = new Promise((resolve) => child.once("close", resolve));
  child.stdin.end("save");
  assert.equal(await exit, 0, errorOutput);
  assert.match(output, /TRACE_STORAGE_STALE/);
  assert.match(output, /restart|reload/i);
  assert.deepEqual(read(dir).knowledge, [{ id: "newer" }]);
  assert.deepEqual(fs.readFileSync(path.join(dir, "workspace.json.bak")), backup);
});
