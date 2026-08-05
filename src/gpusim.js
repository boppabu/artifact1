// gpusim.js — a minimal GPU particle simulator (ping-pong float textures).
//
// This is the TouchDesigner model: particle state lives in textures, two
// fragment passes advance it each frame, and the render pass just reads the
// result. It is deliberately hand-rolled (~120 lines) rather than pulled from
// three/addons, so the page keeps loading with no extra dependencies.
//
// Why state at all? Because everything the scene is trying to do — filings
// clumping along field lines, sand collecting on Chladni nodes, dust being
// blown and then settling — are ACCUMULATION phenomena. A stateless
// position = home + noise(home, t) can shimmer but can never gather.
//
// Bonus: forces now run once per splat instead of once per vertex (four per
// splat), so the sophisticated version is cheaper than the old inline flow.

import * as THREE from 'three';
import { loadText } from './procedural.js';

const SIM_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Float render targets are required. WebGL2 exposes them via EXT_color_buffer_*.
// Quest Browser has these, but we probe rather than assume — if they are
// missing the caller keeps the old stateless path instead of showing nothing.
function pickType(renderer) {
  const gl = renderer.getContext();
  if (gl.getExtension('EXT_color_buffer_float')) return THREE.FloatType;
  if (gl.getExtension('EXT_color_buffer_half_float')) return THREE.HalfFloatType;
  return null;
}

function makeTarget(w, h, type) {
  return new THREE.WebGLRenderTarget(w, h, {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  });
}

