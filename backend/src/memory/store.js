const Database = require('better-sqlite3');
const path = require('path');
const { randomUUID } = require('crypto');

const DB_PATH = path.join(__dirname, '..', '..', 'memory.db');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
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
    `);
  }
  return db;
}

// ── Embeddings via Ollama ──

async function getEmbedding(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
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

  // Store embedding for semantic search
  try {
    const embedding = await getEmbedding(command + ' ' + summary);
    const embeddingPath = path.join(__dirname, '..', '..', 'memory-embeddings.jsonl');
    const fs = require('fs');
    fs.appendFileSync(embeddingPath, JSON.stringify({ task_id: taskId, text: command, summary, embedding }) + '\n');
  } catch (err) {
    console.warn('[MEMORY] Embedding store failed:', err.message);
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

function closeDb() {
  if (db) { db.close(); db = null; }
}

module.exports = {
  getDb, setPreference, getPreference, getAllPreferences, deletePreference,
  storeTaskHistory, recallRelevant, getRecentTasks, closeDb,
};
