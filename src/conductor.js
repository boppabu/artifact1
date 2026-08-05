// conductor.js — decides how disordered the scene should be, and which fields
// are currently acting. This is the "strange loop" layer from Godel Escher Bach:
// the system measures its own disorder and feeds that measurement back into the
// forces that cause the disorder, so it regulates itself instead of following a
// timer.
//
//   high entropy  -> memory reasserts (spring up, fields down)
//   low  entropy  -> chaos reasserts  (fields up, and eventually a mode change)
//
// The measurement is real, not a proxy for a vibe: we integrate a small CPU
// ensemble of sample particles under the SAME analytic fields the GPU uses,
// bin them into a coarse occupancy grid, and take the Shannon entropy
// H = -sum p log p, normalised by log(cells). 96 particles is statistically
// plenty for a scalar summary and costs nothing, and — crucially — it needs no
// GPU readback, which would stall the VR frame.

const TAU5 = 2 * Math.PI / 5;

// ---- JS mirrors of the analytic fields (cheap ones only) ------------------
function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

function chladni(x, z, n, m) {
  const P = Math.PI;
  const u = Math.cos(n * P * x) * Math.cos(m * P * z)
          - Math.cos(m * P * x) * Math.cos(n * P * z);
  const dudx = -n * P * Math.sin(n * P * x) * Math.cos(m * P * z)
             + m * P * Math.sin(m * P * x) * Math.cos(n * P * z);
  const dudz = -m * P * Math.cos(n * P * x) * Math.sin(m * P * z)
             + n * P * Math.cos(m * P * x) * Math.sin(n * P * z);
  return [-2 * u * dudx, -2 * u * dudz];
}

function quasiGrad(x, z, rot, freq) {
  let s = 0, gx = 0, gz = 0;
  for (let k = 0; k < 5; k++) {
    const a = rot + k * TAU5;
    const kx = Math.cos(a) * freq, kz = Math.sin(a) * freq;
    const ph = kx * x + kz * z;
    s += Math.cos(ph);
    gx += -Math.sin(ph) * kx;
    gz += -Math.sin(ph) * kz;
  }
  return [s, gx, gz];
}

// ---- the modes -----------------------------------------------------------
// Each is a target weight vector; the conductor cross-fades between them so
// nothing ever pops.
export const MODES = [
  { name: 'wind',    w: { wind: 1.00, mag: 0.00, chladni: 0.00, moire: 0.00, grav: 0.00 } },
  { name: 'filings', w: { wind: 0.15, mag: 1.00, chladni: 0.00, moire: 0.00, grav: 0.00 } },
  { name: 'chladni', w: { wind: 0.10, mag: 0.00, chladni: 1.00, moire: 0.00, grav: 0.00 } },
  { name: 'moire',   w: { wind: 0.10, mag: 0.00, chladni: 0.25, moire: 1.00, grav: 0.00 } },
  { name: 'orbit',   w: { wind: 0.20, mag: 0.00, chladni: 0.00, moire: 0.00, grav: 1.00 } },
];

