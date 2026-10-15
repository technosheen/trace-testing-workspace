import { useMemo, useState } from "react";
import { parse, stringify } from "yaml";
import { ArrowDown, ArrowUp, Code2, ListChecks, Plus, Trash2 } from "lucide-react";
import type { Session } from "../types";
import { Dialog, tabKeyDown } from "./ui";
import "./TestEditor.css";

type Step = { action: string; url?: string; value?: string; target?: { selector?: string; role?: string; name?: string } };
type Check = { kind: string; name: string; acceptance: string; value?: string; preconditions?: string[]; actions?: Step[]; [key: string]: unknown };
type Plan = { schema: string; policy: string; name: string; checks: Check[]; [key: string]: unknown };
const actions = ["navigate", "click", "hover", "fill", "select", "assertVisible", "assertText", "assertUrl", "scrollIntoView"];
const roles = ["button", "link", "textbox", "checkbox", "combobox", "heading", "tab"];
const labels: Record<string, string> = { navigate: "Navigate", click: "Click", hover: "Hover", fill: "Fill field", select: "Select option", assertVisible: "Assert visible", assertText: "Assert text", assertUrl: "Assert URL", scrollIntoView: "Scroll into view" };
function initialPlan(session: Session): Plan {
  return { schema: "trace/test/v2", policy: "read-only", name: session.name, checks: session.cases.map(c => ({ kind: c.kind, name: c.name, acceptance: c.acceptance, ...(c.value ? { value: c.value } : {}), ...(c.kind === "journey" ? { preconditions: c.preconditions, actions: (c as typeof c & { actions?: Step[] }).actions || [] } : {}) })) };
}
function readPlan(source: string): { plan?: Plan; error?: string } {
  if (new TextEncoder().encode(source).length > 500000) return { error: "The test plan must be smaller than 500 KB." };
  try {
    const p = parse(source, { maxAliasCount: 100 });
    if (!p || typeof p !== "object" || p.schema !== "trace/test/v2" || p.policy !== "read-only") throw Error("Use schema trace/test/v2 and policy read-only.");
    if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 120) throw Error("Give the plan a name of 1–120 characters.");
    if (!Array.isArray(p.checks) || p.checks.length < 1 || p.checks.length > 200) throw Error("Include between 1 and 200 test cases.");
    for (const [i,c] of p.checks.entries()) {
      if (!c || typeof c !== "object" || typeof c.kind !== "string" || typeof c.name !== "string" || typeof c.acceptance !== "string") throw Error(`Test ${i+1} needs a kind, name, and acceptance criteria.`);
      if (!c.name.trim() || c.name.length > 120 || !c.acceptance.trim()) throw Error(`Test ${i+1} needs a name and acceptance criteria.`);
      if (c.kind === "journey") {
        if (!Array.isArray(c.actions) || !c.actions.length || c.actions.length > 50) throw Error(`Test ${i+1} needs 1–50 steps.`);
        if (!c.actions.some((s: Step) => s && typeof s.action === "string" && s.action.startsWith("assert"))) throw Error(`Test ${i+1} needs at least one assertion.`);
        for (const s of c.actions) {
          if (!s || !actions.includes(s.action)) throw Error(`Test ${i+1} has an unsupported action.`);
          if (s.action === "navigate" && (typeof s.url !== "string" || !s.url.trim())) throw Error(`Test ${i+1}: enter the navigation URL.`);
          if (["fill","select","assertText","assertUrl"].includes(s.action) && (typeof s.value !== "string" || !s.value.trim())) throw Error(`Test ${i+1}: enter the step value.`);
          if (!["navigate","assertUrl"].includes(s.action) && (!s.target || !(s.target.selector?.trim() || (s.target.role && s.target.name?.trim())))) throw Error(`Test ${i+1}: enter a selector or role and name.`);
        }
      }
    }
    return { plan: p as Plan };
  } catch(e) { return { error: e instanceof Error ? e.message : "Invalid YAML." }; }
}
export function TestEditor({ session, onClose, onSave, busy }: { session: Session; onClose: () => void; onSave: (yaml: string) => void; busy: boolean }) {
  const [source,setSource] = useState(() => stringify(initialPlan(session)));
  const [tab,setTab] = useState("plan");
  const [selected,setSelected] = useState(0);
  const parsed = useMemo(() => readPlan(source), [source]);
  // Incomplete fields remain editable in visual mode; validation gates saving.
  const document = useMemo(() => { try { const p = parse(source, { maxAliasCount: 100 }); return p && Array.isArray(p.checks) && p.checks.every((c: Check) => c && typeof c === "object" && typeof c.name === "string" && typeof c.acceptance === "string" && (!c.preconditions || (Array.isArray(c.preconditions) && c.preconditions.every(v => typeof v === "string"))) && (!c.actions || (Array.isArray(c.actions) && c.actions.every(s => s && typeof s.action === "string" && (!s.target || typeof s.target === "object"))))) ? p as Plan : undefined; } catch { return undefined; } },[source]);
  const activeIndex = Math.min(selected, Math.max(0,(document?.checks.length || 1)-1));
  const current = document?.checks[activeIndex];
  function update(change: (p: Plan) => void) { if (!document || busy) return; const p = structuredClone(document); change(p); setSource(stringify(p)); }
  function patchCase(patch: Partial<Check>) { update(p => Object.assign(p.checks[activeIndex],patch)); }
  function stepChange(index: number, patch: Partial<Step>) { patchCase({ actions: current?.actions?.map((s,i) => i === index ? { ...s,...patch } : s) }); }
  function move(index: number,direction: number) { const steps = [...(current?.actions || [])]; [steps[index],steps[index+direction]] = [steps[index+direction],steps[index]]; patchCase({actions:steps}); }
  return <Dialog title="Edit test plan" onClose={busy ? () => {} : onClose} wide>
    <div className="test-editor">
      <div className="te-tabs" role="tablist" aria-label="Editor view">
        <button type="button" role="tab" id="editor-tab-plan" aria-controls="editor-panel-plan" tabIndex={tab === "plan" ? 0 : -1} onKeyDown={tabKeyDown} aria-selected={tab === "plan"} onClick={() => setTab("plan")}><ListChecks size={16}/>Test plan</button>
        <button type="button" role="tab" id="editor-tab-yaml" aria-controls="editor-panel-yaml" tabIndex={tab === "yaml" ? 0 : -1} onKeyDown={tabKeyDown} aria-selected={tab === "yaml"} onClick={() => setTab("yaml")}><Code2 size={16}/>YAML</button>
        <span>{document?.checks.length || 0} tests · Read-only browser</span>
      </div>
      <div role="tabpanel" id={`editor-panel-${tab}`} aria-labelledby={`editor-tab-${tab}`} tabIndex={0}>
      {tab === "yaml" ? <label className="te-yaml">Manifest<textarea spellCheck={false} value={source} disabled={busy} onChange={e => setSource(e.target.value)} maxLength={500000} rows={20}/></label> : document ? <>
        <label className="te-suite-name">Plan name<input value={typeof document.name === "string" ? document.name : ""} maxLength={120} disabled={busy} onChange={e => update(p => {p.name = e.target.value;})}/></label>
        <div className="te-layout"><aside className="te-cases" aria-label="Test cases">
          {document.checks.map((c,i) => <button type="button" key={i} className={activeIndex === i ? "selected" : ""} onClick={() => setSelected(i)}><span>{String(i+1).padStart(2,"0")}</span><div><strong>{c.name || "Untitled test"}</strong><small>{c.kind === "journey" ? `${c.actions?.length || 0} steps` : c.kind}</small></div></button>)}
          <button type="button" className="te-add" disabled={busy || document.checks.length >= 200} onClick={() => { const index=document.checks.length; update(p => p.checks.push({kind:"journey",name:"New journey",acceptance:"Expected page content is visible",actions:[{action:"navigate",url:session.url},{action:"assertVisible",target:{selector:"main"}}]}));setSelected(index); }}><Plus size={15}/>Add test</button>
        </aside><section className="te-detail">{current && <>
          <div className="te-case-heading"><span>TEST {activeIndex+1}</span><button type="button" className="icon-btn" aria-label="Delete selected test" disabled={busy || document.checks.length <= 1} onClick={() => { update(p => p.checks.splice(activeIndex,1)); setSelected(Math.max(0,activeIndex-1)); }}><Trash2 size={16}/></button></div>
          <label>Test name<input value={current.name || ""} maxLength={120} disabled={busy} onChange={e => patchCase({name:e.target.value})}/></label>
          <label>Acceptance criteria<textarea value={current.acceptance || ""} maxLength={current.kind === "journey" ? 2000 : 500} rows={2} disabled={busy} onChange={e => patchCase({acceptance:e.target.value})}/></label>
          {current.kind === "journey" ? <>
            <label>Preconditions <small>One per line</small><textarea value={(current.preconditions || []).join("\n")} rows={2} disabled={busy} onChange={e => patchCase({preconditions:e.target.value.split("\n").filter(Boolean)})}/></label>
            <div className="te-step-heading"><h3>Steps</h3><span>Assertions verify the outcome</span></div>
            {(current.actions || []).map((s,i) => <div className="te-step" key={i}>
              <div className="te-step-top"><span className="te-step-number">{i+1}</span><select aria-label={`Step ${i+1} action`} value={s.action} disabled={busy} onChange={e => { const action=e.target.value; const next:Step={action}; if(action === "navigate") next.url=s.url || session.url; else if(action === "assertUrl") next.value=s.value || session.url; else { next.target=s.target || {selector:""}; if(["fill","select","assertText"].includes(action)) next.value=s.value || ""; } const steps=[...(current.actions || [])]; steps[i]=next;patchCase({actions:steps}); }}>{actions.map(a => <option key={a} value={a}>{labels[a]}</option>)}</select>
              <button type="button" className="icon-btn" aria-label={`Move step ${i+1} up`} disabled={busy || i === 0} onClick={() => move(i,-1)}><ArrowUp size={14}/></button><button type="button" className="icon-btn" aria-label={`Move step ${i+1} down`} disabled={busy || i === (current.actions?.length || 0)-1} onClick={() => move(i,1)}><ArrowDown size={14}/></button><button type="button" className="icon-btn" aria-label={`Delete step ${i+1}`} disabled={busy} onClick={() => patchCase({actions:current.actions?.filter((_,n) => n !== i)})}><Trash2 size={14}/></button></div>
              {s.action === "navigate" ? <label>URL<input value={s.url || ""} disabled={busy} maxLength={2000} onChange={e => stepChange(i,{url:e.target.value})}/></label> : s.action === "assertUrl" ? <label>Expected URL<input value={s.value || ""} disabled={busy} maxLength={2000} onChange={e => stepChange(i,{value:e.target.value})}/></label> : <>
                <label>Find element by<select value={s.target?.role ? "role" : "selector"} disabled={busy} onChange={e => stepChange(i,{target:e.target.value === "role" ? {role:"button",name:""} : {selector:""}})}><option value="selector">CSS selector</option><option value="role">Role and accessible name</option></select></label>
                {s.target?.role ? <div className="te-target"><label>Role<select value={s.target.role} disabled={busy} onChange={e => stepChange(i,{target:{...s.target,role:e.target.value}})}>{roles.map(r => <option key={r}>{r}</option>)}</select></label><label>Accessible name<input value={s.target.name || ""} maxLength={300} disabled={busy} onChange={e => stepChange(i,{target:{...s.target,name:e.target.value}})}/></label></div> : <label>CSS selector<input value={s.target?.selector || ""} maxLength={300} disabled={busy} placeholder='[data-testid="primary-action"]' onChange={e => stepChange(i,{target:{selector:e.target.value}})}/></label>}
                {["fill","select","assertText"].includes(s.action) && <label>{s.action === "assertText" ? "Expected text" : "Value"}<input value={s.value || ""} maxLength={1000} disabled={busy} onChange={e => stepChange(i,{value:e.target.value})}/></label>}
              </>}
            </div>)}
            <button type="button" className="btn te-add-step" disabled={busy || (current.actions?.length || 0) >= 50} onClick={() => patchCase({actions:[...(current.actions || []),{action:"assertVisible",target:{selector:""}}]})}><Plus size={15}/>Add step</button>
          </> : <p className="te-note">This standard check is preserved. Edit its configuration in YAML.</p>}
        </>}</section></div>
      </> : <p className="te-note">The manifest cannot be previewed. Open YAML to correct it.</p>}
      </div>
      <div role="tabpanel" id={`editor-panel-${tab === "plan" ? "yaml" : "plan"}`} aria-labelledby={`editor-tab-${tab === "plan" ? "yaml" : "plan"}`} hidden/>
      {parsed.error && <p className="inline-error te-error" role="alert">{parsed.error}</p>}
      <p className="te-note">Saving updates the plan. Run it separately to verify the changes. Form submissions and network writes remain blocked.</p>
    </div>
    <div className="dialog-foot"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy || !parsed.plan} onClick={() => onSave(source)}>{busy ? "Saving…" : "Save test plan"}</button></div>
  </Dialog>;
}
