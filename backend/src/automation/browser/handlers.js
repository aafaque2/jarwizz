const { newPage, screenshot } = require('./playwrightRunner');

const BROWSER_TIMEOUT = 15000;
const CLICK_TIMEOUT = 8000;
// Screenshots cost ~0.5s each (encode + disk write) twice per step.
// Disabled by default for speed; error screenshots are always kept.
const TAKE_SCREENSHOTS = process.env.SCREENSHOTS === '1';

function inferUrlFromPayload(payload) {
  return payload.url || payload.target || null;
}

/** Repair model-generated selectors that would hang Playwright (unclosed brackets etc.) */
function sanitizeSelector(sel) {
  if (!sel || typeof sel !== 'string') return '';
  let s = sel.trim();
  const open = (s.match(/\[/g) || []).length;
  const close = (s.match(/\]/g) || []).length;
  if (open !== close) s = s.substring(0, s.indexOf('['));
  return s.trim();
}

/**
 * Smart click: tries CSS selector first, then getByText, then getByRole('link').
 */
async function smartClick(page, selectorStr, timeout) {
  const sel = sanitizeSelector(selectorStr);
  const hasRealSelector = sel && !sel.includes('""') && !sel.includes("''");

  // 1. Try CSS selector (only if valid)
  if (hasRealSelector) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) { await el.click({ timeout: CLICK_TIMEOUT }); return; }
    } catch {}
  }

  // 2. Try getByText (exact)
  try {
    const el = page.getByText(selectorStr, { exact: true }).first();
    if (await el.count() > 0) { await el.click({ timeout: CLICK_TIMEOUT }); return; }
  } catch {}

  // 3. Try getByText (partial)
  try {
    const el = page.getByText(selectorStr, { exact: false }).first();
    if (await el.count() > 0) { await el.click({ timeout: CLICK_TIMEOUT }); return; }
  } catch {}

  // 4. Try getByRole('link')
  try {
    const el = page.getByRole('link', { name: selectorStr }).first();
    if (await el.count() > 0) { await el.click({ timeout: CLICK_TIMEOUT }); return; }
  } catch {}

  // 5. Fallback: XPath text match (pre-checked so a miss doesn't block the full timeout)
  try {
    const el = page.locator(`xpath=//*[contains(text(), '${selectorStr.replace(/'/g, "")}')]`).first();
    if (await el.count() > 0) { await el.click({ timeout: CLICK_TIMEOUT }); return; }
  } catch {}

  // 6. Last resort: if the selector looks like CSS the model guessed wrong,
  // try any visible link containing meaningful text (e.g. "More information")
  if (hasRealSelector) {
    // Extract human words from a CSS-ish selector string
    const words = selectorStr.replace(/[\[\]'"=a-zA-Z-]*href[^\]]*\]?/g, ' ')
      .replace(/[^a-zA-Z\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !['href', 'class', 'name', 'type', 'input', 'button', 'link'].includes(w.toLowerCase()));
    for (const word of words.slice(0, 3)) {
      try {
        const el = page.getByRole('link', { name: word }).first();
        if (await el.count() > 0) { await el.click({ timeout: CLICK_TIMEOUT }); return; }
      } catch {}
    }
    // Final fallback: first visible link with href that isn't nav/footer junk
    try {
      const el = page.locator('a[href]:visible').first();
      if (await el.count() > 0) { await el.click({ timeout: CLICK_TIMEOUT }); return; }
    } catch {}
  }

  throw new Error(`Could not find clickable element matching "${selectorStr}"`);
}

/**
 * Smart type: tries multiple strategies to find an input field and fill it.
 * Handles cases where the model guesses wrong CSS selectors (e.g. input[type='text'] on Google).
 */
async function smartType(page, selectorStr, text, timeout) {
  // Skip empty/broken selectors
  const sel = sanitizeSelector(selectorStr);
  const hasRealSelector = sel && !sel.includes('""') && !sel.includes("''");

  // 1. Try original CSS selector (only if it looks valid)
  if (hasRealSelector) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) { await el.fill(text, { timeout: CLICK_TIMEOUT }); return; }
    } catch {}
  }

  // 2. Try getByRole('textbox') — most generic
  try {
    const el = page.getByRole('textbox').first();
    if (await el.count() > 0) { await el.fill(text, { timeout: CLICK_TIMEOUT }); return; }
  } catch {}

  // 3. Try getByRole('searchbox') — for search inputs
  try {
    const el = page.getByRole('searchbox').first();
    if (await el.count() > 0) { await el.fill(text, { timeout: CLICK_TIMEOUT }); return; }
  } catch {}

  // 4. Try getByPlaceholder
  if (selectorStr) {
    try {
      const el = page.getByPlaceholder(selectorStr, { exact: false }).first();
      if (await el.count() > 0) { await el.fill(text, { timeout }); return; }
    } catch {}
  }

  // 5. Try common search input selectors (Google uses textarea, not input)
  const commonSelectors = [
    'textarea[name="q"]',       // Google (2025+ — textarea not input)
    'input[name="q"]',          // Google (legacy)
    'input[name="search"]',     // Generic search
    'textarea[name="search"]',  // Generic search
    'input[name="query"]',      // Generic
    'textarea[name="query"]',   // Generic
    'input[name="s"]',          // WordPress
    'input[type="search"]',     // HTML5 search input
    'textarea:visible',          // Any visible textarea
    'input[type="text"]',       // Generic text
    'input:visible',            // Any visible input
  ];
  for (const sel of commonSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) { await el.fill(text, { timeout }); return; }
    } catch {}
  }

  // 6. Try getByLabel if selector looks like a label
  if (selectorStr) {
    try {
      const el = page.getByLabel(selectorStr, { exact: false }).first();
      if (await el.count() > 0) { await el.fill(text, { timeout }); return; }
    } catch {}
  }

  throw new Error(`Could not find input field${selectorStr ? ` matching "${selectorStr}"` : ''}`);
}

