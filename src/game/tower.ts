// The Jenga tower: 18 layers × 3 pastel blocks (Jenga proportions 7.5 : 1.5 : 2.5), each painted with its word on
// all four sides. 28 blocks carry an m-word. The m-blocks are placed so the tower can always stand once every one
// of them is pulled out (per layer: none, one side, the middle, or both sides — never "middle + a side"), so a
// correct pull never knocks it over; the big fall is saved for the end.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { animate, ease, shuffle } from './anim';
import type { Stage } from './stage';

export const L = 3, H = 0.6, D = 1;
export const LAYERS = 18;
const DG = 0.035, HG = 0.012;                // gaps between blocks / layers

export interface WordInfo { w: string; m: boolean; first: string; ko: string; alts?: string[]; rivals?: string[] }
export interface Pastel { name: string; base: string; ink: string; light: string; edge: string }
export interface Block {
  id: number; word: WordInfo; layer: number; slot: number; color: Pastel; axis: 'x' | 'z';
  mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; outline: THREE.Mesh;
  state: 'in' | 'busy' | 'out' | 'gone';
  home: THREE.Vector3; homeRotY: number;
}

export const PASTELS: Pastel[] = [
  { name: 'pink', base: '#f7afc3', ink: '#a8365f', light: '#ffd6e2', edge: '#e893ad' },
  { name: 'butter', base: '#f8dc80', ink: '#86600a', light: '#fff0bd', edge: '#e5c35d' },
  { name: 'mint', base: '#a8e2c4', ink: '#1f7650', light: '#d6f4e4', edge: '#86cfa8' },
  { name: 'sky', base: '#aad5f2', ink: '#1f5f94', light: '#d7ecfb', edge: '#87bee6' },
  { name: 'lavender', base: '#cab9f2', ink: '#5539a3', light: '#e7defb', edge: '#ad99e6' },
  { name: 'peach', base: '#ffc8a7', ink: '#a2511f', light: '#ffe3d1', edge: '#f1ab82' },
];

// texture atlas: one canvas per block. LONG = the two long faces, END = the two end faces, PLAIN = top/bottom.
const AW = 1024, AH = 128;
const LONG = { x: 0, w: 640 }, END = { x: 648, w: 213 }, PLAIN = { x: 870, w: 154 };

let sharedGeo: RoundedBoxGeometry | null = null;
export function blockGeometry() {
  if (sharedGeo) return sharedGeo;
  const g = new RoundedBoxGeometry(L, H - HG, D - DG, 3, 0.075);
  const pos = g.attributes.position, uv = g.attributes.uv;
  const h = H - HG, d = D - DG;
  const c01 = (v: number) => Math.min(1, Math.max(0, v));
  for (const grp of g.groups) {
    for (let i = grp.start; i < grp.start + grp.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      let u = 0, v = (y + h / 2) / h, r = LONG;
      switch (grp.materialIndex) {
        case 0: u = (-z + d / 2) / d; r = END; break;           // +x end (seen from +x, right = -z)
        case 1: u = (z + d / 2) / d; r = END; break;            // -x end
        case 2: u = (x + L / 2) / L; v = (z + d / 2) / d; r = PLAIN; break;
        case 3: u = (x + L / 2) / L; v = (-z + d / 2) / d; r = PLAIN; break;
        case 4: u = (x + L / 2) / L; r = LONG; break;           // +z long face (right = +x)
        case 5: u = (-x + L / 2) / L; r = LONG; break;          // -z long face
      }
      uv.setXY(i, (r.x + c01(u) * r.w) / AW, c01(v));
    }
  }
  g.clearGroups(); // one material for the whole block
  uv.needsUpdate = true;
  sharedGeo = g;
  return g;
}

