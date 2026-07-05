// controls.js — minimal local replacement for three/addons/controls/OrbitControls.js
// (drag to orbit, wheel to zoom). Only the bits main.js uses: target, update(),
// enableDamping, dampingFactor, minDistance, maxDistance. No addon dependency.
import * as THREE from 'three';

export class OrbitControls {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3();
    this.enableDamping = false;
    this.dampingFactor = 0.08;
    this.minDistance = 0.1;
    this.maxDistance = 1000;

    this._sph = new THREE.Spherical();     // current
    this._dst = new THREE.Spherical();     // desired
    this._init = false;
    this._down = false;
    this._px = 0; this._py = 0;

    dom.addEventListener('pointerdown', (e) => { this._down = true; this._px = e.clientX; this._py = e.clientY; });
    window.addEventListener('pointerup', () => { this._down = false; });
    window.addEventListener('pointermove', (e) => {
      if (!this._down) return;
      const dx = e.clientX - this._px, dy = e.clientY - this._py;
      this._px = e.clientX; this._py = e.clientY;
      this._dst.theta -= dx * 0.005;
      this._dst.phi = Math.max(0.05, Math.min(Math.PI - 0.05, this._dst.phi - dy * 0.005));
    });
    dom.addEventListener('wheel', (e) => {
      this._dst.radius = Math.max(this.minDistance, Math.min(this.maxDistance, this._dst.radius * (1 + Math.sign(e.deltaY) * 0.1)));
      e.preventDefault();
    }, { passive: false });
  }

  update() {
    if (!this._init) {
      const off = new THREE.Vector3().subVectors(this.camera.position, this.target);
      this._sph.setFromVector3(off);
      this._dst.copy(this._sph);
      this._init = true;
    }
    this._dst.radius = Math.max(this.minDistance, Math.min(this.maxDistance, this._dst.radius));
    const f = this.enableDamping ? this.dampingFactor : 1.0;
    this._sph.theta += (this._dst.theta - this._sph.theta) * f;
    this._sph.phi   += (this._dst.phi   - this._sph.phi)   * f;
    this._sph.radius += (this._dst.radius - this._sph.radius) * f;
    this._sph.makeSafe();
    this.camera.position.copy(new THREE.Vector3().setFromSpherical(this._sph).add(this.target));
    this.camera.lookAt(this.target);
  }
}
