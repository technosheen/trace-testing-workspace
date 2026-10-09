import { useEffect, useState } from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { request, useWorkspace } from "./api";
import type { Environment, Finding, Session, TestCase } from "./types";
import { Shell, navigation } from "./components/Shell";
import { SessionList } from "./components/SessionList";
import {
  SessionDetail,
  CaseDetail,
  FindingDetail,
} from "./components/SessionDetail";
import {
  CaseForm,
  EnvironmentForm,
  ImportForm,
  NewSession,
} from "./components/Forms";
import {
  Environments,
  KnowledgeBase,
  Library,
  Schedules,
  SettingsPage,
} from "./components/WorkspacePages";
import { SignIn } from "./components/SignIn";
import { Dialog, Toast } from "./components/ui";

type Modal =
  | { type: "new" | "env" | "case" | "import"; env?: Environment }
  | { type: "case-detail"; item: TestCase; archived: boolean }
  | { type: "finding-detail"; item: Finding; archived: boolean }
  | {
      type: "confirm";
      title: string;
      text: string;
      action: () => Promise<unknown>;
    };
function readRoute() {
  return location.hash.replace(/^#\/?/, "") || "sessions";
}
function WorkspaceApp({ onSignOut }: { onSignOut?: () => void }) {
  const { data, error, refresh } = useWorkspace();
  const [route, setRoute] = useState(readRoute);
  const [modal, setModal] = useState<Modal | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    const update = () => {
      setRoute(readRoute());
      setModal(null);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 10000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  function go(v: string) {
    location.hash = `/${v}`;
    if (route === v) setModal(null);
  }
  async function act(
    action: () => Promise<unknown>,
    message?: string,
    close = true,
  ) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await action();
      await refresh();
      if (close) setModal(null);
      if (message) setToast({ message, error: false });
      return result;
    } catch (e) {
      setToast({ message: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }
  function confirm(
    title: string,
    text: string,
    action: () => Promise<unknown>,
  ) {
    setModal({ type: "confirm", title, text, action });
  }
  const page = route.split("/")[0];
  const selected = data?.sessions.find((s) => s.id === route.split("/")[1]);
  const title = selected
    ? "Sessions"
    : navigation.find((n) => n.id === page)?.name || "Settings";
  async function create(body: unknown) {
    const result = await act(() => request<Session>("/sessions", "POST", body));
    if (result) go(`sessions/${(result as Session).id}`);
  }
  return (
    <Shell
      page={page}
      title={title}
      go={go}
      connected={Boolean(data) && !error}
      hosted={data?.service.mode === "hosted"}
      onSignOut={onSignOut}
    >
      {error && (
        <div className="connection-error" role="alert">
          <TriangleAlert size={18} />
          <span>Cannot reach the testing service. {error}</span>
          <button onClick={() => void refresh()}>Retry</button>
        </div>
      )}
      {!data ? (
        <div className="loading-state">
          <LoaderCircle className="spin" size={25} />
          <p>Opening your workspace…</p>
        </div>
      ) : (
        <>
          {page === "sessions" &&
            (route.split("/")[1] ? (
              selected ? (
                <SessionDetail
                  session={selected}
                  onBack={() => go("sessions")}
                  onRun={() =>
                    void act(
                      () => request(`/sessions/${selected.id}/run`, "POST"),
                      "Browser run started.",
                    )
                  }
                  onCancel={() =>
                    void act(
                      () => request(`/sessions/${selected.id}/cancel`, "POST"),
                      "Stopping the browser run.",
                    )
                  }
                  onCase={(c) =>
                    setModal({
                      type: "case-detail",
                      item: c,
                      archived: !selected.cases.includes(c),
                    })
                  }
                  onFinding={(f) =>
                    setModal({
                      type: "finding-detail",
                      item: f,
                      archived:
                        !selected.findings.includes(f) ||
                        ["running", "cancelling"].includes(selected.status),
                    })
                  }
                  onAddCase={() => setModal({ type: "case" })}
                  onRemoveCase={(id) =>
                    void act(
                      () =>
                        request(
                          `/sessions/${selected.id}/cases/${id}`,
                          "DELETE",
                        ),
                      "Case removed.",
                    )
                  }
                />
              ) : (
                <div className="empty">
                  <h2>Session not found</h2>
                  <button className="btn" onClick={() => go("sessions")}>
                    Back to sessions
                  </button>
                </div>
              )
            ) : (
              <SessionList
                sessions={data.sessions}
                onNew={() => setModal({ type: "new" })}
                onOpen={(id) => go(`sessions/${id}`)}
                onDelete={(s) =>
                  confirm(
                    "Delete session?",
                    `“${s.name}” and its report will be removed from the workspace.`,
                    () => request(`/sessions/${s.id}`, "DELETE"),
                  )
                }
              />
            ))}
          {page === "environments" && (
            <Environments
              items={data.environments}
              onAdd={() => setModal({ type: "env" })}
              onEdit={(env) => setModal({ type: "env", env })}
              onTest={() => setModal({ type: "new" })}
              onDelete={(env) =>
                confirm(
                  "Delete environment?",
                  `Remove “${env.name}”? Existing session reports keep their original target URL.`,
                  () => request(`/environments/${env.id}`, "DELETE"),
                )
              }
            />
          )}{" "}
          {page === "knowledge" && (
            <KnowledgeBase
              items={data.knowledge}
              onAdd={(body) =>
                void act(
                  () => request("/knowledge", "POST", body),
                  "Knowledge note saved.",
                )
              }
              onDelete={(item) =>
                confirm(
                  "Delete knowledge note?",
                  `Remove “${item.title}” from your workspace?`,
                  () => request(`/knowledge/${item.id}`, "DELETE"),
                )
              }
            />
          )}{" "}
          {page === "schedules" && (
            <Schedules
              items={data.schedules}
              environments={data.environments}
              onAdd={(body) =>
                void act(
                  () => request("/schedules", "POST", body),
                  "Schedule created.",
                )
              }
              onToggle={(s) =>
                void act(
                  () =>
                    request(`/schedules/${s.id}`, "PATCH", {
                      enabled: !s.enabled,
                    }),
                  s.enabled ? "Schedule paused." : "Schedule resumed.",
                )
              }
              onDelete={(s) =>
                confirm(
                  "Delete schedule?",
                  `Remove “${s.name}”? Its previous reports will remain.`,
                  () => request(`/schedules/${s.id}`, "DELETE"),
                )
              }
              onOpen={(id) => go(`sessions/${id}`)}
            />
          )}{" "}
          {page === "library" && (
            <Library
              sessions={data.sessions}
              onOpen={(id) => go(`sessions/${id}`)}
              onImport={() => setModal({ type: "import" })}
            />
          )}{" "}
          {page === "settings" && (
            <SettingsPage
              data={data}
              onGenerate={() => setModal({ type: "new" })}
            />
          )}{" "}
          {modal?.type === "new" && (
            <NewSession
              environments={data.environments}
              aiAvailable={Boolean(data.service.ai?.configured)}
              busy={busy}
              onClose={() => setModal(null)}
              onSubmit={(body) => void create(body)}
            />
          )}{" "}
          {modal?.type === "env" && (
            <EnvironmentForm
              initial={modal.env}
              busy={busy}
              onClose={() => setModal(null)}
              onSubmit={(body) =>
                void act(
                  () =>
                    request(
                      modal.env
                        ? `/environments/${modal.env.id}`
                        : "/environments",
                      modal.env ? "PATCH" : "POST",
                      body,
                    ),
                  "Environment saved.",
                )
              }
            />
          )}{" "}
          {modal?.type === "case" && selected && (
            <CaseForm
              busy={busy}
              onClose={() => setModal(null)}
              onSubmit={(body) =>
                void act(
                  () => request(`/sessions/${selected.id}/cases`, "POST", body),
                  "Test case added.",
                )
              }
            />
          )}{" "}
          {modal?.type === "import" && (
            <ImportForm
              environments={data.environments}
              busy={busy}
              onClose={() => setModal(null)}
              onSubmit={(body) =>
                void (async () => {
                  const result = await act(
                    () => request<Session>("/import", "POST", body),
                    "Regression plan imported.",
                  );
                  if (result) go(`sessions/${(result as Session).id}`);
                })()
              }
            />
          )}{" "}
          {modal?.type === "case-detail" && (
            <CaseDetail
              item={
                !modal.archived && selected
                  ? selected.cases.find((c) => c.id === modal.item.id) ||
                    modal.item
                  : modal.item
              }
              onClose={() => setModal(null)}
            />
          )}{" "}
          {modal?.type === "finding-detail" && selected && (
            <FindingDetail
              item={
                !modal.archived
                  ? selected.findings.find((f) => f.id === modal.item.id) ||
                    modal.item
                  : modal.item
              }
              archived={modal.archived}
              busy={busy}
              onClose={() => setModal(null)}
              onTriage={(triage, note) =>
                void act(
                  () =>
                    request(
                      `/sessions/${selected.id}/findings/${modal.item.id}`,
                      "PATCH",
                      { triage, note },
                    ),
                  "Review decision saved.",
                  false,
                )
              }
            />
          )}
        </>
      )}
      {modal?.type === "confirm" && (
        <Dialog title={modal.title} onClose={() => setModal(null)}>
          <div className="dialog-body">
            <p>{modal.text}</p>
          </div>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => void act(modal.action, "Removed from workspace.")}
            >
              {busy ? "Removing…" : "Delete"}
            </button>
          </div>
        </Dialog>
      )}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </Shell>
  );
}

export default function App() {
  const [auth, setAuth] = useState<{
    authenticated: boolean;
    hosted: boolean;
  } | null>(null);
  const [authError, setAuthError] = useState("");
  async function checkAuth() {
    try {
      setAuth(await request("/auth/session"));
      setAuthError("");
    } catch (e) {
      setAuthError((e as Error).message);
    }
  }
  useEffect(() => {
    void checkAuth();
    const expired = () => setAuth({ authenticated: false, hosted: true });
    window.addEventListener("trace:unauthorized", expired);
    return () => window.removeEventListener("trace:unauthorized", expired);
  }, []);
  if (!auth)
    return (
      <div className="loading-state">
        <LoaderCircle className="spin" />
        <p>{authError || "Opening your workspace…"}</p>
        {authError && (
          <button className="btn" onClick={() => void checkAuth()}>
            Retry
          </button>
        )}
      </div>
    );
  if (!auth.authenticated)
    return <SignIn onSignedIn={() => void checkAuth()} />;
  return (
    <WorkspaceApp
      onSignOut={
        auth.hosted
          ? () => {
              void request("/auth/logout", "POST")
                .then(() => setAuth({ authenticated: false, hosted: true }))
                .catch((e) => setAuthError((e as Error).message));
            }
          : undefined
      }
    />
  );
}
