import { describe, test, expect } from 'vitest';
import { RoomMetadata, ROOM_NAME_MAX_LENGTH } from './RoomMetadata';

describe('RoomMetadata — name', () => {
  test('default name uses host display name', () => {
    const m = new RoomMetadata('Alice');
    expect(m.getName()).toBe("Alice's room");
  });

  test('default falls back to "Room" when host name is empty', () => {
    const m = new RoomMetadata('');
    expect(m.getName()).toBe('Room');
  });

  test('default falls back to "Room" when host name is whitespace-only', () => {
    const m = new RoomMetadata('   ');
    expect(m.getName()).toBe('Room');
  });

  test('setName stores a sanitised value', () => {
    const m = new RoomMetadata('Alice');
    expect(m.setName('D&D night')).toBe('D&D night');
    expect(m.getName()).toBe('D&D night');
  });

  test('setName trims surrounding whitespace', () => {
    const m = new RoomMetadata('Alice');
    expect(m.setName('  Catan  ')).toBe('Catan');
  });

  test('setName clamps to ROOM_NAME_MAX_LENGTH characters', () => {
    const m = new RoomMetadata('Alice');
    const stored = m.setName('x'.repeat(80));
    expect(Array.from(stored).length).toBe(ROOM_NAME_MAX_LENGTH);
  });

  test('setName preserves multi-byte unicode + emoji within the cap', () => {
    const m = new RoomMetadata('Alice');
    expect(m.setName('🎲 Roller')).toBe('🎲 Roller');
  });

  test('empty name reverts to the host-derived default', () => {
    const m = new RoomMetadata('Alice');
    m.setName('Custom');
    expect(m.setName('')).toBe("Alice's room");
    expect(m.getName()).toBe("Alice's room");
  });

  test('whitespace-only name reverts to the host-derived default', () => {
    const m = new RoomMetadata('Bob');
    m.setName('Custom');
    expect(m.setName('   \t  ')).toBe("Bob's room");
  });

  test('getPublicInfo exposes only the name', () => {
    const m = new RoomMetadata('Alice');
    m.setName('Lobby');
    expect(m.getPublicInfo()).toEqual({ name: 'Lobby' });
  });
});
