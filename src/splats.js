// splats.js — builds an instanced Gaussian-splat mesh from raw buffers.
// Generic on purpose: feed it the output of generateNYC(), or a parsed
// INRIA/3DGS .ply later — same attribute layout, same shaders.
import * as THREE from 'three';
import { loadText } from './procedural.js';

export async function makeSplatMesh(data, sharedUniforms, opts = {}) {
  console.log('[splats]', data.count, 'gaussians');
  // Base unit quad, instanced once per splat.
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);

  const inst = (arr, size) => new THREE.InstancedBufferAttribute(arr, size);
  geo.setAttribute('instancePosition', inst(data.position, 3));
  geo.setAttribute('instanceColor',    inst(data.color, 3));
  geo.setAttribute('instanceScale',    inst(data.scale, 2));
  geo.setAttribute('instanceRotation', inst(data.rotation, 1));
  geo.setAttribute('instanceSeed',     inst(data.seed, 1));
  geo.setAttribute('instanceTwinkle',  inst(data.twinkle, 1));
  geo.instanceCount = data.count;

  const [vert, frag] = await Promise.all([
    loadText('./shaders/splat.vert'),
    loadText('./shaders/splat.frag'),
  ]);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime:      sharedUniforms.uTime,   // shared with the rest of the scene
      uOpacity:   { value: opts.opacity ?? 0.6 }, // tame additive over-bright
      uSplatScale:{ value: opts.splatScale ?? 1.0 }, // match world CITY_SCALE
      uFlow:      { value: opts.flow ?? 0.03 }, // sands-of-time drift (local units)
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    blending: THREE.AdditiveBlending,     // luminous; no per-frame sort needed
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;             // bounds are hand-managed by the group
  mesh.renderOrder = 1;
  return mesh;
}
