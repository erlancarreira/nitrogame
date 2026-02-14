// hooks/useNetworkPrediction.ts

import { useRef, useCallback, useEffect } from "react";
import {
  PlayerInput,
  PlayerState,
  GameSnapshot,
  InputBuffer,
  INPUT_SEND_RATE,
  FRAME_INTERVAL,
  MAX_PENDING_INPUTS,
} from "@/types/network";
import {
  KartPhysicsState,
  PhysicsInput,
  createPhysicsState,
  stateToPlayerState,
  updateKartPhysics,
  normalizeInput,
} from "@/lib/game/kart-physics-core";
import { networkManager } from "@/lib/game/networking";

export function useNetworkPrediction(
  kartId: string,
  initialPosition: [number, number, number],
  isLocalPlayer: boolean = false
) {
  // Estado de física autoritativo do servidor (último snapshot recebido)
  const serverState = useRef<KartPhysicsState>(
    createPhysicsState(initialPosition)
  );

  // Estado de física renderizado (após prediction/reconciliation)
  const renderState = useRef<KartPhysicsState>(
    createPhysicsState(initialPosition)
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

  const toPhysicsInput = useCallback((input: PlayerInput): PhysicsInput => {
    return normalizeInput({
      throttle: input.throttle,
      steer: input.steer,
      brake: input.brake,
      useItem: input.useItem,
    });
  }, []);

  const applyInput = useCallback(
    (state: KartPhysicsState, input: PlayerInput): KartPhysicsState => {
      const physicsInput = toPhysicsInput(input);
      const newState: KartPhysicsState = {
        ...state,
        position: [...state.position],
        velocity: [...state.velocity],
      };
      return updateKartPhysics(newState, physicsInput, FRAME_INTERVAL / 1000);
    },
    [toPhysicsInput]
  );

  const reapplyPendingInputs = useCallback(
    (baseState: KartPhysicsState, lastProcessedFrame: number) => {
      let state: KartPhysicsState = {
        ...baseState,
        position: [...baseState.position],
        velocity: [...baseState.velocity],
      };

      const inputsToReapply = inputBuffer.current.pending.filter(
        (p) => p.input.frame > lastProcessedFrame
      );

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
        } else if (process.env.NODE_ENV === "development") {
          console.debug(`[net-pred] rollback ${rollbackLength} inputs`);
        }
      }

      for (const pending of inputsToReapply) {
        state = applyInput(state, pending.input);
        pending.predictedState = stateToPlayerState(
          kartId,
          state,
          pending.input.frame,
          Date.now()
        );
      }

      inputBuffer.current.pending = inputsToReapply;
      inputBuffer.current.lastConfirmedFrame = lastProcessedFrame;

      return state;
    },
    [applyInput, kartId]
  );

  const processInput = useCallback(
    (inputData: Omit<PlayerInput, "frame" | "timestamp">) => {
      if (!isLocalPlayer) return null;

      currentFrame.current++;

      const input: PlayerInput = {
        ...inputData,
        frame: currentFrame.current,
        timestamp: performance.now(),
      };

      // Prediction local
      const predictedState = applyInput(renderState.current, input);
      renderState.current = predictedState;

      // Guarda no buffer
      const playerState = stateToPlayerState(
        kartId,
        predictedState,
        input.frame,
        Date.now()
      );
      inputBuffer.current.pending.push({
        input,
        predictedState: playerState,
      });

      // Capar buffer quando excede MAX_PENDING_INPUTS
      if (inputBuffer.current.pending.length > MAX_PENDING_INPUTS) {
        const excess =
          inputBuffer.current.pending.length - MAX_PENDING_INPUTS;
        inputBuffer.current.pending.splice(0, excess);

        if (process.env.NODE_ENV === "development") {
          console.warn(
            `[net-pred] Buffer capado: removidos ${excess} inputs antigos`
          );
        }
      }

      // Envio throtllado para o servidor
      const now = performance.now();
      if (now - lastInputSendTime.current >= 1000 / INPUT_SEND_RATE) {
        if (networkManager.roomCode) {
          networkManager.emitPlayerInput(input);
          lastInputSendTime.current = now;
        }
      }

      onStateChangedRef.current?.(playerState);
      return playerState;
    },
    [isLocalPlayer, applyInput, kartId]
  );

  const processSnapshot = useCallback(
    (snapshot: GameSnapshot, lastProcessedFrame: number) => {
      if (!isLocalPlayer) return;

      // Garantir monotonicidade de lastProcessedFrame
      const lastConfirmed = inputBuffer.current.lastConfirmedFrame;
      if (lastProcessedFrame <= lastConfirmed) {
        if (process.env.NODE_ENV === "development") {
          console.debug(
            `[net-pred] Snapshot ignorado: frame ${lastProcessedFrame} <= ${lastConfirmed}`
          );
        }
        return;
      }

      // Detectar servidor parado (possível desync)
      if (lastProcessedFrame === lastConfirmed) {
        metricsRef.current.consecutiveZeroProgress++;
        if (metricsRef.current.consecutiveZeroProgress > 10) {
          if (process.env.NODE_ENV === "development") {
            console.warn(
              "[net-pred] Servidor não progredindo - possível desync"
            );
          }
        }
      } else {
        metricsRef.current.consecutiveZeroProgress = 0;
      }

      const myState = snapshot.players[kartId];
      if (!myState) return;

      const serverPhysicsState: KartPhysicsState = {
        position: [...myState.position],
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
      };

      serverState.current = serverPhysicsState;

      if (inputBuffer.current.pending.length === 0) {
        renderState.current = serverPhysicsState;
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

      const reconciledState = reapplyPendingInputs(
        serverPhysicsState,
        lastProcessedFrame
      );
      renderState.current = reconciledState;

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
      Date.now()
    );
  }, [isLocalPlayer, kartId]);

  const getPhysicsState = useCallback((): KartPhysicsState | null => {
    if (!isLocalPlayer) return null;
    return renderState.current;
  }, [isLocalPlayer]);

  const resetState = useCallback(
    (position?: [number, number, number]) => {
      if (!isLocalPlayer) return;
      const newState = createPhysicsState(position || initialPosition);
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
    [isLocalPlayer, initialPosition]
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
