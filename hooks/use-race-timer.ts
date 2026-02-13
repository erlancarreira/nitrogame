"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ───────────────────────────────────────────────────────────

type GameState = "waiting" | "countdown" | "racing" | "finished" | "paused";

// ── Hook ────────────────────────────────────────────────────────────

/**
 * Manages:
 * 1. Race time via RAF loop (high precision, no React re-renders)
 * 2. FPS counter via separate RAF (EMA smoothing)
 * 3. Periodic sync of refs → React state for HUD (10Hz)
 *
 * Returns refs for GameScene (per-frame) and state for HUD (10Hz).
 */
export function useRaceTimer() {
  // ── Race Time ──
  const timeRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const gameStateRef = useRef<GameState>("waiting");
  const raceTimeRef = useRef(0);

  const [raceTime, setRaceTime] = useState(0);
  const [playerSpeed, setPlayerSpeed] = useState(0);
  const [fps, setFps] = useState(0);
  const [frameMs, setFrameMs] = useState(0);

  const playerSpeedRef = useRef(0);

  const updateRaceTime = useCallback((timestamp: number) => {
    if (gameStateRef.current !== "racing") return;
    raceTimeRef.current = timestamp - startTimeRef.current;
    timeRef.current = window.requestAnimationFrame(updateRaceTime);
  }, []);

  const stopTimer = useCallback(() => {
    if (timeRef.current) {
      window.cancelAnimationFrame(timeRef.current);
      timeRef.current = null;
    }
  }, []);

  // ── FPS Counter (EMA smoothing) ──
  const fpsRef = useRef({
    last: 0,
    acc: 0,
    frames: 0,
    raf: 0,
    smoothFps: 60,
    smoothMs: 16.7,
  });

  useEffect(() => {
    const alpha = 0.12;
    const tick = (t: number) => {
      const state = fpsRef.current;
      if (!state.last) state.last = t;
      const rawDt = t - state.last;
      state.last = t;

      if (rawDt > 0) {
        const dt = Math.min(rawDt, 100);
        const instantFps = 1000 / dt;
        state.smoothFps = state.smoothFps * (1 - alpha) + instantFps * alpha;
        state.smoothMs = state.smoothMs * (1 - alpha) + dt * alpha;
      }

      state.acc += rawDt;
      state.frames += 1;
      if (state.acc >= 1000) {
        setFps(Math.round(state.smoothFps));
        setFrameMs(Math.round(state.smoothMs));
        state.acc = 0;
        state.frames = 0;
      }
      state.raf = window.requestAnimationFrame(tick);
    };

    fpsRef.current.raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(fpsRef.current.raf);
    };
  }, []);

  // ── Periodic sync: raceTime + speed → React state (10Hz for HUD) ──
  useEffect(() => {
    const interval = window.setInterval(() => {
      setRaceTime(raceTimeRef.current);
      setPlayerSpeed(playerSpeedRef.current);
    }, 100);
    return () => window.clearInterval(interval);
  }, []);

  // ── Cleanup RAF on unmount ──
  useEffect(() => {
    return () => {
      if (timeRef.current) window.cancelAnimationFrame(timeRef.current);
    };
  }, []);

  return {
    // Refs (for GameScene / per-frame usage)
    timeRef,
    startTimeRef,
    gameStateRef,
    raceTimeRef,
    playerSpeedRef,
    // Functions
    updateRaceTime,
    stopTimer,
    // React state (for HUD, 10Hz)
    raceTime,
    setRaceTime,
    playerSpeed,
    fps,
    frameMs,
  };
}
