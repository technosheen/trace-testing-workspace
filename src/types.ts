export type Status =
  "not_run" | "running" | "passed" | "issues_found" | "blocked";
export type Evidence = {
  id: string;
  at: string;
  kind: string;
  url: string;
  caption: string;
};
export type TestCase = {
  id: string;
  kind: string;
  name: string;
  acceptance: string;
  value?: string;
  preconditions: string[];
  steps: string[];
  status: Status;
  controls: { name: string; status: string }[];
  evidence: Evidence[];
  result: { status: Status; summary: string; details: string[] } | null;
  durationMs?: number;
};
export type Finding = {
  id: string;
  caseId: string;
  name: string;
  kind: string;
  expected: string;
  actual: string;
  details: string[];
  reproSteps: string[];
  reproduction: "checking" | "reproduced" | "not_reproduced" | "blocked";
  triage: string;
  note?: string;
  reviewedAt?: string;
  createdAt: string;
  evidence: Evidence[];
  reproductionResult: {
    summary: string;
    status: string;
    details: string[];
  } | null;
};
export type Activity = {
  id: string;
  at: string;
  role: string;
  message: string;
  caseId?: string;
  status?: string;
  findingId?: string;
};
export type Run = {
  runId: string;
  at: string;
  status: string;
  cases: TestCase[];
  findings: Finding[];
};
export type Session = {
  generation?: {
    provider: string;
    model: string;
    at: string;
    summary: string;
    limitations: string[];
    knowledgeNotes: number;
  };
  id: string;
  name: string;
  environmentId: string;
  environmentName: string;
  url: string;
  mode: string;
  brief: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  runId?: string;
  trace?: string;
  cases: TestCase[];
  findings: Finding[];
  activity: Activity[];
  history: Run[];
};
export type Environment = {
  id: string;
  name: string;
  url: string;
  description: string;
  createdAt: string;
};
export type Schedule = {
  id: string;
  name: string;
  environmentId: string;
  mode: string;
  intervalHours: number;
  enabled: boolean;
  nextRunAt: string;
  lastRunId?: string;
  lastError?: string;
};
export type Knowledge = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
};
export type Workspace = {
  sessions: Session[];
  environments: Environment[];
  schedules: Schedule[];
  knowledge: Knowledge[];
  service: {
    mode: string;
    engine: string;
    activeRuns: number;
    ai?: {
      configured: boolean;
      provider: string;
      model: string | null;
      generating: boolean;
      remainingToday: number;
      lastSuccessAt: string | null;
    };
  };
};
