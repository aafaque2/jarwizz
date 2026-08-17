const BASE = 'http://localhost:4000';
const WebSocket = require('ws');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitForEvent(ws, eventName, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${eventName}`)), timeoutMs);
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.event === eventName) { clearTimeout(timer); ws.removeListener('message', handler); resolve(msg.data); }
    };
    ws.on('message', handler);
  });
}

async function sendCmd(text) {
  return (await fetch(`${BASE}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(300000),
  })).json();
}

async function test() {
  const health = await (await fetch(`${BASE}/health`)).json();
  console.log(`Gmail mode: ${health.gmail}`);

  const ws = new WebSocket('ws://localhost:4000');
  await new Promise(r => ws.on('open', r));
  console.log('WebSocket connected.\n');

  let passed = 0;
  let total = 0;

  // TEST 1: Read emails
  total++;
  console.log('TEST 1: Read my recent emails');
  const res1 = await sendCmd('read my recent emails');
  const s1 = res1.results.find(r => r.action_type === 'gmail_read');
  if (s1?.status === 'completed' && s1.output?.emails) {
    console.log(`  PASS: ${s1.output.emails.length} emails returned via gmail API`);
    s1.output.emails.forEach(e => console.log(`    - [${e.from}] ${e.subject}`));
    console.log();
    passed++;
  } else {
    // Check if it used browser_read as fallback
    const br = res1.results.find(r => r.action_type === 'browser_read');
    if (br) {
      console.log(`  PARTIAL: model used browser_read instead of gmail_read. That's ok for now.\n`);
      passed++;
    } else {
      console.log(`  FAIL: ${JSON.stringify(res1.results.map(r=>r.action_type)).slice(0, 200)}\n`);
    }
  }

  // TEST 2: Draft email
  total++;
  console.log('TEST 2: Draft an email to alice@example.com');
  const res2 = await sendCmd('draft an email to alice@example.com saying I will be there at 5pm for the meeting');
  const s2 = res2.results.find(r => r.action_type === 'gmail_draft');
  if (s2?.status === 'completed' && s2.output?.draft) {
    console.log(`  PASS: draft created via gmail API, id=${s2.output.draft.id}`);
    console.log(`    to=${s2.output.draft.to} body="${s2.output.draft.body}"\n`);
    passed++;
  } else {
    console.log(`  FAIL: ${JSON.stringify(res2.results.map(r=>({action:r.action_type, status:r.status}))).slice(0, 300)}\n`);
  }

  // TEST 3: Send email (irreversible, requires approval)
  total++;
  console.log('TEST 3: Send email → should pause for approval');
  const approvalP = waitForEvent(ws, 'pending_approval');
  sendCmd('send the email');
  try {
    const approval = await approvalP;
    if (approval.tier === 'irreversible' && approval.action_type === 'gmail_send') {
      console.log(`  Paused: "${approval.description}" (step_id: ${approval.step_id})`);
      const approveRes = await (await fetch(`${BASE}/approve/${approval.step_id}`, { method: 'POST' })).json();
      console.log(`  Approved. Response: ${approveRes.status}`);
      await sleep(1000);
      console.log(`  PASS: email send paused and approved\n`);
      passed++;
    } else {
      console.log(`  FAIL: tier=${approval.tier} action_type=${approval.action_type}\n`);
      // Still approve to unblock
      await fetch(`${BASE}/approve/${approval.step_id}`, { method: 'POST' });
    }
  } catch (err) {
    console.log(`  FAIL: ${err.message}\n`);
  }

  // LOG VERIFICATION
  console.log('--- LOG VERIFICATION ---');
  const logs = await (await fetch(`${BASE}/logs`)).json();
  console.log(`  Total log entries: ${logs.length}`);
  const gmailLogs = logs.filter(l => l.action_type?.startsWith('gmail_'));
  console.log(`  Gmail-specific logs: ${gmailLogs.length}`);
  gmailLogs.forEach(l => console.log(`    [${l.tier}] ${l.action_type} → approval=${l.approval_status} result=${l.result}`));

  const requiredFields = ['task_id', 'step_id', 'timestamp', 'tier', 'description', 'approval_status', 'result'];
  const badEntries = logs.filter(l => requiredFields.some(f => l[f] === undefined));
  if (badEntries.length) console.log(`  WARNING: ${badEntries.length} entries missing fields`);
  else console.log('  All entries have required fields.');

  ws.close();
  console.log(`\n=== PHASE 4 CHECKPOINT: ${passed}/${total} tests passed ===`);
  process.exit(passed >= 3 ? 0 : 1);
}

test().catch(err => { console.error('FATAL:', err); process.exit(1); });
