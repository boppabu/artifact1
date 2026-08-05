// main.js — minimal WebXR scene wired for Quest.
//
// Principles carried over from the Sevo splat renderer:
//   * Quest-first: stereo rendering, foveation on, hold a stable frame rate.
//   * Cheap per-fragment procedural color (paid twice, once per eye, under
//     overdraw) rather than heavy per-pixel work.
//   * No build step, compact, easy to swap the procedural layer.
//
// WebXR is the browser front end to OpenXR; on Quest the browser maps WebXR
// sessions onto the device's OpenXR runtime, so "use OpenXR" == "use WebXR" here.
//
// The splats are a MEDIUM, not decoration: their positions are simulated on the
// GPU (src/gpusim.js) under a superposition of real force fields
// (shaders/fields.glsl), gated by a reaction-diffusion automaton
// (src/automata.js) and conducted by a self-regulating entropy loop
// (src/conductor.js). The memory spring always dominates, so the skyline stays
// legible no matter how energetic the fields become.

import * as THREE from 'three';
import { VRButton } from './vrbutton.js';
import { OrbitControls } from './controls.js';
import { loadShaderSources, makeDomeMaterial } from './procedural.js';
import { generateNYC } from './nyc.js';
import { makeSplatMesh } from './splats.js';
import { createLocomotion } from './locomotion.js';
import { createGPUSim } from './gpusim.js';
import { createAutomata } from './automata.js';
import { createConductor, MODES } from './conductor.js';
import { createUI } from './ui.js';

// City placement: walkable scale, sitting on the floor and centered ahead so
// you start at street level facing in and move/fly through it.
const CITY_SCALE = 6.0;
const CITY_POS = new THREE.Vector3(0, 0, -22);
const CITY_EXTENT = 3.3;              // local half-size the fields are mapped over

// Per-field gains. The sim works in LOCAL units, and steady-state displacement
// is roughly F / (spring * (1 - 0.6*mobility)) — about F/18 at mid mobility.
// These are sized so a field at full drive pulls dust ~0.3-0.4 local units,
// i.e. right up against the 0.42 leash without ever passing it: strong, visible
// motion that still leaves the skyline legible. Tune these from the panel.
const GAIN = { wind: 12.0, mag: 14.0, chladni: 9.0, moire: 2.0, grav: 8.0 };

const clock = new THREE.Clock();
const uniforms = {
  uTime:   { value: 0 },
  uColorA: { value: new THREE.Color(0.45, 0.45, 0.55) },
  uColorB: { value: new THREE.Color(0.50, 0.40, 0.45) },
};

init().catch(showFatal);

// A black screen is almost always "opened as a file:// instead of over HTTP"
// (which blocks fetch of the .glsl shaders). Make that explain itself.
function showFatal(err) {
  console.error(err);
  if (window.__report) window.__report('INIT FAILED: ' + (err && (err.stack || err.message || err)));
  const el = document.getElementById('info');
  if (el) el.innerHTML =
    '<b style="color:#ff7b7b">Failed to start.</b><br>' +
    'This page must be served over HTTP(S), not opened as a file://.<br>' +
    '<span style="color:#8fa6c8">' + String(err) + '</span>';
}

