import test from "node:test";
import assert from "node:assert/strict";
import { privateAddress, validateTarget, safeNavigation } from "./policy.mjs";
test("rejects local, private, metadata and mapped IPv6 addresses", async () => {
  for (const value of [
    "127.0.0.1",
    "10.2.3.4",
    "172.16.1.4",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
  ])
    assert.equal(privateAddress(value), true, value);
  for (const value of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"])
    assert.equal(privateAddress(value), false, value);
  for (const url of [
    "http://127.0.0.1:4310/api/workspace",
    "http://10.0.0.1",
    "http://[::1]",
    "file:///etc/passwd",
    "https://user:password@example.com",
  ])
    await assert.rejects(validateTarget(url));
  assert.equal(
    (await validateTarget("http://127.0.0.1:4310/demo")).pathname,
    "/demo",
  );
});
test("excludes navigation paths that may mutate state and query links", () => {
  for (const value of [
    "https://example.com/logout",
    "https://example.com/delete/1",
    "https://example.com/checkout",
    "https://example.com/page?command=save",
  ])
    assert.equal(safeNavigation(new URL(value)), false);
  assert.equal(safeNavigation(new URL("https://example.com/about")), true);
});
