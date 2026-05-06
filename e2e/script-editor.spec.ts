import { test, expect, type Page, type Locator } from '@playwright/test';

// Reads the Monaco model's value by calling into the editor instance from
// the page realm. Works regardless of editor focus, scroll, or which
// internal DOM nodes Monaco has rendered for the visible region.
async function getMonacoValue(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as {
      monaco?: { editor: { getEditors: () => Array<{ getValue(): string }> } };
    };
    const editor = w.monaco?.editor.getEditors()[0];
    return editor?.getValue() ?? '';
  });
}

// Replaces the Monaco model's value programmatically. Avoids the brittle
// keyboard-typing path for setting a multi-line script.
async function setMonacoValue(page: Page, value: string): Promise<void> {
  await page.evaluate((v) => {
    const w = window as unknown as {
      monaco?: { editor: { getEditors: () => Array<{ setValue(v: string): void }> } };
    };
    w.monaco?.editor.getEditors()[0]?.setValue(v);
  }, value);
}

// Slice 13: explicit two-stage Monaco mount assertion. First the
// editor's outer container must appear; then the view-lines element
// (which only renders after the model is attached) must be visible.
// Splitting these two assertions makes the failure message clear:
// "monaco-editor not visible" vs "view-lines not visible" point to
// different root causes (chunk load failure vs model wiring).
async function waitForEditorReady(dialog: Locator): Promise<void> {
  await expect(dialog.locator('.monaco-editor')).toBeVisible({ timeout: 15_000 });
  await expect(dialog.locator('.monaco-editor .view-lines')).toBeVisible({ timeout: 5_000 });
}

// Smoke test — covers the full PR1+Monaco surface end-to-end:
//   - host opens room → "Edit Script" button appears on the host action bar
//   - clicking it opens the modal with Monaco mounted
//   - editor seeds with a commented Game example on first open
//   - replacing the seed + clicking Save Script commits to the runtime
//   - closing (Esc) closes cleanly when source matches saved
//   - reopening shows the persisted source unchanged
//   - no console errors fire during the flow
test('script editor flow: open, type, save, close, reopen with persisted source', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const roomId = `pw-${Date.now()}`;
  await page.goto(`/?room=${roomId}&host`);

  const editButton = page.getByRole('button', { name: 'Edit Script' });
  await expect(editButton).toBeVisible();

  await editButton.click();

  const dialog = page.getByRole('dialog', { name: 'Script Editor' });
  await expect(dialog).toBeVisible();

  await waitForEditorReady(dialog);

  // Empty-room first open seeds the editor with a commented example.
  const seedValue = await getMonacoValue(page);
  expect(seedValue).toContain('export default class extends Game');

  // Replace the seed with a real script and save.
  const liveScript = `export default class extends Game {\n  onScriptLoaded() { console.log("playwright-saved"); }\n}\n`;
  await setMonacoValue(page, liveScript);
  await dialog.getByRole('button', { name: 'Save Script' }).click();

  // Save Script commits source to ScriptHost — close should now be clean
  // (no dirty confirm). Press Esc; modal disappears immediately.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Re-opening shows the persisted source, not the seed.
  await editButton.click();
  await expect(dialog).toBeVisible();
  await waitForEditorReady(dialog);
  expect(await getMonacoValue(page)).toBe(liveScript);

  // Close cleanly (source matches saved, no confirm).
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Filter out Monaco's benign async-cancellation pseudo-error.
  const real = consoleErrors.filter((m) => !/Canceled(\b|:)/.test(m));
  expect(real, `console errors: ${real.join(' | ')}`).toEqual([]);
});
