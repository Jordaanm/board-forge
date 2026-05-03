// Production WorldTransport that wraps ConnectionManager — issue #7 of
// issues--arch.md. Owns per-peer fan-out and privacy scrubbing so the World
// can call `transport.send(msg, opts)` once instead of looping over targets.
//
// The transport doesn't talk to ConnectionManager directly; ThreeCanvas hands
// it `send` / `sendTo` callbacks that route through the existing refs. That
// keeps the React lifecycle in charge of WS reconnects without leaking it
// into entity code.

import { type Entity } from '../Entity';
import { type SceneMessage } from '../wire';
import { type ChannelMessage } from '../../net/SceneState';
import {
  EMPTY_PRIVATE_FIELD_REGISTRY,
  scrubSceneMessage,
  type PrivateFieldRegistry,
} from '../../seats/PrivacyScrubber';
import {
  type WorldTransport,
  type WorldInboundMessage,
  type WorldOutboundMessage,
  type ReplicationTarget,
} from './types';

export interface SendOpts {
  reliable?: boolean;  // default true — routes to ConnectionManager's reliable channel
}

export interface RtcTransportOptions {
  // Broadcast and per-peer send hooks — typically wired to ConnectionManager
  // via ThreeCanvas's sendRef / sendToRef. Anything in the broader
  // ChannelMessage union flows through unchanged; SceneMessages destined for
  // multiple peers go via sendTo so each target gets its own scrubbed copy.
  // The reliable flag selects the unreliable RTCDataChannel for transform /
  // cursor traffic (issue #9 of issues--arch.md).
  send:   (msg: ChannelMessage, opts?: SendOpts) => void;
  sendTo: (peerId: string, msg: ChannelMessage, opts?: SendOpts) => void;
  // Returns the current set of replication targets (host: connected guests;
  // guest: empty). Empty disables fan-out — the transport falls back to a
  // single broadcast send.
  getTargets: () => ReplicationTarget[];
  // Resolves an entityId to its Entity for privacy lookups. The transport is
  // constructed before the World, so this is a forward-reference closure that
  // reads the World's scene at call time.
  getEntity: (id: string) => Entity | undefined;
  // Maps componentTypeId → state-field names to redact. Empty registry is the
  // identity (current shipped behaviour).
  privateFieldRegistry?: PrivateFieldRegistry;
}

export class RtcTransport implements WorldTransport {
  private readonly send_:               (msg: ChannelMessage, opts?: SendOpts) => void;
  private readonly sendTo_:             (peerId: string, msg: ChannelMessage, opts?: SendOpts) => void;
  private readonly getTargets:          () => ReplicationTarget[];
  private readonly getEntity:           (id: string) => Entity | undefined;
  private readonly registry:            PrivateFieldRegistry;
  private readonly messageHandlers:     Array<(peerId: string, msg: WorldInboundMessage) => void> = [];
  private readonly peerJoinHandlers:    Array<(peerId: string) => void> = [];

  constructor(opts: RtcTransportOptions) {
    this.send_      = opts.send;
    this.sendTo_    = opts.sendTo;
    this.getTargets = opts.getTargets;
    this.getEntity  = opts.getEntity;
    this.registry   = opts.privateFieldRegistry ?? EMPTY_PRIVATE_FIELD_REGISTRY;
  }

  send(msg: WorldOutboundMessage, opts: { reliable: boolean }): void {
    const targets = this.getTargets();
    if (targets.length > 0 && isSceneMessage(msg)) {
      // Host broadcast: per-peer fan-out + scrubbing.
      for (const t of targets) {
        const scrubbed = scrubSceneMessage(
          { peerSeat: t.peerSeat, isHost: t.isHost },
          msg,
          this.registry,
          this.getEntity,
        );
        this.sendTo_(t.peerId, scrubbed, { reliable: opts.reliable });
      }
      return;
    }
    // Guest input or no targets: broadcast as-is. Guests have no targets, so
    // their hold-claim / hold-release / guest-drag-move all flow through here
    // straight to the host.
    this.send_(msg, { reliable: opts.reliable });
  }

  sendTo(peerId: string, msg: SceneMessage): void {
    const target = this.getTargets().find(t => t.peerId === peerId);
    if (!target) {
      this.sendTo_(peerId, msg);
      return;
    }
    const scrubbed = scrubSceneMessage(
      { peerSeat: target.peerSeat, isHost: target.isHost },
      msg,
      this.registry,
      this.getEntity,
    );
    this.sendTo_(peerId, scrubbed);
  }

  // ── Inbound dispatch ────────────────────────────────────────────────────
  // ThreeCanvas's onMsgRef forwards channel messages here via deliver(); this
  // module fan-outs to subscribed handlers. Cursor traffic is intercepted by
  // ThreeCanvas before reaching the transport, so only WorldInboundMessages
  // arrive on this path.
  deliver(peerId: string, msg: WorldInboundMessage): void {
    for (const h of this.messageHandlers) h(peerId, msg);
  }

  firePeerJoin(peerId: string): void {
    for (const h of this.peerJoinHandlers) h(peerId);
  }

  onMessage(handler: (peerId: string, msg: WorldInboundMessage) => void): () => void {
    this.messageHandlers.push(handler);
    return () => {
      const i = this.messageHandlers.indexOf(handler);
      if (i >= 0) this.messageHandlers.splice(i, 1);
    };
  }

  onPeerJoin(handler: (peerId: string) => void): () => void {
    this.peerJoinHandlers.push(handler);
    return () => {
      const i = this.peerJoinHandlers.indexOf(handler);
      if (i >= 0) this.peerJoinHandlers.splice(i, 1);
    };
  }
}

function isSceneMessage(msg: WorldOutboundMessage): msg is SceneMessage {
  // GuestInputMessage discriminator types are guest-drag-{start,move,end}.
  return msg.type !== 'guest-drag-start'
      && msg.type !== 'guest-drag-move'
      && msg.type !== 'guest-drag-end';
}
