// "You can turn the tower" (user: replace the cut-off arc with a clearer sign): a ring of two big arrows lies on the
// table around the tower's foot and turns slowly — the tower hides its back half, so it reads as going AROUND the
// tower — while Halli Galli's hand (#swipe, CSS) drags along the ring's front edge in the same direction. Dragging to
// the right turns the view the way the arrows run (stage.ts: dx > 0 → az decreases), like the tutor's demo turn.
import * as THREE from 'three';
import type { Stage } from './stage';

const R = 2.75;          // ring radius (world units): the tower's corners reach 2.12, the table ≥ 4
const SPIN = 0.8;        // rad/s: the ring's front runs to the right

export class SpinHint {
  private group = new THREE.Group();
  private mat: THREE.MeshBasicMaterial;
  private on = false;
  private a = 0;
  private t = 0;

  constructor(private stage: Stage, private el: HTMLElement) {
    const S = R * 2.3;
    this.mat = new THREE.MeshBasicMaterial({ map: ringTexture(R / (S / 2)), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(S, S), this.mat);
    m.rotation.x = -Math.PI / 2; m.position.y = 0.02; m.renderOrder = 3;
    this.group.add(m);
    this.group.visible = false;
    stage.world.add(this.group);
    stage.tick((dt) => this.update(dt));
  }

  show(on: boolean) { this.on = on; if (on) this.group.visible = true; }

  private update(dt: number) {
    if (!this.group.visible) return;
    this.t += dt;
    this.a += ((this.on ? 1 : 0) - this.a) * Math.min(1, dt * 6);
    this.mat.opacity = this.a * (0.85 + 0.15 * Math.sin(this.t * 5));
    // three.js rotation.y: a point at canvas angle φ moves to φ − θ, so the ring's front (nearest the camera) runs right
    this.group.rotation.y += dt * SPIN;
    if (!this.on && this.a < 0.02) { this.group.visible = false; this.a = 0; return; }
    const az = this.stage.rig.az;
    const p = this.stage.project(new THREE.Vector3(R * Math.sin(az), 0.02, R * Math.cos(az)));
    this.el.style.setProperty('--hx', `${p.x.toFixed(1)}px`);
    this.el.style.setProperty('--hy', `${p.y.toFixed(1)}px`);
  }
}

/** two thick arcs with arrowheads on a transparent square, seen from above (canvas x = world x, canvas y = world z);
 *  rf = ring radius as a fraction of the half-size. The heads point the way the ring turns (canvas angle decreasing). */
function ringTexture(rf: number) {
  const N = 1024, c = N / 2, r = rf * c, band = N * 0.034;
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  const arcs: [number, number][] = [[160, 30], [340, 210]];           // from → to (degrees, the head at "to")
  const head = (to: number, w: number) => {
    const a = to * Math.PI / 180, tx = Math.sin(a), ty = -Math.cos(a);   // direction of travel at the head
    const bx = c + r * Math.cos(a), by = c + r * Math.sin(a), ox = Math.cos(a), oy = Math.sin(a);
    g.beginPath();
    g.moveTo(bx + ox * w, by + oy * w);
    g.lineTo(bx + tx * w * 1.25, by + ty * w * 1.25);
    g.lineTo(bx - ox * w, by - oy * w);
    g.closePath(); g.fill();
  };
  // white only (user: "보라색 선은 빼줘. 흰색 면으로만 해줘" — the purple edge + glow are gone)
  g.strokeStyle = g.fillStyle = '#ffffff'; g.lineWidth = band; g.lineCap = 'round';
  for (const [from, to] of arcs) {
    g.beginPath(); g.arc(c, c, r, to * Math.PI / 180 + 0.05, from * Math.PI / 180); g.stroke();
    head(to, band * 1.45);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
