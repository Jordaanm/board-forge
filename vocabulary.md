This document describes the vocabulary used in the codebase.

## Terms

### Room
A room relates to the current game session. The Host creates a Room, and Guests join it. The Host and the Guests are both Players in the Room.
A room contains a Game, and has connected players.

### Game
The Game describes what is being played in the Room. Abstractly, a Game has pieces, and rules.
In a practical sense, a Game has a Scene populated with Entities, and a set of behaviours defined by a script that describes rules and automations for the game.

When the Host saves or loads, they are saving the Game, not the Room.
Thus, a collection of save files is equivalent to a library of Games.

### Scene
The Scene is a physics sandbox, in which the pieces of the Game are placed.
The Scene is populated with Entities, which represent game pieces such as dice, cards, tokens, etc.

### Entity
An Entity is a object in the Scene, and typically represents a game piece such as a die, a card, a token, etc.
Entities have a set of common properties and behaviours, with additional properties and behaviours able to be added via EntityComponents.
Each entity has a unique GUID, which is used to identify it in the Scene.

### EntityComponent
An EntityComponent is a piece of behaviour that is attached to an Entity.
Entity Components are designed to be modular, each one managing a specific domain. This allows an Entity to compose itself from a set of reusable behaviours.

### Table
The Table is the root entity in the Scene Graph, and has some special properties.
It is the root of the scene graph, and all other entities are children of it.
It can never be moved, and is always at the origin of the Scene.
Generally speaking, all settings that affect the overall appearance of the virtual room are properties of the Table.
This includes the Table's 3d appearance and hitbox, the lighting of the room, and the skydome settings.
The table can never be selected or deleted.

Since the table is reliably present as the root of the scene graph, it is the most common place to attach data or behaviours that are general to the game, such as the current round, the current player, etc.

### Seat
A designated position at the table assigned to a Player; determines turn order;
When a piece belongs to a player in the game, it belongs to the Seat, not the Peer; That is, if a player changes seats, they don't bring their pieces with them.
### Script

The 'Script' is the term used for custom behaviours that are defined for a Game. The Script is actually a compiled Typescript class, which is then instantiated and run by the host.

### Peer

Someone who has joined a room. Generally spoken of in terms of being a network connected peer, rather than in reference to anything to do with gameplay
A peer who has a seat at the table is a Player. A peer who is not seated at the table is a Spectator.

### Spectator

A spectator is a connected peer who is not seated at the table. They cannot directly interact with the game, but they can observe it.

### Player

A player is a participant in the game. Each player is seated at a seat.
The host also counts as a player.

### Host

The host is the peer in control of the room. They set up the game, either by manually adding pieces and writing a script, or by loading a saved game that already contains them.
The host is the only player in the room who can change the game state, such as adding or removing entities, or changing the script.

### Guest

A guest is a player who is not the host. A spectator doesn't count as a guest, as they are not a player in the game.

### Tool

A tool is a mechanism that allows the player to interact with the scene.
Examples include the grab/drag tool, the flick tool, and the ping tool

## Language Examples

The room contains the game, and the players.
Players join the room.
The host joins the room and sets up a game.
The game has a scene, and a script.
The scene contains entities.
The entities have components.

