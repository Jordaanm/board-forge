import * as CANNON from 'cannon-es';

// cannon-es has no CCD, so tunneling is bounded purely by step size.
// 1/240s × FLICK_MAX_MAGNITUDE (30 m/s) = 0.125m max travel per step,
// safely under the smallest collidable (token radius 0.5, height 0.15).
const FIXED_STEP    = 1 / 240;
const MAX_SUB_STEPS = 16;

export class PhysicsWorld {
  readonly world: CANNON.World;

  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  }

  addBody(body: CANNON.Body) {
    this.world.addBody(body);
  }

  step(dt: number) {
    this.world.step(FIXED_STEP, dt, MAX_SUB_STEPS);
  }
}
