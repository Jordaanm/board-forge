Scene is tree of Entities.

## Entities
An entity has the following core attributes:
* GUID: a unique identifier for the entity
* Type: a string that identifies the type of entity
* name: a human-readable name for the entity. This defaults to {type}-{GUID}.
* tags: A collection of strings that can be used to group entities together, filter them, and search for them.
* components: A collection of EntityComponents that define the entity's behaviour, properties, and available actions.
* owner: The TablePlayer (aka the Seat) that owns the entity. This is null for entities that are not owned by a player.


## EntityComponents
Entity components are modules that define the behaviour of an entity.

Components define their own properties, and can define their own actions.
Some EntityComponent properties and actions are accessible via scripting.
Some EntityComponent properties and actions are available via the UI, typically through the context menu.

The state of all EntityComponents is synchronized between all peers in the scene.

The following components are available:

* ValueComponent: defines the value of an entity, useful for things like Dice or Counters. Useful for sorting entities, or for gameplay features.
* TransformComponent: defines the position, rotation, and scale of an entity. 
  * Required for an entity to be visible in the scene.
* MeshComponent: defines the 3d model of an entity, including its textures and materials; also defined the hitbox for mouse interaction. 
  * Required for an entity to be visible in the scene.
  * Requires: TransformComponent
* 2DComponent: defines the 2d model of an entity, including its textures and materials. 
  * Required for an entity to be visible in a Hand.
* PhysicsComponent: defines the physical properties of an entity, such as its mass and friction. Almost every entity has one of these.
  * Requires: TransformComponent, MeshComponent
* ContainerComponent: defines the behaviour of an entity that can contain other entities, such as bags and decks.
  * Requires: TransformComponent, MeshComponent
* CardComponent: allows the entity to act as a card. Cards can be added to decks, and hands. Cards have a "face" and "back" texture, and a "value" property.
  * Requires: TransformComponent, MeshComponent, PhysicsComponent, 2DComponent
* ZoneComponent: a Zone is an entity that occupies a 3d space, affecting all other entities that enter/exit that space.
  * Requires: TransformComponent


## Spawning Objects

Each Entity that can be spawned is defined as a collection of EntityComponents and a default state. For example a "D6" spawnable defintion might be:
```
{
  label: "D6",
  type: "Dice",
  tags: ["dice"],
  components: [
    { type: "ValueComponent", props: { value: 6 }},
    { type: "TransformComponent", props: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } }},
    { type: "MeshComponent", props: { mesh: MeshReference, textures: [TextureReference], materials: [MaterialReference] }},
    { type: "PhysicsComponent", props: { mass: 1, friction: 0.5, restitution: 0.5 }},
    { type: "DiceComponent", props: { faces: 6 }},
  ],
}
```

Each component can define an "onSpawn" method, which is called when the entity as a whole is spawned. This is useful for initialising the component's state.
Components cannot be added to an entity or removed from an entity after it has been spawned.

## Context Menu

When an entity is right-clicked, a context menu is displayed.
The contents of this menu are aggregated from all EntityComponents on that entity.
The EntityComponent class defines an `onContextMenu` method, which is called when the context menu is displayed. Each EntityComponent subclass can override this method to add its own menu items.


## Save/Load

Saving and Loading the game involved serialising the entire scene graph to JSON, and deserialising it back into a new scene graph.
Each entity is thus required to be able to serialise its state and that of all its components.
Each entity component is required to implement a `toJSON` method, which returns a JSON object that represents the state of the component.
Any references to other entities are serialised as GUIDs.

Similarly, each entity is required to implement a `fromJSON` method, which deserialises the state of the entity from a JSON object.


## Synchronisation

There are two types of synchronisation: Delta Patches and Full Sync.
When synchronising delta patches, only the changed properties of an entity are sent. Each of these properties being sent also identify the component that property belongs to.
When synchronising full sync, the object is serialised to JSON, and sent to all peers.

Each component is responsible for ensuring that changes to its property are tracked by the scene graph, and that the changes are sent to all peers.
The easiest way to do this is to use encapsulation to make sure all mutations happen through a mutator method instead of directly on the property.


## Scripting

Scripting is a way to interact with the scene graph from a script, as a means of implemneting automation, utility, and other features.
The scene graph is exposed via an API, not unlike the DOM API for the web.
Entities can be queried via their GUID, or by their types/tags.

Components on entities can be accessed via the a `getComponent` method, which takes a component class identifier as a parameter.
For example, to get the value of a die, you would call `someEntity.getComponent(ValueComponent).value`.

