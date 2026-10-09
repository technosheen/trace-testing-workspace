// Keep native sign-in and sign-out callbacks registered after infrastructure changes.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const parameters = JSON.parse(
  readFileSync(new URL("../infra/main.parameters.json", import.meta.url)),
).parameters;
const clientId = parameters.entraClientId?.value;
if (!clientId) throw new Error("Microsoft sign-in is not configured.");
function azure(args) {
  const result = spawnSync("az", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw new Error("Azure registration update failed.");
  return result.stdout ? JSON.parse(result.stdout) : null;
}
const host = azure([
  "containerapp",
  "show",
  "--name",
  "trace-app",
  "--resource-group",
  "trace-rg",
  "--query",
  "properties.configuration.ingress.fqdn",
  "-o",
  "json",
]);
const registered = azure([
  "ad",
  "app",
  "show",
  "--id",
  clientId,
  "--query",
  "web.redirectUris",
  "-o",
  "json",
]);
const callbacks = [
  "/.auth/login/aad/callback",
  "/.auth/logout/complete",
  ...(parameters.entraCir2TenantId?.value
    ? ["/.auth/login/cir2/callback"]
    : []),
].map((path) => `https://${host}${path}`);
azure([
  "ad",
  "app",
  "update",
  "--id",
  clientId,
  "--web-redirect-uris",
  ...new Set([...registered, ...callbacks]),
]);
if (parameters.entraCir2TenantId?.value)
  azure([
    "ad",
    "app",
    "update",
    "--id",
    clientId,
    "--sign-in-audience",
    "AzureADMultipleOrgs",
  ]);
console.log("Trace Microsoft sign-in and sign-out callbacks are registered.");
