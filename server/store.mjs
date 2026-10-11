import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const dataDir = path.resolve(process.env.TRACE_DATA_DIR || ".trace");
fs.mkdirSync(path.join(dataDir, "artifacts"), { recursive: true });
const file = path.join(dataDir, "workspace.json");
const backupFile = `${file}.bak`;
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const storageState = { healthy: true, error: null, durability: "file-and-directory-sync" };
let lastBytes;
let storageFailure;

function storageError(code, message) {
  return Object.assign(new Error(message), { code });
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function validateWorkspace(value) {
  if (!isRecord(value) || value.version !== 1) {
    throw storageError("TRACE_STORAGE_INVALID", "Invalid or unsupported workspace version.");
  }
  for (const collection of ["environments", "sessions", "schedules", "knowledge"]) {
    if (!Array.isArray(value[collection]) || !value[collection].every(isRecord)) {
      throw storageError("TRACE_STORAGE_INVALID", `Invalid workspace collection: ${collection}.`);
    }
  }
  for (const session of value.sessions) {
    if (typeof session.id !== "string" || !Array.isArray(session.cases) || !session.cases.every(isRecord) ||
        !Array.isArray(session.activity) || !session.activity.every(isRecord)) {
      throw storageError("TRACE_STORAGE_INVALID", "Invalid workspace session: id, cases and activity are required.");
    }
    if (session.agent !== undefined && !isRecord(session.agent)) {
      throw storageError("TRACE_STORAGE_INVALID", "Invalid workspace agent metadata.");
    }
  }
  return value;
}

function readBytes(filename) {
  try { return fs.readFileSync(filename); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function parseWorkspace(bytes) {
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw storageError("TRACE_STORAGE_INVALID", "Invalid workspace JSON."); }
  return validateWorkspace(value);
}

function recoveryError() {
  let validBackup = false;
  try {
    const bytes = readBytes(backupFile);
    if (bytes) { parseWorkspace(bytes); validBackup = true; }
  } catch { /* Recovery never writes either file, including an invalid backup. */ }
  const advice = validBackup
    ? `A valid backup exists at ${backupFile}. With all writers stopped, preserve the damaged primary and copy the backup to ${file} before restarting. Restoring it may lose changes newer than that backup.`
    : "No valid backup is available. Stop all writers, preserve the existing files and restore a verified external backup before restarting.";
  return storageError("TRACE_STORAGE_INVALID", `Invalid, unreadable or missing workspace at ${file}; startup stopped to prevent data loss. ${advice}`);
}

function loadWorkspace() {
  try {
    lastBytes = readBytes(file);
    if (lastBytes !== null) return parseWorkspace(lastBytes);
    if (fs.existsSync(backupFile)) throw recoveryError();
    return null;
  } catch { throw recoveryError(); }
}

const demoUrl = `http://127.0.0.1:${process.env.PORT || 4310}/demo`;
export const db = loadWorkspace() ?? {
      version: 1,
      environments: [
        {
          id: "demo",
          name: "Demo storefront",
          url: demoUrl,
          description:
            "A local shop with deliberate defects. Try the full testing workflow.",
          createdAt: now(),
        },
      ],
      sessions: [],
      schedules: [],
      knowledge: [],
    };
// A stopped service cannot leave an old run looking active.
for (const session of db.sessions) {
  if (["running", "cancelling"].includes(session.status)) {
    session.status = "interrupted";
    if (session.agent?.state === "running") {
      session.agent.state = "interrupted";
      session.agent.summary = "Service restarted; exploration was interrupted.";
    }
    session.cases.forEach((c) => {
      if (c.status === "running") c.status = "blocked";
    });
    session.activity.push({
      id: id(),
      at: now(),
      role: "Runner",
      message:
        "Service restarted. This run was interrupted; start a new run to continue.",
    });
    session.updatedAt = now();
  }
}

function atomicWrite(filename, bytes) {
  // Exclusive, unique staging paths prevent different processes sharing a temp file.
  const temp = `${filename}.${process.pid}.${id()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, filename);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temp, { force: true });
  }
}

function syncDirectory() {
  const fd = fs.openSync(dataDir, "r");
  try { fs.fsyncSync(fd); }
  catch (error) {
    // Some network filesystems cannot sync directories; file fsync still applies.
    if (!["EINVAL", "ENOTSUP", "EISDIR"].includes(error.code)) throw error;
    storageState.durability = "file-sync-only";
  } finally { fs.closeSync(fd); }
}

function assertCurrentWriter() {
  const current = readBytes(file);
  if ((current === null) !== (lastBytes === null) || (current !== null && !current.equals(lastBytes))) {
    throw storageError("TRACE_STORAGE_STALE", `Workspace ${file} changed outside this process. Save refused to prevent data loss. Stop competing writers and restart to reload the latest workspace.`);
  }
}

export function save() {
  if (storageFailure) throw storageFailure;
  try {
    validateWorkspace(db);
    const bytes = Buffer.from(JSON.stringify(db, null, 2));
    assertCurrentWriter();
    // A no-op restart must not rotate away the last pre-change snapshot.
    if (lastBytes !== null && bytes.equals(lastBytes) && fs.existsSync(backupFile)) return;
    atomicWrite(backupFile, lastBytes ?? bytes);
    syncDirectory();
    // Detect a competing commit during backup publication as well as before it.
    assertCurrentWriter();
    atomicWrite(file, bytes);
    lastBytes = bytes;
    syncDirectory();
  } catch (error) {
    storageFailure = error.code?.startsWith("TRACE_STORAGE_") ? error : storageError("TRACE_STORAGE_WRITE_FAILED", `Workspace persistence failed at ${file}. Saves are stopped; inspect storage permissions and capacity, then restart to reload persisted data. (${error.code || "unknown error"})`);
    storageState.healthy = false;
    storageState.error = storageFailure.message;
    throw storageFailure;
  }
}
export function event(session, role, message, extra = {}) {
  session.activity.push({ id: id(), at: now(), role, message, ...extra });
  session.updatedAt = now();
  save();
}
save();
