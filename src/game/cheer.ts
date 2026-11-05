// The right block's reveal, after Word Mashup's result card (phonics-wordmashup-3D src/gl/mashup.ts — user: "맞는 블럭
// 젠가를 뺐을때는 wordmashup에 정답카드 나올때처럼 파티클 넣어줘"): when the pulled m-block lands in the middle, a pop bursts
// out of it — candy streaks, spinning 3D stars, glossy candy dots — and a golden glow with slowly turning rays stands
// behind it (then behind its picture card) while candy dots rain down for a while. It all lives in camera space between
// the presented block (10 units in front of the camera, tower.presentPose) and the reading veil (13): the block hides
// what is behind it and the veil never dims the effect. Clock = the stage's (stage.tick). Word Mashup's fight-cloud
// puffs belong to its card crash and are left out.
import * as THREE from 'three';
import type { Stage } from './stage';

const PALETTE = [0xffd23f, 0xff4fa3, 0xff5a5a, 0x3fa7ff, 0xff9a2e, 0x6bd66b, 0x9b6bff, 0x37d6ff];
const STAR_COLS = [0xffd23f, 0xffd23f, 0xffd23f, 0xffc21f, 0x4db8ff, 0xff7ac0];
const CAP = { streak: 64, star: 32, conf: 320 };
const DEPTH = 10;      // the presented block's distance from the camera
const BACK = 1.6;      // the glow and rays stand this far behind it (the veil is at 13)
const RAIN_S = 2.6;    // candy rain after the pop (Word Mashup: while its result card is up, 2.4 s)

const easeOutBack = (x: number) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lin = (a: number, b: number, x: number) => clamp01((x - a) / (b - a));
const smooth = (a: number, b: number, x: number) => { const t = lin(a, b, x); return t * t * (3 - 2 * t); };
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** a candy stroke: thin tail on the left, a fat round head on the right, glossy stripe (tinted per instance) */
const streakTex = () => canvasTex(256, 64, (g) => {
  const body = (inset: number) => {
    g.beginPath();
    g.moveTo(4, 32);
    g.quadraticCurveTo(120, 32 - 10 + inset, 222, 32 - 24 + inset);
    g.arc(222, 32, 24 - inset, -Math.PI / 2, Math.PI / 2);
    g.quadraticCurveTo(120, 32 + 10 - inset, 4, 32);
    g.closePath();
  };
  body(0); g.fillStyle = '#d9d9d9'; g.fill();
  g.save(); body(0); g.clip();
  g.fillStyle = '#ffffff';
  g.beginPath(); g.ellipse(170, 20, 70, 6, -0.08, 0, Math.PI * 2); g.fill();
  g.restore();
});
/** 16 soft golden rays, alternately wide and narrow, fading out from the middle */
const raysTex = () => canvasTex(512, 512, (g) => {
  const c = 256, N = 16;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, w = i % 2 ? 0.07 : 0.12;
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(255,248,215,0.95)'); gr.addColorStop(0.35, 'rgba(255,236,170,0.55)'); gr.addColorStop(1, 'rgba(255,226,140,0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(c, c);
    g.arc(c, c, c, a - w, a + w); g.closePath(); g.fill();
  }
});
const glowTex = () => canvasTex(256, 256, (g) => {
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,246,205,1)'); gr.addColorStop(0.3, 'rgba(255,224,130,0.75)'); gr.addColorStop(0.65, 'rgba(255,200,90,0.25)'); gr.addColorStop(1, 'rgba(255,190,80,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
});
/** a puffy 5-point star (extruded, bevelled) */
function starGeometry() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.46 : 1, a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.28, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.1, bevelSegments: 3 });
  g.center();
  g.computeVertexNormals();
  return g;
}

type Streak = { t0: number; life: number; ang: number; r0: number; v: number; len: number; w: number; z: number; col: THREE.Color };
type Star = { t0: number; life: number; p: THREE.Vector3; v: THREE.Vector3; size: number; axis: THREE.Vector3; spin: number; col: THREE.Color };
type Conf = { t0: number; life: number; p: THREE.Vector3; v: THREE.Vector3; size: number; col: THREE.Color; rain: boolean; fl: number; ph: number };

