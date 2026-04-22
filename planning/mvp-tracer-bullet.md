# MVP Tracer Bullet — Scope

**Goal**: Two players moving physics objects around a shared sandbox in real time. Validates the core real-time physics sync loop before any other features are built.

## Stack

- **Frontend**: React + TypeScript + Vite + ThreeJS + Cannon.js
- **Backend**: Bun + Express + `ws` (signaling only)
- **Networking**: WebRTC P2P, data channels for all game state; WebSocket for signaling only

## Auth / Rooms

- Anonymous — no login
- Room creator = host; guests join via shareable URL
- Session is ephemeral — no persistence

## Scene Graph

- **Root**: `Scene` object — Table is a property of Scene, not a node
- **Children**: Board, Die, Token — all flat direct children of Scene
- **Scene is the only valid container** in this iteration (Deck and Bag deferred)
- **Replication**: delta patches streamed continuously + periodic full-state snapshots to prevent drift

## Object Types

| Object | Properties | Actions | Notes |
|--------|-----------|---------|-------|
| Table | Shape, decoration | None | Fixed; configured via Scene properties |
| Board | Dimensions, texture (image URL) | None | Static mesh; not throwable |
| Die (D6) | — | Roll (physics-simulated) | Standard 6-sided |
| Token (Meeple) | Colour | — | Generic meeple mesh |

All object actions and editable properties are accessed via right-click context menu.

## Interaction Model

- **Pick up**: object lifts to fixed height above table, follows cursor on horizontal plane
- **Throw**: release with momentum → airborne arc → lands with physics simulation
- **Drag**: smooth cursor-following at fixed height
- **Remote view**: position updates streamed continuously; other players see smooth interpolated movement
- **Ownership**: none — all players can interact with all objects
- Reference feel: Tabletop Simulator

## Camera

- **All players**: TTS-style orbit — right-click drag to rotate, scroll to zoom, middle-click drag to pan; constrained above table surface
- **Host**: unrestricted camera available as a toggle within the editing tools panel

## Host Editing Tools

- Floating panel, host-only, closeable/collapseable
- Contains: scene graph view, selected object properties editor, object spawning controls
- Presented as tools layered over the gameplay environment — no hard authoring/play mode switch
- Unrestricted camera is a toggle within this panel

## Out of Scope for This Iteration

- Text chat
- Persistence / auto-save
- Auth and lobby
- Scripting
- Ownership / hidden zones
- Deck, Bag, Timer, Score Tracker
- Host migration
