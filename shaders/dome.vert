// dome.vert — environment dome. We render a large inverted sphere and shade
// it by view direction so the procedural sky stays anchored to the world
// (not the head), which is far more comfortable in VR.
varying vec3 vWorldPosition;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
