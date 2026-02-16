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

import type { PlayerInput, PlayerState } from "@/types/network";

// ============ PHYSICS CONSTANTS ============

export const PHYSICS_CONSTANTS = {
  MAX_SPEED: 18,
  ACCELERATION: 25,
  BRAKE_FORCE: 20,
  TURN_SPEED: 3.5,
  DRAG: 8,
  DRIFT_SPEED_THRESHOLD: 8,
  DRIFT_TURN_BONUS: 1.4,
  DRIFT_SLIDE_FACTOR: 0.35,
  DRIFT_BOOST_TIERS: [0.5, 1.2, 2.5],
  DRIFT_BOOST_SPEEDS: [1.2, 1.4, 1.6],
  DRIFT_BOOST_DURATION: [0.8, 1.5, 2.5],
  REVERSE_SPEED_RATIO: 0.4,
  SPEED_FACTOR_DIVISOR: 10,
  MIN_TURN_SPEED: 0.5,
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
}

export interface PhysicsInput {
  throttle: number; // -1 to 1
  steer: number;    // -1 (left) to 1 (right)
  brake: boolean;
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
 * @returns O estado atualizado (mesma referência)
 */
export function updateKartPhysics(
  state: KartPhysicsState,
  input: PhysicsInput,
  dt: number
): KartPhysicsState {
  const C = PHYSICS_CONSTANTS;

  // Normalize delta time to prevent huge jumps
  const safeDt = Math.min(dt, 0.1); // Max 100ms per update

  let throttle = input.throttle;
  let turn = input.steer;

  // Block input during spin out
  if (state.isSpinningOut) {
    throttle = 0;
    turn = 0;
  }

  // ============ DRIFT LOGIC ============

  const wantsDrift = input.brake && Math.abs(state.speed) > C.DRIFT_SPEED_THRESHOLD;

  if (wantsDrift && !state.isDrifting && Math.abs(turn) > 0.1) {
    // Initiate drift
    state.isDrifting = true;
    state.driftDirection = Math.sign(turn);
    state.driftTime = 0;
    state.driftSlideAngle = 0;
  } else if (!wantsDrift && state.isDrifting) {
    // Release drift - check for boost
    state.isDrifting = false;

    let tier = -1;
    for (let i = C.DRIFT_BOOST_TIERS.length - 1; i >= 0; i--) {
      if (state.driftTime >= C.DRIFT_BOOST_TIERS[i]) {
        tier = i;
        break;
      }
    }

    if (tier >= 0) {
      state.boostStrength = C.DRIFT_BOOST_SPEEDS[tier];
      // Note: Boost duration handling is external (via timestamps)
    }

    state.driftTime = 0;
    state.driftDirection = 0;
  } else if (state.isDrifting) {
    // Accumulate drift time
    state.driftTime += safeDt;
  }

  // ============ SPEED CALCULATION ============

  if (throttle > 0) {
    state.speed += C.ACCELERATION * state.boostStrength * throttle * safeDt;
  } else if (throttle < 0) {
    state.speed -= C.BRAKE_FORCE * Math.abs(throttle) * safeDt;
  } else if (Math.abs(state.speed) > 0.1) {
    const sign = Math.sign(state.speed);
    state.speed -= sign * C.DRAG * safeDt;
    if (Math.sign(state.speed) !== sign) state.speed = 0;
  } else {
    state.speed = 0;
  }

  // Clamp speed
  const maxSpeed = C.MAX_SPEED * state.boostStrength;
  state.speed = Math.max(
    Math.min(state.speed, maxSpeed),
    -maxSpeed * C.REVERSE_SPEED_RATIO
  );

  // ============ TURNING ============

  if (Math.abs(turn) > 0.1 && Math.abs(state.speed) > C.MIN_TURN_SPEED) {
    const speedFactor = Math.min(Math.abs(state.speed) / C.SPEED_FACTOR_DIVISOR, 1.0);
    let driftBonus = 1.0;

    if (state.isDrifting) {
      driftBonus = C.DRIFT_TURN_BONUS;
      const driftBias = state.driftDirection * 0.6 * C.TURN_SPEED * speedFactor * safeDt;
      state.rotation += driftBias * Math.sign(state.speed);
    }

    const turnAmount = turn * C.TURN_SPEED * speedFactor * driftBonus * safeDt;
    const direction = Math.sign(state.speed);
    state.rotation += turnAmount * direction;
  } else if (state.isDrifting && Math.abs(state.speed) > C.MIN_TURN_SPEED) {
    // No turn input during drift - still apply drift bias
    const speedFactor = Math.min(Math.abs(state.speed) / C.SPEED_FACTOR_DIVISOR, 1.0);
    const driftBias = state.driftDirection * 0.4 * C.TURN_SPEED * speedFactor * safeDt;
    state.rotation += driftBias * Math.sign(state.speed);
  }

  // ============ OIL SLIP EFFECT ============

  if (state.isOilSlipping) {
    state.oilSlipTime += safeDt;
    const slipNoise = Math.sin(state.oilSlipTime * C.OIL_SLIP_FREQUENCY) * C.OIL_SLIP_AMPLITUDE;
    state.rotation += slipNoise * safeDt;
  }

  // ============ SPIN OUT EFFECT ============

  if (state.isSpinningOut) {
    state.spinOutTime += safeDt;
    const spinSpeed = (2 * Math.PI * C.SPIN_OUT_ROTATIONS) / C.SPIN_OUT_DURATION;
    state.rotation += spinSpeed * safeDt;
    state.speed *= Math.max(0, 1 - 3 * safeDt);

    if (state.spinOutTime >= C.SPIN_OUT_DURATION) {
      state.isSpinningOut = false;
      state.spinOutTime = 0;
    }
  }

  // ============ MOVEMENT APPLICATION ============

  const forwardX = Math.sin(state.rotation);
  const forwardZ = Math.cos(state.rotation);

  let vx = forwardX * state.speed;
  let vz = forwardZ * state.speed;

  // Drift slide
  if (state.isDrifting) {
    state.driftSlideAngle = Math.min(state.driftSlideAngle + safeDt * 3.0, 1.0);
    const slideStrength = C.DRIFT_SLIDE_FACTOR * state.driftSlideAngle * state.speed;
    const slideDir = -state.driftDirection;
    vx += forwardZ * slideDir * slideStrength;
    vz += -forwardX * slideDir * slideStrength;
  } else {
    state.driftSlideAngle *= Math.max(0, 1 - 8 * safeDt);
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
  strength: number = 1.5
): void {
  state.boostStrength = strength;
}

export function resetBoost(state: KartPhysicsState): void {
  state.boostStrength = 1;
}

export function applyStarPower(
  state: KartPhysicsState,
  strength: number = 1.3
): void {
  state.isInvincible = true;
  state.boostStrength = strength;
}

export function resetStarPower(state: KartPhysicsState): void {
  state.isInvincible = false;
  state.boostStrength = 1;
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