/** paint a block's atlas; k = resolution multiplier (2 for the big presented block) */
export function paintBlock(word: string, p: Pastel, k = 1): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = AW * k; cv.height = AH * k;
  const g = cv.getContext('2d')!;
  g.scale(k, k);
  g.fillStyle = p.base; g.fillRect(0, 0, AW, AH);
  // painted-wood grain along the block
  let seed = 0; for (const ch of word + p.name) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 26; i++) {
    const y = rnd() * AH, a = 0.035 + rnd() * 0.05;
    g.strokeStyle = `rgba(120, 80, 60, ${a})`; g.lineWidth = 0.6 + rnd() * 1.6;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= AW; x += 64) g.lineTo(x, y + Math.sin(x * 0.01 + i) * (1 + rnd() * 2.2));
    g.stroke();
  }
  // soft light band at the top, shade at the bottom of each face (a painted bevel)
  const sh = g.createLinearGradient(0, 0, 0, AH);
  sh.addColorStop(0, 'rgba(255,255,255,0.20)'); sh.addColorStop(0.18, 'rgba(255,255,255,0)'); sh.addColorStop(0.82, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(90,50,40,0.10)');
  g.fillStyle = sh; g.fillRect(0, 0, PLAIN.x, AH);
  const text = (x: number, w: number, pad: number, max: number) => {
    let size = max;
    g.font = `700 ${size}px ECP, Baloo, sans-serif`;
    const mw = g.measureText(word).width;
    if (mw > w - pad * 2) size = Math.max(18, size * (w - pad * 2) / mw);
    g.font = `700 ${size}px ECP, Baloo, sans-serif`;
    const m = g.measureText(word);
    const asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
    // centre the x-height band (not the ink box) so words with and without ascenders sit on one line
    const xh = size * 0.53;
    const by = AH / 2 + xh / 2 + (desc > size * 0.12 && asc < size * 0.62 ? -size * 0.06 : 0);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const cx = x + w / 2;
    g.fillStyle = p.light; g.globalAlpha = 0.9; g.fillText(word, cx, by + size * 0.035);
    g.globalAlpha = 1; g.fillStyle = p.ink; g.fillText(word, cx, by);
  };
  text(LONG.x, LONG.w, 36, 78);
  text(END.x, END.w, 10, 64);
  return cv;
}

function makeTexture(cv: HTMLCanvasElement, aniso: number) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Which slots in each layer hold m-words (stability by construction). */
export function planLayers(mCount: number, r: () => number): number[][] {
  const kMin = Math.max(0, mCount - LAYERS), kMax = Math.min(LAYERS, Math.floor(mCount / 2));
  const both = Math.min(kMax, kMin + Math.floor(r() * 3));            // layers whose two side blocks are m-words
  const single = mCount - both * 2;                                     // layers with one m-word
  const types: ('both' | 'one' | 'none')[] = [];
  for (let i = 0; i < both; i++) types.push('both');
  for (let i = 0; i < single; i++) types.push('one');
  while (types.length < LAYERS) types.push('none');
  shuffle(types, r);
  return types.map((t) => t === 'both' ? [0, 2] : t === 'one' ? [r() < 0.4 ? 1 : r() < 0.5 ? 0 : 2] : []);
}

/** a stand-alone layer can stand: middle present, or both sides present */
export const layerStable = (present: boolean[]) => present[1] || (present[0] && present[2]);

export class Tower {
  readonly root = new THREE.Group();
  blocks: Block[] = [];
  private ray = new THREE.Raycaster();
  private sway = { ax: 0, az: 0, vx: 0, vz: 0 };
  private hovered: Block | null = null;
  private aniso: number;

  constructor(private stage: Stage) {
    stage.world.add(this.root);
    this.aniso = Math.min(8, stage.renderer.capabilities.getMaxAnisotropy());
    stage.tick((dt, t) => this.update(dt, t));
  }

