// sim.pos.frag — position integration.
// Plain semi-implicit Euler (velocity was already advanced this frame), plus a
// hard leash back to the home position. The leash is what guarantees the
// skyline never disperses: no matter how energetic the fields get, a splat can
// never wander further than uMaxWander from where its window belongs.

uniform sampler2D uPos, uVel, uHome;
uniform float uDt, uMaxWander;

varying vec2 vUv;

void main() {
  vec4 P    = texture2D(uPos,  vUv);
  vec3 v    = texture2D(uVel,  vUv).xyz;
  vec3 home = texture2D(uHome, vUv).xyz;

  vec3 p = P.xyz + v * uDt;

  vec3 d = p - home;
  float len = length(d);
  if (len > uMaxWander) p = home + d * (uMaxWander / len);

  gl_FragColor = vec4(p, P.w);
}
