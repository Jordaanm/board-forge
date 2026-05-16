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

  test('getPublicInfo exposes name and hasPassword=false by default', () => {
    const m = new RoomMetadata('Alice');
    m.setName('Lobby');
    expect(m.getPublicInfo()).toEqual({ name: 'Lobby', hasPassword: false });
  });
});

describe('RoomMetadata — password', () => {
  test('new room has no password', () => {
    const m = new RoomMetadata('Alice');
    expect(m.hasPassword()).toBe(false);
  });

  test('setPassword stores and reports hasPassword=true', () => {
    const m = new RoomMetadata('Alice');
    m.setPassword('hunter2');
    expect(m.hasPassword()).toBe(true);
    expect(m.getPublicInfo().hasPassword).toBe(true);
  });

  test('setPassword(null) clears', () => {
    const m = new RoomMetadata('Alice');
    m.setPassword('hunter2');
    m.setPassword(null);
    expect(m.hasPassword()).toBe(false);
  });

  test('setPassword("") clears', () => {
    const m = new RoomMetadata('Alice');
    m.setPassword('hunter2');
    m.setPassword('');
    expect(m.hasPassword()).toBe(false);
  });

  test('setPassword(whitespace-only) clears', () => {
    const m = new RoomMetadata('Alice');
    m.setPassword('hunter2');
    m.setPassword('   ');
    expect(m.hasPassword()).toBe(false);
  });

  test('setPassword trims surrounding whitespace', () => {
    const m = new RoomMetadata('Alice');
    m.setPassword('  hunter2  ');
    expect(m.checkJoin('Bob', 'hash', 'hunter2')).toBe('ok');
    expect(m.checkJoin('Bob', 'hash', '  hunter2  ')).toBe('wrongPassword');
  });

  test('checkJoin admits everyone on an open room', () => {
    const m = new RoomMetadata('Alice');
    expect(m.checkJoin('Bob', 'hash', undefined)).toBe('ok');
    expect(m.checkJoin('Bob', 'hash', '')).toBe('ok');
    expect(m.checkJoin('Bob', 'hash', 'anything')).toBe('ok');
  });

  test('checkJoin admits correct password on a locked room', () => {
    const m = new RoomMetadata('Alice');
    m.setPassword('hunter2');
    expect(m.checkJoin('Bob', 'hash', 'hunter2')).toBe('ok');
  });

  test('checkJoin rejects missing or wrong password on a locked room', () => {
    const m = new RoomMetadata('Alice');
    m.setPassword('hunter2');
    expect(m.checkJoin('Bob', 'hash', undefined)).toBe('wrongPassword');
    expect(m.checkJoin('Bob', 'hash', '')).toBe('wrongPassword');
    expect(m.checkJoin('Bob', 'hash', 'nope')).toBe('wrongPassword');
  });

  test('cleared password reverts to open verdict', () => {
    const m = new RoomMetadata('Alice');
    m.setPassword('hunter2');
    m.setPassword(null);
    expect(m.checkJoin('Bob', 'hash', undefined)).toBe('ok');
  });
});

