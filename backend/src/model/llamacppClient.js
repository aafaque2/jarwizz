const { recallRelevant } = require('../memory/store');

const LLAMACPP_URL = process.env.LLAMACPP_URL || 'http://127.0.0.1:8080';
const LLAMACPP_MODEL = process.env.LLAMACPP_MODEL || 'qwen3-vl-4b';
const MODEL_PATH = process.env.MODEL_PATH || 'C:\\models\\qwen3-vl-4b-q4_k_m.gguf';

const SYSTEM_PROMPT = `You are Jarwizz, a voice-activated AI assistant. Given a user command, create a plan of discrete steps.

ACTION TYPES (use exactly these):
- browser_open: Open a URL. Payload: { "url": "https://..." }
- browser_click: Click an element. Payload: { "selector": "CSS selector", "url": "https://..." }
- browser_type: Type text into a field. Payload: { "selector": "CSS selector", "text": "text to type", "url": "https://..." }
- browser_scroll: Scroll the page. Payload: { "direction": "down|up", "url": "https://..." }
- browser_read: Read page content. Payload: { "url": "https://...", "selector": "optional CSS selector" }
- gmail_read: Read emails. Payload: { "count": 3, "query": "optional search" }
- gmail_draft: Draft an email. Payload: { "to": "email", "subject": "...", "body": "..." }
- gmail_send: Send an email (use only when explicitly asked to send). Payload: { "draft_id": "..." }
- file_create: Create a file. Payload: { "path": "...", "content": "..." }
- file_delete: Delete a file. Payload: { "path": "..." }
- app_open: Open an application. Payload: { "target": "app name" }
- answer_question: Answer from knowledge or summarize. Payload: { "source": "llm", "query": "..." }

RISK TIERS (classify every step):
- "read-only": Viewing, reading, searching, answering. Never modifies anything.
- "reversible": Opening sites, scrolling, navigating, drafting emails, typing. Can be undone.
- "irreversible": Sending emails, deleting files, submitting forms. CANNOT be undone. Default when unsure.

RULES:
- When the user asks to search, look up, or find something online, use browser steps to search Google. Do NOT answer from your own knowledge.
- Keep steps atomic — one action per step.
- Return ONLY valid JSON, no markdown, no explanation.
- Payloads must be specific. Never return empty payload {}.
- CRITICAL: For CSS selectors in JSON, use SINGLE quotes inside the value (e.g. "selector": "textarea[name='q']"). Never use double quotes inside JSON string values — it breaks JSON parsing.
- Use real CSS selectors that exist on the target page (e.g., textarea[name='q'] for Google search input).

EXAMPLES:

User: "search for AI news"
{"steps":[{"description":"Open Google","action_type":"browser_open","payload":{"url":"https://www.google.com"},"tier":"reversible"},{"description":"Type search query","action_type":"browser_type","payload":{"selector":"textarea[name='q']","text":"AI news","url":"https://www.google.com"},"tier":"reversible"},{"description":"Submit search","action_type":"browser_click","payload":{"selector":"input[name='btnK']","url":"https://www.google.com"},"tier":"reversible"}]}

User: "read my last 5 emails"
{"steps":[{"description":"Read 5 recent emails","action_type":"gmail_read","payload":{"count":5},"tier":"read-only"}]}

User: "draft an email to john@example.com saying meeting tomorrow at 3pm"
{"steps":[{"description":"Draft email to john@example.com","action_type":"gmail_draft","payload":{"to":"john@example.com","subject":"Meeting","body":"Hi John, just wanted to let you know we have a meeting scheduled for tomorrow at 3pm."},"tier":"reversible"}]}

User: "what is the capital of France"
{"steps":[{"description":"Answer user question","action_type":"answer_question","payload":{"source":"llm","query":"What is the capital of France?"},"tier":"read-only"}]}

User: "open youtube and search for lo-fi beats"
{"steps":[{"description":"Open YouTube","action_type":"browser_open","payload":{"url":"https://www.youtube.com"},"tier":"reversible"},{"description":"Search for lo-fi beats","action_type":"browser_type","payload":{"selector":"input#search","text":"lo-fi beats","url":"https://www.youtube.com"},"tier":"reversible"},{"description":"Submit search","action_type":"browser_click","payload":{"selector":"button#search-icon-legacy","url":"https://www.youtube.com"},"tier":"reversible"}]}`;

