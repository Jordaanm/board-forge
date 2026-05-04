import { describe, test, expect } from 'vitest';
import { resolveHotkey } from './toolbarHotkey';

const CATALOGUE = [
  { id: 'grab' },
  { id: 'ping' },
  { id: 'flick' },
];

describe('resolveHotkey', () => {
  test('numeric 1..N maps to slot order', () => {
    expect(resolveHotkey({ key: '1', repeat: false }, CATALOGUE, false)).toBe('grab');
    expect(resolveHotkey({ key: '2', repeat: false }, CATALOGUE, false)).toBe('ping');
    expect(resolveHotkey({ key: '3', repeat: false }, CATALOGUE, false)).toBe('flick');
  });

  test('out-of-range numeric key returns null', () => {
    expect(resolveHotkey({ key: '4', repeat: false }, CATALOGUE, false)).toBeNull();
    expect(resolveHotkey({ key: '0', repeat: false }, CATALOGUE, false)).toBeNull();
  });

  test('non-numeric key returns null', () => {
    expect(resolveHotkey({ key: 'a',     repeat: false }, CATALOGUE, false)).toBeNull();
    expect(resolveHotkey({ key: 'Enter', repeat: false }, CATALOGUE, false)).toBeNull();
  });

  test('repeat events are ignored', () => {
    expect(resolveHotkey({ key: '1', repeat: true }, CATALOGUE, false)).toBeNull();
  });

  test('text-input focus suppresses hotkey', () => {
    expect(resolveHotkey({ key: '1', repeat: false }, CATALOGUE, true)).toBeNull();
  });

  test('empty catalogue → null for any key', () => {
    expect(resolveHotkey({ key: '1', repeat: false }, [], false)).toBeNull();
  });
});
