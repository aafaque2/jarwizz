const path = require('path');
const fs = require('fs');

const WHITELIST_FILE = path.join(__dirname, '..', '..', '..', 'whitelist.json');

const DEFAULT_WHITELIST = [
  'example.com',
  'github.com',
  'wikipedia.org',
  'stackoverflow.com',
  'google.com',
  'news.ycombinator.com',
];

function loadWhitelist() {
  if (fs.existsSync(WHITELIST_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(WHITELIST_FILE, 'utf-8'));
    } catch {
      return DEFAULT_WHITELIST;
    }
  }
  return DEFAULT_WHITELIST;
}

function saveWhitelist(list) {
  fs.writeFileSync(WHITELIST_FILE, JSON.stringify(list, null, 2));
}

function extractDomain(urlOrDomain) {
  try {
    if (urlOrDomain.startsWith('http')) {
      return new URL(urlOrDomain).hostname;
    }
  } catch {}
  return urlOrDomain.replace(/^(www\.)?/, '');
}

function isWhitelisted(urlOrDomain) {
  const domain = extractDomain(urlOrDomain);
  const list = loadWhitelist();
  return list.some(d => domain === d || domain.endsWith('.' + d));
}

function addToWhitelist(urlOrDomain) {
  const domain = extractDomain(urlOrDomain);
  const list = loadWhitelist();
  if (!list.includes(domain)) {
    list.push(domain);
    saveWhitelist(list);
  }
}

/**
 * If the domain is NOT whitelisted, force tier to 'irreversible' (triggers approval gate).
 * Returns the (possibly modified) step.
 */
function enforceDomainWhitelist(step) {
  const urlOrDomain = step.payload?.url || step.payload?.target || '';
  if (!urlOrDomain) return step;

  if (!isWhitelisted(urlOrDomain)) {
    return { ...step, tier: 'irreversible', whitelist_override: true };
  }
  return step;
}

module.exports = { isWhitelisted, addToWhitelist, enforceDomainWhitelist, loadWhitelist, DEFAULT_WHITELIST };
