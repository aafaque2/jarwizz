/**
 * Choose the execution channel for a step.
 * Priority order (from 02-ARCHITECTURE.md §3):
 *   1. Direct API — if the target service has one (Gmail, Calendar)
 *   2. Browser automation (Playwright) — for websites without a usable API
 *   3. Desktop/screen control — only for native apps, or when 1 and 2 aren't possible
 *
 * Phase 3: browser. Phase 4: API (Gmail). Desktop is a placeholder stub.
 */
function chooseChannel(step) {
  const action_type = step?.action_type || '';

  // API channel — Gmail, Calendar, etc.
  if (action_type.startsWith('gmail_') || action_type === 'api_call') {
    return 'api';
  }

  // LLM channel — direct model queries (answer, summarize)
  if (action_type === 'answer_question' || action_type === 'summarize') {
    return 'llm';
  }

  // Desktop channel — future phases
  if (action_type.startsWith('desktop_') || action_type === 'app_open') {
    return 'desktop';
  }

  // Default: browser automation
  return 'browser';
}

module.exports = { chooseChannel };
