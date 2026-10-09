import { useCallback, useEffect, useState } from "react";
import type { Workspace } from "./types";
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (response.status === 401 && !path.startsWith("/auth/"))
    window.dispatchEvent(new Event("trace:unauthorized"));
  if (!response.ok)
    throw new Error(result.error || "The request could not be completed.");
  return result;
}
export function useWorkspace() {
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setData(await request<Workspace>("/workspace"));
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => clearInterval(timer);
  }, [refresh]);
  return { data, error, refresh };
}
export function counts(cases: { status: string }[]) {
  return {
    passed: cases.filter((c) => c.status === "passed").length,
    issues: cases.filter((c) => c.status === "issues_found").length,
    blocked: cases.filter((c) => c.status === "blocked").length,
    pending: cases.filter((c) => ["not_run", "running"].includes(c.status))
      .length,
  };
}
export function date(value?: string) {
  if (!value) return "Not run yet";
  const d = new Date(value);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? `Today, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
