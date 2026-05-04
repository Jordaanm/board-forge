// FlickTool tuning constants — issues #5a / #5b of issues--tools.md.
//
// These are target *velocity changes* (Δv), not raw impulses. The tool
// multiplies by the target's PhysicsComponent.state.mass at call time so
// heavier objects get a proportionally larger impulse and travel a similar
// distance as lighter ones under the same friction. Aim-mode caps the Δv
// before mass scaling — capping the impulse instead would defeat the
// equalisation for heavy objects.

export const FLICK_DEFAULT_MAGNITUDE = 10.0;   // Δv (m/s) for a click flick
export const FLICK_MAX_MAGNITUDE     = 30.0;   // max Δv for an aim flick
