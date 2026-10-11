import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoordinator } from './coordinator.mjs';

const goal = name => ({ name, brief: `Verify ${name}` });
const check = { actions: [{ action: 'navigate', url: 'https://example.test' }, { action: 'assertText', target: { role: 'heading', name: 'Welcome' }, value: 'Welcome' }] };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const options = overrides => ({ executeExplorer: async () => ({ state: 'completed', case: check }), executeVerifier: async () => ({ state: 'verified' }), pollMs: 5, ...overrides });

test('unstarted planned sessions survive recovery and start only on an explicit request', async () => {
  const coordinator = createCoordinator(options());
  const session = { id: 'planned', team: { state: 'planned', goals: [goal('Home')], tasks: [], events: [], summary: 'Ready.' } };
  coordinator.recover([session]);
  assert.equal(session.team.state, 'planned'); assert.equal(session.team.tasks.length, 0);
  coordinator.start(session, [goal('x'.repeat(120))]); await coordinator.whenIdle(session.id);
  assert.equal(session.team.state, 'verified');
});

test('two parent sessions share a global two-worker limit even without an external adapter', async () => {
  let active = 0, peak = 0;
  const coordinator = createCoordinator(options({ executeExplorer: async () => { active++; peak = Math.max(peak, active); await tick(); active--; return { state: 'completed', case: check }; } }));
  const first = { id: 'first' }, second = { id: 'second' };
  coordinator.start(first, [goal('One'), goal('Two')]); coordinator.start(second, [goal('Three'), goal('Four')]);
  await Promise.all([coordinator.whenIdle(first.id), coordinator.whenIdle(second.id)]);
  assert.equal(peak, 2); assert.equal(first.team.state, 'verified'); assert.equal(second.team.state, 'verified');
});

test('coordinator persists real parent-child tasks and respects both local and external capacity', async () => {
  let occupied = 1, peak = 1, saves = 0;
  const releaseExternal = deferred();
  const coordinator = createCoordinator(options({
    save: () => saves++,
    capacity: { available: () => occupied < 2, reserve: () => { occupied++; peak = Math.max(peak, occupied); }, release: () => { occupied--; } },
    executeExplorer: async () => { await releaseExternal.promise; return { state: 'completed', case: check }; },
  }));
  const session = { id: 'capacity' };
  coordinator.start(session, [goal('Home'), goal('Docs'), goal('Menu')]);
  assert.equal(session.team.tasks.filter(task => task.state === 'running').length, 1);
  occupied--; releaseExternal.resolve();
  await coordinator.whenIdle(session.id);
  assert.equal(peak, 2); assert.equal(occupied, 0);
  assert.equal(session.team.state, 'verified');
  assert.equal(session.team.tasks.length, 6);
  assert.equal(session.team.tasks.filter(task => task.role === 'verifier').every(task => session.team.tasks.some(parent => parent.id === task.parentId && parent.role === 'explorer')), true);
  assert.ok(saves >= 14);
});

test('duplicate starts and excessive goals cannot enqueue additional work', async () => {
  const gate = deferred();
  const coordinator = createCoordinator(options({ executeExplorer: async () => { await gate.promise; return { state: 'blocked' }; } }));
  const session = { id: 'duplicates' };
  coordinator.start(session, [goal('Home')]);
  assert.throws(() => coordinator.start(session, [goal('Again')]), /already/);
  assert.throws(() => coordinator.retry(session), /already running/);
  assert.throws(() => coordinator.start({ id: 'too-many' }, [goal('1'), goal('2'), goal('3'), goal('4')]), /three/);
  gate.resolve(); await coordinator.whenIdle(session.id);
  assert.equal(session.team.tasks.length, 1);
});

