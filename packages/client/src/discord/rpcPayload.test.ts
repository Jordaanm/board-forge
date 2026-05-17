import { describe, test, expect } from 'vitest';
import { buildActivity } from './rpcPayload';

describe('RPC activity payload builder', () => {
  test('standard input produces the golden payload', () => {
    expect(buildActivity({
      roomName:    'Settlers of Catan',
      playerCount: 3,
      capacity:    4,
      joinedAtMs:  1_700_000_000_000,
      logoKey:     'board_together_logo',
    })).toEqual({
      details:         'In Room: Settlers of Catan',
      state:           '3/4 players',
      large_image:     'board_together_logo',
      start_timestamp: 1_700_000_000_000,
    });
  });

  test('player count of 1 yields "1/4 players" (plural, not "1 player")', () => {
    expect(buildActivity({
      roomName: 'Solo', playerCount: 1, capacity: 4, joinedAtMs: 0, logoKey: 'k',
    }).state).toBe('1/4 players');
  });

  test('player count of 0 yields "0/4 players"', () => {
    expect(buildActivity({
      roomName: 'Empty', playerCount: 0, capacity: 4, joinedAtMs: 0, logoKey: 'k',
    }).state).toBe('0/4 players');
  });

  test('long roomName trimmed to 128 chars', () => {
    const longName = 'A'.repeat(200);
    const payload  = buildActivity({
      roomName: longName, playerCount: 1, capacity: 4, joinedAtMs: 0, logoKey: 'k',
    });
    // Trimmed name length is 128; full details is "In Room: " + trimmed.
    expect(payload.details).toBe(`In Room: ${'A'.repeat(128)}`);
  });

  test('roomName <= 128 chars is not modified', () => {
    const exactly128 = 'B'.repeat(128);
    expect(buildActivity({
      roomName: exactly128, playerCount: 2, capacity: 4, joinedAtMs: 0, logoKey: 'k',
    }).details).toBe(`In Room: ${exactly128}`);
  });

  test('roomName trimming counts grapheme codepoints, not UTF-16 code units', () => {
    // 200 emoji, each a single codepoint. Slice should yield 128 emoji.
    const emojiName = '🎲'.repeat(200);
    const payload   = buildActivity({
      roomName: emojiName, playerCount: 1, capacity: 4, joinedAtMs: 0, logoKey: 'k',
    });
    const tail = payload.details.slice('In Room: '.length);
    expect(Array.from(tail).length).toBe(128);
  });

  test('start_timestamp passes through unchanged', () => {
    expect(buildActivity({
      roomName: 'X', playerCount: 1, capacity: 2, joinedAtMs: 42, logoKey: 'k',
    }).start_timestamp).toBe(42);
  });

  test('large_image passes the logoKey through', () => {
    expect(buildActivity({
      roomName: 'X', playerCount: 1, capacity: 2, joinedAtMs: 0, logoKey: 'my_logo',
    }).large_image).toBe('my_logo');
  });
});
