/**
 * Network Types - Prediction & Reconciliation System
 * 
 * Este arquivo define os tipos para o sistema de network otimizado
 * inspirado em técnicas de AAA games (Valorant, Rocket League, etc.)
 */

// =========== INPUT TYPES ===========

/**
 * Input enviado pelo cliente para o servidor
 * Inclui o número do frame para reconciliação
 */
export interface PlayerInput {
  /** Número do frame (60fps = 1 frame ~16.6ms) */
  frame: number;
  
  /** Acelerador (0-1) */
  throttle: number;
  
  /** Direção (-1 esquerda, 0 reto, 1 direita) */
  steer: number;
  
  /** Freio/drift */
  brake: boolean;
  
  /** Usar item */
  useItem: boolean;
  
  /** Timestamp local quando o input foi gerado */
  timestamp: number;
}

/**
 * Estado completo do kart para snapshots do servidor
 */
export interface PlayerState {
  /** ID do jogador */
  id: string;
  
  /** Posição [x, y, z] */
  position: [number, number, number];
  
  /** Rotação (em radianos, eixo Y) */
  rotation: number;
  
  /** Velocidade atual */
  speed: number;
  
  /** Velocidade vetorial [x, y, z] */
  velocity: [number, number, number];
  
  /** Progresso na volta (0-1) */
  lapProgress: number;
  
  /** Volta atual */
  lap: number;
  
  /** Frame correspondente a este estado */
  frame: number;
  
  /** Timestamp do servidor */
  serverTime: number;
}

/**
 * Snapshot do jogo enviado pelo servidor para todos os clientes
 * Contém o estado de todos os karts
 */
export interface GameSnapshot {
  /** Número do frame */
  frame: number;
  
  /** Timestamp do servidor */
  serverTime: number;
  
  /** Estados de todos os jogadores */
  players: Record<string, PlayerState>;
}

// =========== NETWORK EVENT TYPES ===========

/**
 * Evento de input enviado pelo cliente
 */
export interface InputEvent {
  /** Código da sala */
  roomCode: string;
  
  /** Input do jogador */
  input: PlayerInput;
}

/**
 * Evento de snapshot recebido do servidor
 */
export interface SnapshotEvent {
  /** Snapshot do estado do jogo */
  snapshot: GameSnapshot;
  
  /** Último frame processado do jogador local (para reconciliation) */
  lastProcessedFrame: number;
}

// =========== PREDICTION BUFFER TYPES ===========

/**
 * Input pendente aguardando confirmação do servidor
 */
export interface PendingInput {
  input: PlayerInput;
  
  /** Estado previsto após aplicar este input */
  predictedState: PlayerState;
}

/**
 * Buffer de inputs para reconciliation
 */
export interface InputBuffer {
  /** Inputs enviados mas não confirmados */
  pending: PendingInput[];
  
  /** Último frame confirmado pelo servidor */
  lastConfirmedFrame: number;
  
  /** Último frame enviado */
  lastSentFrame: number;
}

// =========== RENDER TYPES ===========

/**
 * Estado interpolado para renderização de karts remotos
 */
export interface InterpolatedState {
  position: [number, number, number];
  rotation: number;
  speed: number;
  lapProgress: number;
}

// =========== CONSTANTS ===========

/** Taxa de atualização da simulação (Hz) */
export const SIMULATION_RATE = 60;

/** Intervalo entre frames em ms */
export const FRAME_INTERVAL = 1000 / SIMULATION_RATE;

/** Delay de interpolação em segundos (igual ao do RemoteKart) */
export const INTERPOLATION_DELAY = 0.1;

/** Máximo de inputs pendentes no buffer */
export const MAX_PENDING_INPUTS = 120; // ~2 segundos

/** Taxa de envio de inputs para o servidor (Hz) */
export const INPUT_SEND_RATE = 30;

/** Taxa de broadcast de snapshots do servidor (Hz) */
export const SNAPSHOT_RATE = 20;

// =========== UTILITY FUNCTIONS ===========

/**
 * Lerp entre dois ângulos (radianos) pelo caminho mais curto
 */
export function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}

/**
 * Interpola entre dois estados
 */
export function interpolateState(
  from: PlayerState,
  to: PlayerState,
  alpha: number
): InterpolatedState {
  return {
    position: [
      from.position[0] + (to.position[0] - from.position[0]) * alpha,
      from.position[1] + (to.position[1] - from.position[1]) * alpha,
      from.position[2] + (to.position[2] - from.position[2]) * alpha,
    ],
    rotation: lerpAngle(from.rotation, to.rotation, alpha),
    speed: from.speed + (to.speed - from.speed) * alpha,
    lapProgress: from.lapProgress + (to.lapProgress - from.lapProgress) * alpha,
  };
}

/**
 * Cria um estado padrão para um kart
 */
export function createDefaultState(id: string, position: [number, number, number] = [0, 0, 0]): PlayerState {
  return {
    id,
    position: [...position],
    rotation: 0,
    speed: 0,
    velocity: [0, 0, 0],
    lapProgress: 0,
    lap: 1,
    frame: 0,
    serverTime: 0,
  };
}

/**
 * Cria um input vazio
 */
export function createEmptyInput(frame: number): PlayerInput {
  return {
    frame,
    throttle: 0,
    steer: 0,
    brake: false,
    useItem: false,
    timestamp: performance.now(),
  };
}
