import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('a failed parent team checkpoint settles queued work and contains the terminal save rejection', async () => {
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'trace-team-outage-'));
 try {
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
   import http from 'node:http';
   import fs from 'node:fs';
   const server=http.createServer((req,res)=>res.end('fixture'));
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   process.env.PORT=String(server.address().port);
   const {createTeamRuntime}=await import('./server/team-runtime.mjs');
   const {db,save,dataDir}=await import('./server/store.mjs');
   const {active}=await import('./server/runner.mjs');
   const session={id:'parent-outage',name:'Fixture',brief:'Check Home',url:'http://127.0.0.1:'+process.env.PORT+'/demo',environmentId:'demo',cases:[],findings:[],activity:[],history:[],status:'ready',team:{state:'planned',tasks:[],events:[],goals:[{name:'Home',brief:'Check Home'}]}};
   db.sessions.push(session);save();
   let saves=0;
   const runtime=createTeamRuntime({status:()=>({configured:true})},{coordinatorOptions:{capacity:{available:()=>false},save(){if(++saves===1)fs.writeFileSync(dataDir+'/workspace.json',JSON.stringify({...db,externalWriter:'preserve'}));}}});
   let code;try{await runtime.start(session);}catch(error){code=error.code;}
   await new Promise(resolve=>setTimeout(resolve,20));
   console.log(JSON.stringify({code,active:active.size,running:runtime.coordinator.isRunning(session.id),status:session.status,external:JSON.parse(fs.readFileSync(dataDir+'/workspace.json')).externalWriter}));
   await new Promise(resolve=>server.close(resolve));
  `],{cwd:process.cwd(),env:{...process.env,TRACE_DATA_DIR:temp},encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{code:'TRACE_STORAGE_STALE',active:0,running:false,status:'blocked',external:'preserve'});
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});

test('real browser team explores two goals, independently verifies and reproduces an assertion mismatch', {timeout:120000}, async () => {
  const fixture = http.createServer((request,response) => {
    response.setHeader('Content-Type','text/html');
    response.end(request.url === '/demo/about'
      ? '<!doctype html><title>Our story</title><main><h1>Our story</h1><p>Public company background.</p></main>'
      : '<!doctype html><title>Fixture</title><main><h1>Welcome</h1><a href="/demo/about">Our story</a></main>');
  });
  await new Promise(resolve => fixture.listen(0,'127.0.0.1',resolve));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(),'trace-team-runtime-'));
  process.env.PORT = String(fixture.address().port);
  process.env.TRACE_DATA_DIR = dataDir;
  const {createTeamRuntime} = await import('./team-runtime.mjs');
  const {db,save} = await import('./store.mjs');
  const {browserCount,active} = await import('./runner.mjs');
  let retryExpectation=false;
  const model = {status:()=>({configured:true,generating:false}),async decide({brief,observation,steps}) {
    const reason='Check the explicit supplied expectation.';
    if (!steps.length) return {action:'click',ref:observation.targets.find(target=>target.role==='link'&&target.name==='Our story').ref,value:'',reason};
    if (steps.length===1) return {action:'assertText',ref:observation.targets.find(target=>target.role==='heading'&&target.name==='Our story').ref,value:brief.includes('Missing promise')&&!retryExpectation?'Missing promise':'Our story',reason};
    return {action:'finish',ref:'',value:'',reason:'Recorded assertion completed.'};
  }};
  const session = {id:'team-runtime-fixture',name:'Browser team fixture',brief:'Explore the supplied story requirements.',url:`http://127.0.0.1:${process.env.PORT}/demo`,environmentId:'demo',cases:[],findings:[],activity:[],history:[],status:'planned',agent:{includeKnowledge:false},team:{state:'planned',tasks:[],goals:[
    {id:'story',name:'Story visible',brief:'Open Our story and assert heading text Our story.'},
    {id:'missing',name:'Missing supplied expectation',brief:'Open Our story and assert heading text Missing promise.'},
  ]}};
  db.sessions.push(session);save();
  const runtime = createTeamRuntime(model,{coordinatorOptions:{pollMs:5}});
  let maximum=0;
  const sampler=setInterval(()=>{maximum=Math.max(maximum,browserCount());},5);
  try {
    await runtime.start(session);
    await runtime.coordinator.whenIdle(session.id);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(session.team.state,'issues_found');
    const verifiers=session.team.tasks.filter(task=>task.role==='verifier');
    assert.equal(verifiers.length,2);
    assert.equal(verifiers.find(task=>task.name==='Story visible').state,'verified');
    const failed=verifiers.find(task=>task.name==='Missing supplied expectation');
    assert.equal(failed.state,'issues_found');
    assert.equal(failed.result.attempts.length,2);
    assert.ok(failed.result.attempts.every(attempt=>attempt.result.stepResults.find(step=>step.action==='assertText').failureKind==='assertion_mismatch'));
    assert.equal(session.findings.length,1);
    assert.equal(session.findings[0].reproduction,'reproduced');
    assert.equal(session.cases.length,2);
    assert.equal(session.cases.find(spec=>spec.name==='Story visible').discovery.independentlyVerified,true);
    assert.equal(session.cases.find(spec=>spec.name==='Missing supplied expectation').status,'issues_found');
    assert.ok(maximum>=1&&maximum<=2);
    assert.equal(browserCount(),0);
    assert.equal(active.has(session.id),false);
    for (const task of session.team.tasks) {
      assert.ok(task.evidence.some(item=>item.kind==='screenshot'));
      assert.ok(task.evidence.some(item=>item.kind==='trace'));
      for(const item of task.evidence) assert.ok((await fs.stat(path.join(dataDir,item.url))).size>0);
    }
    const persisted=JSON.parse(await fs.readFile(path.join(dataDir,'workspace.json'),'utf8')).sessions.find(item=>item.id===session.id);
    assert.equal(persisted.team.state,'issues_found');
    assert.equal(persisted.team.tasks.length,4);
    assert.equal(persisted.findings.length,1);
    assert.ok(persisted.finishedAt);
    const previousId=session.cases.find(spec=>spec.name==='Missing supplied expectation').id;
    retryExpectation=true;
    await runtime.retry(session);await runtime.coordinator.whenIdle(session.id);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(session.cases.find(spec=>spec.name==='Missing supplied expectation').id,previousId);
    assert.equal(session.findings.length,0);
    assert.equal(session.history[0].findings.length,1);
    assert.equal(session.history[0].findings[0].caseId,previousId);
    assert.equal(session.cases.find(spec=>spec.id===previousId).status,'passed');
    await fs.cp(dataDir,'/tmp/trace-team-ui-proof',{recursive:true});
  } finally {
    clearInterval(sampler);
    runtime.coordinator.cancel(session);
    await runtime.coordinator.whenIdle(session.id);
    await new Promise(resolve=>fixture.close(resolve));
    await fs.rm(dataDir,{recursive:true,force:true});
  }
});
