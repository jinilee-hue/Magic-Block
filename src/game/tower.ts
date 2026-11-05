// The Jenga tower: 12 layers × 3 pastel blocks (Jenga proportions 7.5 : 1.5 : 2.5), each painted with its word on
// all four sides. 14 blocks carry an m-word (half of the 28 FPR K m-words: the next game brings the other half). The
// m-blocks are placed so the tower can always stand once every one of them is pulled out (per layer: none, one side,
// the middle, or both sides — never "middle + a side"), so a correct pull never knocks it over; the big fall is saved
// for the end.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { animate, ease, shuffle } from './anim';
import type { Stage } from './stage';
import { BLOCK_LAYER } from './hintring';

export const L = 3, D = 1;
/** block thickness (user picked "thicker blocks with 10 layers": 0.75, real Jenga is 0.6). ?bh= overrides it. */
export const H = Number(typeof location === 'undefined' ? 0 : new URLSearchParams(location.search).get('bh')) || 0.75;
export const LAYERS = Number(typeof location === 'undefined' ? 0 : new URLSearchParams(location.search).get('layers')) || 10;
/** the title shows a taller tower than the game (user: "첫화면에는 갯수 더 많아도 괜찮은거 같은데", then "한단 빼자":
 *  11 layers): same blocks, logo and START centred over it, m-words on its front face */
export const TITLE_LAYERS = 11;
/** m-words in one game */
export const M_PER_GAME = 14;
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
/** a soft glow of the block's own colours at rest (emissive = white × its map): the hover / hint glows add to it */
const GLOW = 0.07;
/** '#rrggbb' a → b by t, as rgb() */
const mixHex = (a: string, b: string, t: number) => {
  const c = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `rgb(${[0, 1, 2].map((i) => Math.round(c(a, i) + (c(b, i) - c(a, i)) * t)).join(', ')})`;
};
/** a block's material: soft-touch matte like the painted table (a faint satin coat; no sheen — its white rim at grazing
 *  angles read as a white film on the lower edges), glowing a little in its own colours so its shadow side stays
 *  colourful (map = emissiveMap) */
export function blockMaterial(map: THREE.Texture) {
  return new THREE.MeshPhysicalMaterial({
    map, emissiveMap: map, emissive: new THREE.Color(0xffffff), emissiveIntensity: GLOW, roughness: 0.62, metalness: 0,
    clearcoat: 0.08, clearcoatRoughness: 0.6,
  });
}

// texture atlas: one canvas per block. LONG = the two long faces, END = the two end faces, TOP / BOTTOM = the top and
// the bottom face (flat colours: their own regions, so each matches the edge of the side faces it meets).
// The canvas height follows the block's thickness so the letters keep their shape (LONG.w : AH = L : H).
const AW = 1024;
const LONG = { x: 0, w: 640 }, END = { x: 648, w: 213 }, TOP = { x: 870, w: 70 }, BOTTOM = { x: 948, w: 70 };
const AH = Math.round(LONG.w * H / L);

