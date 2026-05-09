import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('console', msg => {
  const t = msg.type();
  if (t === 'error' || t === 'warn') console.log(`[browser ${t}]`, msg.text());
});
await page.goto('http://localhost:5174/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.click('text=Create Room');
await page.waitForTimeout(2000);

// Open spawn picker — click the first occurrence of "Token" inside the picker.
await page.click('text=+ Spawn Object');
await page.waitForTimeout(600);
// The spawn modal renders divs, not buttons, by the look of it.
const tokenLocator = page.locator('div').filter({ hasText: /^Token$/ });
await tokenLocator.first().click();
await page.waitForTimeout(800);

// Take a screenshot after spawn
await page.screenshot({ path: 'shot-after-spawn.png' });
console.log('after spawn screenshot');

// Click on the token in scene-graph (find the row whose text is "<guid>Token")
const tokenRow = page.locator('div').filter({ hasText: /^[a-f0-9-]{36}Token$/ }).last();
await tokenRow.click();
await page.waitForTimeout(400);
await page.screenshot({ path: 'shot-token-selected.png' });

// Click Add Surface
await page.locator('button', { hasText: 'Add Surface' }).first().click();
await page.waitForTimeout(800);

// Expand parent + click surface child (sticker)
await page.evaluate(() => {
  // Find the chevron span inside the token row
  const rows = [...document.querySelectorAll('div')];
  for (const r of rows) {
    const t = (r.textContent ?? '').trim();
    if (/^[a-f0-9-]{36}\s*Token$/i.test(t)) {
      const ex = r.querySelector('span');
      if (ex) ex.click();
      return;
    }
  }
});
await page.waitForTimeout(300);
const surfaceRow = page.locator('div').filter({ hasText: /Sticker/ }).last();
await surfaceRow.click();
await page.waitForTimeout(400);
await page.screenshot({ path: 'shot-surface-selected.png' });

// Click "Add Image" to test image element (less ambiguous than Rich UI text)
await page.locator('button', { hasText: 'Add Image' }).first().click();
await page.waitForTimeout(2000);
await page.screenshot({ path: 'shot-image-added.png' });

// Now also open the asset picker for the image element
console.log('Done.');
await browser.close();
