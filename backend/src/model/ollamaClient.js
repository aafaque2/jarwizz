const { recallRelevant } = require('../memory/store');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

const SYSTEM_PROMPT = `You are the planning engine for Jarwizz, a voice-activated AI assistant.
Given a user command, break it into discrete steps. Each step must be classified by risk tier.

RISK TIERS (classify every step into exactly one):
- "read-only": Viewing, reading, summarizing, searching, answering questions. Never modifies anything.
- "reversible": Opening apps/sites, scrolling, navigating, creating files/folders, drafting (not sending) emails, typing into fields. Can be undone.
- "irreversible": Sending emails, submitting forms, deleting files/folders, any payment, changing account settings, submitting job applications. CANNOT be undone.

RULES:
- Default to "irreversible" when unsure — safety first.
- Each step must include an action_type from: browser_open, browser_click, browser_type, browser_scroll, browser_read, gmail_read, gmail_draft, gmail_send, file_create, file_delete, app_open, search_web, summarize, answer_question.
- Keep steps atomic — one action per step.
- Return ONLY valid JSON, no markdown, no explanation.
- PAYLOAD IS REQUIRED AND MUST BE SPECIFIC. Never return empty payload {}.

PAYLOAD SCHEMAS (use exactly these keys):

For browser_open:
  { "url": "https://example.com" }

For browser_click:
  { "selector": "CSS selector or visible text of the element to click", "url": "https://page-url.com" }

For browser_type:
  { "selector": "CSS selector or visible text of the input field", "text": "text to type", "url": "https://page-url.com" }

For browser_scroll:
  { "direction": "down or up", "url": "https://page-url.com" }

For browser_read:
  { "url": "https://page-url.com", "selector": "optional CSS selector to read specific element, or omit for full page" }

For gmail_send / gmail_draft:
  { "to": "email address", "subject": "email subject", "body": "email body text" }

For gmail_read:
  { "query": "optional search query" }

For file_create / file_delete:
  { "path": "relative or absolute file path", "content": "file content (for create only)" }

For summarize / answer_question:
  { "source": "what to summarize or answer from", "query": "the user's question" }

For all others:
  { "target": "the target of this action" }

OUTPUT FORMAT (strict JSON):
{
  "steps": [
    {
      "description": "human-readable description of what this step does",
      "action_type": "one of the action types listed above",
      "payload": { ... exact payload for this action_type ... },
      "tier": "read-only | reversible | irreversible"
    }
  ]
}`;

/**
 * Detect Gmail-related commands and build the correct plan directly.
 * Returns null if the command isn't a recognized Gmail pattern.
 * This bypasses the 3B model which can't reliably use gmail_* action types.
 */
