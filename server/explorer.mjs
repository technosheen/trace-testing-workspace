import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { manifestSchema } from './manifest.mjs';

const briefText = z.string().trim().min(1).max(2000);
const flowSchema = z.object({ name: z.string().trim().min(1).max(120), brief: briefText }).strict();
const inputSchema = z.object({ brief: briefText, flows: z.array(flowSchema).max(3).default([]) }).strict();

// Decompose only explicit user-authored lists. Never ask a model to invent coverage.
export function buildExplorationGoals(input) {
  const { brief, flows } = inputSchema.parse(input);
  if (flows.length) return flows.map((flow, index) => ({ id: `flow-${index + 1}`, ...flow }));
  const lines = brief.split('\n');
  const starts = lines.flatMap((line, index) => /^\s*(?:\d+[.)]|[-*•])\s+\S/.test(line) ? [index] : []);
  if (starts.length < 2 || starts.length > 3) return [{ id: 'flow-1', name: 'Explore supplied brief', brief }];
  const preamble = lines.slice(0, starts[0]).join('\n').trim();
  return starts.map((start, index) => {
    const content = lines.slice(start, starts[index + 1] ?? lines.length).join('\n').replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '').trim();
    return { id: `flow-${index + 1}`, name: content.split('\n')[0].slice(0, 120), brief: [preamble, content].filter(Boolean).join('\n') };
  });
}

function sameAction(action, step) {
  return action.action === step.action && JSON.stringify(action.target ?? null) === JSON.stringify(step.target ?? null) && (action.value ?? '') === (step.value ?? '');
}

export function discoveredCase(result, { name, goalId }) {
  if (!result || !Array.isArray(result.actions) || !Array.isArray(result.steps)) return null;
  const actions = structuredClone(result.actions);
  if (actions.some(action => !['navigate', 'click', 'assertVisible', 'assertText', 'assertUrl'].includes(action.action))) return null;
  // Each non-navigation action must have been attempted, including failed assertions.
  const attempted = result.steps.filter(step => ['passed', 'blocked', 'failed'].includes(step.status));
  const executable = actions.filter(action => action.action !== 'navigate');
  if (executable.length !== attempted.length || executable.some((action, index) => !sameAction(action, attempted[index]))) return null;
  if (!executable.some(action => ['assertVisible', 'assertText', 'assertUrl'].includes(action.action))) return null;
  const check = { kind: 'journey', name, acceptance: 'Replay the observed navigation and recorded assertions.', preconditions: ['Read-only public page reachable.', 'Discovered scope is limited to the recorded steps.'], actions };
  const validated = manifestSchema.safeParse({ schema: 'trace/test/v2', name: 'Discovered journey', policy: 'read-only', checks: [check] });
  if (!validated.success) return null;
  return { ...validated.data.checks[0], id: randomUUID(), steps: actions.map(action => `${action.action}: ${action.target?.name || action.url || action.value || ''}`), status: 'not_run', controls: [], evidence: [], result: null,
    discovery: { role: 'explorer', goalId, state: result.state, summary: result.summary, attemptedSteps: structuredClone(result.steps), independentlyVerified: false } };
}

export function summarizeExploration(results) {
  const entries = results.map(entry => entry.result ?? entry);
  const completed = entries.filter(result => result.state === 'completed').length;
  const blocked = entries.filter(result => result.state === 'blocked').length;
  const limited = entries.filter(result => result.state === 'limited').length;
  const cancelled = entries.filter(result => ['cancelled', 'interrupted'].includes(result.state)).length;
  const assertions = entries.reduce((total, result) => total + (result.steps ?? []).filter(step => step.action?.startsWith('assert') && step.status === 'passed').length, 0);
  return { total: entries.length, completed, blocked, limited, cancelled, assertions, independentlyVerified: false,
    summary: `${completed} of ${entries.length} exploration goals completed; ${blocked} blocked, ${limited} budget-limited, ${cancelled} stopped. ${assertions} assertions passed during exploration. Independent replay is required to verify discovered tests.` };
}
