// Pure-logic owner of per-room metadata (name, and — in later slices —
// password and ban list). No WebSocket awareness; rooms.ts holds one per
// room and signaling.ts brokers messages against it.

const MAX_NAME_LENGTH = 40;
const FALLBACK_NAME   = 'Room';

export interface PublicRoomInfo {
  name: string;
}

export class RoomMetadata {
  private hostDisplayName: string;
  private name: string;

  constructor(hostDisplayName: string) {
    this.hostDisplayName = hostDisplayName;
    this.name = this.defaultName();
  }

  // Replaces the stored name. Empty / whitespace-only input reverts to the
  // host-derived default. Returns the value that was actually stored, so
  // callers can broadcast the canonical string.
  setName(input: string): string {
    const sanitised = sanitise(input);
    this.name = sanitised === '' ? this.defaultName() : sanitised;
    return this.name;
  }

  getName(): string { return this.name; }

  getPublicInfo(): PublicRoomInfo {
    return { name: this.name };
  }

  private defaultName(): string {
    const host = this.hostDisplayName.trim();
    if (host === '') return FALLBACK_NAME;
    return `${host}'s room`;
  }
}

function sanitise(raw: string): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  return Array.from(trimmed).slice(0, MAX_NAME_LENGTH).join('');
}

export const ROOM_NAME_MAX_LENGTH = MAX_NAME_LENGTH;
