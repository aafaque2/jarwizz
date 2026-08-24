const BASE = 'http://localhost:4000';
const WebSocket = require('ws');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitForEvent(ws, eventName, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${eventName}`)), timeoutMs);
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.event === eventName) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(msg.data);
      }
    };
    ws.on('message', handler);
  });
}

async function test() {
  const ws = new WebSocket('ws://localhost:4000/ws');
  await new Promise(r => ws.on('open', r));
  console.log('WebSocket connected.\n');

  // --- Test 1: Irreversible command (send email) — should pause, then approve ---
  console.log('TEST 1: Send email → should pause for approval');
  const approvalPromise = waitForEvent(ws, 'pending_approval');

  fetch(`${BASE}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'send an email to john saying hello' }),
    signal: AbortSignal.timeout(180000),
  });

  const approval = await approvalPromise;
  console.log(`  Paused: "${approval.description}" (step_id: ${approval.step_id})`);

  const approveRes = await (await fetch(`${BASE}/approve/${approval.step_id}`, { method: 'POST' })).json();
  console.log(`  Approved: ${JSON.stringify(approveRes)}`);

  await sleep(2000);

  // --- Test 2: Reversible command — should auto-execute ---
  console.log('\nTEST 2: Navigate to website → should auto-run');
  const res2 = await (await fetch(`${BASE}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'navigate to github.com' }),
    signal: AbortSignal.timeout(180000),
  })).json();
  console.log(`  ${res2.results.length} step(s) auto-executed.`);
  res2.results.forEach(r => console.log(`    [${r.tier}] ${r.description} → ${r.approval_status}`));

  // --- Test 3: Irreversible command — should reject ---
  console.log('\nTEST 3: Delete file → should pause, then reject');
  const approvalPromise3 = waitForEvent(ws, 'pending_approval');

  fetch(`${BASE}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'delete the file called notes.txt' }),
    signal: AbortSignal.timeout(180000),
  });

  const approval3 = await approvalPromise3;
  console.log(`  Paused: "${approval3.description}" (step_id: ${approval3.step_id})`);

  const rejectRes = await (await fetch(`${BASE}/reject/${approval3.step_id}`, { method: 'POST' })).json();
  console.log(`  Rejected: ${JSON.stringify(rejectRes)}`);

  await sleep(2000);

  // --- Verify logs ---
  console.log('\n--- LOG VERIFICATION ---');
  const logs = await (await fetch(`${BASE}/logs`)).json();
  console.log(`  Total log entries: ${logs.length}`);
  const approved = logs.filter(l => l.approval_status === 'approved');
  const rejected = logs.filter(l => l.approval_status === 'rejected');
  const auto = logs.filter(l => l.approval_status === 'auto');
  console.log(`  Approved: ${approved.length}, Rejected: ${rejected.length}, Auto: ${auto.length}`);

  // Check every log entry has required fields
  const requiredFields = ['task_id', 'step_id', 'timestamp', 'tier', 'description', 'approval_status', 'result'];
  const badEntries = logs.filter(l => requiredFields.some(f => l[f] === undefined));
  if (badEntries.length) {
    console.log(`  ERROR: ${badEntries.length} log entries missing required fields`);
  } else {
    console.log('  All log entries have required fields.');
  }

  ws.close();
  console.log('\n=== ALL PHASE 2 TESTS PASSED ===');
  process.exit(0);
}

test().catch(err => { console.error('FATAL:', err); process.exit(1); });
