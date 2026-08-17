const { randomUUID } = require('crypto');
const { classifyPlan } = require('../guardrails/classifier');
const { logAction } = require('../guardrails/logger');
const { enforceDomainWhitelist } = require('../guardrails/whitelist');
const { chooseChannel } = require('../router/chooseChannel');
const { executeBrowserAction } = require('../automation/browser/handlers');
const { closeBrowser } = require('../automation/browser/playwrightRunner');
const { readRecentEmails, draftEmail, sendEmail } = require('../integrations/gmail/client');

let stopFlag = false;
const pendingApprovals = new Map();

function requestStop() { stopFlag = true; }
function resetStop() { stopFlag = false; }
function isStopped() { return stopFlag; }

function requestApproval(step) {
  return new Promise((resolve) => { pendingApprovals.set(step.step_id, { resolve }); });
}

function approveStep(stepId) {
  const pending = pendingApprovals.get(stepId);
  if (pending) { pending.resolve('approved'); pendingApprovals.delete(stepId); return true; }
  return false;
}

function rejectStep(stepId) {
  const pending = pendingApprovals.get(stepId);
  if (pending) { pending.resolve('rejected'); pendingApprovals.delete(stepId); return true; }
  return false;
}

/**
 * Execute a single step via the appropriate channel.
 */
async function executeStep(step, sharedPages) {
  const channel = chooseChannel(step);

  if (channel === 'browser') {
    const domain = (step.payload?.url || step.payload?.target || 'default').replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    if (!sharedPages[domain]) {
      const { newPage } = require('../automation/browser/playwrightRunner');
      sharedPages[domain] = await newPage();
    }
    const result = await executeBrowserAction(step.action_type, step.payload || {}, sharedPages[domain]);
    return { channel, ...result };
  }

  if (channel === 'api') {
    const p = step.payload || {};
    switch (step.action_type) {
      case 'gmail_read': {
        const emails = await readRecentEmails(p.count || 3);
        return { channel, output: { emails }, screenshotBefore: null, screenshotAfter: null };
      }
      case 'gmail_draft': {
        const draft = await draftEmail(p.to, p.subject, p.body);
        return { channel, output: { draft }, screenshotBefore: null, screenshotAfter: null };
      }
      case 'gmail_send': {
        const sent = await sendEmail(p.draft_id);
        return { channel, output: { sent }, screenshotBefore: null, screenshotAfter: null };
      }
      default:
        return { channel, output: { simulated: true }, screenshotBefore: null, screenshotAfter: null };
    }
  }

  // Desktop — future phases
  return { channel, output: { simulated: true }, screenshotBefore: null, screenshotAfter: null };
}

async function runPlan(plan, broadcast) {
  resetStop();

  const classified = classifyPlan(plan);
  // Enforce domain whitelist on browser steps
  classified.steps = classified.steps.map(s => {
    const channel = chooseChannel(s);
    if (channel === 'browser') return enforceDomainWhitelist(s);
    return s;
  });

  const taskId = randomUUID();
  const results = [];
  const sharedPages = {};

  for (let i = 0; i < classified.steps.length; i++) {
    if (isStopped()) {
      const skipResult = {
        step_id: classified.steps[i].step_id, step_index: i,
        ...classified.steps[i], status: 'skipped', reason: 'stopped',
        timestamp: new Date().toISOString(),
      };
      results.push(skipResult);
      logAction({ task_id: taskId, ...skipResult, approval_status: 'auto', result: 'failure', error: 'stopped' });
      if (broadcast) broadcast('step_skipped', skipResult);
      console.log(`  [STOPPED] Skipping step ${i + 1}`);
      continue;
    }

    const step = classified.steps[i];
    const channel = chooseChannel(step);
    console.log(`  [${step.tier.toUpperCase()}] Step ${i + 1}/${classified.steps.length}: ${step.description} (via ${channel})`);

    // Approval gate for irreversible steps
    if (step.tier === 'irreversible') {
      const approvalPayload = {
        task_id: taskId, step_id: step.step_id, step_index: i,
        description: step.description, action_type: step.action_type,
        tier: step.tier, payload: step.payload,
        whitelist_override: step.whitelist_override || false,
      };
      if (broadcast) broadcast('pending_approval', approvalPayload);
      console.log(`  [APPROVAL NEEDED] Step ${i + 1}: ${step.description}`);

      const decision = await requestApproval(step);

      if (decision !== 'approved') {
        const skipResult = {
          step_id: step.step_id, step_index: i, ...step,
          status: 'rejected', approval_status: 'rejected',
          timestamp: new Date().toISOString(),
        };
        results.push(skipResult);
        logAction({ task_id: taskId, ...skipResult, result: 'failure', error: 'user_rejected' });
        if (broadcast) broadcast('step_rejected', skipResult);
        console.log(`  [REJECTED] Step ${i + 1}`);
        continue;
      }
    }

    // Execute the step
    try {
      const execResult = await executeStep(step, sharedPages);
      const stepResult = {
        step_id: step.step_id, step_index: i, ...step,
        status: 'completed',
        approval_status: step.tier === 'irreversible' ? 'approved' : 'auto',
        channel: execResult.channel,
        screenshot_before: execResult.screenshotBefore,
        screenshot_after: execResult.screenshotAfter,
        output: execResult.output,
        timestamp: new Date().toISOString(),
      };
      results.push(stepResult);
      logAction({ task_id: taskId, ...stepResult, result: 'success' });
      if (broadcast) broadcast('step_completed', stepResult);
    } catch (err) {
      const errResult = {
        step_id: step.step_id, step_index: i, ...step,
        status: 'error', approval_status: 'auto',
        error: err.message, timestamp: new Date().toISOString(),
      };
      results.push(errResult);
      logAction({ task_id: taskId, ...errResult, result: 'failure' });
      if (broadcast) broadcast('step_error', errResult);
      console.log(`  [ERROR] Step ${i + 1}: ${err.message}`);
    }
  }

  // Don't close browser — keep alive for follow-up tasks
  return { task_id: taskId, results };
}

async function shutdown() { await closeBrowser(); }

module.exports = { requestStop, resetStop, isStopped, runPlan, approveStep, rejectStep, shutdown };
