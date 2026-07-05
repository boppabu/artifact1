// object.vert — passes world-space normal/position to the fragment stage.
varying vec3 vNormalW;
varying vec3 vPositionW;
varying vec3 vPositionL;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vPositionW = worldPos.xyz;
  vPositionL = position;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
