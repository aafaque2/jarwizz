const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SECRETS_DIR = path.join(__dirname, '..', '..', '..', 'secrets');
const CREDENTIALS_PATH = path.join(SECRETS_DIR, 'credentials.json');
const TOKEN_PATH = path.join(SECRETS_DIR, 'token.json');

let oauth2Client = null;
let gmail = null;
let mockMode = false;

/**
 * Initialize Gmail client. Falls back to mock mode if no credentials.
 */
async function initGmail() {
  if (fs.existsSync(CREDENTIALS_PATH)) {
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    const { client_id, client_secret } = creds.installed || creds.web || {};
    oauth2Client = new google.auth.OAuth2(client_id, client_secret, 'urn:ietf:wg:oauth:2.0:oob');

    if (fs.existsSync(TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
      oauth2Client.setCredentials(token);
      gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      mockMode = false;
      console.log('[GMAIL] Connected to real Gmail API');
    } else {
      // Token doesn't exist yet — need auth flow
      mockMode = true;
      console.log('[GMAIL] No token found — running in MOCK mode. Run auth flow to connect.');
    }
  } else {
    mockMode = true;
    console.log('[GMAIL] No credentials.json found — running in MOCK mode');
  }
}

/**
 * Get an auth URL for the user to visit (for first-time setup).
 */
function getAuthUrl() {
  if (!oauth2Client) throw new Error('Gmail not initialized');
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'],
  });
}

/**
 * Exchange an auth code for tokens (first-time setup).
 */
async function completeAuth(authCode) {
  if (!oauth2Client) throw new Error('Gmail not initialized');
  const { tokens } = await oauth2Client.getToken(authCode);
  oauth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  mockMode = false;
  console.log('[GMAIL] Authentication complete — connected to real Gmail');
}

// ── Mock data for testing ──

const MOCK_EMAILS = [
  { id: 'mock-1', from: 'alice@example.com', subject: 'Project Update', snippet: 'Hey, the project is on track. Meeting at 3pm.' },
  { id: 'mock-2', from: 'bob@work.com', subject: 'Lunch tomorrow?', snippet: 'Want to grab lunch at the usual place tomorrow?' },
  { id: 'mock-3', from: 'hr@company.com', subject: 'Holiday Schedule', snippet: 'Please review the updated holiday schedule for 2026.' },
];

const mockDrafts = [];

// ── Public API ──

async function readRecentEmails(count = 3) {
  if (mockMode) {
    return MOCK_EMAILS.slice(0, count).map(e => ({
      id: e.id, from: e.from, subject: e.subject, snippet: e.snippet,
    }));
  }

  const res = await gmail.users.messages.list({ userId: 'me', maxResults: count });
  const messages = res.data.messages || [];
  const emails = [];
  for (const msg of messages) {
    const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'metadata', metadataHeaders: ['From', 'Subject'] });
    const headers = detail.data.payload?.headers || [];
    emails.push({
      id: msg.id,
      from: headers.find(h => h.name === 'From')?.value || '',
      subject: headers.find(h => h.name === 'Subject')?.value || '',
      snippet: detail.data.snippet || '',
    });
  }
  return emails;
}

async function draftEmail(to, subject, body) {
  if (mockMode) {
    const draftId = `mock-draft-${Date.now()}`;
    mockDrafts.push({ id: draftId, to, subject, body });
    return { id: draftId, to, subject, body, mode: 'mock' };
  }

  const email = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\r\n');
  const encoded = Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw: encoded } },
  });
  return { id: res.data.id, to, subject, body, mode: 'real' };
}

async function sendEmail(draftId) {
  if (mockMode) {
    // If no draft_id, use the most recent draft
    if (!draftId && mockDrafts.length > 0) {
      draftId = mockDrafts[mockDrafts.length - 1].id;
    }
    const idx = mockDrafts.findIndex(d => d.id === draftId);
    if (idx === -1) throw new Error(`Draft ${draftId} not found`);
    const draft = mockDrafts.splice(idx, 1)[0];
    return { id: draftId, sent: true, mode: 'mock', to: draft.to, subject: draft.subject };
  }

  await gmail.users.drafts.send({ userId: 'me', requestBody: { id: draftId } });
  return { id: draftId, sent: true, mode: 'real' };
}

function isMockMode() { return mockMode; }

module.exports = { initGmail, getAuthUrl, completeAuth, readRecentEmails, draftEmail, sendEmail, isMockMode };
