// Marker base class scripts extend. Hooks default to no-op so authors who
// only override one of them don't need to stub the others. Constructed once
// per Run. Real `scene` typing lands in #4; for #1 the hook receives whatever
// the Compartment's `scene` global currently is.

export class Game {
  onSceneInitialised(_scene: unknown): void {}
  onScriptLoaded(_scene: unknown): void {}
}
