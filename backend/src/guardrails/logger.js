const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const LOG_FILE = path.join(__dirname, '..', '..', 'logs.jsonl');

/**
 * Append a single action log entry to logs.jsonl (append-only).
 * Each call writes one JSON line.
 */
function logAction(entry) {
  const record = {
    task_id: entry.task_id || randomUUID(),
    step_id: entry.step_id || randomUUID(),
    timestamp: entry.timestamp || new Date().toISOString(),
    input_source: entry.input_source || 'text',
    action_type: entry.action_type || 'unknown',
    tier: entry.tier || 'irreversible',
    description: entry.description || '',
    channel: entry.channel || 'dry_run',
    input_payload: entry.input_payload || {},
    screenshot_before: entry.screenshot_before || null,
    screenshot_after: entry.screenshot_after || null,
    approval_status: entry.approval_status || 'auto',
    approved_by: entry.approved_by || null,
    approval_method: entry.approval_method || 'n/a',
    result: entry.result || 'success',
    error: entry.error || null,
  };

  fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n');
  return record;
}

/**
 * Read all log entries (for the Log Viewer).
 */
function readLogs() {
  if (!fs.existsSync(LOG_FILE)) return [];
  const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
  return lines.map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

module.exports = { logAction, readLogs };
