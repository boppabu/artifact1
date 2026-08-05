// splats.js — builds an instanced Gaussian-splat mesh from raw buffers.
// Generic on purpose: feed it the output of generateNYC(), or a parsed
// INRIA/3DGS .ply later — same attribute layout, same shaders.
//
// The mesh carries an `instanceUV` attribute addressing each splat's texel in
// the GPU simulation textures (src/gpusim.js). If the simulation is
// unavailable, uUseSim drops to 0 and the shader falls back to the old
// stateless drift so the scene still renders.
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

  // Map each splat to its texel in the simulation textures.
  const simW = opts.simWidth ?? 256;
  const simH = opts.simHeight ?? Math.ceil(data.count / simW);
  const uvs = new Float32Array(data.count * 2);
  for (let i = 0; i < data.count; i++) {
    uvs[i * 2 + 0] = ((i % simW) + 0.5) / simW;
    uvs[i * 2 + 1] = (Math.floor(i / simW) + 0.5) / simH;
  }
  geo.setAttribute('instanceUV', inst(uvs, 2));
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
      uUseSim:    { value: 0 },           // raised to 1 once the sim exists
      uPosTex:    { value: null },
      uVelTex:    { value: null },
      // Speed-gated, so a splat at rest renders exactly as before.
      uAlign:     { value: opts.align ?? 0.85 },
      uStretch:   { value: opts.stretch ?? 0.85 },
      uAlignSpeed:{ value: opts.alignSpeed ?? 0.22 },
      uFlow:      { value: opts.flow ?? 0.03 }, // fallback path only
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    blending: THREE.AdditiveBlending,     // luminous; no per-frame sort needed
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;             // positions are simulated; bounds move
  mesh.renderOrder = 1;
  return mesh;
}
