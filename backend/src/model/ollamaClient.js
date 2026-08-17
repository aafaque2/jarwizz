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

async function generatePlan(commandText, memoryContext = '') {
  const userMessage = memoryContext
    ? `Context from memory:\n${memoryContext}\n\nUser command: ${commandText}`
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

  return plan;
}

module.exports = { generatePlan };
