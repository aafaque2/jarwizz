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
    signal: AbortSignal.timeout(180000),
  })).json();
}

async function test() {
  const ws = new WebSocket('ws://localhost:4000/ws');
  await new Promise(r => ws.on('open', r));
  console.log('WebSocket connected.\n');

  let passed = 0;
  let total = 0;

  // TEST 1: Navigate to example.com
  total++;
  console.log('TEST 1: Navigate to example.com');
  const res1 = await sendCmd('navigate to example.com');
  const s1 = res1.results[0];
  if (s1.status === 'completed' && s1.screenshot_before && s1.screenshot_after && s1.output?.title) {
    console.log(`  PASS: title="${s1.output.title}"\n`); passed++;
  } else { console.log(`  FAIL: ${JSON.stringify(s1).slice(0, 200)}\n`); }

  // TEST 2: Read page content
  total++;
  console.log('TEST 2: Read page content');
  const res2 = await sendCmd('read the page at example.com');
  const s2 = res2.results.find(r => r.action_type === 'browser_read');
  if (s2?.status === 'completed' && s2.output?.text?.includes('Example Domain')) {
    console.log(`  PASS: text contains "Example Domain"\n`); passed++;
  } else { console.log(`  FAIL: ${JSON.stringify(s2).slice(0, 200)}\n`); }

  // TEST 3: Click a link (use a direct link command the 3B model handles better)
  total++;
  console.log('TEST 3: Click a link on example.com');
  const res3 = await sendCmd('go to example.com and click on More information');
  const s3 = res3.results.find(r => r.action_type === 'browser_click');
  if (s3?.status === 'completed' && s3.output?.url) {
    console.log(`  PASS: navigated to ${s3.output.url}\n`); passed++;
  } else { console.log(`  FAIL: ${JSON.stringify(s3).slice(0, 200)}\n`); }

  // TEST 4: Scroll page
  total++;
  console.log('TEST 4: Scroll page');
  const res4 = await sendCmd('scroll down on example.com');
  const s4 = res4.results.find(r => r.action_type === 'browser_scroll');
  if (s4?.status === 'completed' && s4.output?.scrollY !== undefined && s4.screenshot_before && s4.screenshot_after) {
    console.log(`  PASS: scrolled, scrollY=${s4.output.scrollY}\n`); passed++;
  } else { console.log(`  FAIL: ${JSON.stringify(s4).slice(0, 200)}\n`); }

  // TEST 5: Type into a search field (use GitHub which has a search box)
  total++;
  console.log('TEST 5: Type into GitHub search box');
  const res5 = await sendCmd('open github.com and type playwright into the search box');
  const s5 = res5.results.find(r => r.action_type === 'browser_type');
  if (s5?.status === 'completed' && s5.output?.filled === 'playwright') {
    console.log(`  PASS: typed "playwright" into search\n`); passed++;
  } else { console.log(`  FAIL: ${JSON.stringify(s5).slice(0, 200)}\n`); }

  // TEST 6: Non-whitelisted domain forces approval
  total++;
  console.log('TEST 6: Non-whitelisted domain → forces approval');
  const approvalP = waitForEvent(ws, 'pending_approval');
  sendCmd('navigate to supersecret-example-test.xyz');
  const app6 = await approvalP;
  if (app6.tier === 'irreversible' && app6.whitelist_override) {
    console.log(`  PASS: forced approval (whitelist_override=true)`);
    await fetch(`${BASE}/approve/${app6.step_id}`, { method: 'POST' });
    console.log(`  Approved.\n`);
    passed++;
  } else { console.log(`  FAIL: tier=${app6.tier}, whitelist_override=${app6.whitelist_override}\n`); }

  // LOG VERIFICATION
  console.log('--- LOG VERIFICATION ---');
  const logs = await (await fetch(`${BASE}/logs`)).json();
  console.log(`  Total log entries: ${logs.length}`);
  const requiredFields = ['task_id', 'step_id', 'timestamp', 'tier', 'description', 'approval_status', 'result'];
  const badEntries = logs.filter(l => requiredFields.some(f => l[f] === undefined));
  if (badEntries.length) console.log(`  WARNING: ${badEntries.length} entries missing fields`);
  else console.log('  All entries have required fields.');

  // Check screenshots were captured
  const withScreenshots = logs.filter(l => l.screenshot_before && l.screenshot_after);
  console.log(`  Entries with before+after screenshots: ${withScreenshots.length}`);

  ws.close();
  console.log(`\n=== PHASE 3 CHECKPOINT: ${passed}/${total} tests passed ===`);
  process.exit(passed >= 5 ? 0 : 1); // 5 of 6 required by checkpoint
}

test().catch(err => { console.error('FATAL:', err); process.exit(1); });