export function createConductor(opts = {}) {
  const NS = 96;                       // ensemble size
  const GRID = 8;                      // occupancy bins per axis
  const LOGC = Math.log(GRID * GRID);
  const extent = opts.extent ?? 3.3;
  let maxWander = opts.maxWander ?? 0.42;     // must match the GPU leash

  const sx = new Float32Array(NS), sz = new Float32Array(NS);
  const hx = new Float32Array(NS), hz = new Float32Array(NS);
  const vx = new Float32Array(NS), vz = new Float32Array(NS);
  for (let i = 0; i < NS; i++) {
    hx[i] = sx[i] = (Math.random() * 2 - 1) * extent;
    hz[i] = sz[i] = (Math.random() * 2 - 1) * extent;
  }
  const bins = new Float32Array(GRID * GRID);

  const weights = { wind: 0, mag: 0, chladni: 0, moire: 0, grav: 0 };
  let modeIndex = 0;
  let locked = false;
  let entropy = 0;          // measured, smoothed, 0..1
  let drive = 0.45;         // how hard the fields are pushed, 0..1
  let release = 0.35;       // how much of the city the CA is allowed to free
  let sinceMode = 0;
  let target = 0.5;         // entropy set-point (itself wanders)

  // Chladni mode numbers and the two quasilattice rotations.
  let nm = [3, 5];
  let rotA = 0, rotB = 0.04;

  function measure(dt, t) {
    const invE = 1 / extent;
    for (let i = 0; i < NS; i++) {
      let fx = 0, fz = 0;
      const px = sx[i], pz = sz[i];
      const qx = px * invE, qz = pz * invE;

      if (weights.chladni > 0.001) {
        const [cgx, cgz] = chladni(qx, qz, nm[0], nm[1]);
        fx += weights.chladni * cgx * 0.12 * invE;
        fz += weights.chladni * cgz * 0.12 * invE;
      }
      if (weights.moire > 0.001) {
        const [A, agx, agz] = quasiGrad(qx, qz, rotA, 9.0);
        const [B, bgx, bgz] = quasiGrad(qx, qz, rotB, 9.0);
        fx -= weights.moire * (A * bgx + B * agx) * 0.045 * invE;
        fz -= weights.moire * (A * bgz + B * agz) * 0.045 * invE;
      }
      if (weights.wind > 0.001) {
        const wq = 0.55, e = 0.15;
        const gx = vnoise((px * wq) + t * 0.05 + e, (pz * wq) - t * 0.04)
                 - vnoise((px * wq) + t * 0.05 - e, (pz * wq) - t * 0.04);
        const gz = vnoise((px * wq) + t * 0.05, (pz * wq) - t * 0.04 + e)
                 - vnoise((px * wq) + t * 0.05, (pz * wq) - t * 0.04 - e);
        fx += weights.wind * (gz / (2 * e));
        fz += weights.wind * (-gx / (2 * e));
      }

      // Same law as the GPU: dominant memory spring + damping.
      fx += -26.0 * (px - hx[i]) * (1 - 0.6 * release) - 3.4 * vx[i];
      fz += -26.0 * (pz - hz[i]) * (1 - 0.6 * release) - 3.4 * vz[i];

      vx[i] += fx * dt; vz[i] += fz * dt;
      sx[i] += vx[i] * dt; sz[i] += vz[i] * dt;
    }

    // Shannon entropy of the DISPLACEMENT histogram — how far the medium has
    // been carried from where it belongs, not where it happens to sit. Binning
    // absolute position would just measure the (fixed, random) home layout and
    // read near-maximal forever; binning displacement reads 0 when the city is
    // at rest and climbs as the fields disperse it, which is the quantity the
    // feedback loop actually needs.
    bins.fill(0);
    const span = maxWander;
    for (let i = 0; i < NS; i++) {
      const dx = (sx[i] - hx[i]) / span, dz = (sz[i] - hz[i]) / span;
      const gx = Math.max(0, Math.min(GRID - 1, ((dx * 0.5 + 0.5) * GRID) | 0));
      const gz = Math.max(0, Math.min(GRID - 1, ((dz * 0.5 + 0.5) * GRID) | 0));
      bins[gz * GRID + gx] += 1;
    }
    let H = 0;
    for (let i = 0; i < bins.length; i++) {
      if (bins[i] > 0) { const p = bins[i] / NS; H -= p * Math.log(p); }
    }
    return H / LOGC;
  }

  function setMode(i) {
    modeIndex = ((i % MODES.length) + MODES.length) % MODES.length;
    sinceMode = 0;
  }

  // Manual overrides, driven by the 2D control panel. When `auto` is off the
  // feedback loop stops steering and the panel's drive/release values are used
  // directly — useful for parking the scene in one look while you tune it.
  const manual = {
    auto: true,          // entropy feedback loop steers drive/release
    autoTarget: true,    // let Rule 30 wander the set-point
    autoAdvance: true,   // cycle modes on its own
    autoNM: true,        // let Rule 30 pick Chladni mode numbers
    drive: 0.45,
    release: 0.35,
    spin: 1.0,           // scales both quasilattice rotation rates
    detune: 1.0,         // scales their DIFFERENCE — the moire beat rate
    holdSeconds: 18,     // base dwell time per mode
  };

  function update(dt, t, entropyBits) {
    const H = measure(dt, t);
    entropy += (H - entropy) * Math.min(1, dt * 1.5);   // smooth

    if (manual.auto) {
      // ---- the feedback loop ----------------------------------------------
      // The system pushes back against its own measurement, so it oscillates
      // around the set-point forever instead of settling or running away.
      const err = target - entropy;
      drive = Math.max(0.05, Math.min(1.0, drive + err * dt * 0.55));
      release = Math.max(0.10, Math.min(0.85, release + err * dt * 0.30));

      // The set-point itself wanders, chosen by Rule 30 rather than a clock.
      if (manual.autoTarget && entropyBits && Math.random() < dt * 0.12) {
        target = 0.35 + entropyBits(6) * 0.45;
      }
    } else {
      drive = manual.drive;
      release = manual.release;
    }

    // ---- mode advance -----------------------------------------------------
    sinceMode += dt;
    const dwell = manual.holdSeconds + (entropyBits ? entropyBits(5) * 22 : 10);
    if (!locked && manual.autoAdvance && sinceMode > dwell) {
      setMode(modeIndex + 1);
      // A new Chladni figure and a fresh quasilattice offset on every change.
      if (manual.autoNM && entropyBits) {
        nm = [2 + Math.floor(entropyBits(4) * 5), 3 + Math.floor(entropyBits(5) * 5)];
        rotB = rotA + 0.02 + entropyBits(6) * 0.10;
      }
    }

    // ---- cross-fade weights toward the active mode ------------------------
    const tw = MODES[modeIndex].w;
    const k = Math.min(1, dt * 0.55);
    for (const key of Object.keys(weights)) {
      weights[key] += (tw[key] * drive - weights[key]) * k;
    }

    // The two quasilattices rotate against each other. This slow relative
    // rotation is the whole moire engine — the beat pattern it produces is
    // vastly larger than either lattice and never repeats. `detune` scales how
    // fast they pull apart, which sets the beat rate.
    rotA += dt * 0.013 * manual.spin;
    rotB += dt * (0.013 + 0.006 * manual.detune) * manual.spin;

    return { weights, entropy, drive, release, nm, rotA, rotB,
             mode: MODES[modeIndex].name, locked };
  }

  return {
    update, setMode, manual,
    next() { setMode(modeIndex + 1); },
    toggleLock() { locked = !locked; return locked; },
    setLock(v) { locked = !!v; },
    setNM(n, m) { nm = [n, m]; },
    setTarget(v) { target = Math.max(0, Math.min(1, v)); },
    setMaxWander(v) { maxWander = v; },
    get modeIndex() { return modeIndex; },
    get state() {
      return { entropy, drive, release, target, nm,
               mode: MODES[modeIndex].name, modeIndex, locked };
    },
  };
}