/**
 * Detect Gmail-related commands and build the correct plan directly.
 * Returns null if the command isn't a recognized Gmail pattern.
 */
function buildGmailPlan(cmd) {
  const { randomUUID } = require('crypto');
  const sid = () => randomUUID();

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

  if ((cmd.includes('draft') || cmd.includes('compose') || cmd.includes('write'))
      && (cmd.includes('email') || cmd.includes('mail'))
      && !cmd.includes('send')) {
    const toMatch = cmd.match(/to\s+([\w._%+-]+@[\w.-]+\.\w+)/i);
    const to = toMatch ? toMatch[1] : '';
    const bodyMatch = cmd.match(/(?:saying|with body|that says|body|content|message)\s+["']?(.+?)["']?\s*$/i)
      || cmd.match(/(?:saying|with body|that says)\s+(.+)/i);
    const body = bodyMatch ? bodyMatch[1].replace(/["']/g, '').trim() : cmd;
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

  return null;
}

async function callLlamaCpp(messages, extra = {}) {
  const url = `${LLAMACPP_URL.replace(/\/$/, '')}/v1/chat/completions`;
  const body = {
    model: LLAMACPP_MODEL,
    messages,
    temperature: 0.2,
    stream: false,
    ...extra,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`llama.cpp API error: ${res.status} ${res.statusText} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  // llama.cpp (OpenAI compat) -> choices[0].message.content
  // Ollama compat fallback -> message.content or content
  const content = data.choices?.[0]?.message?.content
    || data.message?.content
    || data.content
    || '';
  if (!content) throw new Error('Empty response from model runtime (llama.cpp + Qwen3-VL)');
  return content;
}

async function generatePlan(commandText, memoryContext = '', conversationContext = '') {
  const lowerCmd = commandText.toLowerCase().trim();
  const { randomUUID } = require('crypto');
  const sid = () => randomUUID();

  const replyStep = (text, description = 'Respond to user') => ({
    steps: [{
      step_id: sid(),
      description,
      action_type: 'answer_question',
      payload: { source: 'assistant', query: lowerCmd },
      tier: 'read-only',
    }],
    _conversational: true,
    _reply: text,
  });

  // 1. GREETINGS (exact match — fast, no LLM)
  const greetings = {
    hello: 'Hello! How can I help you today?',
    hi: 'Hey there! What can I do for you?',
    hey: 'Hey! What would you like me to do?',
    'good morning': 'Good morning! How can I assist you?',
    'good afternoon': 'Good afternoon! What can I help with?',
    'good evening': 'Good evening! How can I help?',
    thanks: "You're welcome! Let me know if you need anything else.",
    thank: "You're welcome!",
    'thank you': "You're welcome! Happy to help.",
    bye: 'Goodbye! Have a great day.',
    goodbye: 'Goodbye! Come back anytime.',
  };
  if (greetings[lowerCmd]) return replyStep(greetings[lowerCmd]);

  // 2. DATE / TIME (system clock — always accurate)
  const dateMatch = lowerCmd.replace(/[?!.,]/g, '').match(/\b(date|time|day|today|tomorrow|yesterday|clock|month|year)\b/);
  const isDateCommand = dateMatch && (
    /\b(what|when|which|tell|give|know|current|right now)\b/.test(lowerCmd) ||
    lowerCmd.replace(/[?!.,]/g, '').split(/\s+/).filter(w => !['the', "what's", 'a', 'an', 'is', 'it'].includes(w)).length <= 3
  );
  if (isDateCommand) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const isTimeOnly = lowerCmd.includes('time') && !lowerCmd.includes('date') && !lowerCmd.includes('day');
    const reply = isTimeOnly ? `It's ${timeStr}.` : `Today is ${dateStr}, and it's ${timeStr}.`;
    return replyStep(reply, 'Tell user the date/time');
  }

  // 3. Gmail intercept (model sometimes confuses browser vs API for Gmail)
  const gmailIntercept = buildGmailPlan(lowerCmd);
  if (gmailIntercept) return gmailIntercept;

  // 4. Everything else goes to the model — no more intercepts
  let memoryContextStr = memoryContext || '';
  // Semantic recall requires an embedding round-trip per command; it evicts the
  // main LLM from VRAM/keeps it cold and adds seconds of latency. Opt-in only.
  if (process.env.JARWIZZ_SEMANTIC_MEMORY === '1') {
    try {
      const recalled = await recallRelevant(commandText, 3);
      const parts = [];
      if (recalled.preferences) parts.push(`User preferences:\n${recalled.preferences}`);
      if (recalled.memories.length > 0) {
        parts.push(`Relevant past tasks:\n${recalled.memories.map(m => `- ${m.text} → ${m.summary}`).join('\n')}`);
      }
      if (parts.length) memoryContextStr = parts.join('\n\n');
    } catch {}
  }

  const now = new Date();
  const systemContext = `Current date/time: ${now.toISOString()} (${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString('en-US')}).`;

  // Build messages array with conversation history
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

  // Inject conversation history if available (trimmed — huge contexts slow the local model)
  if (conversationContext) {
    const trimmed = conversationContext.length > 1500
      ? '...\n' + conversationContext.slice(-1500)
      : conversationContext;
    messages.push({ role: 'system', content: `Previous conversation:\n${trimmed}` });
  }

  const userMessage = memoryContextStr
    ? `${systemContext}\nContext from memory:\n${memoryContextStr}\n\nUser command: ${commandText}`
    : `${systemContext}\nUser command: ${commandText}`;
  messages.push({ role: 'user', content: userMessage });

  const content = await callLlamaCpp(messages, { temperature: 0.2 });

  let plan;
  try {
    plan = JSON.parse(content);
  } catch {
    // Fix common model JSON errors: unescaped quotes in CSS selectors
    // e.g. {"selector":"input[name="q"]} → {"selector":"input[name='q']"}
    let fixed = content
      .replace(/"selector"\s*:\s*"([^"]*?)"/gs, (_, val) => {
        // Replace unescaped inner double quotes in selector values with single quotes
        return `"selector": "${val.replace(/(?<=[=\[])"|"(?=[\]])/g, "'")}"`;
      })
      .replace(/"target"\s*:\s*"([^"]*?)"/gs, (_, val) => {
        return `"target": "${val.replace(/(?<=[=\[])"|"(?=[\]])/g, "'")}"`;
      });

    // Also try: extract JSON from markdown code blocks
    const jsonMatch = fixed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) fixed = jsonMatch[1];

    try {
      plan = JSON.parse(fixed);
    } catch {
      throw new Error(`Failed to parse model output as JSON: ${content.substring(0, 200)}`);
    }
  }

  if (!plan.steps || !Array.isArray(plan.steps)) {
    throw new Error(`Model output missing 'steps' array: ${content}`);
  }

  // Drop malformed entries (model sometimes returns strings/null instead of objects)
  // — these previously crashed downstream code reading properties off undefined
  plan.steps = plan.steps.filter(s => s && typeof s === 'object' && !Array.isArray(s));

  // Post-process: validate and fix steps
  const validTiers = ['read-only', 'reversible', 'irreversible'];
  const validActionTypes = [
    'browser_open', 'browser_click', 'browser_type', 'browser_scroll', 'browser_read',
    'gmail_read', 'gmail_draft', 'gmail_send',
    'file_create', 'file_delete', 'app_open',
    'summarize', 'answer_question',
  ];
  for (const step of plan.steps) {
    if (!step.description) step.description = 'Unnamed step';
    if (!step.action_type) step.action_type = 'unknown';
    if (!step.payload || typeof step.payload !== 'object') step.payload = {};
    if (!validTiers.includes(step.tier)) step.tier = 'irreversible';
    if (!validActionTypes.includes(step.action_type)) {
      step.action_type = 'answer_question';
      step.payload = { source: 'llm', query: step.description };
      step.tier = 'read-only';
    }
    // Repair selectors mangled by JSON quoting issues (e.g. "ytd-video-renderer[truncated=")
    for (const key of ['selector', 'target']) {
      const sel = step.payload[key];
      if (typeof sel === 'string') {
        let cleaned = sel.trim().replace(/['"]+$/, '');
        const open = (cleaned.match(/\[/g) || []).length;
        const close = (cleaned.match(/\]/g) || []).length;
        if (open !== close) cleaned = cleaned.substring(0, cleaned.indexOf('['));
        if (!cleaned.trim()) delete step.payload[key];
        else step.payload[key] = cleaned;
      }
    }
  }

  // Post-process: Gmail URL detection (safety net)
  for (const step of plan.steps) {
    const desc = (step.description || '').toLowerCase();
    const url = (step.payload?.url || '').toLowerCase();
    const isGmailUrl = url.includes('mail.google.com');
    const isGmailAction = step.action_type.startsWith('gmail_');

    if (step.action_type === 'gmail_open') step.action_type = 'browser_open';

    if (isGmailUrl || isGmailAction) {
      if (step.action_type === 'browser_read' || step.action_type === 'gmail_read') {
        step.action_type = 'gmail_read';
        step.payload = { query: step.payload?.selector || '' };
        step.tier = 'read-only';
      } else if (step.action_type === 'browser_type' && (desc.includes('draft') || desc.includes('compose') || desc.includes('write'))) {
        step.action_type = 'gmail_draft';
        step.payload = { to: step.payload?.selector || '', subject: 'Draft', body: step.payload?.text || '' };
        step.tier = 'reversible';
      } else if (desc.includes('send') && (step.action_type === 'browser_click' || step.action_type === 'browser_open')) {
        step.action_type = 'gmail_send';
        step.tier = 'irreversible';
      }
    }
  }

  // Post-process: ensure Google search has submit step
  // browser_type auto-presses Enter on search pages, so remove redundant click steps
  for (const step of plan.steps) {
    if (step.action_type === 'browser_click') {
      const sel = (step.payload?.selector || '').toLowerCase();
      const url = (step.payload?.url || '').toLowerCase();
      const desc = (step.description || '').toLowerCase();
      // Remove clicks that are clearly "submit search" on Google/Bing/DuckDuckGo
      const isSearchSubmit = (sel.includes('btnk') || sel.includes('submit') || desc.includes('submit'))
        && (url.includes('google') || url.includes('bing') || url.includes('duckduckgo'));
      // Also remove any click that follows a type on Google (type already auto-submits)
      const isAfterGoogleType = plan.steps.some(s =>
        s.action_type === 'browser_type' && (s.payload?.url || '').includes('google')
      ) && (url.includes('google') || desc.includes('search'));
      if (isSearchSubmit || isAfterGoogleType) {
        step.action_type = '_skip';
      }
    }
  }
  plan.steps = plan.steps.filter(s => s.action_type !== '_skip');

  return plan;
}

/**
 * Describe what's on a screenshot via the same model/runtime.
 * Qwen3-VL handles vision natively — one model, one endpoint, no separate vision service.
 * @param {Buffer} imageBuffer - PNG/JPEG bytes
 * @param {string} prompt - e.g. "Describe what's visible in one sentence." or "Where is the Save button?"
 * @returns {Promise<string>} description text
 */
async function describeScreen(imageBuffer, prompt = "Describe what's visible on this screen in one paragraph — list windows, buttons, and any text you can read.") {
  if (!imageBuffer || !imageBuffer.length) throw new Error('describeScreen: empty imageBuffer');
  const b64 = imageBuffer.toString('base64');
  // Infer mime; default png — llama.cpp's OpenAI compat accepts data URL
  const mime = b64.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
      ],
    },
  ];
  const content = await callLlamaCpp(messages, { temperature: 0.2, max_tokens: 512 });
  return content.trim();
}

module.exports = { generatePlan, describeScreen, LLAMACPP_URL, MODEL_PATH };
