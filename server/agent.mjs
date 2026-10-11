import path from 'node:path';
import { chromium } from 'playwright';
import { active, isolatedContext, open, screenshot } from './runner.mjs';
import { guardedProxy } from './proxy.mjs';
import { validateTarget, safeNavigation, isDemo } from './policy.mjs';
import { db, save, event, id, now, dataDir } from './store.mjs';
import { agentDecisionSchema } from './ai.mjs';

const dangerous = /\b(delete|remove|destroy|purchase|pay|checkout|logout|sign out|sign in|subscribe|submit|send|save)\b/i;
export async function observe(page, origin) {
  const candidates = await page.evaluate(() => {
    const roles = {A:'link',BUTTON:'button',H1:'heading',H2:'heading',H3:'heading',H4:'heading',H5:'heading',H6:'heading'};
    return Array.from(document.querySelectorAll('a[href],button,h1,h2,h3,h4,h5,h6,[role="tab"],[role="button"],[role="heading"]')).slice(0,160).map(el => {
      const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(key=>document.getElementById(key)?.textContent || '').join(' ').trim();
      const name = (el.getAttribute('aria-label') || labelled || el.innerText || '').replace(/\s+/g,' ').trim();
      return {role:el.getAttribute('role') || roles[el.tagName],name,href:el.tagName==='A'?el.href:null,inForm:Boolean(el.closest('form')),disabled:Boolean(el.disabled)};
    }).filter(el=>el.name && el.name.length<=200 && ['link','button','heading','tab'].includes(el.role));
  });
  const targets=[]; const seen=new Set();
  for (const candidate of candidates) {
    const key=JSON.stringify([candidate.role,candidate.name]);
    if(seen.has(key)) continue;
    seen.add(key);
    const locator=page.getByRole(candidate.role,{name:candidate.name,exact:true});
    if(await locator.count()!==1 || !await locator.isVisible()) continue;
    let canClick=['link','button','tab'].includes(candidate.role) && !candidate.inForm && !candidate.disabled && !dangerous.test(candidate.name);
    if(candidate.href) { const url=new URL(candidate.href); canClick=canClick && url.origin===origin && safeNavigation(url); }
    targets.push({ref:`e${targets.length+1}`,role:candidate.role,name:candidate.name,canClick});
    if(targets.length===60)break;
  }
  return {url:page.url(),title:await page.title(),text:(await page.locator('body').innerText()).slice(0,3000),targets};
}

export function groundDecision(raw, observation, supplied) {
  const decision=agentDecisionSchema.parse(raw);
  if(['finish','blocked'].includes(decision.action)) {
    if(decision.ref || decision.value)throw Error('Terminal decisions cannot name a target.');
    return {decision};
  }
  const target=observation.targets.find(t=>t.ref===decision.ref);
  if(!target)throw Error('Agent selected a target absent from the current observation.');
  if(decision.action==='click'&&!target.canClick)throw Error('This target is outside the read-only action policy.');
  if(decision.action==='assertText') {
    if(!decision.value.trim() || !supplied.includes(decision.value))throw Error('Expected text must be copied from the supplied requirements.');
  } else if(decision.value)throw Error('Unexpected action value.');
  return {decision,target};
}

export async function explore(page, {brief,knowledge=[],decide,signal,maxDecisions=8,onStep=async()=>{}}) {
  const origin=new URL(page.url()).origin;
  const supplied=[brief,...knowledge.map(n=>n.content)].join('\n');
  const actions=[{action:'navigate',url:page.url()}]; const steps=[]; const seen=new Set();
  for(let turn=0;turn<Math.min(8,maxDecisions);turn++) {
    if(signal.aborted)throw Error('Agent was stopped.');
    const observation=await observe(page,origin);
    const {decision,target}=groundDecision(await decide({brief,knowledge,observation,steps},signal),observation,supplied);
    if(signal.aborted)throw Error('Agent was stopped.');
    if(decision.action==='blocked')return {state:'blocked',summary:decision.reason,actions,steps};
    if(decision.action==='finish') {
      if(!actions.some(a=>a.action.startsWith('assert')))throw Error('Agent cannot finish without an executed assertion.');
      return {state:'completed',summary:decision.reason,actions,steps};
    }
    const replay={action:decision.action,target:{role:target.role,name:target.name},...(decision.action==='assertText'?{value:decision.value}:{})};
    const key=JSON.stringify([page.url(),replay]);
    if(seen.has(key))throw Error('Agent repeated an action without making progress.');
    seen.add(key);
    const locator=page.getByRole(target.role,{name:target.name,exact:true});
    if(await locator.count()!==1 || !await locator.isVisible())throw Error('Observed target changed before execution.');
    let failure;
    try {
      if(decision.action==='click')await locator.click({timeout:5000});
      else if(decision.action==='assertVisible')await locator.waitFor({state:'visible',timeout:5000});
      else if(!(await locator.innerText()).includes(decision.value))throw Error('Expected text was not visible.');
      if(new URL(page.url()).origin!==origin || !safeNavigation(new URL(page.url())))throw Error('Navigation left the allowed scope.');
    } catch(error) {failure=error;}
    actions.push(replay);
    const step={index:steps.length+1,action:decision.action,target:replay.target,value:replay.value,status:failure?'blocked':'passed',summary:failure?'Action or assertion could not be completed.':`Executed ${decision.action} on ${target.name}`,url:page.url(),at:now()};
    steps.push(step);await onStep(step,page);
    if(failure)return {state:'blocked',summary:step.summary,actions,steps};
  }
  return {state:'limited',summary:'Eight-decision exploration budget reached. Coverage is incomplete.',actions,steps};
}