async function init() {
  const renderer = createRenderer();
  document.body.appendChild(renderer.domElement);
  document.body.appendChild(VRButton.createButton(renderer));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    70, window.innerWidth / window.innerHeight, 0.05, 400);

  // The player rig: in VR you move THIS, never the camera. Camera + controllers
  // are parented to it so they travel together. It stays at the origin on
  // desktop so OrbitControls (which drives the camera directly) keeps working.
  const player = new THREE.Group();
  player.add(camera);
  scene.add(player);

  camera.position.copy(CITY_POS).add(new THREE.Vector3(5, 3.5, 7));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(CITY_POS).add(new THREE.Vector3(0, 4, 0));
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1;
  controls.maxDistance = 120;
  controls.update();

  const src = await loadShaderSources();
  buildScene(scene, src);

  // ---- the world ----------------------------------------------------------
  const data = generateNYC(7);
  const simW = 256;
  const simH = Math.ceil(data.count / simW);

  const automata = createAutomata({ size: 72 });

  const city = await makeSplatMesh(data, uniforms, {
    splatScale: CITY_SCALE, simWidth: simW, simHeight: simH,
  });
  const cityGroup = new THREE.Group();
  cityGroup.add(city);
  cityGroup.scale.setScalar(CITY_SCALE);
  cityGroup.position.copy(CITY_POS);
  scene.add(cityGroup);

  // ---- the simulation -----------------------------------------------------
  const sim = await createGPUSim(renderer, data, {
    caTexture: automata.texture,
    invExtent: 1 / CITY_EXTENT,
    caInvExtent: 1 / (CITY_EXTENT * 1.08),
    spring: 26.0, damp: 3.4, maxSpeed: 2.2, maxWander: 0.42,
  });
  const M = city.material.uniforms;
  if (sim) {
    M.uUseSim.value = 1;
    console.log('[sim]', sim.width + 'x' + sim.height, 'particle state');
  } else {
    console.warn('[sim] unavailable — using the stateless fallback flow');
  }

  const conductor = createConductor({ extent: CITY_EXTENT, maxWander: 0.42 });

  // ---- three gravitating bodies ------------------------------------------
  // Real mutual gravitation (the three-body problem is the canonical chaotic
  // system) plus a weak central tether so they stay over the city instead of
  // ejecting each other into the void.
  const bodies = [
    { p: new THREE.Vector3( 1.6, 1.1,  0.4), v: new THREE.Vector3( 0.00, 0, 0.22), m: 0.55 },
    { p: new THREE.Vector3(-1.3, 1.5, -1.1), v: new THREE.Vector3( 0.18, 0,-0.10), m: 0.48 },
    { p: new THREE.Vector3( 0.2, 0.8, -1.9), v: new THREE.Vector3(-0.20, 0, 0.05), m: 0.52 },
  ];
  const _r = new THREE.Vector3();
  function stepBodies(dt) {
    for (let i = 0; i < 3; i++) {
      const a = bodies[i];
      for (let j = 0; j < 3; j++) {
        if (i === j) continue;
        const b = bodies[j];
        _r.subVectors(b.p, a.p);
        const d2 = _r.lengthSq() + 0.25;
        a.v.addScaledVector(_r, (b.m * 0.9 / (d2 * Math.sqrt(d2))) * dt);
      }
      a.v.addScaledVector(a.p, -0.35 * dt);       // central tether
      a.v.multiplyScalar(1 - 0.02 * dt);
      a.p.addScaledVector(a.v, dt);
      a.p.y = THREE.MathUtils.clamp(a.p.y, 0.5, 2.2);
    }
  }

  // ---- controllers --------------------------------------------------------
  const controllers = addControllers(player, renderer);
  const locomotion = createLocomotion(renderer, camera, player);
  const _w = new THREE.Vector3();
  const worldToLocal = (v) => v.sub(CITY_POS).divideScalar(CITY_SCALE);

  let modeLabel = MODES[0].name;

  // Reads triggers/grips and turns the hands into force sources. When both
  // hands are tracked they also become the two magnetic poles, so holding them
  // apart draws the dust into field lines running between them.
  function updateHands(sim) {
    if (!sim) return;
    const U = sim.uniforms;
    const hands = [U.uHandA.value, U.uHandB.value];
    let poleA = null, poleB = null;

    for (let i = 0; i < 2; i++) {
      const c = controllers[i];
      const s = c.userData.inputSource;
      const h = hands[i];
      if (!s || !s.gamepad) { h.set(0, -999, 0, 0); continue; }

      c.getWorldPosition(_w);
      const lp = worldToLocal(_w.clone());
      if (i === 0) poleA = lp.clone(); else poleB = lp.clone();

      const gp = s.gamepad;
      const trigger = gp.buttons[0] ? gp.buttons[0].value : 0;   // push
      const grip    = gp.buttons[1] ? gp.buttons[1].value : 0;   // pull
      const strength = trigger * 4.5 - grip * 3.5;
      h.set(lp.x, lp.y, lp.z, strength);
    }

    if (poleA && poleB) {
      U.uPoleP.value.copy(poleA);
      U.uPoleN.value.copy(poleB);
    }
  }

  // Face buttons mirror the desktop keys (there is no keyboard in VR).
  // Quest "xr-standard": [0] trigger [1] grip [4] A/X [5] B/Y.
  function updateButtons() {
    for (const c of controllers) {
      const s = c.userData.inputSource;
      if (!s || !s.gamepad) continue;
      const gp = s.gamepad;
      const prev = c.userData.btnPrev || (c.userData.btnPrev = []);
      const edge = (idx) => {
        const b = gp.buttons[idx];
        const now = !!(b && b.pressed);
        const was = !!prev[idx];
        prev[idx] = now;
        return now && !was;
      };
      if (edge(4)) conductor.next();          // A / X : next field mode
      if (edge(5)) conductor.toggleLock();    // B / Y : hold the current mode
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.key >= '1' && e.key <= '5') conductor.setMode(parseInt(e.key, 10) - 1);
    if (e.key === '0') { if (conductor.state.locked) conductor.toggleLock(); }
    if (e.key === 'l' || e.key === 'L') conductor.toggleLock();
    if (e.key === 'r' || e.key === 'R') automata.reseed();
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---- 2D control panel (desktop only; the DOM is not composited in XR) ----
  const ui = createUI({
    sim, conductor, automata, material: city.material, gain: GAIN,
    onReseed: () => automata.reseed(),
  });

  // Debug handle: __sevo.conductor.state, __sevo.sim.uniforms, ...
  window.__sevo = { renderer, scene, camera, city, sim, automata, conductor, GAIN, ui };

  const hud = document.getElementById('status');
  let hudTimer = 0;
  let last = 0;
  let fps = 60;

  // The whole per-frame update, factored out so it can be driven manually
  // (__sevo.frame(dt, t)) for testing without relying on requestAnimationFrame.
  function frame(dt, t) {
    uniforms.uTime.value = t;

    automata.update(dt);
    const st = conductor.update(dt, t, automata.entropyBits);
    modeLabel = st.mode;
    stepBodies(dt);

    if (sim) {
      const U = sim.uniforms;
      U.wWind.value    = st.weights.wind    * GAIN.wind;
      U.wMag.value     = st.weights.mag     * GAIN.mag;
      U.wChladni.value = st.weights.chladni * GAIN.chladni;
      U.wMoire.value   = st.weights.moire   * GAIN.moire;
      U.wGrav.value    = st.weights.grav    * GAIN.grav;
      U.uRelease.value = st.release;
      U.uChladniNM.value.set(st.nm[0], st.nm[1]);
      U.uMoireA.value = st.rotA;
      U.uMoireB.value = st.rotB;
      U.uBody0.value.set(bodies[0].p.x, bodies[0].p.y, bodies[0].p.z, bodies[0].m);
      U.uBody1.value.set(bodies[1].p.x, bodies[1].p.y, bodies[1].p.z, bodies[1].m);
      U.uBody2.value.set(bodies[2].p.x, bodies[2].p.y, bodies[2].p.z, bodies[2].m);

      // Ambient poles orbit slowly unless the hands have taken them over.
      if (!controllers[0].userData.inputSource || !controllers[1].userData.inputSource) {
        U.uPoleP.value.set(Math.cos(t * 0.11) * 1.7, 0.9, Math.sin(t * 0.11) * 1.7);
        U.uPoleN.value.set(-Math.cos(t * 0.11) * 1.7, 0.7, -Math.sin(t * 0.11) * 1.7);
      }

      updateHands(sim);
      sim.step(dt, t);
      M.uPosTex.value = sim.positionTexture;
      M.uVelTex.value = sim.velocityTexture;
    }

    updateButtons();
    locomotion.update(dt);
    if (!renderer.xr.isPresenting) controls.update();
    renderer.render(scene, camera);

    if (dt > 0) fps += (1 / dt - fps) * 0.06;
    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      if (hud) {
        hud.textContent = `field: ${modeLabel}${st.locked ? ' (held)' : ''}` +
          `  ·  entropy ${st.entropy.toFixed(2)}  ·  drive ${st.drive.toFixed(2)}`;
      }
      ui.refresh({ fps, splats: data.count, sim: !!sim });
    }
  }

  renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime();
    const dt = Math.min(t - last, 0.1); // clamp hitches so a stall can't teleport you
    last = t;
    frame(dt, t);
  });

  window.__sevo.frame = frame;
  window.__sevoReady = true;
}

function createRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setFoveation(0.5); // cheaper periphery, like a coarse LOD
  renderer.setClearColor(0x05060a);
  return renderer;
}

function buildScene(scene, src) {
  // Procedural night sky — you are inside it.
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(80, 48, 32),
    makeDomeMaterial(src, uniforms));
  scene.add(dome);

  // A faint grounding grid so you keep a sense of ground and motion in VR.
  const grid = new THREE.GridHelper(120, 120, 0x1b2740, 0x101826);
  grid.material.opacity = 0.35;
  grid.material.transparent = true;
  scene.add(grid);
}

function addControllers(parent, renderer) {
  // Minimal controller pointers — a line forward from each hand. Parented to
  // the player rig so they move with you during locomotion. We stash each
  // controller's inputSource so the sim can read triggers and hand positions.
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  const controllers = [];
  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i);
    const ray = new THREE.Line(lineGeo,
      new THREE.LineBasicMaterial({ color: 0x66ccff }));
    ray.scale.z = 3;
    controller.add(ray);
    controller.addEventListener('connected', (e) => { controller.userData.inputSource = e.data; });
    controller.addEventListener('disconnected', () => { controller.userData.inputSource = null; });
    parent.add(controller);
    controllers.push(controller);
  }
  return controllers;
}
