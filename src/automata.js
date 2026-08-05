// automata.js — two Wolfram-flavoured automata driving the scene's disorder.
//
// 1. GRAY-SCOTT reaction-diffusion (a continuous CA). In the "mitosis" regime
//    (feed 0.0367, kill 0.0649) its spots grow, drift and divide indefinitely —
//    it never reaches a fixed point and never goes uniformly random. We use its
//    v-field as a RELEASE GATE: it decides which parts of the city are mobile
//    right now, so memory lifts off in spreading patches instead of uniformly.
//    Note it drives BEHAVIOUR (mobility), not colour — the shading is untouched.
//
// 2. RULE 30, Wolfram's class-3 elementary CA — the one Mathematica shipped as
//    its random number generator for years. Genuinely chaotic from a single
//    seed cell, so it is a legitimate entropy source rather than Math.random().
//    We use its bits to pick new Chladni modes, nudge the moire rotation and
//    decide when to inject impulses.

import * as THREE from 'three';

export function createAutomata(opts = {}) {
  const N = opts.size ?? 72;
  const size = N * N;

  let u = new Float32Array(size);
  let v = new Float32Array(size);
  const u2 = new Float32Array(size);
  const v2 = new Float32Array(size);

  const Du = 0.16, Dv = 0.08;
  const feed = opts.feed ?? 0.0367;   // canonical "mitosis": spots that divide
  const kill = opts.kill ?? 0.0649;
  const SUBSTEPS = opts.substeps ?? 2;

  const pix = new Uint8Array(size * 4);
  const texture = new THREE.DataTexture(pix, N, N, THREE.RGBAFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;

  // ---- Rule 30 -------------------------------------------------------------
  const RN = 129;
  const row = new Uint8Array(RN);
  const rowNext = new Uint8Array(RN);
  row[RN >> 1] = 1;                      // single live cell: the classic seed
  let ruleBit = 0;

  function stepRule30() {
    for (let i = 0; i < RN; i++) {
      const l = row[(i - 1 + RN) % RN], c = row[i], r = row[(i + 1) % RN];
      rowNext[i] = l ^ (c | r);          // Rule 30
    }
    row.set(rowNext);
    ruleBit = (ruleBit + 1) % RN;
  }

  // Pull a pseudo-random float from the Rule-30 row. Deterministic, chaotic,
  // and — unlike Math.random() — it is itself an automaton, which is the point.
  function entropyBits(bits = 8) {
    let x = 0;
    for (let b = 0; b < bits; b++) {
      x = (x << 1) | row[(ruleBit * 7 + b * 11) % RN];
    }
    return x / (1 << bits);
  }

  function reseed() {
    for (let i = 0; i < size; i++) { u[i] = 1; v[i] = 0; }
    for (let s = 0; s < 10; s++) {
      const cx = (Math.random() * N) | 0, cy = (Math.random() * N) | 0;
      const r = 2 + ((Math.random() * 2) | 0);
      for (let y = -r; y <= r; y++) {
        for (let x = -r; x <= r; x++) {
          const i = ((cy + y + N) % N) * N + ((cx + x + N) % N);
          u[i] = 0.5; v[i] = 0.25;
        }
      }
    }
  }
  reseed();

  let sinceInject = 0;
  let activeFraction = 0;

  function update(dt) {
    stepRule30();

    // Entropy injection, timed by the automaton rather than a fixed clock.
    sinceInject += dt;
    if (sinceInject > 2.5 + entropyBits(4) * 4.0) {
      sinceInject = 0;
      const cx = (entropyBits(8) * N) | 0, cy = (entropyBits(8) * N) | 0;
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          const i = ((cy + y + N) % N) * N + ((cx + x + N) % N);
          v[i] = 0.5; u[i] = 0.25;
        }
      }
    }

    for (let s = 0; s < SUBSTEPS; s++) {
      for (let y = 0; y < N; y++) {
        const yn = ((y - 1 + N) % N) * N, yp = ((y + 1) % N) * N, y0 = y * N;
        for (let x = 0; x < N; x++) {
          const xn = (x - 1 + N) % N, xp = (x + 1) % N;
          const i = y0 + x;
          const lu = (u[yn + x] + u[yp + x] + u[y0 + xn] + u[y0 + xp]) * 0.2
                   + (u[yn + xn] + u[yn + xp] + u[yp + xn] + u[yp + xp]) * 0.05 - u[i];
          const lv = (v[yn + x] + v[yp + x] + v[y0 + xn] + v[y0 + xp]) * 0.2
                   + (v[yn + xn] + v[yn + xp] + v[yp + xn] + v[yp + xp]) * 0.05 - v[i];
          const uvv = u[i] * v[i] * v[i];
          u2[i] = u[i] + (Du * lu - uvv + feed * (1 - u[i]));
          v2[i] = v[i] + (Dv * lv + uvv - (kill + feed) * v[i]);
        }
      }
      u.set(u2); v.set(v2);
    }

    let active = 0;
    for (let i = 0; i < size; i++) {
      const c = Math.max(0, Math.min(255, v[i] * 620)) | 0;
      if (c > 60) active++;
      const j = i * 4;
      pix[j] = c; pix[j + 1] = c; pix[j + 2] = c; pix[j + 3] = 255;
    }
    activeFraction = active / size;
    texture.needsUpdate = true;
  }

  return {
    texture, update, reseed, entropyBits,
    get activeFraction() { return activeFraction; },
  };
}
