// dome.frag — procedural starfield + slow nebula, shaded by view direction.
// `cameraPosition` is injected per-eye by three.js, so the parallax is correct
// in stereo automatically.
uniform float uTime;
varying vec3 vWorldPosition;

void main() {
  vec3 dir = normalize(vWorldPosition - cameraPosition);

  // Vertical gradient: deep space up, warmer haze near the horizon.
  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(vec3(0.04, 0.05, 0.09), vec3(0.01, 0.012, 0.03), h);
  sky += vec3(0.10, 0.06, 0.12) * pow(1.0 - abs(dir.y), 6.0); // horizon glow

  // Drifting nebula from fbm in direction space.
  float neb = fbm(dir * 3.0 + vec3(0.0, 0.0, uTime * 0.02));
  neb = smoothstep(0.45, 0.95, neb);
  sky += neb * vec3(0.18, 0.10, 0.28);

  // Stars: quantize the direction into cells, sparsely light a few.
  vec3 cell = floor(dir * 220.0);
  float star = hash13(cell);
  star = step(0.997, star) * (0.6 + 0.4 * sin(uTime * 2.0 + star * 40.0));
  sky += vec3(star);

  gl_FragColor = vec4(sky, 1.0);
}
