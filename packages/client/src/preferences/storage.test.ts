// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { load, save, STORAGE_KEY } from './storage';
import { DEFAULT_PREFERENCES, type Preferences } from './types';

describe('preferences storage', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('load() returns defaults when key is missing', () => {
    expect(load()).toEqual(DEFAULT_PREFERENCES);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('load() returns defaults + warns on corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json{{{');
    expect(load()).toEqual(DEFAULT_PREFERENCES);
    expect(warnSpy).toHaveBeenCalled();
  });

  test('load() uses field-level default for one bad field, preserves the other', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1, darkMode: 'purple', rotateAmount: 90,
    }));
    const prefs = load();
    expect(prefs.darkMode).toBe(DEFAULT_PREFERENCES.darkMode);
    expect(prefs.rotateAmount).toBe(90);
  });

  test('load() field-level default for bad rotateAmount, preserves darkMode', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1, darkMode: 'dark', rotateAmount: -7,
    }));
    const prefs = load();
    expect(prefs.darkMode).toBe('dark');
    expect(prefs.rotateAmount).toBe(DEFAULT_PREFERENCES.rotateAmount);
  });

  test('load() returns defaults + warns on future version', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 2, darkMode: 'dark', rotateAmount: 90,
    }));
    expect(load()).toEqual(DEFAULT_PREFERENCES);
    expect(warnSpy).toHaveBeenCalled();
  });

  test('save() then load() round-trips a valid blob', () => {
    const prefs: Preferences = { version: 1, darkMode: 'light', rotateAmount: 30 };
    save(prefs);
    expect(load()).toEqual(prefs);
  });

  test('load() swallows localStorage.getItem throw', () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = function () { throw new Error('boom'); };
    try {
      expect(load()).toEqual(DEFAULT_PREFERENCES);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      Storage.prototype.getItem = orig;
    }
  });

  test('save() swallows localStorage.setItem throw', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new Error('quota'); };
    try {
      expect(() => save({ version: 1, darkMode: 'dark', rotateAmount: 15 })).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});
