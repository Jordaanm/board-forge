## TODO

### Refactors
* The root entity in a Scene is special, and it should be treated differently from other entities.
  * It should still be an entity in the scene graph, but it should not be rendered.
  * It instead carries all of the properties for the game/room, such as the Table, Lighting, Skydome, etc. Its also the root object that the script interacts with.
  * Since it is an entity, it has customData, which is typically where Game-level state is stored, such as the current round, etc.

### Major Features
* Turn order management / current turn
* Multiselect
* Magnets (sticking points on the surface of an entity)
* PDF Viewer
* Scriptable UI
* New Spawnable Entities:
  * PDF Viewer
  * Note (renders text to a rect)
  * D4, D8, D10, D12, D20


### Minor Features
* Drag to resize Zone/Hand
* HiddenInfo Zone
* Selecting an item in the scene highlights it in the scene graph panel.
* Double clicking an item in the scene graph panel selects it in the scene.
* Bag container entity

### Bugs

### Cleanup
* Remove the transitional `__delete` host-local built-in from `ContextMenuController.ts`.
* Decide whether Delete becomes a base-class action on every entity or moves into the editor panel UX. Either way, drop the special-cased id in `dispatchMenuAction`.