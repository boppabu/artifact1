// vrpanel.js — the control panel as a world-anchored tablet you can point at.
//
// In an immersive session the browser stops compositing the DOM, so the HTML
// panel simply is not there. (WebXR's `dom-overlay` feature would solve this,
// but it is specced for handheld/AR sessions and is not available for
// immersive-vr on Quest.) So the controls have to be drawn INTO the scene.
//
// Approach: render the panel with Canvas2D into a CanvasTexture on a quad.
// Canvas2D gives us text for free, which is what rules out building the widgets
// from three.js primitives (TextGeometry/FontLoader live in three/addons, and
// this project deliberately has no addon dependency).
//
// It renders from ui.model — the same control list the DOM panel is built from
// — so there is exactly one definition of each control and the two views cannot
// drift apart.
//
// Interaction: controller ray + trigger to adjust, grip to grab and reposition,
// thumbstick to scroll. While a ray is on the panel that hand's trigger/grip
// drive the UI instead of pushing dust (main.js reads `hovering` for that).

import * as THREE from 'three';

const W = 768, H = 1152;                 // canvas pixels
const PANEL_W = 0.46, PANEL_H = PANEL_W * (H / W);   // metres

const PAD = 24;
const HEADER_H = 56;
const STAT_H = 84;
const CONTENT_TOP = HEADER_H + STAT_H;
const VIEW_H = H - CONTENT_TOP - 14;

const ROW = { group: 40, slider: 38, check: 36, buttons: 46, presets: 96 };
const TRACK_X = 244, TRACK_W = 400;

