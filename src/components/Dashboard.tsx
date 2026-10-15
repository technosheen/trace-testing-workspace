import { useState } from "react";
import { ArrowUpRight, Plus, Upload, CheckCircle2, AlertCircle, Clock3, Sparkles, Activity, CalendarDays, Globe2 } from "lucide-react";
import type { Workspace, TestCase, Session } from "../types";
import { isOpenFinding } from "../finding-status";
import { scheduleLabel } from "../schedule-label";
import { counts, date } from "../api";
import "./Dashboard.css";

type Props = { data: Workspace; go: (v: string) => void; onNew: () => void; onImport: () => void };
const completed = (c: TestCase) => ["passed", "issues_found", "blocked"].includes(c.status);
const rate = (cases: TestCase[]) => { const done = cases.filter(completed); return done.length ? Math.round(done.filter(c => c.status === "passed").length / done.length * 100) : null; };
const percent = (n: number | null) => n === null ? "—" : `${n}%`;
export function Dashboard({ data, go, onNew, onImport }: Props) {
  const [period, setPeriod] = useState("30");
  const [environment, setEnvironment] = useState("all");
  const cutoff = period === "all" ? 0 : Date.now() - Number(period) * 86400000;
  const sessions = data.sessions.filter(s => environment === "all" || s.environmentId === environment);
  const recent = sessions.filter(s => new Date(s.updatedAt).getTime() >= cutoff).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  const runs = sessions.flatMap(s => {
    const unique = new Map((s.history || []).map(r => [r.runId, { ...r, session: s }]));
    if (s.runId && s.finishedAt && s.status !== "running") unique.set(s.runId, {runId:s.runId, at:s.finishedAt, status:s.status, cases:s.cases, findings:s.findings, session:s});
    return [...unique.values()];
  }).filter(r => r.status === "completed" && new Date(r.at).getTime() >= cutoff).sort((a,b) => a.at.localeCompare(b.at));
  const latestCases = recent.flatMap(s => s.cases);
  const latestCounts = counts(latestCases);
  const runCases = runs.flatMap(r => r.cases);
  const findings = recent.flatMap(s => s.findings.filter(isOpenFinding).map(f => ({...f, session:s}))).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const schedules = data.schedules.filter(s => s.enabled && (environment === "all" || s.environmentId === environment)).sort((a,b) => a.nextRunAt.localeCompare(b.nextRunAt));
  const environments = data.environments.filter(e => environment === "all" || e.id === environment);
  const openSession = (s: Session) => go(`sessions/${s.id}`);
  return <div className="dashboard">
    <div className="dash-heading"><div><div className="dash-eyebrow">WORKSPACE OVERVIEW</div><h1>Your quality, at a glance.</h1><p>A clear view of your tests, runs, and what needs attention.</p></div><div className="dash-actions"><button className="btn" onClick={onImport}><Upload size={16}/> Import tests</button><button className="btn primary" onClick={onNew}><Plus size={17}/> New session</button></div></div>
    <div className="dash-filter"><div className="dash-period" aria-label="Reporting period">{[["7","7 days"],["30","30 days"],["all","All time"]].map(([v,l]) => <button key={v} aria-pressed={period===v} className={period===v?"active":""} onClick={() => setPeriod(v)}>{l}</button>)}</div><label><Globe2 size={15}/><select aria-label="Filter environment" value={environment} onChange={e=>setEnvironment(e.target.value)}><option value="all">All environments</option>{data.environments.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label><span className="dash-live"><i/> Live workspace data</span></div>
    <div className="dash-metrics">
      <Metric label="Historical pass rate" value={percent(rate(runCases))} detail={`${runCases.filter(completed).length} completed check outcomes across ${runs.length} runs`} icon={<CheckCircle2 size={19}/>} accent/>
      <Metric label="Completed runs" value={runs.length.toString()} detail={`${recent.filter(s=>s.status==="running").length} sessions currently running`} icon={<Activity size={19}/>}/>
      <Metric label="Latest test checks" value={latestCases.length.toString()} detail={`${latestCounts.passed} passed · ${latestCounts.pending} pending`} icon={<Clock3 size={19}/>}/>
      <Metric label="Open findings" value={findings.length.toString()} detail={`${latestCounts.issues} latest issues · ${latestCounts.blocked} blocked checks`} icon={<AlertCircle size={19}/>}/>
    </div>
    <div className="dash-main-grid"><section className="dash-card"><div className="dash-card-heading"><div><h2>Run performance</h2><p>Completed runs over the selected period</p></div><span className="dash-chip">{runs.length} runs</span></div>{runs.length ? <><div className="dash-chart" aria-label="Pass rate by completed run">{runs.slice(-18).map(r=><button key={`${r.session.id}-${r.runId}`} onClick={()=>go(`sessions/${r.session.id}/${r.runId}`)} title={`${r.session.name}: ${percent(rate(r.cases))} passed, ${date(r.at)}`}><span className="dash-chart-track"><span style={{height:`${rate(r.cases) ?? 0}%`}}/></span><small>{new Date(r.at).toLocaleDateString([], {month:"short",day:"numeric"})}</small><span className="sr-only">{r.session.name}, {percent(rate(r.cases))} pass rate</span></button>)}</div><div className="dash-chart-note"><span><i/> Pass rate per run</span><span>Blocked checks count as completed outcomes.</span></div></> : <Empty text="Your first completed run will appear here."/>}</section>
    <section className="dash-card"><div className="dash-card-heading"><div><h2>Latest outcomes</h2><p>Current checks in recently updated sessions</p></div></div><div className="dash-outcomes"><strong>{percent(rate(latestCases))}</strong><span>latest pass rate</span></div><div className="dash-outcome-bar">{[["passed",latestCounts.passed],["issues",latestCounts.issues],["blocked",latestCounts.blocked],["pending",latestCounts.pending]].map(([k,n])=><span key={k} className={String(k)} style={{flex:Number(n)}}/>)}</div><div className="dash-outcome-legend">{[["Passed",latestCounts.passed,"passed"],["Issues found",latestCounts.issues,"issues"],["Blocked",latestCounts.blocked,"blocked"],["Not completed",latestCounts.pending,"pending"]].map(([l,n,k])=><div key={l}><span><i className={String(k)}/>{l}</span><b>{n}</b></div>)}</div></section></div>
    <div className="dash-main-grid"><section className="dash-card"><div className="dash-card-heading"><div><h2>Recent sessions</h2><p>Continue where you left off</p></div><button className="dash-link" onClick={()=>go("sessions")}>View all <ArrowUpRight size={15}/></button></div>{recent.length ? <div className="dash-session-list">{recent.slice(0,5).map(s=><button key={s.id} onClick={()=>openSession(s)}><span className={`dash-status-dot ${s.status}`}/><span className="dash-row-title"><b>{s.name}</b><small>{s.environmentName} · {s.cases.length} checks</small></span><span className="dash-row-end"><span>{s.status.replaceAll("_"," ")}</span><small>{date(s.updatedAt)}</small></span><ArrowUpRight size={16}/></button>)}</div>:<Empty text="No sessions in this reporting period."/>}</section>
    <section className="dash-card"><div className="dash-card-heading"><div><h2>Needs attention</h2><p>Open findings from your latest sessions</p></div><span className="dash-chip">{findings.length}</span></div>{findings.length?<div className="dash-finding-list">{findings.slice(0,4).map(f=><button key={`${f.session.id}-${f.id}`} onClick={()=>go(`sessions/${f.session.id}/findings/${f.id}`)}><AlertCircle size={17}/><span><b>{f.name}</b><small>{f.session.name} · {f.reproduction.replaceAll("_"," ")}</small></span><ArrowUpRight size={15}/></button>)}</div>:<Empty text="No open findings in this reporting period."/>}</section></div>
    <div className="dash-bottom-grid"><section className="dash-card"><div className="dash-card-heading"><h2>Environment health</h2><button className="dash-link" onClick={()=>go("environments")}>Manage <ArrowUpRight size={14}/></button></div>{environments.length?environments.map(e=>{const latest=sessions.filter(s=>s.environmentId===e.id && s.finishedAt).sort((a,b)=>(b.finishedAt||"").localeCompare(a.finishedAt||""))[0];return <button className="dash-environment" key={e.id} onClick={()=>latest?openSession(latest):go("environments")}><Globe2 size={18}/><span><b>{e.name}</b><small>{latest?`Last completed run · ${date(latest.finishedAt)}`:"No completed runs yet"}</small></span><strong>{latest?percent(rate(latest.cases)):"—"}</strong></button>}):<Empty text="Add an environment to start testing."/>}</section>
    <section className="dash-card"><div className="dash-card-heading"><h2>Coming up</h2><button className="dash-link" onClick={()=>go("schedules")}>Schedules <ArrowUpRight size={14}/></button></div>{schedules.length?schedules.slice(0,3).map(s=><button className="dash-environment" key={s.id} onClick={()=>go("schedules")}><CalendarDays size={18}/><span><b>{s.name}</b><small>{s.lastError?`Last attempt: ${s.lastError}`:scheduleLabel(s)}</small></span><small>{date(s.nextRunAt)}</small></button>):<Empty text="No active schedules for this view."/>}</section></div>
    <button className="dash-ai" onClick={()=>go("settings")}><span className="dash-ai-icon"><Sparkles size={22}/></span><span><b>{data.service.ai?.configured?"AI drafting is connected":"Turn ideas into test plans"}</b><small>{data.service.ai?.configured?`${data.service.ai.model || data.service.ai.provider} · ${data.service.ai.remainingToday} drafts remaining today`:"Configure AI generation to draft checks from your testing brief."}</small></span><span className="dash-ai-link">AI settings <ArrowUpRight size={17}/></span></button>
  </div>;
}
function Metric({label,value,detail,icon,accent=false}:{label:string;value:string;detail:string;icon:React.ReactNode;accent?:boolean}) {return <div className={`dash-metric ${accent?"accent":""}`}><div><span>{label}</span>{icon}</div><strong>{value}</strong><small>{detail}</small></div>}
function Empty({text}:{text:string}) {return <div className="dash-empty">{text}</div>}
