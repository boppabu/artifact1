// presets.js — saved corners of the parameter space.
//
// Most of the interesting behaviour lives at the EDGES: a nearly-absent memory
// spring plus a long leash lets the city leave its own footprint entirely; a
// near-coincidence moire detune produces structure far larger than the lattice;
// heavy damping makes sand settle instead of stream. Those states are easy to
// lose by accident, so they are pinned here.
//
// Every field is optional — a preset only touches what it names.
//   gain    wind / mag / chladni / moire / grav
//   medium  spring, damp, maxSpeed, leash
//   entropy auto, autoTarget, autoAdvance, drive, release, dwell, target
//   shape   autoNM, n, m, moireFreq, spin, detune
//   look    opacity, splatSize, align, stretch, alignSpeed
//   mode    0 wind · 1 filings · 2 chladni · 3 moire · 4 orbit
//
// Icons are inline SVG (no icon font, no CDN) drawn to suggest the pattern.

const ICON = {
  burst:  '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.1"/><circle cx="8" cy="8" r="6.2"/><path d="M8 0.6v2.2M8 13.2v2.2M0.6 8h2.2M13.2 8h2.2M2.9 2.9l1.6 1.6M11.5 11.5l1.6 1.6M13.1 2.9l-1.6 1.6M4.5 11.5l-1.6 1.6"/></svg>',
  poles:  '<svg viewBox="0 0 16 16"><circle cx="2.6" cy="8" r="1.3"/><circle cx="13.4" cy="8" r="1.3"/><path d="M4 6.6C6 2.4 10 2.4 12 6.6M4 9.4c2 4.2 6 4.2 8 0M4.2 8h7.6"/></svg>',
  plate:  '<svg viewBox="0 0 16 16"><rect x="1.8" y="1.8" width="12.4" height="12.4" rx="1.2"/><path d="M8 1.8v12.4M1.8 8h12.4"/><path d="M4.6 4.6q3.4 3.4 6.8 0M4.6 11.4q3.4-3.4 6.8 0"/></svg>',
  quasi:  '<svg viewBox="0 0 16 16"><path d="M8 1.2l1.9 4.3 4.7.4-3.6 3.1 1.1 4.6L8 11.2l-4.1 2.4 1.1-4.6-3.6-3.1 4.7-.4z"/></svg>',
  orbit:  '<svg viewBox="0 0 16 16"><ellipse cx="8" cy="8" rx="6.6" ry="3.1" transform="rotate(-24 8 8)"/><circle cx="8" cy="8" r="1.7"/><circle cx="13.4" cy="5.6" r="1"/></svg>',
  city:   '<svg viewBox="0 0 16 16"><path d="M0.8 14h14.4"/><path d="M2.6 14V7.2h2.6V14M6.6 14V3.2h2.8V14M10.8 14V8.8h2.6V14"/></svg>',
};

