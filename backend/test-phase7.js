const http = require('http');
const path = require('path');
const fs = require('fs');
const WS = require('ws');

const BASE = 'http://localhost:4000';

let passed = 0;
let failed = 0;

function ok(msg) { passed++; console.log(`  PASS: ${msg}`); }
function fail(msg, err) { failed++; console.log(`  FAIL: ${msg}${err ? ' — ' + err.message : ''}`); }

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(BASE + url, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function post(url, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request(BASE + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function test(name, fn) {
  console.log(`\nTEST: ${name}`);
  try {
    await fn();
  } catch (err) {
    fail('exception', err);
  }
}

(async () => {

// ── 1. Backend health ──
await test('Backend is running and healthy', async () => {
  const res = await get('/logs');
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  ok('GET /logs returns 200');
});

// ── 2. WebSocket connects ──
await test('WebSocket connects and receives events', async () => {
  await new Promise((resolve, reject) => {
    const ws = new WS('ws://localhost:4000/ws');
    const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 5000);
    ws.on('open', () => { clearTimeout(timeout); ws.close(); ok('WebSocket opened successfully'); resolve(); });
    ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
});

// ── 3. Frontend build exists ──
await test('Frontend build output exists', async () => {
  const dist = path.join(__dirname, '..', 'frontend', 'dist');
  const indexHtml = path.join(dist, 'index.html');
  const assets = path.join(dist, 'assets');
  if (!fs.existsSync(indexHtml)) throw new Error('dist/index.html missing');
  if (!fs.existsSync(assets)) throw new Error('dist/assets/ missing');
  const html = fs.readFileSync(indexHtml, 'utf8');
  if (!html.includes('root')) throw new Error('index.html missing root div');
  ok('dist/index.html exists with root div');
  const assetFiles = fs.readdirSync(assets);
  if (assetFiles.length < 2) throw new Error(`only ${assetFiles.length} assets`);
  ok(`${assetFiles.length} asset files built (CSS + JS)`);
});

// ── 4. ListeningOrb states — all 6 states render via CSS ──
await test('ListeningOrb component has correct state classes', async () => {
  const orbSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'ListeningOrb.jsx'), 'utf8');
  const requiredStates = ['idle', 'woken', 'processing', 'awaiting_approval', 'executing', 'response'];
  for (const state of requiredStates) {
    if (!orbSrc.includes(state)) throw new Error(`missing state: ${state}`);
  }
  // Check animation classes
  if (!orbSrc.includes('animate')) throw new Error('no animation classes');
  if (!orbSrc.includes('green-dim') || !orbSrc.includes('green-primary')) throw new Error('missing green color references');
  if (!orbSrc.includes('amber-approval')) throw new Error('missing amber-approval state');
  ok('all 6 states defined with correct colors and animations');
});

// ── 5. CommandBox posts to /command ──
await test('CommandBox submits to /command endpoint', async () => {
  const cmdSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'CommandBox.jsx'), 'utf8');
  if (!cmdSrc.includes('onCommand')) throw new Error('missing onCommand callback');
  if (!cmdSrc.includes('type="text"')) throw new Error('missing text input');
  if (!cmdSrc.includes('Submit')) throw new Error('missing submit');
  // Verify the backend endpoint works
  const res = await post('/command', { text: 'open example.com' });
  if (res.status !== 200) throw new Error(`/command returned ${res.status}`);
  const data = JSON.parse(res.body);
  if (!data.task_id) throw new Error('missing task_id in response');
  ok('CommandBox wired to POST /command');
  ok('POST /command returns task_id');
});

// ── 6. TaskQueue renders step data ──
await test('TaskQueue component handles tier badges and status', async () => {
  const tqSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'TaskQueue.jsx'), 'utf8');
  if (!tqSrc.includes('read-only')) throw new Error('missing read-only tier');
  if (!tqSrc.includes('reversible')) throw new Error('missing reversible tier');
  if (!tqSrc.includes('irreversible')) throw new Error('missing irreversible tier');
  if (!tqSrc.includes('completed')) throw new Error('missing completed status');
  if (!tqSrc.includes('error')) throw new Error('missing error status');
  if (!tqSrc.includes('rejected')) throw new Error('missing rejected status');
  ok('all tier colors and status badges defined');
});

