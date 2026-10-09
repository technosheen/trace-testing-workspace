import { useState } from "react";
import {
  ArrowLeft,
  Play,
  Download,
  Square,
  Plus,
  SearchCheck,
  Bug,
  CheckCircle2,
  ArrowUpRight,
  Clock3,
  FileText,
  Activity,
  History,
  ShieldCheck,
  Trash2,
  Copy,
  ExternalLink,
  ChevronRight,
} from "lucide-react";
import type { Finding, Session, TestCase } from "../types";
import { counts, date } from "../api";
import {
  Dialog,
  Empty,
  EvidenceImage,
  SearchBox,
  Status,
  CheckList,
} from "./ui";
export function SessionDetail({
  session,
  onBack,
  onRun,
  onCancel,
  onCase,
  onFinding,
  onAddCase,
  onRemoveCase,
}: {
  session: Session;
  onBack: () => void;
  onRun: () => void;
  onCancel: () => void;
  onCase: (c: TestCase) => void;
  onFinding: (f: Finding) => void;
  onAddCase: () => void;
  onRemoveCase: (id: string) => void;
}) {
  const [tab, setTab] = useState("cases");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [run, setRun] = useState("latest");
  const archived = session.history.find((r) => r.runId === run);
  const cases = archived?.cases || session.cases;
  const findings = archived?.findings || session.findings;
  const n = counts(cases);
  const active = ["running", "cancelling"].includes(session.status);
  const visible = cases.filter(
    (c) =>
      (filter === "all" || c.status === filter) &&
      c.name.toLowerCase().includes(search.toLowerCase()),
  );
  const visibleFindings = findings.filter(
    (f) =>
      (filter === "all" ||
        (filter === "OPEN" && f.triage === "OPEN") ||
        (filter === "ACCEPTED" && f.triage === "ACCEPTED") ||
        (filter === "closed" && !["OPEN", "ACCEPTED"].includes(f.triage))) &&
      f.name.toLowerCase().includes(search.toLowerCase()),
  );
  function changeTab(v: string) {
    setTab(v);
    setFilter("all");
    setSearch("");
  }
  return (
    <>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={16} />
        All sessions
      </button>
      <div className="page-heading detail-heading">
        <div>
          <div className="title-line">
            <h1>{session.name}</h1>
            <Status value={archived?.status || session.status} />
          </div>
          <p>
            <span>{session.environmentName}</span>
            <span className="separator">·</span>
            <a
              href={session.environmentId === "demo" ? "/demo" : session.url}
              target="_blank"
              rel="noreferrer"
            >
              {session.url}
              <ArrowUpRight size={13} />
            </a>
          </p>
        </div>
        <div className="heading-actions">
          <a
            className="btn"
            href={`/api/sessions/${session.id}/export?format=yaml`}
          >
            <Download size={16} />
            Export tests
          </a>
          {active ? (
            <button
              className="btn danger-outline"
              disabled={session.status === "cancelling"}
              onClick={onCancel}
            >
              <Square size={14} />
              {session.status === "cancelling" ? "Stopping…" : "Stop run"}
            </button>
          ) : (
            <button className="btn primary" onClick={onRun}>
              <Play size={16} />
              {session.runId ? "Run again" : "Run checks"}
            </button>
          )}
        </div>
      </div>
      {session.generation && (
        <div className="ai-plan-note">
          <strong>AI draft · {session.generation.provider}</strong>
          <p>{session.generation.summary}</p>
          <ul>
            {session.generation.limitations.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="report-summary">
        <div>
          <span className="summary-icon">
            <SearchCheck size={20} />
          </span>
          <strong>{cases.length}</strong>
          <span>Test cases</span>
        </div>
        <div>
          <span className="summary-icon green">
            <CheckCircle2 size={20} />
          </span>
          <strong>{n.passed}</strong>
          <span>Passed</span>
        </div>
        <div>
          <span className="summary-icon rose">
            <Bug size={20} />
          </span>
          <strong>{findings.length}</strong>
          <span>Findings</span>
        </div>
        <div>
          <span className="summary-icon amber">
            <Clock3 size={20} />
          </span>
          <strong>{n.blocked + n.pending}</strong>
          <span>{n.pending ? "Not verified" : "Blocked"}</span>
        </div>
      </div>
      {session.brief && (
        <div className="session-brief">
          <FileText size={17} />
          <p>{session.brief}</p>
        </div>
      )}
      <div className="execution-note">
        <ShieldCheck size={15} />
        <span>
          Read-only browser checks · Independent reproduction · No form
          submissions
        </span>
        {session.history.length > 0 && (
          <label className="run-select">
            <History size={14} />
            <select
              aria-label="Run history"
              value={run}
              onChange={(e) => setRun(e.target.value)}
            >
              <option value="latest">Latest run</option>
              {session.history
                .slice()
                .reverse()
                .map((r, i) => (
                  <option key={r.runId} value={r.runId}>
                    Previous run {session.history.length - i} · {date(r.at)}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      <div
        className="detail-tabs tabs"
        role="tablist"
        aria-label="Session views"
      >
        {[
          ["cases", "Test cases", cases.length],
          ["findings", "Findings", findings.length],
          ["activity", "Activity", session.activity.length],
        ].map(([id, label, number]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => changeTab(String(id))}
          >
            {label}
            <span className="tab-count">{number}</span>
          </button>
        ))}
      </div>
      {archived && (
        <div className="archived-note">
          Viewing a preserved run. Review actions are available on the latest
          run.
        </div>
      )}
      {tab === "cases" && (
        <>
          <div className="filter-toolbar">
            <div className="chips">
              {[
                ["all", "All cases"],
                ["passed", "Passed"],
                ["issues_found", "Issues"],
                ["blocked", "Blocked"],
                ["not_run", "Not run"],
              ].map(([v, label]) => (
                <button
                  key={v}
                  className={filter === v ? "active" : ""}
                  onClick={() => setFilter(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="toolbar-right">
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder="Search cases..."
              />
              {session.status === "ready" && (
                <button className="btn compact" onClick={onAddCase}>
                  <Plus size={16} />
                  Add case
                </button>
              )}
            </div>
          </div>
          <div className="case-list">
            {visible.map((c, i) => (
              <div className="case-row" key={c.id}>
                <span className="case-index">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <button className="case-title" onClick={() => onCase(c)}>
                  <strong>{c.name}</strong>
                  <span>{c.result?.summary || c.acceptance}</span>
                </button>
                <Status value={c.status} />
                <span className="case-duration">
                  {c.durationMs != null
                    ? `${(c.durationMs / 1000).toFixed(1)}s`
                    : "—"}
                </span>
                {session.status === "ready" ? (
                  <button
                    className="icon-btn"
                    aria-label={`Remove ${c.name}`}
                    onClick={() => onRemoveCase(c.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                ) : (
                  <button
                    className="icon-btn"
                    aria-label={`Open ${c.name}`}
                    onClick={() => onCase(c)}
                  >
                    <ChevronRight size={17} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {!visible.length && (
            <Empty
              icon={<SearchCheck size={28} />}
              title="No matching test cases"
              text="Try another filter or search."
            />
          )}
        </>
      )}
      {tab === "findings" && (
        <>
          <div className="filter-toolbar">
            <div className="chips">
              {[
                ["all", "All findings"],
                ["OPEN", "To review"],
                ["ACCEPTED", "Accepted"],
                ["closed", "Closed"],
              ].map(([v, label]) => (
                <button
                  key={v}
                  className={filter === v ? "active" : ""}
                  onClick={() => setFilter(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search findings..."
            />
          </div>
          {visibleFindings.map((f) => (
            <button
              className="finding-row"
              key={f.id}
              onClick={() => onFinding(f)}
            >
              <div className="finding-icon">
                <Bug size={19} />
              </div>
              <div className="finding-text">
                <strong>{f.name}</strong>
                <p>{f.actual}</p>
                <div className="finding-meta">
                  <span className={`repro-label ${f.reproduction}`}>
                    {f.reproduction === "reproduced" ? (
                      <CheckCircle2 size={13} />
                    ) : (
                      <Clock3 size={13} />
                    )}{" "}
                    {f.reproduction.replaceAll("_", " ")}
                  </span>
                  <span>
                    {f.triage === "OPEN"
                      ? "To review"
                      : f.triage.toLowerCase().replaceAll("_", " ")}
                  </span>
                </div>
              </div>
              <ChevronRight size={18} />
            </button>
          ))}
          {!visibleFindings.length && (
            <Empty
              icon={<Bug size={28} />}
              title={
                session.status === "ready"
                  ? "Findings will appear here"
                  : "No findings in this view"
              }
              text={
                session.status === "ready"
                  ? "Run the planned checks to collect evidence and independently reproduce issues."
                  : "Try another filter, or review the test cases for blocked coverage."
              }
            />
          )}
        </>
      )}
      {tab === "activity" && (
        <>
          <div className="activity-intro">
            <Activity size={17} />
            <span>
              Live events from the planner, browser verifier, reproducer, and
              reviewer.
            </span>
          </div>
          <div className="timeline">
            {session.activity
              .slice()
              .reverse()
              .map((item) => (
                <div className="timeline-event" key={item.id}>
                  <div className={`timeline-dot ${item.role.toLowerCase()}`} />
                  <div>
                    <div className="timeline-heading">
                      <strong>{item.role}</strong>
                      <time>
                        {new Date(item.at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </time>
                    </div>
                    <p>{item.message}</p>
                  </div>
                </div>
              ))}
          </div>
        </>
      )}
      <div className="report-footer">
        <span>
          {session.runId
            ? `Updated ${date(session.updatedAt)}`
            : "Your plan is ready. Run checks to collect real browser evidence."}
        </span>
        <div>
          {session.trace && (
            <a href={session.trace}>
              <Download size={14} />
              Browser trace
            </a>
          )}
          <a href={`/api/sessions/${session.id}/export?format=json`}>
            <Download size={14} />
            JSON report
          </a>
        </div>
      </div>
    </>
  );
}
export function CaseDetail({
  item,
  onClose,
}: {
  item: TestCase;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("overview");
  return (
    <Dialog title="Test case" onClose={onClose} drawer>
      <div className="drawer-body">
        <Status value={item.status} />
        <h2 className="inspector-title">{item.name}</h2>
        <p className="inspector-summary">
          {item.result?.summary || "This case has not been executed yet."}
        </p>
        <div className="tabs inspector-tabs">
          {["overview", "evidence"].map((t) => (
            <button
              className={tab === t ? "active" : ""}
              key={t}
              onClick={() => setTab(t)}
            >
              {t === "overview"
                ? "Overview"
                : `Evidence (${item.evidence.length})`}
            </button>
          ))}
        </div>
        {tab === "overview" ? (
          <>
            <section className="inspector-section">
              <h3>Acceptance criteria</h3>
              <p>{item.acceptance}</p>
            </section>
            <section className="inspector-section">
              <h3>Preconditions</h3>
              <CheckList items={item.preconditions} />
            </section>
            <section className="inspector-section">
              <h3>Steps</h3>
              <ol className="step-list">
                {item.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </section>
            {item.result?.details.length ? (
              <section className="inspector-section">
                <h3>Observed details</h3>
                <ul className="observed-details">
                  {item.result.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            {item.controls.length > 0 && (
              <section className="inspector-section">
                <h3>Control coverage</h3>
                {item.controls.map((c, i) => (
                  <div className="control-row" key={i}>
                    <Status
                      value={
                        c.status === "checked"
                          ? "passed"
                          : c.status === "failed"
                            ? "issues_found"
                            : "blocked"
                      }
                    />
                    <span>{c.name}</span>
                  </div>
                ))}
              </section>
            )}
          </>
        ) : item.evidence.length ? (
          item.evidence.map((e) => (
            <EvidenceImage key={e.id} url={e.url} caption={e.caption} />
          ))
        ) : (
          <Empty
            icon={<SearchCheck size={24} />}
            title="No evidence yet"
            text="A screenshot will be captured when this check runs."
          />
        )}
      </div>
    </Dialog>
  );
}
export function FindingDetail({
  item,
  onClose,
  onTriage,
  busy,
  archived,
}: {
  item: Finding;
  onClose: () => void;
  onTriage: (triage: string, note: string) => void;
  busy: boolean;
  archived: boolean;
}) {
  const [note, setNote] = useState(item.note || "");
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        `${item.name}\nExpected: ${item.expected}\nActual: ${item.actual}\nReproduction: ${item.reproduction}\nSteps:\n${item.reproSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
      );
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Dialog title="Finding details" onClose={onClose} drawer>
      <div className="drawer-body">
        <div className="inspector-badges">
          <span className="finding-type">
            <Bug size={14} />
            Bug
          </span>
          <span className={`repro-label ${item.reproduction}`}>
            <ShieldCheck size={14} />
            {item.reproduction.replaceAll("_", " ")}
          </span>
        </div>
        <h2 className="inspector-title">{item.name}</h2>
        <section className="inspector-section">
          <h3>Expected</h3>
          <p>{item.expected}</p>
        </section>
        <section className="inspector-section">
          <h3>Actual</h3>
          <p>{item.actual}</p>
          {item.details.length > 0 && (
            <ul className="observed-details">
              {item.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </section>
        <section className="inspector-section">
          <h3>Independent reproduction</h3>
          <p>
            {item.reproductionResult?.summary ||
              "Waiting for the independent check."}
          </p>
          <small>
            A fresh browser context re-executes the same check. Source-code
            diagnosis is not available.
          </small>
        </section>
        <section className="inspector-section">
          <h3>Reproduction steps</h3>
          <ol className="step-list">
            {item.reproSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <button className="btn compact" onClick={() => void copy()}>
            <Copy size={14} />
            {copied ? "Copied" : "Copy bug report"}
          </button>
        </section>
        <section className="inspector-section">
          <h3>Evidence</h3>
          {item.evidence.map((e) => (
            <EvidenceImage key={e.id} url={e.url} caption={e.caption} />
          ))}
        </section>
        <section className="triage-section">
          <h3>Review finding</h3>
          <p className="small muted">
            Current status:{" "}
            {item.triage === "OPEN"
              ? "To review"
              : item.triage.toLowerCase().replaceAll("_", " ")}
          </p>
          {archived ? (
            <p>This preserved run is read-only.</p>
          ) : (
            <>
              <label>
                Review note
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add context for your team"
                  maxLength={1000}
                />
              </label>
              <div className="triage-actions">
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => onTriage("ACCEPTED", note)}
                >
                  <CheckCircle2 size={15} />
                  Accept bug
                </button>
                <select
                  aria-label="Other review decision"
                  disabled={busy}
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) onTriage(e.target.value, note);
                    e.target.value = "";
                  }}
                >
                  <option value="" disabled>
                    Other decision…
                  </option>
                  <option value="WORKS_AS_INTENDED">Works as intended</option>
                  <option value="DUPLICATE">Duplicate</option>
                  <option value="CANNOT_REPRODUCE">Cannot reproduce</option>
                  <option value="OPEN">Reopen for review</option>
                </select>
              </div>
            </>
          )}
        </section>
      </div>
    </Dialog>
  );
}
