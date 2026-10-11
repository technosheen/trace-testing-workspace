import path from 'node:path';
import {chromium} from 'playwright';
import {createCoordinator} from './coordinator.mjs';
import {buildExplorationGoals,discoveredCase} from './explorer.mjs';
import {verifyDiscoveredCase} from './verifier.mjs';
import {explore} from './agent.mjs';
import {active,browserCount,isolatedContext,open,screenshot} from './runner.mjs';
import {guardedProxy} from './proxy.mjs';
import {validateTarget,isDemo,safeNavigation} from './policy.mjs';
import {check} from './checks.mjs';
import {db,id,now,save,event,dataDir} from './store.mjs';

export function createTeamRuntime(model,{coordinatorOptions={}}={}) {
 const capacity={available:()=>Math.max(0,2-browserCount()),reserve(task,control){if(browserCount()>=2)return false;active.set(task.id,control);return true;},release(task){active.delete(task.id);}};
 async function decide(input,signal){
  while(model.status().generating){if(signal.aborted)throw Error('Stopped.');await new Promise(resolve=>setTimeout(resolve,50));}
  if(signal.aborted)throw Error('Stopped.');return model.decide(input,signal);
 }
 async function browserAttempt(task,session,signal,work){
  let browser,context,proxy;const evidence=[];
  const stop=()=>browser?.close().catch(()=>{});
  signal.addEventListener('abort',stop,{once:true});
  try{
   if(signal.aborted)throw Error('Stopped.');
   proxy=await guardedProxy(isDemo(new URL(session.url)));
   browser=await chromium.launch({channel:process.env.TRACE_BROWSER_CHANNEL||'chrome',headless:true,proxy:{server:proxy.url,bypass:'<-loopback>'}});
   const control=active.get(task.id);if(control)control.browser=browser;
   if(signal.aborted)throw Error('Stopped.');
   context=await isolatedContext(browser,session.url);
   await context.route('**/*',async route=>{if(route.request().isNavigationRequest()){const url=new URL(route.request().url());if(url.origin!==new URL(session.url).origin||!safeNavigation(url))return route.abort('blockedbyclient');}return route.fallback();});
   await context.tracing.start({screenshots:true,snapshots:true});
   const {page,inputs}=await open(context,session.url);
   const result=await work(page,inputs,evidence);
   if(signal.aborted)throw Error('Stopped.');
   return {...result,evidence};
  }finally{
   if(context){const filename=`team-${id()}.zip`;await context.tracing.stop({path:path.join(dataDir,'artifacts',filename)}).then(()=>evidence.push({id:id(),at:now(),kind:'trace',url:`/artifacts/${filename}`,caption:`${task.name} — ${task.role} trace`})).catch(()=>{});}
   task.evidence=[...(task.evidence||[]),...evidence];
   await browser?.close().catch(()=>{});await proxy?.close().catch(()=>{});signal.removeEventListener('abort',stop);save();
  }
 }
 const coordinator=createCoordinator({save,capacity,...coordinatorOptions,
  event(session,role,message){session.status=session.team.state==='interrupted'?'interrupted':session.team.state==='stopping'?'cancelling':['running','cancelling'].includes(session.team.state)?session.team.state:session.team.state==='cancelled'?'cancelled':'completed';event(session,'Coordinator',message);},
  async executeExplorer(task,{signal,session}){
   event(session,'Explorer',`Exploring: ${task.name}`,{taskId:task.id});
   const result=await browserAttempt(task,session,signal,async(page,inputs,evidence)=>{
    task.steps=[];task.decisions=0;save();
    const knowledge=session.agent?.includeKnowledge?db.knowledge.filter(n=>n.enabled!==false&&(!n.environmentId||n.environmentId===session.environmentId)).slice(0,8).map(n=>({title:n.title.slice(0,120),content:n.content.slice(0,500)})):[];
    return explore(page,{brief:task.brief,knowledge,signal,decide:async(input,s)=>{task.decisions++;save();return decide(input,s);},onStep:async(step,p)=>{task.steps.push(step);evidence.push({id:id(),at:now(),kind:'screenshot',url:await screenshot(p,'team-explorer'),caption:step.summary});event(session,'Explorer',step.summary,{taskId:task.id,status:step.status});}});
   });
   const spec=discoveredCase(result,{name:task.name,goalId:task.goalId});
   if(spec){const previous=session.cases.findIndex(c=>c.discovery?.goalId===task.goalId);if(previous>=0)session.cases[previous]=spec;else session.cases.push(spec);save();}
   return {...result,case:spec};
  },
  async executeVerifier(task,{signal,session}){
   event(session,'Verifier',`Independently verifying: ${task.name}`,{taskId:task.id});
   const result=await verifyDiscoveredCase(task.case,{signal,runAttempt:async(spec,{signal,attempt})=>browserAttempt(task,session,signal,async(page,inputs,evidence)=>{
    const checked=await check(page,spec,inputs);evidence.push({id:id(),at:now(),kind:'screenshot',url:await screenshot(page,`team-verifier-${attempt}`),caption:`${spec.name} — independent attempt ${attempt}`});return checked;
   })});
   const spec=session.cases.find(c=>c.id===task.case.id);
   if(spec){const first=result.attempts?.[0]?.result||result.attempts?.[0];spec.status=result.verdict==='verified'?'passed':result.verdict==='issues_found'?'issues_found':'blocked';spec.result={status:spec.status,summary:result.summary,details:first?.details||[],stepResults:first?.stepResults||[]};spec.evidence=[...(task.evidence||[])];spec.discovery.independentlyVerified=result.verdict==='verified';}
   if(result.verdict==='issues_found'&&result.finding&&!session.findings.some(f=>f.fingerprint===result.fingerprint))session.findings.push({...result.finding,id:id(),caseId:task.case.id,name:task.name,kind:'bug',fingerprint:result.fingerprint,expected:task.case.acceptance,actual:result.summary,details:spec?.result?.details||[],reproSteps:task.case.steps,reproduction:'reproduced',triage:'OPEN',createdAt:now(),evidence:[...(task.evidence||[])],reproductionResult:result.attempts?.[1]?.result||result.attempts?.[1]||null});
   save();return {...result,state:result.verdict};
  }});
 async function begin(session,retry=false){
  if(!model.status().configured)throw Error('Connect Azure AI before starting an agent team.');
  if(active.has(session.id))throw Error('This session is already running.');
  if(!session.team || (!retry&&session.cases.length))throw Error('Create a fresh agent team session.');
  await validateTarget(session.url);
  if(active.has(session.id))throw Error('This session is already running.');
  if(retry&&session.runId)session.history.push({runId:session.runId,at:session.finishedAt||session.startedAt,status:session.status,cases:structuredClone(session.cases),findings:structuredClone(session.findings)});
  active.set(session.id,{slots:0,cancelled:false,abort:()=>coordinator.cancel(session)});
  try{retry?coordinator.retry(session):coordinator.start(session,session.team.goals||buildExplorationGoals({brief:session.brief}));}
  catch(error){active.delete(session.id);throw error;}
  session.runId=id();session.status='running';session.startedAt=now();session.finishedAt=null;save();
  void coordinator.whenIdle(session.id).then(()=>{active.delete(session.id);session.finishedAt=now();session.status=session.team.state==='cancelled'?'cancelled':session.team.state==='interrupted'?'interrupted':'completed';session.runId ||= id();save();});
  return session;
 }
 return {start:session=>begin(session),retry:session=>begin(session,true),recover:sessions=>coordinator.recover(sessions),coordinator};
}
