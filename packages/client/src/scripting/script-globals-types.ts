// Canonical editor-facing scripting API. Single source of truth for what
// user scripts can call. Two consumers:
//
//   1. The codegen at packages/client/scripts/gen-script-globals.ts walks
//      this file's exported classes and emits script-globals.dts — a text
//      artifact (deliberately *not* .d.ts to avoid TypeScript ambient
//      pollution under tsconfig include) that Monaco loads via
//      addExtraLib for autocomplete and inline diagnostics.
//
//   2. The drift test at script-globals.test.ts asserts the runtime classes
//      (Game, SceneFacade, EntityFacade) are structurally assignable to
//      the Editor* types declared here. If a contributor adds a method to
//      the runtime without updating this file, `tsc --noEmit` fails.
//
// Constraints:
//   - Use `class` (not `interface`) so the codegen can emit `declare class`
//     directly without inventing constructors. Method bodies are no-op
//     stubs; the bodies are stripped by the codegen.
//   - Names are prefixed `Editor*` so they don't collide with the runtime
//     classes when the drift test imports both.
//   - Keep the surface MINIMAL — only what scripts need to call. Internal
//     types (Entity, EntityScene, ScriptRunContext) stay private.

export interface EditorReadOnlyComponentView {
  readonly state: Readonly<Record<string, unknown>>;
}

export type EditorListener = (payload: unknown) => void;

// Mirrors the runtime SeatIndex shape (number, narrowed by host code).
export type EditorSeatIndex = number;

export type EditorAssetType = 'image' | 'model' | 'sound';

export interface EditorAssetEntry {
  readonly slug:         string;
  readonly name:         string;
  readonly type:         EditorAssetType;
  readonly url:          string;
  readonly preload:      boolean;
  readonly description?: string;
  readonly tags?:        readonly string[];
}

export class EditorAssetsApi {
  get(slug: string): EditorAssetEntry | null { void slug; return null; }
  list(opts?: { type?: EditorAssetType }): ReadonlyArray<EditorAssetEntry> { void opts; return []; }
}

export class EditorEntityFacade {
  declare readonly id:    string;
  declare readonly type:  string;
  declare readonly name:  string;
  declare readonly owner: EditorSeatIndex | null;
  declare readonly tags:  string[];

  getComponent(typeId: string): EditorReadOnlyComponentView | undefined { void typeId; return undefined; }
  addEventListener(event: string, cb: EditorListener): void { void event; void cb; }
  removeEventListener(event: string, cb: EditorListener): void { void event; void cb; }
  setValue(value: string): void { void value; }
  setData(key: string, value: string): void { void key; void value; }
  getData(key: string): string | undefined { void key; return undefined; }
  deleteData(key: string): boolean { void key; return false; }
}

export class EditorSceneFacade {
  declare readonly assets: EditorAssetsApi;
  getObjectById(id: string): EditorEntityFacade | undefined { void id; return undefined; }
  getObjectsByTag(tag: string): EditorEntityFacade[] { void tag; return []; }
  playSound(slug: string): void { void slug; }
}

export class EditorGame {
  onSceneInitialised(scene: EditorSceneFacade): void { void scene; }
  onScriptLoaded(scene: EditorSceneFacade): void { void scene; }
}
