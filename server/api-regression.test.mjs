import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {pathToFileURL} from 'node:url';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function service(t,{workspace,bootstrap,hostedFixture=false,browserChannel='chrome'}={}) {
 const temp=await mkdtemp(path.join(tmpdir(),'trace-api-regression-'));
 const socket=net.createServer();
 await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
 const port=socket.address().port;
 await new Promise(resolve=>socket.close(resolve));
 if(workspace)await writeFile(path.join(temp,'workspace.json'),JSON.stringify(workspace(port)));
 let entry=path.resolve('server/index.mjs');
 if(bootstrap){entry=path.join(temp,'bootstrap.mjs');await writeFile(entry,bootstrap(temp));}
 let logs='';
 const child=spawn(process.execPath,[entry],{env:{...process.env,PORT:String(port),TRACE_DATA_DIR:temp,TRACE_TEST:'1',TRACE_HOSTED:hostedFixture?'1':'0',TRACE_BROWSER_CHANNEL:browserChannel,TRACE_RUNNER_KEY:'fixture-runner-key-for-local-tests-123456789',TRACE_PASSWORD_HASH:`scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`,AZURE_OPENAI_ENDPOINT:'https://fixture.openai.azure.com/',AZURE_OPENAI_DEPLOYMENT:'fixture'},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',data=>{logs+=data;});child.stderr.on('data',data=>{logs+=data;});
 const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 async function stop(){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');return await exited;}
 t.after(async()=>{const killer=setTimeout(()=>child.kill('SIGKILL'),3000);try{await stop();}finally{clearTimeout(killer);await rm(temp,{recursive:true,force:true});}});
 const base=`http://127.0.0.1:${port}`;
 for(let i=0;i<240;i++){if(child.exitCode!==null||child.signalCode!==null)throw Error(`Service exited during startup: ${logs}`);try{if([200,503].includes((await fetch(`${base}/api/health`)).status))break;}catch{}if(i===239)throw Error(`Service failed to start: ${logs}`);await delay(50);}
 async function request(url,method='GET',body){const response=await fetch(`${base}/api${url}`,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};}
 async function api(url,method='GET',body){const result=await request(url,method,body);assert.ok(result.status<300,JSON.stringify(result));return result.body;}
 return {api,request,stop,temp,base,exited};
}
const agentInput=generation=>({name:`Planned ${generation}`,environmentId:'demo',generation,brief:'Check that Everyday essentials is visible.'});
const plan={yaml:'schema: trace/test/v1\nname: Replacement suite\nchecks:\n  - kind: text\n    name: Headline\n    acceptance: Headline is visible\n    value: Everyday essentials\n'};

test('empty agent and team sources cannot create schedules or duplicate empty plans',{timeout:20000},async t=>{
 const {api,request}=await service(t);
 for(const generation of ['agent','team']) {
  const session=await api('/sessions','POST',agentInput(generation));
  const before=await api('/workspace');
  const scheduled=await request('/schedules','POST',{name:'Empty suite',environmentId:'demo',mode:'smoke',intervalHours:24,sourceSessionId:session.id});
  assert.equal(scheduled.status,400,'empty suites must be rejected when the schedule is created');
  const duplicate=await request(`/sessions/${session.id}/duplicate`,'POST',{});
  assert.equal(duplicate.status,400,'an empty agent cannot yield an executable plain session');
  const after=await api('/workspace');
  assert.equal(after.schedules.length,before.schedules.length);
  assert.equal(after.sessions.length,before.sessions.length);
 }
});

test('manual plan editing and case addition leave planned agent and team sessions unchanged',{timeout:20000},async t=>{
 const {api,request}=await service(t);
 for(const generation of ['agent','team']) {
  const session=await api('/sessions','POST',agentInput(generation));
  const replacement=await request(`/sessions/${session.id}/plan`,'PUT',plan);
  assert.equal(replacement.status,400,'agent discovery must stay separate from manual plan replacement');
  const added=await request(`/sessions/${session.id}/cases`,'POST',{name:'Manual check',kind:'text',value:'Everyday essentials'});
  assert.equal(added.status,400);
  const after=await api(`/sessions/${session.id}`);
  assert.equal(after.name,session.name);
  assert.deepEqual(after.cases,[]);
 }
});

function seededWorkspace(port) {
 const check=value=>({id:value,kind:'text',name:value,value,acceptance:'Visible text',status:'not_run',preconditions:[],steps:[],controls:[],evidence:[],result:null});
 return {version:1,environments:[{id:'demo',name:'Demo',url:`http://127.0.0.1:${port}/demo`}],knowledge:[],schedules:[],sessions:['agent','team'].map(kind=>({id:kind,name:kind,environmentId:'demo',environmentName:'Demo',url:`http://127.0.0.1:${port}/demo`,mode:'smoke',brief:'Check headline',status:'ready',cases:[check('First'),check('Second')],findings:[],activity:[],history:[],agent:{state:'planned'},...(kind==='team'?{team:{state:'planned',tasks:[],events:[],goals:[]}}:{})}))};
}
test('manual case removal rejects legacy agent plans while duplication produces an editable plain session',{timeout:20000},async t=>{
 const {api,request}=await service(t,{workspace:seededWorkspace});
 for(const source of ['agent','team']) {
  assert.equal((await request(`/sessions/${source}/cases/First`,'DELETE')).status,400);
  assert.equal((await api(`/sessions/${source}`)).cases.length,2);
  const copy=await api(`/sessions/${source}/duplicate`,'POST',{});
  assert.equal(copy.agent,undefined);assert.equal(copy.team,undefined);
  const edited=await api(`/sessions/${copy.id}/plan`,'PUT',plan);
  assert.equal(edited.cases.length,1);
  await api(`/sessions/${copy.id}/cases`,'POST',{name:'Manual check',kind:'text',value:'Fieldwork'});
  assert.equal((await api(`/sessions/${copy.id}/cases/${edited.cases[0].id}`,'DELETE')).cases.length,1);
 }
});

test('environment deletion preserves scoped knowledge until the user moves or removes it',{timeout:20000},async t=>{
 const {api,request,base}=await service(t);
 const environment=await api('/environments','POST',{name:'Custom demo',url:`${base}/demo`});
 const report=await api('/sessions','POST',{name:'Historical plan',environmentId:environment.id});
 const note=await api('/knowledge','POST',{title:'Scoped note',content:'Product terminology',environmentId:environment.id});
 assert.equal((await request(`/environments/${environment.id}`,'DELETE')).status,400);
 const retained=await api('/workspace');
 assert.ok(retained.environments.some(env=>env.id===environment.id));
 assert.equal(retained.knowledge.find(item=>item.id===note.id).environmentId,environment.id);
 await api(`/knowledge/${note.id}`,'PATCH',{title:'Shared note',content:'Product terminology'});
 await api(`/environments/${environment.id}`,'DELETE');
 assert.equal((await api(`/sessions/${report.id}`)).url,environment.url,'stored plans keep their environment snapshot');
});

test('legacy empty scheduled suites fail before creating a new session',{timeout:20000},async t=>{
 const {api,request}=await service(t,{workspace:port=>({...seededWorkspace(port),schedules:[{id:'empty',name:'Empty schedule',environmentId:'demo',mode:'smoke',enabled:false,intervalHours:24,scheduleType:'interval',nextRunAt:new Date(Date.now()+86400000).toISOString(),checks:[],lastRunId:null}]})});
 const before=await api('/workspace');
 assert.equal((await request('/schedules/empty/run','POST')).status,400);
 const after=await api('/workspace');
 assert.equal(after.sessions.length,before.sessions.length,'invalid legacy schedules must not leave empty ready sessions');
});

test('SIGTERM aborts every active worker before waiting for browser shutdown',{timeout:20000},async t=>{
 const runner=pathToFileURL(path.resolve('server/runner.mjs')).href;
 const entry=pathToFileURL(path.resolve('server/index.mjs')).href;
 const {stop,temp}=await service(t,{bootstrap:temp=>`
  import {active} from ${JSON.stringify(runner)};
  import {appendFileSync} from 'node:fs';
  const file=${JSON.stringify(path.join(temp,'shutdown-events'))};
  for(const name of ['first','second']) {
   const controller=new AbortController();
   controller.signal.addEventListener('abort',()=>appendFileSync(file,name+' aborted\\n'));
   active.set(name,{cancelled:false,abort:()=>controller.abort(),browser:{close:async()=>{appendFileSync(file,name+' close\\n');await new Promise(resolve=>setTimeout(resolve,50));}}});
  }
  await import(${JSON.stringify(entry)});
 `});
 assert.equal((await stop()).code,0);
 const events=await readFile(path.join(temp,'shutdown-events'),'utf8');
 assert.ok(events.includes('first aborted\n'),'first controller must receive abort');
 assert.ok(events.includes('second aborted\n'),'other controllers must also receive abort');
 assert.ok(events.indexOf('second aborted\n')<events.indexOf('first close\n'),'all worker aborts precede waiting for browser close');
});

test('a real storage save failure marks health unavailable and blocks further API mutations',{timeout:20000},async t=>{
 const store=pathToFileURL(path.resolve('server/store.mjs')).href;
 const entry=pathToFileURL(path.resolve('server/index.mjs')).href;
 const {api,request,temp}=await service(t,{bootstrap:temp=>`
  import {db} from ${JSON.stringify(store)};
  import {writeFileSync} from 'node:fs';
  await import(${JSON.stringify(entry)});
  writeFileSync(${JSON.stringify(path.join(temp,'workspace.json'))},JSON.stringify({...db,externalWriter:'preserve this change'}));
 `});
 const failed=await request('/knowledge','POST',{title:'Unsaved note',content:'Saving must fail safely'});
 assert.equal(failed.status,503,'storage errors must return an unavailable status');
 assert.equal(failed.body.error,'Service storage unavailable.');
 assert.ok(!JSON.stringify(failed.body).includes(temp),'filesystem paths must not leak through API errors');
 const health=await request('/health');
 assert.equal(health.status,503);
 assert.equal(health.body.status,'unavailable');
 const workspace=await api('/workspace');
 assert.equal(workspace.service.storage.healthy,false);
 assert.equal(workspace.service.storage.error,undefined);
 const session=workspace.sessions[0];
 for(const [url,method,body] of [
  ['/sessions','POST',{name:'Refused session',environmentId:'demo'}],
  [`/sessions/${session.id}/run`,'POST'],
  [`/sessions/${session.id}/agent/run`,'POST'],
  [`/sessions/${session.id}/team/run`,'POST'],
  [`/sessions/${session.id}`,'DELETE'],
 ]) {
  const rejected=await request(url,method,body);
  assert.equal(rejected.status,503,`${method} ${url} must be refused before changing state`);
  assert.equal(rejected.body.error,'Service storage unavailable.');
 }
 const after=await api('/workspace');
 assert.equal(after.sessions.length,workspace.sessions.length);
 assert.equal(after.service.activeRuns,0);
 assert.equal((await request(`/sessions/${session.id}/export`)).status,200,'read-only report recovery remains available');
 const stored=JSON.parse(await readFile(path.join(temp,'workspace.json'),'utf8'));
 assert.equal(stored.externalWriter,'preserve this change');
 assert.ok(!stored.knowledge.some(note=>note.title==='Unsaved note'),'failed saves never overwrite the competing persisted snapshot');
});

test('hosted unauthenticated health reports actual storage failure without exposing its details',{timeout:20000},async t=>{
 const store=pathToFileURL(path.resolve('server/store.mjs')).href;
 const entry=pathToFileURL(path.resolve('server/index.mjs')).href;
 const {request,temp}=await service(t,{hostedFixture:true,bootstrap:()=>`
  import {db,save} from ${JSON.stringify(store)};
  await import(${JSON.stringify(entry)});
  db.knowledge=null;
  try{save();}catch{}
 `});
 const health=await request('/health');
 assert.equal(health.status,503);
 assert.deepEqual(health.body,{status:'unavailable'});
 assert.ok(!JSON.stringify(health.body).includes(temp));
});

test('the scheduler stops admitting due work after storage failure instead of crashing the service',{timeout:40000},async t=>{
 const store=pathToFileURL(path.resolve('server/store.mjs')).href;
 const entry=pathToFileURL(path.resolve('server/index.mjs')).href;
 const {api,request,exited}=await service(t,{
  workspace:port=>({...seededWorkspace(port),schedules:[{id:'due',name:'Due suite',environmentId:'demo',mode:'smoke',enabled:true,intervalHours:24,scheduleType:'interval',nextRunAt:new Date(0).toISOString(),checks:[],lastRunId:null}]}),
  bootstrap:temp=>`
   import {db,save} from ${JSON.stringify(store)};
   import {writeFileSync} from 'node:fs';
   await import(${JSON.stringify(entry)});
   writeFileSync(${JSON.stringify(path.join(temp,'workspace.json'))},JSON.stringify({...db,externalWriter:'scheduler must preserve this'}));
   try{save();}catch{}
  `,
 });
 const before=await api('/workspace');
 const outcome=await Promise.race([exited.then(result=>({exited:result})),delay(11000).then(()=>({alive:true}))]);
 assert.equal(outcome.alive,true,'a storage outage must not turn a scheduler tick into an unhandled rejection and process exit');
 assert.equal((await request('/health')).status,503);
 const after=await api('/workspace');
 assert.equal(after.sessions.length,before.sessions.length);
 assert.deepEqual(after.schedules,before.schedules,'unhealthy scheduling must not mutate a schedule that cannot be persisted');
});

test('a storage failure during a due scheduler tick keeps health and recovery reads available',{timeout:40000},async t=>{
 const store=pathToFileURL(path.resolve('server/store.mjs')).href;
 const entry=pathToFileURL(path.resolve('server/index.mjs')).href;
 const {request,api,exited,temp}=await service(t,{
  workspace:port=>({...seededWorkspace(port),schedules:[{id:'due',name:'Due suite',environmentId:'demo',mode:'smoke',enabled:true,intervalHours:24,scheduleType:'interval',nextRunAt:new Date(0).toISOString(),lastRunId:null}]}),
  bootstrap:temp=>`
   import {db} from ${JSON.stringify(store)};
   import {writeFileSync} from 'node:fs';
   await import(${JSON.stringify(entry)});
   writeFileSync(${JSON.stringify(path.join(temp,'workspace.json'))},JSON.stringify({...db,externalWriter:'preserve scheduled save conflict'}));
  `,
 });
 const outcome=await Promise.race([exited.then(result=>({exited:result})),delay(11000).then(()=>({alive:true}))]);
 assert.equal(outcome.alive,true,'a failed scheduled save must not crash the recovery API');
 assert.equal((await request('/health')).status,503);
 assert.equal((await api('/workspace')).service.activeRuns,0,'failed schedule persistence must not launch a browser');
 const stored=JSON.parse(await readFile(path.join(temp,'workspace.json'),'utf8'));
 assert.equal(stored.externalWriter,'preserve scheduled save conflict');
 assert.equal(stored.sessions.length,2);
});

test('a failed browser-run checkpoint releases capacity before returning storage unavailable',{timeout:20000},async t=>{
 const store=pathToFileURL(path.resolve('server/store.mjs')).href;
 const entry=pathToFileURL(path.resolve('server/index.mjs')).href;
 const {api,request}=await service(t,{bootstrap:temp=>`
  import {db} from ${JSON.stringify(store)};
  import {writeFileSync} from 'node:fs';
  await import(${JSON.stringify(entry)});
  writeFileSync(${JSON.stringify(path.join(temp,'workspace.json'))},JSON.stringify({...db,externalWriter:'preserve failed run checkpoint'}));
 `});
 const workspace=await api('/workspace');
 const start=await request(`/sessions/${workspace.sessions[0].id}/run`,'POST');
 assert.equal(start.status,503);
 const after=await api('/workspace');
 assert.equal(after.service.activeRuns,0,'a run that failed to persist cannot leave an active control without a worker');
 assert.ok(!['running','cancelling'].includes(after.sessions[0].status),'a rejected run must not remain visibly active');
});

test('a failed agent checkpoint restores the planned session and releases browser capacity',{timeout:20000},async t=>{
 const store=pathToFileURL(path.resolve('server/store.mjs')).href;
 const entry=pathToFileURL(path.resolve('server/index.mjs')).href;
 const {api,request}=await service(t,{
  workspace:port=>{const data=seededWorkspace(port);data.sessions=data.sessions.filter(session=>session.id==='agent');data.sessions[0].cases=[];return data;},
  bootstrap:temp=>`
   import {db} from ${JSON.stringify(store)};
   import {writeFileSync} from 'node:fs';
   await import(${JSON.stringify(entry)});
   writeFileSync(${JSON.stringify(path.join(temp,'workspace.json'))},JSON.stringify({...db,externalWriter:'preserve agent start conflict'}));
  `,
 });
 const before=await api('/sessions/agent');
 assert.equal((await request('/sessions/agent/agent/run','POST')).status,503);
 const after=await api('/workspace');
 assert.equal(after.service.activeRuns,0);
 assert.deepEqual(after.sessions[0],before,'a rejected start must retain the unstarted agent plan');
});

test('existing workers can be cancelled during storage failure without another persistence attempt',{timeout:20000},async t=>{
 const store=pathToFileURL(path.resolve('server/store.mjs')).href;
 const runner=pathToFileURL(path.resolve('server/runner.mjs')).href;
 const entry=pathToFileURL(path.resolve('server/index.mjs')).href;
 const {api,request,temp}=await service(t,{bootstrap:temp=>`
  import {db,save} from ${JSON.stringify(store)};
  import {active} from ${JSON.stringify(runner)};
  import {writeFileSync,appendFileSync} from 'node:fs';
  await import(${JSON.stringify(entry)});
  const file=${JSON.stringify(path.join(temp,'cancel-events'))};
  const controller=new AbortController();
  controller.signal.addEventListener('abort',()=>appendFileSync(file,'aborted\\n'));
  active.set(db.sessions[0].id,{cancelled:false,abort:()=>controller.abort(),browser:{close:async()=>appendFileSync(file,'closed\\n')}});
  writeFileSync(${JSON.stringify(path.join(temp,'workspace.json'))},JSON.stringify({...db,externalWriter:'preserve cancel conflict'}));
  try{save();}catch{}
 `});
 const before=await api('/workspace');
 const cancelled=await request(`/sessions/${before.sessions[0].id}/cancel`,'POST');
 assert.equal(cancelled.status,200,'stopping existing work must remain available when persistent writes are disabled');
 assert.equal(cancelled.body.status,'cancelling');
 const events=await readFile(path.join(temp,'cancel-events'),'utf8');
 assert.ok(events.includes('aborted\n'));assert.ok(events.includes('closed\n'));
 assert.equal((await request('/health')).status,503);
 const stored=JSON.parse(await readFile(path.join(temp,'workspace.json'),'utf8'));
 assert.equal(stored.externalWriter,'preserve cancel conflict');
});

async function awaitWorkersStopped(fixture) {
 for(let attempt=0;attempt<200;attempt++) {
  const exited=await Promise.race([fixture.exited.then(result=>({exited:result})),Promise.resolve({alive:true})]);
  assert.equal(exited.alive,true,'persistence cleanup must keep the service alive for recovery');
  let workspace;
  try{workspace=await fixture.api('/workspace');}catch(error){assert.fail(`Recovery API stopped responding: ${error.message}`);}
  if(workspace.service.storage.healthy===false&&workspace.service.activeRuns===0){await delay(250);try{return await fixture.api('/workspace');}catch(error){assert.fail(`Recovery API exited after worker cleanup: ${error.message}`);}}
  await delay(100);
 }
 assert.fail('workers did not release browser capacity after persistence failed');
}

test('a real browser worker releases resources after a mid-run filesystem save conflict',{timeout:40000},async t=>{
 const store=pathToFileURL(path.resolve('server/store.mjs')).href;
 const entry=pathToFileURL(path.resolve('server/index.mjs')).href;
 const fixture=await service(t,{workspace:seededWorkspace,bootstrap:temp=>`
  import {db} from ${JSON.stringify(store)};
  import {writeFileSync} from 'node:fs';
  await import(${JSON.stringify(entry)});
  const monitor=setInterval(()=>{if(db.sessions[0].status==='running'){clearInterval(monitor);writeFileSync(${JSON.stringify(path.join(temp,'workspace.json'))},JSON.stringify({...db,externalWriter:'preserve real browser checkpoint conflict'}));}},10);
 `});
 assert.equal((await fixture.request('/sessions/agent/run','POST')).status,200);
 const workspace=await awaitWorkersStopped(fixture);
 assert.ok(!['running','cancelling'].includes(workspace.sessions[0].status));
 assert.equal((await fixture.request('/health')).status,503);
 const stored=JSON.parse(await readFile(path.join(fixture.temp,'workspace.json'),'utf8'));
 assert.equal(stored.externalWriter,'preserve real browser checkpoint conflict');
});

test('an agent worker preserves a safe typed failure and cleans up when final persistence fails',{timeout:40000},async t=>{
 const store=pathToFileURL(path.resolve('server/store.mjs')).href;
 const agent=pathToFileURL(path.resolve('server/agent.mjs')).href;
 const errors=pathToFileURL(path.resolve('server/agent-errors.mjs')).href;
 const entry=pathToFileURL(path.resolve('server/index.mjs')).href;
 const fixture=await service(t,{
  workspace:port=>{const data=seededWorkspace(port);data.sessions=data.sessions.filter(session=>session.id==='agent');data.sessions[0].cases=[];return data;},
  bootstrap:temp=>`
   import {db} from ${JSON.stringify(store)};
   import {startAgent} from ${JSON.stringify(agent)};
   import {agentError} from ${JSON.stringify(errors)};
   import {writeFileSync} from 'node:fs';
   await import(${JSON.stringify(entry)});
   await startAgent(db.sessions[0],{status:()=>({configured:true}),decide:async()=>{
    writeFileSync(${JSON.stringify(path.join(temp,'workspace.json'))},JSON.stringify({...db,externalWriter:'preserve real agent conflict'}));
    throw Object.assign(agentError('ai_rate_limit'),{message:'private provider secret must stay hidden'});
   }});
  `,
 });
 const workspace=await awaitWorkersStopped(fixture);
 assert.equal(workspace.sessions[0].agent.failureKind,'ai_rate_limit');
 assert.equal(workspace.sessions[0].agent.summary,'AI provider is busy or its quota is exhausted. Retry shortly.');
 assert.ok(!JSON.stringify(workspace.sessions[0]).includes('private provider secret'));
 assert.equal((await fixture.request('/health')).status,503);
});

test('the standalone agent endpoint rejects a planned team before mutating its discovery state',{timeout:20000},async t=>{
 const {api,request}=await service(t,{browserChannel:'fixture-channel-that-cannot-launch',workspace:port=>{
  const data=seededWorkspace(port);data.sessions=data.sessions.filter(session=>session.id==='team');data.sessions[0].cases=[];return data;
 }});
 const before=await api('/sessions/team');
 assert.equal((await request('/sessions/team/agent/run','POST')).status,400);
 assert.deepEqual(await api('/sessions/team'),before);
 assert.equal((await api('/workspace')).service.activeRuns,0);
});

test('a team worker storage outage releases parent and worker controls and keeps recovery available',{timeout:40000},async t=>{
 const store=pathToFileURL(path.resolve('server/store.mjs')).href;
 const runtime=pathToFileURL(path.resolve('server/team-runtime.mjs')).href;
 const runner=pathToFileURL(path.resolve('server/runner.mjs')).href;
 const errors=pathToFileURL(path.resolve('server/agent-errors.mjs')).href;
 const entry=pathToFileURL(path.resolve('server/index.mjs')).href;
 const fixture=await service(t,{
  workspace:port=>{const data=seededWorkspace(port);data.sessions=data.sessions.filter(session=>session.id==='team');data.sessions[0].cases=[];data.sessions[0].team.goals=[{name:'Headline',brief:'Check visible headline'}];return data;},
  bootstrap:temp=>`
   import {db} from ${JSON.stringify(store)};
   import {createTeamRuntime} from ${JSON.stringify(runtime)};
   import {active} from ${JSON.stringify(runner)};
   import {agentError} from ${JSON.stringify(errors)};
   import {writeFileSync} from 'node:fs';
   await import(${JSON.stringify(entry)});
   const runtime=createTeamRuntime({status:()=>({configured:true,generating:false}),decide:async()=>{
    writeFileSync(${JSON.stringify(path.join(temp,'workspace.json'))},JSON.stringify({...db,externalWriter:'preserve real team conflict'}));
    throw agentError('ai_rate_limit');
   }});
   await runtime.start(db.sessions[0]);
   void runtime.coordinator.whenIdle('team').then(()=>writeFileSync(${JSON.stringify(path.join(temp,'team-active'))},String(active.size)));
  `,
 });
 const workspace=await awaitWorkersStopped(fixture);
 assert.ok(!['running','cancelling'].includes(workspace.sessions[0].status));
 assert.equal(await readFile(path.join(fixture.temp,'team-active'),'utf8'),'0');
 assert.equal((await fixture.request('/health')).status,503);
});

test('a team final starting checkpoint failure stops spawned work and releases all reserved capacity',{timeout:30000},async t=>{
 const store=pathToFileURL(path.resolve('server/store.mjs')).href;
 const entry=pathToFileURL(path.resolve('server/index.mjs')).href;
 const runner=pathToFileURL(path.resolve('server/runner.mjs')).href;
 const {api,request,temp}=await service(t,{
  workspace:port=>{const data=seededWorkspace(port);data.sessions=data.sessions.filter(session=>session.id==='team');data.sessions[0].cases=[];data.sessions[0].team.goals=[{name:'Headline',brief:'Check visible headline'}];return data;},
  bootstrap:temp=>`
   import {db} from ${JSON.stringify(store)};
   import {active} from ${JSON.stringify(runner)};
   import {writeFileSync} from 'node:fs';
   await import(${JSON.stringify(entry)});
   let value;
   Object.defineProperty(db.sessions[0],'runId',{enumerable:true,configurable:true,get:()=>value,set:next=>{
    value=next;writeFileSync(${JSON.stringify(path.join(temp,'workspace.json'))},JSON.stringify({...db,externalWriter:'preserve final team start conflict'}));
   }});
   process.on('SIGTERM',()=>writeFileSync(${JSON.stringify(path.join(temp,'final-active'))},String(active.size)));
  `,
 });
 assert.equal((await request('/sessions/team/team/run','POST')).status,503);
 const after=await api('/workspace');
 assert.equal(after.service.activeRuns,0);
 assert.ok(!['running','cancelling'].includes(after.sessions[0].status));
 assert.equal(after.sessions[0].cases.length,0);
 // The session's zero-slot parent reservation also needs release; browserCount omits it.
 await request('/sessions/team/cancel','POST').then(result=>assert.equal(result.status,400));
});

test('explicit agent restart clears failure and trace metadata from the previous attempt',{timeout:20000},async t=>{
 const {request}=await service(t,{browserChannel:'fixture-channel-that-cannot-launch',workspace:port=>{
  const data=seededWorkspace(port);data.sessions=data.sessions.filter(session=>session.id==='agent');data.sessions[0].cases=[];
  data.sessions[0].status='blocked';Object.assign(data.sessions[0].agent,{state:'blocked',failureKind:'ai_timeout',trace:'/artifacts/previous-attempt.zip'});return data;
 }});
 const started=await request('/sessions/agent/agent/run','POST');
 assert.equal(started.status,200);
 assert.equal(started.body.agent.failureKind,undefined);
 assert.equal(started.body.agent.trace,undefined);
});

test('run-selected exports preserve historical cases and traces without latest evidence',{timeout:20000},async t=>{
 const {api,request,base}=await service(t,{workspace:port=>{
  const data=seededWorkspace(port);const session=data.sessions[0];data.sessions=[session];
  Object.assign(session,{runId:'run-B',trace:'/evidence/B.zip',agent:{trace:'/evidence/latest-agent.zip'},cases:[{...session.cases[0],name:'Case B',value:'B'}],history:[{runId:'run-A',at:'2026-01-01',status:'passed',trace:'/evidence/A.zip',cases:[{...session.cases[0],name:'Case A',value:'A'}],findings:[]}]});return data;
 }});
 const selected=await api('/sessions/agent/export?format=json&runId=run-A');
 assert.equal(selected.runId,'run-A');assert.equal(selected.trace,'/evidence/A.zip');assert.equal(selected.cases[0].name,'Case A');
 assert.ok(!JSON.stringify(selected).includes('Case B'));assert.ok(!JSON.stringify(selected).includes('latest-agent'));
 const yaml=await (await fetch(`${base}/api/sessions/agent/export?format=yaml&runId=run-A`)).text();
 assert.match(yaml,/Case A/);assert.doesNotMatch(yaml,/Case B/);
 assert.equal((await api('/sessions/agent/export')).trace,'/evidence/B.zip');
 assert.equal((await api('/sessions/agent/export?runId=run-B')).trace,'/evidence/B.zip');
 assert.equal((await request('/sessions/agent/export?runId=unknown')).status,404);
 const imported=await api('/import','POST',{yaml,environmentId:'demo'});assert.equal(imported.cases[0].name,'Case A');
});