/**
 * After typing in a search box, press Enter to submit.
 * Called by browser_type handler for search-like pages.
 */
async function pressEnter(page) {
  await page.keyboard.press('Enter');
}

async function executeBrowserAction(actionType, payload, sharedPage) {
  const page = sharedPage || await newPage();

  const shot = async (label) => (TAKE_SCREENSHOTS ? await screenshot(page, label).catch(() => null) : null);

  let screenshotBefore = null;
  let screenshotAfter = null;
  let output = null;

  try {
    switch (actionType) {
      case 'browser_open':
        screenshotBefore = await shot('before-open');
        await page.goto(payload.url || payload.target, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT });
        // Wait for JS to render interactive elements
        await page.waitForTimeout(700).catch(() => {});
        screenshotAfter = await shot('after-open');
        output = { url: page.url(), title: await page.title() };
        break;

      case 'browser_click': {
        // Navigate if URL provided and page isn't already there
        const url = inferUrlFromPayload(payload);
        if (url && !page.url().includes(new URL(url).hostname)) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT });
          await page.waitForTimeout(500).catch(() => {});
        }
        screenshotBefore = await shot('before-click');
        await smartClick(page, payload.selector || payload.target, BROWSER_TIMEOUT);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        screenshotAfter = await shot('after-click');
        output = { clicked: payload.selector || payload.target, url: page.url() };
        break;
      }

      case 'browser_type': {
        const url = inferUrlFromPayload(payload);
        if (url && !page.url().includes(new URL(url).hostname)) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT });
          // Brief settle so page JS renders the input (Google loads textarea async)
          await page.waitForTimeout(700).catch(() => {});
        }
        screenshotBefore = await shot('before-type');
        await smartType(page, payload.selector || payload.target, payload.text || '', BROWSER_TIMEOUT);

        // Auto-press Enter on search pages (Google, Bing, DuckDuckGo) to submit query
        const curUrl = page.url().toLowerCase();
        const isSearchPage = curUrl.includes('google.') || curUrl.includes('bing.com') || curUrl.includes('duckduckgo.');
        if (isSearchPage) {
          await page.keyboard.press('Enter');
          await page.waitForLoadState('domcontentloaded').catch(() => {});
        }

        screenshotAfter = await shot('after-type');
        output = { filled: payload.text, selector: payload.selector || payload.target || 'auto-detected' };
        break;
      }

      case 'browser_scroll': {
        const url = inferUrlFromPayload(payload);
        if (url && !page.url().includes(new URL(url).hostname)) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT });
        }
        screenshotBefore = await shot('before-scroll');
        await page.evaluate((direction) => {
          const px = direction === 'up' ? -400 : 400;
          window.scrollBy({ top: px, behavior: 'auto' });
        }, payload.direction || 'down');
        await page.waitForTimeout(300);
        screenshotAfter = await shot('after-scroll');
        output = { scrolled: payload.direction || 'down', scrollY: await page.evaluate(() => window.scrollY) };
        break;
      }

      case 'browser_read': {
        const url = inferUrlFromPayload(payload);
        if (url && !page.url().includes(new URL(url).hostname)) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT });
          await page.waitForTimeout(700).catch(() => {});
        }
        screenshotBefore = await shot('before-read');

        let text = '';
        // Try the model's selector first
        if (payload.selector) {
          try {
            text = await page.locator(payload.selector).first().innerText({ timeout: 5000 });
          } catch {}
        }
        // Fallback: try Google-specific selectors for search results
        if (!text) {
          const googleSelectors = [
            '#search',                    // Google search results container
            '#rso',                       // Google results
            '[data-sokoban-container]',   // Google results alt
            'main',                       // Generic main content
          ];
          for (const sel of googleSelectors) {
            try {
              const el = page.locator(sel).first();
              if (await el.count({ timeout: 2000 }) > 0) {
                text = await el.innerText({ timeout: 5000 });
                if (text.length > 50) break;
              }
            } catch {}
          }
        }
        // Ultimate fallback: read the whole page
        if (!text) {
          text = await page.evaluate(() => document.body.innerText);
        }
        // Truncate to avoid huge payloads to the LLM
        if (text.length > 4000) text = text.substring(0, 4000) + '\n...(truncated)';

        screenshotAfter = await shot('after-read');
        output = { text, url: page.url(), title: await page.title() };
        break;
      }

      default:
        throw new Error(`Unknown browser action: ${actionType}`);
    }
  } catch (err) {
    // Always capture an error screenshot for debugging
    await screenshot(page, 'error').catch(() => null);
    throw err;
  }

  return { page, screenshotBefore, screenshotAfter, output };
}

module.exports = { executeBrowserAction };
