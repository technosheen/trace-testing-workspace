import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
  const model = {status:()=>({configured:true,generating:false}),async decide({brief,observation,steps}) {
    const reason='Check the explicit supplied expectation.';
    if (!steps.length) return {action:'click',ref:observation.targets.find(target=>target.role==='link'&&target.name==='Our story').ref,value:'',reason};
    if (steps.length===1) return {action:'assertText',ref:observation.targets.find(target=>target.role==='heading'&&target.name==='Our story').ref,value:brief.includes('Missing promise')?'Missing promise':'Our story',reason};
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
    await fs.cp(dataDir,'/tmp/trace-team-ui-proof',{recursive:true});
  } finally {
    clearInterval(sampler);
    runtime.coordinator.cancel(session);
    await runtime.coordinator.whenIdle(session.id);
    await new Promise(resolve=>fixture.close(resolve));
    await fs.rm(dataDir,{recursive:true,force:true});
  }
});
