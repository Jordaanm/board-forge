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
- **Custom** — your room's own asset catalog. Add an image, model, or sound by URL; the modal probes the URL with a CORS preflight so you know up front whether it'll load.

Newly added assets default to `preload: true`, meaning the client will fetch them eagerly. The slug for each entry auto-suggests from the URL filename and is locked once the entry is committed.

The modal's footer shows the count of unpushed changes. Click **Push to peers** to broadcast the current published catalog to every connected guest. Until you push, custom-tab edits live only on the host.

### Show All Zones

A checkbox toggle. By default Zone entities are visible only when relevant (for example, while dragging a piece into one). Turning **Show All Zones** on renders every Zone in the scene as a tinted volume — handy for laying out a complex scene.

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
| Kick / ban a peer | Top-right players panel → right-click   | Bans persist for the room's lifetime. |
