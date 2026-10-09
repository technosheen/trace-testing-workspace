import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const dataDir = path.resolve(process.env.TRACE_DATA_DIR || ".trace");
fs.mkdirSync(path.join(dataDir, "artifacts"), { recursive: true });
const file = path.join(dataDir, "workspace.json");
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
const demoUrl = `http://127.0.0.1:${process.env.PORT || 4310}/demo`;
export const db = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8"))
  : {
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
  }
}
export function save() {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
export function event(session, role, message, extra = {}) {
  session.activity.push({ id: id(), at: now(), role, message, ...extra });
  session.updatedAt = now();
  save();
}
save();
