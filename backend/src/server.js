const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
require('dotenv').config();

const { generatePlan } = require('./model/ollamaClient');
const { requestStop, runPlan, approveStep, rejectStep, cancelPendingApprovals, shutdown } = require('./orchestrator/taskRunner');
const { readLogs } = require('./guardrails/logger');
const { isWhitelisted, addToWhitelist, loadWhitelist } = require('./guardrails/whitelist');
const { initGmail, getAuthUrl, completeAuth, isMockMode } = require('./integrations/gmail/client');
const { setPreference, getPreference, getAllPreferences, deletePreference, getRecentTasks, closeDb, listChats, createChat, getChat, renameChat, deleteChat, addMessage, getRecentMessages } = require('./memory/store');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Track connected WebSocket clients
const clients = new Set();
let lastPendingApproval = null;

wss.on('connection', (ws) => {
  clients.add(ws);
  // Send any pending approval to newly connected client (catches missed events)
  if (lastPendingApproval) {
    ws.send(JSON.stringify({ event: 'pending_approval', data: lastPendingApproval }));
  }
  ws.on('close', () => clients.delete(ws));
});

function broadcast(event, data) {
  const message = JSON.stringify({ event, data });
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
  // Track pending approval so new WS clients can receive it
  if (event === 'pending_approval') lastPendingApproval = data;
  if (event === 'step_approved' || event === 'step_rejected') lastPendingApproval = null;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'jarwizz-backend', gmail: isMockMode() ? 'mock' : 'connected' });
});

