/**
 * Choose the execution channel for a step.
 * Priority order (from 02-ARCHITECTURE.md §3):
 *   1. Direct API — if the target service has one (Gmail, Calendar)
 *   2. Browser automation (Playwright) — for websites without a usable API
 *   3. Desktop/screen control — only for native apps, or when 1 and 2 aren't possible
 *
 * Phase 3 only implements channel 2 (browser). API and desktop are placeholder stubs.
 */
function chooseChannel(step) {
  const { action_type } = step;

  // API channel — future phases
  if (action_type.startsWith('gmail_') || action_type === 'api_call') {
    return 'api';
  }

  // Desktop channel — future phases
  if (action_type.startsWith('desktop_') || action_type === 'app_open') {
    return 'desktop';
  }

  // Default: browser automation
  return 'browser';
}

module.exports = { chooseChannel };
