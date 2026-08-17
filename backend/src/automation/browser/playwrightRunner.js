const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, '..', '..', '..', 'screenshots');

let browser = null;
let context = null;

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

async function getContext() {
  if (!context) {
    const b = await getBrowser();
    context = await b.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
  }
  return context;
}

async function newPage() {
  const ctx = await getContext();
  return ctx.newPage();
}

async function closeBrowser() {
  if (context) { await context.close().catch(() => {}); context = null; }
  if (browser) { await browser.close().catch(() => {}); browser = null; }
}

async function screenshot(page, label) {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const filename = `${label}-${Date.now()}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  return filepath;
}

module.exports = { getBrowser, getContext, newPage, closeBrowser, screenshot };
