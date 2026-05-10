# Controls

This page covers the controls shared by all players: camera, the three core tools, the context menu, hand panel, and how to claim a seat. For host-only actions like spawning objects or editing the scene see [hosting.md](./hosting.md).

## Camera

The camera is free-orbit by default — even after you take a seat. Movement is mouse-driven:

- **Right-click drag** — orbit around the focus point.
- **Middle-click drag** — pan the focus point along the table plane.
- **Mouse wheel** — zoom in or out.

The browser's default right-click context menu is suppressed inside the room view. To open the in-app context menu on an object, just right-click without dragging (see "Context menu" below).

## Tools

The toolbar in the bottom-left corner holds the three player tools. Click a slot to activate it, or press the slot's number key. Hotkeys are suppressed while a text input has focus and on key-repeat events.

| Slot | Tool  | Hotkey | What it does |
|------|-------|--------|--------------|
| 1    | Grab  | `1`    | Left-click and drag a piece to carry it. Tap to click a piece without moving it. While dragging an object selected from the editor panel, an axis gizmo appears so you can constrain motion to a single axis. |
| 2    | Ping  | `2`    | Click on a piece to broadcast a ping that follows it for ~1.5 seconds. Click on an empty spot on the table to broadcast a ping at that point. Empty space off the table doesn't ping. Sends are rate-limited to roughly two per second. |
| 3    | Flick | `3`    | Press on a piece, drag to aim, release to apply an impulse. A short tap (under 150ms with little movement) fires a default-magnitude impulse along the camera's forward direction. The drag direction is "pull" — the piece launches opposite the way you dragged. |

Only the active tool reacts to left-click. The Grab and Flick tools refuse to manipulate pieces you're not allowed to touch (see "Ownership" below); Ping is cosmetic and works for everyone, including spectators.

## Context menu

Right-click on a piece to open its context menu. The available items depend on what kind of object it is and on whether you have permission to act on it. The menu does not open when you right-click on the table itself or on empty space — those right-clicks are reserved for the camera.

## Cursors and pings

When you take a seat your cursor is broadcast to every other player and rendered in your seat's colour. Spectators (unseated players) get a neutral grey cursor. Pings issued by the Ping tool render as a coloured ring + upward beam at the target location.

## Hand panel

Once you're seated, your main hand appears as a tile strip pinned to the bottom-center of the screen. The panel is purely a view onto your in-world hand entity — every card you see has a 3D counterpart that other players see only as a face-down card.

Within the hand panel you can:

- **Click** a tile to select the underlying card.
- **Right-click** a tile to open the same context menu you'd get on the 3D card.
- **Press and drag** a tile out of the panel onto the table to play that card to the world.
- **Drag tiles within the panel** to reorder your hand.

Cards still on the table can also be dragged into the hand panel — the Grab tool routes a release over the panel's footprint into your hand.

## Players panel and seats

The players panel in the top-right lists every seat and every spectator currently in the room. Eight seats are arranged around the table.

- Right-click an empty seat to claim it. Once seated, your hand appears, your cursor takes its seat colour, and you become eligible to manipulate seat-owned pieces.
- Right-click your own seat to release it (you become a spectator again).
- The host's seat is marked. Hosts can right-click another player's row to **kick** or **ban** them.

Spectators may move the camera, ping, and watch — they cannot grab or flick anything.

## Ownership

Pieces fall into three buckets:

- **Unowned** — anyone who is seated may grab, flick, or context-menu them. Most freshly-spawned objects are unowned.
- **Seat-owned** — only the owning seat (or the host) may manipulate them. Cards in someone else's hand are the canonical example.
- **Host-only** — only the host can manipulate. The table itself is in this bucket and never opens a context menu for non-hosts.

If you try to grab or flick a piece you don't own, the action no-ops silently. Pings always work regardless of ownership.

## Hotkeys

| Key   | Action |
|-------|--------|
| `1`   | Activate Grab tool |
| `2`   | Activate Ping tool |
| `3`   | Activate Flick tool |
| `Esc` | Cancel the in-progress flick aim (and dismiss any open modal dialog) |

Hotkey events are dropped while a text input, textarea, contenteditable, or select element has focus, so editing a field in the host panel never accidentally swaps your tool.
