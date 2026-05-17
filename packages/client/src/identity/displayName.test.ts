// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateDisplayName,
  hasCustomisedDisplayName,
  hasPromptedDisplayName,
  loadDisplayName,
  markDisplayNameCustomised,
  markDisplayNamePrompted,
  MAX_DISPLAY_NAME_LENGTH,
  sanitiseDisplayName,
  saveDisplayName,
  STORAGE_KEYS,
} from './displayName';

describe('displayName storage', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('generateDisplayName produces `Player-XXXX` with 4 alnum chars', () => {
    for (let i = 0; i < 10; i++) {
      expect(generateDisplayName()).toMatch(/^Player-[A-Z1-9]{4}$/);
    }
  });

  test('loadDisplayName generates and persists on first read', () => {
    expect(localStorage.getItem(STORAGE_KEYS.name)).toBeNull();
    const first = loadDisplayName();
    expect(first).toMatch(/^Player-[A-Z1-9]{4}$/);
    expect(localStorage.getItem(STORAGE_KEYS.name)).toBe(first);
  });

  test('loadDisplayName is stable across reads', () => {
    const a = loadDisplayName();
    const b = loadDisplayName();
    const c = loadDisplayName();
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  test('saveDisplayName then loadDisplayName round-trips', () => {
    saveDisplayName('Alice');
    expect(loadDisplayName()).toBe('Alice');
  });

  test('saveDisplayName overwrites a previous auto-generated name', () => {
    const auto = loadDisplayName();
    saveDisplayName('Bob');
    expect(loadDisplayName()).toBe('Bob');
    expect(loadDisplayName()).not.toBe(auto);
  });

  test('saveDisplayName trims whitespace', () => {
    saveDisplayName('   Carol   ');
    expect(loadDisplayName()).toBe('Carol');
  });

  test('saveDisplayName falls back to auto-generated when empty', () => {
    saveDisplayName('');
    expect(loadDisplayName()).toMatch(/^Player-[A-Z1-9]{4}$/);
  });

  test('saveDisplayName falls back to auto-generated when whitespace-only', () => {
    saveDisplayName('   \t  ');
    expect(loadDisplayName()).toMatch(/^Player-[A-Z1-9]{4}$/);
  });

  test('sanitiseDisplayName clamps to MAX_DISPLAY_NAME_LENGTH', () => {
    const long = 'a'.repeat(100);
    const result = sanitiseDisplayName(long);
    expect(Array.from(result).length).toBe(MAX_DISPLAY_NAME_LENGTH);
  });

  test('sanitiseDisplayName preserves unicode emoji within the cap', () => {
    expect(sanitiseDisplayName('🎲 Roller')).toBe('🎲 Roller');
  });

  test('hasPromptedDisplayName is false until markDisplayNamePrompted', () => {
    expect(hasPromptedDisplayName()).toBe(false);
    markDisplayNamePrompted();
    expect(hasPromptedDisplayName()).toBe(true);
  });

  test('hasPromptedDisplayName is independent of name storage', () => {
    loadDisplayName();
    expect(hasPromptedDisplayName()).toBe(false);
    saveDisplayName('Dora');
    expect(hasPromptedDisplayName()).toBe(false);
  });

  test('hasCustomisedDisplayName is false until markDisplayNameCustomised', () => {
    expect(hasCustomisedDisplayName()).toBe(false);
    markDisplayNameCustomised();
    expect(hasCustomisedDisplayName()).toBe(true);
  });

  test('hasCustomisedDisplayName is independent of saveDisplayName', () => {
    saveDisplayName('Greta');
    expect(hasCustomisedDisplayName()).toBe(false);
    markDisplayNameCustomised();
    expect(hasCustomisedDisplayName()).toBe(true);
  });

  test('loadDisplayName swallows localStorage.getItem throw', () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = function () { throw new Error('boom'); };
    try {
      const name = loadDisplayName();
      expect(name).toMatch(/^Player-[A-Z1-9]{4}$/);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      Storage.prototype.getItem = orig;
    }
  });

  test('saveDisplayName swallows localStorage.setItem throw', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new Error('quota'); };
    try {
      expect(() => saveDisplayName('Eve')).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});
