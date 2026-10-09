import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const subscription = "6b8f4e09-06bd-4b5f-82cf-9929b711e066";
const account = "trace9636storage";
function az(args, env = process.env) {
  const result = spawnSync("az", [...args, "--subscription", subscription, "--only-show-errors", "-o", "json"], { env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Azure migration operation failed (exit ${result.status}).`);
  return JSON.parse(result.stdout || "null");
}
// This one-time import must never overwrite a running cloud workspace.
const apps = az(["resource", "list", "--resource-group", "trace-rg", "--query", "[?type=='Microsoft.App/containerApps' && name=='trace-app'].id"]);
if (apps.length) {
  const image = az(["containerapp", "show", "--resource-group", "trace-rg", "--name", "trace-app", "--query", "properties.template.containers[0].image"]);
  if (image !== "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest") throw new Error("Migration requires the inactive placeholder app; refusing to overwrite cloud data.");
}
const workspace = JSON.parse(readFileSync(".trace/workspace.json", "utf8"));
if (workspace.sessions.some(session => ["running", "cancelling"].includes(session.status))) throw new Error("Wait for local browser runs to finish before migration.");
const key = az(["storage", "account", "keys", "list", "--resource-group", "trace-rg", "--account-name", account, "--query", "[0].value"]);
const env = { ...process.env, AZURE_STORAGE_KEY: key };
const files = az(["storage", "file", "upload-batch", "--account-name", account, "--destination", "trace-data", "--source", ".trace", "--pattern", "artifacts/*", "--no-progress", "--max-connections", "4"], env);
az(["storage", "file", "upload", "--account-name", account, "--share-name", "trace-data", "--source", ".trace/workspace.json", "--path", "workspace.json", "--no-progress"], env);
console.log(JSON.stringify({ migratedSessions: workspace.sessions.length, migratedEnvironments: workspace.environments.length, artifactFiles: files?.length }));
