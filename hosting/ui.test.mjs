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
