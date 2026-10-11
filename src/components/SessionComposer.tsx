import { useRef, useState } from "react";
import { ArrowUp, Plus, SlidersHorizontal, Wrench, Box, Rocket, Bug, FlaskConical, Compass, GitBranch, FileText, ChevronDown, Play, Users } from "lucide-react";
import type { Environment } from "../types";
type Props = {environments:Environment[];aiAvailable:boolean;busy:boolean;onSubmit:(body:unknown)=>Promise<void>;onImport:()=>void;onLibrary:()=>void};
const starters = [
 {title:"Test a flow",description:"Point Trace at a preview or staging URL and name the flow.",prompt:"Draft a test for this flow. Include exact URLs, target labels, and expected outcomes.",icon:Rocket,color:"#558ca0"},
 {title:"Bug bash an area",description:"Check an area for navigation and accessibility issues.",prompt:"Check the main page for navigation, accessibility, and browser errors. Focus on: ",icon:Bug,color:"#ae6c61"},
 {title:"Reproduce a bug",description:"Describe a bug and the steps needed to verify it.",prompt:"Draft a journey to reproduce this bug. Steps and expected result: ",icon:FlaskConical,color:"#a79749"},
 {title:"Plan test cases",description:"Draft test cases from your requirements, ready for review.",prompt:"Draft test cases for these user journeys. Do not run them yet: ",icon:Compass,color:"#897297"},
 {title:"Regress a saved suite",description:"Open a saved test plan and check the flows it covers.",prompt:"Open an existing suite from the test library.",icon:GitBranch,color:"#699472"},
 {title:"Test a spec",description:"Import a spec or test plan and review its test cases.",prompt:"Import a Trace YAML test plan for review.",icon:FileText,color:"#568da5"},
];
export function SessionComposer({environments,aiAvailable,busy,onSubmit,onImport,onLibrary}:Props) {
 const [brief,setBrief]=useState("");const [environmentId,setEnvironmentId]=useState(environments[0]?.id||"");
 const [menu,setMenu]=useState<"settings"|"tools"|null>(null);const [generation,setGeneration]=useState(aiAvailable?"ai":"standard");
 const [mode,setMode]=useState("smoke");const [includeKnowledge,setIncludeKnowledge]=useState(false);const [name,setName]=useState("");
 const input=useRef<HTMLTextAreaElement>(null);
 async function send(){if(busy||!brief.trim()||!environmentId)return;await onSubmit({name:name.trim()||brief.trim().split(/[\n.!?]/)[0].slice(0,110)||"New testing session",environmentId,brief:brief.trim(),generation,mode,expectedText:"",includeKnowledge});}
 return <section className="composer-page" aria-label="New testing session">
 <form className="session-composer" onSubmit={e=>{e.preventDefault();void send();}}>
  <textarea ref={input} aria-label="Testing brief" placeholder="Tell Trace which flow to test, like sign-up or checkout…" value={brief} onChange={e=>setBrief(e.target.value)} maxLength={2000} disabled={busy} onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){e.preventDefault();void send();}}}/>
  <div className="composer-toolbar">
   <button type="button" className="composer-icon" aria-label="Import test plan" title="Import a Trace YAML test plan" disabled={busy} onClick={onImport}><Plus size={17}/></button>
   <div className="composer-menu-anchor"><button type="button" className={`composer-icon ${menu==="settings"?"active":""}`} aria-label="Session settings" aria-expanded={menu==="settings"} onClick={()=>setMenu(menu==="settings"?null:"settings")}><SlidersHorizontal size={17}/></button>
   {menu==="settings"&&<div className="composer-popover"><strong>Session settings</strong><label>Session name<input value={name} onChange={e=>setName(e.target.value)} maxLength={120} placeholder="Name this session"/></label><label>Plan creation<select value={generation} onChange={e=>setGeneration(e.target.value)}><option value="standard">Standard checks</option><option value="ai" disabled={!aiAvailable}>Generate with AI{!aiAvailable?" — not connected":""}</option></select></label><label className="composer-check"><input type="checkbox" checked={includeKnowledge} onChange={e=>setIncludeKnowledge(e.target.checked)} disabled={generation!=="ai"}/>Include enabled product knowledge</label><p>Draft first. Review your tests before running them.</p></div>}
   </div>
   <div className="composer-menu-anchor"><button type="button" className="composer-icon" aria-label="Tools" aria-expanded={menu==="tools"} onClick={()=>setMenu(menu==="tools"?null:"tools")}><Wrench size={17}/></button>{menu==="tools"&&<div className="composer-popover tool-popover"><strong>Check focus</strong>{[{id:"smoke",name:"Website smoke test"},{id:"accessibility",name:"Accessibility"},{id:"navigation",name:"Navigation"}].map(t=><button type="button" key={t.id} aria-pressed={mode===t.id} onClick={()=>{setMode(t.id);setMenu(null);}}>{t.name}{mode===t.id&&<span>✓</span>}</button>)}</div>}</div>
   <span className="composer-runner" title="Isolated browser checks; no form submissions"><Users size={17}/>Runner</span>
   <label className="composer-environment"><Box size={17}/><select aria-label="Environment" value={environmentId} onChange={e=>setEnvironmentId(e.target.value)} disabled={busy}><option value="" disabled>Environment</option>{environments.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select><ChevronDown size={12}/></label>
   <button className="composer-send" aria-label="Create test plan" title="Create a reviewable test plan (⌘ Enter)" disabled={busy||!brief.trim()||!environmentId}><ArrowUp size={19}/></button>
  </div>
 </form>
 <div className="starter-divider"><span>Or start with a brief</span></div>
 <div className="starter-grid">{starters.map((s,i)=><button className="starter-card" key={s.title} disabled={busy} onClick={()=>{if(i===4){onLibrary();return;}if(i===5){onImport();return;}setBrief(s.prompt);input.current?.focus();}}><s.icon size={20} color={s.color} strokeWidth={1.7}/><strong>{s.title}</strong><p>{s.description}</p><span><Play size={13}/>{s.prompt}</span></button>)}</div>
 {busy&&<p className="composer-busy" role="status">Creating your test plan…</p>}
 </section>;
}
