"use client";

import React, { useEffect, useCallback } from "react";
import { Canvas, useThree, useFrame as useR3FFrame } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";

import type { MapConfig } from "@/lib/game/maps";
import type { Player, Controls } from "@/lib/game/types";
import { Track } from "./Track";
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

type GameSceneProps = {
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
      const { render, memory } = gl.info;
      console.log(
        `[Render] drawCalls=${render.calls} triangles=${render.triangles} ` +
        `textures=${memory.textures} geometries=${memory.geometries}`
      );
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

  const otherPlayers = localPlayerId
    ? players.filter((p) => p.id !== localPlayerId)
    : players.filter((p) => p.isBot || !p.isBot); // single-player shows bots only later

  const botPlayersHost = otherPlayers.filter((p) => p.isBot && networkManager.isHost);
  const botPlayersRemote = otherPlayers.filter((p) => p.isBot && !networkManager.isHost);
  const remoteHumans = otherPlayers.filter((p) => !p.isBot);

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
      handlePositionUpdate(id, pos, rot, speed, progress);
      const now = performance.now();
      if (now - lastNetworkUpdate.current > 33) {
        lastNetworkUpdate.current = now;
        networkManager.broadcast({
          type: "POS", id, p: pos, r: rot, s: speed, l: progress, t: performance.now(),
        });
      }
    },
    [handlePositionUpdate]
  );

  // Host-only: broadcast bot positions to remote players
  const handleBotPositionUpdate = useCallback(
    (id: string, pos: [number, number, number], rot: number, speed: number, progress: number) => {
      handlePositionUpdate(id, pos, rot, speed, progress);
      if (!networkManager.isHost) return;
      const now = performance.now();
      if (now - lastNetworkUpdate.current > 33) {
        lastNetworkUpdate.current = now;
        networkManager.broadcast({
          type: "POS", id, p: pos, r: rot, s: speed, l: progress, t: performance.now(),
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
  const initialRemoteData = React.useMemo(() => {
    const data: Record<string, { pos: [number, number, number]; rot: number; speed: number; lapProgress: number; t: number }> = {};
    if (localPlayerId) {
      const remoteEntities = players.filter((p) => p.id !== localPlayerId && (!networkManager.isHost || !p.isBot));
      for (const remote of remoteEntities) {
        const gridIdx = players.findIndex((p) => p.id === remote.id);
        const gridPos = selectedMap.startPositions?.[gridIdx] || [0, 2, 0];
        data[remote.id] = {
          pos: gridPos as [number, number, number],
          rot: startRotation,
          speed: 0,
          lapProgress: 0,
          t: performance.now(),
        };
      }
    }
    return data;
  }, [localPlayerId, players, selectedMap, startRotation]);
  const remoteKartDataRef = React.useRef(initialRemoteData);
  const lastNetworkUpdate = React.useRef(0);

  // Listen for network updates (POS + ITEM_HIT + PLAYER_FINISHED)
  React.useEffect(() => {
    const unsub = networkManager.onMessage((msg) => {
      if (msg.type === "POS" && msg.id !== localPlayerId) {
        remoteKartDataRef.current[msg.id] = { pos: msg.p, rot: msg.r, speed: msg.s, lapProgress: msg.l, t: msg.t || performance.now() };
        handlePositionUpdate(msg.id, msg.p, msg.r, msg.s, msg.l || 0);
      } else if (msg.type === "PLAYER_FINISHED" && msg.id !== localPlayerId) {
        onRemoteFinish?.(msg.id, msg.finishTime);
      }
      handleNetworkItemHit(msg);
    });
    return unsub;
  }, [localPlayerId, handlePositionUpdate, handleNetworkItemHit, onRemoteFinish]);

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
                />
                <FollowCamera
                  targetRef={playerTransformRef}
                  targetRotation={startRotation}
                  speedRef={playerSpeedRef}
                  effectsRef={playerEffectsRef}
                />
              </>
            )}

            {/* Remote humans */}
            {remoteHumans.map((remote) => (
              <RemoteKart
                key={remote.id}
                id={remote.id}
                playerName={remote.name}
                dataRef={remoteKartDataRef}
                initialPosition={selectedMap.startPositions?.[players.findIndex((p) => p.id === remote.id)] || [0, 2, 0]}
                initialRotation={startRotation}
                modelUrl={remote.modelUrl || DEFAULT_CAR_MODEL}
                modelScale={getModelScale(remote.modelUrl || DEFAULT_CAR_MODEL)}
                color={remote.color}
              />
            ))}

            {/* Host-simulated bots (only host renders AI) */}
            {botPlayersHost.map((bot, index) => (
              <BotKart
                key={bot.id}
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
                initialRotation={startRotation}
                onPositionUpdate={handleBotPositionUpdate}
                onEffectsUpdate={(effects) => handleBotEffectsUpdate(bot.id, effects)}
              />
            ))}

            {/* Remote bots (simulated by host, visualized as remote karts for clients) */}
            {botPlayersRemote.map((bot) => (
              <RemoteKart
                key={bot.id}
                id={bot.id}
                playerName={bot.name}
                dataRef={remoteKartDataRef}
                initialPosition={selectedMap.startPositions?.[players.findIndex((p) => p.id === bot.id)] || [0, 2, 0]}
                initialRotation={startRotation}
                modelUrl={bot.modelUrl || DEFAULT_CAR_MODEL}
                modelScale={getModelScale(bot.modelUrl || DEFAULT_CAR_MODEL)}
                color={bot.color}
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
          remoteKartDataRef={remoteKartDataRef}
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
