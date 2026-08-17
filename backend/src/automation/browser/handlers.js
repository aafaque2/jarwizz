const { newPage, screenshot } = require('./playwrightRunner');

const BROWSER_TIMEOUT = 15000;

function inferUrlFromPayload(payload) {
  return payload.url || payload.target || null;
}

/**
 * Smart click: tries CSS selector first, then getByText, then getByRole('link').
 */
async function smartClick(page, selectorStr, timeout) {
  // 1. Try CSS selector
  try {
    const el = page.locator(selectorStr).first();
    if (await el.count() > 0) { await el.click({ timeout }); return; }
  } catch {}

  // 2. Try getByText (exact)
  try {
    const el = page.getByText(selectorStr, { exact: true }).first();
    if (await el.count() > 0) { await el.click({ timeout }); return; }
  } catch {}

  // 3. Try getByText (partial)
  try {
    const el = page.getByText(selectorStr, { exact: false }).first();
    if (await el.count() > 0) { await el.click({ timeout }); return; }
  } catch {}

  // 4. Try getByRole('link')
  try {
    const el = page.getByRole('link', { name: selectorStr }).first();
    if (await el.count() > 0) { await el.click({ timeout }); return; }
  } catch {}

  // 5. Fallback: XPath text match
  try {
    await page.locator(`xpath=//*[contains(text(), '${selectorStr.replace(/'/g, "")}')]`).first().click({ timeout });
    return;
  } catch {}

  throw new Error(`Could not find clickable element matching "${selectorStr}"`);
}

async function executeBrowserAction(actionType, payload, sharedPage) {
  const page = sharedPage || await newPage();

  let screenshotBefore = null;
  let screenshotAfter = null;
  let output = null;

  try {
    switch (actionType) {
      case 'browser_open':
        screenshotBefore = await screenshot(page, 'before-open').catch(() => null);
        await page.goto(payload.url || payload.target, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT });
        screenshotAfter = await screenshot(page, 'after-open').catch(() => null);
        output = { url: page.url(), title: await page.title() };
        break;

      case 'browser_click': {
        // Navigate if URL provided and page isn't already there
        const url = inferUrlFromPayload(payload);
        if (url && !page.url().includes(new URL(url).hostname)) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT });
        }
        screenshotBefore = await screenshot(page, 'before-click').catch(() => null);
        await smartClick(page, payload.selector || payload.target, BROWSER_TIMEOUT);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        screenshotAfter = await screenshot(page, 'after-click').catch(() => null);
        output = { clicked: payload.selector || payload.target, url: page.url() };
        break;
      }

      case 'browser_type': {
        const url = inferUrlFromPayload(payload);
        if (url && !page.url().includes(new URL(url).hostname)) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT });
        }
        screenshotBefore = await screenshot(page, 'before-type').catch(() => null);
        const selectorStr = payload.selector || payload.target;
        // Try multiple strategies to find the input
        let locator = null;
        const candidates = [];
        if (selectorStr) {
          candidates.push(
            page.locator(selectorStr).first(),
            page.getByPlaceholder(selectorStr).first(),
          );
        }
        candidates.push(page.getByRole('textbox').first());
        for (const strategy of candidates) {
          try { if (await strategy.count() > 0) { locator = strategy; break; } } catch {}
        }
        if (!locator) throw new Error(`Could not find input field${selectorStr ? ` matching "${selectorStr}"` : ''}`);
        await locator.fill(payload.text || '', { timeout: BROWSER_TIMEOUT });
        screenshotAfter = await screenshot(page, 'after-type').catch(() => null);
        output = { filled: payload.text, selector: selectorStr || 'first-textbox' };
        break;
      }

      case 'browser_scroll': {
        const url = inferUrlFromPayload(payload);
        if (url && !page.url().includes(new URL(url).hostname)) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT });
        }
        screenshotBefore = await screenshot(page, 'before-scroll').catch(() => null);
        await page.evaluate((direction) => {
          const px = direction === 'up' ? -400 : 400;
          window.scrollBy({ top: px, behavior: 'smooth' });
        }, payload.direction || 'down');
        await page.waitForTimeout(500);
        screenshotAfter = await screenshot(page, 'after-scroll').catch(() => null);
        output = { scrolled: payload.direction || 'down', scrollY: await page.evaluate(() => window.scrollY) };
        break;
      }

      case 'browser_read': {
        const url = inferUrlFromPayload(payload);
        if (url && !page.url().includes(new URL(url).hostname)) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT });
        }
        screenshotBefore = await screenshot(page, 'before-read').catch(() => null);
        if (payload.selector) {
          output = await page.locator(payload.selector).first().innerText({ timeout: BROWSER_TIMEOUT });
        } else {
          output = await page.evaluate(() => document.body.innerText);
        }
        screenshotAfter = await screenshot(page, 'after-read').catch(() => null);
        output = { text: output, url: page.url(), title: await page.title() };
        break;
      }

      default:
        throw new Error(`Unknown browser action: ${actionType}`);
    }
  } catch (err) {
    screenshotAfter = await screenshot(page, 'error').catch(() => null);
    throw err;
  }

  return { page, screenshotBefore, screenshotAfter, output };
}

module.exports = { executeBrowserAction };