let sharedGeo: RoundedBoxGeometry | null = null;
export function blockGeometry() {
  if (sharedGeo) return sharedGeo;
  // soft, puffy corners (radius 22 % of the thickness): squishy toy blocks; the word stays on the flat middle band
  const g = new RoundedBoxGeometry(L, H - HG, D - DG, 6, 0.22 * H);
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
        case 2: u = (x + L / 2) / L; v = (z + d / 2) / d; r = TOP; break;
        case 3: u = (x + L / 2) / L; v = (-z + d / 2) / d; r = BOTTOM; break;
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
  // soft matte pastel like the painted table (user: "테이블 처럼 좀더 소프트한 느낌의 블럭"): the side faces a little lighter
  // at the top and a little deeper at the bottom — flat over the rounded edges, the change happens on the face — and the
  // top / bottom faces flat in exactly the colour their side faces meet them with, so the rounded edges carry on without
  // a band. (Top and bottom once shared one region with the side gradient running across their depth: a dark band along
  // the top of half the blocks, a white film along their bottom, cracked-looking joints — user: "젠가 밑에가 더 밝은 흰색
  // 투명하게 들어간거 같은데", "젠가 위에는 또 어두운 색이 들어갔는데", "블럭과 블럭사이 깨져보이는데".)
  const top = mixHex(p.base, p.light, 0.45), bottom = mixHex(p.base, p.edge, 0.4);
  const body = g.createLinearGradient(0, 0, 0, AH);
  body.addColorStop(0, top); body.addColorStop(0.13, top); body.addColorStop(0.42, p.base); body.addColorStop(0.68, p.base);
  body.addColorStop(0.87, bottom); body.addColorStop(1, bottom);
  g.fillStyle = body; g.fillRect(0, 0, TOP.x - 4, AH);
  g.fillStyle = top; g.fillRect(TOP.x - 4, 0, BOTTOM.x - TOP.x, AH);
  g.fillStyle = bottom; g.fillRect(BOTTOM.x - 4, 0, AW - BOTTOM.x + 4, AH);
  // the word on the long faces; on the narrow ends only its first letter, big (user: "젠가 블럭에서 넓은 면에만 전체 단어
  // 스펠링 다 들어가고 좁은 끝 부분에는 단어의 첫번째 스펠링만")
  const text = (str: string, x: number, w: number, pad: number, max: number) => {
    let size = max;
    g.font = `700 ${size}px ECP, Baloo, sans-serif`;
    const mw = g.measureText(str).width;
    if (mw > w - pad * 2) size = Math.max(18, size * (w - pad * 2) / mw);
    g.font = `700 ${size}px ECP, Baloo, sans-serif`;
    const m = g.measureText(str);
    const asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
    // a word: centre its x-height band (not the ink box) so words with and without ascenders sit on one line; a single
    // letter: centre its ink
    const xh = size * 0.53;
    const by = str.length === 1 ? AH / 2 + (asc - desc) / 2
      : AH / 2 + xh / 2 + (desc > size * 0.12 && asc < size * 0.62 ? -size * 0.06 : 0);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const cx = x + w / 2;
    g.fillStyle = p.light; g.globalAlpha = 0.9; g.fillText(str, cx, by + size * 0.035);
    g.globalAlpha = 1; g.fillStyle = p.ink; g.fillText(str, cx, by);
  };
  text(word, LONG.x, LONG.w, 36, AH * 0.61);
  text(word[0], END.x, END.w, 10, AH * 0.66);
  return cv;
}

function makeTexture(cv: HTMLCanvasElement, aniso: number) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Which slots in each layer hold m-words (stability by construction). */
export function planLayers(mCount: number, r: () => number, layers = LAYERS): number[][] {
  const kMin = Math.max(0, mCount - layers), kMax = Math.min(layers, Math.floor(mCount / 2));
  const both = Math.min(kMax, kMin + Math.floor(r() * 4));            // layers whose two side blocks are m-words
  const single = mCount - both * 2;                                     // layers with one m-word
  const types: ('both' | 'one' | 'none')[] = [];
  for (let i = 0; i < both; i++) types.push('both');
  for (let i = 0; i < single; i++) types.push('one');
  while (types.length < layers) types.push('none');
  shuffle(types, r);
  return types.map((t) => t === 'both' ? [0, 2] : t === 'one' ? [r() < 0.4 ? 1 : r() < 0.5 ? 0 : 2] : []);
}

/** a stand-alone layer can stand: middle present, or both sides present */
export const layerStable = (present: boolean[]) => present[1] || (present[0] && present[2]);

let looseShadow: THREE.MeshBasicMaterial | null = null;
/** soft rounded-rectangle shadow under a block lying on the table (shared by the title's loose blocks) */
function looseShadowMat() {
  if (looseShadow) return looseShadow;
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d')!;
  // only the blurred shadow of a shape drawn off-canvas lands on the canvas
  g.shadowColor = 'rgba(90, 50, 25, 0.6)'; g.shadowBlur = 22; g.shadowOffsetX = 1000;
  g.beginPath();
  if (g.roundRect) g.roundRect(-1000 + 34, 34, 256 - 68, 128 - 68, 18); else g.rect(-1000 + 34, 34, 256 - 68, 128 - 68);
  g.fill();
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  looseShadow = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  return looseShadow;
}

