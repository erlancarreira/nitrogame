"use client";

import { useCallback, useRef } from "react";
import { networkManager } from "@/lib/game/networking";
import { netClock } from "@/lib/netcode/netclock";

// ── Types ───────────────────────────────────────────────────────────

type GameState = "waiting" | "countdown" | "racing" | "finished" | "paused";

interface UseCountdownOptions {
  setCountdown: (n: number) => void;
  setGameState: (s: GameState) => void;
  gameStateRef: React.MutableRefObject<string>;
  startTimeRef: React.MutableRefObject<number>;
  timeRef: React.MutableRefObject<number | null>;
  updateRaceTime: (timestamp: number) => void;
}

// ── Hook ────────────────────────────────────────────────────────────

/**
 * Manages server-synced (Rocket League style) and local countdown timers.
 *
 * Returns `start(serverRaceStartTime?)` and `cleanup()`.
 */
export function useCountdown({
  setCountdown,
  setGameState,
  gameStateRef,
  startTimeRef,
  timeRef,
  updateRaceTime,
}: UseCountdownOptions) {
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const cleanup = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const startRacing = useCallback(() => {
    setGameState("racing");
    gameStateRef.current = "racing";
    startTimeRef.current = performance.now();
    timeRef.current = requestAnimationFrame(updateRaceTime);
  }, [setGameState, gameStateRef, startTimeRef, timeRef, updateRaceTime]);

  const start = useCallback(
    (serverRaceStartTime?: number) => {
      // Clean previous timers
      cleanup();

      if (serverRaceStartTime) {
        // ── Server-Synchronized Countdown ──
        // ── Server-Synchronized Countdown ──
        console.log(
          `[countdown] Server-synced. raceStartTime=${serverRaceStartTime}`
        );

        const tick = () => {
          const serverNow = netClock.now;
          const msUntilStart = serverRaceStartTime - serverNow;

          if (msUntilStart > 2000) {
            setCountdown(3);
          } else if (msUntilStart > 1000) {
            setCountdown(2);
          } else if (msUntilStart > 0) {
            setCountdown(1);
          } else {
            // === GO! ===
            setCountdown(0);
            cleanup();
            timeoutRef.current = setTimeout(() => {
              startRacing();
              timeoutRef.current = null;
            }, 400);
          }
        };

        setCountdown(3);
        tick();
        countdownRef.current = setInterval(tick, 100);
      } else {
        // ── Local Countdown (offline / single player) ──
        console.log("[countdown] Local mode (no server timestamp)");
        let count = 3;
        setCountdown(3);

        countdownRef.current = setInterval(() => {
          count -= 1;
          setCountdown(count);

          if (count <= 0) {
            cleanup();
            timeoutRef.current = setTimeout(() => {
              startRacing();
              timeoutRef.current = null;
            }, 500);
          }
        }, 1000);
      }
    },
    [cleanup, setCountdown, startRacing]
  );

  return { start, cleanup };
}
