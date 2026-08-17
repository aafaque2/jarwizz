const { randomUUID } = require('crypto');
const { classifyPlan } = require('../guardrails/classifier');
const { logAction } = require('../guardrails/logger');

let stopFlag = false;

// Pending irreversible steps awaiting approval: step_id → { resolve, reject }
const pendingApprovals = new Map();

function requestStop() {
  stopFlag = true;
}

function resetStop() {
  stopFlag = false;
}

function isStopped() {
  return stopFlag;
}

/**
 * Ask the user for approval on an irreversible step.
 * Returns a Promise that resolves with 'approved' or 'rejected'.
 */
function requestApproval(step) {
  return new Promise((resolve) => {
    pendingApprovals.set(step.step_id, { resolve });
  });
}

/**
 * Approve a pending step by step_id.
 */
function approveStep(stepId) {
  const pending = pendingApprovals.get(stepId);
  if (pending) {
    pending.resolve('approved');
    pendingApprovals.delete(stepId);
    return true;
  }
  return false;
}

/**
 * Reject a pending step by step_id.
 */
function rejectStep(stepId) {
  const pending = pendingApprovals.get(stepId);
  if (pending) {
    pending.resolve('rejected');
    pendingApprovals.delete(stepId);
    return true;
  }
  return false;
}

/**
 * Execute a classified plan step-by-step.
 * read-only/reversible → auto-execute + log
 * irreversible → pause for approval, then execute or skip
 */
async function runPlan(plan, broadcast) {
  resetStop();

  const classified = classifyPlan(plan);
  const taskId = randomUUID();
  const results = [];

  for (let i = 0; i < classified.steps.length; i++) {
    if (isStopped()) {
      const skipResult = {
        step_id: classified.steps[i].step_id,
        step_index: i,
        ...classified.steps[i],
        status: 'skipped',
        reason: 'stopped',
        timestamp: new Date().toISOString(),
      };
      results.push(skipResult);
      logAction({ task_id: taskId, ...skipResult, approval_status: 'auto', result: 'failure', error: 'stopped' });
      if (broadcast) broadcast('step_skipped', skipResult);
      console.log(`  [STOPPED] Skipping step ${i + 1}: ${classified.steps[i].description}`);
      continue;
    }

    const step = classified.steps[i];
    console.log(`  [${step.tier.toUpperCase()}] Step ${i + 1}/${classified.steps.length}: ${step.description}`);

    if (step.tier === 'irreversible') {
      // Emit approval request and wait
      const approvalPayload = {
        task_id: taskId,
        step_id: step.step_id,
        step_index: i,
        description: step.description,
        action_type: step.action_type,
        tier: step.tier,
        payload: step.payload,
      };

      if (broadcast) broadcast('pending_approval', approvalPayload);
      console.log(`  [APPROVAL NEEDED] Step ${i + 1}: ${step.description}`);

      const decision = await requestApproval(step);

      if (decision === 'approved') {
        const stepResult = {
          step_id: step.step_id,
          step_index: i,
          ...step,
          status: 'completed',
          approval_status: 'approved',
          timestamp: new Date().toISOString(),
        };
        results.push(stepResult);
        logAction({ task_id: taskId, ...stepResult, result: 'success' });
        if (broadcast) broadcast('step_completed', stepResult);
        console.log(`  [APPROVED] Step ${i + 1}: ${step.description}`);
      } else {
        const skipResult = {
          step_id: step.step_id,
          step_index: i,
          ...step,
          status: 'rejected',
          approval_status: 'rejected',
          timestamp: new Date().toISOString(),
        };
        results.push(skipResult);
        logAction({ task_id: taskId, ...skipResult, result: 'failure', error: 'user_rejected' });
        if (broadcast) broadcast('step_rejected', skipResult);
        console.log(`  [REJECTED] Step ${i + 1}: ${step.description}`);
      }
    } else {
      // read-only or reversible: auto-execute
      const stepResult = {
        step_id: step.step_id,
        step_index: i,
        ...step,
        status: 'completed',
        approval_status: 'auto',
        timestamp: new Date().toISOString(),
      };
      results.push(stepResult);
      logAction({ task_id: taskId, ...stepResult, result: 'success' });
      if (broadcast) broadcast('step_completed', stepResult);
    }
  }

  return { task_id: taskId, results };
}

module.exports = { requestStop, resetStop, isStopped, runPlan, approveStep, rejectStep };
