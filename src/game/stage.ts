// three.js stage: renderer (transparent over the painted room, public/ui/bg.webp), soft key light with shadows, and
// a camera that orbits the tower (drag = turn / tilt, pinch or wheel = zoom). Taps are reported separately.
// The tower stands on the round table PAINTED in the background: the orbit centre is the tower's foot, and a view
// offset pins it on the painted table-top for any screen size (background-size: cover). Turning, tilting a little
// and zooming all keep the foot on the table. Only shadows are drawn on the table (a shadow-catcher disc).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { H, L, LAYERS } from './tower';
import { HintRing } from './hintring';

export interface TapEvent { x: number; y: number; ndc: THREE.Vector2 }

const DEG = Math.PI / 180;
/** the painted table in bg.webp (image px): centre and half-width of the table-top ellipse (it is seen ~9° from above).
 *  Measured on the pink table of the re-uploaded jenga_bg (top surface x 750–2003, y 1146–1337). */
export const BG = { w: 2752, h: 1536, cx: 1377, cy: 1241, rx: 626 };
const EL0 = 9;            // degrees: matches the painted table's ellipse (ry / rx ≈ 0.155)
const TOWER_H = LAYERS * H + 0.8;   // world units to fit between the HUD and the table: the layers + a margin
const TABLE_MIN = 4;      // the painted table-top is at least this wide (radius, world units): bigger blocks than that won't fit

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
  readonly world = new THREE.Group();
  /** orbit state (target = the tower's foot on the table) */
  readonly rig = { az: 28 * DEG, el: EL0 * DEG, zoom: 1, target: new THREE.Vector3(0, 0, 0), azVel: 0 };
  /** radius of the painted table-top in world units (shadow catcher, physics in collapse.ts) */
  tableR = 6;
  /** where the table-top centre is on screen (CSS px) */
  tableAt = { x: 0, y: 0, rx: 0 };
  /** CSS px per world unit at the tower's foot */
  pxPerUnit = 1;
  /** the painted background element: it zooms with the camera (around the table) so the tower stays on its table */
  bg: HTMLElement | null = null;
  private bgZoom = 1;
  private goal: { az: number; el: number; zoom: number } | null = null;
  controls = true;
  onTap: (e: TapEvent) => void = () => {};
  onHover: (e: TapEvent | null) => void = () => {};
  onUserTurn: () => void = () => {};
  onResize: () => void = () => {};
  private w = 1; private h = 1;
  private fitDist = 30;
  private catcher: THREE.Mesh;
  private occluder: THREE.Mesh;
  /** a soft light veil between the camera and the tower while a word is being read (see focus()) */
  private scrim: THREE.Mesh;
  private scrimGoal = 0;
  private tickers = new Set<(dt: number, t: number) => void>();
  private last = performance.now();
  private clock = 0;
  /** the game screen's view (setGameView, from main.ts): a little closer — bigger tower, the painted room zooms along —
   *  with a light on the tower (user: "게임화면에 들어간 젠가 크기는 좀더 키워줘",
   *  "게임화면에서 조명이 젠가 탑을 비추게", "젠가에 좀 집중이 되게 하고싶어") */
  private homeZoom = 1;
  private spot: THREE.SpotLight;
  private spotOn = 0;
  private spotGoal = 0;
  /** 2D layers between the painting and the 3D canvas (screen blend: light only): [the light's pool on the table, the beam] */
  private focusEls: HTMLElement[] = [];
  private focusKey = '';
  /** the hint's ring round what is visible of a block, drawn over the finished frame (hintring.ts) */
  readonly ring = new HintRing();
  private v0 = new THREE.Vector3();

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
    r.domElement.setAttribute('aria-label', 'Magic Block tower');

    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.42;

    // warm room light: the window is on the left of the painting, so the key light comes from the left. Ambient a bit
    // under the old 1.55 so the sides turned away from the window still shade like the painted furniture
    const hemi = new THREE.HemisphereLight(0xfff6ea, 0xe2bea4, 1.35);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffeedd, 2.2);
    key.position.set(-9, 15, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -10; sc.right = 10; sc.top = 14; sc.bottom = -7; sc.near = 1; sc.far = 50;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 6;
    key.target.position.set(0, 4, 0);
    this.scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xffe9dc, 0.45);
    fill.position.set(9, 6, -4);
    this.scene.add(fill);
    // the game screen's light on the tower (setGameView): from above and in front — it goes round with the view (place) —
    // wide enough that the whole tower is in its even core (a fall-off on the tower would darken its top and foot), no
    // shadow (the key light makes the one shadow)
    this.spot = new THREE.SpotLight(0xfff4e2, 0, 0, 0.62, 0.5, 0);
    this.spot.target.position.set(0, LAYERS * H * 0.55, 0);
    this.scene.add(this.spot, this.spot.target);

    this.scene.add(this.world);
    // the painted table only gets the tower's shadow, plus a soft contact shadow right under its foot. The shadow fades
    // out with the distance from the tower's SIDES (0.3 → 1.8 units: from its centre it already faded at the corners and
    // seemed cut off — "젠가의 테이블에 있는 그림자가 끊어져 있어"), so its long tail never runs to the table's edge and gets cut there
    // (user: "젠가 그림자가 테이블에 맞지 않은데") — the painting's light is soft, so a short soft shadow fits it
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.2, color: 0x6b3f22 });
    shadowMat.onBeforeCompile = (sh) => {
      sh.uniforms.uFade = { value: new THREE.Vector2(0.3, 1.8) }; sh.uniforms.uFoot = { value: L / 2 }; sh.uniforms.uSoftR = { value: 45 };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFadeXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFadeXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vFadeXZ;\nuniform vec2 uFade;\nuniform float uFoot;\nuniform float uSoftR;')
        .replace('getShadowMask()', 'softShadowMask()')
        .replace('#include <shadowmask_pars_fragment>', `#include <shadowmask_pars_fragment>\n${SOFT_SHADOW}`)
        .replace('#include <tonemapping_fragment>', 'gl_FragColor.a *= 1.0 - smoothstep(uFade.x, uFade.y, length(max(abs(vFadeXZ) - vec2(uFoot), 0.0)));\n#include <tonemapping_fragment>');
    };
    this.catcher = new THREE.Mesh(new THREE.CircleGeometry(1, 96), shadowMat);
    this.catcher.rotation.x = -Math.PI / 2; this.catcher.position.y = 0.002; this.catcher.receiveShadow = true;
    // an invisible stand-in for the painted table (depth only, drawn first): blocks that fall behind or below it
    // in the final crash are hidden by it instead of showing through the painting
    this.occluder = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 30, 64), new THREE.MeshBasicMaterial({ colorWrite: false }));
    this.occluder.position.y = -15; this.occluder.renderOrder = -10;
    this.world.add(this.occluder, this.catcher, contactShadow());
    // the veil sits 13 units in front of the camera: behind the presented block (10), in front of the tower (≥ 20)
    this.scrim = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: veilTexture(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    this.scrim.visible = false; this.scrim.renderOrder = 5;
    this.scene.add(this.scrim);

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
    const c = this.camera;
    c.aspect = w / h;
    // where the painted table lands (CSS background-size: cover, centred)
    const s = Math.max(w / BG.w, h / BG.h);
    const t = this.tableAt = { x: (w - BG.w * s) / 2 + BG.cx * s, y: (h - BG.h * s) / 2 + BG.cy * s, rx: BG.rx * s };
    // scale: the whole tower between the top bar (≈13.5 u) and the table, as big as the painted table allows
    const u = Math.min(h / 100, w * 0.005625);
    const k = Math.min((t.y - 13.5 * u) / TOWER_H, t.rx / TABLE_MIN);   // CSS px per world unit at the tower's foot
    this.pxPerUnit = k;
    this.tableR = t.rx / k;
    this.catcher.scale.setScalar(this.tableR);
    this.occluder.scale.set(this.tableR, 1, this.tableR);
    this.fitDist = (h / 2) / (k * Math.tan(c.fov * DEG / 2));
    // the orbit centre (tower foot) shows at the table-top centre instead of the middle of the screen
    c.setViewOffset(w, h, w / 2 - t.x, h / 2 - t.y, w, h);
    c.updateProjectionMatrix();
    this.bg?.style.setProperty('transform-origin', `${t.x}px ${t.y}px`);
    // the title lays the START button on the painted table (CSS reads these)
    const root = document.documentElement.style;
    root.setProperty('--table-x', `${t.x.toFixed(1)}px`); root.setProperty('--table-y', `${t.y.toFixed(1)}px`); root.setProperty('--table-rx', `${t.rx.toFixed(1)}px`);
    if (this.spotGoal > 0) this.setGameView(true);       // turned round: the closer view for the new shape
    this.onResize();
  }

  get size() { return { w: this.w, h: this.h }; }
  get dist() { return this.fitDist * this.rig.zoom; }

  /** animate the view to a pose (degrees) */
  turnTo(azDeg: number | null, elDeg: number | null = null, zoom: number | null = null) {
    this.goal = { az: azDeg == null ? this.rig.az : azDeg * DEG, el: elDeg == null ? this.rig.el : elDeg * DEG, zoom: zoom ?? this.rig.zoom };
  }
  turnBy(dAzDeg: number) { const a = (this.goal?.az ?? this.rig.az) + dAzDeg * DEG; this.goal = { az: a, el: this.goal?.el ?? this.rig.el, zoom: this.goal?.zoom ?? this.rig.zoom }; }
  home() { this.turnTo(28 + 90 * Math.round((this.rig.az / DEG - 28) / 90), EL0, this.homeZoom); }
  /** back to the view a game starts with (the reset button — user: "원위치 버튼"): first angle, tilt and zoom, the short way */
  resetView() {
    const a0 = 28 * DEG, a = this.goal?.az ?? this.rig.az;
    this.rig.azVel = 0;
    this.turnTo((a0 + Math.round((a - a0) / (2 * Math.PI)) * 2 * Math.PI) / DEG, EL0, this.homeZoom);
  }
  /** stop any turn in progress (the title sets the view itself every frame) */
  stopTurn() { this.goal = null; this.rig.azVel = 0; }
  /** the painted table's own viewing angle (degrees) */
  static readonly EL0 = EL0;

  /** veil the tower and the room (not the presented block, the HUD or the fox) so the picture and the word stand out */
  focus(on: boolean) { this.scrimGoal = on ? 1 : 0; if (on) this.scrim.visible = true; }

  /** the game screen's view on / off: the zoom eases there (a pending turn keeps its angles), the light fades in / out.
   *  Wide screens go closer; portrait stays fitted (a bigger tower would run into the fox there). */
  setGameView(on: boolean) {
    const a = this.w / Math.max(1, this.h);
    this.homeZoom = on ? Math.min(1, (a >= 1.2 ? GAME_ZOOM : a >= 1 ? (1 + GAME_ZOOM) / 2 : 1) / GAME_SIZE) : 1;
    if (this.goal) this.goal.zoom = this.homeZoom; else this.goal = { az: this.rig.az, el: this.rig.el, zoom: this.homeZoom };
    this.spotGoal = on ? 1 : 0;
    this.ensureFocusEls();
    this.focusKey = '';
  }

  private ensureFocusEls() {
    if (this.focusEls.length || !this.bg) return;
    for (const cls of ['focus-glow', 'focus-beam']) {
      const el = document.createElement('div');
      el.className = cls; el.setAttribute('aria-hidden', 'true');
      Object.assign(el.style, { position: 'absolute', inset: '0', zIndex: '0', pointerEvents: 'none', opacity: '0', mixBlendMode: 'screen' });
      this.focusEls.push(el);
    }
    // right after the painting (same layer, later = on top of it), under the 3D canvas: the beam, then the glow
    this.bg.after(this.focusEls[1], this.focusEls[0]);
  }

  /** the light: the 3D spot's strength, the 2D layers' opacity and shapes (rewritten only when the tower moves on screen) */
  private placeFocus(dt: number) {
    if (this.spotOn === this.spotGoal && this.spotOn === 0) return;
    const d = this.spotGoal - this.spotOn;
    this.spotOn = Math.abs(d) < 0.003 ? this.spotGoal : this.spotOn + d * (1 - Math.pow(0.04, dt));
    this.spot.intensity = SPOT_I * this.spotOn;
    const [glow, beam] = this.focusEls;
    if (!glow || !beam) return;
    const op = this.spotOn.toFixed(3);
    if (glow.style.opacity !== op) { glow.style.opacity = op; beam.style.opacity = op; }
    if (this.spotOn === 0) return;
    const R = this.rig, z = R.zoom, k = this.pxPerUnit / z;
    const foot = this.project(this.v0.set(R.target.x, 0, R.target.z));
    const top = this.project(this.v0.set(R.target.x, LAYERS * H, R.target.z));
    const key = `${foot.x.toFixed(0)}|${foot.y.toFixed(0)}|${top.y.toFixed(0)}|${k.toFixed(1)}|${this.w}x${this.h}`;
    if (key === this.focusKey) return;
    this.focusKey = key;
    const cx = foot.x, th = foot.y - top.y, midY = (foot.y + top.y) / 2, px = (v: number) => `${v.toFixed(0)}px`;
    // the light's pool on the table round its foot — light only, the room keeps its colours (a darkened room looked drab:
    // "배경이랑 탁자를 너무 죽여서 약간 칙칙해보이는데")
    const prx = this.tableAt.rx * 0.82 / z, pry = prx * 0.2;
    glow.style.background = `radial-gradient(ellipse ${px(prx)} ${px(pry)} at ${px(cx)} ${px(foot.y)}, rgba(255, 236, 200, ${POOL}) 0%, `
      + `rgba(255, 236, 200, ${(POOL * 0.45).toFixed(2)}) 55%, rgba(255, 236, 200, 0) 100%)`;
    // the beam: a soft wedge of light from above the screen down onto the tower, fading out before the table (it stays
    // behind the tower: a haze in front of it would wash the blocks out)
    const apexY = top.y - th * 1.15, half = Math.atan2(1.45 * k, top.y - apexY) / DEG, soft = Math.max(1.2, half * 0.45);
    beam.style.background = `conic-gradient(from ${(180 - half - soft).toFixed(2)}deg at ${px(cx)} ${px(apexY)}, `
      + `rgba(255, 249, 234, 0) 0deg, rgba(255, 249, 234, ${BEAM}) ${soft.toFixed(2)}deg, rgba(255, 249, 234, ${BEAM}) ${(soft + 2 * half).toFixed(2)}deg, `
      + `rgba(255, 249, 234, 0) ${(2 * soft + 2 * half).toFixed(2)}deg)`;
    const m = `linear-gradient(to bottom, rgba(0, 0, 0, 0) ${px(Math.max(0, top.y - th * 0.7))}, #000 ${px(top.y - th * 0.05)}, `
      + `#000 ${px(midY)}, rgba(0, 0, 0, 0) ${px(foot.y)})`;
    beam.style.maskImage = m; beam.style.setProperty('-webkit-mask-image', m);
  }

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
    this.placeScrim(dt);
    this.placeFocus(dt);
    for (const f of this.tickers) f(dt, this.clock);
    this.renderer.render(this.scene, this.camera);
    this.ring.draw(this.renderer, this.scene, this.camera);
  }

  private placeScrim(dt: number) {
    const m = this.scrim.material as THREE.MeshBasicMaterial;
    if (!this.scrim.visible) return;
    m.opacity += (this.scrimGoal - m.opacity) * (1 - Math.pow(0.002, dt));
    if (this.scrimGoal === 0 && m.opacity < 0.01) { m.opacity = 0; this.scrim.visible = false; return; }
    // in front of the camera, big enough for the whole (offset) view
    const c = this.camera, d = 13;
    const fwd = c.getWorldDirection(new THREE.Vector3());
    this.scrim.position.copy(c.position).addScaledVector(fwd, d);
    this.scrim.quaternion.copy(c.quaternion);
    const hh = 2 * d * Math.tan(c.fov * DEG / 2);
    this.scrim.scale.set(hh * c.aspect * 3, hh * 3, 1);
  }

  place() {
    const R = this.rig, d = this.dist;
    const c = this.camera;
    c.position.set(R.target.x + d * Math.cos(R.el) * Math.sin(R.az), R.target.y + d * Math.sin(R.el), R.target.z + d * Math.cos(R.el) * Math.cos(R.az));
    c.lookAt(R.target);
    c.updateMatrixWorld();
    // the tower's light goes round with the view: above, in front
    this.spot.position.set(R.target.x + Math.sin(R.az) * 12, 14, R.target.z + Math.cos(R.az) * 12);
    // zooming in brings the painted room along (scaled around the table), so the tower never outgrows its table
    if (this.bg && Math.abs(R.zoom - this.bgZoom) > 1e-4) {
      this.bgZoom = R.zoom;
      this.bg.style.transform = R.zoom > 0.9999 ? '' : `scale(${(1 / R.zoom).toFixed(4)})`;
    }
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
        if (pinch0 > 0) { this.rig.zoom = clamp(zoom0 * pinch0 / d, ZOOM[0], ZOOM[1]); this.goal = null; }
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
        // a painted table can only be looked at from about its own angle: a little tilt, not a bird's-eye view
        this.rig.el = clamp(this.rig.el + dy * k * 0.5, 5 * DEG, 16 * DEG);
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
    el.addEventListener('wheel', (e) => { if (!this.controls) return; e.preventDefault(); this.goal = null; this.rig.zoom = clamp(this.rig.zoom * Math.exp(e.deltaY * 0.0012), ZOOM[0], ZOOM[1]); }, { passive: false });
  }
}

