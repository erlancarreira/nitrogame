// ── Engine / Simulation Constants ────────────────────────────────────
// Shared between KartPro (human) and BotKart (AI).
// These are NOT vehicle tuning — they are physics engine parameters
// that must stay in sync across all kart types.

/** Maximum physics delta time (seconds). Clamps large frame gaps. */
export const MAX_DELTA = 0.05;

/** How often (seconds) karts report position for lap progress / network. */
export const POSITION_UPDATE_INTERVAL = 0.05; // 20Hz

/** Y offset added to grid position when spawning a kart. */
export const SPAWN_Y_OFFSET = 0.6;

// ── Collider Geometry (identical for all karts) ─────────────────────

/** Half-extents [x, y, z] for the kart cuboid collider. */
export const COLLIDER_HALF_EXTENTS: [number, number, number] = [0.8, 0.5, 1.2];

/** Offset [x, y, z] of the collider relative to the kart origin. */
export const COLLIDER_OFFSET: [number, number, number] = [0, 0.5, 0];
