"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Controls } from "@/lib/game/types";

const defaultControls: Controls = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  drift: false,
  item: false,
  reset: false,
};

/**
 * Touch-based controls for mobile.
 *
 * Left side of screen  → virtual joystick (steering + accelerate/brake)
 * Right side buttons    → drift, item, reset (managed by MobileControls component)
 *
 * The joystick works by tracking touch position relative to its center:
 *  - Up    → forward
 *  - Down  → backward
 *  - Left  → left
 *  - Right → right
 * Diagonal combos are supported (e.g. forward + left).
 */
export function useTouchControls() {
  const controlsRef = useRef<Controls>({ ...defaultControls });
  const [controls, setControls] = useState<Controls>({ ...defaultControls });

  const BOOL_KEYS: (keyof Controls)[] = ["forward", "backward", "left", "right", "drift", "item", "reset"];

  const update = useCallback((partial: Partial<Controls>) => {
    const prev = controlsRef.current;
    const next = { ...prev, ...partial };
    controlsRef.current = next;
    // Only trigger React re-render when boolean keys change (buttons/dpad).
    // Analog values (steerX, throttleY) are read directly from controlsRef by the game loop.
    const boolChanged = BOOL_KEYS.some(k => next[k] !== prev[k]);
    if (boolChanged) setControls(next);
  }, []);

  const resetControls = useCallback(() => {
    controlsRef.current = { ...defaultControls };
    setControls({ ...defaultControls });
  }, []);

  return { controls, update, resetControls, controlsRef };
}

/**
 * Detect if we're on a touch device.
 */
export function useIsTouchDevice() {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const check = () => {
      setIsTouch(
        "ontouchstart" in window ||
        navigator.maxTouchPoints > 0 ||
        window.matchMedia("(pointer: coarse)").matches
      );
    };
    check();
    // Re-check on resize (e.g. switching between desktop/tablet mode)
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return isTouch;
}
