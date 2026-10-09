import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { scryptSync } from "node:crypto";
import { equalSecret, parsePasswordHash } from "./auth.mjs";
test("authentication config rejects missing or malformed secrets", () => {
  assert.equal(equalSecret("a", "b"), false);
  assert.equal(equalSecret("a", "a"), true);
  assert.throws(() => parsePasswordHash("plaintext"));
  const child = spawn(process.execPath, ["server/index.mjs"], {
    env: { ...process.env, TRACE_HOSTED: "1", TRACE_RUNNER_KEY: "" },
    stdio: "ignore",
  });
  return new Promise((resolve) =>
    child.on("exit", (code) => {
      assert.notEqual(code, 0);
      resolve();
    }),
  );
});
test("hosted runner authenticates every API and artifact and throttles password attempts", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "trace-host-"));
  const socket = net.createServer();
  await new Promise((r) => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  const key = "test-runner-key-".repeat(3),
    salt = "a".repeat(32),
    password = "synthetic-test-password";
  const child = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      PORT: String(port),
      TRACE_DATA_DIR: temp,
      TRACE_HOSTED: "1",
      TRACE_RUNNER_KEY: key,
      TRACE_PASSWORD_HASH: `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
    },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(base + "/api/health")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready);
    for (const path of [
      "/api/workspace",
      "/artifacts/test.png",
      "/api/sessions",
      "/api/auth/login",
    ])
      assert.equal((await fetch(base + path)).status, 401);
    assert.equal(
      (
        await fetch(base + "/api/workspace", {
          headers: { Authorization: "Bearer wrong" },
        })
      ).status,
      401,
    );
    const headers = { Authorization: `Bearer ${key}` };
    const w = await fetch(base + "/api/workspace", { headers });
    assert.equal((await w.json()).service.mode, "hosted");
    const login = async (p, client) =>
      fetch(base + "/api/auth/login", {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "x-trace-client": client,
        },
        body: JSON.stringify({ password: p }),
      });
    assert.equal((await login(password, "ok")).status, 200);
    for (let i = 0; i < 5; i++)
      assert.equal((await login("wrong", "bad")).status, 401);
    assert.equal((await login(password, "bad")).status, 429);
    assert.equal((await fetch(base + "/demo")).status, 200);
  } finally {
    await new Promise((resolve) => {
      child.once("exit", resolve);
      child.kill("SIGTERM");
    });
    await rm(temp, { recursive: true, force: true });
  }
});
