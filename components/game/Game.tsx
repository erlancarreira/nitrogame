"use client";

import {
  Suspense,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { GameScene } from "./GameScene";
import { GameHUD } from "./GameHUD";
import { MainMenu } from "./MainMenu";
import { MAPS, type MapConfig } from "@/lib/game/maps";
import { generateTrackPoints } from "@/lib/game/track-path";
import type { Player, Controls } from "@/lib/game/types";
import { useKeyboardControls } from "@/hooks/use-keyboard-controls";
import { useTouchControls, useIsTouchDevice } from "@/hooks/use-touch-controls";
import { MobileControls } from "./MobileControls";
import { GameErrorBoundary } from "./GameErrorBoundary";
import { useRaceState } from "@/hooks/use-race-state";
import { useRaceTimer } from "@/hooks/use-race-timer";
import { useCountdown } from "@/hooks/use-countdown";
import { networkManager } from "@/lib/game/networking";
import { soundManager } from "@/lib/game/sound-manager";
import { interpolator } from "@/lib/game/interpolator";


// ── Types ───────────────────────────────────────────────────────────

type GameScreen = "menu" | "racing";
type GameState = "waiting" | "countdown" | "racing" | "paused" | "finished";

// ── Helpers ──────────────────────────────────────────────────────────

function getStartRotation(map: MapConfig): number {
  // 1. Prefer explicit configuration from map data (Professional approach)
  if (map.startRotation !== undefined) {
    return map.startRotation;
  }

  // 2. Use explicit path points if available
  if (map.pathPoints && map.pathPoints.length > 1) {
    const [x1, z1] = map.pathPoints[0];
    const [x2, z2] = map.pathPoints[1];
    return Math.atan2(x2 - x1, z2 - z1);
  }

  // Otherwise generate procedural points to find the start tangent
  const points = generateTrackPoints(map, 10);
  if (points && points.length > 1) {
    // For oval tracks (Green Valley), points are generated CCW starting from "back".
    // But the start line is on a straight section. We should check the direction *at the start position*.
    // However, a simple robust fix for the main straight (where start always is)
    // is to look at the track geometry. For Green Valley, straight supports Z-axis driving.
    // Fallback procedural: compute angle from first two track points
    // Note: maps com startRotation explícito (ex: green-valley) nunca chegam aqui
    if (map.id === "green-valley") {
      return 0; // Unreachable (startRotation definido em maps.ts), mantido por segurança
    }

    const [x1, z1] = points[0];
    const [x2, z2] = points[1];
    return Math.atan2(x2 - x1, z2 - z1);
  }

  return 0;
}
// ── Main Game Component ─────────────────────────────────────────────

export function Game() {
  // ── Core state ──
  const [screen, setScreen] = useState<GameScreen>("menu");
  const [gameState, setGameState] = useState<GameState>("waiting");
  const [players, setPlayers] = useState<Player[]>([]);
  const [localPlayerId, setLocalPlayerId] = useState<string>("");
  const [selectedMap, setSelectedMap] = useState<MapConfig>(MAPS[0]);
  const [totalLaps, setTotalLaps] = useState(3);
  const [countdown, setCountdown] = useState(3);
  const [matchId, setMatchId] = useState(0);
  const [isSceneReady, setIsSceneReady] = useState(false);
  const pauseStartRef = useRef<number | null>(null);
  const serverRaceStartTimeRef = useRef<number | undefined>(undefined);
  const [lastRaceConfig, setLastRaceConfig] = useState<{ players: Player[]; map: MapConfig; laps: number } | null>(null);

  // ── Controls ──
  const [controls, setControls] = useState<Controls>({
    forward: false, backward: false, left: false, right: false,
    drift: false, reset: false, item: false,
  });
  const [playerItem, setPlayerItem] = useState<"none" | "mushroom" | "banana" | "red_shell" | "star" | "oil">("none");
  const handleItemChange = useCallback((item: "none" | "mushroom" | "banana" | "red_shell" | "star" | "oil") => {
    setPlayerItem(item);
  }, []);

  // ── Camera refs (per-frame, no re-renders) ──
  const playerEffectsRef = useRef({
    isDrifting: false, isBoosting: false, boostStrength: 1, driftTier: 0,
  });
  const playerTransformRef = useRef({
    position: [0, 1, 0] as [number, number, number],
    rotation: 0,
  });

  // ── Ping (online only) ──
  const [ping, setPing] = useState(-1);

  useEffect(() => {
    if (screen !== "racing") return;
    // Only measure if connected to a server
    if (!networkManager.myId) return;
    networkManager.startPingLoop(3000);
    const interval = setInterval(() => setPing(networkManager.ping), 1000);
    return () => {
      networkManager.stopPingLoop();
      clearInterval(interval);
    };
  }, [screen]);

  // ── Race Timer hook (RAF loop + FPS counter) ──
  const {
    timeRef, startTimeRef, gameStateRef, raceTimeRef, playerSpeedRef,
    updateRaceTime, stopTimer,
    raceTime, setRaceTime, playerSpeed, fps, frameMs,
  } = useRaceTimer();

  // Sync gameState → gameStateRef
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState, gameStateRef]);

  // ── Race State hook (checkpoints, positions, anti-cheat) ──
  const {
    racerStatesRef, handlePositionUpdate, handleRemoteFinish, playerRacer, racerPositions,
  } = useRaceState({
    players, screen, selectedMap, localPlayerId, totalLaps,
    gameStateRef, raceTimeRef,
  });

  // ── Countdown hook (server-synced + local fallback) ──
  const { start: startCountdown, cleanup: cleanupCountdown } = useCountdown({
    setCountdown, setGameState, gameStateRef, startTimeRef, timeRef, updateRaceTime,
  });

  // Cleanup countdown + network on unmount
  useEffect(() => {
    return () => {
      cleanupCountdown();
      if (networkManager.roomCode) {
        networkManager.cleanup();
      }
    };
  }, [cleanupCountdown]);

  // ── Lap completion sound ──
  const prevLapRef = useRef(1);

  useEffect(() => {
    if (!playerRacer || gameState !== "racing") return;

    // Detecta quando volta aumenta (mas não é a última volta)
    if (playerRacer.lap > prevLapRef.current && playerRacer.lap <= totalLaps) {
      soundManager.play('lap_complete', 0.6);
    }

    prevLapRef.current = playerRacer.lap;
  }, [playerRacer?.lap, totalLaps, gameState]);

  // ── Check for race completion ──
  useEffect(() => {
    if (playerRacer?.finished && gameState === "racing") {
      stopTimer();
      soundManager.setDrifting(false);
      gameStateRef.current = "finished";
      setGameState("finished");

      // Play victory or finish sound based on position
      const position = playerRacer.position || 1;
      if (position === 1) {
        soundManager.play('victory', 0.7);
      } else {
        soundManager.play('race_finish', 0.6);
      }

      // Broadcast finish to other players in online mode
      if (localPlayerId && networkManager.roomCode) {
        networkManager.broadcast({
          type: "PLAYER_FINISHED",
          id: localPlayerId,
          finishTime: playerRacer.finishTime ?? raceTime,
          lap: playerRacer.lap,
        });
      }
    }
  }, [playerRacer?.finished, gameState, stopTimer, gameStateRef, localPlayerId, raceTime, playerRacer?.finishTime, playerRacer?.lap, playerRacer?.position]);

  // ── Start Game ──
  const handleStartGame = useCallback(
    (gamePlayers: Player[], initialMap: MapConfig, laps: number, myId?: string, serverRaceStartTime?: number) => {
      // Clean previous timers
      cleanupCountdown();
      stopTimer();


      // Re-fetch map from source to ensure full data integrity
      const currentMap = MAPS.find(m => m.id === initialMap.id) || initialMap;

      const map = currentMap;

      if (!map.startPositions || map.startPositions.length === 0) {
        console.error("Mapa sem posições de início definidas:", map.id);
        return;
      }

      setPlayers(gamePlayers);
      setLocalPlayerId(myId || "");
      setSelectedMap(map);
      setTotalLaps(laps);
      setScreen("racing");
      setGameState("waiting"); // Start in waiting, countdown starts when scene is ready
      setRaceTime(0);
      setMatchId(prev => prev + 1);
      setIsSceneReady(false);
      setLastRaceConfig({ players: gamePlayers, map, laps });

      // Reset camera to player start position
      const myStartIdx = gamePlayers.findIndex(p => p.id === (myId || gamePlayers[0]?.id));
      const useIdx = myStartIdx >= 0 ? myStartIdx : 0;
      const startPos = map.startPositions[useIdx] || map.startPositions[0];
      playerTransformRef.current = {
        position: (startPos || [0, 1, 0]) as [number, number, number],
        rotation: getStartRotation(map),
      };

      // Store server timestamp for countdown sync (used when scene becomes ready)
      serverRaceStartTimeRef.current = serverRaceStartTime;
    },
    [cleanupCountdown, stopTimer, setRaceTime]
  );

  const handleSceneReady = useCallback(() => {
    setIsSceneReady(true);
  }, []);

  const handleRematch = useCallback(() => {
    if (!lastRaceConfig) return;
    const { players: racePlayers, map: raceMap, laps } = lastRaceConfig;

    // Online host restarts via server
    if (networkManager.roomCode && networkManager.isHost) {
      networkManager.emitStartGame({
        mapId: raceMap.id,
        laps,
        players: racePlayers,
      });
      return;
    }

    // Non-host in online should wait for host
    if (networkManager.roomCode && !networkManager.isHost) return;

    // Offline/local rematch
    handleStartGame(racePlayers, raceMap, laps, localPlayerId || racePlayers[0]?.id);
  }, [handleStartGame, lastRaceConfig, localPlayerId]);

  // Trigger countdown when scene is ready (pass server timestamp for synced countdown)
  useEffect(() => {
    if (screen === "racing" && gameState === "waiting" && isSceneReady) {
      setGameState("countdown");
      startCountdown(serverRaceStartTimeRef.current);
    }
  }, [screen, gameState, isSceneReady, startCountdown]);

  // ── Navigation ──
  const handleBackToMenu = useCallback(() => {
    stopTimer();
    soundManager.setDrifting(false);
    soundManager.stopEngine();
    soundManager.stopAllSpatialEngines();
    // Cleanup network connections to prevent leaked sockets/DataChannels
    if (networkManager.roomCode) {
      networkManager.cleanup();
    }
    // [Fix 12.3] Clear interpolator buffers — singleton persists between sessions,
    // stale snapshots from previous players/rooms would contaminate next race
    interpolator.reset();
    gameStateRef.current = "waiting";
    setScreen("menu");
    setGameState("waiting");
    setPlayers([]);
    setRaceTime(0);
  }, [stopTimer, gameStateRef, setRaceTime]);

  const handleBackToLobby = useCallback(() => {
    stopTimer();
    soundManager.setDrifting(false);
    soundManager.stopEngine();
    soundManager.stopAllSpatialEngines();
    gameStateRef.current = "waiting";
    setScreen("menu");
    setGameState("waiting");
  }, [stopTimer, gameStateRef]);

  // ── Per-frame callbacks (stable refs, no re-renders) ──
  const handleKartTransformChange = useCallback(
    (position: [number, number, number], rotation: number) => {
      playerTransformRef.current.position = position;
      playerTransformRef.current.rotation = rotation;
    },
    []
  );

  const handleSpeedChange = useCallback((speed: number) => {
    playerSpeedRef.current = speed;
  }, [playerSpeedRef]);

  const handleEffectsUpdate = useCallback(
    (effects: { isDrifting: boolean; isBoosting: boolean; boostStrength: number; driftTier: number }) => {
      playerEffectsRef.current = effects;
    },
    []
  );

  // ── Pause / Resume ──
  const handleTogglePause = useCallback(() => {
    if (screen !== "racing") return;
    if (gameState === "racing") {
      pauseStartRef.current = performance.now();
      gameStateRef.current = "paused";
      setGameState("paused");
      stopTimer();
      soundManager.setDrifting(false);
    } else if (gameState === "paused") {
      const now = performance.now();
      if (pauseStartRef.current) {
        startTimeRef.current += now - pauseStartRef.current;
      }
      pauseStartRef.current = null;
      gameStateRef.current = "racing";
      setGameState("racing");
      timeRef.current = requestAnimationFrame(updateRaceTime);
    }
  }, [gameState, screen, stopTimer, startTimeRef, timeRef, updateRaceTime, gameStateRef]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleTogglePause();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleTogglePause]);

  // ── Input handling ──
  const isTouch = useIsTouchDevice();

  const { controls: keyboardControls, resetControls } = useKeyboardControls({
    state: gameState === "racing" ? "racing" : gameState === "finished" ? "finished" : "disabled",
    onFinishReset: handleBackToLobby,
  });

  const {
    controls: touchControls,
    update: updateTouchControls,
    resetControls: resetTouchControls,
    controlsRef: touchControlsRef,
  } = useTouchControls();

  // Merge keyboard + touch
  useEffect(() => {
    const source = isTouch ? touchControls : keyboardControls;
    setControls(prev => {
      const keys = Object.keys(source) as (keyof Controls)[];
      if (keys.every(k => prev[k] === source[k])) return prev;
      return source;
    });
  }, [keyboardControls, touchControls, isTouch]);

  useEffect(() => {
    if (gameState !== "racing") {
      resetControls();
      resetTouchControls();
    }
  }, [gameState, resetControls, resetTouchControls]);

  // ── Render ──

  // ── Render ──
  // We now render both scenes to support seamless transition.
  // MainMenu is shown if screen="menu" OR (screen="racing" && !isSceneReady)
  const showMenu = screen === "menu" || (screen === "racing" && !isSceneReady);
  const showGame = screen === "racing"; // Always render game when racing, but it might be hidden behind menu loading

  const botDifficulty =
    selectedMap.difficulty === "easy" ? "easy"
      : selectedMap.difficulty === "medium" ? "medium"
        : "hard";
  const startRotation = getStartRotation(selectedMap);
  const rematchEnabled = !networkManager.roomCode || networkManager.isHost;

  return (
    <div className="w-full h-screen relative">
      <GameErrorBoundary onReset={handleBackToMenu}>

        {/* Game Layer (Bottom) */}
        {showGame && (
          <Suspense fallback={null}>
            <GameScene
              key={`${selectedMap.id}-${matchId}`}
              selectedMap={selectedMap}
              players={players}
              localPlayerId={localPlayerId}
              controls={controls}
              touchControlsRef={isTouch ? touchControlsRef : undefined}
              gameState={gameState}
              botDifficulty={botDifficulty}
              startRotation={startRotation}
              handleSpeedChange={handleSpeedChange}
              handleEffectsUpdate={handleEffectsUpdate}
              handlePositionUpdate={handlePositionUpdate}
              handleKartTransformChange={handleKartTransformChange}
              playerTransformRef={playerTransformRef}
              playerSpeedRef={playerSpeedRef}
              playerEffectsRef={playerEffectsRef}
              onItemChange={handleItemChange}
              racerStatesRef={racerStatesRef}
              onSceneReady={handleSceneReady}
              onRemoteFinish={handleRemoteFinish}
            />
          </Suspense>
        )}

        {/* HUD Layer (Above Game) */}
        {showGame && isSceneReady && (
          <>
            <GameHUD
              speed={playerSpeed}
              lap={playerRacer?.lap || 1}
              totalLaps={totalLaps}
              position={playerRacer?.position || 1}
              totalRacers={players.length}
              time={raceTime}
              fps={fps}
              frameMs={frameMs}
              ping={ping}
              debug={process.env.NODE_ENV === "development"}
              gameState={gameState}
              countdown={countdown}
              players={players}
              racerPositions={racerPositions}
              map={selectedMap}
              onBackToLobby={handleBackToLobby}
              onBackToMenu={handleBackToMenu}
              onResume={handleTogglePause}
              onRematch={handleRematch}
              rematchEnabled={rematchEnabled}
              item={playerItem}
              isTouch={isTouch}
            />
            {isTouch && gameState === "racing" && (
              <MobileControls
                onUpdate={updateTouchControls}
                item={playerItem}
              />
            )}
          </>
        )}

        {/* Menu Layer (Top / Loading) */}
        {showMenu && (
          <div className="absolute inset-0 z-200">
            <MainMenu
              onStartGame={handleStartGame}
              isLoading={screen === "racing" && !isSceneReady}
            />
          </div>
        )}
      </GameErrorBoundary>
    </div>
  );
}
