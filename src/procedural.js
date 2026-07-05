// procedural.js — loads GLSL files at runtime and builds three.js
// ShaderMaterials from them. Keeping shaders as real .glsl files (rather than
// JS strings) means you can edit them with proper syntax highlighting and just
// refresh — the spiritual equivalent of swissgl / love-vr's "shader is the app".
import * as THREE from 'three';

export async function loadText(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load shader: ${url} (${res.status})`);
  return res.text();
}

// Loads every shader once and returns the raw sources.
export async function loadShaderSources() {
  const [common, domeV, domeF, objV, objF] = await Promise.all([
    loadText('./shaders/common.glsl'),
    loadText('./shaders/dome.vert'),
    loadText('./shaders/dome.frag'),
    loadText('./shaders/object.vert'),
    loadText('./shaders/object.frag'),
  ]);
  return { common, domeV, domeF, objV, objF };
}

export function makeDomeMaterial(src, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: src.domeV,
    // Prepend shared noise helpers to the fragment shader.
    fragmentShader: src.common + '\n' + src.domeF,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

export function makeObjectMaterial(src, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: src.objV,
    fragmentShader: src.common + '\n' + src.objF,
  });
}
