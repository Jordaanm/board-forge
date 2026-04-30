## TODO

### Context menu cleanup (post-PRD-2)
* Remove the transitional `__delete` / `__roll` host-local built-ins from `ContextMenuController.ts`.
* Once PRD-2 ships a Die component, migrate Roll onto it via `onContextMenu` + `onAction`.
* Decide whether Delete becomes a base-class action on every entity or moves into the editor panel UX. Either way, drop the special-cased ids in `dispatchMenuAction`.

### NEW LIST

* Tracking player cursors
  * Show a cursor for each peer. If that peer occupies a seat, decorate the cursor with that seat's colour
  * When a player is dragging an object around, the cursor should change to show they are holding something
    * Eg, default cursor is an open hand, but if they are holding an object, change it to a grabbing fist.

### Tags

* Each object should have a "tags" property, which is a list of strings. Tags are used to group objects together, filter them, and search for them.
  * Tags should be unique, and should be case-insensitive.
  * Tags shoudl be editable in the UI.

### Add Card object type
* Cards have a "category" property, which is a string.
* Cards have a "face" and "back" property, which reference images to be used as the card's front and back faces.
* Cards have a "value" property, which is a string.


### Hands
* Hands are a zone type that can hold any number of objects, of any type.
* Each hand has a "Main Hand" property which references a player. A player can only have 1 Main Hand at a time. If another zone is set as the Main Hand, the previous Main Hand will be removed.
* The contents of the main hand are displayed in a floating panel along the bottom of the UI, and can be interacted with.
* This feature is the same as it is in Tabletop Simulator

### Add containers

* Container types objects are able to hold other objects.
  * Containers can be nested.
  * Containers have a "filter" property, which is a list of tags. Only objects with all of the tags in the filter can be added to the container.

* Containers act as the parent of all objects they contain in the scene graph

* Bags are a container type that can hold any number of objects, of any type
  * Bags have a "capacity" property, which is the maximum number of objects that can be added to the bag.
    * If the bag is full, adding a new object will fail.
    * If the "capacity" property is set to 0, the bag can hold an unlimited number of objects.
  * Dropping an object onto a bag will add it to the bag.
    * If a player is holding/dragging that object, it will be forcibly dropped
  * "Draw next item" action will remove an object from the bag and place it in the scene, being controlled/dragged by the player that used the action.

* Decks are a container type that hold cards.
  * When 2 cards of the same category are dropped onto one another, they will spontaenously form a deck, to which both cards will be added.
  * When a card is dropped onto a deck, it will be added to the deck.
  * Decks have a "shuffle" action that randomises the order of the cards in the deck.
  * Decks have a "Draw X Cards" action that will draw X cards from the deck and place them in the hand of the player that used the action.
  * Decks have a "Deal X Cards" action that will deal X cards from the deck to each player in the scene.
    * Cards will be dealt one at a time, in case there aren't enough cards in the deck.
