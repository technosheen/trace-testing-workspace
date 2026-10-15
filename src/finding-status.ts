import type { Finding } from "./types";

export function isOpenFinding(finding: Pick<Finding, "triage">): boolean {
  return finding.triage === "OPEN" || finding.triage === "ACCEPTED";
}