test('cancellation signals children, cancels queue, and waits for browser cleanup even when workers return success', async () => {
  const cleanup = deferred(); let signalled = 0, released = 0;
  const coordinator = createCoordinator(options({
    capacity: { release: () => released++ },
    executeExplorer: async (_task, { signal }) => { signal.addEventListener('abort', () => signalled++); await cleanup.promise; return { state: 'completed', case: check }; },
  }));
  const session = { id: 'cancel' };
  coordinator.start(session, [goal('1'), goal('2'), goal('3')]);
  const idle = coordinator.whenIdle(session.id); let settled = false; idle.then(() => { settled = true; });
  coordinator.cancel(session); await tick();
  assert.equal(signalled, 2); assert.equal(session.team.state, 'cancelling'); assert.equal(settled, false);
  assert.equal(session.team.tasks[2].state, 'cancelled');
  cleanup.resolve(); await idle;
  assert.equal(session.team.state, 'cancelled'); assert.equal(released, 2); assert.equal(session.team.tasks.length, 3);
  assert.equal(session.team.tasks.every(task => task.state === 'cancelled'), true);
});

test('restart marks unfinished work interrupted and executes nothing until explicit retry', async () => {
  let calls = 0;
  const coordinator = createCoordinator(options({ executeExplorer: async () => { calls++; return { state: 'completed', case: check }; } }));
  const session = { id: 'restart', team: { state: 'running', tasks: [{ id: 'e1', parentId: 'team', goalId: 'g', role: 'explorer', name: 'Home', brief: 'Home', state: 'running' }, { id: 'e2', parentId: 'team', goalId: 'g2', role: 'explorer', name: 'Docs', brief: 'Docs', state: 'queued' }], events: [] } };
  coordinator.recover([session]);
  assert.equal(calls, 0); assert.equal(session.team.state, 'interrupted');
  assert.equal(session.team.tasks.every(task => task.state === 'interrupted'), true);
  coordinator.retry(session); await coordinator.whenIdle(session.id);
  assert.equal(calls, 2); assert.equal(session.team.state, 'verified');
});

test('blocked exploration and reproduced issues remain distinct from verified completion', async () => {
  const coordinator = createCoordinator(options({ executeExplorer: async task => task.name === 'Blocked' ? { state: 'blocked', summary: 'Login required.' } : { state: 'completed', case: check }, executeVerifier: async () => ({ state: 'issues_found', summary: 'Assertion reproduced.' }) }));
  const session = { id: 'partial' };
  coordinator.start(session, [goal('Blocked'), goal('Issue')]); await coordinator.whenIdle(session.id);
  assert.equal(session.team.state, 'issues_found');
  assert.equal(session.team.tasks.length, 3);
  assert.equal(session.team.tasks.filter(task => task.state === 'blocked').length, 1);
  assert.equal(session.team.tasks.filter(task => task.state === 'issues_found').length, 1);
});

test('explicit retry waits for updated exploration before replaying its replacement case', async () => {
  let attempt = 0, replayed;
  const coordinator = createCoordinator(options({ executeExplorer: async () => ({ state: ++attempt === 1 ? 'blocked' : 'completed', case: { ...check, name: `attempt-${attempt}` } }), executeVerifier: async task => { replayed = task.case.name; return { state: 'verified' }; } }));
  const session = { id: 'retry' };
  coordinator.start(session, [goal('Home')]); await coordinator.whenIdle(session.id);
  assert.equal(session.team.state, 'blocked'); assert.equal(replayed, 'attempt-1');
  coordinator.retry(session); await coordinator.whenIdle(session.id);
  assert.equal(session.team.state, 'verified'); assert.equal(replayed, 'attempt-2'); assert.equal(session.team.tasks.length, 2);
});

test('deadline stops work without marking it verified and waits for cleanup', async () => {
  const cleanup = deferred(); let signal;
  const coordinator = createCoordinator(options({ timeoutMs: 10, executeExplorer: async (_task, context) => { signal = context.signal; await cleanup.promise; return { state: 'completed', case: check }; } }));
  const session = { id: 'deadline' };
  coordinator.start(session, [goal('Home')]); const idle = coordinator.whenIdle(session.id);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(signal.aborted, true); assert.equal(session.team.state, 'stopping');
  cleanup.resolve(); await idle;
  assert.equal(session.team.state, 'blocked'); assert.equal(session.team.tasks.length, 1);
});

