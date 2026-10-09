import { useEffect, useRef, type ReactNode } from "react";
import {
  Check,
  CheckCircle2,
  CircleDashed,
  LoaderCircle,
  TriangleAlert,
  X,
  XCircle,
  Search,
  ArrowUpRight,
} from "lucide-react";
import { counts } from "../api";
import type { TestCase } from "../types";
export const statusLabels: Record<string, string> = {
  not_run: "Not run",
  ready: "Planned",
  running: "Running",
  cancelling: "Stopping",
  cancelled: "Cancelled",
  passed: "Passed",
  issues_found: "Issues found",
  blocked: "Blocked",
  completed: "Completed",
  interrupted: "Interrupted",
};
export function Status({ value }: { value: string }) {
  const Icon = ["passed", "completed"].includes(value)
    ? CheckCircle2
    : ["issues_found", "blocked", "interrupted"].includes(value)
      ? TriangleAlert
      : ["running", "cancelling"].includes(value)
        ? LoaderCircle
        : CircleDashed;
  return (
    <span className={`status status-${value}`}>
      <Icon
        size={14}
        className={["running", "cancelling"].includes(value) ? "spin" : ""}
      />
      {statusLabels[value] || value}
    </span>
  );
}
export function ResultBar({ cases }: { cases: TestCase[] }) {
  const n = counts(cases);
  if (n.pending === cases.length)
    return <span className="muted small">{cases.length} cases planned</span>;
  return (
    <div className="result-bar">
      <div
        className="segments"
        aria-label={`${n.passed} passed, ${n.issues} issues, ${n.blocked} blocked, ${n.pending} pending`}
      >
        <i style={{ flex: n.passed, background: "#42b784" }} />
        <i style={{ flex: n.issues, background: "#f4777d" }} />
        <i style={{ flex: n.blocked, background: "#deb263" }} />
        <i style={{ flex: n.pending, background: "#e7e9ef" }} />
      </div>
      <span>
        {n.passed} passed{" "}
        <span className="muted">
          {n.issues
            ? `${n.issues} issues`
            : n.blocked
              ? `${n.blocked} blocked`
              : n.pending
                ? `${n.pending} pending`
                : "0 issues"}
        </span>
      </span>
    </div>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search">
      <Search size={17} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange("")}>
          <X size={14} />
        </button>
      )}
    </label>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
  drawer = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current
      ?.querySelector<HTMLElement>("input,select,textarea,button")
      ?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const elements = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "button:not([disabled]),input,select,textarea,a[href]",
          ) || [],
        );
        const first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = previousOverflow;
      prior?.focus();
    };
  }, []);
  return (
    <div
      className={`overlay ${drawer ? "drawer-overlay" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`dialog ${wide ? "wide" : ""} ${drawer ? "drawer" : ""}`}
      >
        <div className="dialog-head">
          <h2>{title}</h2>
          <button
            className="icon-btn"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function EvidenceImage({
  url,
  caption,
}: {
  url: string;
  caption: string;
}) {
  return (
    <a className="evidence" href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={caption} />
      <span>
        {caption}
        <ArrowUpRight size={14} />
      </span>
    </a>
  );
}
export function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="check-list">
      {items.map((item, i) => (
        <li key={i}>
          <Check size={14} />
          {item}
        </li>
      ))}
    </ul>
  );
}
export function Toast({
  message,
  error,
  onClose,
}: {
  message: string;
  error: boolean;
  onClose: () => void;
}) {
  return (
    <div className={`toast ${error ? "error" : ""}`} role="status">
      {error ? <XCircle size={18} /> : <CheckCircle2 size={18} />}
      <span>{message}</span>
      <button onClick={onClose} aria-label="Dismiss notification">
        <X size={16} />
      </button>
    </div>
  );
}