export async function startAgent(session, model) {
  if(!model.status().configured)throw Object.assign(Error('Connect Azure AI before starting an agent.'),{status:503});
  if(!session.agent || session.cases.length)throw Error('Create a new agent session to explore. Existing tests are preserved.');
  if(active.has(session.id)||active.size>=2)throw Error('Browser capacity is busy. Wait for an active run to finish.');
  await validateTarget(session.url);
  if(active.has(session.id)||active.size>=2)throw Error('Browser capacity is busy.');
  const controller=new AbortController(); const control={cancelled:false,browser:null,abort:()=>controller.abort()};
  active.set(session.id,control);
  session.status='running';session.startedAt=now();session.finishedAt=null;session.agent={...session.agent,state:'running',steps:[],evidence:[],decisions:0,summary:'Exploring the live page.'};
  event(session,'Agent','Live exploration started. Up to eight decisions; no form submissions.');
  void (async()=>{
    let browser,context,proxy;
    const timer=setTimeout(()=>{controller.abort();control.browser?.close().catch(()=>{});},120000);
    try {
      proxy=await guardedProxy(isDemo(new URL(session.url)));
      browser=await chromium.launch({channel:process.env.TRACE_BROWSER_CHANNEL||'chrome',headless:true,proxy:{server:proxy.url,bypass:'<-loopback>'}});
      control.browser=browser;
      if(control.cancelled||controller.signal.aborted)throw Error('Stopped.');
      context=await isolatedContext(browser,session.url);
      await context.route('**/*',async(route)=>{
        if(route.request().isNavigationRequest()) {
          const url=new URL(route.request().url());
          if(url.origin!==new URL(session.url).origin||!safeNavigation(url))return route.abort('blockedbyclient');
        }
        await route.fallback();
      });
      await context.tracing.start({screenshots:true,snapshots:true});
      const {page}=await open(context,session.url);
      const knowledge=session.agent.includeKnowledge?db.knowledge.filter(n=>n.enabled!==false&&(!n.environmentId||n.environmentId===session.environmentId)).slice(0,8).map(n=>({title:n.title,content:n.content.slice(0,500)})):[];
      const result=await explore(page,{brief:session.brief,knowledge,signal:controller.signal,
        decide:async(input,signal)=>{session.agent.decisions++;save();return model.decide(input,signal);},
        onStep:async(step,page)=>{
          session.agent.steps.push(step);
          const url=await screenshot(page,'agent');
          session.agent.evidence.push({id:id(),at:now(),kind:'screenshot',url,caption:step.summary});
          event(session,'Agent',step.summary,{status:step.status});
        }});
      if(control.cancelled || controller.signal.aborted)throw Error("Stopped.");
      Object.assign(session.agent,{state:result.state,summary:result.summary});
      if(result.actions.some(a=>a.action.startsWith('assert'))) {
        session.cases=[{id:id(),kind:'journey',name:session.name,acceptance:'Replay the observed navigation and recorded assertions.',preconditions:['Read-only public page reachable.','Discovered scope is limited to the recorded steps.'],actions:result.actions,
          steps:result.actions.map(a=>`${a.action}: ${a.target?.name||a.url||a.value||''}`),status:'not_run',controls:[],evidence:[],result:null}];
      }
      session.status='ready';
      event(session,'Agent',`${result.summary} ${session.cases.length?'Saved an unexecuted replay test. Run checks to verify it independently.':'No runnable test was discovered.'}`);
    } catch {
      session.agent.state=control.cancelled?'cancelled':controller.signal.aborted?'limited':'blocked';
      session.agent.summary=control.cancelled?'Agent stopped by request.':controller.signal.aborted?'Exploration time budget reached.':'Exploration could not complete. Check target access, AI availability and quota.';
      session.status=control.cancelled?'cancelled':'blocked';event(session,'Agent',session.agent.summary);
    } finally {
      if(context) {
        const filename=`agent-${id()}.zip`;
        try {await context.tracing.stop({path:path.join(dataDir,'artifacts',filename)});session.agent.trace=`/artifacts/${filename}`;}catch{}
      }
      await browser?.close().catch(()=>{});await proxy?.close().catch(()=>{});
      clearTimeout(timer);active.delete(session.id);session.finishedAt=now();save();
    }
  })();
  return session;
}