test('worker failures retain allowlisted diagnostics without exposing provider or page secrets',async()=>{
 const coordinator=createCoordinator(options({executeExplorer:async()=>{throw Object.assign(Error('private credential page content'),{code:'invalid_target'});}}));
 const session={id:'diagnostic'};
 coordinator.start(session,[goal('Home')]);await coordinator.whenIdle(session.id);
 assert.equal(session.team.tasks[0].failureKind,'invalid_target');
 assert.match(session.team.tasks[0].summary,/current observation/i);
 assert.doesNotMatch(JSON.stringify(session.team),/private credential/);
});

test('retry clears obsolete failure diagnostics after successful work', async () => {
 let first=true;
 const coordinator=createCoordinator(options({executeExplorer:async()=>{if(first){first=false;throw Object.assign(new Error('target absent'),{code:'invalid_target'});}return {state:'completed',case:check};}}));
 const session={id:'diagnostic-retry'};
 coordinator.start(session,[goal('Home')]);await coordinator.whenIdle(session.id);
 assert.equal(session.team.tasks[0].failureKind,'invalid_target');
 coordinator.retry(session);await coordinator.whenIdle(session.id);
 assert.equal(session.team.state,'verified');
 assert.equal(session.team.tasks[0].failureKind,undefined);
});

test('persistence failure during work aborts siblings and releases coordinator capacity', async () => {
 let broken=false,releases=0;
 const coordinator=createCoordinator(options({save(){if(broken)throw Object.assign(Error('private storage path'),{code:'TRACE_STORAGE_STALE'});},capacity:{release(){releases++;}},executeExplorer:async()=>{await tick();broken=true;return {state:'completed',case:check};}}));
 const session={id:'storage-outage'};
 coordinator.start(session,[goal('Home'),goal('Menu')]);
 await Promise.race([coordinator.whenIdle(session.id),new Promise((_,reject)=>setTimeout(()=>reject(Error('cleanup did not settle')),500))]);
 assert.equal(coordinator.isRunning(session.id),false);
 assert.equal(session.team.state,'blocked');
 assert.equal(releases,2);
});

test('failed worker admission releases its reservation and rejects without launching a worker', async () => {
 let saves=0,reserved=0,workers=0;
 const outage=Object.assign(Error('private storage path'),{code:'TRACE_STORAGE_WRITE_FAILED'});
 const coordinator=createCoordinator(options({save(){if(++saves===2)throw outage;},capacity:{reserve(){reserved++;},release(){reserved--;}},executeExplorer:async()=>{workers++;return {};}}));
 const session={id:'failed-admission',team:{state:'planned',tasks:[],events:[],goals:[goal('Home')]}};
 const before=structuredClone(session.team);
 assert.throws(()=>coordinator.start(session,[goal('Home')]),error=>error===outage);
 await coordinator.whenIdle(session.id);
 assert.equal(reserved,0);assert.equal(workers,0);assert.equal(coordinator.isRunning(session.id),false);
 assert.deepEqual(session.team,before);
 assert.throws(()=>coordinator.start({id:'another'},[goal('Home')]),error=>error===outage);
});

test('shared storage failure aborts another team and holds reservations until cleanup', async () => {
 let broken=false,reserved=0,aborted=0;
 const first=deferred(),second=deferred();
 const coordinator=createCoordinator(options({save(){if(broken)throw Object.assign(Error('storage outage'),{code:'TRACE_STORAGE_STALE'});},capacity:{reserve(){reserved++;},release(){reserved--;}},executeExplorer:async(task,{signal})=>{signal.addEventListener('abort',()=>aborted++);await (task.name==='First'?first:second).promise;return {state:'blocked'};}}));
 const a={id:'team-a'},b={id:'team-b'};
 coordinator.start(a,[goal('First')]);coordinator.start(b,[goal('Second')]);
 const idleA=coordinator.whenIdle(a.id),idleB=coordinator.whenIdle(b.id);
 broken=true;first.resolve();await idleA;
 assert.equal(aborted,1);assert.equal(reserved,1);assert.equal(coordinator.isRunning(b.id),true);
 second.resolve();await idleB;
 assert.equal(reserved,0);assert.equal(coordinator.isRunning(b.id),false);assert.equal(b.team.state,'blocked');
 assert.doesNotMatch(JSON.stringify(b.team),/storage outage/);
});
