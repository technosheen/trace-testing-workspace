import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import { request } from "../api";
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="sign-in">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await request("/auth/login", "POST", { password });
            setPassword("");
            onSignedIn();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="sign-in-icon">
          <LockKeyhole size={25} />
        </div>
        <h1>Welcome to Trace</h1>
        <p>Sign in to your testing workspace.</p>
        <label htmlFor="workspace-password">Workspace password</label>
        <input
          id="workspace-password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && (
          <p role="alert" className="sign-in-error">
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
