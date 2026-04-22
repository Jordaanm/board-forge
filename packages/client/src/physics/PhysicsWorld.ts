import * as CANNON from 'cannon-es';
import { TABLE_SURFACE_Y, TABLE_WIDTH, TABLE_DEPTH, TABLE_THICKNESS } from '../scene/Table';

export class PhysicsWorld {
  readonly world: CANNON.World;

  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });

    const tableBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(TABLE_WIDTH / 2, TABLE_THICKNESS / 2, TABLE_DEPTH / 2)),
      position: new CANNON.Vec3(0, TABLE_SURFACE_Y - TABLE_THICKNESS / 2, 0),
    });
    this.world.addBody(tableBody);
  }

  addBody(body: CANNON.Body) {
    this.world.addBody(body);
  }

  step(dt: number) {
    this.world.step(1 / 60, dt, 3);
  }
}
