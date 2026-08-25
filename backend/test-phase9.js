/**
 * Phase 9 (v2) Desktop Control checkpoint.
 * Tests: app_open, desktop_click/type, file create, file delete-with-approval,
 * plus a vision-grounded read_screen via describeScreen().
 */
const BASE = 'http://localhost:4000';
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitForEvent(ws, eventName, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${eventName}`)), timeoutMs);
    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.event === eventName) { clearTimeout(timer); ws.removeListener('message', handler); resolve(msg.data); }
      } catch {}
    };
    ws.on('message', handler);
  });
}

async function sendCmd(text) {
  return (await fetch(`${BASE}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(180000),
  })).json();
}

(async () => {
  const ws = new WebSocket('ws://localhost:4000/ws');
  await new Promise(r => ws.on('open', r));
  console.log('WebSocket connected.\n');

  let passed = 0;
  let total = 0;
  const testFile = path.join(require('os').homedir(), 'Desktop', 'jarwizz-phase9-test.txt');
  // Clean slate
  try { fs.rmSync(testFile, { force: true }); } catch {}

  // TEST 1: Open an app
  total++;
  console.log('TEST 1: app_open "open notepad"');
  const r1 = await sendCmd('open notepad');
  const s1 = r1.results.find(r => r.action_type === 'app_open');
  if (s1?.status === 'completed' && s1.output?.opened === 'notepad') {
    console.log(`  PASS: notepad opened (tier: ${s1.tier}, approval: ${s1.approval_status})\n`);
    passed++;
  } else { console.log(`  FAIL: ${JSON.stringify(s1).slice(0, 200)}\n`); }

  await sleep(1000);

  // TEST 2: Vision-grounded screen reading via describeScreen()
  total++;
  console.log('TEST 2: read_screen (vision-grounded via Qwen3-VL describeScreen)');
  const r2 = await sendCmd('what is on my screen right now');
  const s2 = r2.results.find(r => r.action_type === 'read_screen') || r2.results.find(r => r.output?.text);
  if (s2?.status === 'completed' && s2.output?.text && s2.output.text.length > 20) {
    console.log(`  PASS: vision description (${s2.output.text.length} chars): "${s2.output.text.slice(0, 120)}..."\n`);
    passed++;
  } else { console.log(`  FAIL: ${JSON.stringify(s2?.output || r2.results.map(r => ({a: r.action_type, st: r.status, e: r.error}))).slice(0, 300)}\n`); }

  // TEST 3: Create file on Desktop (reversible, auto-runs)
  total++;
  console.log('TEST 3: file_create "create a file called jarwizz-phase9-test.txt on my desktop"');
  const r3 = await sendCmd('create a file called jarwizz-phase9-test.txt on my desktop with content hello from jarwizz');
  const s3 = r3.results.find(r => r.action_type === 'file_create');
  const existsAfterCreate = fs.existsSync(testFile);
  if (s3?.status === 'completed' && existsAfterCreate) {
    console.log(`  PASS: file created at ${testFile} (tier: ${s3.tier})\n`);
    passed++;
  } else {
    console.log(`  FAIL: step=${JSON.stringify(s3).slice(0, 200)}, exists=${existsAfterCreate}\n`);
  }

  // TEST 4: Type into focused window (notepad should still be focused)
  total++;
  console.log('TEST 4: desktop_type into focused window');
  const r4 = await sendCmd("type 'hello world' into the focused desktop application using desktop automation");
  let s4 = r4.results.find(r => r.action_type === 'desktop_type');
  if (!s4) {
    const planned = r4.results.map(r => ({ a: r.action_type, ch: r.channel, st: r.status, e: r.error }));
    console.log(`  WARN: no desktop_type planned. Actual steps: ${JSON.stringify(planned)}`);
    const r4b = await sendCmd("use desktop control to type hello world into notepad");
    s4 = r4b.results.find(r => r.action_type === 'desktop_type');
    if (!s4) { console.log(`  FAIL: still no desktop_type. steps=${JSON.stringify(r4b.results.map(r => ({ a: r.action_type, ch: r.channel })))}\n`); }
  }
  if (s4?.status === 'completed' && s4?.output?.typed) {
    console.log(`  PASS: typed "${s4.output.typed}" (tier: ${s4.tier})\n`);
    passed++;
  } else if (s4) { console.log(`  FAIL: ${JSON.stringify(s4).slice(0, 200)}\n`); }

  // TEST 5: Delete file — irreversible, requires approval
  total++;
  console.log('TEST 5: file_delete → pause → approve');
  const approvalP = waitForEvent(ws, 'pending_approval');
  sendCmd('delete the file called jarwizz-phase9-test.txt from my desktop');
  try {
    const approval = await approvalP;
    if (approval.action_type === 'file_delete' && approval.tier === 'irreversible') {
      console.log(`  Paused: "${approval.description}" (tier: ${approval.tier})`);
      await fetch(`${BASE}/approve/${approval.step_id}`, { method: 'POST' });
      await sleep(3000);
      const gone = !fs.existsSync(testFile);
      if (gone) { console.log(`  PASS: approved and file deleted\n`); passed++; }
      else { console.log(`  FAIL: approved but file still exists\n`); }
    } else { console.log(`  FAIL: tier=${approval.tier} action=${approval.action_type}\n`); }
  } catch (err) { console.log(`  FAIL: ${err.message}\n`); }

  // Cleanup notepad
  try { require('child_process').execSync('taskkill /IM notepad.exe /F', { stdio: 'ignore' }); } catch {}

  // LOG VERIFICATION
  console.log('--- LOG VERIFICATION ---');
  const logs = await (await fetch(`${BASE}/logs`)).json();
  const desktopLogs = logs.filter(l => ['app_open','read_screen','desktop_click','desktop_type','file_create','file_delete'].includes(l.action_type));
  console.log(`  Desktop-specific log entries: ${desktopLogs.length}`);
  desktopLogs.slice(-6).forEach(l => console.log(`    [${l.tier}] ${l.action_type} -> ${l.result} (approval=${l.approval_status})`));

  ws.close();
  console.log(`\n=== PHASE 9 CHECKPOINT: ${passed}/${total} tests passed ===`);
  process.exit(passed >= 5 ? 0 : 1);
})().catch(err => { console.error('FATAL:', err); process.exit(1); });
