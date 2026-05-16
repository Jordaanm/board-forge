// Pure-logic owner of per-room metadata (name, password, and — in a later
// slice — ban list). No WebSocket awareness; rooms.ts holds one per room
// and signaling.ts brokers messages against it.

const MAX_NAME_LENGTH = 40;
const FALLBACK_NAME   = 'Room';

export type JoinVerdict = 'ok' | 'wrongPassword';

export interface PublicRoomInfo {
  name:        string;
  hasPassword: boolean;
}

export class RoomMetadata {
  private hostDisplayName: string;
  private name:     string;
  private password: string | null = null;

  constructor(hostDisplayName: string) {
    this.hostDisplayName = hostDisplayName;
    this.name = this.defaultName();
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

  // Verdict on whether a guest with the supplied password may join. The host
  // bypasses this check at the signaling layer — the metadata only knows the
  // password, not the role.
  checkJoin(suppliedPassword: string | undefined): JoinVerdict {
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
