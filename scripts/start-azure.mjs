import { spawn } from "node:child_process";
const children = [
  spawn(process.execPath, ["server/index.mjs"], { stdio: "inherit", env: { ...process.env, PORT: "4310" } }),
  spawn(process.execPath, ["hosting/azure-server.mjs"], { stdio: "inherit", env: { ...process.env, PORT: "8080" } }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  children.forEach(child => child.kill("SIGTERM"));
  setTimeout(() => process.exit(code), 5000).unref();
}
children.forEach(child => {
  child.on("error", () => stop(1));
  child.on("exit", code => stop(code || 0));
});
process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop());
