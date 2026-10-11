import { useMemo, useState } from "react";
import { BookOpen, Plus, Pencil, Trash2, Search, Globe2, Tags, ShieldCheck, Route } from "lucide-react";
import type { Knowledge, Environment } from "../types";
import { Dialog } from "./ui";
import "./KnowledgeWorkspace.css";
const categories = [
  { id: "general", label: "General", icon: BookOpen, description: "Background and context for your tests." },
  { id: "terminology", label: "Terminology", icon: Tags, description: "Product names, definitions, and language." },
  { id: "rules", label: "Rules", icon: ShieldCheck, description: "Business rules and expected behavior." },
  { id: "flows", label: "User flows", icon: Route, description: "Journeys and the outcomes that matter." },
];
type ScopedKnowledge = Knowledge & { category?: string; environmentId?: string; updatedAt?: string };
type Body = { title: string; content: string; category: string; environmentId?: string };
export function KnowledgeWorkspace({ items, environments, onSave, onDelete }: { items: Knowledge[]; environments: Environment[]; onSave: (body: Body, id?: string) => Promise<boolean>; onDelete: (item: Knowledge) => void }) {
  const [query,setQuery] = useState("");
  const [category,setCategory] = useState("all");
  const [scope,setScope] = useState("all");
  const [editing,setEditing] = useState<ScopedKnowledge | "new" | null>(null);
  const [title,setTitle] = useState("");
  const [content,setContent] = useState("");
  const [editCategory,setEditCategory] = useState("general");
  const [environmentId,setEnvironmentId] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const scopedItems = items as ScopedKnowledge[];
  const filtered = useMemo(() => scopedItems.filter(item => (category === "all" || (item.category || "general") === category) && (scope === "all" || (scope === "workspace" ? !item.environmentId : item.environmentId === scope)) && `${item.title} ${item.content}`.toLowerCase().includes(query.trim().toLowerCase())),[items,category,scope,query]);
  function open(item?: ScopedKnowledge) {
    setEditing(item || "new"); setTitle(item?.title || ""); setContent(item?.content || "");
    setEditCategory(item?.category || (category !== "all" ? category : "general"));
    setEnvironmentId(item?.environmentId || (scope !== "all" && scope !== "workspace" ? scope : "")); setError("");
  }
  async function save() {
    if (!title.trim() || !content.trim() || busy) return;
    setBusy(true);setError("");
    try {
      const ok = await onSave({title:title.trim(),content:content.trim(),category:editCategory,...(environmentId ? {environmentId} : {})},editing && editing !== "new" ? editing.id : undefined);
      if (ok) setEditing(null); else setError("The note could not be saved. Your changes are still here; try again.");
    } catch { setError("The note could not be saved. Your changes are still here; try again."); }
    finally { setBusy(false); }
  }
  return <div className="knowledge-workspace">
    <header className="kw-header"><div><span className="kw-eyebrow">WORKSPACE CONTEXT</span><h1>Knowledge</h1><p>Give your test drafts the language, rules, and journeys of your product.</p></div><button className="btn primary" onClick={() => open()}><Plus size={16}/>Add knowledge</button></header>
    <div className="kw-layout"><aside className="kw-sidebar" aria-label="Knowledge categories">
      <button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}><BookOpen size={16}/><span>All knowledge</span><small>{items.length}</small></button>
      {categories.map(c => <button key={c.id} className={category === c.id ? "active" : ""} onClick={() => setCategory(c.id)}><c.icon size={16}/><span>{c.label}</span><small>{scopedItems.filter(i => (i.category || "general") === c.id).length}</small></button>)}
      <div className="kw-context-note"><Globe2 size={18}/><strong>Context, when you need it</strong><p>Include knowledge when generating an AI plan. Workspace notes apply across environments; scoped notes describe one website.</p></div>
    </aside><section className="kw-main">
      <div className="kw-toolbar"><label className="kw-search"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search knowledge" aria-label="Search knowledge"/></label><select value={scope} onChange={e => setScope(e.target.value)} aria-label="Filter knowledge by environment"><option value="all">All environments</option><option value="workspace">Workspace only</option>{environments.map(e => <option value={e.id} key={e.id}>{e.name}</option>)}</select></div>
      <div className="kw-list-heading"><h2>{categories.find(c => c.id === category)?.label || "All knowledge"}</h2><span>{filtered.length} {filtered.length === 1 ? "note" : "notes"}</span></div>
      {filtered.length ? <div className="kw-grid">{filtered.map(item => { const cat=categories.find(c => c.id === (item.category || "general")) || categories[0]; const Icon=cat.icon; return <article className="kw-card" key={item.id}><div className="kw-card-top"><span className="kw-category"><Icon size={13}/>{cat.label}</span><div><button className="icon-btn" aria-label={`Edit ${item.title}`} onClick={() => open(item)}><Pencil size={14}/></button><button className="icon-btn" aria-label={`Delete ${item.title}`} onClick={() => onDelete(item)}><Trash2 size={14}/></button></div></div><h3>{item.title}</h3><p className="kw-content">{item.content}</p><footer><Globe2 size={12}/><span>{item.environmentId ? environments.find(e => e.id === item.environmentId)?.name || "Unavailable environment" : "Workspace"}</span><time dateTime={item.updatedAt || item.createdAt}>{new Date(item.updatedAt || item.createdAt).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</time></footer></article>; })}</div> : <div className="kw-empty"><BookOpen size={30}/><h3>{items.length ? "No notes match" : "Start with what your product means"}</h3><p>{items.length ? "Try another search, category, or environment." : "Add a business rule, a definition, or a key user journey to guide future test drafts."}</p><button className="btn" onClick={() => open()}><Plus size={15}/>Add knowledge</button></div>}
    </section></div>
    {editing && <Dialog title={editing === "new" ? "Add knowledge" : "Edit knowledge"} onClose={busy ? () => {} : () => setEditing(null)}><form onSubmit={e => {e.preventDefault();void save();}}><div className="dialog-body"><label>Title<input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} required disabled={busy} placeholder="e.g. What counts as an active account"/></label><div className="form-row"><label>Category<select value={editCategory} onChange={e => setEditCategory(e.target.value)} disabled={busy}>{categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label><label>Applies to<select value={environmentId} onChange={e => setEnvironmentId(e.target.value)} disabled={busy}><option value="">Entire workspace</option>{environmentId && !environments.some(e => e.id === environmentId) && <option value={environmentId}>Unavailable environment</option>}{environments.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label></div><label>Content<textarea value={content} onChange={e => setContent(e.target.value)} maxLength={5000} rows={7} required disabled={busy} placeholder={categories.find(c => c.id === editCategory)?.description}/><small>Describe facts and expected behavior. Include knowledge explicitly when generating AI test plans.</small></label>{error && <p className="inline-error" role="alert">{error}</p>}</div><div className="dialog-foot"><button type="button" className="btn" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="btn primary" disabled={busy || !title.trim() || !content.trim()}>{busy ? "Saving…" : "Save knowledge"}</button></div></form></Dialog>}
  </div>;
}