/** the table's shadow, blurred wide: 32 taps on a fixed Vogel spiral (no grain) over uSoftR texels. The light's own PCF
 *  (5 taps) left the tower's shadow edge sharp from the foot's corner — it looked cut off under the end faces (user:
 *  "젠가 아래 테이블에 그림자가 어색하게 끊겨 있어. t 밑에 확인해봐"). Only the table's material: the blocks keep theirs. */
const SOFT_SHADOW = `
float softShadowMask() {
  float s = 1.0;
  #if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_PCF ) && NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow ls = directionalLightShadows[ 0 ];
    vec4 sc = vDirectionalShadowCoord[ 0 ];
    sc.xyz /= sc.w;
    sc.z += ls.shadowBias;
    if ( sc.x >= 0.0 && sc.x <= 1.0 && sc.y >= 0.0 && sc.y <= 1.0 && sc.z <= 1.0 ) {
      float r = uSoftR / ls.shadowMapSize.x, sum = 0.0;
      for ( int i = 0; i < 32; i ++ ) sum += texture( directionalShadowMap[ 0 ], vec3( sc.xy + vogelDiskSample( i, 32, 0.0 ) * r, sc.z ) );
      s = mix( 1.0, sum / 32.0, ls.shadowIntensity );
    }
  #endif
  return s;
}
`;

