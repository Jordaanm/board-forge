// Builds the SET_ACTIVITY payload sent to Discord's local RPC socket. Pure:
// takes only the room/session inputs that drive the displayed strings.
// Trims `roomName` to Discord's 128-char field limit; player-count format
// is always plural ("1/4 players" not "1 player") to keep the fraction shape
// consistent.

export interface PresenceInput {
  roomName:    string;
  playerCount: number;
  capacity:    number;
  joinedAtMs:  number;
  logoKey:     string;
}

export interface ActivityPayload {
  details:         string;
  state:           string;
  large_image:     string;
  start_timestamp: number;
}

const MAX_ROOM_NAME_LEN = 128;

export function buildActivity(input: PresenceInput): ActivityPayload {
  const trimmed = input.roomName.length > MAX_ROOM_NAME_LEN
    ? Array.from(input.roomName).slice(0, MAX_ROOM_NAME_LEN).join('')
    : input.roomName;

  return {
    details:         `In Room: ${trimmed}`,
    state:           `${input.playerCount}/${input.capacity} players`,
    large_image:     input.logoKey,
    start_timestamp: input.joinedAtMs,
  };
}
