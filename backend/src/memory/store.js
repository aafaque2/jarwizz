const Database = require('better-sqlite3');
const path = require('path');
const { randomUUID } = require('crypto');

const DB_PATH = path.join(__dirname, '..', '..', 'memory.db');
// Embeddings are opt-in and separate from the main LLM (llama.cpp + Qwen3-VL).
// Uses an embedding sidecar if configured; defaults to localhost:11434 for
// backwards compat with older Ollama-based setups, but main planning runs on LLAMACPP_URL.
const EMBED_URL = process.env.EMBED_URL || process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = 'nomic-embed-text';

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS task_history (
        task_id TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        summary TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS job_profile (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS applications (
        id TEXT PRIMARY KEY,
        company TEXT,
        role TEXT,
        url TEXT,
        status TEXT DEFAULT 'drafted',
        cover_letter TEXT,
        submitted_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id, created_at);
    `);
  }
  return db;
}

// ── Chats ──

function listChats() {
  const d = getDb();
  return d.prepare('SELECT * FROM chats ORDER BY updated_at DESC').all();
}

function createChat(title = 'New Chat') {
  const d = getDb();
  const id = randomUUID();
  d.prepare('INSERT INTO chats (id, title) VALUES (?, ?)').run(id, title);
  return d.prepare('SELECT * FROM chats WHERE id = ?').get(id);
}

function getChat(id) {
  const d = getDb();
  const chat = d.prepare('SELECT * FROM chats WHERE id = ?').get(id);
  if (!chat) return null;
  chat.messages = d.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC').all(id);
  return chat;
}

function renameChat(id, title) {
  const d = getDb();
  d.prepare('UPDATE chats SET title = ?, updated_at = datetime(\'now\') WHERE id = ?').run(title, id);
  return d.prepare('SELECT * FROM chats WHERE id = ?').get(id);
}

function deleteChat(id) {
  const d = getDb();
  d.prepare('DELETE FROM messages WHERE chat_id = ?').run(id);
  d.prepare('DELETE FROM chats WHERE id = ?').run(id);
}

function addMessage(chatId, role, content, metadata = null) {
  const d = getDb();
  const id = randomUUID();
  d.prepare('INSERT INTO messages (id, chat_id, role, content, metadata) VALUES (?, ?, ?, ?, ?)').run(id, chatId, role, content, metadata ? JSON.stringify(metadata) : null);
  d.prepare('UPDATE chats SET updated_at = datetime(\'now\') WHERE id = ?').run(chatId);
  return d.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

function getRecentMessages(chatId, limit = 20) {
  const d = getDb();
  return d.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?').all(chatId, limit).reverse();
}

// ── Embeddings (opt-in sidecar, not the main vision LLM) ──

async function getEmbedding(text) {
  const res = await fetch(`${EMBED_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`Embedding API error: ${res.status}`);
  const data = await res.json();
  return data.embeddings?.[0] || data.embedding || [];
}

// ── Preferences ──

function setPreference(key, value) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))').run(key, String(value));
}

function getPreference(key) {
  const d = getDb();
  const row = d.prepare('SELECT value FROM preferences WHERE key = ?').get(key);
  return row ? row.value : null;
}

function getAllPreferences() {
  const d = getDb();
  return d.prepare('SELECT * FROM preferences').all();
}

function deletePreference(key) {
  const d = getDb();
  d.prepare('DELETE FROM preferences WHERE key = ?').run(key);
}

// ── Task History ──

async function storeTaskHistory(command, results) {
  const d = getDb();
  const taskId = randomUUID();
  const summary = results
    .map(r => `[${r.status}] ${r.description || r.action_type}`)
    .join('; ');

  // Store in SQLite
  d.prepare('INSERT INTO task_history (task_id, command, summary) VALUES (?, ?, ?)').run(taskId, command, summary);

  // Store embedding for semantic search.
  // Opt-in: embedding after every task reloads the embed model and evicts the
  // main LLM — a major source of slowness. Set JARWIZZ_SEMANTIC_MEMORY=1 to enable.
  if (process.env.JARWIZZ_SEMANTIC_MEMORY === '1') {
    try {
      const embedding = await getEmbedding(command + ' ' + summary);
      const embeddingPath = path.join(__dirname, '..', '..', 'memory-embeddings.jsonl');
      const fs = require('fs');
      fs.appendFileSync(embeddingPath, JSON.stringify({ task_id: taskId, text: command, summary, embedding }) + '\n');
    } catch (err) {
      console.warn('[MEMORY] Embedding store failed:', err.message);
    }
  }

  return taskId;
}

// ── Semantic Recall ──

function cosineSimilarity(a, b) {
  if (!a.length || !b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function recallRelevant(query, topK = 3) {
  const fs = require('fs');
  const embeddingPath = path.join(__dirname, '..', '..', 'memory-embeddings.jsonl');

  // Also check preferences for context
  const prefs = getAllPreferences();
  const prefContext = prefs.map(p => `${p.key}: ${p.value}`).join('\n');

  if (!fs.existsSync(embeddingPath)) {
    return { memories: [], preferences: prefContext };
  }

  try {
    const queryEmbedding = await getEmbedding(query);
    const lines = fs.readFileSync(embeddingPath, 'utf-8').split('\n').filter(Boolean);
    const entries = lines.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    const scored = entries
      .map(e => ({ ...e, score: cosineSimilarity(queryEmbedding, e.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return {
      memories: scored.map(s => ({ task_id: s.task_id, text: s.text, summary: s.summary, score: s.score })),
      preferences: prefContext,
    };
  } catch (err) {
    console.warn('[MEMORY] Recall failed:', err.message);
    return { memories: [], preferences: prefContext };
  }
}

function getRecentTasks(limit = 10) {
  const d = getDb();
  return d.prepare('SELECT * FROM task_history ORDER BY timestamp DESC LIMIT ?').all(limit);
}

// ── Job-seeker profile (Phase 10) ──

function getJobProfile() {
  const d = getDb();
  return d.prepare('SELECT * FROM job_profile').all();
}

function getJobProfileField(key) {
  const d = getDb();
  const row = d.prepare('SELECT value FROM job_profile WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setJobProfile(key, value) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO job_profile (key, value) VALUES (?, ?)').run(key, value);
}

function deleteJobProfile(key) {
  const d = getDb();
  d.prepare('DELETE FROM job_profile WHERE key = ?').run(key);
}

// ── Applications tracking (Phase 10) ──

function addApplication(app) {
  const d = getDb();
  const id = randomUUID();
  d.prepare(
    'INSERT INTO applications (id, company, role, url, status, cover_letter) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, app.company || null, app.role || null, app.url || null, app.status || 'drafted', app.cover_letter || null);
  return id;
}

function listApplications() {
  const d = getDb();
  return d.prepare('SELECT * FROM applications ORDER BY submitted_at DESC').all();
}

function closeDb() {
  if (db) { db.close(); db = null; }
}

module.exports = {
  getDb, setPreference, getPreference, getAllPreferences, deletePreference,
  storeTaskHistory, recallRelevant, getRecentTasks, closeDb,
  listChats, createChat, getChat, renameChat, deleteChat, addMessage, getRecentMessages,
  getJobProfile, getJobProfileField, setJobProfile, deleteJobProfile,
  addApplication, listApplications,
};
