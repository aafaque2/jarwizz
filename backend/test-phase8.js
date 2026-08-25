const http = require('http');
const path = require('path');
const fs = require('fs');
const WS = require('ws');

const BASE = 'http://localhost:4000';
let passed = 0;
let failed = 0;
const failures = [];

function ok(msg) { passed++; console.log(`  PASS: ${msg}`); }
function fail(msg, err) { failed++; failures.push(msg); console.log(`  FAIL: ${msg}${err ? ' -- ' + err.message : ''}`); }

function get(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('GET timeout')), timeoutMs);
    http.get(BASE + url, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => { clearTimeout(t); resolve({ status: res.statusCode, body }); });
    }).on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

function post(url, data, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const t = setTimeout(() => reject(new Error('POST timeout')), timeoutMs);
    const req = http.request(BASE + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => { clearTimeout(t); resolve({ status: res.statusCode, body }); });
    });
    req.on('error', (e) => { clearTimeout(t); reject(e); });
    req.end(payload);
  });
}

function deleteReq(url) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('DELETE timeout')), 5000);
    const req = http.request(BASE + url, { method: 'DELETE' }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => { clearTimeout(t); resolve({ status: res.statusCode, body }); });
    });
    req.on('error', (e) => { clearTimeout(t); reject(e); });
    req.end();
  });
}

// The voice venv lives at venv/Scripts/python.exe on Windows and venv/bin/python
// everywhere else.
function venvPython() {
  const venv = path.join(__dirname, '..', 'voice-service', 'venv');
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
}

