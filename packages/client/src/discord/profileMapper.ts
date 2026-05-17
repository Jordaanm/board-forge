// Maps a raw Discord `/users/@me` response to the subset Board Together
// cares about. Encapsulates: `global_name` vs `username` fallback, missing
// avatar handling, animated-hash (`a_…`) URL construction, CDN URL shape.

export interface DiscordProfile {
  discordId:       string;
  displayNameSeed: string;
  avatarUrl:       string | null;
}

const CDN_BASE   = 'https://cdn.discordapp.com';
const AVATAR_EXT = 'webp';
const AVATAR_SIZE = 128;

export function mapProfile(raw: unknown): DiscordProfile | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const discordId = typeof r.id === 'string' && r.id !== '' ? r.id : null;
  if (discordId === null) return null;

  const username = typeof r.username === 'string' && r.username !== '' ? r.username : null;
  if (username === null) return null;

  const globalName =
    typeof r.global_name === 'string' && r.global_name !== '' ? r.global_name : null;

  const displayNameSeed = globalName ?? username;

  const avatarHash =
    typeof r.avatar === 'string' && r.avatar !== '' ? r.avatar : null;
  const avatarUrl =
    avatarHash !== null ? buildAvatarUrl(discordId, avatarHash) : null;

  return { discordId, displayNameSeed, avatarUrl };
}

function buildAvatarUrl(discordId: string, avatarHash: string): string {
  return `${CDN_BASE}/avatars/${discordId}/${avatarHash}.${AVATAR_EXT}?size=${AVATAR_SIZE}`;
}
