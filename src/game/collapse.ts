// The big finish: once every m-block is out, the tower comes down for real (cannon-es rigid bodies), "와르르".
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type { Stage } from './stage';
import { TABLE_R } from './stage';
import { L, H, D, type Tower } from './tower';

export function collapse(stage: Stage, tower: Tower, seconds = 4.2): Promise<void> {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -26, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.32;
  world.defaultContactMaterial.restitution = 0.14;
  (world.solver as CANNON.GSSolver).iterations = 14;

  const table = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(TABLE_R, TABLE_R, 0.5, 32) });
  table.position.set(0, -0.27, 0);
  world.addBody(table);
  const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0); floor.position.set(0, -10, 0);
  world.addBody(floor);

  // straighten the tower (it may still be swaying) and hand every remaining block to the physics world
  tower.root.rotation.set(0, 0, 0); tower.root.updateMatrixWorld(true);
  const cam = stage.camera.position.clone().setY(0).normalize();
  const right = new THREE.Vector3(cam.z, 0, -cam.x);            // fall sideways across the view: easy to watch
  const pairs: [THREE.Mesh, CANNON.Body][] = [];
  for (const b of tower.inTower()) {
    const p = b.mesh.getWorldPosition(new THREE.Vector3()), q = b.mesh.getWorldQuaternion(new THREE.Quaternion());
    stage.world.attach(b.mesh);
    const body = new CANNON.Body({ mass: 1, shape: new CANNON.Box(new CANNON.Vec3(L / 2 - 0.01, H / 2 - 0.012, D / 2 - 0.02)) });
    body.position.set(p.x, p.y, p.z); body.quaternion.set(q.x, q.y, q.z, q.w);
    body.linearDamping = 0.04; body.angularDamping = 0.08;
    body.sleepSpeedLimit = 0.2;
    world.addBody(body);
    pairs.push([b.mesh, body]);
    b.state = 'gone';
  }
  // the push: the upper part leans over, everything above ~1/3 gets a shove that grows with height
  const side = Math.random() < 0.5 ? 1 : -1;
  for (const [, body] of pairs) {
    const y = body.position.y;
    if (y > 3) {
      const k = (y - 3) / 8;
      body.velocity.set(right.x * side * k * 5.5 + (Math.random() - 0.5) * 0.6, 0.4 * k, right.z * side * k * 5.5 + (Math.random() - 0.5) * 0.6);
      body.angularVelocity.set((Math.random() - 0.5) * 2.5 * k, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 2.5 * k);
    }
  }
  return new Promise((res) => {
    let t = 0;
    const off = stage.tick((dt) => {
      world.step(1 / 120, dt, 8);
      for (const [m, body] of pairs) {
        m.position.set(body.position.x, body.position.y, body.position.z);
        m.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      }
      t += dt;
      if (t >= seconds) { off(); res(); }
    });
  });
}
