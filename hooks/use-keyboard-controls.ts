"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Controls } from "@/lib/game/types";

type ControlState = "disabled" | "racing" | "finished";

interface UseKeyboardControlsOptions {
  state: ControlState;
  onFinishReset?: () => void;
}

const defaultControls: Controls = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  drift: false,
  item: false,
  reset: false,
};

export function useKeyboardControls({ state, onFinishReset }: UseKeyboardControlsOptions) {
  const [controls, setControls] = useState<Controls>(defaultControls);
  const controlsRef = useRef<Controls>(defaultControls);

  const resetControls = useCallback(() => {
    setControls(defaultControls);
    controlsRef.current = defaultControls;
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (state === "disabled") return;

      if (state === "finished") {
        if (e.key.toLowerCase() === "r") {
          onFinishReset?.();
        }
        return;
      }

      const key = e.key.toLowerCase();
      const current = controlsRef.current;
      switch (key) {
        case "w":
        case "arrowup":
          if (!current.forward) {
            const next = { ...current, forward: true };
            controlsRef.current = next;
            setControls(next);
          }
          break;
        case "s":
        case "arrowdown":
          if (!current.backward) {
            const next = { ...current, backward: true };
            controlsRef.current = next;
            setControls(next);
          }
          break;
        case "a":
        case "arrowleft":
          if (!current.left) {
            const next = { ...current, left: true };
            controlsRef.current = next;
            setControls(next);
          }
          break;
        case "d":
        case "arrowright":
          if (!current.right) {
            const next = { ...current, right: true };
            controlsRef.current = next;
            setControls(next);
          }
          break;
        case " ":
          if (!current.drift) {
            const next = { ...current, drift: true };
            controlsRef.current = next;
            setControls(next);
          }
          break;
        case "shift":
        case "e":
        case "enter":
          if (!current.item) {
            const next = { ...current, item: true };
            controlsRef.current = next;
            setControls(next);
          }
          break;
        case "r":
          if (!current.reset) {
            const next = { ...current, reset: true };
            controlsRef.current = next;
            setControls(next);
          }
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const current = controlsRef.current;
      switch (key) {
        case "w":
        case "arrowup":
          if (current.forward) {
            const next = { ...current, forward: false };
            controlsRef.current = next;
            setControls(next);
          }
          break;
        case "s":
        case "arrowdown":
          if (current.backward) {
            const next = { ...current, backward: false };
            controlsRef.current = next;
            setControls(next);
          }
          break;
        case "a":
        case "arrowleft":
          if (current.left) {
            const next = { ...current, left: false };
            controlsRef.current = next;
            setControls(next);
          }
          break;
        case "d":
        case "arrowright":
          if (current.right) {
            const next = { ...current, right: false };
            controlsRef.current = next;
            setControls(next);
          }
          break;
        case " ":
          if (current.drift) {
            const next = { ...current, drift: false };
            controlsRef.current = next;
            setControls(next);
          }
          break;
        case "shift":
        case "e":
        case "enter":
          if (current.item) {
            const next = { ...current, item: false };
            controlsRef.current = next;
            setControls(next);
          }
          break;
        case "r":
          if (current.reset) {
            const next = { ...current, reset: false };
            controlsRef.current = next;
            setControls(next);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [state, onFinishReset]);

  return { controls, setControls, resetControls };
}
