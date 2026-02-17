"use client";

import React, { useEffect, useCallback } from "react";
import { Canvas, useThree, useFrame as useR3FFrame } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";

import type { MapConfig } from "@/lib/game/maps";
import type { Player, Controls } from "@/lib/game/types";
import { SNAPSHOT_RATE } from "@/types/network";
import { Track } from "./track/Track";
import { StartGrid } from "./StartGrid";
import { KartPro as Kart, type KartRef } from "./KartPro";
import { BotKart } from "./BotKart";
import { ItemBox } from "./ItemBox";
import { FollowCamera } from "./FollowCamera";
import { RemoteKart } from "./RemoteKart";
import { networkManager } from "@/lib/game/networking";
import { generateItemBoxPositions } from "@/lib/game/track-utils";
import { BananaPool } from "./InstancedBananas";
import { OilPool } from "./InstancedOil";
import { getModelScale, DEFAULT_CAR_MODEL } from "@/lib/game/cars";
import { SkidMarks, getRearWheelPositions } from "./KartEffects";
import { useItemSystem } from "@/hooks/use-item-system";
import { SoundEffects } from "./SoundEffects";
import { EngineSound } from "./EngineSound";
import { DriftSound } from "./DriftSound";
import { SpatialEngineSound } from "./SpatialEngineSound";
import { RedShell } from "./RedShell";
import type { RacerState } from "@/hooks/use-race-state";
import { interpolator } from "@/lib/game/interpolator";

import { netClock } from "@/lib/netcode/netclock";

export type GameSceneProps = {
  selectedMap: MapConfig;
  players: Player[];
  controls: Controls;
  gameState: "waiting" | "countdown" | "racing" | "paused" | "finished";
  botDifficulty: "easy" | "medium" | "hard";
  startRotation: number;
  handleSpeedChange: (speed: number) => void;
  handleEffectsUpdate: (effects: {
    isDrifting: boolean;
    isBoosting: boolean;
    boostStrength: number;
    driftTier: number;
  }) => void;
  handlePositionUpdate: (
    id: string,
    position: [number, number, number],
    rotation: number,
    speed: number,
    lapProgress: number
  ) => void;
  handleKartTransformChange: (
    position: [number, number, number],
    rotation: number
  ) => void;
  playerTransformRef: React.MutableRefObject<{
    position: [number, number, number];
    rotation: number;
  }>;
  playerSpeedRef: React.MutableRefObject<number>;
  playerEffectsRef: React.MutableRefObject<{
    isDrifting: boolean;
    isBoosting: boolean;
    boostStrength: number;
  }>;
  onItemChange?: (item: "none" | "mushroom" | "banana" | "red_shell" | "star" | "oil") => void;
  localPlayerId?: string;
  racerStatesRef?: React.MutableRefObject<Map<string, RacerState>>;
  touchControlsRef?: React.MutableRefObject<Controls>;
  onSceneReady?: () => void;
  onRemoteFinish?: (id: string, finishTime: number) => void;
};


// Debug Draw Call Logger — only active in development
const IS_DEV = process.env.NODE_ENV === "development";

function DrawCallLogger() {
  const gl = useThree((s) => s.gl);
  const lastLog = React.useRef(0);
  useR3FFrame(() => {
    if (!IS_DEV) return;
    const now = performance.now();
    if (now - lastLog.current > 3000) {
      lastLog.current = now;
      // const { render, memory } = gl.info;
      // console.log(
      //   `[Render] drawCalls=${render.calls} triangles=${render.triangles} ` +
      //   `textures=${memory.textures} geometries=${memory.geometries}`
      // );
    }
  });
  return null;
}

