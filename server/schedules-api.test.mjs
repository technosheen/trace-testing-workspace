import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
test('schedule API persists cron, rejects invalid cadence, and preserves interval schedules', {timeout:20000}, async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'trace-schedule-'));
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:String(port),TRACE_DATA_DIR:dir,TRACE_TEST:'1'},stdio:'ignore'});
 const base=`http://127.0.0.1:${port}/api`;
 const api=async(endpoint,method='GET',body)=>{const res=await fetch(base+endpoint,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()}};
 try {
  let started=false;for(let i=0;i<80;i++){try{if((await api('/health')).status===200){started=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(started);
  const common={name:'Weekday morning',environmentId:'demo',mode:'smoke'};
  const created=await api('/schedules','POST',{...common,scheduleType:'cron',cronExpression:'0 9 * * 1-5',timeZone:'America/New_York'});
  assert.equal(created.status,201);assert.equal(created.data.timeZone,'America/New_York');assert.ok(Date.parse(created.data.nextRunAt)>Date.now());
  const paused=await api(`/schedules/${created.data.id}`,'PATCH',{enabled:false});assert.equal(paused.status,200);assert.equal(paused.data.enabled,false);assert.equal(paused.data.cronExpression,'0 9 * * 1-5');
  const rejected=await api(`/schedules/${created.data.id}`,'PATCH',{cronExpression:'*/15 * * * *'});assert.equal(rejected.status,400);
  const items=(await api('/workspace')).data.schedules;assert.equal(items.find(s=>s.id===created.data.id).cronExpression,'0 9 * * 1-5');
  for (const bad of [{cronExpression:'* * * * *'},{timeZone:'invalid'},{cronExpression:'0 9 31 2 *'}]) assert.equal((await api('/schedules','POST',{...common,scheduleType:'cron',cronExpression:'0 9 * * *',timeZone:'UTC',...bad})).status,400);
  const interval=await api('/schedules','POST',{...common,intervalHours:24});assert.equal(interval.status,201);assert.equal(interval.data.scheduleType,'interval');assert.equal(interval.data.intervalHours,24);
  const switched=await api(`/schedules/${created.data.id}`,'PATCH',{scheduleType:'interval',intervalHours:6});assert.equal(switched.status,200);assert.equal(switched.data.intervalHours,6);assert.equal(switched.data.cronExpression,undefined);
 } finally {const exit=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exit;await rm(dir,{recursive:true,force:true})}
});
