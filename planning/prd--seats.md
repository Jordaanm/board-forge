# PRD — Seats

## Problem Statement

As a player in a virtual tabletop room, I have no stable identity that the game can bind ownership, hidden information, or "each player" actions to. My peer ID changes when I reconnect, so anything bound to it (hand contents, owned objects, dealt cards) is lost the moment my wifi blips. The game also has no way to enumerate "all the players" — it only sees a flat list of connections, indistinguishable from spectators.

As a host, I have no way to control who plays vs. watches, no way to organise players around the table for layout-sensitive games, and no way to keep card hands private to a specific player.

## Solution

Introduce 8 fixed-colour Seats per room. Seats are the stable game-mechanic identity; peers are transient connections that claim seats. Ownership of objects, hand contents, and hidden information binds to the seat, not the peer. Spectators are first-class — peers can connect without claiming a seat. The host can configure who can claim seats and when. A 60-second grace period covers transient disconnects so a brief network drop doesn't lose a player their state.

## User Stories

### Joining and identity

1. As a new player, I want to enter an optional display name on the landing page, so that other players see me by name rather than by colour.
2. As a returning player, I want my display name to be remembered across sessions, so that I don't retype it every time.
3. As a new peer, I want to join a room as a spectator by default, so that I can observe before committing to a seat.
4. As a host who set the room to auto-assign mode, I want new joiners to be auto-seated, so that pickup games start instantly.
5. As a host creating a room, I want to be auto-seated at seat 0 (white), so that I can begin setup without an extra click.
6. As any peer, I want to know which seats are filled before I claim, so that I can pick an empty colour I like.
7. As a peer connecting to a full room, I want a clear "room full" message, so that I understand why I can't join.

### Claiming, switching, vacating

8. As a spectator in self-assign mode, I want to click an empty seat marker on the table edge to claim it, so that I become a player.
9. As a spectator in self-assign mode, I want to click an empty seat row in the player list panel to claim it, so that I have a non-3D way to seat up.
10. As a seated player, I want to switch to a different empty seat mid-game, so that I can move next to a friend or away from a glare on the table.
11. As a seated player, I want to stand up via the player list panel, so that I can leave the active game without disconnecting.
12. As a host in host-assign mode, I want to click a seat row and pick a player or spectator from a dropdown, so that I control table assignments.
13. As a host in host-assign mode, I want to kick a seated player back to spectator with a single click, so that I can manage the table when needed.
14. As a player in host-assign mode, I want my seat-claim attempts to be cleanly disabled with a tooltip, so that I understand the rule without trying repeatedly.

### Disconnect and grace period

15. As a player whose wifi blips for 5 seconds, I want my seat preserved when I reconnect, so that I keep my hand and ownership.
16. As a player who reconnects within the grace window, I want my seat-token-based reclaim to be silent, so that I just resume the game.
17. As a player still in the room, I want disconnected seats to show a pulsing/faded marker, so that I know who has dropped out.
18. As a host running a "deal cards" action while one player is in grace-disconnect, I want their cards dealt anyway, so that a brief blip doesn't deny them a deal.
19. As a player who never returns within grace, I want my seat to become empty after 60 seconds, so that someone else can take it.
20. As any peer, when a grace-disconnected seat fully vacates, I want the previously-private contents (hand cards, owned items) to become public, so that the game continues with full information.

### Ownership

21. As a player, I want to manipulate any unowned object on the table, so that the sandbox feels open.
22. As a player, I want to be unable to grab another player's owned objects, so that ownership is meaningful.
23. As the host, I want to manipulate any object regardless of owner, so that I can fix mistakes or set up scenes.
24. As a spectator, I want to be unable to interact with any object, so that I can't disrupt the game.
25. As a player, I want my hand zone to be owned by me automatically, so that I don't have to configure ownership for the most common case.
26. As a player, I want objects I'm currently holding to be locked from other players grabbing them, so that drags don't conflict.
27. As a player who stands up while holding an object, I want the object to drop in place, so that the action resolves cleanly.
28. As a player whose grace timer expires while my seat owned a deck, I want that deck's ownership to clear so others can use it, so that the game isn't blocked by my absence.

### Hidden information

29. As a player, I want my hand cards to be face-up only on my screen, so that opponents can't see my hand.
30. As an opponent, I want to see the back of every card in another player's hand, so that I know how many cards they hold.
31. As any peer, when a seat fully vacates, I want that seat's hand cards revealed face-up to everyone, so that abandoned hands don't break game flow.
32. As a player who claims a previously-vacant seat with revealed cards, I want those cards to become private to me immediately, so that I take over a fresh privacy boundary.

