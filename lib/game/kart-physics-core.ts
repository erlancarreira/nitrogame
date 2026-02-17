/**
 * Kart Physics Core - Módulo de física pura compartilhado entre cliente e servidor
 * 
 * Este módulo contém APENAS a lógica matemática de física do kart,
 * sem dependências de React, Three.js ou Rapier.
 * 
 * Usado por:
 * - Cliente: para prediction e reconciliation
 * - Servidor: para simulação autoritativa
 */

import type { PlayerState } from "@/types/network";
import { KartPhysicsConfig, PRESET_STANDARD } from "./physics-presets";

// ============ PHYSICS CONSTANTS ============

export const PHYSICS_CONSTANTS = {
  MAX_SPEED: PRESET_STANDARD.maxSpeed,
  ACCELERATION: PRESET_STANDARD.acceleration,
  BRAKE_FORCE: PRESET_STANDARD.brakeForce,
  TURN_SPEED: PRESET_STANDARD.turnSpeed,
  DRAG: PRESET_STANDARD.drag,
  DRIFT_SPEED_THRESHOLD: PRESET_STANDARD.driftSpeedThreshold,
  DRIFT_TURN_BONUS: PRESET_STANDARD.driftTurnBonus,
  DRIFT_SLIDE_FACTOR: PRESET_STANDARD.driftSlideFactor,
  DRIFT_BOOST_TIERS: PRESET_STANDARD.driftBoostTiers,
  DRIFT_BOOST_SPEEDS: PRESET_STANDARD.driftBoostSpeeds,
  DRIFT_BOOST_DURATION: PRESET_STANDARD.driftBoostDuration,
  REVERSE_SPEED_RATIO: PRESET_STANDARD.reverseSpeedRatio,
  SPEED_FACTOR_DIVISOR: PRESET_STANDARD.speedFactorDivisor,
  MIN_TURN_SPEED: PRESET_STANDARD.minTurnSpeed,
  SPIN_OUT_DURATION: 1.2,
  SPIN_OUT_ROTATIONS: 2, // 720 degrees
  OIL_SLIP_FREQUENCY: 15,
  OIL_SLIP_AMPLITUDE: 3.0,
} as const;

// ============ TYPES ============

export interface KartPhysicsState {
  position: [number, number, number];
  rotation: number;
  speed: number;
  velocity: [number, number, number];
  lapProgress: number;
  lap: number;

  // Internal physics state
  isDrifting: boolean;
  driftTime: number;
  driftDirection: number;
  driftSlideAngle: number;
  boostStrength: number;
  isInvincible: boolean;
  isOilSlipping: boolean;
  oilSlipTime: number;
  isSpinningOut: boolean;
  spinOutTime: number;
  currentSteer: number; // Smoothed steering value (-1 to 1)
  boostTimeRemaining: number; // seconds remaining for active boost, 0 = no boost
}

export interface PhysicsInput {
  throttle: number; // -1 to 1
  steer: number;    // -1 (left) to 1 (right)
  brake: boolean;
  drift: boolean;
  useItem: boolean;
}

// ============ INITIALIZATION ============

export function createPhysicsState(
  position: [number, number, number] = [0, 0, 0],
  rotation: number = 0
): KartPhysicsState {
  return {
    position: [...position],
    rotation,
    speed: 0,
    velocity: [0, 0, 0],
    lapProgress: 0,
    lap: 1,
    isDrifting: false,
    driftTime: 0,
    driftDirection: 0,
    driftSlideAngle: 0,
    boostStrength: 1,
    isInvincible: false,
    isOilSlipping: false,
    oilSlipTime: 0,
    isSpinningOut: false,
    spinOutTime: 0,
    currentSteer: 0,
    boostTimeRemaining: 0,
  };
}

export function stateToPlayerState(
  id: string,
  physics: KartPhysicsState,
  frame: number,
  serverTime: number
): PlayerState {
  return {
    id,
    position: [...physics.position],
    rotation: physics.rotation,
    speed: physics.speed,
    velocity: [...physics.velocity],
    lapProgress: physics.lapProgress,
    lap: physics.lap,
    frame,
    serverTime,
  };
}

