import { createHash } from 'node:crypto';
import { safeNavigation } from './policy.mjs';

const assertions = new Set(['assertVisible', 'assertText', 'assertUrl']);
const actions = new Set(['navigate', 'click', 'hover', 'fill', 'select', 'scrollIntoView', ...assertions]);
const roles = new Set(['button', 'link', 'textbox', 'checkbox', 'combobox', 'heading', 'tab']);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
function supportedAction(action) {
  if (!action || !actions.has(action.action)) return false;
  if (action.action === 'navigate' || action.action === 'assertUrl') {
    const value = action.action === 'navigate' ? action.url : action.value;
    if (!nonempty(value)) return false;
    try {
      const url = new URL(value, 'https://relative-target.invalid');
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && safeNavigation(url);
    } catch { return false; }
  }
  const target = action.target;
  if (!target || !(nonempty(target.selector) || (roles.has(target.role) && nonempty(target.name)))) return false;
  return !['assertText', 'fill', 'select'].includes(action.action) || typeof action.value === 'string' && (action.action !== 'assertText' || nonempty(action.value));
}

function inspect(spec, result) {
  const steps = result?.stepResults;
  if (!Array.isArray(steps) || steps.length !== spec.actions.length)
    return { state: 'blocked', summary: 'Replay did not report every journey step.' };
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].index !== i + 1 || steps[i].action !== spec.actions[i].action)
      return { state: 'blocked', summary: 'Replay step results do not match the saved journey.' };
  }
  if (result.status === 'passed' && steps.every(step => step.status === 'passed'))
    return { state: 'verified', summary: 'Every recorded step and assertion passed in an independent replay.' };
  const failed = steps.find(step => !['passed', 'not_run'].includes(step.status));
  if (!failed || result.status !== 'issues_found' || failed.status !== 'issues_found' || !assertions.has(failed.action))
    return { state: 'blocked', summary: 'Replay could not complete the recorded assertions.' };
  // Older journey results lack failure metadata. Their explicit text mismatch is
  // the only legacy error that proves an expectation was checked on a found target.
  const mismatch = failed.failureKind === 'assertion_mismatch' ||
    (!failed.failureKind && failed.action === 'assertText' && failed.summary === 'Expected visible text was not found.');
  if (!mismatch) return { state: 'blocked', summary: 'The assertion target or browser tool was unavailable.' };
  const previous = steps.slice(0, failed.index - 1);
  if (!previous.every(step => step.status === 'passed'))
    return { state: 'blocked', summary: 'Replay did not reach the failed assertion reliably.' };
  return { state: 'mismatch', failed, summary: failed.summary };
}

function fingerprint(spec, step) {
  const normalized = spec.actions.map(action => ({
    action: action.action, url: action.url ?? null, value: action.value ?? null,
    target: action.target ? { selector: action.target.selector ?? null, role: action.target.role ?? null, name: action.target.name ?? null } : null,
  }));
  return createHash('sha256').update(JSON.stringify({ goal: spec.acceptance ?? spec.name ?? '', actions: normalized, failedAssertion: step.index })).digest('hex');
}

async function attempt(runAttempt, spec, signal, number) {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  // The adapter observes this signal, closes its browser, and settles only after
  // cleanup. Await settlement even on cancellation so capacity is not released
  // while a replay still owns an active browser.
  const response = await runAttempt(structuredClone(spec), { signal, attempt: number });
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  // Keep both the original result and actual artifact metadata for review.
  return { attempt: number, result: response?.result ?? response, evidence: response?.evidence ?? [], trace: response?.trace ?? null };
}

/** runAttempt opens a fresh context, observes signal, and settles after cleanup. */
export async function verifyDiscoveredCase(spec, { runAttempt, signal } = {}) {
  const attempts = [];
  const finish = (verdict, summary, extra = {}) => ({ verdict, summary, attempts, ...extra });
  if (signal?.aborted) return finish('cancelled', 'Verification cancelled.');
  if (typeof runAttempt !== 'function' || spec?.kind !== 'journey' || !Array.isArray(spec.actions) ||
      !spec.actions.length || !spec.actions.some(action => assertions.has(action.action)) ||
      spec.actions.some(action => !supportedAction(action)))
    return finish('blocked', 'Verification requires a supported saved journey with explicit assertions.');
  try {
    const first = await attempt(runAttempt, spec, signal, 1); attempts.push(first);
    const initial = inspect(spec, first.result);
    if (initial.state !== 'mismatch') return finish(initial.state, initial.summary);
    const second = await attempt(runAttempt, spec, signal, 2); attempts.push(second);
    const repeated = inspect(spec, second.result);
    if (repeated.state !== 'mismatch' || fingerprint(spec, initial.failed) !== fingerprint(spec, repeated.failed))
      return finish('blocked', 'The assertion failure was not independently reproduced.');
    const key = fingerprint(spec, initial.failed);
    return finish('issues_found', 'The same recorded assertion failed in two independent replays.', {
      fingerprint: key,
      finding: {
        caseId: spec.id, name: spec.name, kind: 'bug', expected: spec.acceptance,
        actual: initial.failed.summary, details: first.result.details ?? [],
        reproSteps: spec.steps ?? spec.actions.map(action => JSON.stringify(action)),
        reproduction: 'reproduced', reproductionResult: second.result,
        evidence: [...first.evidence, ...second.evidence], fingerprint: key,
      },
    });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') return finish('cancelled', 'Verification cancelled.');
    return finish('blocked', 'An independent browser replay could not complete.');
  }
}
