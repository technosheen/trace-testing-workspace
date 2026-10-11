import { useState } from "react";
import { ArrowLeft, Play, Download, Square, Plus, SearchCheck, Bug, CheckCircle2, ArrowUpRight, Clock3, FileText, Activity, History, ShieldCheck, Trash2, Copy, ChevronRight, Circle, AlertCircle } from "lucide-react";
import type { Finding, Session, TestCase } from "../types";
import { counts, date } from "../api";
import { Dialog, Empty, EvidenceImage, SearchBox, Status, CheckList } from "./ui";
import "./newSessionReference.css";
import {AgentTeamPanel} from "./AgentTeamPanel";
export function SessionDetail({ session, onBack, onRun, onCancel, onCase, onFinding, onAddCase, onRemoveCase, onEdit, onDuplicate, initialRun }: {
  session: Session; initialRun?: string; onEdit: () => void; onDuplicate: () => void; onBack: () => void; onRun: () => void; onCancel: () => void; onCase: (c: TestCase) => void; onFinding: (f: Finding) => void; onAddCase: () => void; onRemoveCase: (id: string) => void;
}) {
  const [tab, setTab] = useState(initialRun ? "history" : "cases");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [run, setRun] = useState(initialRun || "latest");
  const [menu, setMenu] = useState(false);
  const archived = session.history.find(r => r.runId === run);
  const cases = archived?.cases || session.cases;
  const findings = archived?.findings || session.findings;
  const n = counts(cases);
  const notRun = cases.filter(c => c.status === "not_run").length;
  const active = ["running", "cancelling"].includes(session.status);
  const visible = cases.filter(c => (filter === "all" || c.status === filter) && c.name.toLowerCase().includes(search.toLowerCase()));
  const visibleFindings = findings.filter(f => (filter === "all" || (filter === "OPEN" && f.triage === "OPEN") || (filter === "ACCEPTED" && f.triage === "ACCEPTED") || (filter === "closed" && !["OPEN", "ACCEPTED"].includes(f.triage))) && f.name.toLowerCase().includes(search.toLowerCase()));
  function changeTab(value: string) { setTab(value); setFilter("all"); setSearch(""); }
  const events = session.activity.slice().reverse();
  return <section className="reference-session">
    <header className="reference-session-header">
      <button className="icon-btn reference-back" aria-label="All sessions" onClick={onBack}><ArrowLeft size={16}/></button>
      <FileText size={16} className="reference-session-mark"/><h1 title={session.name}>{session.name}</h1>
      <span className="reference-verified">{n.passed}/{cases.length} passed</span>
      {active ? <button className="btn compact" disabled={session.status === "cancelling"} onClick={onCancel}><Square size={13}/>{session.status === "cancelling" ? "Stopping…" : "Stop"}</button> : <button className="btn compact" onClick={onRun}><Play size={13}/>{session.team?.state === "planned" ? "Start team" : session.team && ["blocked","interrupted","cancelled"].includes(session.team.state) ? "Retry unfinished work" : session.agent && !session.cases.length ? "Start agent" : session.runId ? "Run again" : "Run checks"}</button>}
      <div className="reference-menu-wrap"><button className="icon-btn" aria-label="Session actions" aria-expanded={menu} onClick={() => setMenu(!menu)}>•••</button>{menu && <div className="reference-session-menu">
        {session.status === "ready" && <button onClick={() => { setMenu(false); onEdit(); }}>Edit tests</button>}
        <button disabled={active} onClick={() => { setMenu(false); onDuplicate(); }}><Copy size={14}/>Duplicate session</button>
        <a href={`/api/sessions/${session.id}/export?format=yaml`}><Download size={14}/>Export tests</a>
        <a href={`/api/sessions/${session.id}/export?format=json`}><Download size={14}/>JSON report</a>
      </div>}</div>
    </header>
    <div className="reference-session-split">
      <div className="reference-conversation">
        <div className="reference-conversation-scroll">
          <div className="reference-session-context"><span>{session.environmentName}</span><a href={session.environmentId === "demo" ? "/demo" : session.url} target="_blank" rel="noreferrer">{session.url}<ArrowUpRight size={12}/></a><Status value={archived?.status || session.status}/></div>
          {session.brief && <div className="reference-brief"><p>{session.brief}</p></div>}
          {events.length > 0 && <details className="reference-log"><summary><Activity size={14}/>{events.length} activity events <span>{date(session.updatedAt)}</span></summary><div>{events.slice(0,12).map(item => <div className="reference-log-event" key={item.id}><strong>{item.role}</strong><time>{new Date(item.at).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}</time><p>{item.message}</p></div>)}</div></details>}
          {session.team && <AgentTeamPanel team={session.team}/>}
          {session.agent && !session.team && <div className="reference-ai-summary" role="status"><strong>Browser agent · {session.agent.state}</strong><p>{session.agent.summary}</p><p>{session.agent.decisions} / 8 decisions · Read-only exploration</p>{session.agent.steps.map(step => <p key={step.index}>{step.index}. {step.summary} · {step.status}</p>)}{session.agent.evidence.map(item => <a key={item.id} href={item.url} target="_blank" rel="noreferrer">Screenshot · {item.caption}<br/></a>)}{session.agent.trace && <a href={session.agent.trace}>Download agent browser trace</a>}</div>}
          {session.generation && <div className="reference-ai-summary"><p>{session.generation.summary}</p><details><summary>Draft limitations · {session.generation.provider}</summary><ul>{session.generation.limitations.map((text,i) => <li key={i}>{text}</li>)}</ul></details></div>}
          {!session.generation && !session.agent && !session.team && <p className="reference-plan-summary">{cases.length} test cases in this session. {session.runId ? `${n.passed} passed, ${n.issues} issues found, and ${n.blocked} blocked.` : "Review the preconditions, steps, and acceptance criteria before running. No checks have run yet."}</p>}
          <div className="reference-status-card"><header>Session status<button onClick={() => changeTab("cases")}>View test cases <ArrowUpRight size={12}/></button></header><div className="reference-status-grid"><div><span>Passed cases</span><strong>{n.passed}</strong></div><div><span>Issues found</span><strong>{n.issues}</strong></div><div><span>Not run / blocked</span><strong>{notRun + n.blocked}</strong></div></div><button className="reference-bug-total" onClick={() => changeTab("findings")}><span>Bugs <ArrowUpRight size={12}/></span><strong>{findings.length}</strong></button></div>
          <div className="reference-execution-policy"><ShieldCheck size={14}/>Read-only browser checks · No form submissions</div>
          {session.trace && <a className="reference-trace-link" href={session.trace}><Download size={14}/>Download browser trace</a>}
          <p className="reference-updated">Updated {date(session.updatedAt)}</p>
        </div>
        <div className="reference-session-bottom"><span>{session.agent && !cases.length ? (active ? "Agent exploration is running. Recorded steps appear as they complete." : "Start the agent to discover a replayable test from the live page.") : active ? "Browser checks are running. Results appear as each check completes." : session.status === "ready" ? "Your test plan is ready to review and run." : "Review the results or start another run."}</span><div>{session.status === "ready" && <button className="btn compact" onClick={onEdit}>Edit tests</button>}<a className="btn compact" href={`/api/sessions/${session.id}/export?format=yaml`}><Download size={14}/>Export</a></div></div>
      </div>
      <div className="reference-results">
        <div className="reference-result-tabs" role="tablist" aria-label="Session views">{[["activity","Activity",session.activity.length,Activity],["cases","Test cases",cases.length,SearchCheck],["findings","Bugs",findings.length,Bug],["history","History",session.history.length,History]].map(([id,label,total,Icon]) => { const I = Icon as typeof Activity; return <button key={String(id)} role="tab" aria-selected={tab===id} className={tab===id?"active":""} onClick={() => changeTab(String(id))}><I size={14}/>{String(label)}<span>{String(total)}</span></button>; })}</div>
        {archived && <div className="reference-archived">Viewing a preserved run. <button onClick={() => setRun("latest")}>Return to latest</button></div>}
        <div className="reference-result-body">
          {tab === "cases" && <>
            <SearchBox value={search} onChange={setSearch} placeholder="Search test cases..."/>
            <div className="reference-outcome-filters">{[["all","All outcomes",cases.length],["running","Running",cases.filter(c=>c.status==="running").length],["issues_found","Issues",n.issues],["blocked","Blocked",n.blocked],["passed","Passed",n.passed],["not_run","Not run",notRun]].map(([value,label,total]) => <button key={String(value)} className={filter===value?"active":""} onClick={() => setFilter(String(value))}>{String(label)}<span>{total}</span></button>)}</div>
            <div className="reference-showing">Showing {visible.length} of {cases.length} test cases{session.status === "ready" && !archived && <button onClick={onAddCase}><Plus size={13}/>Add case</button>}</div>
            <div className="reference-case-list">{visible.map(c => <div className="reference-case-row" key={c.id}><button className="reference-case-main" onClick={() => onCase(c)}><span className={`reference-case-symbol ${c.status}`}>{c.status === "passed" ? <CheckCircle2 size={15}/> : c.status === "issues_found" ? <AlertCircle size={15}/> : <Circle size={15}/>}</span><div><strong>{c.name}</strong><p>{c.result?.summary || c.acceptance}</p></div></button>{session.status === "ready" && !archived && <button className="icon-btn reference-remove" aria-label={`Remove ${c.name}`} onClick={() => onRemoveCase(c.id)}><Trash2 size={13}/></button>}</div>)}</div>
            {!visible.length && <Empty icon={<SearchCheck size={24}/>} title="No matching test cases" text="Try another filter or search."/>}
          </>}
          {tab === "findings" && <><SearchBox value={search} onChange={setSearch} placeholder="Search bugs..."/><div className="reference-outcome-filters">{[["all","All bugs"],["OPEN","To review"],["ACCEPTED","Accepted"],["closed","Closed"]].map(([value,label]) => <button key={value} className={filter===value?"active":""} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="reference-case-list">{visibleFindings.map(f => <button className="reference-finding-row" key={f.id} onClick={() => onFinding(f)}><Bug size={16}/><div><strong>{f.name}</strong><p>{f.actual}</p><small>{f.reproduction.replaceAll("_"," ")} · {f.triage.toLowerCase().replaceAll("_"," ")}</small></div><ChevronRight size={14}/></button>)}</div>{!visibleFindings.length && <Empty icon={<Bug size={24}/>} title="No bugs in this view" text={session.runId ? "Review test cases for blocked coverage." : "Run checks to collect browser evidence."}/>}</>}
          {tab === "activity" && <><p className="reference-panel-intro">Actual planner, browser verifier, and reviewer events.</p>{events.map(item => <div className="reference-activity-event" key={item.id}><Activity size={14}/><div><header><strong>{item.role}</strong><time>{date(item.at)}</time></header><p>{item.message}</p></div></div>)}{!events.length && <Empty icon={<Activity size={24}/>} title="No activity yet" text="Events will appear when checks run."/>}</>}
          {tab === "history" && <><p className="reference-panel-intro">Review results preserved from previous runs.</p><button className={`reference-history-row ${run === "latest" ? "selected" : ""}`} onClick={() => setRun("latest")}><History size={16}/><div><strong>Latest run</strong><span>{date(session.updatedAt)}</span></div><Status value={session.status}/></button>{session.history.slice().reverse().map((r,i) => <button key={r.runId} className={`reference-history-row ${run===r.runId?"selected":""}`} onClick={() => {setRun(r.runId); changeTab("cases");}}><History size={16}/><div><strong>Previous run {session.history.length-i}</strong><span>{date(r.at)} · {r.cases.length} cases</span></div><Status value={r.status}/></button>)}{!session.history.length && <p className="reference-panel-intro">Previous runs will appear after this session is rerun.</p>}</>}
        </div>
      </div>
    </div>
  </section>;
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
            {item.result?.stepResults && <section className="inspector-section"><h3>Step results</h3>{item.result.stepResults.map((step) => <div className="control-row" key={step.index}><Status value={step.status} /><div><strong>{step.index}. {step.action}</strong><p>{step.summary}</p>{step.durationMs !== undefined && <small>{step.durationMs} ms</small>}</div></div>)}</section>}
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
            e.kind === "trace" ? (
              <a key={e.id} className="btn" href={e.url} download>
                Download journey trace
              </a>
            ) : <EvidenceImage key={e.id} url={e.url} caption={e.caption} />
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
