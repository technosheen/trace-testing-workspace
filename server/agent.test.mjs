import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
const temp=await mkdtemp(path.join(os.tmpdir(),'trace-agent-test-'));
process.env.TRACE_DATA_DIR=temp;
const {groundDecision,explore,observe}=await import('./agent.mjs');
const {createAiPlanner}=await import('./ai.mjs');
after(()=>rm(temp,{recursive:true,force:true}));
const decision=(action,ref='',value='')=>({action,ref,value,reason:'Recorded requirement'});
test('only current safe targets and supplied expected text are executable',()=>{
 const observation={targets:[{ref:'e1',role:'heading',name:'Welcome',canClick:false}]};
 assert.throws(()=>groundDecision(decision('click','e9'),observation,''));
 assert.throws(()=>groundDecision(decision('click','e1'),observation,''));
 assert.throws(()=>groundDecision(decision('assertText','e1','Invented'),observation,'Welcome'));
 assert.throws(()=>groundDecision({...decision('assertVisible','e1'),script:'fetch()'},observation,''));
 assert.equal(groundDecision(decision('assertText','e1','Welcome'),observation,'Welcome').target.name,'Welcome');
});
test('agent model requests share the daily quota and strict private response contract',async()=>{
 const db={};let request;
 const model=createAiPlanner({env:{AZURE_OPENAI_ENDPOINT:'https://example.cognitiveservices.azure.com/',AZURE_OPENAI_DEPLOYMENT:'trace-drafting'},db,save(){},client:{responses:{async create(body){request=body;return {status:'completed',output_text:JSON.stringify(decision('blocked'))};}}}});
 await model.decide({brief:'Inspect'},new AbortController().signal);
 assert.equal(request.store,false);assert.equal(request.text.format.strict,true);assert.equal(model.status().remainingToday,59);
 db.aiUsage.attempts=60;
 await assert.rejects(model.decide({},new AbortController().signal),{status:429});
});
test('real browser observations discover a changing menu and record replayable assertions',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
 const page=await browser.newPage();
 await page.route('http://example.test/**',route=>route.fulfill({body:'<html><body></body></html>',contentType:'text/html'}));
 await page.goto('http://example.test');
 await page.setContent('<h1>Home</h1><button onclick="document.querySelector(\'h1\').textContent=\'Welcome\'">Explore</button><form><button>Submit</button></form><a href="https://outside.test">Elsewhere</a>');
 const initial=await observe(page,new URL(page.url()).origin);
 assert.equal(initial.targets.find(t=>t.name==='Submit').canClick,false);
 assert.equal(initial.targets.find(t=>t.name==='Elsewhere').canClick,false);
 let calls=0;
 const result=await explore(page,{brief:'Check Welcome',signal:new AbortController().signal,decide:async({observation})=>{
 calls++;
 if(calls===1)return decision('click',observation.targets.find(t=>t.name==='Explore').ref);
 if(calls===2)return decision('assertText',observation.targets.find(t=>t.name==='Welcome').ref,'Welcome');
 return decision('finish');
 }});
 assert.equal(result.state,'completed');assert.equal(result.steps.length,2);assert.equal(result.actions[2].value,'Welcome');
 await assert.rejects(explore(page,{brief:'Welcome',signal:new AbortController().signal,decide:async()=>decision('finish')}),/without an executed assertion/);
 const failed=await explore(page,{brief:'Absent',signal:new AbortController().signal,decide:async({observation})=>decision('assertText',observation.targets.find(t=>t.name==='Welcome').ref,'Absent')});
 assert.equal(failed.state,'blocked');assert.equal(failed.steps[0].status,'blocked');
 }finally{await browser.close();}
});
