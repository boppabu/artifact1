// locomotion.js — thumbstick navigation for the player rig.
//
// In WebXR you don't move the camera (the headset owns its pose) — you move the
// rig the camera lives in. Here:
//   * Left stick  : smooth move, relative to where you're looking (X = strafe,
//                   Y = forward/back) plus the rig stays on the ground.
//   * Right stick : X = snap-turn (comfort — discrete 30deg steps, far less
//                   nauseating than smooth turning), Y = vertical fly up/down.
//
// Quest controllers expose the thumbstick on gamepad.axes[2] / axes[3].
import * as THREE from 'three';

export function createLocomotion(renderer, camera, player, opts = {}) {
  const MOVE_SPEED = opts.moveSpeed ?? 4.0;   // m/s
  const FLY_SPEED  = opts.flySpeed  ?? 3.0;   // m/s
  const SNAP_ANGLE = (opts.snapDegrees ?? 30) * Math.PI / 180;
  const DEADZONE   = 0.18;

  let snapArmed = true;

  const forward = new THREE.Vector3();
  const right   = new THREE.Vector3();
  const head    = new THREE.Vector3();

  function stick(handedness) {
    const session = renderer.xr.getSession();
    if (!session) return null;
    for (const src of session.inputSources) {
      if (src.handedness === handedness && src.gamepad) {
        const ax = src.gamepad.axes;
        // Prefer the thumbstick pair (2,3); fall back to (0,1) on odd mappings.
        const x = ax.length >= 4 ? ax[2] : ax[0];
        const y = ax.length >= 4 ? ax[3] : ax[1];
        return { x: x || 0, y: y || 0 };
      }
    }
    return null;
  }

  function snapTurn(angle) {
    // Rotate the rig around the head so you pivot in place, not around the
    // rig's origin.
    camera.getWorldPosition(head);
    const dx = player.position.x - head.x;
    const dz = player.position.z - head.z;
    const c = Math.cos(angle), s = Math.sin(angle);
    player.position.x = head.x + dx * c - dz * s;
    player.position.z = head.z + dx * s + dz * c;
    player.rotation.y += angle;
  }

  function update(dt) {
    if (!renderer.xr.isPresenting) return;

    // --- move (left stick), relative to head yaw ---
    const move = stick('left');
    if (move && (Math.abs(move.x) > DEADZONE || Math.abs(move.y) > DEADZONE)) {
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.set(-forward.z, 0, forward.x);          // 90deg right of forward
      const fwdAmt = -move.y;                        // stick up = forward
      const v = MOVE_SPEED * dt;
      player.position.x += (right.x * move.x + forward.x * fwdAmt) * v;
      player.position.z += (right.z * move.x + forward.z * fwdAmt) * v;
    }

    // --- snap-turn + fly (right stick) ---
    const turn = stick('right');
    if (turn) {
      if (Math.abs(turn.x) > 0.7 && snapArmed) {
        snapTurn(turn.x > 0 ? -SNAP_ANGLE : SNAP_ANGLE);
        snapArmed = false;                           // require recenter before next
      } else if (Math.abs(turn.x) < 0.4) {
        snapArmed = true;
      }
      if (Math.abs(turn.y) > DEADZONE) {
        player.position.y += (-turn.y) * FLY_SPEED * dt;
      }
    }
  }

  return { update };
}
