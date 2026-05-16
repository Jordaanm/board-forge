// Pure-logic owner of per-room metadata (name, password, bans). No WebSocket
// awareness; rooms.ts holds one per room and signaling.ts brokers messages
// against it.

import { createHash, randomBytes } from 'crypto';

const MAX_NAME_LENGTH = 40;
const FALLBACK_NAME   = 'Room';

export type JoinVerdict = 'ok' | 'banned' | 'wrongPassword';

export interface BanEntry {
  name:     string;
  ipHash:   string;
  bannedAt: string;  // ISO timestamp
}

// Subset of BanEntry safe to expose to the host's UI. IP hashes stay
// server-side per the PRD ("IP hashes are not exposed").
export interface PublicBanEntry {
  name:     string;
  bannedAt: string;
}

export interface PublicRoomInfo {
  name:        string;
  hasPassword: boolean;
}

export class RoomMetadata {
  private hostDisplayName: string;
  private name:     string;
  private password: string | null = null;
  private bans:     BanEntry[]    = [];
  private readonly salt: string;

  constructor(hostDisplayName: string) {
    this.hostDisplayName = hostDisplayName;
    this.name = this.defaultName();
    this.salt = randomBytes(16).toString('hex');
  }

  // Hashes a client IP with this room's salt. Salt is per-room, so the same
  // IP produces different hashes across rooms — ban data can't be cross-
  // correlated.
  hashIp(ip: string): string {
    return createHash('sha256').update(this.salt + ip).digest('hex');
  }

  // Records a ban. Idempotent: a re-ban under the same name OR ipHash
  // updates the existing entry (refreshing timestamp, name, ipHash) instead
  // of inserting a duplicate.
  addBan(name: string, ipHash: string): BanEntry {
    const existing = this.bans.find(b => b.name === name || b.ipHash === ipHash);
    const bannedAt = new Date().toISOString();
    if (existing) {
      existing.name = name;
      existing.ipHash = ipHash;
      existing.bannedAt = bannedAt;
      return { ...existing };
    }
    const entry: BanEntry = { name, ipHash, bannedAt };
    this.bans.push(entry);
    return { ...entry };
  }

  // Removes the ban entry with this exact display name. Idempotent: returns
  // false if there was nothing to remove. Clears both the name and ipHash
  // halves of the identity tuple in one shot since they share a record.
  removeBan(name: string): boolean {
    const i = this.bans.findIndex(b => b.name === name);
    if (i === -1) return false;
    this.bans.splice(i, 1);
    return true;
  }

  // Full ban records (used internally by checkJoin).
  getBans(): BanEntry[] {
    return this.bans.map(b => ({ ...b }));
  }

  // Host-facing list, excluding ipHash.
  getPublicBans(): PublicBanEntry[] {
    return this.bans.map(b => ({ name: b.name, bannedAt: b.bannedAt }));
  }

  // Replaces the stored name. Empty / whitespace-only input reverts to the
  // host-derived default. Returns the value that was actually stored, so
  // callers can broadcast the canonical string.
  setName(input: string): string {
    const sanitised = sanitiseName(input);
    this.name = sanitised === '' ? this.defaultName() : sanitised;
    return this.name;
  }

  getName(): string { return this.name; }

  // Stores a password. `null`, empty, or whitespace-only input clears it,
  // which "reopens" the room to passwordless joins.
  setPassword(input: string | null): void {
    if (input === null || typeof input !== 'string') {
      this.password = null;
      return;
    }
    const trimmed = input.trim();
    this.password = trimmed === '' ? null : trimmed;
  }

  hasPassword(): boolean { return this.password !== null; }

  // Verdict on whether a guest with the supplied identity may join. Ban
  // check (name OR ipHash match) runs BEFORE password so banned users get
  // the truthful reason instead of being misled by a password error.
  // The host bypasses this check at the signaling layer.
  checkJoin(displayName: string, ipHash: string, suppliedPassword: string | undefined): JoinVerdict {
    if (this.bans.some(b => b.name === displayName || b.ipHash === ipHash)) return 'banned';
    if (this.password === null) return 'ok';
    if (typeof suppliedPassword === 'string' && suppliedPassword === this.password) return 'ok';
    return 'wrongPassword';
  }

  getPublicInfo(): PublicRoomInfo {
    return { name: this.name, hasPassword: this.hasPassword() };
  }

  private defaultName(): string {
    const host = this.hostDisplayName.trim();
    if (host === '') return FALLBACK_NAME;
    return `${host}'s room`;
  }
}

function sanitiseName(raw: string): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  return Array.from(trimmed).slice(0, MAX_NAME_LENGTH).join('');
}

export const ROOM_NAME_MAX_LENGTH = MAX_NAME_LENGTH;
