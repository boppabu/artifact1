// splat.vert — view-space billboarded Gaussian splats.
//
// Position now comes from the GPU simulation (src/gpusim.js) rather than being
// computed here, so this shader is CHEAPER than the old inline-flow version:
// forces are evaluated once per splat in the sim pass instead of four times per
// splat here.
//
// Two behaviour-driven touches, both speed-gated so that a splat AT REST looks
// exactly as it always has (the shading is deliberately unchanged):
//   * rotation aligns to velocity. When the magnetic field dominates, velocity
//     IS the field direction — which is precisely how iron filings behave: they
//     do not merely get pulled, they orient along B.
//   * a slight stretch along the direction of motion, so fast dust reads as
//     streaks rather than dots.
//
// Each instance is a camera-facing quad built in *view space*, so it faces each
// eye correctly in stereo automatically (three.js swaps modelViewMatrix and
// projectionMatrix per eye for us).
attribute vec3  instancePosition;   // home position (also the fallback path)
attribute vec3  instanceColor;
attribute vec2  instanceScale;
attribute float instanceRotation;
attribute float instanceSeed;
attribute float instanceTwinkle;
attribute vec2  instanceUV;         // this splat's texel in the sim textures

uniform float uTime;
uniform float uSplatScale;   // matches the world's CITY_SCALE so splats size up with it
uniform float uUseSim;       // 1 = read the simulation, 0 = stateless fallback
uniform sampler2D uPosTex;
uniform sampler2D uVelTex;
uniform float uAlign;        // how strongly rotation locks to the flow direction
uniform float uStretch;      // motion elongation
uniform float uAlignSpeed;   // speed at which alignment reaches full strength
uniform float uFlow;         // fallback-only: legacy stateless drift amplitude

varying vec2  vUv;
varying vec3  vColor;
varying float vBright;

// --- fallback flow (only used when the simulation is unavailable) ----------
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1,0)), c = hash21(i + vec2(0,1)), d = hash21(i + vec2(1,1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm2(vec2 p){
  float v = 0.0, amp = 0.5; mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 2; i++){ v += amp * vnoise(p); p = r * p * 2.0; amp *= 0.5; }
  return v;
}
float warpedFbm(vec2 p, float t){
  vec2 q = vec2(fbm2(p), fbm2(p + vec2(5.2, 1.3)));
  return fbm2(p + 3.0 * q + vec2(0.15 * t, 0.13 * t));
}

void main() {
  vec3 ipos = instancePosition;
  vec3 ivel = vec3(0.0);

  if (uUseSim > 0.5) {
    ipos = texture2D(uPosTex, instanceUV).xyz;
    ivel = texture2D(uVelTex, instanceUV).xyz;
  } else {
    // Stateless path: the old domain-warped drift, kept so the scene still
    // renders on hardware without float render targets.
    float ft = uTime;
    vec2 fp = ipos.xz * 2.2;
    float w = warpedFbm(fp + vec2(ft * 0.04, ft * 0.03), ft);
    float ang = w * 12.566;
    ipos.x += cos(ang) * uFlow;
    ipos.z += sin(ang) * uFlow;
    ipos.y += (w - 0.5) * uFlow * 1.2 + sin(ft * 0.5 + instanceSeed * 6.2831) * uFlow * 0.4;
  }

  vec4 viewCenter = modelViewMatrix * vec4(ipos, 1.0);

  // Distance LOD: keep splats small & crisp up close (high fidelity in the
  // street-level view), grow them gently with distance so the far skyline stays
  // coherent instead of breaking into sparse dots.
  float dist = max(-viewCenter.z, 0.001);
  float lod = clamp(dist / 14.0, 1.0, 2.6);

  // --- align + stretch along motion (zero effect when the splat is still) ---
  vec3 viewVel = (modelViewMatrix * vec4(ivel, 0.0)).xyz;
  float speed = length(viewVel.xy);
  float a = smoothstep(0.0, uAlignSpeed, speed);
  float flowAngle = atan(viewVel.y, viewVel.x);
  float rotAng = mix(instanceRotation, flowAngle, a * uAlign);
  vec2 sc = instanceScale;
  sc.x *= 1.0 + a * uStretch;
  sc.y *= 1.0 - a * uStretch * 0.30;

  // Rotate the unit quad corner (position.xy in [-0.5, 0.5]) and scale it.
  float c = cos(rotAng);
  float s = sin(rotAng);
  vec2 corner = position.xy;
  vec2 rot = vec2(corner.x * c - corner.y * s,
                  corner.x * s + corner.y * c) * sc * uSplatScale * lod;
  viewCenter.xy += rot;

  gl_Position = projectionMatrix * viewCenter;

  vUv = position.xy * 2.0;                 // [-1, 1] for the gaussian falloff
  vColor = instanceColor;
  // Gentle shimmer so window lights feel alive / half-remembered.
  vBright = 1.0 + instanceTwinkle * 0.5 * sin(uTime * 1.5 + instanceSeed * 6.2831);
}
