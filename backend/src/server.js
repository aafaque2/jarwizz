const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { generatePlan } = require('./model/ollamaClient');
const { requestStop, runPlan } = require('./orchestrator/taskRunner');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'jarwizz-backend' });
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

    // Dry-run: execute the plan (simulated — no real actions yet)
    const results = await runPlan(plan);

    res.json({ plan, results });
  } catch (err) {
    console.error('[ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/stop', (req, res) => {
  requestStop();
  console.log('[STOP] Kill switch triggered');
  res.json({ status: 'stopped' });
});

app.listen(PORT, () => {
  console.log(`Jarwizz backend running on port ${PORT}`);
});