### "All players" actions

33. As a game logic author, I want a single source of truth for "the list of currently playing seats," so that "deal to each player" works consistently.
34. As a card dealer, I want deal order to default counterclockwise from the dealer, so that the action matches tabletop convention.
35. As a host, I want spectators excluded from "each player" actions, so that watchers don't receive cards.

### Layout

36. As a player at a rectangular table, I want seats laid out 3-3-1-1 around the perimeter, so that I have room and a clear position.
37. As a player at a circular table, I want seats evenly spaced around the rim, so that the table is symmetrical.
38. As a player, I want my hand zone and edge marker placed at my seat's position with the right facing, so that my cards visually belong to me from my camera angle.

### Configuration

39. As a host, I want to set the seat-assignment mode in the editor panel under "Room Settings," so that I can choose between open seating, host-controlled seating, or auto-assignment.
40. As an operator, I want to configure `maxRoomPeers` and `disconnectGracePeriodMs` in app config, so that I can tune for hardware and use case without code changes.

### Visual feedback

41. As any peer, I want seats to be visible on the table edge as coloured pads, so that occupancy is obvious without opening a panel.
42. As any peer, I want the player list panel to summarise everyone in the room with status, so that I have a roster view.
43. As an opponent, I want each player's edge marker to show their name and colour, so that I can identify them quickly.

## Implementation Decisions

### Modules to build

- **RoomState manager (deep, host-side):** owns the authoritative seat occupancy, mode, spectator list, and grace timers. Exposes a small interface — claim, vacate, switch, host-assign, host-kick, set-mode, set-name, on-disconnect, on-reconnect — and emits state-update events. Pure logic; no networking, no DOM.
- **RoomState client (deep, peer-side):** holds the most-recently-received `RoomState`, applies patches, exposes synchronous queries (is-seat-occupied, get-occupant, get-my-seat, get-mode). Read-only mirror.
- **SeatLayout resolver (deep, pure):** given a table type, returns position and facing for each seat index. Pure data transformation. Tested independently of Three.js.
- **OwnershipPolicy (deep, pure):** given a peer (with seat or none, host flag) and an object's `ownedBy`, returns whether the peer may manipulate. Single function, fully unit-testable.
- **PrivacyScrubber (deep, pure):** given a target peer and an `ObjectState`, returns a scrubbed copy with `private` props redacted based on the object's `ownedBy` and the recipient's seat. Pure transformation.
- **GraceTimerManager (deep):** tracks per-seat disconnect timers; fires expiry callback. Wraps `setTimeout` behind a clock interface for test injection.
- **SeatTokenStore (host-side):** issues UUIDs on claim, validates on reclaim, invalidates on grace expiry.

### Modules to modify