app.post('/command', async (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "text" field' });
  }

  try {
    console.log(`[COMMAND] "${text}"`);
    const plan = await generatePlan(text);
    console.log(`[PLAN] ${plan.steps.length} step(s):`);
    plan.steps.forEach((s, i) => {
      console.log(`  ${i + 1}. [${s.tier}] ${s.description}`);
    });

    broadcast('plan_created', { plan });

    // Execute plan (may pause for approval on irreversible steps)
    plan._originalCommand = text;
    const { task_id, results, _reply } = await runPlan(plan, broadcast);

    // Extract reply: either from conversational path or from LLM answer_question results
    let reply = _reply || null;
    if (!reply && results?.length) {
      const llmResult = results.find(r => r.action_type === 'answer_question' && r.output?.text);
      if (llmResult) reply = llmResult.output.text;
    }

    // Broadcast conversational reply for real-time display
    if (reply) {
      broadcast('conversational_reply', { text: reply, command: text });
    }

    res.json({ task_id, plan, results, reply });
  } catch (err) {
    console.error('[ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/stop', (req, res) => {
  requestStop();
  cancelPendingApprovals();
  lastPendingApproval = null;
  console.log('[STOP] Kill switch triggered');
  broadcast('stop', { message: 'All tasks stopped' });
  res.json({ status: 'stopped' });
});

app.post('/approve/:stepId', (req, res) => {
  const { stepId } = req.params;
  const success = approveStep(stepId);
  if (success) {
    broadcast('step_approved', { step_id: stepId });
    res.json({ status: 'approved', step_id: stepId });
  } else {
    res.status(404).json({ error: 'No pending approval found for this step_id' });
  }
});

app.post('/reject/:stepId', (req, res) => {
  const { stepId } = req.params;
  const success = rejectStep(stepId);
  if (success) {
    broadcast('step_rejected', { step_id: stepId });
    res.json({ status: 'rejected', step_id: stepId });
  } else {
    res.status(404).json({ error: 'No pending approval found for this step_id' });
  }
});

app.get('/logs', (req, res) => {
  res.json(readLogs());
});

app.get('/whitelist', (req, res) => {
  res.json(loadWhitelist());
});

app.get('/gmail/auth-url', (req, res) => {
  try {
    res.json({ url: getAuthUrl() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/gmail/callback', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Missing auth code' });
  try {
    await completeAuth(code);
    res.json({ status: 'connected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Preferences ──
app.get('/preferences', (req, res) => {
  res.json(getAllPreferences());
});

app.get('/preferences/:key', (req, res) => {
  const value = getPreference(req.params.key);
  if (value === null) return res.status(404).json({ error: 'Not found' });
  res.json({ key: req.params.key, value });
});

app.post('/preferences', (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) return res.status(400).json({ error: 'Missing key or value' });
  setPreference(key, value);
  res.json({ status: 'set', key, value });
});

app.delete('/preferences/:key', (req, res) => {
  deletePreference(req.params.key);
  res.json({ status: 'deleted', key: req.params.key });
});

// ── Memory / Task History ──
app.get('/memory/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  res.json(getRecentTasks(limit));
});

app.post('/whitelist', (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'Missing domain' });
  addToWhitelist(domain);
  res.json({ status: 'added', domain });
});

// ── Chats ──
app.get('/chats', (req, res) => {
  res.json(listChats());
});

app.post('/chats', (req, res) => {
  const { title } = req.body;
  res.json(createChat(title));
});

app.get('/chats/:id', (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  res.json(chat);
});

app.patch('/chats/:id', (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Missing title' });
  const chat = renameChat(req.params.id, title);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  res.json(chat);
});

app.delete('/chats/:id', (req, res) => {
  deleteChat(req.params.id);
  res.json({ status: 'deleted' });
});

// Chat-aware command endpoint — injects conversation history
app.post('/chats/:id/command', async (req, res) => {
  const { text } = req.body;
  const chatId = req.params.id;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "text" field' });
  }

  const chat = getChat(chatId);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });

  // Save user message
  addMessage(chatId, 'user', text);

  // Auto-title from first user message
  if (chat.messages.length === 0) {
    const shortTitle = text.length > 40 ? text.substring(0, 40) + '...' : text;
    renameChat(chatId, shortTitle);
  }

  try {
    console.log(`[CHAT:${chatId}] "${text}"`);

    // Get conversation history for context
    const history = getRecentMessages(chatId, 20);
    const conversationContext = history
      .filter(m => m.role !== 'system')
      .map(m => `${m.role === 'user' ? 'User' : 'Jarwizz'}: ${m.content}`)
      .join('\n');

    const plan = await generatePlan(text, '', conversationContext);
    console.log(`[PLAN] ${plan.steps.length} step(s):`);
    plan.steps.forEach((s, i) => {
      console.log(`  ${i + 1}. [${s.tier}] ${s.description}`);
    });

    // Pass conversation context through to LLM channel
    plan._conversationContext = conversationContext;

    broadcast('plan_created', { plan, chat_id: chatId });

    plan._originalCommand = text;
    const { task_id, results, _reply } = await runPlan(plan, broadcast);

    // Extract reply: either from conversational path or from LLM answer_question results
    let reply = _reply || null;
    if (!reply && results?.length) {
      const llmResult = results.find(r => r.action_type === 'answer_question' && r.output?.text);
      if (llmResult) reply = llmResult.output.text;
    }

    if (reply) {
      addMessage(chatId, 'assistant', reply, { task_id, results: results?.map(r => ({ action_type: r.action_type, status: r.status })) });
      broadcast('conversational_reply', { text: reply, command: text, chat_id: chatId });
    }

    res.json({ task_id, plan, results, reply, chat_id: chatId });
  } catch (err) {
    console.error('[CHAT ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

initGmail();

// ── Static: serve screenshots ──
app.use('/screenshots', express.static(path.join(__dirname, '..', 'screenshots')));

server.listen(PORT, () => {
  console.log(`Jarwizz backend running on port ${PORT}`);
});

process.on('SIGINT', async () => { closeDb(); await shutdown(); process.exit(0); });
process.on('SIGTERM', async () => { closeDb(); await shutdown(); process.exit(0); });
