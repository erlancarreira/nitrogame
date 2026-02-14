import { useRef, useCallback, useEffect } from 'react';
import { 
  PlayerInput, 
  PlayerState, 
  GameSnapshot, 
  PendingInput, 
  InputBuffer,
  createEmptyInput,
  createDefaultState,
  SIMULATION_RATE,
  INPUT_SEND_RATE,
  FRAME_INTERVAL,
  MAX_PENDING_INPUTS
} from '@/types/network';
import {
  KartPhysicsState,
  PhysicsInput,
  createPhysicsState,
  stateToPlayerState,
  updateKartPhysics,
  normalizeInput,
} from '@/lib/game/kart-physics-core';

/**
 * Hook para gerenciar prediction e reconciliation do kart local.
 * 
 * Inspirado em técnicas de Valorant e Rocket League:
 * - Prediction: Aplica input localmente imediatamente para eliminar delay
 * - Reconciliation: Corrige estado quando recebe snapshot do servidor
 * 
 * ATUALIZADO: Agora usa kart-physics-core para física idêntica ao servidor
 * 
 * @param kartId - ID do kart local
 * @param initialPosition - Posição inicial
 * @param socket - Socket.IO socket conectado
 * @param roomCode - Código da sala
 */
export function useNetworkPrediction(
  kartId: string,
  initialPosition: [number, number, number],
  socket: any, // Socket.IO socket
  roomCode: string
) {
  // ============ STATE ============
  
  // Estado de física autoritativo do servidor (último snapshot recebido)
  const serverState = useRef<KartPhysicsState>(createPhysicsState(initialPosition));
  
  // Estado de física renderizado (após prediction/reconciliation)
  const renderState = useRef<KartPhysicsState>(createPhysicsState(initialPosition));
  
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
  
  // Callbacks externos
  const onStateChangedRef = useRef<((state: PlayerState) => void) | null>(null);
  
  // ============ HELPERS ============
  
  /**
   * Converte PlayerInput para PhysicsInput
   */
  const toPhysicsInput = useCallback((input: PlayerInput): PhysicsInput => {
    return normalizeInput({
      throttle: input.throttle,
      steer: input.steer,
      brake: input.brake,
      useItem: input.useItem,
    });
  }, []);
  
  /**
   * Aplica um input ao estado usando a física compartilhada
   */
  const applyInput = useCallback((state: KartPhysicsState, input: PlayerInput): KartPhysicsState => {
    const physicsInput = toPhysicsInput(input);
    // Cria uma cópia para não mutar o estado original diretamente
    const newState: KartPhysicsState = {
      ...state,
      position: [...state.position],
      velocity: [...state.velocity],
    };
    return updateKartPhysics(newState, physicsInput, FRAME_INTERVAL / 1000);
  }, [toPhysicsInput]);
  
  /**
   * Reaplica todos os inputs pendentes após reconciliation
   */
  const reapplyPendingInputs = useCallback((baseState: KartPhysicsState, lastProcessedFrame: number) => {
    let state: KartPhysicsState = { 
      ...baseState,
      position: [...baseState.position],
      velocity: [...baseState.velocity],
    };
    
    // Filtra apenas inputs mais recentes que o último processado
    const inputsToReapply = inputBuffer.current.pending.filter(
      p => p.input.frame > lastProcessedFrame
    );
    
    // Reaplica cada input na sequência
    for (const pending of inputsToReapply) {
      state = applyInput(state, pending.input);
      // Atualiza o estado previsto no pending
      pending.predictedState = stateToPlayerState(
        kartId, 
        state, 
        pending.input.frame, 
        Date.now()
      );
    }
    
    // Atualiza o buffer removendo inputs confirmados
    inputBuffer.current.pending = inputsToReapply;
    inputBuffer.current.lastConfirmedFrame = lastProcessedFrame;
    
    return state;
  }, [applyInput, kartId]);
  
  // ============ PUBLIC API ============
  
  /**
   * Processa um input do jogador (chamado a cada frame)
   */
  const processInput = useCallback((inputData: Omit<PlayerInput, 'frame' | 'timestamp'>) => {
    currentFrame.current++;
    
    const input: PlayerInput = {
      ...inputData,
      frame: currentFrame.current,
      timestamp: performance.now(),
    };
    
    // 1. Aplica input localmente (PREDICTION) usando física compartilhada
    const predictedState = applyInput(renderState.current, input);
    renderState.current = predictedState;
    
    // 2. Guarda no buffer para reconciliation
    const playerState = stateToPlayerState(kartId, predictedState, input.frame, Date.now());
    inputBuffer.current.pending.push({
      input,
      predictedState: playerState,
    });
    
    // 3. Limita tamanho do buffer
    if (inputBuffer.current.pending.length > MAX_PENDING_INPUTS) {
      inputBuffer.current.pending.shift();
    }
    
    // 4. Envia para servidor (throttled)
    const now = performance.now();
    if (now - lastInputSendTime.current >= 1000 / INPUT_SEND_RATE) {
      if (socket?.connected) {
        socket.emit('player-input', { roomCode, input }, { volatile: true });
        lastInputSendTime.current = now;
      }
    }
    
    // 5. Notifica mudança de estado
    onStateChangedRef.current?.(playerState);
    
    return playerState;
  }, [roomCode, socket, applyInput, kartId]);
  
  /**
   * Processa snapshot recebido do servidor (RECONCILIATION)
   */
  const processSnapshot = useCallback((
    snapshot: GameSnapshot,
    lastProcessedFrame: number
  ) => {
    const myState = snapshot.players[kartId];
    if (!myState) return;
    
    // Converte PlayerState para KartPhysicsState
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
    
    // Atualiza estado do servidor
    serverState.current = serverPhysicsState;
    
    // Se não tem inputs pendentes, apenas sincroniza
    if (inputBuffer.current.pending.length === 0) {
      renderState.current = serverPhysicsState;
      onStateChangedRef.current?.(stateToPlayerState(kartId, renderState.current, snapshot.frame, snapshot.serverTime));
      return;
    }
    
    // Reconciliação: começa do estado do servidor e reaplica inputs pendentes
    const reconciledState = reapplyPendingInputs(serverPhysicsState, lastProcessedFrame);
    renderState.current = reconciledState;
    
    // Notifica mudança de estado
    onStateChangedRef.current?.(stateToPlayerState(kartId, renderState.current, snapshot.frame, snapshot.serverTime));
  }, [kartId, reapplyPendingInputs]);
  
  /**
   * Define callback para notificação de mudança de estado
   */
  const onStateChanged = useCallback((callback: (state: PlayerState) => void) => {
    onStateChangedRef.current = callback;
  }, []);
  
  /**
   * Obtém o estado atual para renderização
   */
  const getRenderState = useCallback((): PlayerState => {
    return stateToPlayerState(kartId, renderState.current, currentFrame.current, Date.now());
  }, [kartId]);
  
  /**
   * Obtém o estado de física completo (para uso no KartPro)
   */
  const getPhysicsState = useCallback((): KartPhysicsState => {
    return renderState.current;
  }, []);
  
  /**
   * Reseta o estado (útil para respawn)
   */
  const resetState = useCallback((position?: [number, number, number]) => {
    const newState = createPhysicsState(position || initialPosition);
    serverState.current = newState;
    renderState.current = newState;
    inputBuffer.current = {
      pending: [],
      lastConfirmedFrame: 0,
      lastSentFrame: 0,
    };
    currentFrame.current = 0;
  }, [initialPosition]);
  
  // ============ SOCKET LISTENERS ============
  
  useEffect(() => {
    if (!socket) return;
    
    const handleSnapshot = (data: { snapshot: GameSnapshot; lastProcessedFrame: number }) => {
      processSnapshot(data.snapshot, data.lastProcessedFrame);
    };
    
    socket.on('game-snapshot', handleSnapshot);
    
    return () => {
      socket.off('game-snapshot', handleSnapshot);
    };
  }, [socket, processSnapshot]);
  
  // ============ RETURN ============
  
  return {
    processInput,
    processSnapshot,
    onStateChanged,
    getRenderState,
    getPhysicsState,
    resetState,
    currentFrame,
    pendingInputsCount: () => inputBuffer.current.pending.length,
  };
}

export default useNetworkPrediction;
