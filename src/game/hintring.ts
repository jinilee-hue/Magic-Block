// The hint's ring (user: "힌트 줄때의 선 깜박이는거는 상위로 올려줘. 젠가 사이에 껴서 보이면 잘 안보여"): a soft ring round
// what is VISIBLE of one block, drawn over everything. The block's own outline mesh is depth-tested, so the blocks touching
// it hid most of it; that outline drawn on top would run round its hidden part as well — over the neighbour in front of it.
// Each frame while the ring shows: the blocks → a mask (black, the hinted block white where it is in front), then a
// screen-space ring round the white, over the finished frame, within the block's box on screen only.
import * as THREE from 'three';

/** camera layers for the mask: every block of the tower (Tower.build), and the hinted block while it is drawn */
export const BLOCK_LAYER = 1;
const TARGET_LAYER = 2;
/** the ring's width and its soft glow's reach (CSS px) */
const RING_PX = 5, GLOW_PX = 11;

export class HintRing {
  /** the block to ring (null = none) */
  target: THREE.Mesh | null = null;
  readonly color = new THREE.Color(0xffe46b);
  /** 0..1: the hint blinks it */
  opacity = 0;
  private rt = new THREE.WebGLRenderTarget(1, 1);
  /** the other blocks in the mask, a hair bigger: they close the hairline gaps between blocks, so a sliver of the hinted
   *  block peeking through one doesn't get a ring of its own (a streak along the neighbour's edge) */
  private black = (() => {
    const m = new THREE.MeshBasicMaterial({ color: 0x000000 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normal * 0.045;');
    };
    return m;
  })();
  private white = new THREE.MeshBasicMaterial({ color: 0xffffff, depthFunc: THREE.LessEqualDepth });
  private pos = new THREE.BufferAttribute(new Float32Array(12), 3);
  private mat = new THREE.ShaderMaterial({
    uniforms: {
      tMask: { value: null }, uTexel: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color() },
      uOpacity: { value: 0 }, uRing: { value: RING_PX }, uGlow: { value: GLOW_PX },
    },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D tMask; uniform vec2 uTexel; uniform vec3 uColor; uniform float uOpacity, uRing, uGlow;
      float m(vec2 p) { return texture2D(tMask, p).r; }
      void main() {
        vec2 uv = gl_FragCoord.xy * uTexel;
        // inside the visible block: no ring (softened over its edge, which is antialiased in the frame)
        float inside = 0.25 * (m(uv + vec2(0.5, 0.5) * uTexel) + m(uv + vec2(-0.5, 0.5) * uTexel)
          + m(uv + vec2(0.5, -0.5) * uTexel) + m(uv + vec2(-0.5, -0.5) * uTexel));
        if (inside > 0.99) discard;
        // the ring: within uRing px of the block; the glow: a faint halo out to uGlow px
        float ring = 0.0, glow = 0.0;
        for (int k = 0; k < 24; k++) {
          float a = float(k) * 0.2617994;
          vec2 d = vec2(cos(a), sin(a)) * uTexel;
          ring = max(ring, max(m(uv + d * uRing), m(uv + d * uRing * 0.5)));
          glow = max(glow, m(uv + d * uGlow));
        }
        float alpha = max(ring, glow * 0.35) * (1.0 - inside) * uOpacity;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(uColor, alpha);
      }`,
    transparent: true, depthTest: false, depthWrite: false,
  });
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private v = new THREE.Vector3();
  private size = new THREE.Vector2();
  private clear = new THREE.Color();

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', this.pos);
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const quad = new THREE.Mesh(g, this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** after the frame is drawn (Stage.tick): the ring over it */
  draw(r: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const t = this.target;
    if (!t || !t.visible || this.opacity < 0.01) return;
    // the block's box on screen (NDC) + room for the ring and its glow
    const geo = t.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      this.v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z)
        .applyMatrix4(t.matrixWorld).project(camera);
      x0 = Math.min(x0, this.v.x); x1 = Math.max(x1, this.v.x); y0 = Math.min(y0, this.v.y); y1 = Math.max(y1, this.v.y);
    }
    r.getDrawingBufferSize(this.size);
    const pr = r.getPixelRatio(), pad = GLOW_PX * pr + 3;
    x0 = Math.max(-1, x0 - pad * 2 / this.size.x); x1 = Math.min(1, x1 + pad * 2 / this.size.x);
    y0 = Math.max(-1, y0 - pad * 2 / this.size.y); y1 = Math.min(1, y1 + pad * 2 / this.size.y);
    if (!(x0 < x1 && y0 < y1)) return;
    // the mask: the other blocks in black (for the depth), then the hinted block in white where it is in front
    if (this.rt.width !== this.size.x || this.rt.height !== this.size.y) this.rt.setSize(this.size.x, this.size.y);
    const was = { rt: r.getRenderTarget(), auto: r.autoClear, alpha: r.getClearAlpha(), over: scene.overrideMaterial, layers: camera.layers.mask, shadows: r.shadowMap.autoUpdate };
    r.getClearColor(this.clear);
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.autoClear = false;
    scene.overrideMaterial = this.black; camera.layers.set(BLOCK_LAYER);
    t.layers.disable(BLOCK_LAYER);
    r.render(scene, camera);
    t.layers.enable(BLOCK_LAYER);
    t.layers.enable(TARGET_LAYER);
    scene.overrideMaterial = this.white; camera.layers.set(TARGET_LAYER);
    r.render(scene, camera);
    t.layers.disable(TARGET_LAYER);
    scene.overrideMaterial = was.over; camera.layers.mask = was.layers;
    r.setRenderTarget(was.rt);
    r.setClearColor(this.clear, was.alpha);
    r.shadowMap.autoUpdate = was.shadows;
    // the ring, over the frame (its colour as painted: the shader writes it straight out)
    (this.pos.array as Float32Array).set([x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0]);
    this.pos.needsUpdate = true;
    const u = this.mat.uniforms;
    u.tMask.value = this.rt.texture;
    u.uTexel.value.set(1 / this.size.x, 1 / this.size.y);
    u.uColor.value.copy(this.color).convertLinearToSRGB();
    u.uOpacity.value = this.opacity;
    u.uRing.value = RING_PX * pr; u.uGlow.value = GLOW_PX * pr;
    r.render(this.scene, this.cam);
    r.autoClear = was.auto;
  }
}
