// Maximum simultaneous peers per room, including the host.
// Override with MAX_PEERS_PER_ROOM env var.
export const MAX_PEERS_PER_ROOM = Number(process.env.MAX_PEERS_PER_ROOM ?? 8);