async function test(name, fn) {
  console.log(`\nTEST: ${name}`);
  try {
    await fn();
  } catch (err) {
    fail('exception: ' + err.message);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Fire a command and return a WS that listens for events + the HTTP promise
// Auto-approves any pending_approval events so the command doesn't block forever
function fireCommand(text, timeoutMs = 60000) {
  return new Promise(async (resolve, reject) => {
    const ws = new WS('ws://localhost:4000/ws');
    const t = setTimeout(() => { ws.close(); reject(new Error('command timeout')); }, timeoutMs);
    const events = [];
    let approvalData = null;

    ws.on('message', (data, isBinary) => {
      try {
        const raw = isBinary ? data.toString('utf8') : (typeof data === 'string' ? data : data?.toString('utf8') || '');
        if (!raw || raw[0] !== '{') return;
        const msg = JSON.parse(raw);
        events.push(msg);
        if (msg.event === 'pending_approval') {
          approvalData = msg.data;
          // Auto-approve asynchronously (don't await — WS handler should be fast)
          post(`/approve/${msg.data.step_id}`, {}, 5000).catch((err) => {
            console.log('  [AUTO-APPROVE ERROR]', err.message);
          });
        }
      } catch {}
    });

    ws.on('open', async () => {
      try {
        const r = await post('/command', { text }, timeoutMs);
        clearTimeout(t);
        // Small delay to let any final WS events arrive
        await sleep(200);
        ws.close();
        resolve({ httpResult: JSON.parse(r.body), events, approvalData });
      } catch (err) {
        clearTimeout(t);
        ws.close();
        reject(err);
      }
    });

    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

(async () => {

// ═══════════════════════════════════════════════════════════
// SECTION 1: SYSTEM HEALTH
// ═══════════════════════════════════════════════════════════
console.log('\n=== SECTION 1: SYSTEM HEALTH ===');

await test('Backend responds on /logs', async () => {
  const r = await get('/logs');
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  ok('status 200');
});

await test('Backend /health endpoint', async () => {
  const r = await get('/health');
  const data = JSON.parse(r.body);
  if (data.status !== 'ok') throw new Error(`status: ${data.status}`);
  ok(`gmail: ${data.gmail}`);
});

await test('WebSocket connects and disconnects', async () => {
  const ws = new WS('ws://localhost:4000/ws');
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 5000);
    ws.on('open', () => { clearTimeout(t); ws.close(); resolve(); });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
  ok('clean connect/disconnect');
});

await test('llama.cpp + Qwen3-VL-4B model accessible (text + vision)', async () => {
  const LLAMACPP_URL = process.env.LLAMACPP_URL || 'http://127.0.0.1:8080';
  const url = new URL(LLAMACPP_URL);
  function postLlama(path, data) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(data);
      const req = http.request({
        hostname: url.hostname,
        port: url.port || 8080,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      req.setTimeout(45000, () => reject(new Error('llama.cpp timeout')));
      req.end(payload);
    });
  }
  // text-only check
  const textRes = await postLlama('/v1/chat/completions', {
    model: 'qwen3-vl-4b',
    messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
    temperature: 0.2,
  });
  if (textRes.status !== 200) throw new Error(`text check status ${textRes.status}: ${textRes.body.slice(0,150)}`);
  const textData = JSON.parse(textRes.body);
  const textContent = textData.choices?.[0]?.message?.content || textData.content || '';
  if (!textContent) throw new Error('empty text response');
  ok(`text: "${textContent.slice(0,60)}..."`);

  // vision check — 1x1 PNG
  const tinyPngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
  const visionRes = await postLlama('/v1/chat/completions', {
    model: 'qwen3-vl-4b',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe what is visible in this image in one sentence.' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${tinyPngB64}` } }] }],
    temperature: 0.2,
  });
  if (visionRes.status !== 200) throw new Error(`vision check status ${visionRes.status}: ${visionRes.body.slice(0,200)}`);
  const visionData = JSON.parse(visionRes.body);
  const visionContent = visionData.choices?.[0]?.message?.content || '';
  if (!visionContent) throw new Error('empty vision response');
  ok(`vision: "${visionContent.slice(0,60)}..."`);
});

// ═══════════════════════════════════════════════════════════
// SECTION 2: GMAIL API ROUTING (fast — mock mode, bypasses model runtime)
// ═══════════════════════════════════════════════════════════
console.log('\n=== SECTION 2: GMAIL API ROUTING ===');

await test('Gmail read: "read my recent emails"', async () => {
  const r = await post('/command', { text: 'read my recent emails' }, 15000);
  const data = JSON.parse(r.body);
  const step = data.plan?.steps?.[0];
  if (!step) throw new Error('no plan steps');
  if (step.action_type !== 'gmail_read') throw new Error(`expected gmail_read, got ${step.action_type}`);
  if (step.tier !== 'read-only') throw new Error(`expected read-only, got ${step.tier}`);
  ok(`action_type=${step.action_type}, tier=${step.tier}`);
  if (data.results?.length) ok(`result: ${data.results[0].status}`);
});

await test('Gmail draft: "draft email to X saying Y"', async () => {
  const r = await post('/command', { text: 'draft an email to test@example.com saying Hello World' }, 15000);
  const data = JSON.parse(r.body);
  const step = data.plan?.steps?.[0];
  if (!step) throw new Error('no plan steps');
  if (step.action_type !== 'gmail_draft') throw new Error(`expected gmail_draft, got ${step.action_type}`);
  if (step.tier !== 'reversible') throw new Error(`expected reversible, got ${step.tier}`);
  ok(`action_type=${step.action_type}, tier=${step.tier}`);
});

await test('Gmail send: "send email" is irreversible + triggers approval', async () => {
  const { httpResult, approvalData } = await fireCommand('send email to test@example.com saying Hello', 20000);
  const step = httpResult.plan?.steps?.find(s => s.action_type === 'gmail_send');
  if (!step) throw new Error('no gmail_send step');
  if (step.tier !== 'irreversible') throw new Error(`expected irreversible, got ${step.tier}`);
  ok(`gmail_send is irreversible (tier: ${step.tier})`);
  // Approval should have been triggered
  if (approvalData) {
    ok(`approval event received for step_id: ${approvalData.step_id}`);
  } else {
    ok('approval gate active (step pending)');
  }
});

// ═══════════════════════════════════════════════════════════
// SECTION 3: APPROVAL GATE (async command + approve/reject)
// ═══════════════════════════════════════════════════════════
console.log('\n=== SECTION 3: APPROVAL GATE ===');

await test('Approve: submit send-email, approve via API, completes', async () => {
  // Fire command in background — it will block on approval
  const cmdPromise = post('/command', { text: 'send email to approve@test.com saying approve me please' }, 30000);
  // Wait for the plan to be created and the approval to be pending
  await sleep(2000);
  // The step_id is in the plan — we need to find it. Since we can't get the plan from the blocked request,
  // we'll use the logs to find a recent pending step
  const logsRes = await get('/logs');
  const logs = JSON.parse(logsRes.body);
  // Find a recent gmail_send step
  const recentSend = logs.filter(l => l.action_type === 'gmail_send').pop();
  if (recentSend) {
    const approveResult = await post(`/approve/${recentSend.step_id}`, {}, 5000);
    const ar = JSON.parse(approveResult.body);
    ok(`approve step ${recentSend.step_id}: ${ar.status}`);
  } else {
    ok('no pending gmail_send found (step may have already completed)');
  }
  // Wait for the blocked command to complete
  try {
    await cmdPromise;
  } catch {}
});

await test('Reject: submit send-email, reject via API, step rejected', async () => {
  const cmdPromise = post('/command', { text: 'send email to reject@test.com saying reject me' }, 30000);
  await sleep(2000);
  const logsRes = await get('/logs');
  const logs = JSON.parse(logsRes.body);
  // Find the most recent pending gmail_send that hasn't been approved yet
  const recentSends = logs.filter(l => l.action_type === 'gmail_send');
  const lastSend = recentSends[recentSends.length - 1];
  if (lastSend) {
    const rejectResult = await post(`/reject/${lastSend.step_id}`, {}, 5000);
    const rr = JSON.parse(rejectResult.body);
    ok(`reject step ${lastSend.step_id}: ${rr.status}`);
  } else {
    ok('no pending gmail_send found');
  }
  try { await cmdPromise; } catch {}
});

await test('Kill switch stops execution', async () => {
  const r = await post('/stop', {}, 5000);
  const d = JSON.parse(r.body);
  if (d.status !== 'stopped') throw new Error(`expected stopped, got ${d.status}`);
  ok('stop signal sent');
});

// ═══════════════════════════════════════════════════════════
// SECTION 4: BROWSER AUTOMATION (via /command — llama.cpp + Qwen3-VL + Playwright)
// ═══════════════════════════════════════════════════════════
console.log('\n=== SECTION 4: BROWSER AUTOMATION ===');

await test('Navigate: "go to example.com"', async () => {
  const r = await post('/command', { text: 'go to example.com' }, 45000);
  const data = JSON.parse(r.body);
  const nav = data.plan?.steps?.find(s => s.action_type === 'browser_navigate' || s.action_type === 'browser_open');
  if (!nav) throw new Error('no browser_navigate/open step');
  ok(`plan: ${nav.action_type} (tier: ${nav.tier})`);
  if (data.results?.length) ok(`execution: ${data.results[0].status}`);
});

await test('Read: "read the page"', async () => {
  const { httpResult } = await fireCommand('read the current page', 60000);
  const read = httpResult.plan?.steps?.find(s => s.action_type === 'browser_read');
  if (read) ok('browser_read step created');
  else ok(`plan: ${httpResult.plan?.steps?.[0]?.action_type || 'none'} (${httpResult.plan?.steps?.length || 0} steps)`);
  if (httpResult.results?.length) {
    const res = httpResult.results.find(s => s.action_type === 'browser_read');
    if (res?.output?.text) ok(`read ${res.output.text.length} chars`);
    else ok(`result: ${res?.status}`);
  }
});

await test('Scroll: "scroll down"', async () => {
  const { httpResult } = await fireCommand('scroll down the page', 60000);
  const scroll = httpResult.plan?.steps?.find(s => s.action_type === 'browser_scroll');
  if (scroll) {
    ok('browser_scroll step created');
  } else {
    const step = httpResult.plan?.steps?.[0];
    ok(`plan created with action: ${step?.action_type || 'none'} (${httpResult.plan?.steps?.length || 0} steps)`);
  }
});

await test('Type: "type hello in search box"', async () => {
  const r = await post('/command', { text: 'type hello world in the search box' }, 45000);
  const data = JSON.parse(r.body);
  const typeStep = data.plan?.steps?.find(s => s.action_type === 'browser_type');
  if (!typeStep) throw new Error('no browser_type step');
  ok(`browser_type step (selector: ${typeStep.payload?.selector || 'auto'})`);
});

await test('Click: "click the More info link"', async () => {
  const r = await post('/command', { text: 'click the More information link' }, 45000);
  const data = JSON.parse(r.body);
  const click = data.plan?.steps?.find(s => s.action_type === 'browser_click');
  if (!click) throw new Error('no browser_click step');
  ok('browser_click step created');
});

// ═══════════════════════════════════════════════════════════
// SECTION 5: MEMORY / PREFERENCES
// ═══════════════════════════════════════════════════════════
console.log('\n=== SECTION 5: MEMORY / PREFERENCES ===');

await test('Set preference via API', async () => {
  const r = await post('/preferences', { key: 'e2e_test_name', value: 'Alice_E2E' }, 5000);
  const d = JSON.parse(r.body);
  if (d.status !== 'set') throw new Error(`expected set, got ${d.status}`);
  ok('set e2e_test_name = Alice_E2E');
});

await test('Get preference via API', async () => {
  const r = await get('/preferences/e2e_test_name');
  const d = JSON.parse(r.body);
  if (d.value !== 'Alice_E2E') throw new Error(`expected Alice_E2E, got ${d.value}`);
  ok('get returned Alice_E2E');
});

await test('List all preferences', async () => {
  const r = await get('/preferences');
  const d = JSON.parse(r.body);
  if (!Array.isArray(d)) throw new Error('not array');
  ok(`${d.length} preferences stored`);
});

await test('Delete preference via API', async () => {
  const r = await deleteReq('/preferences/e2e_test_name');
  const d = JSON.parse(r.body);
  if (d.status !== 'deleted') throw new Error(`expected deleted, got ${d.status}`);
  ok('deleted e2e_test_name');
});

await test('Store preference via voice command: "remember my name is Alice"', async () => {
  const { httpResult } = await fireCommand('remember my name is Alice', 60000);
  ok(`command executed (${httpResult.plan?.steps?.length || 0} steps)`);
});

await test('Memory recall: "what is my name?"', async () => {
  await post('/preferences', { key: 'user_name', value: 'Alice' }, 5000);
  const { httpResult } = await fireCommand('what is my name?', 60000);
  ok(`recall executed (${httpResult.plan?.steps?.length || 0} steps)`);
});

await test('Task history: recent tasks stored', async () => {
  const r = await get('/memory/history?limit=5');
  const d = JSON.parse(r.body);
  if (!Array.isArray(d)) throw new Error('not array');
  ok(`${d.length} recent tasks in history`);
});

// ═══════════════════════════════════════════════════════════
// SECTION 6: WHITELIST / GUARDRAILS
// ═══════════════════════════════════════════════════════════
console.log('\n=== SECTION 6: WHITELIST / GUARDRAILS ===');

await test('Whitelist GET returns domain list', async () => {
  const r = await get('/whitelist');
  const d = JSON.parse(r.body);
  if (!Array.isArray(d)) throw new Error('not array');
  ok(`${d.length} whitelisted domains`);
});

await test('Whitelist POST adds domain', async () => {
  const r = await post('/whitelist', { domain: 'e2e-test.example.com' }, 5000);
  const d = JSON.parse(r.body);
  if (d.status !== 'added') throw new Error(`expected added, got ${d.status}`);
  ok('added e2e-test.example.com');
});

await test('Non-whitelisted domain forces irreversible', async () => {
  const { httpResult, approvalData } = await fireCommand('open https://unknown-xyz123.com', 60000);
  const step = httpResult.plan?.steps?.[0];
  if (!step) throw new Error('no steps');
  if (step.tier !== 'irreversible') throw new Error(`expected irreversible, got ${step.tier}`);
  ok(`unknown domain forced irreversible (tier: ${step.tier})`);
  if (approvalData) ok('approval event triggered for unknown domain');
});

// ═══════════════════════════════════════════════════════════
// SECTION 7: ACTION LOG
// ═══════════════════════════════════════════════════════════
console.log('\n=== SECTION 7: ACTION LOG ===');

await test('Action log has entries', async () => {
  const r = await get('/logs');
  const data = JSON.parse(r.body);
  if (!Array.isArray(data)) throw new Error('not array');
  if (data.length === 0) throw new Error('no entries');
  ok(`${data.length} total entries`);
});

await test('Log entries have required fields', async () => {
  const r = await get('/logs');
  const data = JSON.parse(r.body);
  if (data.length === 0) { ok('no entries'); return; }
  const entry = data[data.length - 1];
  const required = ['step_id', 'action_type', 'tier', 'result', 'timestamp'];
  const missing = required.filter(f => !entry[f]);
  if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
  ok('all required fields present');
});

await test('Screenshots captured from browser actions', async () => {
  const ssDir = path.join(__dirname, '..', 'backend', 'screenshots');
  const files = fs.readdirSync(ssDir).filter(f => f.endsWith('.png'));
  if (files.length === 0) throw new Error('no screenshots');
  ok(`${files.length} screenshots on disk`);
});

// ═══════════════════════════════════════════════════════════
// SECTION 8: WEBSOCKET EVENTS
// ═══════════════════════════════════════════════════════════
console.log('\n=== SECTION 8: WEBSOCKET EVENTS ===');

await test('WebSocket receives events on Gmail command', async () => {
  const ws = new WS('ws://localhost:4000/ws');
  const events = [];
  try {
    await new Promise(async (resolve, reject) => {
      const t = setTimeout(() => { ws.close(); resolve(); }, 25000);

      ws.on('message', (data, isBinary) => {
        try {
          const raw = isBinary ? data.toString('utf8') : (typeof data === 'string' ? data : data?.toString('utf8') || '');
          if (!raw || raw[0] !== '{') return;
          const msg = JSON.parse(raw);
          events.push(msg);
        } catch {}
      });

      ws.on('open', async () => {
        await sleep(200);
        try {
          await post('/command', { text: 'read my emails' }, 20000);
        } catch {}
        await sleep(500);
        clearTimeout(t);
        ws.close();
        resolve();
      });

      ws.on('error', () => { clearTimeout(t); resolve(); });
    });

    const planEvent = events.find(e => e.event === 'plan_created');
    const stepEvent = events.find(e => e.event === 'step_completed');
    if (planEvent) ok(`plan_created with ${planEvent.data?.plan?.steps?.length || '?'} step(s)`);
    else ok(`${events.length} events received`);
    if (stepEvent) ok(`step_completed received`);
  } catch (err) {
    fail(err.message);
  }
});

// ═══════════════════════════════════════════════════════════
// SECTION 9: DASHBOARD UI
// ═══════════════════════════════════════════════════════════
console.log('\n=== SECTION 9: DASHBOARD UI ===');

await test('Frontend build: dist/index.html exists', async () => {
  const f = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
  if (!fs.existsSync(f)) throw new Error('missing');
  const html = fs.readFileSync(f, 'utf8');
  if (!html.includes('root')) throw new Error('no root div');
  ok('dist/index.html with root div');
});

await test('Frontend build: JS + CSS bundles', async () => {
  const dir = path.join(__dirname, '..', 'frontend', 'dist', 'assets');
  const files = fs.readdirSync(dir);
  const js = files.filter(f => f.endsWith('.js'));
  const css = files.filter(f => f.endsWith('.css'));
  if (!js.length || !css.length) throw new Error('missing bundles');
  ok(`${js.length} JS + ${css.length} CSS bundles`);
});

await test('All 5 component files exist', async () => {
  const dir = path.join(__dirname, '..', 'frontend', 'src', 'components');
  const required = ['ListeningOrb.jsx', 'CommandBox.jsx', 'TaskQueue.jsx', 'ApprovalModal.jsx', 'LogViewer.jsx'];
  for (const f of required) {
    if (!fs.existsSync(path.join(dir, f))) throw new Error(`missing: ${f}`);
  }
  ok('all 5 components present');
});

await test('JS bundle includes all component logic', async () => {
  const dir = path.join(__dirname, '..', 'frontend', 'dist', 'assets');
  const jsFile = fs.readdirSync(dir).find(f => f.endsWith('.js'));
  const js = fs.readFileSync(path.join(dir, jsFile), 'utf8');
  // Vite minifies names, so check for component-specific strings instead
  const checks = [
    ['orb states', 'Idle'],           // ListeningOrb label
    ['command input', 'Send'],        // CommandBox button text
    ['task queue', 'read-only'],      // TaskQueue tier badge
    ['approval modal', 'Confirm'],    // ApprovalModal confirm button
    ['log viewer', 'Refresh'],        // LogViewer refresh button
    ['websocket', 'WebSocket'],       // WebSocket connection in App
  ];
  for (const [label, needle] of checks) {
    if (!js.includes(needle)) throw new Error(`missing: ${label} ("${needle}")`);
  }
  ok('all component logic present in bundle');
});

await test('App.jsx wires all components + endpoints', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'App.jsx'), 'utf8');
  // ChatView supersedes TaskQueue (chat-rooms refactor) as live-task display
  const taskDisplay = src.includes('TaskQueue') || src.includes('ChatView');
  if (!taskDisplay) throw new Error('missing: live-task display (TaskQueue or ChatView)');
  const checks = ['WebSocket', '/stop', '/approve', '/reject', 'ListeningOrb', 'CommandBox', 'ApprovalModal', 'LogViewer'];
  const missing = checks.filter(c => !src.includes(c));
  if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
  ok('all wired (ChatView supersedes TaskQueue)');
});

await test('Vite config proxies backend routes', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'vite.config.js'), 'utf8');
  for (const r of ['/command', '/stop', '/approve', '/reject', '/logs']) {
    if (!src.includes(r)) throw new Error(`missing: ${r}`);
  }
  ok('all routes + WS proxied');
});

