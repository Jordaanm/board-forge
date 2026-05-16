// Distance above the table surface that a held object is lifted to while
// being dragged.
export const CARRY_LIFT_HEIGHT = 0.3;

// Throw velocity is computed from cursor samples within this many ms of
// release. A stationary gap longer than this drops the object straight down.
export const THROW_VELOCITY_WINDOW_MS = 80;

// Press-vs-hold classification for GrabTool. A pointer down commits to a
// carry when the cursor moves past GRAB_MOVE_THRESHOLD_PX from the press
// point (fast move = short press) or the hold timer elapses past
// GRAB_LONG_PRESS_MS without movement (slow/still = long press). Lifted out
// of GrabTool so other tools/tests can share the same numbers.
export const GRAB_LONG_PRESS_MS      = 150;
export const GRAB_MOVE_THRESHOLD_PX  = 5;
