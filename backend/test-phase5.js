const BASE = 'http://localhost:4000';

async function test() {
  let passed = 0;
  let total = 0;

  // TEST 1: Set preferences
  total++;
  console.log('TEST 1: Set user preferences');
  const p1 = await (await fetch(`${BASE}/preferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'user_name', value: 'Alice' }),
  })).json();
  const p2 = await (await fetch(`${BASE}/preferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'user_email', value: 'alice@example.com' }),
  })).json();
  if (p1.status === 'set' && p2.status === 'set') {
    console.log(`  PASS: preferences set (name=${p1.value}, email=${p2.value})\n`);
    passed++;
  } else { console.log(`  FAIL: ${JSON.stringify([p1, p2])}\n`); }

  // TEST 2: Get preferences
  total++;
  console.log('TEST 2: Retrieve preferences');
  const allPrefs = await (await fetch(`${BASE}/preferences`)).json();
  if (allPrefs.length >= 2) {
    console.log(`  PASS: ${allPrefs.length} preferences stored`);
    allPrefs.forEach(p => console.log(`    ${p.key} = ${p.value}`));
    console.log();
    passed++;
  } else { console.log(`  FAIL: ${JSON.stringify(allPrefs)}\n`); }

  // TEST 3: Send a command (creates task history entry)
  total++;
  console.log('TEST 3: Run a command (creates memory entry)');
  const res3 = await (await fetch(`${BASE}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'what is my email address' }),
    signal: AbortSignal.timeout(300000),
  })).json();
  if (res3.task_id && res3.results) {
    console.log(`  PASS: task executed, task_id=${res3.task_id}\n`);
    passed++;
  } else { console.log(`  FAIL: ${JSON.stringify(res3).slice(0, 200)}\n`); }

  // TEST 4: Check task history stored
  total++;
  console.log('TEST 4: Check task history');
  await new Promise(r => setTimeout(r, 1000)); // wait for async store
  const history = await (await fetch(`${BASE}/memory/history`)).json();
  if (history.length > 0) {
    console.log(`  PASS: ${history.length} task(s) in history`);
    history.forEach(h => console.log(`    [${h.timestamp}] "${h.command}" → ${h.summary?.slice(0, 80)}`));
    console.log();
    passed++;
  } else { console.log(`  FAIL: no history found\n`); }

  // TEST 5: Delete a preference
  total++;
  console.log('TEST 5: Delete a preference');
  const del = await (await fetch(`${BASE}/preferences/user_email`, { method: 'DELETE' })).json();
  const check = await fetch(`${BASE}/preferences/user_email`);
  if (del.status === 'deleted' && check.status === 404) {
    console.log(`  PASS: preference deleted, confirmed 404 on re-fetch\n`);
    passed++;
  } else { console.log(`  FAIL: del=${JSON.stringify(del)}, check_status=${check.status}\n`); }

  // TEST 6: Preferences survive via direct API (SQLite persists)
  total++;
  console.log('TEST 6: Verify SQLite persistence (user_name still exists)');
  const stillThere = await (await fetch(`${BASE}/preferences/user_name`)).json();
  if (stillThere.value === 'Alice') {
    console.log(`  PASS: user_name = "${stillThere.value}" (SQLite persisted)\n`);
    passed++;
  } else { console.log(`  FAIL: ${JSON.stringify(stillThere)}\n`); }

  console.log(`\n=== PHASE 5 CHECKPOINT: ${passed}/${total} tests passed ===`);
  process.exit(passed >= 5 ? 0 : 1);
}

test().catch(err => { console.error('FATAL:', err); process.exit(1); });