export function playerStateToPhysics(state: PlayerState): KartPhysicsState {
  return {
    position: [...state.position],
    rotation: state.rotation,
    speed: state.speed,
    velocity: [...state.velocity],
    lapProgress: state.lapProgress,
    lap: state.lap,
    isDrifting: false,
    driftTime: 0,
    driftDirection: 0,
    driftSlideAngle: 0,
    boostStrength: 1,
    isInvincible: false,
    isOilSlipping: false,
    oilSlipTime: 0,
    isSpinningOut: false,
    spinOutTime: 0,
    currentSteer: 0,
    boostTimeRemaining: 0,
  };
}

// ============ PHYSICS UPDATE ============

/**
 * Atualiza o estado de física do kart baseado no input
 * Esta é a função principal que deve ser chamada a cada frame/tick
 * 
 * @param state - Estado atual do kart (mutado in-place)
 * @param input - Input do jogador
 * @param dt - Delta time em segundos
 * @param config - Configuração de física do kart (opcional, default=PRESET_STANDARD)
 * @returns O estado atualizado (mesma referência)
 */
export function updateKartPhysics(
  state: KartPhysicsState,
  input: PhysicsInput,
  dt: number,
  config: KartPhysicsConfig = PRESET_STANDARD
): KartPhysicsState {

  // Destructure constants for cleaner code, matching KartPro logic
  const MAX_SPEED = config.maxSpeed;
  const ACCEL = config.acceleration;
  const BRAKE = config.brakeForce;
  const TURN_SPEED = config.turnSpeed;
  const DRAG = config.drag;
  const DRIFT_SPEED_THRESHOLD = config.driftSpeedThreshold;
  const DRIFT_TURN_BONUS = config.driftTurnBonus;
  const DRIFT_SLIDE_FACTOR = config.driftSlideFactor;
  const DRIFT_BOOST_TIERS = config.driftBoostTiers;
  const DRIFT_BOOST_SPEEDS = config.driftBoostSpeeds;
  // const DRIFT_BOOST_DURATION = config.driftBoostDuration; // Handled externally via timeout/flags in KartPro, implied here via boostStrength decay? 
  // Note: KartPro handles boost duration with setTimeout. Here we just apply physics. 
  // For prediction, boostStrength is part of state. Decay/Reset is not fully simulated here yet (requires timers), 
  // but for "shadow mode" (short term prediction) it's fine as boostStrength comes from state.

  const REVERSE_SPEED_RATIO = config.reverseSpeedRatio;
  const SPEED_FACTOR_DIVISOR = config.speedFactorDivisor;
  const MIN_TURN_SPEED = config.minTurnSpeed;

  // Effect Constants (hardcoded in KartPro mostly, or derived)
  const SPIN_OUT_DURATION  = PHYSICS_CONSTANTS.SPIN_OUT_DURATION;
  const SPIN_OUT_ROTATIONS = PHYSICS_CONSTANTS.SPIN_OUT_ROTATIONS;
  const OIL_SLIP_FREQUENCY = PHYSICS_CONSTANTS.OIL_SLIP_FREQUENCY;
  const OIL_SLIP_AMPLITUDE = PHYSICS_CONSTANTS.OIL_SLIP_AMPLITUDE;

  // Normalize delta time to prevent huge jumps
  const safeDt = Math.min(dt, 0.1); // Max 100ms per update

  let throttle = input.throttle;
  let rawTurn = input.steer;

  // Block input during spin out
  if (state.isSpinningOut) {
    throttle = 0;
    rawTurn = 0;
  }

  // Smooth steering: exponential blend toward raw input for inertia feel
  const STEER_RATE = config.steerSmoothing;
  const steerBlend = 1 - Math.exp(-STEER_RATE * safeDt);
  state.currentSteer += (rawTurn - state.currentSteer) * steerBlend;
  // Snap to zero when close to avoid micro-drift
  if (Math.abs(state.currentSteer) < 0.001) state.currentSteer = 0;
  const turn = state.currentSteer;

  // ============ DRIFT LOGIC ============
  // Using explicit drift input (Option B)
  const wantsDrift = input.drift && Math.abs(state.speed) > DRIFT_SPEED_THRESHOLD;

  if (wantsDrift && !state.isDrifting && Math.abs(turn) > 0.01) {
    // Initiate drift
    state.isDrifting = true;
    state.driftDirection = Math.sign(turn);
    state.driftTime = 0;
    state.driftSlideAngle = 0;
  } else if (!wantsDrift && state.isDrifting) {
    // Release drift - check for boost
    state.isDrifting = false;

    let tier = -1;
    for (let i = DRIFT_BOOST_TIERS.length - 1; i >= 0; i--) {
      if (state.driftTime >= DRIFT_BOOST_TIERS[i]) {
        tier = i;
        break;
      }
    }

    if (tier >= 0) {
      state.boostStrength = DRIFT_BOOST_SPEEDS[tier];
      state.boostTimeRemaining = config.driftBoostDuration[tier];
    }

    state.driftTime = 0;
    state.driftDirection = 0;
  } else if (state.isDrifting) {
    // Accumulate drift time
    state.driftTime += safeDt;
  }

  // ============ BOOST TIMER DECAY ============

  if (state.boostTimeRemaining > 0) {
    state.boostTimeRemaining -= safeDt;
    if (state.boostTimeRemaining <= 0) {
      state.boostTimeRemaining = 0;
      state.boostStrength = 1;
    }
  }

  // ============ SPEED CALCULATION ============

  if (throttle > 0) {
    state.speed += ACCEL * state.boostStrength * throttle * safeDt;
  } else if (throttle < 0) {
    state.speed -= BRAKE * Math.abs(throttle) * safeDt;
  } else if (Math.abs(state.speed) > 0.1) {
    const sign = Math.sign(state.speed);
    state.speed -= sign * DRAG * safeDt;
    if (Math.sign(state.speed) !== sign) state.speed = 0;
  } else {
    state.speed = 0;
  }

  // Clamp speed
  const maxS = MAX_SPEED * state.boostStrength;
  state.speed = Math.max(
    Math.min(state.speed, maxS),
    -maxS * REVERSE_SPEED_RATIO
  );

  // ============ TURNING ============

  if (Math.abs(turn) > 0 && Math.abs(state.speed) > MIN_TURN_SPEED) {
    const speedFactor = Math.min(Math.abs(state.speed) / SPEED_FACTOR_DIVISOR, 1.0);
    let driftBonus = 1.0;

    if (state.isDrifting) {
      driftBonus = DRIFT_TURN_BONUS;
      const driftBias = state.driftDirection * 0.6 * TURN_SPEED * speedFactor * safeDt;
      state.rotation += driftBias * Math.sign(state.speed);
    }

    const turnAmount = turn * TURN_SPEED * speedFactor * driftBonus * safeDt;
    state.rotation += turnAmount * Math.sign(state.speed);
  } else if (state.isDrifting && Math.abs(state.speed) > MIN_TURN_SPEED) {
    // No turn input during drift - still apply drift bias
    const speedFactor = Math.min(Math.abs(state.speed) / SPEED_FACTOR_DIVISOR, 1.0);
    const driftBias = state.driftDirection * 0.4 * TURN_SPEED * speedFactor * safeDt;
    state.rotation += driftBias * Math.sign(state.speed);
  }

  // ============ OIL SLIP EFFECT ============

  if (state.isOilSlipping) {
    state.oilSlipTime += safeDt;
    const slipNoise = Math.sin(state.oilSlipTime * OIL_SLIP_FREQUENCY) * OIL_SLIP_AMPLITUDE;
    state.rotation += slipNoise * safeDt;
  }

  // ============ SPIN OUT EFFECT ============

  if (state.isSpinningOut) {
    state.spinOutTime += safeDt;
    const spinSpeed = (2 * Math.PI * SPIN_OUT_ROTATIONS) / SPIN_OUT_DURATION;
    state.rotation += spinSpeed * safeDt;
    state.speed *= Math.max(0, 1 - 3 * safeDt);

    if (state.spinOutTime >= SPIN_OUT_DURATION) {
      state.isSpinningOut = false;
      state.spinOutTime = 0;
    }
  }

  // ============ MOVEMENT APPLICATION ============

  // Hard stop: if speed is negligible AND no input, zero everything to prevent
  // floating-point drift causing micro-movement when the kart should be static.
  if (Math.abs(state.speed) < 0.05 && Math.abs(throttle) < 0.01 && !state.isDrifting && !state.isSpinningOut && !state.isOilSlipping) {
    state.speed = 0;
    state.velocity = [0, 0, 0];
    state.driftSlideAngle = 0;
    return state;
  }

  // Drift slide angle update
  if (state.isDrifting) {
    state.driftSlideAngle = Math.min(state.driftSlideAngle + safeDt * 3.0, 1.0);
  } else {
    state.driftSlideAngle *= Math.max(0, 1 - 8 * safeDt);
  }

  const forwardX = Math.sin(state.rotation);
  const forwardZ = Math.cos(state.rotation);

  let vx = forwardX * state.speed;
  let vz = forwardZ * state.speed;

  // Drift slide velocity
  if (state.isDrifting || state.driftSlideAngle > 0.01) {
    const slideStrength = DRIFT_SLIDE_FACTOR * state.driftSlideAngle * state.speed;
    const slideDir = -state.driftDirection;
    // Only apply slide if we were drifting or fading out
    if (state.driftDirection !== 0) {
      vx += forwardZ * slideDir * slideStrength;
      vz += -forwardX * slideDir * slideStrength;
    }
  }

  state.velocity = [vx, 0, vz];

  // Update position
  state.position[0] += vx * safeDt;
  state.position[2] += vz * safeDt;
  // Y stays at ground level (handled by ground collision elsewhere)

  return state;
}

