# Hosting

When you create a room you become its host. This page covers what that means and walks through the host-only UI: the action bar at the top of the screen, the editor panel on the left, save files, the asset manager, and the history/undo flow.

## What "host" means

The host is the peer who launched the room (the URL contains `&host=1`). The host is the source of truth for the scene: it owns the physics simulation, runs the script, and replicates state to every guest over WebRTC data channels. Every guest connection is mediated by the host — when a guest joins, the host pushes the current room state and asset manifest down the new channel.

Concretely, the host can:

- Spawn, delete, and edit any entity in the scene.
- Manipulate any piece, regardless of its seat ownership.
- Save and load entire scenes from disk.
- Revert to the last loaded scene with one click.
- Step backward through the recent undo history.
- Edit the scripting source for the room and run it.
- Curate the room's asset catalog and push it to peers.
- Toggle visibility of normally-hidden zones.
- Kick or ban any peer.

Guests have none of these powers. They can claim a seat, manipulate pieces they own, ping, flick, and chat through their cursor; everything else is gated.

## Host action bar

The host action bar is anchored to the top-center of the screen and is the launcher for every host-only flow.

### Spawn Object

Opens a searchable modal listing every public spawnable. The current built-in spawnables are:

- **Table** — the singleton table fixture. (Already in every room — only useful if you somehow start with no table.)
- **Board** — a flat object meant to host child surfaces and elements.
- **Die (D6)** and **Die (D20)** — physical dice.
- **Token** — a generic token.
- **Card** and **Deck** — cards (which have a back/front face and can sit in hands) and decks (stacks that can be drawn from, shuffled, and dealt).
- **Zone** and **Hand** — non-physical regions that govern how contained pieces behave. A Hand is a Zone variant that's tied to a seat.
- **Snap Marker** — invisible placement anchor that pulls dropped pieces onto a pre-defined pose. See "Snap Points" below.

Filter by typing a label, category, type, or tag. Arrow keys navigate the list and Enter spawns the highlighted entry. The modal stays open after a spawn so you can quickly drop in a batch.

### Save

Captures the current scene as a single JSON file and downloads it. The file contains:

- The full entity list.
- A small PNG thumbnail of the current view.
- The room's authored script source plus its initialised flag.
- The host's custom asset catalog.
- A `savedAt` ISO timestamp and a versioned envelope header so old saves remain loadable as the format evolves.

The file format is plain JSON. The envelope is `{ format: "vtt-scene", version: 1, savedAt, thumbnail, scene, script, manifest }`.

### Load

Opens a file picker, validates the chosen save file, and replaces the live scene with its contents. Validation rejects unknown component types and any malformed envelope, so a partial decode never lands in the scene. Loading also restores the saved script source and asset catalog, and registers the file as the room's "last loaded" file — that in turn enables Revert.

When a guest is present, replacing the scene replicates to them automatically.

### Revert

Greyed out until you load a file. Once you have, **Revert** restores the scene exactly as it appeared when the file was loaded — useful for un-doing an entire session of edits in one click. A confirmation dialog shows the filename to make sure you mean to throw the live state away.

### History

Opens a modal listing the recent undo snapshots, newest at top, with thumbnails. The first row is the current state ("you are here") and is not clickable. Click any other row to instantly restore that snapshot. The stack holds the last 20 entries by default; saving doesn't push, but loading and reverting do clear it.

### Edit Script

Opens the Monaco-based script editor for the room. See [scripting.md](./scripting.md) for authoring details. A quick summary of the editor's behavior:

- On first open with no saved script, the editor seeds with a commented-out `class extends Game` example.
- **Save Script** persists the source so it travels with the room and is included in saves.
- **Run** compiles and executes the source against the live scene.
- An error log inside the modal shows the most recent compile or runtime failures.

### Asset Manager

Opens a four-tab modal:

- **Primitives** — read-only `prim:*` mesh entries shipped with the client.
- **Base** — read-only `base:*` placeholder entries.
- **Custom** — your room's own asset catalog. Add an image, model, sound, or spritesheet by URL; the modal probes the URL with a CORS preflight so you know up front whether it'll load.

Newly added assets default to `preload: true`, meaning the client will fetch them eagerly. The slug for each entry auto-suggests from the URL filename and is locked once the entry is committed.

When **Spritesheet** is selected, two extra fields appear — **Cols** and **Rows** — describing the grid layout of the source image. Both default to `1` and remain editable on existing entries. See "Spritesheets" below for how the cells are addressed.

The modal's footer shows the count of unpushed changes. Click **Push to peers** to broadcast the current published catalog to every connected guest. Until you push, custom-tab edits live only on the host.

### Generate Deck

A shortcut for converting a spritesheet into a ready-to-play deck. Pick a spritesheet asset, click the cell that holds the card back, optionally type a tag to apply to every card, and the host spawns one `Card` per non-back cell plus a `Deck` entity stacking them. Disabled until you've added at least one `spritesheet` entry in the Asset Manager.

### Show All Zones

A checkbox toggle. By default Zone entities are visible only when relevant (for example, while dragging a piece into one). Turning **Show All Zones** on renders every Zone in the scene as a tinted volume — handy for laying out a complex scene.

### Show Snap Points

A checkbox toggle. By default Snap Markers and per-entity snap points are invisible and non-interactive. Turning **Show Snap Points** on renders each snap point as a translucent green disc (with a forward arrow if it snaps rotation) and makes Snap Markers grabbable so you can re-position them. Host-only — guests never see snap points regardless of the toggle.

## Editor panel

The editor panel is anchored to the top-left of the screen and is visible only to the host. It has two halves.

### Object list

