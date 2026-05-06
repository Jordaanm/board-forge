import { test, expect } from '@playwright/test';

// Slice 6 smoke test — covers the full PR1 surface end-to-end:
//   - host opens room → "Edit Script" button appears on the host action bar
//   - clicking it opens the modal
//   - typing into the textarea + clicking Save Script commits to the runtime
//   - closing (X) closes cleanly when source matches saved
//   - reopening shows the persisted source unchanged
//   - no console errors fire during the flow
test('script editor flow: open, type, save, close, reopen with persisted source', async ({ page }) => {
  // Fail the test if anything writes to console.error during the flow. The
  // signaling-server connection chatter goes to console.log; real errors
  // (script-host failures, React warnings, network failures we care about)
  // hit console.error.
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const roomId = `pw-${Date.now()}`;
  await page.goto(`/?room=${roomId}&host`);

  // The host action bar is anchored at top-center; the Edit Script button
  // sits among the host modal triggers.
  const editButton = page.getByRole('button', { name: 'Edit Script' });
  await expect(editButton).toBeVisible();

  await editButton.click();

  // Modal title is the canonical anchor for "modal is open."
  const dialog = page.getByRole('dialog', { name: 'Script Editor' });
  await expect(dialog).toBeVisible();

  // Empty-room first open seeds the textarea with a commented example.
  const textarea = dialog.locator('textarea');
  await expect(textarea).toBeVisible();
  const seedValue = await textarea.inputValue();
  expect(seedValue).toContain('export default class extends Game');

  // Replace the seed with a real script and save.
  const liveScript = `export default class extends Game {\n  onScriptLoaded() { console.log("playwright-saved"); }\n}\n`;
  await textarea.fill(liveScript);
  await dialog.getByRole('button', { name: 'Save Script' }).click();

  // Save Script commits source to ScriptHost — close should now be clean
  // (no dirty confirm). Press Esc; modal disappears immediately.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Re-opening shows the persisted source, not the seed.
  await editButton.click();
  await expect(dialog).toBeVisible();
  await expect(textarea).toHaveValue(liveScript);

  // Close cleanly (source matches saved, no confirm).
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  expect(consoleErrors).toEqual([]);
});
