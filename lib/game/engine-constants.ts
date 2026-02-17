// ── Engine / Simulation Constants ────────────────────────────────────
// Shared between KartPro (human) and BotKart (AI).
// These are NOT vehicle tuning — they are physics engine parameters
// that must stay in sync across all kart types.

/** Maximum physics delta time (seconds). Clamps large frame gaps. */
export const MAX_DELTA = 0.05;

/** How often (seconds) karts report position for lap progress / network. */
export const POSITION_UPDATE_INTERVAL = 0.05; // 20Hz — matches SNAPSHOT_RATE for smooth remote interpolation

/** Y offset added to grid position when spawning a kart. */
export const SPAWN_Y_OFFSET = 0.0;

/** Fixed physics timestep (60Hz) for deterministic simulation independent of framerate. */
export const PHYSICS_TIMESTEP = 1 / 60;

// ── Collider Geometry (identical for all karts) ─────────────────────

/** Half-extents [x, y, z] for the kart cuboid collider. */
export const COLLIDER_HALF_EXTENTS: [number, number, number] = [0.5, 0.3, 0.8];

/** Offset [x, y, z] of the collider relative to the kart origin. */
export const COLLIDER_OFFSET: [number, number, number] = [0, 0.3, 0];

/** Visual offset for the kart model to align with the physics collider. */
// Physics body center is at Y=0 (relative to itself). Collider is at Y=0.5 (bottom at 0).
// Model origin is at bottom.
// We lift slightly (0.15) to ensure wheels are fully visible and not clipping on uneven mesh.
export const KART_MODEL_OFFSET: [number, number, number] = [0, 0.15, 0];
