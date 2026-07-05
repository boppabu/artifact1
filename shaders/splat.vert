// splat.vert — view-space billboarded Gaussian splats, with a "sands of time"
// flow: each splat drifts along a domain-warped fbm field (ported from
// Experiment2/shaders.html) so the skyline shimmers and the grains stream and
// re-form like a half-remembered city dissolving in the wind.
//
// Each instance is a camera-facing quad. We build it in *view space* so it
// faces each eye correctly in stereo automatically (modelViewMatrix and
// projectionMatrix differ per eye, three.js swaps them for us).
//
// This is the simplified-3DGS path: isotropic-ish sprite + per-instance 2D
// scale/rotation instead of full anisotropic covariance. Additive blending in
// the fragment stage means we skip the per-frame depth sort the real Sevo splat
// pipeline does — a deliberate trade for the luminous "memory" look and steady
// VR frame time.
attribute vec3  instancePosition;
attribute vec3  instanceColor;
attribute vec2  instanceScale;
attribute float instanceRotation;
attribute float instanceSeed;
attribute float instanceTwinkle;

uniform float uTime;
uniform float uSplatScale;   // matches the world's CITY_SCALE so splats size up with it
uniform float uFlow;         // sands-of-time drift amplitude, in LOCAL units (0 = off)

varying vec2  vUv;
varying vec3  vColor;
varying float vBright;

// --- value-noise + domain-warped fbm, ported from Experiment2/shaders.html ---
// (Perlin-family value noise -> fbm -> recursively warped fbm: a turbulent,
//  chaotic, never-repeating flow field. This is the "sands of time" engine.)
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1,0)), c = hash21(i + vec2(0,1)), d = hash21(i + vec2(1,1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm2(vec2 p){
  // 2 octaves — cheap enough to run per-vertex on 40k splats at VR frame rates.
  float v = 0.0, amp = 0.5; mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 2; i++){ v += amp * vnoise(p); p = r * p * 2.0; amp *= 0.5; }
  return v;
}
float warpedFbm(vec2 p, float t){
  // single-level domain warp (3 fbm2 calls) — keeps the braided/chaotic feel
  // of shaders.html at ~2.5x less cost than the full double-warp.
  vec2 q = vec2(fbm2(p), fbm2(p + vec2(5.2, 1.3)));
  return fbm2(p + 3.0 * q + vec2(0.15 * t, 0.13 * t));
}

void main() {
  // --- sands of time: drift the splat along the warped-fbm flow field --------
  // The flow ANGLE comes from the chaotic scalar, so neighbouring grains sweep
  // in coherent ribbons that fold and braid. Amplitude is small in local units
  // so the city stays recognizable while it shimmers and re-forms.
  vec3 ipos = instancePosition;
  float ft = uTime;
  vec2 fp = ipos.xz * 2.2;
  float w  = warpedFbm(fp + vec2(ft * 0.04, ft * 0.03), ft);
  float ang = w * 12.566;                                   // ~2 turns
  ipos.x += cos(ang) * uFlow;
  ipos.z += sin(ang) * uFlow;
  ipos.y += (w - 0.5) * uFlow * 1.2 + sin(ft * 0.5 + instanceSeed * 6.2831) * uFlow * 0.4;

  vec4 viewCenter = modelViewMatrix * vec4(ipos, 1.0);

  // Distance LOD: keep splats small & crisp up close (high fidelity in the
  // street-level view), grow them gently with distance so the far skyline stays
  // coherent instead of breaking into sparse dots.
  float dist = max(-viewCenter.z, 0.001);
  float lod = clamp(dist / 14.0, 1.0, 2.6);

  // Rotate the unit quad corner (position.xy in [-0.5, 0.5]) and scale it.
  float c = cos(instanceRotation);
  float s = sin(instanceRotation);
  vec2 corner = position.xy;
  vec2 rot = vec2(corner.x * c - corner.y * s,
                  corner.x * s + corner.y * c) * instanceScale * uSplatScale * lod;
  viewCenter.xy += rot;

  gl_Position = projectionMatrix * viewCenter;

  vUv = position.xy * 2.0;                 // [-1, 1] for the gaussian falloff
  vColor = instanceColor;
  // Gentle shimmer so window lights feel alive / half-remembered.
  vBright = 1.0 + instanceTwinkle * 0.5 * sin(uTime * 1.5 + instanceSeed * 6.2831);
}