- **`HostReplicator`:** replicate `RoomState` on the reliable channel; per-peer scrubbing pass over `SceneState` snapshots and patches before send.
- **`GuestInterpolator`:** consume scrubbed state without assuming all fields present.
- **Scene graph / SceneEntry:** add `ownedBy: SeatIndex | null` field; entries default to `null`.
- **`ObjectState`:** add `heldBy: { seatIndex: SeatIndex } | null` for transient hold lock; replace any peer-keyed hold tracking.
- **Table type def:** add `seatLayouts` keyed by seat index.
- **Server (`signaling.ts` / `rooms.ts`):** enforce `maxRoomPeers` cap at WebRTC handshake; reject with reason `'room-full'`.
- **`Room.tsx`:** add player list panel (top-right, collapsible, replaces today's bare connection-status indicator).
- **`EditorPanel`:** add "Room Settings" sub-section with mode radio.
- **`Landing.tsx`:** add optional display-name input persisted in localStorage.
- **Drag controllers (`DragController`, `GuestDragController`):** key hold state by seat index; refuse drag for spectators; refuse drag on objects whose `ownedBy` denies the peer.
- **Context menu:** disable actions for non-owners and spectators.

### Schema additions

- New top-level `RoomState` replicated state, separate from `SceneState`, on the reliable RPC channel.
- `RoomState` carries: host peer ID, seat-assignment mode (`'self' | 'host' | 'auto'`, default `'self'`), 8-element seat array (each: index, colour, peer ID or null, optional display name, connection status of `'connected' | 'disconnected' | 'empty'`), spectator array (peer ID + optional display name).
- `SceneEntry` gains `ownedBy: SeatIndex | null`.
- `ObjectState` gains `heldBy: { seatIndex: SeatIndex } | null`.
- Table type def gains `seatLayouts` mapping seat index to position + facing.
- App config gains `maxRoomPeers` (default 16, includes spectators) and `disconnectGracePeriodMs` (default 60000).
- Confirmed dependency from `prd-2.md`: `Hand.mainHandSeatId` sets the hand's `ownedBy` on creation.

### Replication messages (reliable channel)

- `claim-seat` (peer→host): seat index plus optional reclaim token.
- `stand-up` (peer→host).
- `host-assign-seat` (host action): target peer ID, seat index or null (null = kick to spectator).
- `set-room-mode` (host action): mode value.
- `set-display-name` (peer→host): name string.
- `room-state` (host→all): full state snapshot for initial sync.
- `room-state-patch` (host→all): partial deltas.
- `seat-token` (host→one peer, private): token issued on successful claim.

### Identity & layout

- Seat colours, fixed order, indices 0–7: `white, red, orange, yellow, green, blue, purple, pink`.
- "Table type" is synonymous with the existing table `shape` enum for now (extend later, e.g. `'large-rectangle'`).
- Rectangle (12 × 8): 3 along each long side + 1 each short end, indices walk counterclockwise from a canonical anchor.
- Circle: 8 evenly spaced at 45°, index 0 closest to the default camera.
- `facing` values point toward the table centre.

### Visual model

- Each seat has an edge marker — flat coloured pad on the table edge. Doubles as the hand-zone visual.
- Empty: dim grey + colour outline; click to claim (when allowed).
- Occupied (connected): filled colour + floating name-tag; **not interactive**.
- Occupied (grace-disconnect): pulsing/faded fill + name-tag with status indicator; not interactive.
- Click-to-claim is the only edge-marker interaction, only when empty.

### Assignment modes

| Action | `self` (default) | `host` | `auto` |
|---|---|---|---|
| Self-vacate | ✓ | ✓ | ✓ |
| Self-claim | ✓ | ✗ | ✓ |
| Self-switch | ✓ | ✗ | ✓ |
| Host-move others | ✗ | ✓ | ✗ |
| Host-kick | ✗ | ✓ | ✗ |

`auto` mode auto-assigns lowest-empty seat at join only; in-game movement is self-directed.

### Join flow

- Landing optional name input → persisted to localStorage; blank falls back to seat colour.
- New peer joins as spectator regardless of mode.
- In `auto` mode, host immediately auto-assigns lowest-empty seat.
- Host (room creator) is auto-seated at seat 0 (white).
- All seat changes flow through host as authority; broadcast as `RoomState` updates.

### Disconnect & grace

- On RTC peer-connection close, seat status → `'disconnected'`.
- During grace: seat counts as occupied for "all players" iteration; hidden info stays private; held-by-seat lock holds; ownership preserved.
- Reconnect: peer sends `claim-seat` with previously-issued seat token; host verifies and re-binds.
- Grace expiry: held object drops in place; objects with `ownedBy` matching the seat reset to `null`; privacy scrubbing for those objects ceases; hand contents revealed; status → `'empty'`.
- Host disconnect past grace → room dies (host migration deferred).

### Ownership & manipulation rules

- `ownedBy === null` → any seated peer may manipulate.
- `ownedBy === peer.seatIndex` → owner may manipulate.
- Host always may manipulate, regardless of `ownedBy`.
- Spectators never manipulate; read-only at all times.
- `ownedBy` is a single seat index; co-ownership deferred.

### Held-object lifecycle on vacation

- Stand-up while holding → drop in place (zero velocity); `ownedBy` unchanged.
- Host-kick while holding → drop in place; `ownedBy` unchanged.
- Disconnect (grace) while holding → object floats locked; on reconnect drag continues; on grace expiry drop in place.
- Standing up does not change `ownedBy`; ownership only releases on grace expiry.

### Hidden information

- `private: true` on `PropertyDef` marks scrubbable fields (per `prd-2.md`).
- Scrubbing applies to non-owner peers when status is `'connected'` or `'disconnected'`.
- Status `'empty'`: no scrubbing — fully public.
- New peer claims a previously-empty seat → scrubbing resumes immediately for that seat's owned objects.

### "All players" iteration

- Default scope: all seats with status ≠ `'empty'` (connected or grace-disconnected).
- Default order: ascending seat index.
- Action-specific overrides allowed (e.g. card "Deal X" goes counterclockwise from dealer, per `prd-2.md`).

### UI surfaces

- **Player list panel:** top-right, always visible, collapsible. Replaces today's bare connection-status indicator. 8 seat rows in fixed colour order with colour swatch, name (or "Empty" / "Disconnected ⏳"), per-row controls. Spectators in a separate group below. Own row carries the only "Stand up" button. In `host` mode, clicking any seat row opens a dropdown segmented into Players and Spectators sublists; small × on a seated row kicks to spectator. No drag-and-drop.
- **Edge markers:** 3D pads on the table edge. Click target only when empty. Disabled in `host` mode for non-host peers.
- **EditorPanel → Room Settings:** new sub-section. 3-way radio for `seatAssignmentMode`. Host-only.
- **Spectator camera:** same TTS-style orbit as guests. No editor-panel access. No scene interaction.

### Display names

- Optional input on Landing; persisted in localStorage; blank → seat colour fallback.
- Stored on RoomState entries.
- Display fallback: name or capitalised colour for seated; name or `'Spectator'` for spectators.
- No uniqueness enforcement.
- Future: derived from OAuth user account.

### Cursor decoration (forward-looking)

Sibling todo. Seats PRD specifies the contract only:

- Cursor message includes `seatIndex | null`.
- Seated peer cursor tinted with seat colour.
- Spectator cursor uncoloured / grey.

### Build order

1. RoomState infrastructure (state container, reliable-channel replication).
2. Seat data model + table-type seat layouts.
3. Edge markers + player list panel + claim/stand-up flows.
4. `ownedBy` field rollout + manipulation gating + spectator read-only enforcement.
5. Disconnect grace + session-token reclaim.
6. Privacy scrubbing extension to `HostReplicator`.
7. EditorPanel → Room Settings sub-section.
8. Hands depend on Seats; ship after.

## Testing Decisions

A good test here exercises external behaviour — given inputs through a module's public interface, the outputs (returned values, emitted events) match expectations. Tests do not assert on internal field names, private state, or call counts on collaborators.

### Modules to test

- **OwnershipPolicy:** unit tests for the manipulation matrix — owner/non-owner/host/spectator × owned/unowned object. Pure function; trivial harness.
- **PrivacyScrubber:** unit tests for the scrubbing rules — owner sees private fields, non-owner sees scrubbed values, vacant-seat objects skip scrubbing, host receives unscrubbed copies. Pure function.
- **SeatLayout resolver:** unit tests for rectangle and circle layouts — assert positions and facings for each index.
- **RoomState manager (host-side):** integration tests over the public surface — claim, vacate, switch, host-assign, host-kick, mode transitions, disconnect→grace→expiry transitions. Use a fake clock for the grace timer. Assert on emitted state events and final state, not internal mutations.
- **GraceTimerManager:** unit tests with a fake clock — start, cancel-on-reconnect, fire-on-expiry, multiple concurrent timers.
- **SeatTokenStore:** unit tests for issue, verify, invalidate on grace expiry.

### Integration

- A small end-to-end host-replicator test: feed a `RoomState` and a `SceneState` with mixed `ownedBy`, observe per-peer scrubbed snapshots match expectations.

### Prior art

The codebase has minimal existing test coverage; these will set conventions. Aim for the deep-module pattern (small interface, lots of behaviour) so that seat-flow regressions are caught in fast unit tests rather than in slow networked integration runs.

## Out of Scope

- Host migration. Room dies when host fully disconnects past grace.
- Reserved or locked seats (e.g. "save red for my friend").
- Custom seat layouts per game (manual placement).
- Multi-owner objects. `ownedBy` is a single index.
- Persistence beyond ephemeral session.
- OAuth-derived display names.
- Cursor implementation (sibling PRD; this PRD only specifies the contract).
- Drag-and-drop seat assignment in the player list.
- Seat-token persistence across devices.
- Spectator-to-seat transition animations.
- Spectator chat / observer-only channels.

## Further Notes

- Hands (per `prd-2.md`) depend on this PRD. Seats must ship first; `Hand.mainHandSeatId` sets the hand's `ownedBy`.
- ID scheme: UUIDs across all entries (per `prd-2.md`) are required for stable seat references.
- The host-authoritative networking model is preserved; the server remains signaling-only. All seat-claim verification, token issuance, scrubbing, and grace-timer logic lives on the host peer.
- App config additions (`maxRoomPeers`, `disconnectGracePeriodMs`) layer onto the existing config file added in commit `eb1425f`.
