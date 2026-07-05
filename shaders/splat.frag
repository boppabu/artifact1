// splat.frag — radial Gaussian falloff, additively blended.
varying vec2  vUv;
varying vec3  vColor;
varying float vBright;

uniform float uOpacity;

void main() {
  float r2 = dot(vUv, vUv);
  float g = exp(-2.5 * r2);     // soft gaussian profile
  if (g < 0.004) discard;       // trim the transparent corners (cheap fill)
  gl_FragColor = vec4(vColor * vBright * g * uOpacity, g);
}