export const PRESETS = [
  {
    // The configuration from the screenshot: the memory spring is almost gone
    // (4 vs the usual 26) and the leash is four times its normal length, so the
    // splats abandon the street grid entirely and are free to be organised by
    // the moire interference instead. Max detune spins the two quasilattices
    // apart quickly, which is what throws the concentric shells and radial
    // filaments. High stretch + align turns the fast-moving dust into streaks.
    name: 'supernova',
    icon: ICON.burst,
    hint: 'moire burst — memory nearly off, long leash, max detune',
    mode: 3, lock: true,
    gain:    { wind: 22.5, mag: 28.5, chladni: 22.0, moire: 9.2, grav: 18.0 },
    medium:  { spring: 4.0, damp: 2.9, maxSpeed: 7.7, leash: 1.70 },
    entropy: { auto: false, autoTarget: true, autoAdvance: false,
               drive: 0.59, release: 0.61, dwell: 34 },
    shape:   { autoNM: true, n: 3, m: 5, moireFreq: 13.5, spin: 2.2, detune: 5.8 },
    look:    { opacity: 1.00, splatSize: 4.7, align: 0.74, stretch: 1.80, alignSpeed: 1.40 },
  },
  {
    // Iron filings. Only the magnetic field acts, the spring is weak enough to
    // let dust ride the field lines all the way from pole to pole, and heavy
    // alignment + stretch makes each splat lie ALONG the line it is travelling
    // — which is exactly why filings render a magnetic field visible.
    name: 'filings',
    icon: ICON.poles,
    hint: 'pole-to-pole field lines, dust aligned along B',
    mode: 1, lock: true,
    gain:    { wind: 2.0, mag: 27.0, chladni: 0, moire: 0, grav: 0 },
    medium:  { spring: 6.0, damp: 2.2, maxSpeed: 5.5, leash: 1.15 },
    entropy: { auto: false, autoTarget: false, autoAdvance: false,
               drive: 0.85, release: 0.70, dwell: 30 },
    shape:   { autoNM: true, spin: 0.6, detune: 0.5 },
    look:    { opacity: 0.85, splatSize: 5.0, align: 1.00, stretch: 2.45, alignSpeed: 0.40 },
  },
  {
    // Chladni plate. The trick is DAMPING: sand only settles onto the nodal
    // lines if it loses energy, so damping is high and max speed low. Auto mode
    // numbers are off so the figure holds still instead of morphing.
    name: 'chladni',
    icon: ICON.plate,
    hint: 'sand settles on the nodal lines — high damping, fixed modes',
    mode: 2, lock: true,
    gain:    { wind: 1.0, mag: 0, chladni: 28.0, moire: 0, grav: 0 },
    medium:  { spring: 5.0, damp: 6.5, maxSpeed: 2.6, leash: 1.40 },
    entropy: { auto: false, autoTarget: false, autoAdvance: false,
               drive: 0.90, release: 0.80, dwell: 30 },
    shape:   { autoNM: false, n: 7, m: 4, spin: 0.3, detune: 0.4 },
    look:    { opacity: 0.72, splatSize: 4.2, align: 0.30, stretch: 0.30, alignSpeed: 0.60 },
  },
  {
    // The magic-angle case. Two quasilattices at a NEAR-coincidence rotation:
    // a tiny detune means the beat wavelength becomes enormous, so a fine
    // 5-fold lattice organises into a few huge slow shapes. High frequency,
    // almost no relative spin, tight damping to keep the figure crisp.
    name: 'quasicrystal',
    icon: ICON.quasi,
    hint: 'near-coincidence moire — fine lattice, huge slow beat',
    mode: 3, lock: true,
    gain:    { wind: 1.5, mag: 0, chladni: 3.0, moire: 10.0, grav: 0 },
    medium:  { spring: 9.0, damp: 5.5, maxSpeed: 2.2, leash: 0.95 },
    entropy: { auto: false, autoTarget: false, autoAdvance: false,
               drive: 0.95, release: 0.75, dwell: 30 },
    shape:   { autoNM: true, moireFreq: 20.5, spin: 0.35, detune: 0.12 },
    look:    { opacity: 0.70, splatSize: 3.6, align: 0.35, stretch: 0.35, alignSpeed: 0.55 },
  },
  {
    // Three-body chaos. Almost no memory, the longest leash, top speed — the
    // bodies fling dust into comet tails that never repeat. Maximum stretch so
    // the trajectories read as trails rather than points.
    name: 'three-body',
    icon: ICON.orbit,
    hint: 'gravitational chaos — comet tails, no memory',
    mode: 4, lock: true,
    gain:    { wind: 4.0, mag: 0, chladni: 0, moire: 0, grav: 27.0 },
    medium:  { spring: 3.0, damp: 1.2, maxSpeed: 8.0, leash: 2.00 },
    entropy: { auto: false, autoTarget: false, autoAdvance: false,
               drive: 1.00, release: 0.85, dwell: 30 },
    shape:   { autoNM: true, spin: 1.0, detune: 1.0 },
    look:    { opacity: 0.95, splatSize: 5.2, align: 1.00, stretch: 2.70, alignSpeed: 0.35 },
  },
  {
    // The way back. Strong memory, short leash, everything automatic — the
    // skyline is unmistakably New York again and the piece conducts itself.
    name: 'skyline',
    icon: ICON.city,
    hint: 'calm baseline — legible city, entropy loop conducting',
    mode: 0, lock: false,
    gain:    { wind: 12.0, mag: 14.0, chladni: 9.0, moire: 2.0, grav: 8.0 },
    medium:  { spring: 26.0, damp: 3.4, maxSpeed: 2.2, leash: 0.22 },
    entropy: { auto: true, autoTarget: true, autoAdvance: true,
               drive: 0.45, release: 0.35, dwell: 18, target: 0.5 },
    shape:   { autoNM: true, moireFreq: 9.0, spin: 1.0, detune: 1.0 },
    look:    { opacity: 0.60, splatSize: 6.0, align: 0.85, stretch: 0.85, alignSpeed: 0.22 },
  },
];
