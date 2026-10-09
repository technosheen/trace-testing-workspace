import fs from "node:fs/promises";
import YAML from "yaml";
const args = process.argv.slice(2);
const filename = args[0];
function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
const service = option("--service") || "http://127.0.0.1:4310";
if (!filename) {
  console.error(
    "Usage: npm run check -- tests.trace.yaml [--url https://example.com] [--service http://127.0.0.1:4310]",
  );
  process.exit(2);
}
async function api(url, method = "GET", body) {
  const response = await fetch(`${service}/api${url}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(process.env.TRACE_RUNNER_KEY
        ? { Authorization: `Bearer ${process.env.TRACE_RUNNER_KEY}` }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
try {
  const yaml = await fs.readFile(filename, "utf8");
  const manifest = YAML.parse(yaml, { maxAliasCount: 0 });
  const url = option("--url") || manifest.url;
  if (!url) throw new Error("Provide --url or a manifest URL.");
  const w = await api("/workspace");
  let environment = w.environments.find((e) => e.url === url);
  if (!environment)
    environment = await api("/environments", "POST", {
      name: new URL(url).hostname,
      url,
    });
  const session = await api("/import", "POST", {
    yaml,
    environmentId: environment.id,
  });
  await api(`/sessions/${session.id}/run`, "POST");
  let current;
  for (let i = 0; i < 200; i++) {
    current = await api(`/sessions/${session.id}`);
    if (!["running", "cancelling"].includes(current.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  current.cases.forEach((c) =>
    console.log(
      `${c.status.toUpperCase().padEnd(13)} ${c.name}: ${c.result?.summary || "No result"}`,
    ),
  );
  console.log(`Report: ${service}/#/sessions/${session.id}`);
  process.exit(
    current.status === "completed" &&
      current.cases.every((c) => c.status === "passed")
      ? 0
      : 1,
  );
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