export class Tower {
  readonly root = new THREE.Group();
  blocks: Block[] = [];
  /** overall size of the tower (the title shows it a little smaller so the logo fits above it) */
  baseScale = 1;
  private ray = new THREE.Raycaster();
  private sway = { ax: 0, az: 0, vx: 0, vz: 0 };
  private jelly = { y: 0, v: 0 };
  private hovered: Block | null = null;
  private aniso: number;
  private busyAnim = false;
  /** title decor: blocks lying about on the table (scatter); not part of the tower */
  private loose: THREE.Object3D[] = [];
  /** a stack-up or a title tease is playing */
  get busy() { return this.busyAnim; }

  constructor(private stage: Stage) {
    stage.world.add(this.root);
    this.aniso = Math.min(8, stage.renderer.capabilities.getMaxAnisotropy());
    stage.tick((dt, t) => this.update(dt, t));
  }

  /** layers: 12 for a game; the title tower is shorter. plan: which slots hold m-words (default: planLayers) */
  build(words: WordInfo[], r: () => number, layers = LAYERS, plan?: number[][]) {
    this.clear();
    const ms = shuffle(words.filter((w) => w.m), r), others = shuffle(words.filter((w) => !w.m), r);
    plan ??= planLayers(ms.length, r, layers);
    const geo = blockGeometry();
    let id = 0;
    for (let layer = 0; layer < layers; layer++) {
      const used = new Set<string>();
      for (let slot = 0; slot < 3; slot++) {
        const word = plan[layer].includes(slot) ? ms.pop()! : others.pop()!;
        const choices = PASTELS.filter((p) => !used.has(p.name));
        const color = choices[Math.floor(r() * choices.length)]; used.add(color.name);
        const mat = blockMaterial(makeTexture(paintBlock(word.w, color), this.aniso));
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
        mesh.layers.enable(BLOCK_LAYER);     // in the hint ring's mask (hintring.ts)
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
    for (const o of this.loose) {
      o.removeFromParent();
      const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | THREE.MeshBasicMaterial;
      if (m !== looseShadowMat()) { m.map?.dispose(); m.dispose(); }
    }
    this.loose = [];
    this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0);
    this.sway = { ax: 0, az: 0, vx: 0, vz: 0 };
    this.jelly = { y: 0, v: 0 }; this.baseScale = 1; this.root.scale.set(1, 1, 1);
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
    if (this.hovered && this.hovered.state === 'in') this.hovered.mat.emissiveIntensity = GLOW;
    this.hovered = b;
    if (b) b.mat.emissiveIntensity = GLOW + 0.14;
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
  /** onSpark: screen points (CSS px) on the block's leading end, every frame while it slides (the title's sparkles) */
  async pullOut(b: Block, onSpark?: (x: number, y: number) => void) {
    b.state = 'busy';
    this.hover(null);
    this.glow(b, true);
    const dir = this.towardCamera(b);
    const local = this.root.worldToLocal(b.mesh.getWorldPosition(new THREE.Vector3()).add(dir)).sub(this.root.worldToLocal(b.mesh.getWorldPosition(new THREE.Vector3())));
    const from = b.mesh.position.clone();
    const side = new THREE.Vector3(-local.z, 0, local.x);
    this.kick(dir, 0.010);
    const fwd = local.clone().normalize(), across = side.clone().normalize(), tip = new THREE.Vector3();
    await animate(this.stage, 0.95, (k, t) => {
      const jit = Math.sin(t * 46) * 0.012 * (1 - k);
      b.mesh.position.copy(from).addScaledVector(local, k * (L + 0.35)).addScaledVector(side, jit);
      if (onSpark && k > 0.08) {
        tip.copy(b.mesh.position).addScaledVector(fwd, L / 2).addScaledVector(across, D * (Math.random() - 0.5)).setY(b.mesh.position.y + H * (Math.random() - 0.5));
        const p = this.stage.project(this.root.localToWorld(tip)); onSpark(p.x, p.y);
      }
      b.mesh.rotation.y = b.homeRotY + Math.sin(t * 31) * 0.012 * (1 - k);
      b.mat.emissiveIntensity = GLOW + 0.12 + 0.08 * Math.sin(t * 9);
      // a squishy wobble as it is grabbed and starts to slide
      squish(b.mesh, Math.sin(k * Math.PI * 6) * 0.07 * Math.max(0, 1 - k * 2.2));
    }, ease.inOut);
    squish(b.mesh, 0);
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
      squish(b.mesh, Math.sin(t * 24) * 0.08 * (1 - k));             // it won't come: it quivers
    }, ease.linear);
    squish(b.mesh, 0);
    await animate(this.stage, 0.35, (k) => { b.mesh.position.copy(from).addScaledVector(local, 0.42 * (1 - k)); b.mesh.rotation.y = b.homeRotY; }, ease.inOut);
    b.mesh.position.copy(from);
    this.glow(b, false);
    b.mat.emissiveIntensity = GLOW;
    b.state = 'in';
  }