export class Cheer {
  private readonly group = new THREE.Group();
  private t = 0;
  private streaks: Streak[] = [];
  private stars: Star[] = [];
  private confs: Conf[] = [];
  private streakMesh: THREE.InstancedMesh;
  private starMesh: THREE.InstancedMesh;
  private confMesh: THREE.InstancedMesh;
  private rays: THREE.Mesh;
  private glow: THREE.Mesh;
  private at = { x: 0, y: 0 };            // the pop's screen point (CSS px)
  private base = 600;                     // px: min(W, H)
  private cardW = 400;                    // px: the glow and rays are sized by the card (Word Mashup: × 2.5, × 3.3)
  private reveal: { t0: number; tEnd: number } | null = null;
  private rainUntil = -Infinity;
  private rainAcc = 0;
  private rainFade = Infinity;
  // the pop's camera-space frame: px (x right, y up, z toward the camera) → world
  private O = new THREE.Vector3();
  private camQ = new THREE.Quaternion();
  private k = 0.005;                      // world units per px at the pop's depth
  private depth = DEPTH;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private zAxis = new THREE.Vector3(0, 0, 1);

  constructor(private stage: Stage) {
    this.streakMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: streakTex(), transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    }), CAP.streak);
    this.starMesh = new THREE.InstancedMesh(starGeometry(), new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.35, metalness: 0, emissive: 0x2a1a00,
    }), CAP.star);
    // confetti = glossy candy dots (as in Word Mashup), not paper
    this.confMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.32, metalness: 0, emissive: 0x111111,
    }), CAP.conf);
    const white = new THREE.Color(0xffffff);
    for (const [m, n] of [[this.streakMesh, CAP.streak], [this.starMesh, CAP.star], [this.confMesh, CAP.conf]] as const) {
      m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) m.setColorAt(i, white);           // allocate instance colours up front
      m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    }
    this.rays = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: raysTex(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: glowTex(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    // after the veil (renderOrder 5): drawn over it, still behind the presented block (depth test)
    this.rays.renderOrder = 6; this.glow.renderOrder = 7; this.streakMesh.renderOrder = 8;
    this.rays.visible = this.glow.visible = false;
    this.group.add(this.streakMesh, this.starMesh, this.confMesh, this.rays, this.glow);
    stage.scene.add(this.group);
    stage.tick((dt) => this.update(dt));
  }

  /** the right block has landed at screen point (x, y): the pop, then the glow + rays behind a card cardW px wide and
   *  a candy rain for a while */
  pop(x: number, y: number, cardW: number) {
    const { w, h } = this.stage.size;
    this.at = { x, y };
    this.base = Math.min(w, h);
    this.cardW = cardW;
    this.frame();
    this.burstStreaks(40, 0.03, [1.8, 2.8], [0.55, 0.85]);
    this.burstStars(16, [0.6, 1.3]);
    this.burstConfetti(80, [0.5, 1.6]);
    this.reveal = { t0: this.t, tEnd: Infinity };
    this.rainUntil = this.t + RAIN_S;
    this.rainAcc = 0;
    this.rainFade = Infinity;
  }

  /** the card leaves: the glow and rays fade, the dots still falling shrink away */
  stop() {
    if (this.reveal && this.reveal.tEnd === Infinity) this.reveal.tEnd = this.t;
    this.rainUntil = Math.min(this.rainUntil, this.t);
    if (this.rainFade === Infinity) this.rainFade = this.t;
  }

  /** gone at once (leaving the game) */
  clear() {
    this.streaks = []; this.stars = []; this.confs = [];
    this.reveal = null; this.rainUntil = -Infinity; this.rainFade = Infinity;
    this.streakMesh.count = this.starMesh.count = this.confMesh.count = 0;
    this.rays.visible = this.glow.visible = false;
  }

  get busy() { return this.streaks.length + this.stars.length + this.confs.length > 0 || !!this.reveal; }

  /** the pop's frame in front of the camera (the camera stands still while a block is presented) */
  private frame() {
    const cam = this.stage.camera, { h } = this.stage.size;
    this.O.copy(this.stage.unproject(this.at.x, this.at.y, DEPTH));
    this.camQ.copy(cam.quaternion);
    const fwd = cam.getWorldDirection(this.v);
    this.depth = this.s.copy(this.O).sub(cam.position).dot(fwd);
    this.k = (2 * this.depth * Math.tan((cam.fov * Math.PI) / 360)) / h;
  }

  /** px offsets from the pop point (y up, z toward the camera) → world, into `out` */
  private world(px: number, py: number, pz: number, out: THREE.Vector3) {
    return out.set(px * this.k, py * this.k, pz * this.k).applyQuaternion(this.camQ).add(this.O);
  }

  private burstStreaks(n: number, r0: number, v: [number, number], life: [number, number], cols = PALETTE, zr: [number, number] = [20, 170]) {
    const t = this.t, base = this.base;
    for (let i = 0; i < n && this.streaks.length < CAP.streak; i++) {
      this.streaks.push({
        t0: t + rnd(0, 0.06), life: rnd(life[0], life[1]), ang: (i / n) * Math.PI * 2 + rnd(-0.25, 0.25),
        r0: base * r0, v: base * rnd(v[0], v[1]), len: base * rnd(0.18, 0.32), w: base * rnd(0.02, 0.034),
        z: rnd(zr[0], zr[1]), col: new THREE.Color(cols[i % cols.length]),
      });
    }
  }

  private burstStars(n: number, v: [number, number]) {
    const t = this.t, base = this.base;
    for (let i = 0; i < n && this.stars.length < CAP.star; i++) {
      const a = rnd(0, Math.PI * 2), sp = base * rnd(v[0], v[1]);
      this.stars.push({
        t0: t + rnd(0, 0.08), life: rnd(0.9, 1.3),
        p: new THREE.Vector3(rnd(-0.04, 0.04) * base, rnd(-0.04, 0.04) * base, rnd(60, 190)),
        v: new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp * 0.85 + base * 0.35, rnd(-40, 120)),
        size: base * rnd(0.03, 0.055), axis: new THREE.Vector3(rnd(-0.4, 0.4), rnd(-0.4, 0.4), 1).normalize(),
        spin: rnd(4, 9) * (Math.random() < 0.5 ? -1 : 1), col: new THREE.Color(STAR_COLS[i % STAR_COLS.length]),
      });
    }
  }

  private burstConfetti(n: number, v: [number, number]) {
    const t = this.t, base = this.base;
    for (let i = 0; i < n && this.confs.length < CAP.conf; i++) {
      const a = rnd(0, Math.PI * 2), sp = base * rnd(v[0], v[1]);
      this.confs.push({
        t0: t, life: rnd(1.3, 2.1), rain: false, fl: 0, ph: 0,
        p: new THREE.Vector3(0, 0, rnd(40, 200)),
        v: new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp + base * 0.45, rnd(-100, 140)),
        size: base * rnd(0.006, 0.011), col: new THREE.Color(PALETTE[Math.floor(Math.random() * PALETTE.length)]),
      });
    }
  }

  private update(dt: number) {
    this.t += dt;
    if (!this.busy) return;
    const t = this.t, base = this.base, { w: W, h: H } = this.stage.size;
    this.frame();
    // ---- streaks: fly out from the middle, decelerate, thin out
    let n = 0;
    this.streaks = this.streaks.filter((s) => {
      const a = t - s.t0;
      if (a > s.life) return false;
      if (a < 0) return true;
      const u = a / s.life;
      const head = s.r0 + s.v * a * (1 - 0.45 * u);
      const len = s.len * Math.min(1, a / 0.07) * (1 - 0.35 * u);
      const w = s.w * (1 - smooth(0.6, 1, u));
      const mid = head - len / 2;
      this.world(Math.cos(s.ang) * mid, Math.sin(s.ang) * mid, s.z, this.v);
      this.q.copy(this.camQ).multiply(this.q2.setFromAxisAngle(this.zAxis, s.ang));
      this.m4.compose(this.v, this.q, this.s.set(len * this.k, Math.max(w, 1e-3) * this.k, 1));
      this.streakMesh.setMatrixAt(n, this.m4);
      this.streakMesh.setColorAt(n, s.col);
      n++;
      return true;
    });
    this.streakMesh.count = n;
    this.streakMesh.instanceMatrix.needsUpdate = true;
    if (this.streakMesh.instanceColor) this.streakMesh.instanceColor.needsUpdate = true;
    // ---- 3D stars: ballistic, spinning, pop in / shrink out
    n = 0;
    const g = base * 0.95;
    this.stars = this.stars.filter((s) => {
      const a = t - s.t0;
      if (a > s.life) return false;
      if (a < 0) return true;
      const sc = s.size * easeOutBack(lin(0, 0.12, a)) * (1 - smooth(0.72, 1, a / s.life));
      this.world(s.p.x + s.v.x * a, s.p.y + s.v.y * a - 0.5 * g * a * a, s.p.z + s.v.z * a, this.v);
      this.q.copy(this.camQ).multiply(this.q2.setFromAxisAngle(s.axis, s.spin * a));
      this.m4.compose(this.v, this.q, this.s.setScalar(Math.max(sc, 1e-3) * this.k));
      this.starMesh.setMatrixAt(n, this.m4);
      this.starMesh.setColorAt(n, s.col);
      n++;
      return true;
    });
    this.starMesh.count = n;
    this.starMesh.instanceMatrix.needsUpdate = true;
    if (this.starMesh.instanceColor) this.starMesh.instanceColor.needsUpdate = true;
    // ---- reveal: glow + rays behind the block / card, candy rain for a while
    const R = this.reveal;
    if (R) {
      // (tEnd is Infinity until the card leaves: Infinity - Infinity would be NaN)
      const on = smooth(0, 0.3, t - R.t0) * (R.tEnd === Infinity ? 1 : 1 - smooth(R.tEnd, R.tEnd + 0.35, t));
      if (t > R.tEnd + 0.4) { this.reveal = null; this.rays.visible = this.glow.visible = false; }
      else {
        const kb = this.k * (this.depth + BACK) / this.depth;      // px → world, back there
        this.v.set(0, 0, -BACK).applyQuaternion(this.camQ).add(this.O);
        this.rays.position.copy(this.v);
        this.glow.position.copy(this.v.set(0, 0, -BACK + 0.04).applyQuaternion(this.camQ).add(this.O));
        this.rays.quaternion.copy(this.camQ).multiply(this.q2.setFromAxisAngle(this.zAxis, -0.22 * (t - R.t0)));
        this.glow.quaternion.copy(this.camQ);
        this.rays.scale.setScalar(this.cardW * 3.3 * (0.85 + 0.15 * on) * kb);
        this.glow.scale.setScalar(this.cardW * 2.5 * (1 + 0.04 * Math.sin((t - R.t0) * 3)) * kb);
        (this.rays.material as THREE.MeshBasicMaterial).opacity = 0.62 * on;
        (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.85 * on;
        this.rays.visible = this.glow.visible = on > 0.002;
      }
    }
    // rain: from above the screen, across the play area
    if (t < this.rainUntil && R && t - R.t0 > 0.1) {
      this.rainAcc += dt * 60;
      while (this.rainAcc >= 1 && this.confs.length < CAP.conf) {
        this.rainAcc -= 1;
        this.confs.push({
          t0: t, life: rnd(2.2, 3.2), rain: true, fl: rnd(8, 22), ph: rnd(0, 6.28),
          p: new THREE.Vector3(W / 2 - this.at.x + rnd(-0.55, 0.55) * W, this.at.y + rnd(0.02, 0.12) * H, rnd(-80, 160)),
          v: new THREE.Vector3(0, -rnd(0.22, 0.4) * H, 0),
          size: base * rnd(0.005, 0.01), col: new THREE.Color(PALETTE[Math.floor(Math.random() * PALETTE.length)]),
        });
      }
    }
    // ---- confetti: burst (linear drag + gravity) or rain (fall + flutter)
    n = 0;
    const gc = base * 1.1, drag = 1.6, bottom = -(H - this.at.y) - 40;
    this.confs = this.confs.filter((f) => {
      const a = t - f.t0;
      if (a > f.life) return false;
      let x: number, y: number, z: number;
      if (f.rain) {
        x = f.p.x + Math.sin(f.ph + a * 3.2) * f.fl; y = f.p.y + f.v.y * a; z = f.p.z;
      } else {
        const e = (1 - Math.exp(-drag * a)) / drag;
        x = f.p.x + f.v.x * e; y = f.p.y + (f.v.y + gc / drag) * e - (gc / drag) * a; z = f.p.z + f.v.z * e;
      }
      if (y < bottom) return false;
      let sc = f.size * easeOutBack(lin(0, 0.12, a)) * (1 - smooth(0.8, 1, a / f.life));
      if (f.rain && t > this.rainFade) {
        const kf = 1 - smooth(this.rainFade, this.rainFade + 0.45, t);
        if (kf <= 0) return false;
        sc *= kf;
      }
      this.world(x, y, z, this.v);
      this.m4.compose(this.v, this.q.identity(), this.s.setScalar(Math.max(sc, 1e-3) * this.k));
      this.confMesh.setMatrixAt(n, this.m4);
      this.confMesh.setColorAt(n, f.col);
      n++;
      return true;
    });
    this.confMesh.count = n;
    this.confMesh.instanceMatrix.needsUpdate = true;
    if (this.confMesh.instanceColor) this.confMesh.instanceColor.needsUpdate = true;
  }
}