export async function createGPUSim(renderer, data, opts = {}) {
  const type = pickType(renderer);
  if (type === null) {
    console.warn('[gpusim] no float render targets — falling back to stateless flow');
    return null;
  }

  const count = data.count;
  const W = 256;
  const H = Math.ceil(count / W);

  // ---- home positions: the city's memory, never modified ------------------
  const home = new Float32Array(W * H * 4);
  for (let i = 0; i < count; i++) {
    home[i * 4 + 0] = data.position[i * 3 + 0];
    home[i * 4 + 1] = data.position[i * 3 + 1];
    home[i * 4 + 2] = data.position[i * 3 + 2];
    home[i * 4 + 3] = data.seed[i];
  }
  const homeTex = new THREE.DataTexture(home, W, H, THREE.RGBAFormat, THREE.FloatType);
  homeTex.minFilter = homeTex.magFilter = THREE.NearestFilter;
  homeTex.needsUpdate = true;

  const [common, fields, velSrc, posSrc] = await Promise.all([
    loadText('./shaders/common.glsl'),
    loadText('./shaders/fields.glsl'),
    loadText('./shaders/sim.vel.frag'),
    loadText('./shaders/sim.pos.frag'),
  ]);
  const prelude = common + '\n' + fields + '\n';

  // ---- ping-pong targets ---------------------------------------------------
  const pos = [makeTarget(W, H, type), makeTarget(W, H, type)];
  const vel = [makeTarget(W, H, type), makeTarget(W, H, type)];
  let cur = 0;

  // ---- fullscreen pass plumbing -------------------------------------------
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quadMesh = new THREE.Mesh(quadGeo, null);
  quadScene.add(quadMesh);

  function pass(material, target) {
    quadMesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }

  const velUniforms = {
    uPos: { value: null }, uVel: { value: null }, uHome: { value: homeTex },
    uCA: { value: opts.caTexture ?? null },
    uDt: { value: 0.016 }, uTime: { value: 0 },
    uSpring: { value: opts.spring ?? 26.0 },
    uDamp: { value: opts.damp ?? 3.4 },
    uMaxSpeed: { value: opts.maxSpeed ?? 2.2 },
    uRelease: { value: 0.0 },
    wWind: { value: 0 }, wMag: { value: 0 }, wChladni: { value: 0 },
    wMoire: { value: 0 }, wGrav: { value: 0 },
    uChladniNM: { value: new THREE.Vector2(3, 5) },
    uMoireA: { value: 0 }, uMoireB: { value: 0.05 },
    uMoireFreq: { value: opts.moireFreq ?? 9.0 },
    uBody0: { value: new THREE.Vector4(0, 0, 0, 0) },
    uBody1: { value: new THREE.Vector4(0, 0, 0, 0) },
    uBody2: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHandA: { value: new THREE.Vector4(0, -999, 0, 0) },
    uHandB: { value: new THREE.Vector4(0, -999, 0, 0) },
    uPoleP: { value: new THREE.Vector3(1.2, 0.6, 0) },
    uPoleN: { value: new THREE.Vector3(-1.2, 0.6, 0) },
    uInvExtent: { value: opts.invExtent ?? 0.30 },
    uCAInvExtent: { value: opts.caInvExtent ?? 0.28 },
  };

  const velMat = new THREE.ShaderMaterial({
    uniforms: velUniforms, vertexShader: SIM_VERT,
    fragmentShader: prelude + velSrc, depthTest: false, depthWrite: false,
  });

  const posUniforms = {
    uPos: { value: null }, uVel: { value: null }, uHome: { value: homeTex },
    uDt: { value: 0.016 },
    uMaxWander: { value: opts.maxWander ?? 0.42 },
  };
  const posMat = new THREE.ShaderMaterial({
    uniforms: posUniforms, vertexShader: SIM_VERT,
    fragmentShader: prelude + posSrc, depthTest: false, depthWrite: false,
  });

  // ---- seed: position = home, velocity = 0 --------------------------------
  const seedMat = new THREE.ShaderMaterial({
    uniforms: { uHome: { value: homeTex }, uMode: { value: 0 } },
    vertexShader: SIM_VERT,
    fragmentShader: `
      uniform sampler2D uHome; uniform float uMode; varying vec2 vUv;
      void main() {
        gl_FragColor = (uMode < 0.5) ? texture2D(uHome, vUv) : vec4(0.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const prevTarget = renderer.getRenderTarget();
  const xrWas = renderer.xr.enabled;
  renderer.xr.enabled = false;
  seedMat.uniforms.uMode.value = 0; pass(seedMat, pos[0]); pass(seedMat, pos[1]);
  seedMat.uniforms.uMode.value = 1; pass(seedMat, vel[0]); pass(seedMat, vel[1]);
  renderer.xr.enabled = xrWas;
  renderer.setRenderTarget(prevTarget);

  return {
    width: W, height: H, count,
    uniforms: velUniforms,
    posUniforms,
    get positionTexture() { return pos[cur].texture; },
    get velocityTexture() { return vel[cur].texture; },
    // Render targets exposed for debugging readback (renderer.readRenderTargetPixels).
    get positionTarget() { return pos[cur]; },
    get velocityTarget() { return vel[cur]; },
    homeTexture: homeTex,

    step(dt, time) {
      // Clamp dt so a dropped frame or a headset hiccup can't blow up the
      // integrator (a big dt with a stiff spring is how these explode).
      const h = Math.min(dt, 1 / 45);
      const nxt = 1 - cur;

      velUniforms.uDt.value = h;
      velUniforms.uTime.value = time;
      posUniforms.uDt.value = h;

      // Off-screen passes must not run through the XR camera rig.
      const prevRT = renderer.getRenderTarget();
      const wasXR = renderer.xr.enabled;
      renderer.xr.enabled = false;

      velUniforms.uPos.value = pos[cur].texture;
      velUniforms.uVel.value = vel[cur].texture;
      pass(velMat, vel[nxt]);

      posUniforms.uPos.value = pos[cur].texture;
      posUniforms.uVel.value = vel[nxt].texture;
      pass(posMat, pos[nxt]);

      renderer.xr.enabled = wasXR;
      renderer.setRenderTarget(prevRT);
      cur = nxt;
    },

    dispose() {
      pos.forEach((t) => t.dispose());
      vel.forEach((t) => t.dispose());
      homeTex.dispose(); quadGeo.dispose();
      velMat.dispose(); posMat.dispose(); seedMat.dispose();
    },
  };
}