// ============ EFFECT FUNCTIONS ============

export function applyBoost(
  state: KartPhysicsState,
  strength: number = 1.5,
  duration: number = 2
): void {
  state.boostStrength = strength;
  state.boostTimeRemaining = duration;
}

export function resetBoost(state: KartPhysicsState): void {
  state.boostStrength = 1;
  state.boostTimeRemaining = 0;
}

export function applyStarPower(
  state: KartPhysicsState,
  strength: number = 1.3,
  duration: number = 8
): void {
  state.isInvincible = true;
  state.boostStrength = strength;
  state.boostTimeRemaining = duration;
}

export function resetStarPower(state: KartPhysicsState): void {
  state.isInvincible = false;
  state.boostStrength = 1;
  state.boostTimeRemaining = 0;
}

export function applyOilSlip(state: KartPhysicsState): void {
  if (state.isInvincible) return;
  state.isOilSlipping = true;
  state.oilSlipTime = 0;
}

export function resetOilSlip(state: KartPhysicsState): void {
  state.isOilSlipping = false;
  state.oilSlipTime = 0;
}

export function spinOut(state: KartPhysicsState): void {
  if (state.isInvincible || state.isSpinningOut) return;
  state.isSpinningOut = true;
  state.spinOutTime = 0;
  state.speed *= 0.1;
}

