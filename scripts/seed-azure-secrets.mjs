import { spawnSync } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
const subscription = "6b8f4e09-06bd-4b5f-82cf-9929b711e066";
const vault = "trace9636vault";
function az(args, input) {
  const result = spawnSync("az", [...args, "--subscription", subscription, "--only-show-errors", "-o", "json"], { input, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  // Never print captured output: responses can contain credentials.
  if (result.status !== 0) throw new Error(`Azure credential operation failed (exit ${result.status}).`);
  return JSON.parse(result.stdout || "null");
}
const names = az(["keyvault", "secret", "list", "--vault-name", vault, "--query", "[].name"]);
const existing = name => names.includes(name) ? az(["keyvault", "secret", "show", "--vault-name", vault, "--name", name, "--query", "value"]) : undefined;
const previousPassword = existing("workspace-password");
const workspacePassword = previousPassword || randomBytes(24).toString("base64url");
const salt = randomBytes(16).toString("hex");
const parameters = {
  runnerKey: { value: existing("runner-key") || randomBytes(32).toString("hex") },
  sessionSecret: { value: existing("session-secret") || randomBytes(32).toString("hex") },
  passwordHash: { value: (previousPassword && existing("password-hash")) || `scrypt:${salt}:${scryptSync(workspacePassword, salt, 64).toString("hex")}` },
  workspacePassword: { value: workspacePassword },
};
const status = az(["deployment", "group", "create", "--name", "trace-secrets", "--resource-group", "trace-rg", "--template-file", "infra/seed-secrets.bicep", "--parameters", "@/dev/stdin", "--query", "properties.provisioningState"], JSON.stringify(parameters));
if (status !== "Succeeded") throw new Error("Azure credential deployment did not succeed.");
console.log("Credentials stored in Azure Key Vault. Existing credentials preserved; no local credential files created.");
