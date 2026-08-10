// ui.js — a dependency-free 2D control panel for live tuning.
//
// No dat.GUI / lil-gui: those pull another script from a CDN, and this build is
// meant to stay self-contained. Plain DOM + a <style> tag.
//
// Everything here writes straight into live objects — shader uniforms, the
// GAIN table, the conductor's manual overrides — so changes apply on the next
// frame with no reload. The panel is desktop-only by nature: in an immersive
// XR session the DOM is not composited, so it simply is not there.

import { PRESETS } from './presets.js';

const CSS = `
#ui {
  position: fixed; top: 12px; right: 12px; z-index: 40; width: 268px;
  max-height: calc(100vh - 24px); overflow-y: auto;
  background: rgba(8,11,18,0.88); border: 1px solid #1e2a3d; border-radius: 8px;
  color: #9db2d0; font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  backdrop-filter: blur(6px);
}
#ui.collapsed .ui-body { display: none; }
#ui h1 {
  margin: 0; padding: 8px 10px; font-size: 11px; font-weight: 600; color: #d7e3f4;
  border-bottom: 1px solid #1e2a3d; cursor: pointer; display: flex;
  justify-content: space-between; align-items: center; letter-spacing: .04em;
}
#ui h1 span { color: #55708f; font-weight: 400; }
#ui .ui-body { padding: 6px 10px 10px; }
#ui .stat {
  color: #6b83a6; padding: 5px 0 7px; border-bottom: 1px solid #16202f;
  margin-bottom: 7px; white-space: pre-line;
}
#ui .grp {
  margin: 9px 0 3px; font-size: 10px; letter-spacing: .09em;
  text-transform: uppercase; color: #55708f;
}
#ui .row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
#ui .row label { flex: 0 0 84px; color: #8ba3c4; }
#ui .row input[type=range] {
  flex: 1; height: 3px; -webkit-appearance: none; appearance: none;
  background: #22314a; border-radius: 2px; outline: none;
}
#ui .row input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 11px; height: 11px; border-radius: 50%;
  background: #6fa8dc; cursor: pointer;
}
#ui .row input[type=range]::-moz-range-thumb {
  width: 11px; height: 11px; border: 0; border-radius: 50%; background: #6fa8dc; cursor: pointer;
}
#ui .row .val { flex: 0 0 40px; text-align: right; color: #cfe0f5; }
#ui .row.disabled { opacity: .38; pointer-events: none; }
#ui .btns { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
#ui button {
  flex: 1 1 auto; padding: 4px 6px; background: #16202f; color: #9db2d0;
  border: 1px solid #24344c; border-radius: 4px; cursor: pointer;
  font: 10px ui-monospace, monospace;
}
#ui button:hover { background: #1d2a3e; color: #d7e3f4; }
#ui button.on { background: #24435f; color: #dff0ff; border-color: #3a6a92; }
#ui .chk { display: flex; align-items: center; gap: 6px; margin: 3px 0; cursor: pointer; }
#ui .chk input { accent-color: #6fa8dc; }
#ui .presets { display: flex; gap: 4px; margin: 2px 0 4px; }
#ui .presets button {
  flex: 1 1 0; padding: 6px 0; display: flex; align-items: center; justify-content: center;
}
#ui .presets svg {
  width: 15px; height: 15px; fill: none; stroke: currentColor;
  stroke-width: 1.15; stroke-linecap: round; stroke-linejoin: round;
}
#ui .presets button.on svg { stroke-width: 1.5; }
#ui .phint { color: #4a6180; min-height: 13px; margin: 0 0 4px; }
`;