The top half lists every entity in the scene by id and type. Click a row to select that entity; clicking again on the same row deselects. Selection drives both the highlight in the 3D view and the panel's lower half.

A **Free camera** toggle at the top of the panel temporarily releases the orbit clamps so you can fly through the scene to inspect things from any angle.

### Inspector

The bottom half — visible when an entity is selected — shows:

- **Entity fields**: the entity's display name, its tag list, and its seat owner (or "host" / "unowned").
- **Component sections**: one section per component on the entity that declares a property schema. Each section renders editable fields for the component's state — for example, a Die has its result face, a Card has its texture refs, a Zone has its half-extents.
- **Surface elements** (when present): for entities with a surface, a list of attached stickers/elements with edit and remove controls.
- **Tools**: action buttons aggregated from the selected entity's components — for example, a Die exposes a Roll button, and a board exposes Add Surface.

Edits made in the inspector are routed through the same code paths a script would use, so anything you can do in the panel a script can do programmatically.

Entities that carry a mesh expose an **Add Snap Markers** button in their tool list — clicking it attaches a `SnapPointsComponent` to the entity so you can drop snap anchors directly onto a card, board, or token without spawning a separate `Snap Marker`. The button hides once the component is attached.

## Snap Points

Snap Points are placement aids. When a player releases a piece near a snap point, the host teleports it onto the point's pose (XZ position, optionally Y and yaw) and zeroes its velocity. They're used for "deck goes here" drop zones and for edge-aligning rows of pieces.

A snap point is just a pose + radius attached to an entity. Two entry points produce them:

- **Snap Marker** — spawnable from the action bar's Spawn Object modal. It carries only a Transform and a SnapPoints component (no mesh, no physics) and ships with a single default point at its origin. Useful as a free-standing anchor on the table.
- **Add Snap Markers** — editor inspector button on any entity that has a mesh. Attaches a `SnapPointsComponent` to that entity so the snap point travels with the piece.

Once a SnapPoints component is present, the inspector renders a numeric form for each point with two rows:

- **Pose row** — `x`, `y`, `z`, `yaw` (radians, applied only when "snap yaw" is on).
- **Config row** — `radius` (XZ-plane catch distance), `snap yaw` (rotate the piece to match `yaw` on snap), `snap y` (also snap the piece's Y position to the point — off by default, so e.g. a card snapping to a deck marker doesn't drag heavy pieces through the table), and a `×` to delete the point. An **Add Snap Point** button at the bottom appends another point at the entity's origin.

Snapping fires only on a grab-tool drop. Scripted moves, save-file loads, and initial spawns don't trigger snap. The host computes the result and broadcasts the final pose as a normal transform patch.

## Spritesheets

A **Spritesheet** is a single image laid out as a grid of equally-sized cells, addressable by index. The motivating use case is 1-image card decks — back plus 52 faces in one PNG — but anything that's a grid of icons or tiles works.

Add a spritesheet from the Asset Manager's Custom tab: pick `Spritesheet` for the type, paste the image URL, and fill in **Cols** and **Rows**. Cells are numbered row-major from the top-left: index `0` is top-left, index `cols-1` is top-right, index `cols` is the start of the second row.

Anywhere a texture ref is expected (card faces, surface images, etc.) you can refer to an individual cell with a 3-segment slug: `custom:my-deck:7`. The first two segments identify the sheet entry; the trailing number is the cell index. The Asset Picker exposes this directly — click a spritesheet tile to drill into a sub-grid where each cell is its own selectable tile. Picking the sheet itself is not allowed; you must pick a cell.

Out-of-range indices and malformed refs (`custom:my-deck:abc`) render as the magenta "broken asset" placeholder, the same as a missing image. Cols, rows, and the URL all stay editable after creation — but be aware that a layout change invalidates any cell refs that no longer fit, so existing pieces may suddenly show the broken-asset texture.

The **Generate Deck** action bar shortcut consumes a spritesheet directly and is the fastest path from "I have a deck image" to "the deck is on the table".

## Players panel — host extras

The players panel in the top-right (which all peers see) gains two host-only entries when you right-click a guest's row:

- **Kick** — disconnects the guest. They can rejoin.
- **Ban** — disconnects the guest and refuses re-entry for the lifetime of the room.

## Quick reference

| Action            | Where it lives                          | Notes |
|-------------------|-----------------------------------------|-------|
| Spawn an object   | Top action bar → Spawn Object           | Search across labels, categories, types, tags. |
| Edit a piece      | Top-left panel → select entity          | Editor inspector exposes every component's property schema. |
| Save the scene    | Top action bar → Save                   | Downloads a JSON file with thumbnail, script, and assets bundled. |
| Load a scene      | Top action bar → Load                   | Validates the envelope; replaces the live scene; arms Revert. |
| Revert            | Top action bar → Revert                 | Disabled until something has been loaded. |
| Undo              | Top action bar → History                | Last 20 snapshots; click any row to restore. |
| Edit the script   | Top action bar → Edit Script            | Monaco editor; see [scripting.md](./scripting.md). |
| Manage assets     | Top action bar → Asset Manager          | Custom tab is editable; remember to **Push to peers**. |
| Reveal zones      | Top action bar → Show All Zones         | Render every Zone as a tinted volume. |
| Reveal snap points| Top action bar → Show Snap Points       | Show every snap disc; makes Snap Markers grabbable. Host-only. |
| Generate a deck   | Top action bar → Generate Deck          | Turn a spritesheet into a `Deck` of `Card`s in one click. |
| Add a snap anchor | Editor inspector → Add Snap Markers     | Attaches `SnapPoints` to the selected entity. Standalone anchors come from spawning a `Snap Marker`. |
| Kick / ban a peer | Top-right players panel → right-click   | Bans persist for the room's lifetime. |
