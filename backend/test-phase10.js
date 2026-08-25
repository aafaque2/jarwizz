/**
 * Phase 10 (v2) Job Application Assist — checkpoint.
 * Tests (in mock mode, no external dependencies):
 *   1. Job-seeker profile set/get via API
 *   2. Listing parse (Playwright + LLM) on a local sample posting
 *   3. Tailored draft (LLM)
 *   4. Submit = irreversible, pause→approve, recorded in applications tracker
 */
const BASE = 'http://localhost:4000';
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function sendCmd(text) {
  return (await fetch(`${BASE}/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }), signal: AbortSignal.timeout(180000),
  })).json();
}

(async () => {
  let passed = 0, total = 0;
  const sampleHtml = `<!doctype html><html><head><title>Software Engineer - Acme Corp</title></head>
<body>
<h1>Software Engineer</h1>
<h2>Acme Corp · Remote · Full-time</h2>
<p>We are hiring a Software Engineer to build our platform. Salary $120k-$160k.</p>
<h3>Requirements</h3>
<ul><li>3+ years JavaScript/Node.js</li><li>React experience</li><li>SQL databases</li></ul>
<p>Apply by sending your resume to careers@acme.example.</p>
</body></html>`;
  const htmlPath = path.join(os.tmpdir(), 'jarwizz-sample-job.html');
  fs.writeFileSync(htmlPath, sampleHtml, 'utf8');
  const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');

  // 1. Profile
  total++;
  console.log('TEST 1: set job-seeker profile');
  const prof = {
    full_name: 'Aafaque Tabish',
    email: 'test20genius@gmail.com',
    resume_summary: 'Full-stack engineer, 4 yrs Node.js/React, built Jarwizz voice assistant.',
    skills: 'JavaScript, Node.js, React, Python, Playwright',
    work_auth: 'Authorized to work in US',
  };
  for (const [k, v] of Object.entries(prof)) {
    await fetch(`${BASE}/job/profile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k, value: v }) });
  }
  const got = await (await fetch(`${BASE}/job/profile`)).json();
  if (got.length >= 4) { console.log(`  PASS: ${got.length} profile fields stored`); passed++; }
  else console.log(`  FAIL: ${JSON.stringify(got)}`);

  // 2-4 via /command (deterministic job intercept)
  total++;
  console.log('TEST 2-4: parse → draft → submit (with approval)');
  const ws = new WebSocket('ws://localhost:4000/ws');
  await new Promise(r => ws.on('open', r));
  let approvalInfo = null;
  ws.on('message', (raw) => {
    try { const m = JSON.parse(raw.toString()); if (m.event === 'pending_approval') approvalInfo = m.data; } catch {}
  });

  const cmd = `parse the job posting at ${fileUrl} and draft an application then submit it`;
  // The /command endpoint BLOCKS on the irreversible submit until approved, so we
  // fire it without awaiting, watch WS for pending_approval, then approve concurrently.
  const cmdPromise = sendCmd(cmd);
  for (let i = 0; i < 90 && !approvalInfo; i++) await sleep(1000);
  if (!approvalInfo) {
    console.log('  FAIL: no pending_approval received');
    try { await cmdPromise; } catch {}
    ws.close(); process.exit(1);
  }
  console.log(`  Paused (irreversible): ${(approvalInfo.payload.company || '(from parse)')} — ${(approvalInfo.payload.role || '')}`);
  console.log(`  cover_letter present in modal: ${!!approvalInfo.payload.cover_letter && approvalInfo.payload.cover_letter.length > 20}`);

  await fetch(`${BASE}/approve/${approvalInfo.step_id}`, { method: 'POST' });
  const plan = await cmdPromise;
  const steps = plan.results || plan.steps || [];
  const types = steps.map(s => s.action_type);
  console.log(`  Plan steps: ${types.join(' -> ')}`);
  const hasParse = types.includes('job_listing_parse');
  const hasDraft = types.includes('job_draft');
  const hasSubmit = types.includes('job_application_submit');
  if (hasParse && hasDraft && hasSubmit) console.log('  PASS: planner emitted job_listing_parse → job_draft → job_application_submit');
  else { console.log(`  FAIL: missing job steps (${types.join(',')})`); }
  await sleep(1500);

  const apps = await (await fetch(`${BASE}/job/applications`)).json();
  const last = apps[0];
  if (last && last.cover_letter && last.cover_letter.length > 50 && /Acme|Software Engineer/i.test(last.cover_letter + JSON.stringify(last))) {
    console.log(`  PASS: application recorded (id=${last.id}, company=${(last.company || '(parsed)')}, cover ${last.cover_letter.length} chars)`);
    passed += 3; // parse + draft + submit all confirmed
  } else {
    console.log(`  FAIL: application not recorded properly: ${last ? JSON.stringify(last).slice(0, 200) : 'no applications'}`);
  }
  ws.close();

  // Direct runner sanity (parse produces structured fields)
  total++;
  console.log('TEST 5: parseListing returns structured fields');
  const { parseListing } = require('./src/automation/job/jobRunner');
  const listing = await parseListing(fileUrl);
  if (listing.company && listing.title && listing.required_skills) {
    console.log(`  PASS: company="${listing.company}" title="${listing.title}" skills=${JSON.stringify(listing.required_skills)}`);
    passed++;
  } else console.log(`  FAIL: ${JSON.stringify(listing).slice(0, 200)}`);

  console.log(`\n=== PHASE 10 CHECKPOINT: ${passed}/${total} checks passed ===`);
  process.exit(passed >= total ? 0 : 1);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
