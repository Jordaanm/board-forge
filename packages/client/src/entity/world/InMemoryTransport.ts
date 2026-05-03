// In-memory WorldTransport pair for boundary tests — issue #1 of issues--arch.md.
//
// Synchronously delivers messages from one transport to its paired peer.
// Optional unreliable-channel loss + reorder injection — issue #9 / #10 lean
// on these knobs to test coalescing and reliability semantics.

import { type SceneMessage } from '../wire';
import { type WorldTransport } from './types';

export interface InMemoryBusOptions {
  // Drop probability for unreliable-channel messages, 0..1. Reliable messages
  // are never dropped.
  unreliableLossProbability?: number;
  // Optional injected RNG for deterministic loss tests. Defaults to Math.random.
  random?: () => number;
}

const HOST_PEER_ID  = 'host-peer';
const GUEST_PEER_ID = 'guest-peer';

type MessageHandler  = (peerId: string, msg: SceneMessage) => void;
type PeerJoinHandler = (peerId: string) => void;

interface Endpoint {
  remoteId:        string;
  messageHandlers: MessageHandler[];
  peerJoinHandlers: PeerJoinHandler[];
}

// Returns [hostTransport, guestTransport]. Each call to host.send delivers
// synchronously to every guest message handler, and vice versa.
export function createInMemoryBusPair(opts: InMemoryBusOptions = {}): [WorldTransport, WorldTransport] {
  const random   = opts.random ?? Math.random;
  const lossProb = opts.unreliableLossProbability ?? 0;

  const host:  Endpoint = { remoteId: HOST_PEER_ID,  messageHandlers: [], peerJoinHandlers: [] };
  const guest: Endpoint = { remoteId: GUEST_PEER_ID, messageHandlers: [], peerJoinHandlers: [] };

  function deliver(target: Endpoint, fromPeerId: string, msg: SceneMessage, reliable: boolean): void {
    if (!reliable && lossProb > 0 && random() < lossProb) return;
    for (const h of target.messageHandlers) h(fromPeerId, msg);
  }

  function makeTransport(self: Endpoint, peer: Endpoint, selfPeerId: string): WorldTransport {
    return {
      send(msg, sendOpts) {
        deliver(peer, selfPeerId, msg, sendOpts.reliable);
      },
      sendTo(peerId, msg) {
        if (peerId !== peer.remoteId) return;
        deliver(peer, selfPeerId, msg, true);
      },
      onMessage(handler) {
        self.messageHandlers.push(handler);
        return () => {
          const i = self.messageHandlers.indexOf(handler);
          if (i >= 0) self.messageHandlers.splice(i, 1);
        };
      },
      onPeerJoin(handler) {
        self.peerJoinHandlers.push(handler);
        return () => {
          const i = self.peerJoinHandlers.indexOf(handler);
          if (i >= 0) self.peerJoinHandlers.splice(i, 1);
        };
      },
    };
  }

  const hostTransport  = makeTransport(host,  guest, HOST_PEER_ID);
  const guestTransport = makeTransport(guest, host, GUEST_PEER_ID);

  return [hostTransport, guestTransport];
}
