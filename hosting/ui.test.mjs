import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('session UI preserves agent planning and downloadable trace evidence', async () => {
 const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
 try {
  const {SessionDetail,FindingDetail}=await vite.ssrLoadModule('/src/components/SessionDetail.tsx');
  const noop=()=>{};
  const session={id:'planned',name:'Agent plan',status:'ready',environmentName:'Demo',environmentId:'demo',url:'http://localhost/demo',updatedAt:new Date().toISOString(),history:[],cases:[],findings:[],activity:[],agent:{state:'planned',summary:'Awaiting explicit start',decisions:0,steps:[],evidence:[]}};
  const html=renderToStaticMarkup(React.createElement(SessionDetail,{session,onBack:noop,onRun:noop,onCancel:noop,onCase:noop,onFinding:noop,onAddCase:noop,onRemoveCase:noop,onEdit:noop,onDuplicate:noop}));
  assert.doesNotMatch(html,/Edit tests|Add case/);
  assert.doesNotMatch(html,/export\?format=yaml/);
  assert.match(html,/Start agent/);
  const finding={id:'finding',name:'Example',triage:'OPEN',reproduction:'confirmed',details:[],reproSteps:[],evidence:[{id:'trace',kind:'trace',url:'/evidence/browser.zip',caption:'Browser trace'}]};
  const evidence=renderToStaticMarkup(React.createElement(FindingDetail,{item:finding,onClose:noop,onTriage:noop,busy:false}));
  assert.match(evidence,/href="\/evidence\/browser.zip"[^>]*download/);
  assert.doesNotMatch(evidence,/<img[^>]*browser.zip/);
 } finally {await vite.close();}
});

test('history selection binds every export and browser trace to the preserved run',async()=>{
 const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
 try {
  const {SessionDetail}=await vite.ssrLoadModule('/src/components/SessionDetail.tsx');
  const noop=()=>{};const check={id:'a',name:'Case A',status:'passed',acceptance:'A',evidence:[]};
  const session={id:'session',name:'History',runId:'B',trace:'/B.zip',status:'passed',environmentName:'Demo',environmentId:'demo',url:'/demo',updatedAt:new Date().toISOString(),history:[{runId:'A',status:'passed',cases:[check],findings:[],trace:'/A.zip'}],cases:[{...check,name:'Case B'}],findings:[],activity:[]};
  const render=initialRun=>renderToStaticMarkup(React.createElement(SessionDetail,{session,initialRun,onBack:noop,onRun:noop,onCancel:noop,onCase:noop,onFinding:noop,onAddCase:noop,onRemoveCase:noop,onEdit:noop,onDuplicate:noop}));
  let html=render('A');assert.match(html,/format=yaml&amp;runId=A/);assert.match(html,/href="\/A.zip"/);assert.doesNotMatch(html,/href="\/B.zip"/);
  delete session.history[0].trace;html=render('A');assert.doesNotMatch(html,/Download browser trace/);
  html=render("unknown");assert.match(html,/Run not found/);assert.doesNotMatch(html,/export\?format|Download browser trace/);
  html=render();assert.match(html,/format=yaml&amp;runId=B/);assert.match(html,/href="\/B.zip"/);
 }finally{await vite.close();}
});

test('browser history interaction changes export and trace provenance',async()=>{
 const {chromium}=await import('playwright');
 const check={id:'a',name:'Case A',status:'passed',acceptance:'A',evidence:[]};
 const session={id:'session',name:'History',runId:'B',trace:'/B.zip',status:'passed',environmentName:'Demo',environmentId:'demo',url:'/demo',updatedAt:new Date().toISOString(),history:[{runId:'A',at:new Date().toISOString(),status:'passed',cases:[check],findings:[],trace:'/A.zip'}],cases:[{...check,name:'Case B'}],findings:[],activity:[]};
 const vite=await createServer({server:{host:'127.0.0.1',port:0},appType:'custom'});
 vite.middlewares.use('/history-fixture',async(req,res)=>{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/history-fixture',`<div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import {SessionDetail} from '/src/components/SessionDetail.tsx';const noop=()=>{};createRoot(document.getElementById('root')).render(React.createElement(SessionDetail,{session:${JSON.stringify(session)},onBack:noop,onRun:noop,onCancel:noop,onCase:noop,onFinding:noop,onAddCase:noop,onRemoveCase:noop,onEdit:noop,onDuplicate:noop}));</script>`));});
 let browser;
 try{
  await vite.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/history-fixture`);
  await page.getByRole('tab',{name:/History/}).click();await page.getByRole('button',{name:/Previous run 1/}).click();
  assert.equal(await page.getByRole('link',{name:'Export',exact:true}).getAttribute('href'),'/api/sessions/session/export?format=yaml&runId=A');
  assert.equal(await page.getByRole('link',{name:'Download browser trace',exact:true}).getAttribute('href'),'/A.zip');
  await page.getByRole('button',{name:'Session actions'}).click();
  assert.equal(await page.getByRole('link',{name:'JSON report'}).getAttribute('href'),'/api/sessions/session/export?format=json&runId=A');
  await page.getByRole('button',{name:'Return to latest'}).click();
  assert.equal(await page.getByRole('link',{name:'Download browser trace',exact:true}).getAttribute('href'),'/B.zip');
 }finally{await browser?.close();await vite.close();}
});
