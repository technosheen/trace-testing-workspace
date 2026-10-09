import type { ReactNode } from "react";
import {
  PanelsTopLeft,
  CalendarDays,
  BookOpen,
  Box,
  FileText,
  Settings,
  Copy,
  ChevronDown,
  ChevronRight,
  Laptop,
  Menu,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
export const navigation = [
  { id: "sessions", name: "Sessions", icon: PanelsTopLeft },
  { id: "schedules", name: "Schedules", icon: CalendarDays },
  { id: "library", name: "Test library", icon: FileText },
  { id: "environments", name: "Environments", icon: Box },
  { id: "knowledge", name: "Knowledge base", icon: BookOpen },
];
export function Shell({
  page,
  title,
  go,
  connected,
  children,
}: {
  page: string;
  title: string;
  go: (v: string) => void;
  connected: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width:780px)").matches,
  );
  useEffect(() => {
    const q = matchMedia("(max-width:780px)");
    const update = () => {
      setMobile(q.matches);
      setOpen(false);
    };
    q.addEventListener("change", update);
    return () => q.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  function navigate(v: string) {
    go(v);
    setOpen(false);
  }
  return (
    <div className="app-shell">
      {open && <div className="nav-shade" onClick={() => setOpen(false)} />}
      <aside
        inert={mobile && !open}
        className={`sidebar ${open ? "open" : ""}`}
      >
        <a
          className="brand"
          href="#/sessions"
          onClick={() => navigate("sessions")}
        >
          <Copy size={31} strokeWidth={1.7} />
          <span>Trace</span>
        </a>
        <button
          className="workspace-picker"
          onClick={() => navigate("settings")}
        >
          Personal workspace
          <ChevronDown size={15} />
        </button>
        <nav aria-label="Main navigation">
          {navigation.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "selected" : ""}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={21} strokeWidth={1.65} />
              {n.name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="service-link" onClick={() => navigate("settings")}>
            <span className={`service-dot ${connected ? "" : "offline"}`} />
            {connected ? "Local service running" : "Service disconnected"}
            <ChevronRight size={15} />
          </button>
          <button
            className={page === "settings" ? "selected" : ""}
            onClick={() => navigate("settings")}
          >
            <Settings size={22} strokeWidth={1.65} />
            Settings
          </button>
        </div>
        <button
          className="mobile-close icon-btn"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
        >
          <X size={20} />
        </button>
      </aside>
      <div inert={mobile && open} className="main-shell">
        <header className="topbar">
          <button
            className="mobile-menu icon-btn"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            <span>Workspace</span>
            <span className="slash">/</span>
            <span>{title}</span>
          </div>
          <button
            aria-label="Workspace settings"
            className="local-badge"
            onClick={() => navigate("settings")}
          >
            <Laptop size={19} />
            <span>Local workspace</span>
            <ChevronDown size={14} />
          </button>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
