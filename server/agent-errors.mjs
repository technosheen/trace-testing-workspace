// Only these fixed messages may cross the worker boundary. Provider errors and
// page content can contain secrets; never persist or echo their raw messages.
const messages = {
  invalid_decision: 'AI returned an invalid browser decision. Retry this flow.',
  invalid_target: 'Agent selected a target absent from the current observation.',
  unsafe_action: 'This target is outside the read-only action policy.',
  unsupplied_expectation: 'Expected text must be copied from the supplied requirements.',
  premature_finish: 'Agent cannot finish without an executed assertion.',
  repeated_action: 'Agent repeated an action without making progress.',
  target_changed: 'Observed target changed before execution.',
  action_timeout: 'Browser action reached its timeout. The target may be covered or unavailable.',
  action_failed: 'Browser action could not complete. Review the recorded browser trace.',
  assertion_mismatch: 'Expected text was not visible on the observed target.',
  scope_violation: 'Navigation left the allowed scope.',
  ai_unavailable: 'AI service could not complete the decision. Retry when available.',
  ai_timeout: 'AI decision reached its time limit. Retry this flow.',
  ai_busy: 'Another AI request is active. Wait for it to finish.',
  ai_rate_limit: 'AI provider is busy or its quota is exhausted. Retry shortly.',
  ai_quota: 'Daily AI request limit reached. Retry after the daily reset.',
  cancelled: 'Agent was stopped.',
  worker_failed: 'Worker could not complete. Review its evidence or retry.',
};
export function agentError(code) {
  const safeCode = Object.hasOwn(messages, code) ? code : 'worker_failed';
  return Object.assign(new Error(messages[safeCode]), {code: safeCode});
}
export function workerFailure(error) {
  const safe = agentError(error?.code);
  return {failureKind: safe.code, summary: safe.message};
}
