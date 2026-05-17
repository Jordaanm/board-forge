// Per-browser display name persisted to localStorage. The first call to
// `loadDisplayName` generates a stable auto-name (e.g. `Player-A1B2`) and
// persists it, so callers can always assume a usable string. The lobby shows
// a one-time prompt the first time `hasPromptedDisplayName` is false.

const NAME_KEY       = 'vt:displayName';
const PROMPTED_KEY   = 'vt:displayName:prompted';
// Set when the user explicitly picks a name (typed it in
// DisplayNamePromptModal, edited it in ProfileModal, or implicitly accepted
// the Discord seed). Used by the Discord sign-in seed to avoid clobbering a
// name the user has already customised.
const CUSTOMISED_KEY = 'vt:displayName:customised';

const ALPHABET = 'ABCDEFGHIJKLMNPQRSTUVWXYZ123456789';

export const MAX_DISPLAY_NAME_LENGTH = 40;

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    console.warn('[displayName] localStorage.getItem threw', err);
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn('[displayName] localStorage.setItem threw', err);
  }
}

export function generateDisplayName(): string {
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `Player-${suffix}`;
}

// Trim, clamp to MAX_DISPLAY_NAME_LENGTH characters, fall back to a fresh
// auto-generated name for empty / whitespace-only input.
export function sanitiseDisplayName(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') return generateDisplayName();
  return Array.from(trimmed).slice(0, MAX_DISPLAY_NAME_LENGTH).join('');
}

// Returns the persisted display name, generating + persisting a stable
// auto-name on first read so subsequent reads return the same value.
export function loadDisplayName(): string {
  const existing = readRaw(NAME_KEY);
  if (existing !== null && existing !== '') return existing;
  const generated = generateDisplayName();
  writeRaw(NAME_KEY, generated);
  return generated;
}

export function saveDisplayName(name: string): void {
  writeRaw(NAME_KEY, sanitiseDisplayName(name));
}

export function hasPromptedDisplayName(): boolean {
  return readRaw(PROMPTED_KEY) === '1';
}

export function markDisplayNamePrompted(): void {
  writeRaw(PROMPTED_KEY, '1');
}

export function hasCustomisedDisplayName(): boolean {
  return readRaw(CUSTOMISED_KEY) === '1';
}

export function markDisplayNameCustomised(): void {
  writeRaw(CUSTOMISED_KEY, '1');
}

export const STORAGE_KEYS = {
  name:       NAME_KEY,
  prompted:   PROMPTED_KEY,
  customised: CUSTOMISED_KEY,
};