/** closer (bigger tower; the painted room zooms along) .. the fitted view; never farther — the painting would end */
const ZOOM = [0.78, 1] as const;
/** the game screen's view on a wide screen (setGameView): ~16 % bigger tower, its top still clear of the screen's top —
 *  then 98 % of that (user: "젠가 블럭 탑을 전체 크기를 지금의 98%로 줄여줘"). Zoom 1 is as far as the painting allows,
 *  so portrait stays fitted */
const GAME_ZOOM = 0.86, GAME_SIZE = 0.98;
/** the game screen's light: the spot on the tower, the pool on the table, the beam (light only — the room is not darkened) */
const SPOT_I = 0.8, POOL = 0.5, BEAM = 0.18;
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** the reading veil: warm cream, a little stronger in the middle where the picture and the word float */
function veilTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255, 248, 240, 0.55)'); gr.addColorStop(0.6, 'rgba(255, 248, 240, 0.45)'); gr.addColorStop(1, 'rgba(255, 248, 240, 0.32)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** a soft dark edge all round the tower's foot so it sits ON the painted table: a rounded square the size of the
 *  footprint, darkest at the blocks and gone 1.2 units out. (A round blot from the centre was faint at the corners: under
 *  the front block the shadow faded out toward its end — user: "젠가의 테이블에 있는 그림자가 끊어져 있어") */
function contactShadow() {
  const N = 256, SIZE = 5.6, half = L / 2, rc = 0.15, reach = 1.2;
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N - 0.5) * SIZE, z = ((j + 0.5) / N - 0.5) * SIZE;
      const d = Math.max(0, Math.hypot(Math.max(Math.abs(x) - half + rc, 0), Math.max(Math.abs(z) - half + rc, 0)) - rc);
      const t = Math.min(1, d / reach), k = 1 - t * t * (3 - 2 * t);
      const o = (j * N + i) * 4;
      img.data[o] = 90; img.data[o + 1] = 50; img.data[o + 2] = 25; img.data[o + 3] = Math.round(255 * 0.36 * k * k);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.004; m.renderOrder = -1;
  return m;
}
