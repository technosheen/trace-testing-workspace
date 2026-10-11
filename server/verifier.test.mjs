import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDiscoveredCase } from './verifier.mjs';

const spec = {
  id: 'journey-1', kind: 'journey', name: 'Pricing heading', acceptance: 'Pricing heading includes Plans.',
  actions: [{ action: 'navigate', url: 'https://example.com/pricing' }, { action: 'assertText', target: { role: 'heading', name: 'Pricing' }, value: 'Plans' }],
  steps: ['Open pricing.', 'Check the heading contains Plans.'],
};
const passed = () => ({ status: 'passed', stepResults: spec.actions.map((action, i) => ({ index: i + 1, action: action.action, status: 'passed', summary: 'Completed.' })) });
const mismatch = () => ({ status: 'issues_found', details: ['Observed expectation mismatch.'], stepResults: [{ index: 1, action: 'navigate', status: 'passed' }, { index: 2, action: 'assertText', status: 'issues_found', failureKind: 'assertion_mismatch', summary: 'Expected visible text was not found.' }] });

test('verifier requires actual matching step results and executed assertions', async () => {
  let calls = 0;
  const result = await verifyDiscoveredCase(spec, { runAttempt: async (input, options) => {
    calls++; assert.deepEqual(input, spec); assert.equal(options.attempt, 1);
    input.actions[1].value = 'mutated by runner';
    return { result: passed(), evidence: [{ url: '/artifacts/actual.png' }], trace: '/artifacts/actual.zip' };
  } });
  assert.equal(result.verdict, 'verified'); assert.equal(calls, 1);
  assert.equal(spec.actions[1].value, 'Plans'); assert.equal(result.attempts[0].trace, '/artifacts/actual.zip');
  assert.equal((await verifyDiscoveredCase({ ...spec, actions: [spec.actions[0]] }, { runAttempt: async () => passed() })).verdict, 'blocked');
  assert.equal((await verifyDiscoveredCase(spec, { runAttempt: async () => ({ status: 'passed' }) })).verdict, 'blocked');
  for (const actions of [[spec.actions[0], { action: 'assertVisible' }], [{ action: 'navigate', url: 'https://example.com/delete' }, spec.actions[1]], [{ action: 'navigate', url: 'javascript:alert(1)' }, spec.actions[1]]]) {
    let invoked = false;
    assert.equal((await verifyDiscoveredCase({ ...spec, actions }, { runAttempt: async () => { invoked = true; return passed(); } })).verdict, 'blocked');
    assert.equal(invoked, false);
  }
  const invented = passed(); invented.stepResults[1].action = 'assertVisible';
  assert.equal((await verifyDiscoveredCase(spec, { runAttempt: async () => invented })).verdict, 'blocked');
});

test('verifier confirms only the same reproducible assertion and fingerprints exact expectations', async () => {
  const numbers = [];
  const result = await verifyDiscoveredCase(spec, { runAttempt: async (_, { attempt }) => { numbers.push(attempt); return { result: mismatch(), evidence: [{ url: `/artifacts/${attempt}.png` }] }; } });
  assert.deepEqual(numbers, [1, 2]); assert.equal(result.verdict, 'issues_found');
  assert.equal(result.finding.reproduction, 'reproduced'); assert.equal(result.finding.expected, spec.acceptance);
  assert.equal(result.finding.evidence.length, 2); assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  const same = await verifyDiscoveredCase({ ...spec, id: 'new-id', name: 'Different presentation title' }, { runAttempt: async () => mismatch() });
  assert.equal(same.fingerprint, result.fingerprint);
  const changed = await verifyDiscoveredCase({ ...spec, actions: [spec.actions[0], { ...spec.actions[1], value: 'Other expectation' }] }, { runAttempt: async () => mismatch() });
  assert.notEqual(changed.fingerprint, result.fingerprint);
});

test('missing targets, changed selectors and tool timeouts are blocked, never bugs', async () => {
  for (const failureKind of ['target_unavailable', 'tool_error', undefined]) {
    let calls = 0;
    const result = await verifyDiscoveredCase(spec, { runAttempt: async () => {
      calls++; const output = mismatch(); Object.assign(output.stepResults[1], { failureKind, summary: 'locator.waitFor: Timeout 10000ms exceeded.' }); return output;
    } });
    assert.equal(result.verdict, 'blocked'); assert.equal(calls, 1); assert.equal(result.finding, undefined);
  }
  assert.equal((await verifyDiscoveredCase(spec, { runAttempt: async () => { throw Error('net::ERR_CONNECTION_RESET'); } })).verdict, 'blocked');
});

test('unstable assertion failures remain blocked', async () => {
  const result = await verifyDiscoveredCase(spec, { runAttempt: async (_, { attempt }) => attempt === 1 ? mismatch() : passed() });
  assert.equal(result.verdict, 'blocked'); assert.equal(result.attempts.length, 2); assert.equal(result.finding, undefined);
  const networkRetry = await verifyDiscoveredCase(spec, { runAttempt: async (_, { attempt }) => { if (attempt === 2) throw Error('Network unavailable'); return mismatch(); } });
  assert.equal(networkRetry.verdict, 'blocked'); assert.equal(networkRetry.attempts.length, 1);
});

test('cancellation never reports verification or a finding', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = verifyDiscoveredCase(spec, { signal: controller.signal, runAttempt: async () => { calls++; controller.abort(); return passed(); } });
  assert.equal((await pending).verdict, 'cancelled'); assert.equal(calls, 1);
  assert.equal((await verifyDiscoveredCase(spec, { signal: controller.signal, runAttempt: async () => { calls++; return passed(); } })).verdict, 'cancelled');
  assert.equal(calls, 1);
});

test('cancellation waits for independent browser adapter cleanup before settling', async () => {
  const controller = new AbortController();
  let releaseCleanup, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const cleanup = new Promise(resolve => { releaseCleanup = resolve; });
  let settled = false;
  const pending = verifyDiscoveredCase(spec, { signal: controller.signal, runAttempt: async (_, { signal }) => {
    const stopped = new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    entered(); await stopped; await cleanup; return passed();
  } }).then(result => { settled = true; return result; });
  await ready; controller.abort();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  releaseCleanup();
  assert.equal((await pending).verdict, 'cancelled');
});
