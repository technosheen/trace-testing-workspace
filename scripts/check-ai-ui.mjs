import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const temp = await mkdtemp(path.join(tmpdir(), "trace-ai-ui-"));
const base = "http://127.0.0.1:4327";
const child = spawn(process.execPath, ["server/index.mjs"], {
  env: {
    ...process.env,
    PORT: "4327",
    TRACE_DATA_DIR: temp,
    TRACE_HOSTED: "0",
    AZURE_OPENAI_ENDPOINT: "https://example.cognitiveservices.azure.com/",
    AZURE_OPENAI_DEPLOYMENT: "trace-drafting",
  },
  stdio: "ignore",
});
let browser;
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/#/settings`);
  await page
    .getByRole("heading", { name: "AI test generation", exact: true })
    .waitFor();
  assert.ok(
    await page
      .getByText("Configured · awaiting first draft · Azure OpenAI", {
        exact: true,
      })
      .isVisible(),
  );
  await page
    .getByRole("button", { name: "Generate a test plan", exact: true })
    .click();
  const creation = page.getByLabel(/^Plan creation/);
  assert.equal(await creation.inputValue(), "ai");
  await page
    .getByRole("button", { name: "Generate test plan", exact: true })
    .click();
  assert.equal(
    await page
      .getByLabel(/^Testing brief/)
      .evaluate((el) => el.validity.valueMissing),
    true,
  );
  await page
    .getByLabel(/^Testing brief/)
    .fill("Check the page title and homepage availability.");
  await page.getByRole("checkbox").check();
  assert.ok(await page.getByRole("checkbox").isChecked());
  if (process.argv[2])
    await page.screenshot({ path: process.argv[2], fullPage: true });
  await creation.selectOption("standard");
  assert.ok(
    await page
      .getByRole("button", { name: "Create test plan", exact: true })
      .isVisible(),
  );
  assert.equal(await page.getByRole("checkbox").count(), 0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 4,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      settings: "rendered",
      aiDraftForm: "verified",
      briefRequired: true,
      standardFallback: true,
      mobileOverflow: false,
      providerCalled: false,
    }),
  );
} finally {
  await browser?.close();
  const exit = new Promise((r) => child.once("exit", r));
  child.kill("SIGTERM");
  await exit;
  await rm(temp, { recursive: true, force: true });
}