// Start: SceneReadyTrigger Component
function SceneReadyTrigger({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}
// End: SceneReadyTrigger Component

export const GameScene = React.memo(function GameScene({
  selectedMap,
  players,
  controls,
  gameState,
  botDifficulty,
  startRotation,
  handleSpeedChange,
  handleEffectsUpdate,
  handlePositionUpdate,
  handleKartTransformChange,
  playerTransformRef,
  playerSpeedRef,
  playerEffectsRef,
  onItemChange,
  localPlayerId,
  racerStatesRef,
  touchControlsRef,
  onSceneReady,
  onRemoteFinish,
}: GameSceneProps) {
  const humanPlayer = localPlayerId
    ? players.find((p) => p.id === localPlayerId)
    : players.find((p) => !p.isBot);

  // Filter out the human player from the "others" list
  // SAFEGUARD: Ensure we don't include the human player as an "other" player
  const otherPlayers = players.filter((p) => p.id !== humanPlayer?.id);

  // Determine Host Authority (Crucial for Local Mode)
  // If we have a roomCode, we are online -> use networkManager.isHost.
  // If NO roomCode, we are offline/local -> we are ALWAYS Host.
  const isHost = networkManager.roomCode ? networkManager.isHost : true;

  const botPlayersHost = otherPlayers.filter((p) => p.isBot && isHost);
  const botPlayersRemote = otherPlayers.filter((p) => p.isBot && !isHost);
  const remoteHumans = otherPlayers.filter((p) => !p.isBot);

  // Stable ref for bot IDs — avoids useEffect dep churn from .filter() creating new arrays
  const botPlayerHostIdsRef = React.useRef<Set<string>>(new Set());
  React.useMemo(() => {
    botPlayerHostIdsRef.current = new Set(botPlayersHost.map(b => b.id));
  }, [players, isHost]);

  // Rate limiting for snapshots
  const lastBroadcastTimeRef = React.useRef<Map<string, number>>(new Map());
  const SNAPSHOT_INTERVAL_MS = 1000 / SNAPSHOT_RATE;

  const kartRef = React.useRef<KartRef>(null);
  const botRefs = React.useRef<Record<string, KartRef>>({});
  const botEffectsRefs = React.useRef<Record<string, React.RefObject<{ isDrifting: boolean; isBoosting: boolean }>>>({});

  // Derived ref for DriftSound — points to playerEffectsRef.current.isDrifting
  const isDriftingRef = React.useRef(false);

  // Helper: cached kart refs array for ItemBox (updated when players change)
  const allKartRefsCache = React.useRef<Array<{ id: string; ref: React.RefObject<KartRef> }>>([]);

  // Local state for scene readiness (loading overlay)
  const [isSceneReady, setIsSceneReady] = React.useState(false);

  const handleSceneReady = useCallback(() => {
    // Small delay to ensure frames are painted
    setTimeout(() => {
      setIsSceneReady(true);
      if (onSceneReady) onSceneReady();
    }, 100);
  }, [onSceneReady]);

  React.useEffect(() => {
    const karts: Array<{ id: string; ref: React.RefObject<KartRef> }> = [];
    if (humanPlayer) {
      karts.push({ id: humanPlayer.id, ref: kartRef as React.RefObject<KartRef> });
    }
    botPlayersHost.forEach((b) => {
      karts.push({ id: b.id, ref: { current: botRefs.current[b.id] ?? null } as React.RefObject<KartRef> });
    });
    allKartRefsCache.current = karts;
  }, [humanPlayer, botPlayersHost]);

  const getAllKartRefs = useCallback(() => allKartRefsCache.current, []);

  // Stable callbacks for Kart (avoid inline arrow re-creation each render)
  const onSpeedUpdate = useCallback((speed: number) => {
    playerSpeedRef.current = speed;
  }, [playerSpeedRef]);

  const handleLocalPositionUpdate = useCallback(
    (id: string, pos: [number, number, number], rot: number, speed: number, progress: number) => {
      // Local update
      handlePositionUpdate(id, pos, rot, speed, progress);

      const now = performance.now();
      const last = lastBroadcastTimeRef.current.get(id) || 0;

      if (now - last >= SNAPSHOT_INTERVAL_MS) {
        lastBroadcastTimeRef.current.set(id, now);

        const seq = localSeqRef.current++;
        if (localSeqRef.current > 65535) localSeqRef.current = 0; // Uint16 wrap

        // Read real Rapier velocity for accurate extrapolation on remote side
        const vel = kartRef.current?.getLinvel?.();

        // Network broadcast (POS)
        networkManager.broadcast({
          type: "POS",
          id,
          p: pos,
          r: rot,
          s: speed,
          l: progress,
          t: netClock.now, // Server Time
          seq: seq,
          vx: vel?.x ?? 0,
          vz: vel?.z ?? 0,
        });
      }
    },
    [handlePositionUpdate]
  );

  // Host-only: broadcast bot positions to remote players
  const handleBotPositionUpdate = useCallback(
    (id: string, pos: [number, number, number], rot: number, speed: number, progress: number) => {
      // Local update
      handlePositionUpdate(id, pos, rot, speed, progress);

      const now = performance.now();
      const last = lastBroadcastTimeRef.current.get(id) || 0;

      if (now - last >= SNAPSHOT_INTERVAL_MS) {
        lastBroadcastTimeRef.current.set(id, now);

        // Bots: derive velocity from speed + rotation (no drift slide)
        const vx = Math.sin(rot) * speed;
        const vz = Math.cos(rot) * speed;

        // Network broadcast (POS)
        networkManager.broadcast({
          type: "POS",
          id,
          p: pos,
          r: rot,
          s: speed,
          l: progress,
          t: netClock.now, // Server Time
          vx,
          vz,
        });
      }
    },
    [handlePositionUpdate]
  );

  const handleEffectsUpdateLocal = useCallback(
    (effects: { isDrifting: boolean; isBoosting: boolean; boostStrength: number; driftTier: number }) => {
      isDriftingRef.current = effects.isDrifting;
      handleEffectsUpdate(effects);
    },
    [handleEffectsUpdate]
  );

  const handleBotEffectsUpdate = useCallback(
    (botId: string, effects: { isDrifting: boolean; isBoosting: boolean }) => {
      if (!botEffectsRefs.current[botId]) {
        botEffectsRefs.current[botId] = { current: { isDrifting: false, isBoosting: false } };
      }
      botEffectsRefs.current[botId].current = effects;
    },
    []
  );

  // ── Item System (hook) ──
  const {
    currentItem,
    redShells,
    bananaPoolRef,
    oilPoolRef,
    sfxRef,
    handleItemCollect,
    handleBananaCollide,
    handleOilCollide,
    handleShellCollide,
    handleNetworkItemHit,
    useHumanItem,
    getWorldSnapshot,
    restoreWorldSnapshot,
  } = useItemSystem({
    kartRef,
    botRefs,
    humanPlayerId: humanPlayer?.id,
    racerStatesRef,
    playersCount: players.length,
    onItemChange,
    getAllKartRefs,
  });

  // ── Item usage effect ──
  useEffect(() => {
    useHumanItem(controls);
  }, [controls.item, currentItem, useHumanItem, controls]);

  // ── Item Box Positions ──
  const itemBoxPositions = React.useMemo(() => {
    if (selectedMap.itemBoxPositions && selectedMap.itemBoxPositions.length > 0) {
      return selectedMap.itemBoxPositions;
    }
    return generateItemBoxPositions(selectedMap).map((v) => [v.x, v.y, v.z] as [number, number, number]);
  }, [selectedMap]);

  // ── Network Logic ──
  const localSeqRef = React.useRef(0);

  // Listen for network updates (GAME_SNAPSHOT + fallback POS + ITEM_HIT + PLAYER_FINISHED)
  React.useEffect(() => {
    const unsub = networkManager.onMessage((msg) => {
      const now = performance.now();

      // Helper to check if we own this entity (Local Player or Host Bot)
      // Uses stable ref instead of botPlayersHost array to avoid useEffect dep churn
      const isLocalEntity = (id: string) => {
        if (id === localPlayerId) return true;
        return botPlayerHostIdsRef.current.has(id);
      };

      // GAME_SNAPSHOT is handled by useNetworkPrediction for LOCAL player reconciliation.
      // Do NOT feed it into the interpolator for remote players — the server simulation
      // lacks Rapier collision data, so its positions diverge from the real POS messages,
      // causing the interpolator to oscillate between two conflicting sources (teleportation).
      if (msg.type === "GAME_SNAPSHOT") {
        return;
      }

      if (msg.type === "POS") {
        if (isLocalEntity(msg.id)) return;

        // Feed interpolator — dedup is handled by SnapshotBuffer.add() using lt
        interpolator.addSnapshot(msg.id, {
          t: msg.t,
          lt: now,
          p: msg.p,
          r: msg.r,
          s: msg.s,
          l: msg.l,
          seq: msg.seq,
          vx: msg.vx,
          vz: msg.vz,
        });
        return;
      } else if (msg.type === "PLAYER_FINISHED") {
        if (!isLocalEntity(msg.id)) {
          onRemoteFinish?.(msg.id, msg.finishTime);
        }
      }
      handleNetworkItemHit(msg);

      // Entity Replication Sync
      if (msg.type === "REQUEST_WORLD_STATE" && networkManager.isHost) {
        // Host replies with current state
        const snapshot = getWorldSnapshot();
        networkManager.broadcast({
          type: "WORLD_STATE_SYNC",
          shells: snapshot.shells,
          bananas: snapshot.bananas,
          oils: snapshot.oils
        });
      } else if (msg.type === "WORLD_STATE_SYNC") {
        // Client receives state
        restoreWorldSnapshot(msg);
      }
    });

    // On Mount: If I am NOT host, request state
    if (!networkManager.isHost && networkManager.roomCode) {
      // Delay slightly to ensure listeners are ready? No, socket is ready.
      // Send request
      networkManager.sendToHost({ type: "REQUEST_WORLD_STATE" });
    }

    return unsub;
  }, [localPlayerId, handlePositionUpdate, handleNetworkItemHit, onRemoteFinish, getWorldSnapshot, restoreWorldSnapshot]);

  return (
    <>
      <Canvas
        dpr={1}
        gl={{
          powerPreference: "high-performance",
          antialias: false,
          stencil: false,
          depth: true,
        }}
        shadows={false}
      >
        <color attach="background" args={[selectedMap.skyPreset === "night" ? "#050510" : "#87CEEB"]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[50, 50, 25]} intensity={1.5} castShadow={false} />
        <fog attach="fog" args={[selectedMap.skyPreset === "night" ? "#050510" : "#87CEEB", 10, 500]} />

        <Physics gravity={[0, -9.8, 0]}>
          <React.Suspense fallback={null}>
            <Track map={selectedMap} showCenterLine={false} />
            <StartGrid map={selectedMap} />

            {humanPlayer && (
              <>
                <Kart
                  key={`${humanPlayer.id}-${selectedMap.id}`} // Force remount on map change to sync initial position
                  ref={kartRef}
                  id={humanPlayer.id}
                  playerName={humanPlayer.name}
                  playerColor={humanPlayer.color}
                  position={selectedMap.startPositions?.[players.findIndex((p) => p.id === humanPlayer.id)] || [0, 2, 0]}
                  initialRotation={startRotation}
                  modelUrl={humanPlayer.modelUrl}
                  modelScale={getModelScale(humanPlayer.modelUrl)}
                  controls={controls}
                  touchControlsRef={touchControlsRef}
                  map={selectedMap}
                  raceStarted={gameState === "racing"}
                  onSpeedChange={onSpeedUpdate}
                  onPositionUpdate={handleLocalPositionUpdate}
                  onKartTransformChange={handleKartTransformChange}
                  onEffectsUpdate={handleEffectsUpdateLocal}
                  isLocalPlayer
                />
                <FollowCamera
                  targetRef={playerTransformRef}
                  targetRotation={startRotation}
                  speedRef={playerSpeedRef}
                  effectsRef={playerEffectsRef}
                />
              </>
            )}

            {/* Remote humans (pure visual ghosts — no RigidBody) */}
            {remoteHumans.map((remote) => (
              <RemoteKart
                key={remote.id}
                id={remote.id}
                playerName={remote.name}
                initialPosition={selectedMap.startPositions?.[players.findIndex((p) => p.id === remote.id)] || [0, 2, 0]}
                initialRotation={startRotation}
                modelUrl={remote.modelUrl || DEFAULT_CAR_MODEL}
                modelScale={getModelScale(remote.modelUrl || DEFAULT_CAR_MODEL)}
                color={remote.color}
                onInterpolatedState={(id, pos, rot, speed, lap) =>
                  handlePositionUpdate(id, pos, rot, speed, lap)
                }
              />
            ))}

            {/* Host-simulated bots (only host renders AI) */}
            {botPlayersHost.map((bot, index) => (
              <BotKart
                key={bot.id}
                isHost={isHost}
                ref={(r: import("./KartPro").KartRef | null) => {
                  if (r) {
                    botRefs.current[bot.id] = r;
                  } else {
                    delete botRefs.current[bot.id];
                  }
                }}
                id={bot.id}
                playerName={bot.name}
                position={selectedMap.startPositions?.[players.findIndex((p) => p.id === bot.id)] || [index * 2, 2, -10]}
                color={bot.color}
                modelUrl={bot.modelUrl}
                modelScale={getModelScale(bot.modelUrl)}
                map={selectedMap}
                difficulty={botDifficulty}
                raceStarted={gameState === "racing"}
                // Bots need an extra 180° (PI) rotation on Green Valley to face the correct way
                // This seems to be due to model orientation or track spline direction differences
                initialRotation={startRotation}
                onPositionUpdate={handleBotPositionUpdate}
                onEffectsUpdate={(effects) => handleBotEffectsUpdate(bot.id, effects)}
              />
            ))}

            {/* Remote bots (simulated by host, visualized as remote ghosts for clients) */}
            {botPlayersRemote.map((bot) => (
              <RemoteKart
                key={bot.id}
                id={bot.id}
                playerName={bot.name}
                initialPosition={selectedMap.startPositions?.[players.findIndex((p) => p.id === bot.id)] || [0, 2, 0]}
                initialRotation={startRotation}
                modelUrl={bot.modelUrl || DEFAULT_CAR_MODEL}
                modelScale={getModelScale(bot.modelUrl || DEFAULT_CAR_MODEL)}
                color={bot.color}
                onInterpolatedState={(id, pos, rot, speed, lap) =>
                  handlePositionUpdate(id, pos, rot, speed, lap)
                }
              />
            ))}
            <SceneReadyTrigger onReady={handleSceneReady} />
          </React.Suspense>

          {/* Skid Marks */}
          {humanPlayer && (
            <SkidMarks
              kartRef={kartRef}
              effectsRef={playerEffectsRef}
              rearWheelOffsets={getRearWheelPositions(humanPlayer.modelUrl)}
            />
          )}
          {botPlayersHost.map((bot) => {
            if (!botEffectsRefs.current[bot.id]) {
              botEffectsRefs.current[bot.id] = { current: { isDrifting: false, isBoosting: false } };
            }
            return (
              <SkidMarks
                key={`skid-${bot.id}`}
                kartRef={{ current: botRefs.current[bot.id] ?? null }}
                effectsRef={botEffectsRefs.current[bot.id]}
                rearWheelOffsets={getRearWheelPositions(bot.modelUrl)}
              />
            );
          })}

          {/* Banana & Oil Pools */}
          <BananaPool ref={bananaPoolRef} onCollide={handleBananaCollide} />
          <OilPool ref={oilPoolRef} onCollide={handleOilCollide} />

          {/* Red Shells (Rockets) */}
          {redShells.map((shell) => (
            <RedShell
              key={shell.id}
              id={shell.id}
              startPosition={shell.startPosition}
              startRotation={shell.startRotation}
              ownerId={shell.ownerId}
              targetId={shell.targetId}
              allKarts={allKartRefsCache.current}
              onCollide={handleShellCollide}
            />
          ))}

          {/* Item Boxes */}
          {itemBoxPositions.map((pos, i) => (
            <ItemBox
              key={`itembox-${i}`}
              position={pos}
              allKarts={allKartRefsCache.current}
              onCollect={handleItemCollect}
            />
          ))}
        </Physics>

        {/* Sound System */}
        <SoundEffects ref={sfxRef} />
        <EngineSound speedRef={playerSpeedRef} maxSpeed={45} enabled={gameState === "racing" || gameState === "countdown" || gameState === "finished"} />
        <DriftSound isDriftingRef={isDriftingRef} enabled={gameState === "racing" || gameState === "finished"} />
        <SpatialEngineSound
          playerTransformRef={playerTransformRef}
          botRefs={botRefs}
          racerStatesRef={racerStatesRef}
          botPlayers={botPlayersHost}
          botDifficulty={botDifficulty}
          enabled={gameState === "racing" || gameState === "countdown" || gameState === "finished"}
        />

        {/* Debug: draw call counter */}
        <DrawCallLogger />
      </Canvas>

    </>
  );
});
