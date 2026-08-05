// sim.vel.frag — force accumulation and velocity integration.
// One fragment per splat (a 256 x N texture), so forces are evaluated ONCE per
// splat instead of four times per splat in the vertex stage.
//
// The memory spring is deliberately the dominant term: the skyline must stay
// legible, so every other field acts as a perturbation around the city's home
// shape rather than a free-for-all.

uniform sampler2D uPos, uVel, uHome, uCA;
uniform float uDt, uTime;
uniform float uSpring, uDamp, uMaxSpeed, uRelease;
uniform float wWind, wMag, wChladni, wMoire, wGrav;
uniform vec2  uChladniNM;
uniform float uMoireA, uMoireB, uMoireFreq;
uniform vec4  uBody0, uBody1, uBody2;
uniform vec4  uHandA, uHandB;
uniform vec3  uPoleP, uPoleN;
uniform float uInvExtent, uCAInvExtent;

varying vec2 vUv;

void main() {
  vec3 p    = texture2D(uPos,  vUv).xyz;
  vec3 v    = texture2D(uVel,  vUv).xyz;
  vec3 home = texture2D(uHome, vUv).xyz;

  // --- Gray-Scott gate ------------------------------------------------------
  // The automaton decides WHICH parts of the city are currently "released".
  // Memory lifts off in spreading, dividing patches rather than uniformly, so
  // the dissolution crawls across the skyline like something remembering.
  vec2 cuv = home.xz * uCAInvExtent * 0.5 + 0.5;
  float ca = texture2D(uCA, cuv).r;
  float mobility = clamp(0.22 + uRelease * ca * 1.6, 0.0, 1.0);

  // --- memory spring (dominant) --------------------------------------------
  vec3 F = -(uSpring * (1.0 - 0.6 * mobility)) * (p - home) - uDamp * v;

  // --- perturbing fields, cross-faded by the conductor ----------------------
  if (wWind    > 0.001) F += wWind    * mobility * windForce(p, uTime, 0.55);
  if (wMag     > 0.001) {
    vec3 B = poleField(p, uPoleP, uPoleN);
    F += wMag * mobility * B * inversesqrt(dot(B, B) + 1e-4) * 0.9;
  }
  if (wChladni > 0.001) F += wChladni * mobility * chladniForce(p, uChladniNM, uInvExtent);
  if (wMoire   > 0.001) F += wMoire   * mobility * moireForce(p, uMoireA, uMoireB, uMoireFreq, uInvExtent);
  if (wGrav    > 0.001) F += wGrav    * mobility * gravityForce(p, uBody0, uBody1, uBody2);

  // --- hands ---------------------------------------------------------------
  F += handForce(p, uHandA) + handForce(p, uHandB);

  v += F * uDt;

  float sp = length(v);
  if (sp > uMaxSpeed) v *= uMaxSpeed / sp;

  gl_FragColor = vec4(v, sp);
}