const C = {
  bg: 'rgba(8,11,18,0.96)', edge: '#25344c', head: '#0e1420',
  label: '#8ba3c4', value: '#cfe0f5', group: '#55708f', dim: '#4a6180',
  track: '#22314a', thumb: '#6fa8dc', on: '#24435f', onEdge: '#3a6a92',
  hover: 'rgba(111,168,220,0.13)', text: '#9db2d0', title: '#d7e3f4',
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// The preset icons are SVG strings written for CSS (fill:none, stroke:
// currentColor). A standalone data-URI image gets no CSS, so the presentation
// has to be inlined on the root element, where it inherits down.
function svgImage(svg, color, size) {
  const s = svg.replace(
    '<svg viewBox="0 0 16 16">',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 16 16" fill="none" stroke="${color}" stroke-width="1.15" ` +
    `stroke-linecap="round" stroke-linejoin="round">`);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  return img;
}

export function createVRPanel(model, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = opts.anisotropy ?? 4;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_W, PANEL_H),
    // Drawn last with depth testing off: 47k additively-blended splats would
    // otherwise wash straight over the panel and make it unreadable.
    new THREE.MeshBasicMaterial({
      map: texture, transparent: true, depthTest: false, depthWrite: false,
      toneMapped: false,
    }));
  mesh.renderOrder = 999;
  mesh.visible = false;
  mesh.frustumCulled = false;

  // ---- layout: give every model entry a content-space rectangle ------------
  const items = [];
  let y = 0;
  for (const m of model) {
    const h = ROW[m.kind] ?? 34;
    items.push({ m, y, h });
    y += h;
  }
  const contentH = y;
  let scroll = 0;
  const maxScroll = Math.max(0, contentH - VIEW_H);

  // Preload the preset icons; redraw as each arrives.
  let dirty = true;
  const icons = new Map();
  for (const m of model) {
    if (m.kind !== 'presets') continue;
    m.items.forEach((p, i) => {
      const img = svgImage(p.icon, '#9db2d0', 44);
      img.onload = () => { dirty = true; };
      icons.set(i, img);
    });
  }

  let hoverItem = null, hoverSub = -1;
  let status = '';

  // ---- drawing -------------------------------------------------------------
  function drawSlider(it, sy) {
    const m = it.m;
    const off = m.disabled && m.disabled();
    g.globalAlpha = off ? 0.38 : 1;
    g.fillStyle = C.label;
    g.font = '400 21px ui-monospace, Menlo, monospace';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(m.label, PAD, sy + it.h / 2);

    const cy = sy + it.h / 2;
    g.fillStyle = C.track;
    roundRect(g, TRACK_X, cy - 3, TRACK_W, 6, 3); g.fill();

    const v = +m.get();
    const t = clamp((v - m.min) / (m.max - m.min), 0, 1);
    g.fillStyle = C.thumb;
    g.beginPath(); g.arc(TRACK_X + t * TRACK_W, cy, 10, 0, Math.PI * 2); g.fill();

    g.fillStyle = C.value;
    g.textAlign = 'right';
    g.fillText(v.toFixed(m.fmt ?? 2), W - PAD, cy);
    g.globalAlpha = 1;
  }

  function drawCheck(it, sy) {
    const m = it.m;
    const cy = sy + it.h / 2;
    const on = !!m.get();
    g.strokeStyle = on ? C.thumb : C.edge;
    g.lineWidth = 2;
    roundRect(g, PAD, cy - 10, 20, 20, 4); g.stroke();
    if (on) {
      g.strokeStyle = C.thumb; g.lineWidth = 3;
      g.beginPath();
      g.moveTo(PAD + 5, cy); g.lineTo(PAD + 9, cy + 5); g.lineTo(PAD + 16, cy - 6);
      g.stroke();
    }
    g.fillStyle = C.label;
    g.font = '400 21px ui-monospace, Menlo, monospace';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(m.label, PAD + 34, cy);
  }

  function drawButtons(it, sy) {
    const n = it.m.items.length;
    const gap = 8;
    const bw = (W - PAD * 2 - gap * (n - 1)) / n;
    it.m.items.forEach((b, i) => {
      const x = PAD + i * (bw + gap);
      const active = b.active && b.active();
      g.fillStyle = active ? C.on : '#16202f';
      roundRect(g, x, sy + 5, bw, it.h - 12, 5); g.fill();
      g.strokeStyle = active ? C.onEdge : C.edge; g.lineWidth = 1.5;
      roundRect(g, x, sy + 5, bw, it.h - 12, 5); g.stroke();
      g.fillStyle = active ? '#dff0ff' : C.text;
      g.font = '400 18px ui-monospace, Menlo, monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(b.label, x + bw / 2, sy + it.h / 2 - 1);
    });
  }

  function drawPresets(it, sy) {
    const n = it.m.items.length;
    const gap = 8;
    const bw = (W - PAD * 2 - gap * (n - 1)) / n;
    it.m.items.forEach((p, i) => {
      const x = PAD + i * (bw + gap);
      const active = p.active && p.active();
      g.fillStyle = active ? C.on : '#16202f';
      roundRect(g, x, sy + 8, bw, it.h - 30, 6); g.fill();
      g.strokeStyle = active ? C.onEdge : C.edge; g.lineWidth = 1.5;
      roundRect(g, x, sy + 8, bw, it.h - 30, 6); g.stroke();
      const img = icons.get(i);
      if (img && img.complete && img.naturalWidth) {
        g.drawImage(img, x + bw / 2 - 22, sy + 8 + (it.h - 30) / 2 - 22, 44, 44);
      }
      g.fillStyle = active ? C.value : C.dim;
      g.font = '400 14px ui-monospace, Menlo, monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(p.name.slice(0, 11), x + bw / 2, sy + it.h - 10);
    });
  }

  function draw() {
    g.clearRect(0, 0, W, H);

    g.fillStyle = C.bg;
    roundRect(g, 0, 0, W, H, 16); g.fill();
    g.strokeStyle = C.edge; g.lineWidth = 3;
    roundRect(g, 1.5, 1.5, W - 3, H - 3, 16); g.stroke();

    // header / grab affordance
    g.fillStyle = C.head;
    roundRect(g, 0, 0, W, HEADER_H, 16); g.fill();
    g.fillStyle = C.title;
    g.font = '600 24px ui-monospace, Menlo, monospace';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('controls', PAD, HEADER_H / 2);
    g.fillStyle = C.group;
    g.font = '400 17px ui-monospace, Menlo, monospace';
    g.textAlign = 'right';
    g.fillText('grip to move · stick to scroll', W - PAD, HEADER_H / 2);

    // status block
    g.fillStyle = C.dim;
    g.font = '400 19px ui-monospace, Menlo, monospace';
    g.textAlign = 'left'; g.textBaseline = 'top';
    status.split('\n').forEach((line, i) => {
      g.fillText(line, PAD, HEADER_H + 12 + i * 24);
    });
    g.strokeStyle = '#16202f'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(PAD, CONTENT_TOP - 6); g.lineTo(W - PAD, CONTENT_TOP - 6); g.stroke();

    // scrolling content
    g.save();
    g.beginPath(); g.rect(0, CONTENT_TOP, W, VIEW_H); g.clip();

    for (const it of items) {
      const sy = CONTENT_TOP + it.y - scroll;
      if (sy + it.h < CONTENT_TOP || sy > CONTENT_TOP + VIEW_H) continue;

      if (hoverItem === it && it.m.kind !== 'group') {
        g.fillStyle = C.hover;
        roundRect(g, PAD - 8, sy + 2, W - (PAD - 8) * 2, it.h - 4, 5); g.fill();
      }

      switch (it.m.kind) {
        case 'group':
          g.fillStyle = C.group;
          g.font = '400 17px ui-monospace, Menlo, monospace';
          g.textAlign = 'left'; g.textBaseline = 'middle';
          g.fillText(it.m.label.toUpperCase(), PAD, sy + it.h / 2 + 4);
          break;
        case 'slider':  drawSlider(it, sy); break;
        case 'check':   drawCheck(it, sy); break;
        case 'buttons': drawButtons(it, sy); break;
        case 'presets': drawPresets(it, sy); break;
      }
    }
    g.restore();

    // scrollbar
    if (maxScroll > 0) {
      const th = Math.max(40, VIEW_H * (VIEW_H / contentH));
      const ty = CONTENT_TOP + (scroll / maxScroll) * (VIEW_H - th);
      g.fillStyle = '#1b2740';
      roundRect(g, W - 10, CONTENT_TOP, 5, VIEW_H, 2.5); g.fill();
      g.fillStyle = '#3a5578';
      roundRect(g, W - 10, ty, 5, th, 2.5); g.fill();
    }

    texture.needsUpdate = true;
  }

  // ---- hit testing ---------------------------------------------------------
  // uv comes from the raycast; v is bottom-up in three.js, the canvas is top-down.
  function hit(uv) {
    const px = uv.x * W;
    const py = (1 - uv.y) * H;
    if (py < CONTENT_TOP) return { px, py, item: null, sub: -1, header: py < HEADER_H };
    const cy = py - CONTENT_TOP + scroll;
    for (const it of items) {
      if (cy >= it.y && cy < it.y + it.h) {
        let sub = -1;
        if (it.m.kind === 'buttons' || it.m.kind === 'presets') {
          const n = it.m.items.length, gap = 8;
          const bw = (W - PAD * 2 - gap * (n - 1)) / n;
          const i = Math.floor((px - PAD) / (bw + gap));
          if (i >= 0 && i < n && px >= PAD + i * (bw + gap) && px <= PAD + i * (bw + gap) + bw) sub = i;
        }
        return { px, py, item: it, sub, header: false };
      }
    }
    return { px, py, item: null, sub: -1, header: false };
  }

  function setSliderFrom(it, px) {
    const m = it.m;
    const t = clamp((px - TRACK_X) / TRACK_W, 0, 1);
    let v = m.min + t * (m.max - m.min);
    v = Math.round(v / m.step) * m.step;
    m.set(clamp(v, m.min, m.max));
    dirty = true;
  }

  // ---- per-frame update ----------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const tmpM = new THREE.Matrix4();
  const grabOffset = new THREE.Matrix4();
  let dragItem = null, dragCtrl = -1;
  let grabCtrl = -1;
  const prevBtn = [{}, {}];
  const hovering = [false, false];

  function update(controllers, dt, statusText, onChange) {
    if (statusText !== status) { status = statusText; dirty = true; }

    hovering[0] = hovering[1] = false;
    let anyHover = null;

    for (let i = 0; i < controllers.length; i++) {
      const c = controllers[i];
      const src = c.userData.inputSource;
      if (!src || !src.gamepad) continue;
      const gp = src.gamepad;
      const trigger = !!(gp.buttons[0] && gp.buttons[0].pressed);
      const grip = !!(gp.buttons[1] && gp.buttons[1].pressed);
      const pv = prevBtn[i];
      const trigEdge = trigger && !pv.trigger;
      const gripEdge = grip && !pv.grip;
      pv.trigger = trigger; pv.grip = grip;

      // --- being dragged / grabbed by this controller ----------------------
      if (grabCtrl === i) {
        hovering[i] = true;
        if (grip) {
          tmpM.multiplyMatrices(c.matrixWorld, grabOffset);
          tmpM.decompose(mesh.position, mesh.quaternion, mesh.scale);
        } else { grabCtrl = -1; }
        continue;
      }
      if (dragItem && dragCtrl === i) {
        hovering[i] = true;
        if (trigger) {
          raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
          raycaster.ray.direction.set(0, 0, -1)
            .applyMatrix4(tmpM.identity().extractRotation(c.matrixWorld));
          const hits = raycaster.intersectObject(mesh, false);
          if (hits.length && hits[0].uv) setSliderFrom(dragItem, hits[0].uv.x * W);
          continue;
        }
        dragItem = null; dragCtrl = -1;
        if (onChange) onChange();
      }

      // --- ray test ---------------------------------------------------------
      raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1)
        .applyMatrix4(tmpM.identity().extractRotation(c.matrixWorld));
      const hits = raycaster.intersectObject(mesh, false);
      if (!hits.length || !hits[0].uv) {
        if (c.userData.ray) c.userData.ray.scale.z = 3;
        continue;
      }

      hovering[i] = true;
      if (c.userData.ray) c.userData.ray.scale.z = hits[0].distance;
      const h = hit(hits[0].uv);
      anyHover = h;

      if (gripEdge) {                       // grab anywhere on the panel
        grabOffset.copy(c.matrixWorld).invert().multiply(mesh.matrixWorld);
        grabCtrl = i;
        continue;
      }

      // scroll with this hand's thumbstick
      const ax = gp.axes;
      const sy = ax.length >= 4 ? ax[3] : (ax[1] || 0);
      if (Math.abs(sy) > 0.15 && maxScroll > 0) {
        scroll = clamp(scroll + sy * 900 * dt, 0, maxScroll);
        dirty = true;
      }

      if (trigEdge && h.item) {
        const m = h.item.m;
        if (m.kind === 'slider' && !(m.disabled && m.disabled())) {
          setSliderFrom(h.item, h.px);
          dragItem = h.item; dragCtrl = i;
        } else if (m.kind === 'check') {
          m.set(!m.get());
          dirty = true;
          if (onChange) onChange();
        } else if (m.kind === 'buttons' && h.sub >= 0) {
          m.items[h.sub].onClick();
          dirty = true;
          if (onChange) onChange();
        } else if (m.kind === 'presets' && h.sub >= 0) {
          m.items[h.sub].apply();
          dirty = true;
          if (onChange) onChange();
        }
      }
    }

    const newHover = anyHover ? anyHover.item : null;
    const newSub = anyHover ? anyHover.sub : -1;
    if (newHover !== hoverItem || newSub !== hoverSub) {
      hoverItem = newHover; hoverSub = newSub; dirty = true;
    }

    return hovering;
  }

  return {
    mesh, hovering,
    get isGrabbed() { return grabCtrl >= 0; },
    setVisible(v) { mesh.visible = v; },
    // Park it in front of the viewer, facing them, when a session starts.
    placeInFrontOf(camera, distance = 0.95) {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      dir.normalize();
      const pos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
      mesh.position.copy(pos).addScaledVector(dir, distance);
      mesh.position.y = Math.max(0.8, pos.y - 0.18);
      mesh.lookAt(pos);
    },
    update,
    // Redraw only when something actually changed; values the simulation moves
    // on its own are picked up by the caller marking us dirty.
    render(force) {
      if (!dirty && !force) return false;
      dirty = false;
      draw();
      return true;
    },
    markDirty() { dirty = true; },
    dispose() {
      mesh.geometry.dispose(); mesh.material.dispose(); texture.dispose();
    },
  };
}
