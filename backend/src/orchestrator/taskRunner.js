const { randomUUID } = require('crypto');
const { classifyPlan } = require('../guardrails/classifier');
const { logAction } = require('../guardrails/logger');
const { enforceDomainWhitelist } = require('../guardrails/whitelist');
const { chooseChannel } = require('../router/chooseChannel');
const { executeBrowserAction } = require('../automation/browser/handlers');
const { closeBrowser } = require('../automation/browser/playwrightRunner');
const { readRecentEmails, draftEmail, sendEmail } = require('../integrations/gmail/client');
const { storeTaskHistory } = require('../memory/store');

let stopFlag = false;
const pendingApprovals = new Map();

function requestStop() {
  stopFlag = true;
  // Resolve any awaited approvals so runPlan doesn't hang forever after /stop
  for (const [stepId, pending] of pendingApprovals) {
    pending.resolve('stopped');
    pendingApprovals.delete(stepId);
  }
}
function resetStop() { stopFlag = false; }
function isStopped() { return stopFlag; }

function cancelPendingApprovals() {
  for (const [stepId, pending] of pendingApprovals) {
    pending.resolve('stopped');
    pendingApprovals.delete(stepId);
  }
}

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
async function executeStep(step, sharedPages, conversationContext) {
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

  if (channel === 'llm') {
    const p = step.payload || {};
    const LLAMACPP_URL = process.env.LLAMACPP_URL || 'http://127.0.0.1:8080';
    const LLAMACPP_MODEL = process.env.LLAMACPP_MODEL || 'qwen3-vl-4b';

    // Inject stored preferences so questions like "what is my email" recall from memory
    let prefContext = '';
    try {
      const { getAllPreferences } = require('../memory/store');
      const prefs = getAllPreferences();
      if (prefs.length > 0) {
        prefContext = `\n\nUser's stored information (authoritative — use it to answer personal questions):\n${prefs.map(pr => `${pr.key}: ${pr.value}`).join('\n')}`;
      }
    } catch {}

    // Build messages — include conversation context if available
    const messages = [
      { role: 'system', content: 'You are Jarwizz, a helpful voice assistant. Answer the user\'s question directly and concisely. Never output your reasoning or planning — just give the final answer. If the user asks "what is X", answer what X is. If they ask "tell me about X", give a brief summary. Be specific and factual. Max 2-3 sentences. If stored user information is provided and relevant, use it as the answer.' + prefContext },
    ];

    // Inject conversation history if available (trimmed for speed)
    if (conversationContext) {
      const trimmed = conversationContext.length > 1200
        ? '...\n' + conversationContext.slice(-1200)
        : conversationContext;
      messages.push({ role: 'system', content: `Previous conversation:\n${trimmed}` });
    }

    messages.push({ role: 'user', content: p.query || p.source || 'Hello' });

    const response = await fetch(`${LLAMACPP_URL.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LLAMACPP_MODEL,
        messages,
        stream: false,
        temperature: 0.2,
      }),
    });
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || data.message?.content || 'Sorry, I could not answer that.';
    return { channel, output: { text }, screenshotBefore: null, screenshotAfter: null };
  }

  if (channel === 'desktop') {
    const p = step.payload || {};
    const desktop = require('../automation/desktop/desktopRunner');
    switch (step.action_type) {
      case 'app_open':
        return { channel, output: await desktop.openApp(p.target || p.app), screenshotBefore: null, screenshotAfter: null };
      case 'read_screen': {
        const shot = await desktop.takeScreenshot();
        const result = await desktop.readScreen(p.query || p.prompt);
        return { channel, output: { text: result.description }, screenshotBefore: null, screenshotAfter: null };
      }
      case 'desktop_click':
        return { channel, output: await desktop.desktopClick(p.x ?? 640, p.y ?? 360), screenshotBefore: null, screenshotAfter: null };
      case 'desktop_type':
        return { channel, output: await desktop.desktopType(p.text), screenshotBefore: null, screenshotAfter: null };
      case 'file_create':
        return { channel, output: await desktop.createFile(p.path, p.content || ''), screenshotBefore: null, screenshotAfter: null };
      case 'file_delete':
        return { channel, output: await desktop.deleteFile(p.path), screenshotBefore: null, screenshotAfter: null };
      default:
        return { channel, output: { simulated: true }, screenshotBefore: null, screenshotAfter: null };
    }
  }

  // Unknown — future phases
  return { channel, output: { simulated: true }, screenshotBefore: null, screenshotAfter: null };
}

async function runPlan(plan, broadcast) {
  resetStop();

  // Handle conversational replies (greetings, thanks, Q&A) — skip classification
  if (plan._conversational) {
    const taskId = randomUUID();
    const reply = plan._reply || null;

    // If reply is provided (exact greeting/thanks), emit it directly
    if (reply) {
      const result = {
        step_id: plan.steps[0].step_id, step_index: 0,
        ...plan.steps[0], status: 'completed', approval_status: 'auto',
        output: { text: reply }, timestamp: new Date().toISOString(),
      };
      if (broadcast) broadcast('step_completed', result);
      logAction({ task_id: taskId, ...result, result: 'success' });
      return { task_id: taskId, results: [result], _reply: reply };
    }

    // For Q&A (what is X, etc.), let the model answer via answer_question handler
    // Fall through to normal execution but skip classification (all read-only)
    const steps = plan.steps.map((s, i) => ({ ...s, step_id: s.step_id || randomUUID(), tier: 'read-only' }));
    plan.steps = steps;
    plan._skipClassification = true;
  }

  const classified = plan._skipClassification ? plan : classifyPlan(plan);
  // Enforce domain whitelist on browser steps
  classified.steps = classified.steps.map(s => {
    const channel = chooseChannel(s);
    if (channel === 'browser') return enforceDomainWhitelist(s);
    return s;
  });
  // Write enforced tiers back onto the caller's plan so API responses reflect
  // actual enforcement (e.g. non-whitelisted domains show irreversible)
  plan.steps = classified.steps;
  if (classified._skipClassification) plan._skipClassification = true;

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

      if (decision === 'stopped') {
        const skipResult = {
          step_id: step.step_id, step_index: i, ...step,
          status: 'skipped', approval_status: 'stopped', reason: 'stopped',
          timestamp: new Date().toISOString(),
        };
        results.push(skipResult);
        logAction({ task_id: taskId, ...skipResult, result: 'failure', error: 'stopped' });
        if (broadcast) broadcast('step_skipped', skipResult);
        console.log(`  [STOPPED] Step ${i + 1}`);
        continue;
      }

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
      const execResult = await executeStep(step, sharedPages, classified._conversationContext || '');
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

  // Store task in memory for future recall (non-blocking)
  storeTaskHistory(plan._originalCommand || 'unknown command', results).catch(err => {
    console.warn('[MEMORY] Failed to store task:', err.message);
  });

  // Tell clients the plan is done so they can clear live-task state
  if (broadcast) broadcast('plan_finished', { task_id: taskId, total: results.length });

  return { task_id: taskId, results };
}

async function shutdown() { await closeBrowser(); }

module.exports = { requestStop, resetStop, isStopped, runPlan, approveStep, rejectStep, cancelPendingApprovals, shutdown };
