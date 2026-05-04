import * as CANNON from 'cannon-es';
import { TABLE_SURFACE_Y, TABLE_WIDTH, TABLE_DEPTH, TABLE_THICKNESS, type TableShape } from '../scene/Table';

// cannon-es has no CCD, so tunneling is bounded purely by step size.
// 1/240s × FLICK_MAX_MAGNITUDE (30 m/s) = 0.125m max travel per step,
// safely under the smallest collidable (token radius 0.5, height 0.15).
const FIXED_STEP    = 1 / 240;
const MAX_SUB_STEPS = 16;

function buildTableShape(shape: TableShape): CANNON.Shape {
  if (shape === 'circle') {
    const radius = Math.min(TABLE_WIDTH, TABLE_DEPTH) / 2;
    return new CANNON.Cylinder(radius, radius, TABLE_THICKNESS, 64);
  }
  return new CANNON.Box(new CANNON.Vec3(TABLE_WIDTH / 2, TABLE_THICKNESS / 2, TABLE_DEPTH / 2));
}

export class PhysicsWorld {
  readonly world: CANNON.World;
  private readonly tableBody: CANNON.Body;

  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });

    this.tableBody = new CANNON.Body({
      mass: 0,
      shape: buildTableShape('rectangle'),
      position: new CANNON.Vec3(0, TABLE_SURFACE_Y - TABLE_THICKNESS / 2, 0),
    });
    this.world.addBody(this.tableBody);
  }

  setTableShape(shape: TableShape) {
    const old = this.tableBody.shapes[0];
    if (old) this.tableBody.removeShape(old);
    this.tableBody.addShape(buildTableShape(shape));
    this.tableBody.updateBoundingRadius();
    this.tableBody.updateMassProperties();
    this.tableBody.aabbNeedsUpdate = true;
  }

  addBody(body: CANNON.Body) {
    this.world.addBody(body);
  }

  step(dt: number) {
    this.world.step(FIXED_STEP, dt, MAX_SUB_STEPS);
  }
}
