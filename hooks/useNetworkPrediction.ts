// hooks/useNetworkPrediction.ts

import { useRef, useCallback, useEffect } from "react";
import { debugLogger } from "@/lib/debug/logger";
import {
  PlayerInput,
  PlayerState,
  GameSnapshot,
  InputBuffer,
  INPUT_SEND_RATE,
  FRAME_INTERVAL,
  MAX_PENDING_INPUTS,
} from "@/types/network";

/** FRAME_INTERVAL is in ms (1000/60 ≈ 16.67). Physics core expects seconds. */
const FRAME_DT = FRAME_INTERVAL / 1000;
import {
  KartPhysicsState,
  PhysicsInput,
  createPhysicsState,
  stateToPlayerState,
  updateKartPhysics,
  normalizeInput,
} from "@/lib/game/kart-physics-core";
import { networkManager } from "@/lib/game/networking";
import { netClock } from "@/lib/netcode/netclock";

/** Lerp angle via shortest arc (handles -PI/+PI wrapping) */
function smoothAngle(a: number, b: number, factor: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * factor;
}

function smoothTowards(
  a: KartPhysicsState,
  b: KartPhysicsState,
  factor: number
): KartPhysicsState {
  // Dead zone: if both speeds are near zero, don't interpolate position/velocity
  // to prevent micro-jitter from floating point differences when idle.
  const bothIdle = Math.abs(a.speed) < 0.05 && Math.abs(b.speed) < 0.05;

  return {
    ...a,

    position: bothIdle ? [...a.position] : [
      a.position[0] + (b.position[0] - a.position[0]) * factor,
      a.position[1], // Y controlled by Rapier (gravity/ground), never interpolate from core
      a.position[2] + (b.position[2] - a.position[2]) * factor,
    ],

    rotation: smoothAngle(a.rotation, b.rotation, factor),

    velocity: bothIdle ? [0, 0, 0] : [
      a.velocity[0] + (b.velocity[0] - a.velocity[0]) * factor,
      0, // Y velocity from Rapier
      a.velocity[2] + (b.velocity[2] - a.velocity[2]) * factor,
    ],

    speed: bothIdle ? 0 : a.speed + (b.speed - a.speed) * factor,
    lap: b.lap,
    lapProgress: b.lapProgress,

    // flags sincronizam direto (não interpolar boolean)
    isDrifting: b.isDrifting,
    driftTime: b.driftTime,
    driftDirection: b.driftDirection,
    driftSlideAngle: b.driftSlideAngle,
    boostStrength: b.boostStrength,
    isInvincible: b.isInvincible,
    isOilSlipping: b.isOilSlipping,
    oilSlipTime: b.oilSlipTime,
    isSpinningOut: b.isSpinningOut,
    spinOutTime: b.spinOutTime,
    currentSteer: a.currentSteer + (b.currentSteer - a.currentSteer) * factor,
    boostTimeRemaining: b.boostTimeRemaining,
  };
}

const MICRO_CORRECTION_THRESHOLD_SQ = 0.01; // 10cm squared (0.1 * 0.1)
const SNAP_THRESHOLD_SQ = 1.0; // 1m squared

/** Distance squared using only X/Z — Y is controlled by Rapier (gravity/ground)
 *  and diverges from the core's Y=0 assumption, causing false positives in
 *  correction thresholds that trigger constant smoothTowards jitter when idle. */
function calculateDistSq(posA: number[], posB: number[]) {
  const dx = posA[0] - posB[0];
  const dz = posA[2] - posB[2];
  return dx * dx + dz * dz;
}

function physicsStateToLoggable(state: KartPhysicsState) {
  return {
    position: { x: state.position[0], y: state.position[1], z: state.position[2] },
    velocity: { x: state.velocity[0], y: state.velocity[1], z: state.velocity[2] },
    rotation: state.rotation,
    speed: state.speed
  };
}

