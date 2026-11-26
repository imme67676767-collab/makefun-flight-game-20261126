// Keyboard and mouse input. Held keys and the pointer's offset from the
// screen centre combine into one stick (pitch and roll in -1..1) and one
// throttle lever; one-shot presses (pause, mute, camera, reset, confirm) are
// queued as bit flags so a press between frames is never lost or doubled.

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

export function createInput() {
  const held = new Set();
  let actions = 0;
  let pointerX = 0;
  let pointerY = 0;
  let pointerSeen = false;

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
  window.addEventListener('blur', () => held.clear());

  window.addEventListener('pointermove', (event) => {
    pointerSeen = true;
    pointerX = (event.clientX / window.innerWidth) * 2 - 1;
    pointerY = (event.clientY / window.innerHeight) * 2 - 1;
  });
  window.addEventListener('pointerdown', () => {
    actions |= ACTION_CONFIRM;
  });

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
    /**
     * The stick right now. pitch +1 pulls the nose up, roll +1 banks right.
     * Keys win; the mouse adds its offset when it has moved, with a dead zone
     * around the centre so a resting pointer does not steer.
     */
    stick() {
      let pitch = (any(PITCH_UP) ? 1 : 0) - (any(PITCH_DOWN) ? 1 : 0);
      let roll = (any(ROLL_RIGHT) ? 1 : 0) - (any(ROLL_LEFT) ? 1 : 0);
      if (pointerSeen) {
        if (Math.abs(pointerY) > 0.12) pitch += -pointerY * 0.85;
        if (Math.abs(pointerX) > 0.12) roll += pointerX * 0.85;
      }
      return { pitch: clampUnit(pitch), roll: clampUnit(roll) };
    },

    /** Throttle lever movement: +1 pushing up, -1 pulling back, 0 holding. */
    throttleDelta() {
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
