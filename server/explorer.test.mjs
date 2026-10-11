import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExplorationGoals, discoveredCase, summarizeExploration } from './explorer.mjs';

test('Explorer decomposes only explicit supplied flows and preserves requirement context', () => {
  const goals = buildExplorationGoals({ brief: 'Target https://example.com; expect exact supplied content.\n1. Open About\n   Assert Our team\n2. Open Products\n   Assert Catalog' });
  assert.equal(goals.length, 2);
  assert.equal(goals[0].brief, 'Target https://example.com; expect exact supplied content.\nOpen About\n   Assert Our team');
  assert.equal(goals[1].brief, 'Target https://example.com; expect exact supplied content.\nOpen Products\n   Assert Catalog');
  assert.deepEqual(buildExplorationGoals({ brief: 'Visit the site and investigate navigation.' }), [{ id: 'flow-1', name: 'Explore supplied brief', brief: 'Visit the site and investigate navigation.' }]);
  assert.equal(buildExplorationGoals({ brief: '- A\n- B\n- C\n- D' }).length, 1);
  assert.throws(() => buildExplorationGoals({ brief: 'Explore', flows: Array.from({length:4}, () => ({name:'Flow',brief:'Original expected text'})) }));
  assert.deepEqual(buildExplorationGoals({ brief: 'Overall', flows: [{name:'Named flow',brief:'Exact expectation https://example.com/a'}] }), [{id:'flow-1',name:'Named flow',brief:'Exact expectation https://example.com/a'}]);
});

test('Explorer saves only recorded assertion journeys and preserves failed attempts', () => {
  const target = {role:'heading',name:'About'};
  const result = {state:'blocked',summary:'Expected text missing',actions:[{action:'navigate',url:'https://example.com/'},{action:'assertText',target,value:'Our team'}],steps:[{action:'assertText',target,value:'Our team',status:'blocked'}]};
  const saved = discoveredCase(result, {name:'About journey',goalId:'flow-1'});
  assert.ok(saved);
  assert.deepEqual(saved.actions, result.actions);
  assert.equal(saved.status, 'not_run');
  assert.equal(saved.discovery.attemptedSteps[0].status, 'blocked');
  assert.equal(saved.discovery.independentlyVerified, false);
  saved.actions[1].value = 'changed';
  assert.equal(result.actions[1].value, 'Our team');
  assert.equal(discoveredCase({...result,steps:[]},{name:'Unexecuted',goalId:'flow-1'}), null);
  assert.equal(discoveredCase({...result,steps:[{...result.steps[0],target:{role:'heading',name:'Invented'}}]},{name:'Mismatch',goalId:'flow-1'}), null);
  assert.equal(discoveredCase({state:'completed',actions:[{action:'navigate',url:'https://example.com/'}],steps:[]},{name:'No assertions',goalId:'flow-1'}), null);
  assert.equal(discoveredCase({...result,actions:[...result.actions,{action:'fill',target:{role:'textbox',name:'Email'},value:'invented'}],steps:[...result.steps,{action:'fill',target:{role:'textbox',name:'Email'},value:'invented',status:'passed'}]},{name:'Unsupported',goalId:'flow-1'}),null);
});

test('Explorer summary distinguishes partial coverage from verification', () => {
  const summary = summarizeExploration([{result:{state:'completed',steps:[{action:'assertVisible',status:'passed'}]}},{state:'blocked',steps:[{action:'assertText',status:'blocked'}]},{state:'limited'},{state:'cancelled'}]);
  assert.equal(summary.total,4);
  assert.equal(summary.completed,1);
  assert.equal(summary.blocked,1);
  assert.equal(summary.limited,1);
  assert.equal(summary.cancelled,1);
  assert.equal(summary.assertions,1);
  assert.equal(summary.independentlyVerified,false);
  assert.match(summary.summary,/Independent replay is required/);
});
