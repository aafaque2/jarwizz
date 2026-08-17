const { randomUUID } = require('crypto');

const IRREVERSIBLE_ACTION_TYPES = new Set([
  'gmail_send',
  'file_delete',
  'form_submit',
  'app_submit',
  'payment',
  'account_settings_change',
  'job_application_submit',
  'unknown',
]);

const REVERSIBLE_ACTION_TYPES = new Set([
  'browser_open',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'gmail_draft',
  'gmail_open',
  'file_create',
  'app_open',
  'search_web',
]);

const READ_ONLY_ACTION_TYPES = new Set([
  'browser_read',
  'gmail_read',
  'summarize',
  'answer_question',
]);

/**
 * Defense-in-depth tier classifier.
 * Re-validates the model's self-classified tier against hardcoded rules.
 * If the model's tier is too permissive, escalate it upward.
 * Never de-escalate a tier — only escalate.
 */
function validateTier(step) {
  const { action_type, tier: modelTier } = step;
  let correctedTier = modelTier;

  // Hard override: certain action types are ALWAYS irreversible
  if (IRREVERSIBLE_ACTION_TYPES.has(action_type)) {
    correctedTier = 'irreversible';
  }

  // Hard override: certain action types are NEVER irreversible
  // Cap them at reversible max — they are safe by nature
  if (READ_ONLY_ACTION_TYPES.has(action_type) && correctedTier === 'irreversible') {
    correctedTier = 'read-only';
  }
  if (REVERSIBLE_ACTION_TYPES.has(action_type) && correctedTier === 'irreversible') {
    correctedTier = 'reversible';
  }

  // Escalation: if model says read-only but action_type is known reversible, escalate
  if (modelTier === 'read-only' && REVERSIBLE_ACTION_TYPES.has(action_type)) {
    correctedTier = 'reversible';
  }

  // Unknown action types default to irreversible
  if (!IRREVERSIBLE_ACTION_TYPES.has(action_type) &&
      !REVERSIBLE_ACTION_TYPES.has(action_type) &&
      !READ_ONLY_ACTION_TYPES.has(action_type)) {
    correctedTier = 'irreversible';
  }

  // Final safety: never let an unknown tier through
  const validTiers = ['read-only', 'reversible', 'irreversible'];
  if (!validTiers.includes(correctedTier)) {
    correctedTier = 'irreversible';
  }

  return {
    ...step,
    step_id: step.step_id || randomUUID(),
    tier: correctedTier,
    tier_corrected: correctedTier !== modelTier,
    original_tier: modelTier,
  };
}

/**
 * Run defense-in-depth classification on all steps in a plan.
 */
function classifyPlan(plan) {
  return {
    ...plan,
    steps: plan.steps.map(validateTier),
  };
}

module.exports = { validateTier, classifyPlan };
