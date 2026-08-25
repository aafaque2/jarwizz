/**
 * Phase 10 — Job Application Assist.
 * - parseListing(url): open posting via Playwright, extract structured fields with the LLM.
 * - draftApplication(listing, profile): LLM writes a tailored cover letter / email.
 * - submitApplication(...): records the submission (mock or real Gmail draft) + tracks it.
 * Vision/screen reading is NOT used here — postings are HTML text, which the local model
 * extracts more reliably than OCR. One model, one endpoint (llama.cpp + Qwen3-VL).
 */
const path = require('path');
const fs = require('fs');
const { newPage, closeBrowser } = require('../browser/playwrightRunner');
const { completeJson, complete } = require('../../model/llamacppClient');
const { getJobProfile, addApplication } = require('../../memory/store');

const APPLICATIONS_DIR = path.join(require('os').homedir(), 'Desktop', 'jarwizz-applications');

async function parseListing(url) {
  if (!url || !/^(https?|file):\/\//i.test(url)) throw new Error('parseListing: invalid url');
  const page = await newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Give SPA/ATS pages a moment to render
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => (document.body ? document.body.innerText : '').slice(0, 6000));
    const title = await page.title();
    const prompt = 'Extract structured job-posting fields from this text as JSON only:\n' +
      '{"title": string, "company": string, "location": string, "employment_type": string,\n' +
      '"salary": string, "required_skills": string[], "summary": string, "apply_url": string}\n' +
      'If a field is unknown, use "". Posting title (page): ' + title + '\n---\n' + text;
    const fields = await completeJson(
      [{ role: 'user', content: prompt }],
      { temperature: 0.1, max_tokens: 700 }
    );
    return { url, ...fields, parsed_at: new Date().toISOString() };
  } finally {
    try { await closeBrowser(); } catch (e) {}
  }
}

function buildProfileText() {
  const profile = getJobProfile();
  if (!profile.length) return '(no saved profile — ask the user for their resume summary)';
  const lines = profile.map(p => p.key + ': ' + p.value);
  return 'Job-seeker profile:\n' + lines.join('\n');
}

async function draftApplication(listing, extraNotes = '') {
  const profileText = buildProfileText();
  const listingText = JSON.stringify(listing, null, 2);
  const prompt = 'You are helping a job-seeker apply. Using their profile and the job posting,\n' +
    'write a concise, tailored cover-letter-style application email body (plain text, max ~250 words).\n' +
    'Personalize to the role and company. Do not invent facts not in the profile.\n\n' +
    'PROFILE:\n' + profileText + '\n\nPOSTING:\n' + listingText + '\n\n' +
    (extraNotes ? 'EXTRA NOTES: ' + extraNotes + '\n' : '') +
    'Return ONLY the email body text.';
  const coverLetter = (await complete([{ role: 'user', content: prompt }], { temperature: 0.4, max_tokens: 800 })).trim();
  return coverLetter;
}

/**
 * Submit/record an application. In mock mode (no Gmail credentials) we record it locally
 * and return the exact fields that *would* be submitted, so the approval modal is honest.
 * When real Gmail is configured, this can instead create a drafted email.
 */
async function submitApplication({ company, role, url, recipient_email, cover_letter, status = 'submitted (mock)' }) {
  fs.mkdirSync(APPLICATIONS_DIR, { recursive: true });
  const file = path.join(APPLICATIONS_DIR, (company || 'role') + '-' + Date.now() + '.txt');
  const body = 'Role: ' + (role || '') + '\nCompany: ' + (company || '') + '\nURL: ' + (url || '') +
    '\nTo: ' + (recipient_email || '(recruiter)') + '\n\n' + (cover_letter || '') + '\n';
  fs.writeFileSync(file, body, 'utf8');

  const id = addApplication({ company, role, url, status, cover_letter });
  return {
    application_id: id,
    file,
    submitted_fields: { company, role, recipient_email, cover_letter },
    mode: status,
  };
}

module.exports = { parseListing, draftApplication, submitApplication, buildProfileText };