export function createUI(ctx) {
  const { sim, conductor, automata, material, gain, onReseed } = ctx;
  const U = sim ? sim.uniforms : null;
  const P = sim ? sim.posUniforms : null;
  const M = material.uniforms;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'ui';
  root.innerHTML = `<h1>controls <span id="ui-tog">[ H ]</span></h1><div class="ui-body"></div>`;
  document.body.appendChild(root);
  const body = root.querySelector('.ui-body');
  root.querySelector('h1').onclick = () => root.classList.toggle('collapsed');

  const stat = document.createElement('div');
  stat.className = 'stat';
  body.appendChild(stat);

  // ---- presets (built first so they sit at the top of the panel) ----------
  // applyPreset is a hoisted declaration defined further down; these handlers
  // only ever fire after the whole panel exists.
  const presetWrap = document.createElement('div');
  presetWrap.className = 'presets';
  const presetHint = document.createElement('div');
  presetHint.className = 'phint';
  const presetBtns = PRESETS.map((p, i) => {
    const b = document.createElement('button');
    b.innerHTML = p.icon;
    b.title = p.name + ' — ' + p.hint;
    b.onclick = () => {
      applyPreset(p);
      presetBtns.forEach((o, j) => o.classList.toggle('on', j === i));
      presetHint.textContent = p.name + ' · ' + p.hint;
    };
    b.addEventListener('mouseenter', () => { presetHint.textContent = p.name + ' · ' + p.hint; });
    presetWrap.appendChild(b);
    return b;
  });
  body.appendChild(presetWrap);
  body.appendChild(presetHint);

  // Emitted before any group so the presets sit at the top of the VR panel too.
  const presetModel = {
    kind: 'presets',
    items: PRESETS.map((p, i) => ({
      name: p.name, icon: p.icon, hint: p.hint,
      apply: () => presetBtns[i].click(),
      active: () => presetBtns[i].classList.contains('on'),
    })),
  };

  const rows = [];
  const defaults = [];

  // A description of every control, emitted as the DOM is built. The VR panel
  // (src/vrpanel.js) renders from this same list, so the two views can never
  // drift apart — there is exactly one definition of each control.
  const model = [presetModel];

  function group(name) {
    const d = document.createElement('div');
    d.className = 'grp';
    d.textContent = name;
    body.appendChild(d);
    model.push({ kind: 'group', label: name });
  }

  // A slider bound to a getter/setter pair, so it always reflects live state.
  function slider(label, min, max, step, get, set, fmt = 2) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}"><div class="val"></div>`;
    const input = row.querySelector('input');
    const val = row.querySelector('.val');
    input.value = get();
    val.textContent = (+get()).toFixed(fmt);
    input.addEventListener('input', () => {
      set(parseFloat(input.value));
      val.textContent = parseFloat(input.value).toFixed(fmt);
    });
    body.appendChild(row);
    const o = { row, sync: () => { input.value = get(); val.textContent = (+get()).toFixed(fmt); } };
    rows.push(o);
    defaults.push({ set, value: get() });
    model.push({
      kind: 'slider', label, fmt, get, set,
      min: +min, max: +max, step: +step,
      disabled: () => row.classList.contains('disabled'),
    });
    return o;
  }

  function checkbox(label, get, set) {
    const l = document.createElement('label');
    l.className = 'chk';
    l.innerHTML = `<input type="checkbox"><span>${label}</span>`;
    const input = l.querySelector('input');
    input.checked = !!get();
    input.addEventListener('change', () => { set(input.checked); syncEnabled(); });
    body.appendChild(l);
    rows.push({ sync: () => { input.checked = !!get(); } });
    defaults.push({ set, value: !!get() });
    model.push({
      kind: 'check', label, get,
      set: (v) => { set(v); input.checked = !!v; syncEnabled(); },
    });
    return l;
  }

  function buttons(defs) {
    const wrap = document.createElement('div');
    wrap.className = 'btns';
    const els = defs.map((d) => {
      const b = document.createElement('button');
      b.textContent = d.label;
      b.onclick = d.onClick;
      wrap.appendChild(b);
      return b;
    });
    body.appendChild(wrap);
    model.push({
      kind: 'buttons',
      items: defs.map((d, i) => ({
        label: d.label,
        onClick: d.onClick,
        active: () => els[i].classList.contains('on'),
      })),
    });
    return els;
  }

  // ---- fields --------------------------------------------------------------
  group('field');
  const modeBtns = buttons(
    ['wind', 'filings', 'chladni', 'moire', 'orbit'].map((n, i) => ({
      label: n, onClick: () => { conductor.setMode(i); conductor.setLock(true); syncEnabled(); },
    })));
  const toggleBtns = buttons([
    { label: 'hold', onClick: () => { conductor.toggleLock(); syncEnabled(); } },
    { label: 'next', onClick: () => conductor.next() },
    { label: 'reseed CA', onClick: () => onReseed && onReseed() },
  ]);

  // ---- force gains ---------------------------------------------------------
  group('force gain');
  slider('wind', 0, 30, 0.5, () => gain.wind, (v) => gain.wind = v, 1);
  slider('filings', 0, 30, 0.5, () => gain.mag, (v) => gain.mag = v, 1);
  slider('chladni', 0, 30, 0.5, () => gain.chladni, (v) => gain.chladni = v, 1);
  slider('moire', 0, 10, 0.1, () => gain.moire, (v) => gain.moire = v, 1);
  slider('gravity', 0, 30, 0.5, () => gain.grav, (v) => gain.grav = v, 1);

  // ---- the medium ----------------------------------------------------------
  if (U) {
    group('medium');
    slider('memory', 2, 60, 0.5, () => U.uSpring.value, (v) => U.uSpring.value = v, 1);
    slider('damping', 0.2, 12, 0.1, () => U.uDamp.value, (v) => U.uDamp.value = v, 1);
    slider('max speed', 0.2, 8, 0.1, () => U.uMaxSpeed.value, (v) => U.uMaxSpeed.value = v, 1);
    slider('leash', 0.05, 2.0, 0.01, () => P.uMaxWander.value,
      (v) => { P.uMaxWander.value = v; conductor.setMaxWander(v); }, 2);
  }

  // ---- entropy -------------------------------------------------------------
  group('entropy');
  checkbox('auto (feedback loop)',
    () => conductor.manual.auto, (v) => conductor.manual.auto = v);
  checkbox('wander set-point (rule 30)',
    () => conductor.manual.autoTarget, (v) => conductor.manual.autoTarget = v);
  checkbox('auto-cycle fields',
    () => conductor.manual.autoAdvance, (v) => conductor.manual.autoAdvance = v);
  const rTarget = slider('set-point', 0, 1, 0.01,
    () => conductor.state.target, (v) => conductor.setTarget(v), 2);
  const rDrive = slider('drive', 0, 1, 0.01,
    () => conductor.manual.drive, (v) => conductor.manual.drive = v, 2);
  const rRelease = slider('release', 0, 1, 0.01,
    () => conductor.manual.release, (v) => conductor.manual.release = v, 2);
  slider('dwell (s)', 4, 60, 1,
    () => conductor.manual.holdSeconds, (v) => conductor.manual.holdSeconds = v, 0);

  // ---- field shape ---------------------------------------------------------
  group('field shape');
  checkbox('auto chladni modes',
    () => conductor.manual.autoNM, (v) => conductor.manual.autoNM = v);
  const rN = slider('chladni n', 1, 9, 1,
    () => conductor.state.nm[0], (v) => conductor.setNM(v, conductor.state.nm[1]), 0);
  const rM = slider('chladni m', 1, 9, 1,
    () => conductor.state.nm[1], (v) => conductor.setNM(conductor.state.nm[0], v), 0);
  if (U) {
    slider('moire freq', 1, 24, 0.5, () => U.uMoireFreq.value, (v) => U.uMoireFreq.value = v, 1);
  }
  slider('moire spin', 0, 6, 0.05, () => conductor.manual.spin, (v) => conductor.manual.spin = v, 2);
  slider('moire detune', 0, 6, 0.05, () => conductor.manual.detune, (v) => conductor.manual.detune = v, 2);

  // ---- look (deliberately light: the shading is meant to stay put) ---------
  group('look');
  slider('opacity', 0.05, 1.5, 0.01, () => M.uOpacity.value, (v) => M.uOpacity.value = v, 2);
  slider('splat size', 1, 14, 0.1, () => M.uSplatScale.value, (v) => M.uSplatScale.value = v, 1);
  slider('align', 0, 1, 0.01, () => M.uAlign.value, (v) => M.uAlign.value = v, 2);
  slider('stretch', 0, 3, 0.01, () => M.uStretch.value, (v) => M.uStretch.value = v, 2);
  slider('align spd', 0.02, 1.5, 0.01, () => M.uAlignSpeed.value, (v) => M.uAlignSpeed.value = v, 2);

  buttons([{ label: 'reset all', onClick: () => {
    defaults.forEach((d) => d.set(d.value));
    rows.forEach((r) => r.sync && r.sync());
    presetBtns.forEach((b) => b.classList.remove('on'));
    presetHint.textContent = '';
    syncEnabled();
  } }]);

  // Push a preset into the live objects. Every section is optional, so a
  // preset only disturbs what it actually names.
  function applyPreset(p) {
    if (p.gain) Object.assign(gain, p.gain);

    if (U && p.medium) {
      const md = p.medium;
      if (md.spring   !== undefined) U.uSpring.value = md.spring;
      if (md.damp     !== undefined) U.uDamp.value = md.damp;
      if (md.maxSpeed !== undefined) U.uMaxSpeed.value = md.maxSpeed;
      if (md.leash    !== undefined) {
        P.uMaxWander.value = md.leash;
        conductor.setMaxWander(md.leash);   // keep the entropy binning honest
      }
    }

    const man = conductor.manual;
    if (p.entropy) {
      const e = p.entropy;
      for (const k of ['auto', 'autoTarget', 'autoAdvance']) {
        if (e[k] !== undefined) man[k] = e[k];
      }
      if (e.drive   !== undefined) man.drive = e.drive;
      if (e.release !== undefined) man.release = e.release;
      if (e.dwell   !== undefined) man.holdSeconds = e.dwell;
      if (e.target  !== undefined) conductor.setTarget(e.target);
    }

    if (p.shape) {
      const sh = p.shape;
      if (sh.autoNM !== undefined) man.autoNM = sh.autoNM;
      if (sh.n !== undefined && sh.m !== undefined) conductor.setNM(sh.n, sh.m);
      if (sh.spin   !== undefined) man.spin = sh.spin;
      if (sh.detune !== undefined) man.detune = sh.detune;
      if (U && sh.moireFreq !== undefined) U.uMoireFreq.value = sh.moireFreq;
    }

    if (p.look) {
      const lk = p.look;
      if (lk.opacity    !== undefined) M.uOpacity.value = lk.opacity;
      if (lk.splatSize  !== undefined) M.uSplatScale.value = lk.splatSize;
      if (lk.align      !== undefined) M.uAlign.value = lk.align;
      if (lk.stretch    !== undefined) M.uStretch.value = lk.stretch;
      if (lk.alignSpeed !== undefined) M.uAlignSpeed.value = lk.alignSpeed;
    }

    if (p.mode !== undefined) conductor.setMode(p.mode);
    if (p.lock !== undefined) conductor.setLock(p.lock);

    rows.forEach((r) => r.sync && r.sync());
    syncEnabled();
  }

  // Grey out the controls the feedback loop is currently driving itself.
  function syncEnabled() {
    const auto = conductor.manual.auto;
    rDrive.row.classList.toggle('disabled', auto);
    rRelease.row.classList.toggle('disabled', auto);
    rTarget.row.classList.toggle('disabled', !auto || conductor.manual.autoTarget);
    const nmAuto = conductor.manual.autoNM;
    rN.row.classList.toggle('disabled', nmAuto);
    rM.row.classList.toggle('disabled', nmAuto);
    const st = conductor.state;
    modeBtns.forEach((b, i) => b.classList.toggle('on', i === st.modeIndex));
    toggleBtns[0].classList.toggle('on', st.locked);
  }
  syncEnabled();

  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') root.classList.toggle('collapsed');
  });

  let acc = 0;
  return {
    presets: PRESETS,
    applyPreset,
    model,                                   // consumed by the VR panel
    getStatus: () => stat.textContent,
    // Re-read every DOM control from its live source. Called after the VR
    // panel changes something, so the two views stay in agreement.
    syncAll() {
      rows.forEach((r) => r.sync && r.sync());
      syncEnabled();
    },
    // Called from the render loop; cheap, and throttled by the caller.
    refresh(info) {
      const st = conductor.state;
      stat.textContent =
        `${st.mode}${st.locked ? ' · held' : ''}   ${info.fps | 0} fps\n` +
        `entropy ${st.entropy.toFixed(2)}  drive ${st.drive.toFixed(2)}  ` +
        `release ${st.release.toFixed(2)}\n` +
        `${info.splats.toLocaleString()} splats  ·  ${info.sim ? 'GPU sim' : 'fallback'}`;
      // Re-sync sliders whose values the simulation itself moves.
      if ((acc = (acc + 1) % 4) === 0) {
        rTarget.sync();
        if (conductor.manual.autoNM) { rN.sync(); rM.sync(); }
        if (conductor.manual.auto) { rDrive.sync(); rRelease.sync(); }
      }
      syncEnabled();
    },
  };
}