describe('RoomMetadata — bans', () => {
  test('new room has no bans', () => {
    const m = new RoomMetadata('Alice');
    expect(m.getBans()).toEqual([]);
    expect(m.getPublicBans()).toEqual([]);
  });

  test('addBan inserts a record with bannedAt timestamp', () => {
    const m = new RoomMetadata('Alice');
    const before = Date.now();
    const entry = m.addBan('Mallory', 'ip-hash-1');
    const after = Date.now();
    expect(entry.name).toBe('Mallory');
    expect(entry.ipHash).toBe('ip-hash-1');
    expect(Date.parse(entry.bannedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(entry.bannedAt)).toBeLessThanOrEqual(after);
  });

  test('addBan is idempotent on duplicate name — refreshes existing entry', () => {
    const m = new RoomMetadata('Alice');
    m.addBan('Mallory', 'ip-hash-1');
    m.addBan('Mallory', 'ip-hash-2');
    const bans = m.getBans();
    expect(bans).toHaveLength(1);
    expect(bans[0].ipHash).toBe('ip-hash-2');
  });

  test('addBan is idempotent on duplicate ipHash — refreshes existing entry', () => {
    const m = new RoomMetadata('Alice');
    m.addBan('Mallory', 'ip-hash-1');
    m.addBan('Trudy',   'ip-hash-1');
    const bans = m.getBans();
    expect(bans).toHaveLength(1);
    expect(bans[0].name).toBe('Trudy');
  });

  test('addBan keeps distinct entries separate', () => {
    const m = new RoomMetadata('Alice');
    m.addBan('Mallory', 'ip-hash-1');
    m.addBan('Trudy',   'ip-hash-2');
    expect(m.getBans()).toHaveLength(2);
  });

  test('removeBan deletes by name', () => {
    const m = new RoomMetadata('Alice');
    m.addBan('Mallory', 'ip-hash-1');
    expect(m.removeBan('Mallory')).toBe(true);
    expect(m.getBans()).toEqual([]);
  });

  test('removeBan returns false for unknown name', () => {
    const m = new RoomMetadata('Alice');
    expect(m.removeBan('ghost')).toBe(false);
  });

  test('removeBan clears the ipHash half of the entry too', () => {
    const m = new RoomMetadata('Alice');
    m.addBan('Mallory', 'ip-hash-1');
    m.removeBan('Mallory');
    expect(m.checkJoin('Other', 'ip-hash-1', undefined)).toBe('ok');
  });

  test('getPublicBans omits ipHash', () => {
    const m = new RoomMetadata('Alice');
    m.addBan('Mallory', 'ip-hash-1');
    const pub = m.getPublicBans();
    expect(pub).toHaveLength(1);
    expect(pub[0]).toEqual({ name: 'Mallory', bannedAt: m.getBans()[0].bannedAt });
    expect('ipHash' in pub[0]).toBe(false);
  });

  test('checkJoin returns banned for a name match', () => {
    const m = new RoomMetadata('Alice');
    m.addBan('Mallory', 'ip-hash-1');
    expect(m.checkJoin('Mallory', 'different-hash', undefined)).toBe('banned');
  });

  test('checkJoin returns banned for an ipHash match even under a new name', () => {
    const m = new RoomMetadata('Alice');
    m.addBan('Mallory', 'ip-hash-1');
    expect(m.checkJoin('Renamed', 'ip-hash-1', undefined)).toBe('banned');
  });

  test('checkJoin returns banned before checking password', () => {
    const m = new RoomMetadata('Alice');
    m.setPassword('hunter2');
    m.addBan('Mallory', 'ip-hash-1');
    // Even with correct password, banned identity is rejected.
    expect(m.checkJoin('Mallory', 'ip-hash-1', 'hunter2')).toBe('banned');
    // Wrong-password gets `banned`, not `wrongPassword`, for a banned ip.
    expect(m.checkJoin('Renamed', 'ip-hash-1', 'nope')).toBe('banned');
  });

  test('checkJoin returns wrongPassword when not banned but password is wrong', () => {
    const m = new RoomMetadata('Alice');
    m.setPassword('hunter2');
    m.addBan('Mallory', 'ip-hash-1');
    expect(m.checkJoin('Bob', 'ip-hash-2', 'nope')).toBe('wrongPassword');
  });

  test('checkJoin verdict matrix across ban × password', () => {
    const m = new RoomMetadata('Alice');
    m.setPassword('pw');
    m.addBan('Mallory', 'ip-bad');

    // Open + clean
    const open = new RoomMetadata('Alice');
    expect(open.checkJoin('Bob', 'ip-good', undefined)).toBe('ok');
    expect(open.checkJoin('Bob', 'ip-good', 'whatever')).toBe('ok');

    // Locked, not banned
    expect(m.checkJoin('Bob', 'ip-good', 'pw')).toBe('ok');
    expect(m.checkJoin('Bob', 'ip-good', 'nope')).toBe('wrongPassword');
    expect(m.checkJoin('Bob', 'ip-good', undefined)).toBe('wrongPassword');

    // Locked, banned (any combo)
    expect(m.checkJoin('Mallory', 'ip-good', 'pw')).toBe('banned');
    expect(m.checkJoin('Bob',     'ip-bad',  'pw')).toBe('banned');
    expect(m.checkJoin('Mallory', 'ip-bad',  'nope')).toBe('banned');
  });
});

describe('RoomMetadata — salt and hashIp', () => {
  test('hashIp produces a deterministic hex hash for the same ip on the same room', () => {
    const m = new RoomMetadata('Alice');
    const a = m.hashIp('192.0.2.1');
    const b = m.hashIp('192.0.2.1');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test('hashIp returns different hashes for different ips', () => {
    const m = new RoomMetadata('Alice');
    expect(m.hashIp('192.0.2.1')).not.toBe(m.hashIp('192.0.2.2'));
  });

  test('different rooms hash the same ip to different values (per-room salt)', () => {
    const a = new RoomMetadata('Alice');
    const b = new RoomMetadata('Bob');
    expect(a.hashIp('192.0.2.1')).not.toBe(b.hashIp('192.0.2.1'));
  });
});