function buildGmailPlan(cmd) {
  const { randomUUID } = require('crypto');
  const sid = () => randomUUID();

  // Read emails
  if ((cmd.includes('read') || cmd.includes('check') || cmd.includes('show') || cmd.includes('list') || cmd.includes('summary'))
      && (cmd.includes('email') || cmd.includes('mail') || cmd.includes('inbox'))) {
    const countMatch = cmd.match(/(\d+)\s*(most recent|latest|newest|recent)?/);
    const count = countMatch ? parseInt(countMatch[1]) : 3;
    return {
      steps: [{
        step_id: sid(),
        description: `Read ${count} recent emails`,
        action_type: 'gmail_read',
        payload: { count },
        tier: 'read-only',
      }],
    };
  }

  // Draft email
  if ((cmd.includes('draft') || cmd.includes('compose') || cmd.includes('write'))
      && (cmd.includes('email') || cmd.includes('mail'))
      && !cmd.includes('send')) {
    const toMatch = cmd.match(/to\s+([\w._%+-]+@[\w.-]+\.\w+)/i);
    const to = toMatch ? toMatch[1] : '';
    // Extract the body: everything after "saying", "with body", "that says", etc.
    const bodyMatch = cmd.match(/(?:saying|with body|that says|body|content|message)\s+["']?(.+?)["']?\s*$/i)
      || cmd.match(/(?:saying|with body|that says)\s+(.+)/i);
    const body = bodyMatch ? bodyMatch[1].replace(/["']/g, '').trim() : commandText;
    return {
      steps: [{
        step_id: sid(),
        description: `Draft email to ${to || 'recipient'}`,
        action_type: 'gmail_draft',
        payload: { to, subject: 'Draft', body },
        tier: 'reversible',
      }],
    };
  }

  // Send email (explicit send command)
  if (cmd.includes('send') && (cmd.includes('email') || cmd.includes('mail') || cmd.includes('draft'))) {
    return {
      steps: [{
        step_id: sid(),
        description: 'Send email',
        action_type: 'gmail_send',
        payload: {},
        tier: 'irreversible',
      }],
    };
  }

  return null; // Not a Gmail command — let the model handle it
}

async function generatePlan(commandText, memoryContext = '') {
  // Command-level intercept: detect known Gmail patterns and bypass the model
  const lowerCmd = commandText.toLowerCase();
  const gmailIntercept = buildGmailPlan(lowerCmd);
  if (gmailIntercept) return gmailIntercept;

  // Retrieve relevant memory (preferences + past tasks) for context
  let memoryContextStr = memoryContext || '';
  try {
    const recalled = await recallRelevant(commandText, 3);
    const parts = [];
    if (recalled.preferences) parts.push(`User preferences:\n${recalled.preferences}`);
    if (recalled.memories.length > 0) {
      parts.push(`Relevant past tasks:\n${recalled.memories.map(m => `- ${m.text} → ${m.summary}`).join('\n')}`);
    }
    if (parts.length) memoryContextStr = parts.join('\n\n');
  } catch {}

  const userMessage = memoryContextStr
    ? `Context from memory:\n${memoryContextStr}\n\nUser command: ${commandText}`
    : `User command: ${commandText}`;

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      stream: false,
      format: 'json',
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.message?.content;

  if (!content) {
    throw new Error('Empty response from Ollama');
  }

  let plan;
  try {
    plan = JSON.parse(content);
  } catch {
    throw new Error(`Failed to parse model output as JSON: ${content}`);
  }

  // Validate structure
  if (!plan.steps || !Array.isArray(plan.steps)) {
    throw new Error(`Model output missing 'steps' array: ${content}`);
  }

  // Ensure every step has required fields and a valid tier
  const validTiers = ['read-only', 'reversible', 'irreversible'];
  for (const step of plan.steps) {
    if (!step.description) step.description = 'Unnamed step';
    if (!step.action_type) step.action_type = 'unknown';
    if (!step.payload) step.payload = {};
    if (!validTiers.includes(step.tier)) {
      step.tier = 'irreversible'; // default to safest
    }
  }

  // Post-process: rewrite browser-based Gmail actions into proper API actions
  // (the 3B model often ignores gmail_* action types and uses browser_* instead)
  // Only trigger when the URL is actually Gmail or the action is already gmail_*
  for (const step of plan.steps) {
    const desc = (step.description || '').toLowerCase();
    const url = (step.payload?.url || '').toLowerCase();
    const isGmailUrl = url.includes('mail.google.com');
    const isGmailAction = step.action_type.startsWith('gmail_');

    // Convert gmail_open (non-existent action) back to browser_open
    if (step.action_type === 'gmail_open') {
      step.action_type = 'browser_open';
    }

    if (isGmailUrl || isGmailAction) {
      if (step.action_type === 'browser_read' || (step.action_type === 'gmail_read')) {
        step.action_type = 'gmail_read';
        step.payload = { query: step.payload?.selector || '' };
        step.tier = 'read-only';
      } else if (step.action_type === 'browser_type' && (desc.includes('draft') || desc.includes('compose') || desc.includes('write'))) {
        step.action_type = 'gmail_draft';
        step.payload = {
          to: step.payload?.selector || '',
          subject: 'Draft',
          body: step.payload?.text || '',
        };
        step.tier = 'reversible';
      } else if (desc.includes('send') && (step.action_type === 'browser_click' || step.action_type === 'browser_open')) {
        step.action_type = 'gmail_send';
        step.tier = 'irreversible';
      }
    }
  }

  return plan;
}

module.exports = { generatePlan };
