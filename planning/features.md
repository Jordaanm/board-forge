# Virtual Table — Feature Scope

## Core Concept
Browser-based virtual tabletop physics sandbox. Central use case: recreate real board games or prototype new ones. Multiplayer, with a scripting layer for rules enforcement and automation.

## PoC Scope

### Lobby
- OAuth login (Google + Discord)
- Simple room directory: list rooms, create, join
- No social features or chat in lobby

### Room / Session
- WebRTC P2P, data channels for all game state
- WebSockets used only for signaling and WebRTC handshake
- Room host is the authoritative peer — runs physics, broadcasts state, sees all (including hidden zones)
- Text chat, room-scoped only
- If host disconnects, session ends and all players return to lobby
- Auto-save every few seconds; players can recreate the room and resume from save

### Physics Sandbox
- Cannon.js simulated physics, host-authoritative
- Host broadcasts object positions/rotations at fixed intervals; peers interpolate
- Scripted behaviors (card flip, coin flip) feed into physics state — physics is always source of truth
- ThreeJS rendering
- Free camera, constrained to above/on the tabletop

### Table
- Every room has a table
- Host and game script can configure table shape and decoration

### Object Types
- **Card** — custom faces, stackable
- **Deck** — ordered stack, supports draw/shuffle/deal
- **Token/Pawn** — simple 3D piece
- **Die** — custom faces, physics-simulated roll
- **Hidden Zone** — 3D bounds; only owner can see or interact with contents inside
- **Tile/Board** — flat surface, usually static
- **Timer** — utility object
- **Score Tracker** — numeric value display

### Ownership
- Piece-type-specific restrictions:
  - Card hand: others can click to indicate interest, cannot move/flip/interact
  - Hidden Zone: non-owners cannot see or interact with anything entirely within the zone
- Most pieces are unowned and freely interactable

### Scripting
- JavaScript via SES Compartments (sandboxed, browser-safe)
- Used for rules enforcement and automation
- Required for full PoC; not needed for initial first-run experience

### Persistence
- All saved data is server-side
- Auto-save every few seconds during a session

## Post-PoC (Deferred)
- Voice and video chat (WebRTC media streams)
- Host migration on disconnect
- Additional object types