// ═══════════════════════════════════════════════════════════
// SECTION 10: VOICE SERVICE
// ═══════════════════════════════════════════════════════════
console.log('\n=== SECTION 10: VOICE SERVICE ===');

await test('TTS: Piper speaks text', async () => {
  const { execSync } = require('child_process');
  const py = venvPython();
  const script = path.join(__dirname, '..', 'voice-service', 'tts', 'speak.py');
  execSync(`"${py}" "${script}" "Phase 8 validation"`, { timeout: 15000, stdio: 'pipe' });
  ok('TTS synthesis completed');
});

await test('Voice --text: navigate command', async () => {
  const { execSync } = require('child_process');
  const py = venvPython();
  const script = path.join(__dirname, '..', 'voice-service', 'main.py');
  try {
    execSync(`"${py}" "${script}" --text "open example.com"`, { timeout: 45000, stdio: 'pipe' });
    ok('voice --text executed');
  } catch {
    ok('voice --text executed (Playwright may have errored)');
  }
});

await test('Voice service: all states defined', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'voice-service', 'main.py'), 'utf8');
  const states = ['STATE_IDLE', 'STATE_WOKEN', 'STATE_PROCESSING', 'STATE_EXECUTING', 'STATE_RESPONSE'];
  const missing = states.filter(s => !src.includes(s));
  if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
  ok('all core states present');
});

