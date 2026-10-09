import { useState } from "react";
import {
  Plus,
  Compass,
  ArrowUpRight,
  ArrowRight,
  PanelsTopLeft,
  Trash2,
} from "lucide-react";
import type { Session } from "../types";
import { date } from "../api";
import { Empty, ResultBar, SearchBox, Status } from "./ui";
export function SessionList({
  sessions,
  onNew,
  onOpen,
  onDelete,
}: {
  sessions: Session[];
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (s: Session) => void;
}) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const visible = sessions.filter(
    (s) =>
      (filter === "all" ||
        (filter === "completed" && s.status === "completed") ||
        (filter === "progress" &&
          ["ready", "running", "cancelling"].includes(s.status))) &&
      `${s.name} ${s.environmentName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="sessions-page">
      <div className="page-heading">
        <div>
          <h1>Sessions</h1>
          <p>Explore, verify, and turn findings into regression tests.</p>
        </div>
        <button className="btn primary" onClick={onNew}>
          <Plus size={19} />
          New session
        </button>
      </div>
      <div className="intro-banner">
        <div className="compass-icon">
          <Compass size={30} strokeWidth={1.6} />
        </div>
        <div>
          <h3>Start with a question. Leave with evidence.</h3>
          <p>
            Plan cases, run browser checks, reproduce issues, and review the
            results.
          </p>
        </div>
        <button className="btn outline-purple" onClick={onNew}>
          Start a session
        </button>
      </div>
      <div className="list-toolbar">
        <div className="tabs" role="tablist" aria-label="Session status">
          {[
            ["all", "All sessions"],
            ["completed", "Completed"],
            ["progress", "In progress"],
          ].map(([id, title]) => (
            <button
              role="tab"
              aria-selected={filter === id}
              className={filter === id ? "active" : ""}
              onClick={() => setFilter(id)}
              key={id}
            >
              {title}
            </button>
          ))}
        </div>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search sessions..."
        />
      </div>
      {!visible.length ? (
        <Empty
          icon={<PanelsTopLeft size={28} />}
          title={search ? "No matching sessions" : "No sessions here yet"}
          text={
            search
              ? "Try a different name or environment."
              : "Start a session to plan checks and collect evidence."
          }
          action={
            !search && (
              <button className="btn primary" onClick={onNew}>
                New session
                <Plus size={16} />
              </button>
            )
          }
        />
      ) : (
        <div className="table-scroll">
          <table className="session-table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Environment</th>
                <th>Results</th>
                <th>Updated</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.id}>
                  <td>
                    <button
                      className="session-name"
                      onClick={() => onOpen(s.id)}
                    >
                      {s.name}
                      <ArrowRight size={16} />
                    </button>
                    <div className="row-sub">
                      {s.mode === "accessibility"
                        ? "Accessibility audit"
                        : s.mode === "navigation"
                          ? "Navigation audit"
                          : "Read-only browser audit"}
                      {["running", "cancelling"].includes(s.status) && (
                        <Status value={s.status} />
                      )}
                    </div>
                  </td>
                  <td>{s.environmentName}</td>
                  <td>
                    <ResultBar cases={s.cases} />
                  </td>
                  <td className="date-cell">{date(s.updatedAt)}</td>
                  <td>
                    <button
                      className="icon-btn row-delete"
                      aria-label={`Delete ${s.name}`}
                      disabled={["running", "cancelling"].includes(s.status)}
                      onClick={() => onDelete(s)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="list-count">
        {visible.length} {visible.length === 1 ? "session" : "sessions"}
      </p>
    </div>
  );
}
