import { randomUUID } from 'node:crypto';
import {workerFailure} from './agent-errors.mjs';

const pending = new Set(['queued', 'running']);
const retryable = new Set(['blocked', 'cancelled', 'interrupted']);
const runnable = item => item?.actions?.some(action => ['assertVisible', 'assertText'].includes(action.action));

/** Callbacks resolve only after their browser and evidence resources are cleaned up. */
export function createCoordinator({ save = () => {}, event, clock = () => new Date().toISOString(), capacity = {}, executeExplorer, executeVerifier, timeoutMs = 300000, pollMs = 100 }) {
  if (typeof executeExplorer !== 'function' || typeof executeVerifier !== 'function') throw Error('Coordinator requires both worker adapters.');
  const jobs = new Map();
  let persistenceFailure;
  const stamp = () => clock();
  const checkpoint = (session, message) => {
    if (persistenceFailure) return false;
    if (message) {
      session.team.events.push({ id: randomUUID(), at: stamp(), message });
    }
    try {
      if (message) event?.(session, 'coordinator', message);
      save();
      return true;
    } catch (error) {
      if (!error.code?.startsWith('TRACE_STORAGE_')) throw error;
      const job = jobs.get(session.id);
      if (!job) throw error;
      persistenceFailure = error;
      // Persistence is shared by every team. Stop admissions globally and keep
      // reservations only until each active adapter finishes its cleanup.
      for (const current of jobs.values()) {
        current.persistenceError = error;
        current.stopping = 'blocked';
        current.session.team.state = 'stopping';
        clearTimeout(current.deadline); clearTimeout(current.wakeup);
        for (const item of current.session.team.tasks) if (item.state === 'queued') { item.state = 'blocked'; item.finishedAt = stamp(); }
        for (const control of current.active.values()) control.abort();
      }
      for (const current of jobs.values()) if (current !== job && !current.active.size) finish(current);
      return false;
    }
  };
  const task = (role, goal, parentId) => ({ id: randomUUID(), parentId, goalId: goal.id, role, name: goal.name, brief: goal.brief, state: 'queued', startedAt: null, finishedAt: null });

  function finish(job) {
    const { session } = job;
    const team = session.team;
    if (job.active.size || (!job.stopping && team.tasks.some(item => pending.has(item.state)))) return;
    if (job.stopping) {
      team.state = job.stopping;
      team.summary = job.stopping === 'cancelled' ? 'All agents stopped.' : 'The team reached its time limit. Remaining work was stopped.';
    } else if (team.tasks.some(item => item.state === 'issues_found')) {
      team.state = 'issues_found'; team.summary = 'Independent verification found issues. Review the recorded results.';
    } else if (team.tasks.some(item => item.state === 'blocked')) {
      team.state = 'blocked'; team.summary = 'Some goals could not be completed or independently verified.';
    } else {
      const explorers = team.tasks.filter(item => item.role === 'explorer');
      const verified = explorers.every(item => item.state === 'completed' && team.tasks.some(child => child.parentId === item.id && child.state === 'verified'));
      team.state = verified ? 'verified' : 'blocked';
      team.summary = verified ? `${explorers.length} goals explored and independently verified.` : 'No fully verified result is available.';
    }
    team.finishedAt = stamp();
    clearTimeout(job.deadline); clearTimeout(job.wakeup);
    checkpoint(session, team.summary);
    if (job.persistenceError) { team.state = 'blocked'; team.summary = 'Workspace storage is unavailable. Work stopped; restore storage before retrying.'; }
    jobs.delete(session.id);
    job.resolve(team);
  }

  function stop(job, state) {
    if (job.stopping) return;
    job.stopping = state;
    job.session.team.state = state === 'cancelled' ? 'cancelling' : 'stopping';
    for (const item of job.session.team.tasks) if (item.state === 'queued') { item.state = state === 'cancelled' ? 'cancelled' : 'blocked'; item.finishedAt = stamp(); }
    for (const control of job.active.values()) control.abort();
    checkpoint(job.session, state === 'cancelled' ? 'Stopping all active agents.' : 'Team time limit reached; stopping all active agents.');
    finish(job);
  }

  function schedule(job) {
    if (jobs.get(job.session.id) !== job) return;
    clearTimeout(job.wakeup);
    if (job.stopping) { finish(job); return; }
    for (const item of job.session.team.tasks) {
      if (item.state !== 'queued' || job.active.size >= 2) continue;
      if ([...jobs.values()].reduce((count, current) => count + current.active.size, 0) >= 2) break;
      if (item.role === 'verifier' && job.session.team.tasks.some(parent => parent.id === item.parentId && pending.has(parent.state))) continue;
      if (capacity.available && !capacity.available()) break;
      const controller = new AbortController();
      const control = { signal: controller.signal, abort: () => controller.abort() };
      if (capacity.reserve?.(item, control) === false) break;
      job.active.set(item.id, control);
      item.state = 'running'; item.startedAt = stamp(); item.finishedAt = null;
      if (!checkpoint(job.session, `${item.role === 'explorer' ? 'Explorer' : 'Verifier'} started: ${item.name}`)) {
        item.state = 'blocked'; item.finishedAt = stamp();
        try { capacity.release?.(item); } finally { job.active.delete(item.id); }
        break;
      }
      void run(job, item, control);
    }
    finish(job);
    if (jobs.get(job.session.id) === job && !job.stopping && job.session.team.tasks.some(item => item.state === 'queued')) job.wakeup = setTimeout(() => schedule(job), pollMs);
  }

  async function run(job, item, control) {
    try {
      const execute = item.role === 'explorer' ? executeExplorer : executeVerifier;
      const result = await execute(item, { signal: control.signal, session: job.session });
      if (job.stopping || control.signal.aborted) {
        item.state = job.stopping === 'cancelled' ? 'cancelled' : 'blocked';
      } else {
        item.result = result;
        if (item.role === 'explorer') {
          item.state = result?.state === 'completed' && runnable(result.case) ? 'completed' : 'blocked';
          if (runnable(result?.case) && !job.session.team.tasks.some(child => child.parentId === item.id)) {
            const child = task('verifier', { id: item.goalId, name: item.name, brief: item.brief }, item.id);
            child.case = result.case;
            job.session.team.tasks.push(child);
          }
          const existing = job.session.team.tasks.find(child => child.parentId === item.id);
          if (existing) {
            if (runnable(result?.case)) existing.case = result.case;
            else { existing.state = 'blocked'; existing.summary = 'Exploration did not produce a runnable case.'; existing.finishedAt = stamp(); }
          }
        } else item.state = ['verified', 'issues_found', 'blocked'].includes(result?.state) ? result.state : 'blocked';
        item.summary = typeof result?.summary === 'string' ? result.summary.slice(0, 1000) : 'Worker completed without a summary.';
      }
    } catch (error) {
      item.state = job.stopping === 'cancelled' ? 'cancelled' : 'blocked';
      Object.assign(item, workerFailure(control.signal.aborted ? {code:'cancelled'} : error));
    } finally {
      // A cancellation cannot settle the parent before the adapter finishes cleanup.
      item.finishedAt = stamp();
      try { capacity.release?.(item); } catch { item.state = 'blocked'; item.summary = 'Worker capacity could not be released cleanly.'; } finally { job.active.delete(item.id); }
      checkpoint(job.session, `${item.role === 'explorer' ? 'Explorer' : 'Verifier'} ${item.state}: ${item.name}`);
      schedule(job);
    }
  }

  function launch(session) {
    if (persistenceFailure) throw persistenceFailure;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const job = { session, active: new Map(), resolve, promise, stopping: null };
    jobs.set(session.id, job);
    session.team.state = 'running'; session.team.finishedAt = null;
    job.deadline = setTimeout(() => stop(job, 'blocked'), Math.min(300000, timeoutMs));
    if (!checkpoint(session, 'Coordinator queued the requested work.')) { finish(job); throw job.persistenceError; }
    schedule(job);
    if (job.persistenceError) throw job.persistenceError;
    return session.team;
  }

  function start(session, goals) {
    if (persistenceFailure) throw persistenceFailure;
    if (!session?.id) throw Error('Session ID is required.');
    if (jobs.has(session.id) || (session.team && !(session.team.state === 'planned' && session.team.tasks?.length === 0))) throw Error('This session already has a team. Retry its existing work explicitly.');
    if (!Array.isArray(goals) || !goals.length || goals.length > 3) throw Error('Choose between one and three goals.');
    const normalized = goals.map(goal => {
      if (!goal || typeof goal.name !== 'string' || !goal.name.trim() || goal.name.length > 120 || typeof goal.brief !== 'string' || !goal.brief.trim() || goal.brief.length > 2000) throw Error('Each goal requires a name and brief within the session limits.');
      return { id: randomUUID(), name: goal.name.trim(), brief: goal.brief.trim() };
    });
    const teamId = randomUUID();
    const previous = session.team && structuredClone(session.team);
    session.team = { id: teamId, state: 'planned', summary: 'Ready to coordinate browser work.', tasks: normalized.map(goal => task('explorer', goal, teamId)), events: [], startedAt: stamp(), finishedAt: null };
    try { return launch(session); }
    catch (error) {
      if (error.code?.startsWith('TRACE_STORAGE_') && !jobs.has(session.id)) {
        if (previous) session.team = previous; else delete session.team;
      }
      throw error;
    }
  }

  function cancel(session) { const job = jobs.get(session.id); if (job) stop(job, 'cancelled'); return session.team; }
  function retry(session) {
    if (persistenceFailure) throw persistenceFailure;
    if (jobs.has(session.id)) throw Error('This team is already running.');
    if (!session.team?.tasks?.some(item => retryable.has(item.state))) throw Error('This team has no interrupted or blocked work to retry.');
    for (const item of session.team.tasks) if (retryable.has(item.state)) { item.state = 'queued'; delete item.result; delete item.failureKind; item.summary = null; }
    for (const item of session.team.tasks) if (item.role === 'verifier' && session.team.tasks.some(parent => parent.id === item.parentId && parent.state === 'queued')) { item.state = 'queued'; delete item.result; delete item.failureKind; }
    return launch(session);
  }
  function recover(sessions) {
    for (const session of sessions) {
      if (!session.team || jobs.has(session.id) || !['running', 'cancelling', 'stopping', 'planned'].includes(session.team.state)) continue;
      if (session.team.state === 'planned' && session.team.tasks?.length === 0) continue;
      for (const item of session.team.tasks) if (pending.has(item.state)) { item.state = 'interrupted'; item.finishedAt = stamp(); }
      session.team.state = 'interrupted'; session.team.summary = 'The server restarted. Retry explicitly to resume unfinished work.'; session.team.finishedAt = stamp();
      checkpoint(session, session.team.summary);
    }
  }
  return { start, cancel, retry, recover, whenIdle: sessionId => jobs.get(sessionId)?.promise || Promise.resolve(), isRunning: sessionId => jobs.has(sessionId) };
}