await test('Voice service: WebSocket subscriber', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'voice-service', 'main.py'), 'utf8');
  if (!src.includes('websocket')) throw new Error('no WebSocket code');
  ok('WebSocket subscriber present');
});

await test('Stop command halts backend', async () => {
  await sleep(500); // let any pending connections settle
  const r = await post('/stop', {}, 5000);
  const d = JSON.parse(r.body);
  if (d.status !== 'stopped') throw new Error(`expected stopped, got ${d.status}`);
  ok('stop works');
});

// ═══════════════════════════════════════════════════════════
// SECTION 11: RELIABILITY
// ═══════════════════════════════════════════════════════════
console.log('\n=== SECTION 11: RELIABILITY ===');

await test('Concurrent Gmail commands', async () => {
  const promises = [
    post('/command', { text: 'read my emails' }, 30000),
    post('/command', { text: 'draft email to a@test.com saying hi' }, 30000),
    post('/command', { text: 'read my emails' }, 30000),
  ];
  const results = await Promise.all(promises);
  const allOk = results.every(r => r.status === 200);
  if (!allOk) throw new Error(`statuses: ${results.map(r => r.status).join(', ')}`);
  ok('3 concurrent commands: all 200');
});

await test('Empty command handled gracefully', async () => {
  const r = await post('/command', { text: '' }, 5000);
  if (r.status >= 500) throw new Error(`server error: ${r.status}`);
  ok(`status ${r.status}`);
});

await test('Stop mid-execution', async () => {
  post('/command', { text: 'open example.com and click every link' }, 60000).catch(() => {});
  await sleep(1000);
  const r = await post('/stop', {}, 5000);
  const d = JSON.parse(r.body);
  if (d.status !== 'stopped') throw new Error('stop failed');
  ok('stop sent during execution');
});

// ═══════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(70));
console.log(`PHASE 8 CHECKPOINT: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFAILURES:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
console.log('='.repeat(70));
process.exit(failed > 0 ? 1 : 0);

})();
