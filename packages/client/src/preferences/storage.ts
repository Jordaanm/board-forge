import {
  DARK_MODE_VALUES,
  DEFAULT_PREFERENCES,
  ROTATE_AMOUNT_VALUES,
  type DarkMode,
  type Preferences,
  type RotateAmount,
} from './types';

export const STORAGE_KEY = 'vt:prefs';

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.warn('[prefs] localStorage.getItem threw', err);
    return null;
  }
}

function isDarkMode(v: unknown): v is DarkMode {
  return typeof v === 'string' && (DARK_MODE_VALUES as readonly string[]).includes(v);
}

function isRotateAmount(v: unknown): v is RotateAmount {
  return typeof v === 'number' && (ROTATE_AMOUNT_VALUES as readonly number[]).includes(v);
}

export function load(): Preferences {
  const raw = readRaw();
  if (raw === null) return { ...DEFAULT_PREFERENCES };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('[prefs] corrupt JSON in localStorage; using defaults');
    return { ...DEFAULT_PREFERENCES };
  }

  if (parsed === null || typeof parsed !== 'object') {
    console.warn('[prefs] stored value is not an object; using defaults');
    return { ...DEFAULT_PREFERENCES };
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    console.warn('[prefs] unknown version; using defaults', obj.version);
    return { ...DEFAULT_PREFERENCES };
  }

  return {
    version:      1,
    darkMode:     isDarkMode(obj.darkMode)         ? obj.darkMode     : DEFAULT_PREFERENCES.darkMode,
    rotateAmount: isRotateAmount(obj.rotateAmount) ? obj.rotateAmount : DEFAULT_PREFERENCES.rotateAmount,
  };
}

export function save(prefs: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.warn('[prefs] localStorage.setItem threw', err);
  }
}
