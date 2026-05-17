import { describe, test, expect } from 'vitest';
import { mapProfile } from './profileMapper';

describe('Discord profile mapper', () => {
  test('full profile maps global_name as displayNameSeed and builds avatar URL', () => {
    const raw = {
      id:            '80351110224678912',
      username:      'nelly',
      global_name:   'Nelly the Cat',
      discriminator: '0',
      avatar:        '8342729096ea3675442027381ff50dfe',
    };
    expect(mapProfile(raw)).toEqual({
      discordId:       '80351110224678912',
      displayNameSeed: 'Nelly the Cat',
      avatarUrl:
        'https://cdn.discordapp.com/avatars/80351110224678912/8342729096ea3675442027381ff50dfe.webp?size=128',
    });
  });

  test('global_name === null falls back to username', () => {
    const raw = {
      id:          '1',
      username:    'oldskool',
      global_name: null,
      avatar:      'h',
    };
    expect(mapProfile(raw)?.displayNameSeed).toBe('oldskool');
  });

  test('global_name === "" (empty string) falls back to username', () => {
    const raw = { id: '1', username: 'fallback', global_name: '', avatar: 'h' };
    expect(mapProfile(raw)?.displayNameSeed).toBe('fallback');
  });

  test('avatar === null maps to avatarUrl: null', () => {
    const raw = { id: '1', username: 'u', global_name: 'g', avatar: null };
    expect(mapProfile(raw)?.avatarUrl).toBeNull();
  });

  test('avatar === "" maps to avatarUrl: null', () => {
    const raw = { id: '1', username: 'u', global_name: 'g', avatar: '' };
    expect(mapProfile(raw)?.avatarUrl).toBeNull();
  });

  test('animated avatar hash (`a_…`) renders as .webp (Discord animates webp)', () => {
    const raw = {
      id: '42', username: 'nitro', global_name: 'Nitro', avatar: 'a_abcdef1234',
    };
    const profile = mapProfile(raw);
    expect(profile?.avatarUrl).toBe(
      'https://cdn.discordapp.com/avatars/42/a_abcdef1234.webp?size=128',
    );
  });

  test('returns null on non-object input', () => {
    expect(mapProfile(null)).toBeNull();
    expect(mapProfile(undefined)).toBeNull();
    expect(mapProfile('string')).toBeNull();
    expect(mapProfile(42)).toBeNull();
  });

  test('returns null when id is missing or empty', () => {
    expect(mapProfile({ username: 'u' })).toBeNull();
    expect(mapProfile({ id: '', username: 'u' })).toBeNull();
    expect(mapProfile({ id: 42, username: 'u' })).toBeNull();
  });

  test('returns null when username is missing or empty', () => {
    expect(mapProfile({ id: '1' })).toBeNull();
    expect(mapProfile({ id: '1', username: '' })).toBeNull();
    expect(mapProfile({ id: '1', username: 42 })).toBeNull();
  });
});
