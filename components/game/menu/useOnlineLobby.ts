"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { MAPS, type MapConfig } from "@/lib/game/maps";
import { KART_COLORS } from "@/lib/game/types";
import { CAR_PACKS, DEFAULT_CAR_MODEL } from "@/lib/game/cars";
import { networkManager } from "@/lib/game/networking";
import type { Player } from "@/lib/game/types";
import type { TEXTS } from "@/lib/game/i18n";

interface UseOnlineLobbyOptions {
  t: (typeof TEXTS)["en"];
  playerName: string;
  players: Player[];
  setPlayers: React.Dispatch<React.SetStateAction<Player[]>>;
  selectedMap: MapConfig;
  setSelectedMap: React.Dispatch<React.SetStateAction<MapConfig>>;
  laps: number;
  setLaps: React.Dispatch<React.SetStateAction<number>>;
  setView: React.Dispatch<React.SetStateAction<"mode" | "lobby-setup" | "lobby">>;
  onStartGame: (players: Player[], map: MapConfig, laps: number, localPlayerId?: string, serverRaceStartTime?: number) => void;
}

export function useOnlineLobby(opts: UseOnlineLobbyOptions) {
  const {
    t, playerName, players, setPlayers,
    selectedMap, setSelectedMap, laps, setLaps,
    setView, onStartGame,
  } = opts;

  const [gameMode, setGameMode] = useState<"local" | "online">("local");
  const [onlineRole, setOnlineRole] = useState<"host" | "client" | null>(null);
  const [lobbyCode, setLobbyCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("");

  const isHost = onlineRole === "host" || gameMode === "local";
  const unsubscribersRef = useRef<Array<() => void>>([]);
  // Track last settings received from server to prevent echo loop
  const serverSettingsRef = useRef<{ mapId: string; laps: number } | null>(null);

  // --- Select Mode ---
  const handleSelectMode = useCallback((mode: "local" | "online") => {
    setGameMode(mode);
    if (mode === "online") {
      setView("lobby-setup");
    } else {
      setOnlineRole("host");
      setView("lobby");
    }
  }, [setView]);

  // --- Create Room (Host) ---
  const startOnlineHost = useCallback(async () => {
    setConnectionStatus(t.creatingLobby);
    try {
      await networkManager.initialize();
      const { code, playerId } = await networkManager.createRoom({
        name: playerName,
        color: KART_COLORS[0].color,
        modelUrl: DEFAULT_CAR_MODEL,
        modelPackId: CAR_PACKS[0].id,
        isBot: false,
        isHost: true,
        isReady: true,
      });
      setLobbyCode(code);
      setOnlineRole("host");

      setPlayers(prev => {
        const newPlayers = [...prev];
        if (newPlayers[0]) {
          newPlayers[0] = { ...newPlayers[0], id: playerId, isHost: true };
        }
        return newPlayers;
      });
      setConnectionStatus(t.lobbyCreated);

      // Subscribe to events (unsubscribers stored for cleanup)
      unsubscribersRef.current.push(
        networkManager.onMessage((msg) => {
          if (msg.type === "LOBBY_UPDATE") {
            serverSettingsRef.current = { mapId: msg.settings.mapId, laps: msg.settings.laps };
            setPlayers(msg.players);
            const map = MAPS.find(m => m.id === msg.settings.mapId);
            if (map) setSelectedMap(map);
            setLaps(prev => {
              if (prev !== msg.settings.laps) {
                return msg.settings.laps;
              }
              return prev;
            });
          }
          if (msg.type === "START_GAME") {
            const map = MAPS.find(m => m.id === msg.mapId) || MAPS[0];
            onStartGame(msg.players, map, msg.laps, networkManager.myId, msg.raceStartTime);
          }
        }),
        networkManager.onPlayerDisconnected((peerId) => {
          setPlayers(prev => prev.filter(p => p.id !== peerId));
        }),
      );

      setView("lobby");
    } catch (e) {
      console.error(e);
      setConnectionStatus(t.failedCreateLobby);
    }
  }, [t, playerName, setPlayers, setSelectedMap, setLaps, setView, onStartGame]);

  // --- Join Room (Client) ---
  const joinOnlineLobby = useCallback(async () => {
    if (!inputCode) return;
    setConnectionStatus(t.connectingStatus);
    try {
      await networkManager.initialize();
      setOnlineRole("client");

      const myProfile = players[0];
      const netProfile = { ...myProfile, id: networkManager.myId };

      const connectionPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          unsub(); // Remove listener on timeout
          reject(new Error("Lobby not found or timeout"));
        }, 15000);

        const unsub = networkManager.onMessage((msg) => {
          if (msg.type === "LOBBY_UPDATE") {
            serverSettingsRef.current = { mapId: msg.settings.mapId, laps: msg.settings.laps };
            clearTimeout(timeout);
            setPlayers(msg.players);
            setLobbyCode(inputCode.toUpperCase());
            const map = MAPS.find(m => m.id === msg.settings.mapId);
            if (map) setSelectedMap(map);
            setLaps(prev => {
              if (prev !== msg.settings.laps) {
                return msg.settings.laps;
              }
              return prev;
            });
            setConnectionStatus(t.connected);
            setView("lobby");
            resolve();
          }
          if (msg.type === "START_GAME") {
            const map = MAPS.find(m => m.id === msg.mapId) || MAPS[0];
            onStartGame(msg.players, map, msg.laps, networkManager.myId, msg.raceStartTime);
          }
        });
        unsubscribersRef.current.push(unsub);

        networkManager.connectToHost(inputCode, netProfile);
      });

      await connectionPromise;

      unsubscribersRef.current.push(
        networkManager.onClose(() => {
          setConnectionStatus(t.disconnectedFromHost);
          setView("mode");
        }),
      );
    } catch (e) {
      console.error(e);
      setConnectionStatus(t.lobbyNotFound);
      // Clean up listeners and socket on failure
      unsubscribersRef.current.forEach(u => u());
      unsubscribersRef.current = [];
      networkManager.cleanup();
    }
  }, [inputCode, t, players, setPlayers, setSelectedMap, setLaps, setView, onStartGame]);

  // --- Sync settings to server (host only) ---
  useEffect(() => {
    if (gameMode !== "online" || onlineRole !== "host") return;

    // Skip if settings match what the server already has (prevents echo loop)
    const server = serverSettingsRef.current;
    if (server && server.mapId === selectedMap.id && server.laps === laps) return;

    networkManager.emitSettingsUpdate({ mapId: selectedMap.id, laps });
  }, [selectedMap, laps, gameMode, onlineRole]);

  // --- Sync player details to server ---
  useEffect(() => {
    if (gameMode === "online") {
      const myPlayer = players.find(p => p.id === networkManager.myId);
      if (myPlayer) {
        networkManager.emitPlayerUpdate({
          name: myPlayer.name,
          color: myPlayer.color,
          modelUrl: myPlayer.modelUrl,
          modelPackId: myPlayer.modelPackId,
        });
      }
    }
  }, [players, gameMode]);

  // --- Cleanup helper ---
  const cleanup = useCallback(() => {
    unsubscribersRef.current.forEach(unsub => unsub());
    unsubscribersRef.current = [];
    serverSettingsRef.current = null;
    networkManager.cleanup();
  }, []);

  return {
    gameMode,
    onlineRole,
    isHost,
    lobbyCode,
    inputCode,
    setInputCode,
    connectionStatus,
    handleSelectMode,
    startOnlineHost,
    joinOnlineLobby,
    cleanup,
  };
}