// ============ UTILITY FUNCTIONS ============

export function getDriftTier(state: KartPhysicsState): number {
  const C = PHYSICS_CONSTANTS;
  if (!state.isDrifting) return 0;

  for (let i = C.DRIFT_BOOST_TIERS.length - 1; i >= 0; i--) {
    if (state.driftTime >= C.DRIFT_BOOST_TIERS[i]) {
      return i + 1;
    }
  }
  return 0;
}

export function getSlipRatio(state: KartPhysicsState): number {
  const C = PHYSICS_CONSTANTS;
  if (state.isDrifting) {
    return Math.min(Math.abs(state.speed) / C.MAX_SPEED, 1);
  }
  return 0;
}

export function normalizeInput(
  input: Partial<PhysicsInput>
): PhysicsInput {
  return {
    throttle: Math.max(-1, Math.min(1, input.throttle ?? 0)),
    steer: Math.max(-1, Math.min(1, input.steer ?? 0)),
    brake: input.brake ?? false,
    drift: input.drift ?? false,
    useItem: input.useItem ?? false,
  };
}

// ============ EXPORT DEFAULT ============

export default {
  PHYSICS_CONSTANTS,
  createPhysicsState,
  stateToPlayerState,
  playerStateToPhysics,
  updateKartPhysics,
  applyBoost,
  resetBoost,
  applyStarPower,
  resetStarPower,
  applyOilSlip,
  resetOilSlip,
  spinOut,
  getDriftTier,
  getSlipRatio,
  normalizeInput,
};
