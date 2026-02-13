"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import type { Player } from "@/lib/game/types";
import type { MapConfig } from "@/lib/game/maps";

// ── Types ───────────────────────────────────────────────────────────

export interface RacerState {
  id: string;
  name: string;
  color: string;
  position: number;
  lap: number;
  lapProgress: number;
  totalProgress: number;
  speed: number;
  isPlayer: boolean;
  finished: boolean;
  finishTime?: number;
  kartPosition: [number, number, number];
  kartRotation: number;
  checkpoints: number; // 0=Start, 1=25%, 2=60%, 3=ReadyToFinish
  distanceTraveled: number; // Accumulated distance in meters since race start
}

// ── Constants ───────────────────────────────────────────────────────

const MIN_CHECKPOINT_SPEED = 2.0;
const MIN_DISTANCE_FOR_CHECKPOINT = 30; // meters
const SYNC_INTERVAL = 100; // ms — sync ref→state for React re-renders

// ── Hook ────────────────────────────────────────────────────────────

export function useRaceState({
  players,
  screen,
  selectedMap,
  localPlayerId,
  totalLaps,
  gameStateRef,
  raceTimeRef,
}: {
  players: Player[];
  screen: "menu" | "racing";
  selectedMap: MapConfig;
  localPlayerId: string;
  totalLaps: number;
  gameStateRef: React.RefObject<string>;
  raceTimeRef: React.RefObject<number>;
}) {
  const racerStatesRef = useRef<Map<string, RacerState>>(new Map());
  const [racerStates, setRacerStates] = useState<Map<string, RacerState>>(new Map());

  // Initialize racer states when players change
  useEffect(() => {
    if (players.length > 0 && screen === "racing") {
      const initialStates = new Map<string, RacerState>();
      players.forEach((player, index) => {
        initialStates.set(player.id, {
          id: player.id,
          name: player.name,
          color: player.color,
          position: index + 1,
          lap: 1,
          lapProgress: 0,
          totalProgress: 0,
          speed: 0,
          isPlayer: localPlayerId ? player.id === localPlayerId : (index === 0),
          finished: false,
          kartPosition: selectedMap.startPositions[index] || [0, 1, -5 - index * 5],
          kartRotation: 0,
          checkpoints: 0,
          distanceTraveled: 0,
        });
      });
      racerStatesRef.current = initialStates;
      setRacerStates(initialStates);
    }
  }, [players, screen, selectedMap.startPositions, localPlayerId]);

  // Periodic sync: recalculate positions + copy ref → React state (10Hz)
  useEffect(() => {
    const interval = window.setInterval(() => {
      const states = racerStatesRef.current;
      // Recalculate positions (sort) at 10Hz instead of every useFrame call
      const sorted = Array.from(states.values()).sort((a, b) => {
        if (a.finished && b.finished) {
          return (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity);
        }
        if (a.finished) return -1;
        if (b.finished) return 1;
        return b.totalProgress - a.totalProgress;
      });
      sorted.forEach((racer, idx) => {
        const s = states.get(racer.id);
        if (s) s.position = idx + 1;
      });
      setRacerStates(new Map(states));
    }, SYNC_INTERVAL);
    return () => window.clearInterval(interval);
  }, []);

  // Handle position updates with checkpoint/anti-cheat logic
  const handlePositionUpdate = useCallback(
    (
      id: string,
      position: [number, number, number],
      rotation: number,
      speed: number,
      lapProgress: number
    ) => {
      // Once the local player has finished, freeze ALL race results.
      if (gameStateRef.current === "finished") return;

      const states = racerStatesRef.current;
      const currentState = states.get(id);
      if (!currentState || currentState.finished) return;

      // SECTOR LOGIC (Prevent Reverse Farming & False Laps)
      let { lap, checkpoints, distanceTraveled } = currentState;
      let newLap = lap;

      // Accumulate distance traveled (Euclidean XZ distance)
      const dx = position[0] - currentState.kartPosition[0];
      const dz = position[2] - currentState.kartPosition[2];
      const stepDist = Math.sqrt(dx * dx + dz * dz);
      // Clamp step to prevent teleport/respawn from counting as distance
      if (stepDist < 20) {
        distanceTraveled += stepDist;
      }

      const isMoving = speed > MIN_CHECKPOINT_SPEED && distanceTraveled > MIN_DISTANCE_FOR_CHECKPOINT;

      if (isMoving) {
        // Sector 1: passed 25% (only if at checkpoint 0)
        if (checkpoints === 0 && lapProgress > 0.25 && lapProgress < 0.75) {
          checkpoints = 1;
        }
        // Sector 2: passed 60% (only if at checkpoint 1)
        else if (checkpoints === 1 && lapProgress > 0.6) {
          checkpoints = 2;
        }
        // Sector 3 (Finish Prep): passed 85% (only if at checkpoint 2)
        else if (checkpoints === 2 && lapProgress > 0.85) {
          checkpoints = 3;
        }

        // Finish Line Cross (High → Low) — requires all 3 checkpoints
        if (checkpoints === 3 && currentState.lapProgress > 0.9 && lapProgress < 0.1) {
          newLap = lap + 1;
          checkpoints = 0; // Reset for next lap
        }
      }

      // Penalize Reverse
      if (checkpoints === 2 && lapProgress < 0.5) checkpoints = 1;
      if (checkpoints === 1 && lapProgress < 0.2) checkpoints = 0;

      // FINISH DETECTION: check if racer completed all laps
      const MIN_DISTANCE_FOR_FINISH = 100 * totalLaps;
      const completedAllLaps = newLap > totalLaps;
      const canFinish = completedAllLaps && distanceTraveled > MIN_DISTANCE_FOR_FINISH;

      // Clamp displayed lap to totalLaps — NEVER show 4/3
      // The internal newLap can exceed totalLaps temporarily to detect finish,
      // but displayed value is always capped.
      const displayLap = Math.min(newLap, totalLaps);

      // If crossed finish but didn't meet distance requirement, hold at last lap
      if (completedAllLaps && !canFinish) {
        checkpoints = 3; // Keep ready-to-finish so next crossing re-triggers
      }

      // Mutate in-place (no spread) — avoids 480 object creations/s from GC pressure
      // Safe because React state is only updated via new Map() in the 10Hz sync interval
      currentState.kartPosition = position;
      currentState.kartRotation = rotation;
      currentState.speed = speed;
      currentState.lapProgress = lapProgress;
      currentState.lap = displayLap;
      currentState.checkpoints = checkpoints;
      currentState.distanceTraveled = distanceTraveled;
      // totalProgress uses actual newLap for correct ranking (finished racers rank higher)
      currentState.totalProgress = (canFinish ? totalLaps : displayLap - 1) + lapProgress;
      currentState.finished = canFinish;
      if (canFinish && !currentState.finishTime) {
        currentState.finishTime = raceTimeRef.current;
      }
    },
    [totalLaps, gameStateRef, raceTimeRef]
  );

  // Handle remote player finish (from network PLAYER_FINISHED event)
  const handleRemoteFinish = useCallback(
    (id: string, finishTime: number) => {
      const states = racerStatesRef.current;
      const state = states.get(id);
      if (!state || state.finished) return;

      state.finished = true;
      state.finishTime = finishTime;
      state.lap = totalLaps;
      state.lapProgress = 1;
      state.totalProgress = totalLaps + 1; // Rank above unfinished racers
    },
    [totalLaps]
  );

  // Derived data for HUD
  const playerRacer = useMemo(() => {
    return Array.from(racerStates.values()).find((r) => r.isPlayer);
  }, [racerStates]);

  const racerPositions = useMemo(() => {
    return Array.from(racerStates.values()).map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      position: r.position,
      lap: r.lap,
      lapProgress: r.lapProgress,
      isPlayer: r.isPlayer,
      finished: r.finished,
      finishTime: r.finishTime,
      kartPosition: r.kartPosition,
      kartRotation: r.kartRotation,
    }));
  }, [racerStates]);

  return {
    racerStates,
    racerStatesRef,
    handlePositionUpdate,
    handleRemoteFinish,
    playerRacer,
    racerPositions,
  };
}