  build(words: WordInfo[], r: () => number) {
    this.clear();
    const ms = shuffle(words.filter((w) => w.m), r), others = shuffle(words.filter((w) => !w.m), r);
    const plan = planLayers(ms.length, r);
    const geo = blockGeometry();
    let id = 0;
    for (let layer = 0; layer < LAYERS; layer++) {
      const used = new Set<string>();
      for (let slot = 0; slot < 3; slot++) {
        const word = plan[layer].includes(slot) ? ms.pop()! : others.pop()!;
        const choices = PASTELS.filter((p) => !used.has(p.name));
        const color = choices[Math.floor(r() * choices.length)]; used.add(color.name);
        const mat = new THREE.MeshStandardMaterial({ map: makeTexture(paintBlock(word.w, color), this.aniso), roughness: 0.58, metalness: 0, envMapIntensity: 0.55 });
        mat.emissive = new THREE.Color(0xffffff); mat.emissiveIntensity = 0;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true; mesh.receiveShadow = true;
        const axis: 'x' | 'z' = layer % 2 === 0 ? 'x' : 'z';
        const off = (slot - 1) * D, y = H / 2 + layer * H;
        const jitter = (r() - 0.5) * 0.05, rotJ = (r() - 0.5) * 0.012;
        const home = axis === 'x' ? new THREE.Vector3(jitter, y, off) : new THREE.Vector3(off, y, jitter);
        const homeRotY = (axis === 'x' ? 0 : Math.PI / 2) + rotJ + (r() < 0.5 ? 0 : Math.PI);   // either way round
        mesh.position.copy(home); mesh.rotation.y = homeRotY;
        const outline = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x8ff0ff, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false }));
        outline.scale.set(1 + 0.11 / L, 1 + 0.11 / H, 1 + 0.11 / D); outline.visible = false; outline.renderOrder = 2;
        mesh.add(outline);
        const b: Block = { id: id++, word, layer, slot, color, axis, mesh, mat, outline, state: 'in', home, homeRotY };
        mesh.userData.block = b;
        this.root.add(mesh);
        this.blocks.push(b);
      }
    }
  }

  clear() {
    for (const b of this.blocks) { b.mesh.removeFromParent(); b.mat.map?.dispose(); b.mat.dispose(); (b.outline.material as THREE.Material).dispose(); }
    this.blocks = [];
    this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0);
    this.sway = { ax: 0, az: 0, vx: 0, vz: 0 };
  }

  inTower() { return this.blocks.filter((b) => b.state === 'in'); }
  mLeft() { return this.blocks.filter((b) => b.word.m && b.state === 'in').length; }
  byWord(w: string) { return this.blocks.find((b) => b.word.w === w); }

  pick(ndc: THREE.Vector2): Block | null {
    this.ray.setFromCamera(ndc, this.stage.camera);
    const hits = this.ray.intersectObjects(this.inTower().map((b) => b.mesh), false);
    return hits.length ? (hits[0].object.userData.block as Block) : null;
  }

  hover(b: Block | null) {
    if (this.hovered === b) return;
    if (this.hovered && this.hovered.state === 'in') this.hovered.mat.emissiveIntensity = 0;
    this.hovered = b;
    if (b) b.mat.emissiveIntensity = 0.09;
  }

  /** is this block's centre visible from the camera (not hidden behind other blocks)? */
  visible(b: Block) {
    const c = b.mesh.getWorldPosition(new THREE.Vector3());
    const cam = this.stage.camera.position;
    this.ray.set(cam, c.clone().sub(cam).normalize());
    const hit = this.ray.intersectObjects(this.inTower().map((x) => x.mesh), false)[0];
    return !!hit && hit.object === b.mesh;
  }

  /** screen box (CSS px) of one layer of the tower: for placing bubbles beside it */
  layerScreenBox(layer: number) {
    const y = H / 2 + layer * H;
    let x0 = Infinity, x1 = -Infinity, ys = 0;
    for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]]) {
      const p = this.stage.project(this.root.localToWorld(new THREE.Vector3(x, y, z)));
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); ys += p.y / 4;
    }
    return { x0, x1, y: ys };
  }

  /** the pull direction (+1/-1 along the block's long axis) that comes out toward the camera */
  private towardCamera(b: Block) {
    const axis = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), b.homeRotY);
    const wp = b.mesh.getWorldPosition(new THREE.Vector3());
    const s = Math.sign(axis.dot(this.stage.camera.position.clone().sub(wp))) || 1;
    return axis.multiplyScalar(s);
  }

  private glow(b: Block, on: boolean, color = 0x8ff0ff) {
    const m = b.outline.material as THREE.MeshBasicMaterial;
    m.color.setHex(color);
    b.outline.visible = on; m.opacity = on ? 0.9 : 0;
  }

  /** Correct block: slides all the way out toward the viewer (0.9 s). */
  async pullOut(b: Block) {
    b.state = 'busy';
    this.hover(null);
    this.glow(b, true);
    const dir = this.towardCamera(b);
    const local = this.root.worldToLocal(b.mesh.getWorldPosition(new THREE.Vector3()).add(dir)).sub(this.root.worldToLocal(b.mesh.getWorldPosition(new THREE.Vector3())));
    const from = b.mesh.position.clone();
    const side = new THREE.Vector3(-local.z, 0, local.x);
    this.kick(dir, 0.010);
    await animate(this.stage, 0.95, (k, t) => {
      const jit = Math.sin(t * 46) * 0.012 * (1 - k);
      b.mesh.position.copy(from).addScaledVector(local, k * (L + 0.35)).addScaledVector(side, jit);
      b.mesh.rotation.y = b.homeRotY + Math.sin(t * 31) * 0.012 * (1 - k);
      b.mat.emissiveIntensity = 0.12 + 0.08 * Math.sin(t * 9);
    }, ease.inOut);
    b.state = 'out';
  }

  /** Wrong block: it sticks — comes out a little, shakes, slides back; the tower wobbles. */
  async stuck(b: Block) {
    b.state = 'busy';
    this.hover(null);
    this.glow(b, true, 0xff9aa8);
    const dir = this.towardCamera(b);
    const local = this.root.worldToLocal(b.mesh.getWorldPosition(new THREE.Vector3()).add(dir)).sub(this.root.worldToLocal(b.mesh.getWorldPosition(new THREE.Vector3())));
    const from = b.mesh.position.clone();
    const side = new THREE.Vector3(-local.z, 0, local.x);
    await animate(this.stage, 0.32, (k) => { b.mesh.position.copy(from).addScaledVector(local, k * 0.42); }, ease.out);
    this.kick(dir, 0.028);
    await animate(this.stage, 0.6, (k, t) => {
      const a = Math.sin(t * 38) * (1 - k);
      b.mesh.position.copy(from).addScaledVector(local, 0.42).addScaledVector(side, a * 0.05);
      b.mesh.rotation.y = b.homeRotY + a * 0.045;
    }, ease.linear);
    await animate(this.stage, 0.35, (k) => { b.mesh.position.copy(from).addScaledVector(local, 0.42 * (1 - k)); b.mesh.rotation.y = b.homeRotY; }, ease.inOut);
    b.mesh.position.copy(from);
    this.glow(b, false);
    b.mat.emissiveIntensity = 0;
    b.state = 'in';
  }

  /** where the pulled block floats while the child reads it: centre of the screen, a little above the middle */
  presentPose(screenY = 0.43) {
    const s = this.stage, cam = s.camera, { w, h } = s.size;
    const dist = 10;
    const vh = 2 * dist * Math.tan((cam.fov * Math.PI) / 360), vw = vh * cam.aspect;
    const len = Math.min(vw * (cam.aspect < 1 ? 0.78 : 0.4), vh * 0.75);
    const pos = s.unproject(w / 2, h * screenY, dist);
    return { pos, quat: cam.quaternion.clone(), scale: len / L };
  }

  /** Fly the pulled block in front of the camera, big, its long face (the word) toward the child. */
  async present(b: Block) {
    const scene = this.stage.scene;
    scene.attach(b.mesh);
    // crisper texture for the close-up
    const hi = makeTexture(paintBlock(b.word.w, b.color, 2), this.aniso);
    const lo = b.mat.map; b.mat.map = hi; b.mat.needsUpdate = true; lo?.dispose();
    b.mesh.castShadow = false;
    const p0 = b.mesh.position.clone(), q0 = b.mesh.quaternion.clone(), s0 = b.mesh.scale.x;
    const goal = this.presentPose();
    // the block's local +z (a long face) must face the camera: camera quaternion already does that
    const lift = new THREE.Vector3(0, 1.4, 0);
    await animate(this.stage, 0.8, (k) => {
      b.mesh.position.lerpVectors(p0, goal.pos, k).addScaledVector(lift, Math.sin(k * Math.PI) * 1);
      b.mesh.quaternion.slerpQuaternions(q0, goal.quat, k);
      b.mesh.scale.setScalar(s0 + (goal.scale - s0) * k);
      (b.outline.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
    }, ease.inOut);
    this.glow(b, false);
    b.mat.emissiveIntensity = 0.05;
    b.mesh.userData.presented = { pos: goal.pos.clone(), t0: performance.now() };
  }

  /** after a good read: shrink and fly to the player's card (screen px), then vanish */
  async flyTo(b: Block, x: number, y: number) {
    delete b.mesh.userData.presented;
    const p0 = b.mesh.position.clone(), s0 = b.mesh.scale.x, q0 = b.mesh.quaternion.clone();
    const target = this.stage.unproject(x, y, 9);
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (x < this.stage.size.w / 2 ? 1 : -1) * 0.5).premultiply(q0);
    await animate(this.stage, 0.7, (k) => {
      b.mesh.position.lerpVectors(p0, target, k).y += Math.sin(k * Math.PI) * 1.2;
      b.mesh.scale.setScalar(s0 * (1 - 0.86 * k));
      b.mesh.quaternion.slerpQuaternions(q0, spin, k);
    }, ease.in);
    b.mesh.visible = false;
    b.state = 'gone';
  }

  /** sparkle-glow a block for a hint */
  async hint(b: Block, ms = 2600) {
    const m = b.outline.material as THREE.MeshBasicMaterial;
    m.color.setHex(0xffe46b); b.outline.visible = true;
    await animate(this.stage, ms / 1000, (_k, t) => {
      if (b.state !== 'in') { b.outline.visible = false; return; }
      const a = 0.5 + 0.5 * Math.sin(t * 7);
      m.opacity = 0.35 + 0.6 * a; b.mat.emissiveIntensity = 0.04 + 0.1 * a;
    }, ease.linear);
    if (b.state === 'in') { b.outline.visible = false; m.opacity = 0; b.mat.emissiveIntensity = 0; }
  }

  /** knock the tower: spring wobble around its base */
  kick(dir: THREE.Vector3, amount: number) {
    const d = dir.clone().normalize();
    this.sway.vx += d.z * amount * 6;
    this.sway.vz += -d.x * amount * 6;
  }

  private update(dt: number, t: number) {
    const s = this.sway, k = 60, c = 3.2;
    s.vx += (-k * s.ax - c * s.vx) * dt; s.vz += (-k * s.az - c * s.vz) * dt;
    s.ax += s.vx * dt; s.az += s.vz * dt;
    this.root.rotation.x = s.ax; this.root.rotation.z = s.az;
    for (const b of this.blocks) {
      const pr = b.mesh.userData.presented as { pos: THREE.Vector3; t0: number } | undefined;
      if (pr) b.mesh.position.y = pr.pos.y + Math.sin(t * 2.2) * 0.06;
    }
  }
}
