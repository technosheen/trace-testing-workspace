import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Compass,
  ScanEye,
  Waypoints,
  Box,
  Upload,
} from "lucide-react";
import type { Environment } from "../types";
import { Dialog } from "./ui";
export const modes = [
  {
    id: "smoke",
    title: "Smoke test",
    text: "Page health, navigation, accessibility, and mobile layout.",
    icon: Compass,
  },
  {
    id: "accessibility",
    title: "Accessibility",
    text: "Landmarks, headings, image alternatives, and form labels.",
    icon: ScanEye,
  },
  {
    id: "navigation",
    title: "Navigation",
    text: "Page response, title, internal links, and JavaScript errors.",
    icon: Waypoints,
  },
];
export function NewSession({
  environments,
  onClose,
  onSubmit,
  busy,
}: {
  environments: Environment[];
  onClose: () => void;
  onSubmit: (body: unknown) => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState("smoke");
  const [name, setName] = useState("");
  const [environmentId, setEnvironment] = useState(environments[0]?.id || "");
  const [brief, setBrief] = useState("");
  const [expectedText, setExpectedText] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      name:
        name.trim() ||
        `${modes.find((m) => m.id === mode)?.title} · ${environments.find((e) => e.id === environmentId)?.name}`,
      environmentId,
      mode,
      brief,
      expectedText,
    });
  }
  return (
    <Dialog title="New session" onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="dialog-body">
          <p className="form-intro">What would you like to verify?</p>
          <div className="mode-grid">
            {modes.map((m) => (
              <button
                type="button"
                key={m.id}
                className={`mode-option ${mode === m.id ? "chosen" : ""}`}
                onClick={() => setMode(m.id)}
              >
                <m.icon size={23} />
                <strong>{m.title}</strong>
                <span>{m.text}</span>
              </button>
            ))}
          </div>
          <div className="form-row">
            <label>
              Session name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Homepage release check"
                maxLength={120}
              />
            </label>
            <label>
              Environment
              <select
                required
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
          </div>
          <label>
            Testing brief <span className="optional">optional</span>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Describe the scope and what matters to your team."
              rows={3}
              maxLength={3000}
            />
            <small>
              The brief stays with your report. The selected mode determines the
              automated checks.
            </small>
          </label>
          <label>
            Expected visible text <span className="optional">optional</span>
            <input
              value={expectedText}
              onChange={(e) => setExpectedText(e.target.value)}
              placeholder="Add a check for an exact phrase"
              maxLength={200}
            />
          </label>
          <div className="form-note">
            <Box size={16} />
            <span>
              Isolated browser. Read-only checks. No signed-in cookies or form
              submissions.
            </span>
          </div>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !environmentId}>
            {busy ? "Creating…" : "Create test plan"}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function EnvironmentForm({
  initial,
  onClose,
  onSubmit,
  busy,
}: {
  initial?: Environment;
  onClose: () => void;
  onSubmit: (body: unknown) => void;
  busy: boolean;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [url, setUrl] = useState(initial?.url || "");
  const [description, setDescription] = useState(initial?.description || "");
  return (
    <Dialog
      title={initial ? "Edit environment" : "Add environment"}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ name, url, description });
        }}
      >
        <div className="dialog-body">
          <label>
            Name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production website"
              maxLength={80}
            />
          </label>
          <label>
            Website URL
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-website.com"
              maxLength={2000}
            />
            <small>
              Use a public website. The built-in demo is available for local
              testing.
            </small>
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this environment used for?"
              maxLength={1000}
            />
          </label>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "Saving…" : "Save environment"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function CaseForm({
  onClose,
  onSubmit,
  busy,
}: {
  onClose: () => void;
  onSubmit: (body: unknown) => void;
  busy: boolean;
}) {
  const [kind, setKind] = useState("text");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  return (
    <Dialog title="Add test case" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ kind, name, value });
        }}
      >
        <div className="dialog-body">
          <label>
            Case name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Verify the main call to action"
              maxLength={120}
            />
          </label>
          <label>
            Check type
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="text">Visible text contains</option>
              <option value="selector">CSS element is visible</option>
            </select>
          </label>
          <label>
            {kind === "text" ? "Expected text" : "CSS selector"}
            <input
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                kind === "text"
                  ? "Get started"
                  : '[data-testid="primary-action"]'
              }
              maxLength={200}
            />
          </label>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            Add case
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function ImportForm({
  environments,
  onClose,
  onSubmit,
  busy,
}: {
  environments: Environment[];
  onClose: () => void;
  onSubmit: (body: unknown) => void;
  busy: boolean;
}) {
  const [yaml, setYaml] = useState("");
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id || "");
  const [error, setError] = useState("");
  return (
    <Dialog title="Import regression tests" onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ yaml, environmentId });
        }}
      >
        <div className="dialog-body">
          <p className="form-intro">
            Import a Trace YAML manifest to create a new runnable session.
          </p>
          <label className="file-input">
            <Upload size={18} />
            <span>Choose a .yaml file</span>
            <input
              type="file"
              accept=".yaml,.yml"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 50000) {
                  setError("Choose a YAML file smaller than 50 KB.");
                  return;
                }
                setError("");
                setYaml(await file.text());
              }}
            />
          </label>
          {error && <p className="inline-error">{error}</p>}
          <label>
            Manifest
            <textarea
              className="code-input"
              required
              value={yaml}
              onChange={(e) => setYaml(e.target.value)}
              placeholder={
                "schema: trace/test/v1\nname: Homepage checks\nchecks:\n  - kind: title\n    name: Page has a title\n    acceptance: Document title is not empty"
              }
              rows={9}
              maxLength={50000}
            />
          </label>
          <label>
            Run against
            <select
              value={environmentId}
              onChange={(e) => setEnvironmentId(e.target.value)}
            >
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </label>
          <small>
            Trace manifests use their own schema; Momentic YAML is not imported.
          </small>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !yaml.trim()}>
            Import test plan
          </button>
        </div>
      </form>
    </Dialog>
  );
}
