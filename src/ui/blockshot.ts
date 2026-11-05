// The result book's words as real Jenga blocks (user: "결과 화면에 나오는 단어블럭들도 정말 젠가 블럭형태로 넣어줘"): each
// collected word is drawn the way the game draws its block — the same rounded block, painted atlas (the word on the long
// face, its first letter on the end), material, light and tone mapping — seen a little from above and from the right,
// into a picture for the book. One small offscreen renderer, made on first use and kept; pictures cached per word.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { blockGeometry, blockMaterial, paintBlock, type Pastel } from '../game/tower';

/** picture width (CSS px at 1x; drawn at 2x) — the height follows the block's outline from this view */
const SHOT_W = 260;
/** the view: from the front-right (degrees from the long face toward the +x end) and a little from above */
const AZ = 15, EL = 15;   // nearly head-on: the word big and level, the top and the end still show
const DEG = Math.PI / 180;

type Kit = { r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.OrthographicCamera; mesh: THREE.Mesh };
let kit: Kit | null | undefined;
const cache = new Map<string, string>();

function setup(): Kit | null {
  try {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;      // as stage.ts: the same colours as in the tower
    r.toneMappingExposure = 1.0;
    r.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.42;
    pm.dispose();
    scene.add(new THREE.HemisphereLight(0xfff6ea, 0xe2bea4, 1.35));
    const key = new THREE.DirectionalLight(0xffeedd, 2.2);
    key.position.set(-9, 15, 9);
    const fill = new THREE.DirectionalLight(0xffe9dc, 0.45);
    fill.position.set(9, 6, -4);
    scene.add(key, fill);
    const geo = blockGeometry();
    const mesh = new THREE.Mesh(geo);
    scene.add(mesh);
    // an orthographic camera fitted to the block's outline from this view (+ a small margin)
    const dir = new THREE.Vector3(Math.sin(AZ * DEG) * Math.cos(EL * DEG), Math.sin(EL * DEG), Math.cos(AZ * DEG) * Math.cos(EL * DEG));
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
    cam.position.copy(dir.multiplyScalar(12));
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox!, v = new THREE.Vector3();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(cam.matrixWorldInverse);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    const m = 0.03 * (x1 - x0);
    cam.left = x0 - m; cam.right = x1 + m; cam.bottom = y0 - m; cam.top = y1 + m;
    cam.updateProjectionMatrix();
    r.setPixelRatio(2);
    r.setSize(SHOT_W, Math.round(SHOT_W * (cam.top - cam.bottom) / (cam.right - cam.left)), false);
    return { r, scene, cam, mesh };
  } catch (e) {
    console.warn('blockshot: no WebGL', e);
    return null;
  }
}

/** a picture of the game's block for this word (PNG data URL), or null without WebGL */
export function blockShot(word: string, color: Pastel): string | null {
  const id = `${word}|${color.name}`;
  const hit = cache.get(id);
  if (hit) return hit;
  if (kit === undefined) kit = setup();
  if (!kit) return null;
  const tex = new THREE.CanvasTexture(paintBlock(word, color));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = kit.r.capabilities.getMaxAnisotropy();
  const mat = blockMaterial(tex);
  kit.mesh.material = mat;
  kit.r.render(kit.scene, kit.cam);
  const url = kit.r.domElement.toDataURL('image/png');
  mat.dispose(); tex.dispose();
  cache.set(id, url);
  return url;
}

/** the block's picture as an <img> for the book (null: fall back to a chip) */
export function blockImg(word: string, color: Pastel): HTMLImageElement | null {
  const url = blockShot(word, color);
  if (!url) return null;
  const img = new Image();
  img.className = 'jb'; img.src = url; img.alt = word; img.draggable = false;
  return img;
}
