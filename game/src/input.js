// Keyboard and mouse input. Held keys and a virtual mouse stick combine
// into one stick (pitch and roll in -1..1) and one throttle lever; one-shot
// presses (pause, mute, camera, reset, confirm) are queued as bit flags so a
// press between frames is never lost or doubled.
//
// The mouse is a virtual joystick: press and drag anywhere — the drag offset
// from the press point is the stick, and releasing (or returning to the
// press point) recentres it to zero. A plain click never confirms anything;
// confirm is Space/Enter or the on-screen buttons only, so clicking through
// menus and settings can never launch a flight by accident. The game also
// gates the stick off outside flight via setActive().

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_MUTE = 4;
export const ACTION_CAMERA = 8;
export const ACTION_RESET = 16;

const PITCH_UP = new Set(['ArrowUp']);
const PITCH_DOWN = new Set(['ArrowDown']);
const ROLL_LEFT = new Set(['ArrowLeft', 'KeyA']);
const ROLL_RIGHT = new Set(['ArrowRight', 'KeyD']);
const THROTTLE_UP = new Set(['ShiftLeft', 'ShiftRight', 'KeyW']);
const THROTTLE_DOWN = new Set(['ControlLeft', 'ControlRight', 'KeyS']);
const CONFIRM_KEYS = new Set(['Space', 'Enter']);
const PAUSE_KEYS = new Set(['Escape', 'KeyP']);

// Full stick deflection at this many pixels of drag from the press point.
const STICK_PIXELS = 170;

export function createInput() {
  const held = new Set();
  let actions = 0;
  let sensitivity = 1;
  let active = true;
  // Virtual stick state: press point + current drag offset in pixels.
  let stickHeld = false;
  let originX = 0;
  let originY = 0;
  let dragX = 0;
  let dragY = 0;

  window.addEventListener('keydown', (event) => {
    if (event.repeat) {
      if (isGameKey(event.code)) event.preventDefault();
      return;
    }
    held.add(event.code);
    if (CONFIRM_KEYS.has(event.code)) actions |= ACTION_CONFIRM;
    else if (PAUSE_KEYS.has(event.code)) actions |= ACTION_PAUSE;
    else if (event.code === 'KeyM') actions |= ACTION_MUTE;
    else if (event.code === 'KeyC') actions |= ACTION_CAMERA;
    else if (event.code === 'KeyR') actions |= ACTION_RESET;
    if (isGameKey(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => held.delete(event.code));
  // A key released while the tab is hidden never sends keyup: let go of all.
  window.addEventListener('blur', () => {
    held.clear();
    stickHeld = false;
    dragX = 0;
    dragY = 0;
  });

  window.addEventListener('pointerdown', (event) => {
    // Only the primary button grabs the stick, and never on UI controls —
    // dragging a settings slider or pressing a button must not steer.
    if (event.button !== 0) return;
    if (event.target && event.target.closest && event.target.closest('button, input, .overlay, .card')) return;
    stickHeld = true;
    originX = event.clientX;
    originY = event.clientY;
    dragX = 0;
    dragY = 0;
  });
  window.addEventListener('pointermove', (event) => {
    if (!stickHeld) return;
    dragX = event.clientX - originX;
    dragY = event.clientY - originY;
  });
  const releaseStick = () => {
    stickHeld = false;
    dragX = 0;
    dragY = 0;
  };
  window.addEventListener('pointerup', releaseStick);
  window.addEventListener('pointercancel', releaseStick);

  function isGameKey(code) {
    return PITCH_UP.has(code) || PITCH_DOWN.has(code) || ROLL_LEFT.has(code) || ROLL_RIGHT.has(code)
      || THROTTLE_UP.has(code) || THROTTLE_DOWN.has(code) || CONFIRM_KEYS.has(code) || PAUSE_KEYS.has(code)
      || code === 'KeyM' || code === 'KeyC' || code === 'KeyR';
  }

  function any(set) {
    for (const code of set) if (held.has(code)) return true;
    return false;
  }

  function clampUnit(v) {
    return Math.max(-1, Math.min(1, v));
  }

  return {
    /** Mouse steering gain from the settings panel (0.3..2.0). */
    setSensitivity(value) {
      sensitivity = Math.min(2, Math.max(0.3, value));
    },

    /** Gate the whole stick off (menus, pause, results) so UI never flies. */
    setActive(on) {
      active = Boolean(on);
      if (!active) releaseStick();
    },

    /** */
    stick() {
      if (!active) return { pitch: 0, roll: 0 };
      let pitch = (any(PITCH_UP) ? 1 : 0) - (any(PITCH_DOWN) ? 1 : 0);
      let roll = (any(ROLL_RIGHT) ? 1 : 0) - (any(ROLL_LEFT) ? 1 : 0);
      if (stickHeld) {
        const mx = (dragX / STICK_PIXELS) * sensitivity;
        const my = (dragY / STICK_PIXELS) * sensitivity;
        if (Math.abs(my) > 0.08) pitch += -my;
        if (Math.abs(mx) > 0.08) roll += mx;
      }
      return { pitch: clampUnit(pitch), roll: clampUnit(roll) };
    },

    /** Throttle lever movement: +1 pushing up, -1 pulling back, 0 holding. */
    throttleDelta() {
      if (!active) return 0;
      return (any(THROTTLE_UP) ? 1 : 0) - (any(THROTTLE_DOWN) ? 1 : 0);
    },

    /** One-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
