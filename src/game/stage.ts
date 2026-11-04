// three.js stage: renderer (transparent over the CSS sky), soft key light with shadows, the round wooden table,
// and a camera that orbits the tower (drag = turn / tilt, pinch or wheel = zoom). Taps are reported separately.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface TapEvent { x: number; y: number; ndc: THREE.Vector2 }

const DEG = Math.PI / 180;
export const TABLE_R = 4.6;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
  readonly world = new THREE.Group();
  /** orbit state (target is the tower's middle) */
  readonly rig = { az: 28 * DEG, el: 11 * DEG, zoom: 1, target: new THREE.Vector3(0, 5.1, 0), azVel: 0 };
  private goal: { az: number; el: number; zoom: number } | null = null;
  controls = true;
  onTap: (e: TapEvent) => void = () => {};
  onHover: (e: TapEvent | null) => void = () => {};
  onUserTurn: () => void = () => {};
  private w = 1; private h = 1;
  private fitDist = 30;
  private tickers = new Set<(dt: number, t: number) => void>();
  private last = performance.now();
  private clock = 0;

  constructor(private host: HTMLElement) {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.setClearColor(0x000000, 0);
    host.appendChild(r.domElement);
    r.domElement.setAttribute('aria-label', 'Jenga tower');

    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    const hemi = new THREE.HemisphereLight(0xffffff, 0xf3d6c8, 1.55);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
    key.position.set(-7, 16, 11);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -9; sc.right = 9; sc.top = 14; sc.bottom = -6; sc.near = 1; sc.far = 50;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
    key.target.position.set(0, 4, 0);
    this.scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xe9f1ff, 0.55);
    fill.position.set(9, 6, -4);
    this.scene.add(fill);

    this.scene.add(this.world);
    this.world.add(makeTable());

    this.bindInput(r.domElement);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    r.setAnimationLoop(() => this.frame());
  }

  /** run every frame (dt seconds, t seconds since start) */
  tick(f: (dt: number, t: number) => void) { this.tickers.add(f); return () => this.tickers.delete(f); }

  resize() {
    const w = this.host.clientWidth || window.innerWidth, h = this.host.clientHeight || window.innerHeight;
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // fit the tower + table top (y -0.6 .. 11.1) into ~74% of the height, never wider than ~46% of the width
    const tanH = Math.tan(this.camera.fov * DEG / 2);
    const needH = 12.0 / 0.74;
    const needW = (TABLE_R * 2 + 0.6) / Math.min(0.62, 0.5 + 0.12 * Math.max(0, 1.6 - this.camera.aspect));
    this.fitDist = Math.max(needH / (2 * tanH), needW / (2 * tanH * this.camera.aspect));
    this.camera.updateProjectionMatrix();
  }

  get size() { return { w: this.w, h: this.h }; }
  get dist() { return this.fitDist * this.rig.zoom; }

  /** animate the view to a pose (degrees) */
  turnTo(azDeg: number | null, elDeg: number | null = null, zoom: number | null = null) {
    this.goal = { az: azDeg == null ? this.rig.az : azDeg * DEG, el: elDeg == null ? this.rig.el : elDeg * DEG, zoom: zoom ?? this.rig.zoom };
  }
  turnBy(dAzDeg: number) { const a = (this.goal?.az ?? this.rig.az) + dAzDeg * DEG; this.goal = { az: a, el: this.goal?.el ?? this.rig.el, zoom: this.goal?.zoom ?? this.rig.zoom }; }
  home() { this.turnTo(28 + 90 * Math.round((this.rig.az / DEG - 28) / 90), 11, 1); }

  private frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.clock += dt;
    const R = this.rig;
    if (this.goal) {
      const k = 1 - Math.pow(0.0009, dt);
      R.az += (this.goal.az - R.az) * k; R.el += (this.goal.el - R.el) * k; R.zoom += (this.goal.zoom - R.zoom) * k;
      if (Math.abs(this.goal.az - R.az) < 0.0005 && Math.abs(this.goal.el - R.el) < 0.0005 && Math.abs(this.goal.zoom - R.zoom) < 0.0005) this.goal = null;
    } else if (Math.abs(R.azVel) > 0.0001 && !this.dragging) {
      R.az += R.azVel * dt; R.azVel *= Math.pow(0.04, dt);
    }
    this.place();
    for (const f of this.tickers) f(dt, this.clock);
    this.renderer.render(this.scene, this.camera);
  }

  place() {
    const R = this.rig, d = this.dist;
    const c = this.camera;
    c.position.set(R.target.x + d * Math.cos(R.el) * Math.sin(R.az), R.target.y + d * Math.sin(R.el), R.target.z + d * Math.cos(R.el) * Math.cos(R.az));
    c.lookAt(R.target);
    c.updateMatrixWorld();
  }

  /** world → CSS px */
  project(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * this.w, y: (1 - p.y) / 2 * this.h, z: p.z };
  }
  /** CSS px → world point `dist` units in front of the camera along that pixel's ray */
  unproject(x: number, y: number, dist: number) {
    const ndc = new THREE.Vector3((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1, 0.5);
    ndc.unproject(this.camera);
    const dir = ndc.sub(this.camera.position).normalize();
    return this.camera.position.clone().addScaledVector(dir, dist);
  }
  ndc(x: number, y: number) { return new THREE.Vector2((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1); }

  // ── input ────────────────────────────────────────────────────────────────────────────────────────────────
  private dragging = false;
  private bindInput(el: HTMLCanvasElement) {
    const pts = new Map<number, { x: number; y: number }>();
    let down: { x: number; y: number; t: number; moved: number } | null = null;
    let pinch0 = 0, zoom0 = 1, lastX = 0, lastY = 0, lastT = 0;
    const rect = () => el.getBoundingClientRect();
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture?.(e.pointerId);
      const r = rect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      pts.set(e.pointerId, { x, y });
      if (pts.size === 1) { down = { x, y, t: performance.now(), moved: 0 }; lastX = x; lastY = y; lastT = performance.now(); this.rig.azVel = 0; }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = this.rig.zoom; down = null; }
    });
    el.addEventListener('pointermove', (e) => {
      const r = rect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      if (!pts.has(e.pointerId)) { if (e.pointerType === 'mouse') this.onHover({ x, y, ndc: this.ndc(x, y) }); return; }
      pts.set(e.pointerId, { x, y });
      if (pts.size === 2 && this.controls) {
        const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0 > 0) { this.rig.zoom = clamp(zoom0 * pinch0 / d, 0.55, 1.35); this.goal = null; }
        return;
      }
      if (!down) return;
      const dx = x - lastX, dy = y - lastY;
      down.moved += Math.abs(dx) + Math.abs(dy);
      if (down.moved > 9 && this.controls) {
        if (!this.dragging) { this.dragging = true; this.onUserTurn(); }
        this.goal = null;
        const k = 3.2 / Math.max(320, this.w);
        this.rig.az -= dx * k * 1.15;
        this.rig.el = clamp(this.rig.el + dy * k * 0.75, -4 * DEG, 52 * DEG);
        const now = performance.now(); const dtm = Math.max(1, now - lastT);
        this.rig.azVel = (-dx * k * 1.15) / (dtm / 1000) * 0.6;
        lastT = now;
      }
      lastX = x; lastY = y;
    });
    const up = (e: PointerEvent) => {
      const r = rect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      const wasDown = down; pts.delete(e.pointerId);
      if (pts.size === 0) {
        if (wasDown && wasDown.moved <= 9 && performance.now() - wasDown.t < 600 && e.type === 'pointerup') this.onTap({ x, y, ndc: this.ndc(x, y) });
        if (!this.dragging) this.rig.azVel = 0;
        this.dragging = false; down = null; pinch0 = 0;
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.onHover(null); });
    el.addEventListener('wheel', (e) => { if (!this.controls) return; e.preventDefault(); this.goal = null; this.rig.zoom = clamp(this.rig.zoom * Math.exp(e.deltaY * 0.0012), 0.55, 1.35); }, { passive: false });
  }
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// ── the round wooden table ───────────────────────────────────────────────────────────────────────────────────
function woodCanvas(w: number, h: number, rings: boolean) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#e9c9a1'; g.fillRect(0, 0, w, h);
  if (rings) {
    const cx = w / 2, cy = h / 2;
    for (let r = 6; r < w * 0.72; r += 5 + Math.random() * 9) {
      g.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.05) {
        const rr = r * (1 + 0.025 * Math.sin(a * 3 + r * 0.05) + 0.015 * Math.sin(a * 7 + r));
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (a === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokeStyle = `rgba(176, 124, 74, ${0.05 + Math.random() * 0.09})`; g.lineWidth = 1 + Math.random() * 2.2; g.stroke();
    }
    const v = g.createRadialGradient(cx, cy, w * 0.1, cx, cy, w * 0.5);
    v.addColorStop(0, 'rgba(255,240,220,0.25)'); v.addColorStop(1, 'rgba(190,140,90,0.12)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
  } else {
    for (let i = 0; i < 70; i++) {
      const y = Math.random() * h;
      g.fillStyle = `rgba(170, 118, 70, ${0.04 + Math.random() * 0.08})`;
      g.fillRect(0, y, w, 1 + Math.random() * 2.5);
    }
  }
  return cv;
}

function makeTable() {
  const grp = new THREE.Group();
  const topTex = new THREE.CanvasTexture(woodCanvas(1024, 1024, true)); topTex.colorSpace = THREE.SRGBColorSpace; topTex.anisotropy = 4;
  const sideTex = new THREE.CanvasTexture(woodCanvas(512, 64, false)); sideTex.colorSpace = THREE.SRGBColorSpace; sideTex.wrapS = THREE.RepeatWrapping; sideTex.repeat.set(6, 1);
  const topMat = new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.72, color: 0xffffff });
  const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.75, color: 0xe3b98c });
  const legMat = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.75, color: 0xdcae7e });
  // top slab with a rounded lip: cylinder + torus
  const H = 0.5;
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_R - 0.08, TABLE_R - 0.18, H - 0.1, 120, 1), [sideMat, topMat, sideMat]);
  slab.position.y = -H / 2 - 0.02; slab.receiveShadow = true; slab.castShadow = true;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(TABLE_R - 0.12, 0.1, 16, 140), sideMat);
  lip.rotation.x = Math.PI / 2; lip.position.y = -0.1; lip.receiveShadow = true;
  const under = new THREE.Mesh(new THREE.TorusGeometry(TABLE_R - 0.22, 0.07, 12, 120), sideMat);
  under.rotation.x = Math.PI / 2; under.position.y = -H + 0.02;
  grp.add(slab, lip, under);
  // legs: four, splayed a little, a ring stretcher lower down
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 9, 20), legMat);
    const r = 2.7;
    leg.position.set(Math.cos(a) * (r + 0.45), -H - 4.4, Math.sin(a) * (r + 0.45));
    leg.rotation.z = Math.cos(a) * 0.1; leg.rotation.x = -Math.sin(a) * 0.1;
    leg.castShadow = true;
    grp.add(leg);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.25, 0.08, 10, 80), legMat);
  ring.rotation.x = Math.PI / 2; ring.position.y = -5.4;
  grp.add(ring);
  return grp;
}
