// object.frag — domain-warped fbm color with a fresnel rim and one cheap
// directional light. This is the "procedural material" boilerplate: edit the
// warp / palette here and it hot-reloads on refresh, no build step.
uniform float uTime;
uniform vec3  uColorA;
uniform vec3  uColorB;
varying vec3 vNormalW;
varying vec3 vPositionW;
varying vec3 vPositionL;

// Iquilez-style cosine palette.
vec3 palette(float t, vec3 a, vec3 b) {
  return a + b * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
}

void main() {
  // Domain warp: sample fbm of an fbm-displaced position for organic banding.
  vec3 p = vPositionL * 2.5 + vec3(0.0, uTime * 0.1, 0.0);
  vec3 warp = vec3(fbm(p), fbm(p + 5.2), fbm(p + 9.1));
  float v = fbm(p + warp * 1.8);

  vec3 base = palette(v + uTime * 0.05, uColorA, uColorB);

  // Lighting: one directional term + ambient, cheap and stable in stereo.
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(vec3(0.4, 0.8, 0.3));
  float diff = clamp(dot(N, L), 0.0, 1.0);
  vec3 V = normalize(cameraPosition - vPositionW);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);

  vec3 col = base * (0.35 + 0.75 * diff) + fres * vec3(0.5, 0.7, 1.0);
  gl_FragColor = vec4(col, 1.0);
}
