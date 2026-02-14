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

/**
 * Hook para gerenciar prediction e reconciliation do kart local.
 * 
 * Inspirado em técnicas de Valorant e Rocket League:
 * - Prediction: Aplica input localmente imediatamente para eliminar delay
 * - Reconciliation: Corrige estado quando recebe snapshot do servidor
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
  
  // Estado autoritativo do servidor (último snapshot recebido)
  const serverState = useRef<PlayerState>(createDefaultState(kartId, initialPosition));
  
  // Estado renderizado (após prediction/reconciliation)
  const renderState = useRef<PlayerState>(createDefaultState(kartId, initialPosition));
  
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
   * Aplica um input ao estado, simulando a física
   * Esta é uma versão simplificada - você deve adaptar para sua física real
   */
  const applyInput = useCallback((state: PlayerState, input: PlayerInput): PlayerState => {
    const newState = { ...state };
    
    // Simulação de física simplificada (adicione sua lógica real aqui)
    const speed = Math.max(0, state.speed + input.throttle * 0.5 - (input.brake ? 0.3 : 0));
    const turnRate = 0.05 * (speed / 0.5); // Menos virada quando parado
    
    // Atualiza rotação
    newState.rotation += input.steer * turnRate;
    
    // Calcula velocidade baseada na direção
    const vx = Math.sin(newState.rotation) * speed;
    const vz = Math.cos(newState.rotation) * speed;
    
    // Atualiza posição
    newState.position = [
      state.position[0] + vx,
      state.position[1],
      state.position[2] + vz,
    ];
    
    newState.velocity = [vx, 0, vz];
    newState.speed = speed;
    newState.frame = input.frame;
    
    return newState;
  }, []);
  
  /**
   * Reaplica todos os inputs pendentes após reconciliation
   */
  const reapplyPendingInputs = useCallback((baseState: PlayerState, lastProcessedFrame: number) => {
    let state = { ...baseState };
    
    // Filtra apenas inputs mais recentes que o último processado
    const inputsToReapply = inputBuffer.current.pending.filter(
      p => p.input.frame > lastProcessedFrame
    );
    
    // Reaplica cada input na sequência
    for (const pending of inputsToReapply) {
      state = applyInput(state, pending.input);
      pending.predictedState = state;
    }
    
    // Atualiza o buffer removendo inputs confirmados
    inputBuffer.current.pending = inputsToReapply;
    inputBuffer.current.lastConfirmedFrame = lastProcessedFrame;
    
    return state;
  }, [applyInput]);
  
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
    
    // 1. Aplica input localmente (PREDICTION)
    const predictedState = applyInput(renderState.current, input);
    renderState.current = predictedState;
    
    // 2. Guarda no buffer para reconciliation
    inputBuffer.current.pending.push({
      input,
      predictedState,
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
    onStateChangedRef.current?.(renderState.current);
    
    return renderState.current;
  }, [roomCode, socket, applyInput]);
  
  /**
   * Processa snapshot recebido do servidor (RECONCILIATION)
   */
  const processSnapshot = useCallback((
    snapshot: GameSnapshot,
    lastProcessedFrame: number
  ) => {
    const myState = snapshot.players[kartId];
    if (!myState) return;
    
    // Atualiza estado do servidor
    serverState.current = myState;
    
    // Se não tem inputs pendentes, apenas sincroniza
    if (inputBuffer.current.pending.length === 0) {
      renderState.current = myState;
      onStateChangedRef.current?.(renderState.current);
      return;
    }
    
    // Reconciliação: começa do estado do servidor e reaplica inputs pendentes
    const reconciledState = reapplyPendingInputs(myState, lastProcessedFrame);
    renderState.current = reconciledState;
    
    // Notifica mudança de estado
    onStateChangedRef.current?.(renderState.current);
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
    return renderState.current;
  }, []);
  
  /**
   * Reseta o estado (útil para respawn)
   */
  const resetState = useCallback((position?: [number, number, number]) => {
    const newState = createDefaultState(kartId, position || initialPosition);
    serverState.current = newState;
    renderState.current = newState;
    inputBuffer.current = {
      pending: [],
      lastConfirmedFrame: 0,
      lastSentFrame: 0,
    };
    currentFrame.current = 0;
  }, [kartId, initialPosition]);
  
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
    resetState,
    currentFrame,
    pendingInputsCount: () => inputBuffer.current.pending.length,
  };
}

export default useNetworkPrediction;
