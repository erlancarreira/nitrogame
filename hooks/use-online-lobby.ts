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
  // Track last players state received from server to avoid echo loops
  const serverPlayersRef = useRef<Player[]>([]);

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
            serverPlayersRef.current = msg.players; // Update reference state
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
        networkManager.onReconnected(() => {
          // Servidor re-enviará game-start se o jogo já começou
          console.log("[lobby] Reconnected to server");
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
            serverPlayersRef.current = msg.players; // Update reference state
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
        networkManager.onReconnected(() => {
          // Servidor re-enviará game-start se o jogo já começou
          console.log("[lobby] Reconnected to server");
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

  // --- 1. Sync LOCAL NAME changes to server (Debounced) ---
  useEffect(() => {
    if (gameMode !== "online" || !networkManager.myId) return;

    const timer = setTimeout(() => {
      const myId = networkManager.myId;
      const myPlayer = players.find(p => p.id === myId);

      // Only emit if we have a player object
      if (myPlayer) {
        // Check if the name actually changed from what the server knows
        // to avoid sending redundant updates
        const serverVersion = serverPlayersRef.current.find(p => p.id === myId);
        if (serverVersion && serverVersion.name === playerName) {
          return;
        }

        networkManager.emitPlayerUpdate({
          ...myPlayer,
          name: playerName, // Use the raw input name
        });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [playerName, gameMode]); // Only depend on playerName (and mode)

  // --- 2. Sync OTHER attributes (color, model) to server ---
  useEffect(() => {
    if (gameMode !== "online" || !networkManager.myId) return;

    const myId = networkManager.myId;
    const myPlayer = players.find(p => p.id === myId);
    if (!myPlayer) return;

    const serverVersion = serverPlayersRef.current.find(p => p.id === myId);

    // If we don't have a server version yet, or if attributes differ, emit update
    // We explicitly exclude 'name' here because that's handled by the effect above
    if (serverVersion) {
      const colorChanged = myPlayer.color !== serverVersion.color;
      const modelChanged = myPlayer.modelUrl !== serverVersion.modelUrl || myPlayer.modelPackId !== serverVersion.modelPackId;

      if (colorChanged || modelChanged) {
        networkManager.emitPlayerUpdate({
          ...myPlayer,
          // We keep the name from the player object (which should be synced via the other effect/local state)
          // or we could enforce using 'playerName' state here too, but 'myPlayer.name' should be up to date
          // locally anyway. BUT, to be safe, let's use the authoritative local name state
          name: playerName
        });
      }
    }

  }, [players, gameMode, playerName]);

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
