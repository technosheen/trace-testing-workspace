import { useMemo, useState } from "react";
import { BookOpen, Plus, Pencil, Trash2, Search, Tags, ShieldCheck, Route, ChevronDown } from "lucide-react";
import type { Knowledge, Environment } from "../types";
import { Dialog } from "./ui";
import "./KnowledgeWorkspace.css";
const categories = [
  { id: "general", label: "General", icon: BookOpen, description: "Background and context for your tests." },
  { id: "terminology", label: "Terminology", icon: Tags, description: "Product names, definitions, and language." },
  { id: "rules", label: "Rules", icon: ShieldCheck, description: "Business rules and expected behavior." },
  { id: "flows", label: "User flows", icon: Route, description: "Journeys and the outcomes that matter." },
];
type ScopedKnowledge = Knowledge & { category?: string; environmentId?: string; updatedAt?: string; enabled?: boolean };
type Body = { title: string; content: string; category: string; environmentId?: string; enabled?: boolean };
export function KnowledgeWorkspace({ items, environments, onSave, onDelete }: { items: Knowledge[]; environments: Environment[]; onSave: (body: Body, id?: string) => Promise<boolean>; onDelete: (item: Knowledge) => void }) {
  const [query,setQuery] = useState("");
  const [category,setCategory] = useState("all");
  const [scope,setScope] = useState("all");
  const [editing,setEditing] = useState<ScopedKnowledge | "new" | null>(null);
  const [title,setTitle] = useState("");
  const [content,setContent] = useState("");
  const [editCategory,setEditCategory] = useState("general");
  const [environmentId,setEnvironmentId] = useState("");
  const [enabled,setEnabled] = useState(true);
  const [toggleId,setToggleId] = useState<string | null>(null);
  const [toggleError,setToggleError] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const scopedItems = items as ScopedKnowledge[];
  const filtered = useMemo(() => scopedItems.filter(item => (category === "all" || (item.category || "general") === category) && (scope === "all" || (scope === "workspace" ? !item.environmentId : item.environmentId === scope)) && `${item.title} ${item.content}`.toLowerCase().includes(query.trim().toLowerCase())),[items,category,scope,query]);
  function open(item?: ScopedKnowledge) {
    setEnabled(item?.enabled !== false);setEditing(item || "new"); setTitle(item?.title || ""); setContent(item?.content || "");
    setEditCategory(item?.category || (category !== "all" ? category : "general"));
    setEnvironmentId(item?.environmentId || (scope !== "all" && scope !== "workspace" ? scope : "")); setError("");
  }
  async function save() {
    if (!title.trim() || !content.trim() || busy) return;
    setBusy(true);setError("");
    try {
      const ok = await onSave({title:title.trim(),content:content.trim(),category:editCategory,enabled,...(environmentId ? {environmentId} : {})},editing && editing !== "new" ? editing.id : undefined);
      if (ok) setEditing(null); else setError("The note could not be saved. Your changes are still here; try again.");
    } catch { setError("The note could not be saved. Your changes are still here; try again."); }
    finally { setBusy(false); }
  }
  async function toggle(item: ScopedKnowledge) {
    if(toggleId) return;
    setToggleId(item.id);setToggleError("");
    try { const ok=await onSave({title:item.title,content:item.content,category:item.category || "general",environmentId:item.environmentId,enabled:item.enabled === false},item.id); if(!ok) setToggleError("Could not update knowledge. Please try again."); }
    catch { setToggleError("Could not update knowledge. Please try again."); }
    finally {setToggleId(null);}
  }
  return <div className="knowledge-workspace">
    <header className="kw-header">Knowledge</header>
    <div className="kw-body">
      {items.length > 0 && <div className="kw-toolbar"><label className="kw-search"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search knowledge" aria-label="Search knowledge"/></label><select value={category} onChange={e => setCategory(e.target.value)} aria-label="Category"><option value="all">All categories</option>{categories.map(c => <option value={c.id} key={c.id}>{c.label}</option>)}</select><select value={scope} onChange={e => setScope(e.target.value)} aria-label="Environment"><option value="all">All environments</option><option value="workspace">Workspace only</option>{environments.map(e => <option value={e.id} key={e.id}>{e.name}</option>)}</select><button className="btn primary" onClick={() => open()}><Plus size={15}/>Add knowledge</button></div>}
      {toggleError && <p className="inline-error" role="alert">{toggleError}</p>}<div className="kw-table-wrap"><table className="kw-table"><thead><tr><th>Name</th><th>Category</th><th>Author</th><th>Created</th><th>Enabled</th>{items.length > 0 && <th aria-label="Actions"/>}</tr></thead><tbody>{filtered.map(item => <tr key={item.id}><td><button className="kw-name" onClick={() => open(item)}>{item.title}</button>{item.environmentId && <small>{environments.find(e => e.id === item.environmentId)?.name || "Unavailable environment"}</small>}</td><td>{categories.find(c => c.id === (item.category || "general"))?.label || "General"}</td><td>—</td><td>{new Date(item.createdAt).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}</td><td><button type="button" className="kw-switch" role="switch" aria-checked={item.enabled !== false} aria-label={`Enable ${item.title}`} disabled={Boolean(toggleId)} onClick={() => void toggle(item)}><span/></button></td><td className="kw-actions"><button className="icon-btn" aria-label={`Edit ${item.title}`} onClick={() => open(item)}><Pencil size={14}/></button><button className="icon-btn" aria-label={`Delete ${item.title}`} onClick={() => onDelete(item)}><Trash2 size={14}/></button></td></tr>)}</tbody></table>
      {!filtered.length && <div className="kw-empty"><div className="kw-book"><BookOpen size={17}/></div><h3>{items.length ? "No matching knowledge" : "No knowledge yet"}</h3><p>{items.length ? "Try a different search or filter." : <>Knowledge gives Trace drafting the terms<br/>your team uses, the rules they must follow, and<br/>the flows that describe how your product works.</>}</p>{!items.length && <p>Add your first item to describe how your product works.</p>}<details className="kw-add-menu"><summary><Plus size={16}/>Add knowledge<ChevronDown size={14}/></summary><div>{categories.filter(c => c.id !== "general").map(c => <button key={c.id} onClick={e => { e.currentTarget.closest("details")?.removeAttribute("open");open();setEditCategory(c.id); }}><c.icon size={15}/>{c.label}</button>)}</div></details></div>}
      </div>
    </div>
    {editing && <div className="kw-modal"><Dialog title={editing === "new" ? "Add knowledge" : "Edit knowledge"} wide onClose={busy ? () => {} : () => setEditing(null)}><form onSubmit={e => {e.preventDefault();void save();}}><div className="dialog-body"><p className="kw-modal-intro">Knowledge items inform AI drafts. Pick a category to see relevant fields.</p><label>Category<select value={editCategory} onChange={e => setEditCategory(e.target.value)} disabled={busy}>{categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label><label>{editCategory === "terminology" ? "Canonical term" : editCategory === "rules" ? "Rule name" : editCategory === "flows" ? "Flow name" : "Title"}<input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} required disabled={busy} placeholder={editCategory === "terminology" ? "e.g. Active account" : "Name this knowledge item"}/></label><label>{editCategory === "terminology" ? "Definition" : editCategory === "rules" ? "Rule" : editCategory === "flows" ? "Flow description" : "Content"}<textarea value={content} onChange={e => setContent(e.target.value)} maxLength={5000} rows={4} required disabled={busy} placeholder={categories.find(c => c.id === editCategory)?.description}/></label><label>Environment<select value={environmentId} onChange={e => setEnvironmentId(e.target.value)} disabled={busy}><option value="">Any environment</option>{environmentId && !environments.some(e => e.id === environmentId) && <option value={environmentId}>Unavailable environment</option>}{environments.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label className="kw-enabled-field"><span>Enabled</span><button type="button" className="kw-switch" role="switch" aria-checked={enabled} aria-label="Enable knowledge" disabled={busy} onClick={() => setEnabled(!enabled)}><span/></button></label><small className="kw-save-note">Included when you choose to use knowledge in an AI draft.</small>{error && <p className="inline-error" role="alert">{error}</p>}</div><div className="dialog-foot"><button type="button" className="btn" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="btn primary" disabled={busy || !title.trim() || !content.trim()}>{busy ? "Saving…" : editing === "new" ? "Add knowledge" : "Save changes"}</button></div></form></Dialog></div>}
  </div>;
}
