## TODO

### Major Features
* Scripting
* Multiselect
* Magnets (sticking points on the surface of an entity)
* PDF Viewer
* Scriptable UI

### Minor Features
* Drag to resize Zone/Hand
* HiddenInfo Zone
* Selecting an item in the scene highlights it in the scene graph panel.
* Double clicking an item in the scene graph panel selects it in the scene.
* Bag container entity

### Bugs
* Tint menu closes immediately when you click on it, making it difficult to properly pick a colour.


### Cleanup
* Remove the transitional `__delete` host-local built-in from `ContextMenuController.ts`.
* Decide whether Delete becomes a base-class action on every entity or moves into the editor panel UX. Either way, drop the special-cased id in `dispatchMenuAction`.