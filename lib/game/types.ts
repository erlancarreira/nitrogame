import type { MapConfig } from "./maps";

export interface Player {
  id: string;
  name: string;
  color: string;
  modelUrl?: string;
  modelPackId?: string;
  isBot: boolean;
  isHost: boolean;
  isReady: boolean;
}

export interface GameSettings {
  map: MapConfig;
  laps: number;
  maxPlayers: number;
  mode: "local" | "online";
}

export interface RaceState {
  players: PlayerRaceState[];
  gameState: "waiting" | "countdown" | "racing" | "finished";
  countdown: number;
  raceTime: number;
}

export interface PlayerRaceState {
  playerId: string;
  position: number;
  lap: number;
  lapProgress: number;
  speed: number;
  finished: boolean;
  finishTime?: number;
  kartPosition: [number, number, number];
  kartRotation: number;
}

export interface LobbyState {
  id: string;
  host: Player;
  players: Player[];
  settings: GameSettings;
  isStarting: boolean;
}

export interface Controls {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  drift: boolean;
  reset: boolean;
  item: boolean;
  /** Analog steering: -1 (full left) to +1 (full right). 0 = center. */
  steerX?: number;
  /** Analog throttle: -1 (full brake) to +1 (full gas). 0 = idle. */
  throttleY?: number;
}

export type ItemType = "none" | "mushroom" | "banana" | "red_shell" | "star" | "oil";

export const KART_COLORS = [
  { name: "Red Racer", color: "#ff4444" },
  { name: "Blue Bolt", color: "#4488ff" },
  { name: "Green Machine", color: "#44ff44" },
  { name: "Yellow Flash", color: "#ffcc00" },
  { name: "Purple Storm", color: "#aa44ff" },
  { name: "Orange Fire", color: "#ff8844" },
  { name: "Pink Power", color: "#ff66aa" },
  { name: "Cyan Speed", color: "#44ffff" },
];

export const BOT_NAMES = [
  "SpeedBot",
  "RacerAI",
  "TurboBot",
  "DriftMaster",
  "ChampBot",
  "ProRacer",
  "SwiftAI",
  "NitroBot",
];
