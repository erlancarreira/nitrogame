// ── Kart Physics Presets ─────────────────────────────────────────────
// Single source of truth for all kart tuning constants.
// KartPro reads from the active preset; future car-selection UI can
// pick different presets per vehicle class.

export interface KartPhysicsConfig {
    // Movement
    maxSpeed: number;
    acceleration: number;
    brakeForce: number;
    drag: number;
    reverseSpeedRatio: number;

    // Steering
    turnSpeed: number;
    minTurnSpeed: number;
    speedFactorDivisor: number;
    steerSmoothing: number; // Higher = faster response (lerp rate per second)

    // Drift
    driftSpeedThreshold: number;
    driftTurnBonus: number;
    driftSlideFactor: number;
    driftBoostTiers: [number, number, number];      // seconds to reach each tier
    driftBoostSpeeds: [number, number, number];     // speed multiplier per tier
    driftBoostDuration: [number, number, number];   // boost duration (s) per tier

    // Physics body
    mass: number;
}

// ── STANDARD (balanced — default for all karts) ─────────────────────
export const PRESET_STANDARD: KartPhysicsConfig = {
    maxSpeed: 40,
    acceleration: 8,
    brakeForce: 35,
    drag: 5,
    reverseSpeedRatio: 0.3,

    turnSpeed: 1.8,
    minTurnSpeed: 0.5,
    speedFactorDivisor: 10,
    steerSmoothing: 10,

    driftSpeedThreshold: 8,
    driftTurnBonus: 2.2,
    driftSlideFactor: 0.15,
    driftBoostTiers: [0.8, 1.5, 2.5],
    driftBoostSpeeds: [1.3, 1.5, 1.8],
    driftBoostDuration: [0.8, 1.2, 1.8],

    mass: 300,
};

// ── SPEED (faster top speed, less agile) ────────────────────────────
export const PRESET_SPEED: KartPhysicsConfig = {
    maxSpeed: 45,
    acceleration: 9,
    brakeForce: 35,
    drag: 4.8,
    reverseSpeedRatio: 0.3,

    turnSpeed: 1.6,
    minTurnSpeed: 0.5,
    speedFactorDivisor: 10,
    steerSmoothing: 8,

    driftSpeedThreshold: 10,
    driftTurnBonus: 2.0,
    driftSlideFactor: 0.12,
    driftBoostTiers: [0.8, 1.5, 2.5],
    driftBoostSpeeds: [1.4, 1.6, 1.9],
    driftBoostDuration: [0.8, 1.2, 1.8],

    mass: 320,
};

// ── DRIFT (agile, great drift control) ──────────────────────────────
export const PRESET_DRIFT: KartPhysicsConfig = {
    maxSpeed: 38,
    acceleration: 9.5,
    brakeForce: 30,
    drag: 5.2,
    reverseSpeedRatio: 0.3,

    turnSpeed: 2.2,
    minTurnSpeed: 0.6,
    speedFactorDivisor: 10,
    steerSmoothing: 12,

    driftSpeedThreshold: 6,
    driftTurnBonus: 2.6,
    driftSlideFactor: 0.2,
    driftBoostTiers: [0.7, 1.3, 2.2],
    driftBoostSpeeds: [1.3, 1.5, 1.8],
    driftBoostDuration: [1.0, 1.4, 2.0],

    mass: 280,
};

// ── HEAVY (slow start, high top speed, hard to turn) ────────────────
export const PRESET_HEAVY: KartPhysicsConfig = {
    maxSpeed: 42,
    acceleration: 6,
    brakeForce: 40,
    drag: 5.5,
    reverseSpeedRatio: 0.25,

    turnSpeed: 1.4,
    minTurnSpeed: 0.4,
    speedFactorDivisor: 12,
    steerSmoothing: 7,

    driftSpeedThreshold: 10,
    driftTurnBonus: 1.8,
    driftSlideFactor: 0.1,
    driftBoostTiers: [0.9, 1.6, 2.7],
    driftBoostSpeeds: [1.2, 1.4, 1.7],
    driftBoostDuration: [0.8, 1.2, 1.8],

    mass: 420,
};

export const KART_PRESETS = {
    standard: PRESET_STANDARD,
    speed: PRESET_SPEED,
    drift: PRESET_DRIFT,
    heavy: PRESET_HEAVY,
} as const;

export type KartPresetId = keyof typeof KART_PRESETS;