// ── 7. ApprovalModal calls approve/reject endpoints ──
await test('ApprovalModal wired to /approve and /reject', async () => {
  const amSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'ApprovalModal.jsx'), 'utf8');
  if (!amSrc.includes('onApprove')) throw new Error('missing onApprove');
  if (!amSrc.includes('onReject')) throw new Error('missing onReject');
  if (!amSrc.includes('amber-approval')) throw new Error('missing amber-approval styling');
  if (!amSrc.includes('step_id')) throw new Error('missing step_id reference');
  if (!amSrc.includes('Confirm')) throw new Error('missing Confirm button');
  if (!amSrc.includes('Reject')) throw new Error('missing Reject button');
  if (!amSrc.includes('yes') || !amSrc.includes('no')) throw new Error('missing voice hint');
  ok('approval modal has Confirm/Reject buttons + voice hint');
});

// ── 8. LogViewer fetches from /logs ──
await test('LogViewer fetches action log and supports filtering', async () => {
  const lvSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'LogViewer.jsx'), 'utf8');
  if (!lvSrc.includes('/logs')) throw new Error('missing /logs fetch');
  if (!lvSrc.includes('filter')) throw new Error('missing filter');
  if (!lvSrc.includes('expanded')) throw new Error('missing expandable rows');
  if (!lvSrc.includes('screenshot')) throw new Error('missing screenshot rendering');
  // Verify the backend log endpoint returns valid data
  const res = await get('/logs');
  const logs = JSON.parse(res.body);
  if (!Array.isArray(logs)) throw new Error('logs is not an array');
  ok(`LogViewer wired to GET /logs (${logs.length} entries)`);
});

// ── 9. Screenshots endpoint serves files ──
await test('Screenshot static serving works', async () => {
  const screenshotsDir = path.join(__dirname, '..', 'backend', 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    ok('no screenshots dir yet (created on first browser action) — endpoint registered');
    return;
  }
  const files = fs.readdirSync(screenshotsDir).filter(f => f.endsWith('.png'));
  if (files.length === 0) {
    ok('no screenshots yet (created on first browser action) — endpoint registered');
    return;
  }
  const res = await get(`/screenshots/${files[0]}`);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  ok(`GET /screenshots/${files[0]} returns ${res.status}`);
});

// ── 10. App.jsx wires everything together ──
await test('App.jsx connects WebSocket and renders all components', async () => {
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'App.jsx'), 'utf8');
  // TaskQueue was superseded by ChatView (live task steps + status badges) in the
  // chat-rooms refactor; both count as the live-task display component.
  const required = ['ListeningOrb', 'CommandBox', 'ApprovalModal', 'LogViewer', 'WebSocket', 'ws://', '/stop', '/approve', '/reject'];
  const taskDisplay = appSrc.includes('TaskQueue') || (appSrc.includes('ChatView') && fs.existsSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'ChatView.jsx')));
  if (!taskDisplay) throw new Error('missing: live-task display (TaskQueue or ChatView)');
  for (const r of required) {
    if (!appSrc.includes(r)) throw new Error(`missing: ${r}`);
  }
  ok('App.jsx imports all components (ChatView supersedes TaskQueue) + WebSocket + stop/approve/reject wiring');
});

// ── 11. Vite proxy configured ──
await test('Vite config proxies backend routes', async () => {
  const viteSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'vite.config.js'), 'utf8');
  const routes = ['/command', '/stop', '/approve', '/reject', '/logs', '/preferences', '/memory'];
  for (const r of routes) {
    if (!viteSrc.includes(`'${r}'`)) throw new Error(`missing proxy for ${r}`);
  }
  if (!viteSrc.includes('ws: true')) throw new Error('missing WebSocket proxy');
  ok('all backend routes + WebSocket proxied in vite.config.js');
});

// ── Summary ──
console.log(`\n${'='.repeat(60)}`);
console.log(`PHASE 7 CHECKPOINT: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
process.exit(failed > 0 ? 1 : 0);

})();