  /** where the pulled block floats while the child reads it: centre of the screen; lower when a picture card
   *  stands above it */
  presentPose(screenY = 0.45) {
    const s = this.stage, cam = s.camera, { w, h } = s.size;
    const dist = 10;
    const vh = 2 * dist * Math.tan((cam.fov * Math.PI) / 360), vw = vh * cam.aspect;
    const len = Math.min(vw * (cam.aspect < 1 ? 0.78 : 0.4), vh * 0.75);
    const pos = s.unproject(w / 2, h * screenY, dist);
    return { pos, quat: cam.quaternion.clone(), scale: len / L };
  }

  /** screen box (CSS px) of the presented block */
  presentedBox(b: Block) {
    const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => new THREE.Vector3(sx * L / 2, sy * H / 2, D / 2)));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of corners) {
      const p = this.stage.project(b.mesh.localToWorld(c));
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    return { x0, x1, y0, y1, cx: (x0 + x1) / 2 };
  }

  /** Fly the pulled block in front of the camera, big, its long face (the word) toward the child. */
  async present(b: Block, screenY = 0.45) {
    const scene = this.stage.scene;
    scene.attach(b.mesh);
    // crisper texture for the close-up
    const hi = makeTexture(paintBlock(b.word.w, b.color, 2), this.aniso);
    const lo = b.mat.map; b.mat.map = hi; b.mat.emissiveMap = hi; b.mat.needsUpdate = true; lo?.dispose();
    b.mesh.castShadow = false;
    const p0 = b.mesh.position.clone(), q0 = b.mesh.quaternion.clone(), s0 = b.mesh.scale.x;
    const goal = this.presentPose(screenY);
    // the block's local +z (a long face) must face the camera: camera quaternion already does that
    const lift = new THREE.Vector3(0, 1.4, 0);
    await animate(this.stage, 0.8, (k) => {
      b.mesh.position.lerpVectors(p0, goal.pos, k).addScaledVector(lift, Math.sin(k * Math.PI) * 1);
      b.mesh.quaternion.slerpQuaternions(q0, goal.quat, k);
      b.mesh.scale.setScalar(s0 + (goal.scale - s0) * k);
      (b.outline.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
    }, ease.inOut);
    this.glow(b, false);
    b.mat.emissiveIntensity = GLOW + 0.05;
    b.mesh.userData.presented = { pos: goal.pos.clone(), t0: performance.now(), scale: goal.scale };
  }

  /** the presented block spins round on its upright axis — a turn and a quarter, faster and faster, ending edge-on —
   *  and is hidden there: its picture card turns in from the same edge (game.ts, hud.cardIn) */
  async turnAway(b: Block) {
    const q0 = b.mesh.quaternion.clone(), up = new THREE.Vector3(0, 1, 0), r = new THREE.Quaternion();
    await animate(this.stage, 0.62, (k) => { r.setFromAxisAngle(up, k * Math.PI * 2.5); b.mesh.quaternion.copy(q0).multiply(r); }, ease.in);
    b.mesh.visible = false;
    b.mesh.quaternion.copy(q0);
  }
  /** the card has turned away: the block shows again, turning in from edge-on to face the child */
  async turnBack(b: Block) {
    const q0 = b.mesh.quaternion.clone(), up = new THREE.Vector3(0, 1, 0), r = new THREE.Quaternion();
    r.setFromAxisAngle(up, -Math.PI / 2); b.mesh.quaternion.copy(q0).multiply(r);
    b.mesh.visible = true;
    await animate(this.stage, 0.34, (k) => { r.setFromAxisAngle(up, -Math.PI / 2 * (1 - k)); b.mesh.quaternion.copy(q0).multiply(r); }, ease.out);
    b.mesh.quaternion.copy(q0);
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

  /** sparkle-glow a block for a hint: a ring round what is visible of it blinks over everything (stage.ring,
   *  hintring.ts). Its own outline is depth-tested: the blocks touching it hid most of it (user: "힌트 줄때의 선
   *  깜박이는거는 상위로 올려줘. 젠가 사이에 껴서 보이면 잘 안보여") */
  async hint(b: Block, ms = 2600) {
    const ring = this.stage.ring;
    ring.target = b.mesh; ring.color.setHex(0xffe46b); ring.opacity = 0;
    await animate(this.stage, ms / 1000, (_k, t) => {
      if (b.state !== 'in') { if (ring.target === b.mesh) ring.target = null; return; }
      const a = 0.5 + 0.5 * Math.sin(t * 7);
      ring.opacity = 0.35 + 0.6 * a; b.mat.emissiveIntensity = GLOW + 0.06 + 0.16 * a;
    }, ease.linear);
    if (ring.target === b.mesh) ring.target = null;
    if (b.state === 'in') b.mat.emissiveIntensity = GLOW;
  }

  /** knock the tower: spring wobble around its base, and a soft squash of the whole tower (it's squishy) */
  kick(dir: THREE.Vector3, amount: number) {
    const d = dir.clone().normalize();
    this.sway.vx += d.z * amount * 6;
    this.sway.vz += -d.x * amount * 6;
    this.jelly.v -= amount * 14;
  }

  /** The tower stacks itself up: layer by layer the blocks drop in from above and land with a soft squash.
   *  onLand(layer) fires as each layer lands (a tick sound). */
  async dropIn(onLand: (layer: number) => void = () => {}, stagger = 0.075, fall = 0.42) {
    const bs = this.blocks.slice();
    if (!bs.length) return;
    this.busyAnim = true;
    const n = Math.max(...bs.map((b) => b.layer)) + 1, drop = 6;
    const landed = new Set<number>();
    for (const b of bs) b.mesh.visible = false;
    await animate(this.stage, (n - 1) * stagger + 0.06 + fall + 0.35, (_k, t) => {
      for (const b of bs) {
        if (b.state !== 'in') continue;
        const p = (t - b.layer * stagger - b.slot * 0.03) / fall;
        if (p < 0) { b.mesh.visible = false; continue; }
        b.mesh.visible = true;
        if (p < 1) { b.mesh.position.y = b.home.y + drop * (1 - p * p); squish(b.mesh, 0.06 * (1 - p)); continue; }
        b.mesh.position.y = b.home.y;
        const q = p - 1;
        squish(b.mesh, -0.16 * Math.exp(-q * 5) * Math.cos(q * 14));
        if (b.slot === 2 && !landed.has(b.layer)) { landed.add(b.layer); onLand(b.layer); }
      }
    }, ease.linear);
    for (const b of bs) if (b.state === 'in') { b.mesh.position.y = b.home.y; squish(b.mesh, 0); b.mesh.visible = true; }
    this.jelly.v -= 0.35;
    this.busyAnim = false;
  }

  /** Title screen: an m-block on the front face slides half out to the right with sparkles (onSpark gets screen px),
   *  then back in. */
  async tease(onSpark: (x: number, y: number) => void) {
    if (this.busyAnim) return;
    const top = Math.max(...this.blocks.map((b) => b.layer));
    const cands = this.blocks.filter((b) => b.state === 'in' && b.word.m && b.axis === 'x' && b.layer >= 2 && b.layer <= top - 2);
    const front = cands.filter((b) => b.slot === 2);
    const pool = front.length ? front : cands;
    if (!pool.length) return;
    const b = pool[Math.floor(Math.random() * pool.length)];
    this.busyAnim = true;
    const x0 = b.home.x, out = L * 0.5;
    // sparkles at the block's sliding end (front edge, anywhere along its height)
    const spark = () => {
      const p = this.stage.project(this.root.localToWorld(new THREE.Vector3(b.mesh.position.x + L / 2, b.mesh.position.y + H * (Math.random() - 0.5), b.mesh.position.z + D / 2)));
      onSpark(p.x, p.y);
    };
    await animate(this.stage, 0.6, (k) => { b.mesh.position.x = x0 + out * k; b.mat.emissiveIntensity = GLOW + 0.1 * k; spark(); }, ease.out);
    await animate(this.stage, 1.1, () => spark(), ease.linear);
    await animate(this.stage, 0.5, (k) => { b.mesh.position.x = x0 + out * (1 - k); b.mat.emissiveIntensity = GLOW + 0.1 * (1 - k); }, ease.inOut);
    b.mesh.position.x = x0; b.mat.emissiveIntensity = GLOW;
    this.busyAnim = false;
  }

  /** height of the tower in world units, before baseScale */
  topH() { return (Math.max(0, ...this.blocks.filter((b) => b.state === 'in').map((b) => b.layer)) + 1) * H; }

  /** Title decor (user: "테이블에 젠가 몇개 떨어져있는걸로"): a few blocks lying about on the table as if they had
   *  fallen — flat or on their side, each with a soft contact shadow. They sit in the room, not in the tower, so they
   *  don't sway, can't be picked, and go with the next build. Spots are clear of the tower and each other and inside
   *  the table (tableR ≥ 4); found with a small search. */
  scatter(words: WordInfo[], r: () => number) {
    const SPOTS: [number, number, number, boolean][] = [[-1.77, 2.48, -18, false], [1.71, 2.44, 38, false], [-2.38, -1.25, 76, false], [2.52, -1.2, 105, false]];
    const geo = blockGeometry(), used = new Set<string>();
    SPOTS.forEach(([x, z, yaw, side], i) => {
      const word = words[i % words.length];
      if (!word) return;
      const choices = PASTELS.filter((p) => !used.has(p.name));
      const color = choices[Math.floor(r() * choices.length)]; used.add(color.name);
      const mat = blockMaterial(makeTexture(paintBlock(word.w, color), this.aniso));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const a = (yaw + (r() - 0.5) * 6) * Math.PI / 180;
      mesh.rotation.order = 'YXZ';                       // roll onto its side first, then turn
      mesh.rotation.set(side ? Math.PI / 2 : 0, a, 0);
      mesh.position.set(x, side ? (D - DG) / 2 : (H - HG) / 2, z);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.7, (side ? H : D) + 0.7), looseShadowMat());
      shadow.rotation.order = 'YXZ';                     // lay it flat first, then turn it with the block
      shadow.rotation.set(-Math.PI / 2, a, 0);
      shadow.position.set(x, 0.005, z); shadow.renderOrder = -1;
      this.stage.world.add(mesh, shadow);
      this.loose.push(mesh, shadow);
    });
  }

  private update(dt: number, t: number) {
    const s = this.sway, k = 60, c = 3.2;
    s.vx += (-k * s.ax - c * s.vx) * dt; s.vz += (-k * s.az - c * s.vz) * dt;
    s.ax += s.vx * dt; s.az += s.vz * dt;
    this.root.rotation.x = s.ax; this.root.rotation.z = s.az;
    // squash & stretch of the whole tower from its foot: a quick, soft spring
    const j = this.jelly, sc = this.baseScale;
    j.v += (-140 * j.y - 5 * j.v) * dt; j.y += j.v * dt;
    this.root.scale.set(sc * (1 - j.y * 0.5), sc * (1 + j.y), sc * (1 - j.y * 0.5));
    for (const b of this.blocks) {
      const pr = b.mesh.userData.presented as { pos: THREE.Vector3; t0: number; scale: number } | undefined;
      if (pr) {
        // the floating block bobs and breathes a little
        const w = Math.sin(t * 2.2);
        b.mesh.position.y = pr.pos.y + w * 0.06;
        b.mesh.scale.set(pr.scale * (1 + 0.01 * w), pr.scale * (1 - 0.018 * w), pr.scale * (1 + 0.01 * w));
      }
    }
  }
}

/** squash & stretch of one block: taller and thinner for j > 0, flatter and wider for j < 0 (0 = its own shape) */
function squish(m: THREE.Object3D, j: number) { m.scale.set(1 - j * 0.5, 1 + j, 1 - j * 0.5); }
