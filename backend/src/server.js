const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
require('dotenv').config();

const { generatePlan } = require('./model/ollamaClient');
const { requestStop, runPlan, approveStep, rejectStep, shutdown } = require('./orchestrator/taskRunner');
const { readLogs } = require('./guardrails/logger');
const { isWhitelisted, addToWhitelist, loadWhitelist } = require('./guardrails/whitelist');
const { initGmail, getAuthUrl, completeAuth, isMockMode } = require('./integrations/gmail/client');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Track connected WebSocket clients
const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

function broadcast(event, data) {
  const message = JSON.stringify({ event, data });
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
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
    const { task_id, results } = await runPlan(plan, broadcast);

    res.json({ task_id, plan, results });
  } catch (err) {
    console.error('[ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/stop', (req, res) => {
  requestStop();
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

app.post('/whitelist', (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'Missing domain' });
  addToWhitelist(domain);
  res.json({ status: 'added', domain });
});

initGmail();

server.listen(PORT, () => {
  console.log(`Jarwizz backend running on port ${PORT}`);
});

process.on('SIGINT', async () => { await shutdown(); process.exit(0); });
process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });
