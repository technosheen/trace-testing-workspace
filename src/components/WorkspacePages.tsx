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
    <>
      <PageHeading
        title="Environments"
        text="The websites your browser checks run against."
        action={
          <button className="btn primary" onClick={onAdd}>
            <Plus size={17} />
            Add environment
          </button>
        }
      />
      <div className="environment-list">
        {items.map((env) => (
          <article className="environment-row" key={env.id}>
            <div className="environment-icon">
              <Box size={25} strokeWidth={1.5} />
            </div>
            <div className="environment-info">
              <h3>
                {env.name}
                {env.id === "demo" && (
                  <span className="soft-label">Built-in demo</span>
                )}
              </h3>
              <a
                href={env.id === "demo" ? "/demo" : env.url}
                target="_blank"
                rel="noreferrer"
              >
                {env.url}
                <ArrowUpRight size={13} />
              </a>
              <p>{env.description || "No description added."}</p>
            </div>
            <div className="env-actions">
              {env.id === "demo" ? (
                <button className="btn compact" onClick={onTest}>
                  Start a session
                </button>
              ) : (
                <>
                  <button
                    className="icon-btn"
                    aria-label={`Edit ${env.name}`}
                    onClick={() => onEdit(env)}
                  >
                    <Pencil size={17} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Delete ${env.name}`}
                    onClick={() => onDelete(env)}
                  >
                    <Trash2 size={17} />
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="bottom-note">
        <ShieldCheck size={18} />
        <div>
          <strong>A fresh browser, every time.</strong>
          <p>
            Runs use isolated contexts without your personal cookies. This
            version checks public pages and the built-in demo.
          </p>
        </div>
      </div>
    </>
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
          text="Save product behavior, known limitations, and review guidance. Notes are available to you during triage; they do not change the browser checks."
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
export function Schedules({
  items,
  environments,
  onAdd,
  onToggle,
  onDelete,
  onOpen,
}: {
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
  return (
    <>
      <PageHeading
        title="Schedules"
        text="Repeat your browser checks on a regular cadence."
        action={
          <button className="btn primary" onClick={() => setShow(true)}>
            <Plus size={17} />
            New schedule
          </button>
        }
      />
      <div className="schedule-note">
        <ClockIcon />
        <p>
          Scheduled checks run while the testing service is on. Missed runs are
          picked up when it restarts.
        </p>
      </div>
      {!items.length ? (
        <Empty
          icon={<CalendarDays size={28} />}
          title="Keep an eye on the essentials"
          text="Schedule a daily smoke test or a recurring navigation and accessibility check."
          action={
            <button className="btn" onClick={() => setShow(true)}>
              Create schedule
            </button>
          }
        />
      ) : (
        <div className="schedule-list">
          {items.map((s) => (
            <article key={s.id}>
              <CalendarDays size={24} />
              <div>
                <h3>{s.name}</h3>
                <p>
                  {environments.find((e) => e.id === s.environmentId)?.name} ·
                  Every {s.intervalHours} hours
                </p>
                <small>
                  {s.enabled
                    ? `Next run: ${new Date(s.nextRunAt).toLocaleString()}`
                    : "Paused"}
                  {s.lastError && (
                    <span className="inline-error"> · {s.lastError}</span>
                  )}
                </small>
                {s.lastRunId && (
                  <button
                    className="text-button"
                    onClick={() => onOpen(s.lastRunId!)}
                  >
                    View latest run
                    <ArrowUpRight size={13} />
                  </button>
                )}
              </div>
              <button
                className={`btn compact ${s.enabled ? "" : "muted"}`}
                onClick={() => onToggle(s)}
              >
                {s.enabled ? <Pause size={14} /> : <Play size={14} />}{" "}
                {s.enabled ? "Pause" : "Resume"}
              </button>
              <button
                className="icon-btn"
                aria-label={`Delete ${s.name}`}
                onClick={() => onDelete(s)}
              >
                <Trash2 size={16} />
              </button>
            </article>
          ))}
        </div>
      )}
      {show && (
        <Dialog title="New schedule" onClose={() => setShow(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onAdd({ name, environmentId, mode, intervalHours: hours });
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
                <label>
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
                </label>
              </div>
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
    </>
  );
}
function ClockIcon() {
  return <CalendarDays size={17} />;
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
export function SettingsPage({ data }: { data: Workspace }) {
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
          <dd>3 minutes per run · up to 25 cases</dd>
          <dt>AI generation</dt>
          <dd>Not connected; check plans use explicit rules</dd>
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
          mobile overflow, and your custom text or CSS visibility assertions.
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
    </>
  );
}
