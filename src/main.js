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
// three.js loads from cdnjs (see index.html import map); VRButton/OrbitControls
// are local modules (./vrbutton.js, ./controls.js).

import * as THREE from 'three';
import { VRButton } from './vrbutton.js';
import { OrbitControls } from './controls.js';
import { loadShaderSources, makeDomeMaterial } from './procedural.js';
import { generateNYC } from './nyc.js';
import { makeSplatMesh } from './splats.js';
import { createLocomotion } from './locomotion.js';

// City placement: walkable scale, sitting on the floor and centered ahead so
// you start at street level facing in and move/fly through it.
const CITY_SCALE = 6.0;
const CITY_POS = new THREE.Vector3(0, 0, -22);

const clock = new THREE.Clock();
const uniforms = {
  uTime:   { value: 0 },
  uColorA: { value: new THREE.Color(0.45, 0.45, 0.55) },
  uColorB: { value: new THREE.Color(0.50, 0.40, 0.45) },
};

init().catch(showFatal);

// A black screen is almost always "opened as a file:// instead of via a server"
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

  // Desktop: orbit/zoom for an overview. Inert in VR (XR owns the camera).
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

  // The world: a procedurally generated Gaussian-splat New York, scaled up so
  // you can walk and fly through its streets.
  const city = await makeSplatMesh(generateNYC(7), uniforms,
    { splatScale: CITY_SCALE });
  const cityGroup = new THREE.Group();
  cityGroup.add(city);
  cityGroup.scale.setScalar(CITY_SCALE);
  cityGroup.position.copy(CITY_POS);
  scene.add(cityGroup);

  addControllers(player, renderer);
  const locomotion = createLocomotion(renderer, camera, player);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let last = 0;
  renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime();
    const dt = Math.min(t - last, 0.1); // clamp hitches so a stall can't teleport you
    last = t;
    uniforms.uTime.value = t;
    locomotion.update(dt);
    if (!renderer.xr.isPresenting) controls.update();
    renderer.render(scene, camera);
  });

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
  // the player rig so they move with you during locomotion.
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i);
    const ray = new THREE.Line(lineGeo,
      new THREE.LineBasicMaterial({ color: 0x66ccff }));
    ray.scale.z = 3;
    controller.add(ray);
    parent.add(controller);
  }
}
