// FlickTool tuning constants — issues #5a / #5b of issues--tools.md.
//
// Click-mode flicks fire at FLICK_DEFAULT_MAGNITUDE along the camera-forward
// vector projected onto the table plane. Aim-mode flicks (#5b) scale linearly
// with drag distance, capped at FLICK_MAX_MAGNITUDE.

export const FLICK_DEFAULT_MAGNITUDE = 0.4;
export const FLICK_MAX_MAGNITUDE     = 1.5;
