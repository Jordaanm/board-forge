// ToolDispatcher — issue 2a of issues--tools.md.
//
// Owns pointer-event listeners on the canvas, raycasting, NDC math, and
// pointer capture, and routes left-click events to the active tool. Right-
// click stays with ContextMenuController; middle / wheel stay with the
// camera controller. Enforces "reject tool switch during active gesture" and
// "Escape cancels active gesture".

import * as THREE from 'three';
import { type World } from '../../entity/world';
import { type SeatIndex } from '../../seats/SeatLayout';
import { type Tool, type ToolContext, type ToolPointerEvent } from './types';

export interface ToolDispatcherDeps {
  world:       World;
  scene:       THREE.Scene;
  camera:      THREE.PerspectiveCamera;
  element:     HTMLElement;
  getSelfSeat: () => SeatIndex | null;
  // Where the Escape-key listener is registered. Defaults to `window`. Tests
  // override with a stub EventTarget so they don't require a DOM environment.
  keyTarget?:  EventTarget;
}

export class ToolDispatcher {
  private active: Tool | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc       = new THREE.Vector2();
  private readonly ctx:       ToolContext;

  private readonly keyTarget: EventTarget;

  constructor(private readonly deps: ToolDispatcherDeps) {
    this.ctx = {
      world:       deps.world,
      scene:       deps.scene,
      camera:      deps.camera,
      element:     deps.element,
      raycaster:   this.raycaster,
      getSelfSeat: deps.getSelfSeat,
    };
    this.keyTarget = deps.keyTarget ?? (typeof window !== 'undefined' ? window : globalThis);
    deps.element.addEventListener('pointerdown', this.onDown as unknown as EventListener);
    deps.element.addEventListener('pointermove', this.onMove as unknown as EventListener);
    deps.element.addEventListener('pointerup',   this.onUp as unknown as EventListener);
    this.keyTarget.addEventListener('keydown', this.onKeyDown as unknown as EventListener);
  }

  dispose(): void {
    if (this.active?.onDeactivate) this.active.onDeactivate(this.ctx);
    this.active = null;
    this.deps.element.removeEventListener('pointerdown', this.onDown as unknown as EventListener);
    this.deps.element.removeEventListener('pointermove', this.onMove as unknown as EventListener);
    this.deps.element.removeEventListener('pointerup',   this.onUp as unknown as EventListener);
    this.keyTarget.removeEventListener('keydown', this.onKeyDown as unknown as EventListener);
  }

  getActive(): Tool | null {
    return this.active;
  }

  getContext(): ToolContext {
    return this.ctx;
  }

  // Returns true if the switch took effect. Silently rejected if the current
  // tool has an active gesture.
  setActiveTool(tool: Tool | null): boolean {
    if (this.active === tool) return true;
    if (this.active && this.active.hasActiveGesture()) return false;
    if (this.active?.onDeactivate) this.active.onDeactivate(this.ctx);
    this.active = tool;
    if (this.active?.onActivate) this.active.onActivate(this.ctx);
    return true;
  }

  // Per-frame tick: forwards to the active tool's update hook.
  update(dt: number): void {
    this.active?.update?.(dt, this.ctx);
  }

  private buildEvent(e: PointerEventLike): ToolPointerEvent {
    const rect = this.deps.element.getBoundingClientRect();
    this.ndc.set(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.deps.camera);
    return {
      pointerId: e.pointerId,
      button:    e.button,
      clientX:   e.clientX,
      clientY:   e.clientY,
      ndc:       this.ndc.clone(),
      ray:       this.raycaster.ray.clone(),
      timestamp: performance.now(),
      shiftKey:  e.shiftKey,
      ctrlKey:   e.ctrlKey,
      altKey:    e.altKey,
    };
  }

  private onDown = (e: PointerEventLike) => {
    if (e.button !== 0) return;          // tools own left-click only
    if (!this.active?.onPress) return;
    this.active.onPress(this.buildEvent(e), this.ctx);
  };

  private onMove = (e: PointerEventLike) => {
    if (!this.active?.onMove) return;
    this.active.onMove(this.buildEvent(e), this.ctx);
  };

  private onUp = (e: PointerEventLike) => {
    if (e.button !== 0) return;
    if (!this.active?.onRelease) return;
    this.active.onRelease(this.buildEvent(e), this.ctx);
  };

  private onKeyDown = (e: { key: string }) => {
    if (e.key !== 'Escape') return;
    if (!this.active?.hasActiveGesture()) return;
    this.active.onCancel?.(this.ctx);
  };
}

// Minimal subset of PointerEvent the dispatcher actually reads. Lets unit
// tests fake events without a DOM environment.
interface PointerEventLike {
  pointerId: number;
  button:    number;
  clientX:   number;
  clientY:   number;
  shiftKey:  boolean;
  ctrlKey:   boolean;
  altKey:    boolean;
}
