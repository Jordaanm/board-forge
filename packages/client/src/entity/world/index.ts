// Public surface of the World module — issue #1 of issues--arch.md.

export { createWorld } from './World';
export { createInMemoryBusPair } from './InMemoryTransport';
export type { InMemoryBusOptions } from './InMemoryTransport';
export type {
  World,
  WorldOptions,
  WorldIdentity,
  WorldTransport,
  WorldInboundMessage,
  ReplicationPolicy,
  ReplicationTarget,
  EntityHandle,
  SpawnOptions,
} from './types';
