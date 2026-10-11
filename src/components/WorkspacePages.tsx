import { useState, type ReactNode } from "react";
import {
  Plus,
  Box,
  ArrowUpRight,
  Pencil,
  Trash2,
  BookOpen,
  CalendarDays,
  Play,
  Pause,
  Upload,
  FileText,
  ChevronRight,
  ShieldCheck,
  Laptop,
  ExternalLink,
  MoreHorizontal,
} from "lucide-react";
import type {
  Environment,
  Knowledge,
  Schedule,
  Session,
  Workspace,
} from "../types";
import { date } from "../api";
import { Dialog, Empty, SearchBox, Status } from "./ui";
import { modes } from "./Forms";
import "./ReferencePages.css";
export function PageHeading({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
export function Environments({
  items,
  onAdd,
  onEdit,
  onDelete,
  onTest,
}: {
  items: Environment[];
  onAdd: () => void;
  onEdit: (e: Environment) => void;
  onDelete: (e: Environment) => void;
  onTest: () => void;
}) {
  return (
    <div className="reference-pages reference-environments">
      <header className="reference-page-header"><h1>Environments</h1><button className="btn primary" onClick={onAdd}><Plus size={16}/>Create environment</button></header>
      <div className="reference-table-wrap"><table className="reference-table"><thead><tr><th>Name</th><th>Base URL</th><th aria-label="Actions"/></tr></thead><tbody>{items.map(env => <tr key={env.id}>
        <td><button className="reference-cell-link" onClick={() => env.id === "demo" ? onTest() : onEdit(env)}>{env.name}</button></td>
        <td><a href={env.id === "demo" ? "/demo" : env.url} target="_blank" rel="noreferrer">{env.url}</a></td>
        <td className="reference-row-actions"><details><summary aria-label={`Actions for ${env.name}`}><MoreHorizontal size={17}/></summary><div className="reference-row-menu">{env.id === "demo" ? <button onClick={onTest}><Play size={14}/>Start a session</button> : <><button onClick={() => onEdit(env)}><Pencil size={14}/>Edit environment</button><button onClick={() => onDelete(env)}><Trash2 size={14}/>Delete environment</button></>}</div></details></td>
      </tr>)}</tbody></table>{!items.length && <p className="reference-table-empty">No environments yet. Create one to start testing.</p>}</div>
    </div>
  );
}

export function KnowledgeBase({
  items,
  onAdd,
  onDelete,
}: {
  items: Knowledge[];
  onAdd: (body: unknown) => void;
  onDelete: (item: Knowledge) => void;
}) {
  const [newNote, setNewNote] = useState(false);
  const [selected, setSelected] = useState<Knowledge | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  return (
    <>
      <PageHeading
        title="Knowledge base"
        text="Keep product context and review guidance close to your tests."
        action={
          <button className="btn primary" onClick={() => setNewNote(true)}>
            <Plus size={17} />
            Add note
          </button>
        }
      />
      {!items.length ? (
        <Empty
          icon={<BookOpen size={28} />}
          title="A shared understanding starts here"
          text="Save product behavior, known limitations, and review guidance. Notes help during triage and can be included when you generate an AI test plan."
          action={
            <button className="btn" onClick={() => setNewNote(true)}>
              <Plus size={16} />
              Add your first note
            </button>
          }
        />
      ) : (
        <div className="knowledge-list">
          {items.map((k) => (
            <article key={k.id}>
              <BookOpen size={21} />
              <button onClick={() => setSelected(k)}>
                <h3>{k.title}</h3>
                <p>{k.content.slice(0, 140)}</p>
                <small>{date(k.createdAt)}</small>
              </button>
              <button
                className="icon-btn"
                aria-label={`Delete ${k.title}`}
                onClick={() => onDelete(k)}
              >
                <Trash2 size={16} />
              </button>
            </article>
          ))}
        </div>
      )}
      {newNote && (
        <Dialog title="Add knowledge note" onClose={() => setNewNote(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onAdd({ title, content });
              setNewNote(false);
              setTitle("");
              setContent("");
            }}
          >
            <div className="dialog-body">
              <label>
                Title
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={120}
                  placeholder="Known behavior or product rule"
                />
              </label>
              <label>
                Context
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  required
                  rows={7}
                  maxLength={10000}
                  placeholder="Describe what reviewers should know."
                />
              </label>
            </div>
            <div className="dialog-foot">
              <button
                className="btn"
                type="button"
                onClick={() => setNewNote(false)}
              >
                Cancel
              </button>
              <button className="btn primary">Save note</button>
            </div>
          </form>
        </Dialog>
      )}
      {selected && (
        <Dialog title={selected.title} onClose={() => setSelected(null)}>
          <div className="dialog-body">
            <p className="note-content">{selected.content}</p>
            <small>Added {date(selected.createdAt)}</small>
          </div>
        </Dialog>
      )}
    </>
  );
}
function scheduleLabel(s: Schedule) {
  if (s.scheduleType !== "cron") return `Every ${s.intervalHours} hours`;
  const [minute, hour, day, month, weekday] = (s.cronExpression || "").split(" ");
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && day === "*" && month === "*") {
    const at = `${Number(hour) % 12 || 12}:${minute.padStart(2, "0")} ${Number(hour) < 12 ? "AM" : "PM"}`;
    if (weekday === "*") return `Daily at ${at} · ${s.timeZone}`;
    if (weekday === "1-5") return `Weekdays at ${at} · ${s.timeZone}`;
  }
  return `Calendar schedule · ${s.timeZone}`;
}
export function Schedules({
  sessions, onRun,
  items,
  environments,
  onAdd,
  onToggle,
  onDelete,
  onOpen,
}: {
  sessions: Session[];
  onRun: (s: Schedule) => void;
  items: Schedule[];
  environments: Environment[];
  onAdd: (body: unknown) => void;
  onToggle: (s: Schedule) => void;
  onDelete: (s: Schedule) => void;
  onOpen: (id: string) => void;
}) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [environmentId, setEnvironment] = useState(environments[0]?.id || "");
  const [mode, setMode] = useState("smoke");
  const [hours, setHours] = useState(24);
  const [scheduleType, setScheduleType] = useState("interval");
  const [cronExpression, setCronExpression] = useState("0 9 * * 1-5");
  const [timeZone, setTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [sourceSessionId, setSource] = useState("");
  return (
    <div className="reference-pages reference-schedules">
      <header className="reference-page-header"><h1>Schedules</h1>{items.length > 0 && <button className="btn primary" onClick={() => setShow(true)}><Plus size={16}/>New schedule</button>}</header>
      {!items.length ? <div className="reference-empty"><span className="reference-empty-icon"><CalendarDays size={18}/></span><h2>No schedules yet</h2><p>Start recurring QA sessions without<br/>kicking each one off by hand.</p><button className="btn primary" onClick={() => setShow(true)}><Plus size={16}/>New schedule</button></div> :
      <div className="reference-table-wrap"><table className="reference-table reference-schedule-table"><thead><tr><th>Name</th><th>Schedule</th><th>Next run</th><th>Actions</th></tr></thead><tbody>{items.map(s => <tr key={s.id}>
        <td><strong>{s.name}</strong><small>{environments.find(e => e.id === s.environmentId)?.name}{s.sourceName ? ` · ${s.sourceName}` : ""}</small>{s.lastRunId && <button className="reference-latest-run" onClick={() => onOpen(s.lastRunId!)}>View latest run <ArrowUpRight size={12}/></button>}</td>
        <td>{scheduleLabel(s)}{s.scheduleType === "cron" && <small>{s.cronExpression}</small>}</td>
        <td>{s.enabled ? new Date(s.nextRunAt).toLocaleString([],s.scheduleType === "cron" ? {timeZone:s.timeZone,timeZoneName:"short"} : undefined) : "Paused"}{s.lastError && <small className="inline-error">{s.lastError}</small>}</td>
        <td><div className="reference-schedule-actions"><button className="btn compact" onClick={() => onRun(s)} disabled={sessions.some(x => x.id === s.lastRunId && ["running","cancelling"].includes(x.status))}><Play size={13}/>Run now</button><button className="btn compact" onClick={() => onToggle(s)}>{s.enabled ? <Pause size={13}/> : <Play size={13}/>} {s.enabled ? "Pause" : "Resume"}</button><button className="icon-btn" aria-label={`Delete ${s.name}`} onClick={() => onDelete(s)}><Trash2 size={14}/></button></div></td>
      </tr>)}</tbody></table></div>}
      {show && (
        <Dialog title="New schedule" onClose={() => setShow(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onAdd({ name, environmentId, mode, scheduleType, ...(scheduleType === "cron" ? {cronExpression,timeZone} : {intervalHours:hours}), ...(sourceSessionId ? {sourceSessionId} : {}) });
              setShow(false);
              setName("");
            }}
          >
            <div className="dialog-body">
              <label>
                Name
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Daily website health"
                  maxLength={120}
                />
              </label>
              <label>
                Environment
                <select
                  value={environmentId}
                  onChange={(e) => setEnvironment(e.target.value)}
                >
                  {environments.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>Test suite<select value={sourceSessionId} onChange={e => setSource(e.target.value)}><option value="">Standard checks</option>{sessions.filter(s => !["running", "cancelling"].includes(s.status)).map(s => <option key={s.id} value={s.id}>{s.name} ({s.cases.length} tests)</option>)}</select><small>A schedule saves a copy of these tests. Later edits to the original do not change it.</small></label>
              <div className="form-row">
                <label>
                  Check mode
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    {modes.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>Schedule type<select value={scheduleType} onChange={e => setScheduleType(e.target.value)}><option value="interval">Repeat at intervals</option><option value="cron">Calendar schedule (cron)</option></select></label>
              </div>
              {scheduleType === "interval" ? <label>
                  Repeat
                  <select
                    value={hours}
                    onChange={(e) => setHours(Number(e.target.value))}
                  >
                    <option value={1}>Hourly</option>
                    <option value={6}>Every 6 hours</option>
                    <option value={24}>Daily</option>
                    <option value={168}>Weekly</option>
                  </select>
                </label> : <>
                <label>Cron expression<input required maxLength={200} value={cronExpression} onChange={e => setCronExpression(e.target.value)} placeholder="0 9 * * 1-5"/><small>Minute · hour · day · month · weekday. Example: 0 9 * * 1-5 runs at 9 AM on weekdays. Choose one minute value; runs are at least an hour apart.</small></label>
                <label>Time zone<input required maxLength={100} value={timeZone} onChange={e => setTimeZone(e.target.value)} placeholder="America/New_York"/><small>Use an IANA time zone. Missing daylight-saving times are skipped; repeated hours may run twice.</small></label>
              </>}
            </div>
            <div className="dialog-foot">
              <button
                className="btn"
                type="button"
                onClick={() => setShow(false)}
              >
                Cancel
              </button>
              <button className="btn primary">Create schedule</button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
export function Library({
  sessions,
  onOpen,
  onImport,
}: {
  sessions: Session[];
  onOpen: (id: string) => void;
  onImport: () => void;
}) {
  const [search, setSearch] = useState("");
  const cases = sessions
    .flatMap((s) => s.cases.map((c) => ({ ...c, session: s })))
    .filter((c) =>
      `${c.name} ${c.session.name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  return (
    <>
      <PageHeading
        title="Test library"
        text="Your planned and executed checks, ready to become regression tests."
        action={
          <button className="btn primary" onClick={onImport}>
            <Upload size={17} />
            Import tests
          </button>
        }
      />
      <div className="library-toolbar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search your test library..."
        />
        <span className="small muted">
          {cases.length} checks across {sessions.length} sessions
        </span>
      </div>
      <div className="table-scroll">
        <table className="library-table">
          <thead>
            <tr>
              <th>Test case</th>
              <th>Session</th>
              <th>Last result</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={`${c.session.id}-${c.id}`}>
                <td>
                  <strong>{c.name}</strong>
                  <small>
                    {c.kind === "selector"
                      ? "Element visibility"
                      : c.kind === "text"
                        ? "Text assertion"
                        : "Browser check"}
                  </small>
                </td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => onOpen(c.session.id)}
                  >
                    {c.session.name}
                  </button>
                </td>
                <td>
                  <Status value={c.status} />
                </td>
                <td>
                  <button
                    className="icon-btn"
                    aria-label={`Open session for ${c.name}`}
                    onClick={() => onOpen(c.session.id)}
                  >
                    <ChevronRight size={17} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!cases.length && (
        <Empty
          icon={<FileText size={28} />}
          title="No tests found"
          text="Create a session or import a Trace YAML manifest."
        />
      )}
      <div className="bottom-note">
        <FileText size={18} />
        <div>
          <strong>Tests that travel with your code.</strong>
          <p>
            Export a session as a Trace YAML manifest, commit it to your
            project, then import it against another environment. JSON exports
            include results and evidence.
          </p>
        </div>
      </div>
    </>
  );
}
export function SettingsPage({
  data,
  onGenerate,
}: {
  data: Workspace;
  onGenerate: () => void;
}) {
  return (
    <>
      <PageHeading
        title="Workspace settings"
        text="Your testing workspace, with evidence you can inspect."
      />
      <div className="settings-section">
        <div>
          <Laptop size={24} />
          <h3>Personal workspace</h3>
        </div>
        <dl>
          <dt>Storage</dt>
          <dd>
            {data.service.mode === "hosted"
              ? "Persistent runner storage"
              : "On this computer"}
          </dd>
          <dt>Browser engine</dt>
          <dd>Playwright · Chromium</dd>
          <dt>Execution</dt>
          <dd>Read-only, isolated browser contexts</dd>
          <dt>Concurrent runs</dt>
          <dd>{data.service.activeRuns} active · up to 2</dd>
          <dt>Run limit</dt>
          <dd>3–15 minutes per run · up to 200 tests</dd>
          <dt>AI generation</dt>
          <dd>
            {data.service.ai?.configured
              ? `${data.service.ai.lastSuccessAt ? "Connected" : "Configured · awaiting first draft"} · ${data.service.ai.provider}`
              : "Not connected; standard checks are available"}
          </dd>
          <dt>Scheduled runs</dt>
          <dd>Require this service to be running</dd>
        </dl>
      </div>
      <div className="settings-section">
        <div>
          <ShieldCheck size={24} />
          <h3>What this version verifies</h3>
        </div>
        <p>
          Page responses, titles, main landmarks, headings, image alternatives,
          form labels, uncaught JavaScript errors, up to five internal links,
          mobile overflow, custom text or CSS visibility assertions, and multi-step browser journeys.
        </p>
        <p>
          Failures are checked again in a fresh context. Screenshots and browser
          traces are preserved with the report. It does not sign in, submit
          forms, or diagnose source code.
        </p>
        <a className="btn" href="/demo" target="_blank" rel="noreferrer">
          Open demo website
          <ExternalLink size={15} />
        </a>
      </div>
      {data.service.ai?.configured && (
        <div className="settings-section">
          <div>
            <FileText size={24} />
            <h3>AI test generation</h3>
          </div>
          <p>
            Describe what matters, then review a plan of supported browser
            checks. AI can select checks and add exact phrases from your
            requirements. Requested workflows that the runner cannot perform are
            listed separately.
          </p>
          <dl>
            <dt>Model deployment</dt>
            <dd>{data.service.ai.model}</dd>
            <dt>Authentication</dt>
            <dd>Azure managed identity · no stored API key</dd>
            <dt>Daily limit</dt>
            <dd>{data.service.ai.remainingToday} of 60 drafts remaining</dd>
          </dl>
          <p>
            Your brief is sent to Azure AI. Knowledge notes are included only
            when you select them. Generation does not visit the website or start
            a run.
          </p>
          <button
            className="btn primary"
            onClick={onGenerate}
            disabled={data.service.ai.generating}
          >
            Generate a test plan
          </button>
        </div>
      )}
    </>
  );
}
