// nyc.js — procedurally generate a dense Gaussian-splat cloud that evokes a
// memory of New York at dusk: a tight grid of setback towers (taller toward
// "midtown"), packed window facades, rooftop water towers and beacons, street-
// level sodium glow, and thin atmospheric haze. Desaturated, luminous,
// dissolving at the edges — a half-remembered skyline, but a detailed one.
//
// All sizes/positions are in LOCAL units; src/main.js scales the whole cloud up
// (CITY_SCALE) and the splat shader scales each splat to match (uSplatScale), so
// the numbers below read as a compact model while the result is walkable.
//
// Still synthesized, not a trained 3DGS .ply — but the buffer layout matches a
// real importer, so a trained skyline drops into the same renderer later.

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateNYC(seed = 7) {
  const rnd = mulberry32(seed);

  const P = [], C = [], S = [], R = [], SE = [], TW = [];
  let n = 0;
  function add(x, y, z, r, g, b, sx, sy, rot, tw) {
    P.push(x, y, z); C.push(r, g, b); S.push(sx, sy);
    R.push(rot); SE.push(rnd()); TW.push(tw); n++;
  }

  // ---- tuning ----------------------------------------------------------
  const GRID = 11;          // blocks per side
  const CS = 0.55;          // block pitch
  const half = (GRID - 1) / 2;
  const FLOOR_H = 0.060;    // vertical window spacing (smaller -> denser)
  const COL_SP = 0.048;     // horizontal window spacing
  const WIN_SKIP = 0.26;    // fraction of windows that are dark/empty
  const WIN_SIZE = 0.013;   // base window splat size (small -> crisp up close)

  function windowColor() {
    const r = rnd();
    if (r < 0.14) return [0.05, 0.06, 0.10];           // dark / off
    if (r < 0.80) { const b = 0.8 + rnd() * 0.6;        // warm amber (most)
      return [1.0 * b, 0.70 * b, 0.36 * b]; }
    const b = 0.7 + rnd() * 0.5;                         // cool office white
    return [0.70 * b, 0.82 * b, 1.0 * b];
  }

  const FACES = [
    { ax: 'x', s: 1 }, { ax: 'x', s: -1 },
    { ax: 'z', s: 1 }, { ax: 'z', s: -1 },
  ];

  // Fill the four faces of a box [y0,y1] with a dense window grid + faint mass.
  function fillFacade(cx, cz, y0, y1, hw, hd) {
    for (const f of FACES) {
      const span = (f.ax === 'x') ? hd : hw;
      const cols = Math.max(2, Math.floor((2 * span) / COL_SP));
      const rows = Math.max(2, Math.floor((y1 - y0) / FLOOR_H));
      for (let ci = 0; ci < cols; ci++) {
        for (let ri = 0; ri < rows; ri++) {
          if (rnd() < WIN_SKIP) continue;
          const fr = cols > 1 ? ci / (cols - 1) : 0.5;
          const along = -span + fr * 2 * span + (rnd() - 0.5) * 0.008;
          const y = y0 + 0.02 + ri * FLOOR_H + (rnd() - 0.5) * 0.005;
          let x, z;
          if (f.ax === 'x') { x = cx + f.s * (hw + 0.004); z = cz + along; }
          else              { z = cz + f.s * (hd + 0.004); x = cx + along; }
          const [r, g, b] = windowColor();
          const s = WIN_SIZE + rnd() * 0.006;
          add(x, y, z, r, g, b, s, s * (0.8 + rnd() * 0.5),
              (rnd() - 0.5) * 0.4, 0.35);
        }
      }
      // Faint structural mass so towers read as solid silhouettes.
      const mass = Math.max(3, Math.floor((y1 - y0) / 0.05));
      for (let m = 0; m < mass; m++) {
        const along = (rnd() * 2 - 1) * span;
        const y = y0 + rnd() * (y1 - y0);
        let x, z;
        if (f.ax === 'x') { x = cx + f.s * (hw + 0.002); z = cz + along; }
        else              { z = cz + f.s * (hd + 0.002); x = cx + along; }
        add(x, y, z, 0.09, 0.11, 0.18, 0.05, 0.05, rnd() * 6.28, 0.04);
      }
    }
  }

  // Iconic rooftop water tower: a little staved barrel on legs.
  function waterTower(cx, top, cz) {
    const r = 0.028, h = 0.05;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      add(cx + Math.cos(a) * r, top + h * 0.35 + rnd() * h * 0.5,
          cz + Math.sin(a) * r, 0.20, 0.13, 0.09, 0.016, 0.022, 0, 0.0);
    }
    add(cx, top + h, cz, 0.12, 0.08, 0.06, 0.034, 0.03, 0, 0.0); // conical cap
  }

  // ---- buildings (with Art-Deco setbacks) ------------------------------
  for (let gx = 0; gx < GRID; gx++) {
    for (let gz = 0; gz < GRID; gz++) {
      if (rnd() < 0.06) continue;                       // occasional empty lot

      const bx = (gx - half) * CS + (rnd() - 0.5) * 0.04;
      const bz = (gz - half) * CS + (rnd() - 0.5) * 0.04;
      let hw = CS * (0.32 + rnd() * 0.10);
      let hd = CS * (0.32 + rnd() * 0.10);

      const d = Math.hypot(bx, bz);
      const height = 0.18 + 1.75 * Math.exp(-(d * d) / (2 * 1.25 * 1.25))
                          + rnd() * 0.30;

      const tiers = height > 1.5 ? 3 : (height > 0.95 ? 2 : 1);
      let y0 = 0;
      for (let ti = 0; ti < tiers; ti++) {
        const y1 = (ti === tiers - 1)
          ? height
          : y0 + (height - y0) * (0.40 + rnd() * 0.20);
        fillFacade(bx, bz, y0, y1, hw, hd);
        y0 = y1;
        hw *= 0.64 + rnd() * 0.12;                       // step inward each tier
        hd *= 0.64 + rnd() * 0.12;
      }

      if (rnd() < 0.45) waterTower(bx + (rnd() - 0.5) * hw, height,
                                   bz + (rnd() - 0.5) * hd);
      if (height > 1.0)                                  // blinking red beacon
        add(bx, height + 0.015, bz, 1.0, 0.18, 0.12, 0.016, 0.016, 0.0, 0.9);
    }
  }

  // ---- street-level sodium glow ---------------------------------------
  for (let i = 0; i <= GRID; i++) {
    const line = (i - half - 0.5) * CS;
    for (let t = 0; t < 40; t++) {
      const along = (t / 39 - 0.5) * GRID * CS;
      if (rnd() < 0.35)
        add(line, 0.012 + rnd() * 0.02, along, 1.0, 0.58, 0.24,
            0.04, 0.04, 0.0, 0.12);                      // avenues (along z)
      if (rnd() < 0.35)
        add(along, 0.012 + rnd() * 0.02, line, 1.0, 0.58, 0.24,
            0.04, 0.04, 0.0, 0.12);                      // streets (along x)
    }
  }

  // ---- atmospheric haze (kept dim so it doesn't wash out the detail) ---
  const HAZE = 1100;
  for (let i = 0; i < HAZE; i++) {
    const a = rnd() * Math.PI * 2;
    const rad = Math.sqrt(rnd()) * GRID * CS * 0.55;
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    const y = Math.pow(rnd(), 2.0) * 1.5 + 0.02;
    const warm = Math.max(0.0, 0.5 - y);
    const r = (0.18 + warm * 0.5) * 0.11;
    const g = (0.24 + warm * 0.25) * 0.11;
    const b = (0.42 + (1.0 - warm) * 0.1) * 0.11;
    const sc = 0.30 + rnd() * 0.35;
    add(x, y, z, r, g, b, sc, sc, rnd() * 6.28, 0.0);
  }

  return {
    count: n,
    position: new Float32Array(P),
    color:    new Float32Array(C),
    scale:    new Float32Array(S),
    rotation: new Float32Array(R),
    seed:     new Float32Array(SE),
    twinkle:  new Float32Array(TW),
  };
}