export function useNetworkPrediction(
  kartId: string,
  initialPosition: [number, number, number],
  initialRotation: number = 0,
  isLocalPlayer: boolean = false
) {
  // Estado de física autoritativo do servidor (último snapshot recebido)
  const serverState = useRef<KartPhysicsState>(
    createPhysicsState(initialPosition, initialRotation)
  );

  // Estado de física renderizado (após prediction/reconciliation)
  const renderState = useRef<KartPhysicsState>(
    createPhysicsState(initialPosition, initialRotation)
  );

  // Buffer de inputs pendentes
  const inputBuffer = useRef<InputBuffer>({
    pending: [],
    lastConfirmedFrame: 0,
    lastSentFrame: 0,
  });

  // Frame atual da simulação
  const currentFrame = useRef(0);

  // Último input enviado para o servidor
  const lastInputSendTime = useRef(0);

  // Callback externo
  const onStateChangedRef = useRef<((state: PlayerState) => void) | null>(null);

  // Métricas de debug
  const metricsRef = useRef({
    lastRollbackLength: 0,
    totalReconciliations: 0,
    consecutiveZeroProgress: 0,
  });

  const toPhysicsInput = useCallback((input: Omit<PlayerInput, "frame" | "timestamp">): PhysicsInput => {
    return normalizeInput({
      throttle: input.throttle,
      steer: input.steer,
      brake: input.brake,
      drift: input.drift,
      useItem: input.useItem,
    });
  }, []);

  const applyInput = useCallback(
    (state: KartPhysicsState, input: PlayerInput, dt: number): KartPhysicsState => {
      const physicsInput = toPhysicsInput(input);
      const newState = structuredClone(state);
      return updateKartPhysics(newState, physicsInput, dt);
    },
    [toPhysicsInput]
  );

  const reapplyPendingInputs = useCallback(
    (baseState: KartPhysicsState) => {
      let state = structuredClone(baseState);

      const inputsToReapply = inputBuffer.current.pending;

      // Log rollback length para debug
      const rollbackLength = inputsToReapply.length;
      if (rollbackLength > 0) {
        metricsRef.current.lastRollbackLength = rollbackLength;
        metricsRef.current.totalReconciliations++;

        if (rollbackLength > MAX_PENDING_INPUTS * 0.8) {
          if (process.env.NODE_ENV === "development") {
            console.warn(
              `[net-pred] Rollback muito grande: ${rollbackLength} inputs. Rede instável?`
            );
          }
        }
      }

      for (const pending of inputsToReapply) {
        // Use fixed timestep for replay to ensure determinism matching server
        state = applyInput(state, pending.input, FRAME_DT);

        pending.predictedState = stateToPlayerState(
          kartId,
          state,
          pending.input.frame,
          netClock.now
        );
      }

      return state;
    },
    [applyInput, kartId]
  );

  const processInput = useCallback(
    (inputData: Omit<PlayerInput, "frame" | "timestamp">) => {
      // Rate Limit Input Generation to Network Tick (30Hz)
      // Use performance.now() for local throttling (monotonic)
      const now = performance.now();
      const timeSinceLastInput = now - lastInputSendTime.current;
      const tickInterval = 1000 / INPUT_SEND_RATE;

      if (timeSinceLastInput < tickInterval) {
        return null;
      }
      lastInputSendTime.current = now;

      if (!isLocalPlayer) return null;

      currentFrame.current++;

      const input: PlayerInput = {
        ...inputData,
        frame: currentFrame.current,
        timestamp: netClock.now,
      };

      // Prediction local - FORCE FIXED TIMESTEP to match Server
      const predictedState = applyInput(renderState.current, input, FRAME_DT);
      renderState.current = predictedState;

      // Guarda no buffer
      const playerState = stateToPlayerState(
        kartId,
        predictedState,
        input.frame,
        netClock.now
      );
      // Only buffer inputs when online — the server will confirm them via GAME_SNAPSHOT.
      // In offline/local mode (no roomCode) there's no server to confirm, so buffering
      // would grow unbounded and trigger false "Rollback muito grande" warnings.
      if (networkManager.roomCode) {
        inputBuffer.current.pending.push({
          input,
          predictedState: playerState,
        });

        // Dynamic Buffer Scaling
        if (inputBuffer.current.pending.length > 1000) {
          if (process.env.NODE_ENV === "development") {
            console.warn(`[net-pred] Buffer large: ${inputBuffer.current.pending.length}`);
          }
          if (inputBuffer.current.pending.length > 2000) {
            inputBuffer.current.pending.shift();
          }
        }

        networkManager.emitPlayerInput(input);
      }

      onStateChangedRef.current?.(playerState);
      return playerState;
    },
    [isLocalPlayer, applyInput, kartId]
  );

  const processSnapshot = useCallback(
    (snapshot: GameSnapshot, lastProcessedFrame: number) => {
      // console.log(
      //   "SNAPSHOT CONFIRM",
      //   "serverFrame:", snapshot.frame,
      //   "lastProcessedFrame:", lastProcessedFrame,
      //   "lastConfirmed:", inputBuffer.current.lastConfirmedFrame,
      //   "pending:", inputBuffer.current.pending.length
      // );
      if (!isLocalPlayer) return;

      const lastConfirmed = inputBuffer.current.lastConfirmedFrame;
      if (lastProcessedFrame <= lastConfirmed) return;

      inputBuffer.current.lastConfirmedFrame = lastProcessedFrame;

      // Remove todos os inputs que o servidor já confirmou ter processado
      if (inputBuffer.current.pending.length > 0) {
        inputBuffer.current.pending = inputBuffer.current.pending.filter(
          (p) => p.input.frame > lastProcessedFrame
        );
      }

      const myState = snapshot.players[kartId];
      if (!myState) return;

      const serverPhysicsState: KartPhysicsState = {
        position: [...myState.position], // Full Server Position
        rotation: myState.rotation,
        speed: myState.speed,
        velocity: [...myState.velocity],
        lapProgress: myState.lapProgress,
        lap: myState.lap,
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

      if (inputBuffer.current.pending.length === 0) {
        // No pending inputs, just smooth towards server state
        const oldRenderState = structuredClone(renderState.current);
        renderState.current = smoothTowards(
          renderState.current,
          serverPhysicsState,
          0.25
        );
        debugLogger.log({
          frame: snapshot.frame,
          type: "server_correction",
          id: kartId,
          delta: Math.sqrt(calculateDistSq(oldRenderState.position, serverPhysicsState.position)),
          meta: { action: "smooth_no_pending", serverPos: physicsStateToLoggable(serverPhysicsState).position, renderPos: physicsStateToLoggable(renderState.current).position }
        });
        serverState.current = serverPhysicsState; // Update serverState reference
        // IMMEDIATE BUFFER CLEANUP (já filtrado acima, mas mantido por segurança)
        inputBuffer.current.pending = inputBuffer.current.pending.filter(
          (p) => p.input.frame > lastProcessedFrame
        );
        onStateChangedRef.current?.(
          stateToPlayerState(
            kartId,
            renderState.current,
            snapshot.frame,
            snapshot.serverTime
          )
        );
        return;
      }

      // Replay remaining inputs on top of server state
      const replayedState = reapplyPendingInputs(serverPhysicsState);

      // 2. Calculate Error: use server vs render as erro principal e log demais distâncias
      const distReplayVsRenderSq = calculateDistSq(
        replayedState.position,
        renderState.current.position
      );
      const distServerVsReplaySq = calculateDistSq(
        serverPhysicsState.position,
        replayedState.position
      );
      const distServerVsRenderSq = calculateDistSq(
        serverPhysicsState.position,
        renderState.current.position
      );

      const distSq = distServerVsRenderSq;

      // 3. Apply Correction based on Error Magnitude
      if (distSq < MICRO_CORRECTION_THRESHOLD_SQ) {
        // A. Micro-error: Ignore it. Trust local prediction to avoid micro-jitters.
        serverState.current = serverPhysicsState;
      } else if (distSq > SNAP_THRESHOLD_SQ) {
        // B. Major error (Teleport/Lag spike): Hard snap towards the corrected replayed state.
        const oldRenderState = structuredClone(renderState.current); // Capture BEFORE snap

        serverState.current = serverPhysicsState;
        renderState.current = smoothTowards(
          renderState.current,
          replayedState,
          0.8
        );
      } else {
        // C. Medium error: Smooth correction
        serverState.current = serverPhysicsState;
        renderState.current = smoothTowards(
          renderState.current,
          replayedState,
          0.3 // Gradual correction
        );
      }

      onStateChangedRef.current?.(
        stateToPlayerState(
          kartId,
          renderState.current,
          snapshot.frame,
          snapshot.serverTime
        )
      );
    },
    [isLocalPlayer, kartId, reapplyPendingInputs]
  );

  const onStateChanged = useCallback((callback: (s: PlayerState) => void) => {
    onStateChangedRef.current = callback;
  }, []);

  const getRenderState = useCallback((): PlayerState | null => {
    if (!isLocalPlayer) return null;
    return stateToPlayerState(
      kartId,
      renderState.current,
      currentFrame.current,
      netClock.now
    );
  }, [isLocalPlayer, kartId]);

  const getPhysicsState = useCallback((): KartPhysicsState | null => {
    if (!isLocalPlayer) return null;
    return renderState.current;
  }, [isLocalPlayer]);

  const resetState = useCallback(
    (position?: [number, number, number]) => {
      if (!isLocalPlayer) return;
      const newState = createPhysicsState(position || initialPosition, initialRotation);
      serverState.current = newState;
      renderState.current = newState;
      inputBuffer.current = {
        pending: [],
        lastConfirmedFrame: 0,
        lastSentFrame: 0,
      };
      currentFrame.current = 0;
      metricsRef.current = {
        lastRollbackLength: 0,
        totalReconciliations: 0,
        consecutiveZeroProgress: 0,
      };
    },
    [isLocalPlayer, initialPosition, initialRotation]
  );

  // Novo: métrica de debug
  const getMetrics = useCallback(() => {
    if (!isLocalPlayer) return null;
    return {
      ...metricsRef.current,
      pendingInputs: inputBuffer.current.pending.length,
      currentFrame: currentFrame.current,
      lastConfirmedFrame: inputBuffer.current.lastConfirmedFrame,
    };
  }, [isLocalPlayer]);

  useEffect(() => {
    if (!isLocalPlayer) return;

    const unsubscribe = networkManager.onMessage((msg) => {
      if (msg.type === "GAME_SNAPSHOT") {

        processSnapshot(msg.snapshot, msg.lastProcessedFrame);
      }
    });
    return unsubscribe;
  }, [isLocalPlayer, processSnapshot]);

  return {
    processInput,
    processSnapshot,
    onStateChanged,
    getRenderState,
    getPhysicsState,
    resetState,
    getMetrics, // novo
    currentFrame,
    pendingInputsCount: () =>
      isLocalPlayer ? inputBuffer.current.pending.length : 0,
  };
}

export default useNetworkPrediction;
