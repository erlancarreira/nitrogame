"use client";

import React, { useCallback, useRef } from "react";

import type { Controls } from "@/lib/game/types";

interface MobileControlsProps {
  onUpdate: (partial: Partial<Controls>) => void;
  item: "none" | "mushroom" | "banana" | "red_shell" | "star" | "oil";
  disabled?: boolean;
}

// ── Joystick constants ────────────────────────────────────────────
const JOYSTICK_SIZE = 140; // outer circle diameter
const KNOB_SIZE = 56;      // inner knob diameter
const DEAD_ZONE = 0.18;    // % of radius before registering input

/**
 * Full-screen mobile control overlay.
 *
 * Left half  → virtual joystick (move = steer + accel/brake)
 * Right side → stacked action buttons (GAS on big, DRIFT, ITEM)
 */
export const MobileControls = React.memo(function MobileControls({
  onUpdate,
  item,
  disabled = false,
}: MobileControlsProps) {
  // ── Joystick state ──────────────────────────────────────────────
  const joystickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const touchIdRef = useRef<number | null>(null);
  const lastDirRef = useRef({ forward: false, backward: false, left: false, right: false, steerX: 0, throttleY: 0 });

  const computeDir = useCallback(
    (cx: number, cy: number, ox: number, oy: number) => {
      const dx = cx - ox;
      const dy = cy - oy;
      const radius = JOYSTICK_SIZE / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const normDist = Math.min(dist / radius, 1);

      // Clamp knob position
      const clampedDx = normDist > 0 ? (dx / dist) * Math.min(dist, radius) : 0;
      const clampedDy = normDist > 0 ? (dy / dist) * Math.min(dist, radius) : 0;

      if (knobRef.current) {
        knobRef.current.style.transform = `translate(${clampedDx}px, ${clampedDy}px)`;
      }

      if (normDist < DEAD_ZONE) {
        return { forward: false, backward: false, left: false, right: false, steerX: 0, throttleY: 0 };
      }

      // Analog axes: normalized -1..+1
      const rawX = dx / radius; // positive = right
      const rawY = dy / radius; // positive = down
      const steerX = Math.max(-1, Math.min(1, rawX));   // -1 left, +1 right
      const throttleY = Math.max(-1, Math.min(1, -rawY)); // +1 forward, -1 backward

      // Boolean flags (still needed for compatibility)
      const forward = throttleY > 0.2;
      const backward = throttleY < -0.2;
      const left = steerX < -0.2;
      const right = steerX > 0.2;

      return { forward, backward, left, right, steerX, throttleY };
    },
    []
  );

  const handleJoystickStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled || touchIdRef.current !== null) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      touchIdRef.current = touch.identifier;

      const rect = joystickRef.current?.getBoundingClientRect();
      if (!rect) return;

      const ox = rect.left + rect.width / 2;
      const oy = rect.top + rect.height / 2;
      originRef.current = { x: ox, y: oy };

      const dir = computeDir(touch.clientX, touch.clientY, ox, oy);
      lastDirRef.current = dir;
      onUpdate(dir);
    },
    [disabled, computeDir, onUpdate]
  );

  const handleJoystickMove = useCallback(
    (e: React.TouchEvent) => {
      if (touchIdRef.current === null || !originRef.current) return;
      const touch = Array.from(e.changedTouches).find(
        (t) => t.identifier === touchIdRef.current
      );
      if (!touch) return;

      const dir = computeDir(
        touch.clientX,
        touch.clientY,
        originRef.current.x,
        originRef.current.y
      );

      // Always update on move (analog values change continuously)
      lastDirRef.current = dir;
      onUpdate(dir);
    },
    [computeDir, onUpdate]
  );

  const handleJoystickEnd = useCallback(
    (e: React.TouchEvent) => {
      const touch = Array.from(e.changedTouches).find(
        (t) => t.identifier === touchIdRef.current
      );
      if (!touch) return;

      touchIdRef.current = null;
      originRef.current = null;
      lastDirRef.current = { forward: false, backward: false, left: false, right: false, steerX: 0, throttleY: 0 };

      if (knobRef.current) {
        knobRef.current.style.transform = "translate(0px, 0px)";
      }

      onUpdate({ forward: false, backward: false, left: false, right: false, steerX: 0, throttleY: 0 });
    },
    [onUpdate]
  );

  // ── Action button handlers ─────────────────────────────────────
  const handleBtnStart = useCallback(
    (key: "drift" | "item" | "forward") => (e: React.TouchEvent) => {
      e.preventDefault();
      if (!disabled) onUpdate({ [key]: true });
    },
    [disabled, onUpdate]
  );

  const handleBtnEnd = useCallback(
    (key: "drift" | "item" | "forward") => (e: React.TouchEvent) => {
      e.preventDefault();
      onUpdate({ [key]: false });
    },
    [onUpdate]
  );

  const itemEmoji =
    item === "mushroom" ? "🍄" :
      item === "banana" ? "🍌" :
        item === "red_shell" ? "🚀" : null;

  return (
    <div className="absolute inset-0 z-20 pointer-events-none select-none md:hidden">
      {/* ── Left: Joystick ──────────────────────────────────────── */}
      <div
        className="absolute bottom-8 left-6 pointer-events-auto"
        style={{ width: JOYSTICK_SIZE, height: JOYSTICK_SIZE, marginBottom: "env(safe-area-inset-bottom, 0px)", marginLeft: "env(safe-area-inset-left, 0px)" }}
      >
        <div
          ref={joystickRef}
          className="relative w-full h-full rounded-full bg-white/10 border-2 border-white/20 backdrop-blur-sm"
          onTouchStart={handleJoystickStart}
          onTouchMove={handleJoystickMove}
          onTouchEnd={handleJoystickEnd}
          onTouchCancel={handleJoystickEnd}
          style={{ touchAction: "none" }}
        >
          {/* Direction hints */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 text-white/20 text-[10px] font-bold">▲</div>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-white/20 text-[10px] font-bold">▼</div>
          <div className="absolute left-2 top-1/2 -translate-y-1/2 text-white/20 text-[10px] font-bold">◀</div>
          <div className="absolute right-2 top-1/2 -translate-y-1/2 text-white/20 text-[10px] font-bold">▶</div>

          {/* Knob */}
          <div
            ref={knobRef}
            className="absolute rounded-full bg-white/30 border-2 border-white/50 shadow-lg"
            style={{
              width: KNOB_SIZE,
              height: KNOB_SIZE,
              top: (JOYSTICK_SIZE - KNOB_SIZE) / 2,
              left: (JOYSTICK_SIZE - KNOB_SIZE) / 2,
              transition: "none",
              willChange: "transform",
            }}
          />
        </div>
      </div>

      {/* ── Right: Action Buttons ───────────────────────────────── */}
      <div className="absolute bottom-8 right-6 flex flex-col items-center gap-3 pointer-events-auto" style={{ marginBottom: "env(safe-area-inset-bottom, 0px)", marginRight: "env(safe-area-inset-right, 0px)" }}>
        {/* GAS (Big green button) */}
        <button
          className="w-20 h-20 rounded-full bg-green-500/60 border-4 border-green-400/70 backdrop-blur-sm text-white font-black text-lg uppercase tracking-wider active:bg-green-500/80 active:scale-95 transition-transform shadow-lg shadow-green-500/30"
          onTouchStart={handleBtnStart("forward")}
          onTouchEnd={handleBtnEnd("forward")}
          onTouchCancel={handleBtnEnd("forward")}
          style={{ touchAction: "none" }}
        >
          GAS
        </button>

        <div className="flex gap-3">
          {/* DRIFT button */}
          <button
            className="w-16 h-16 rounded-full bg-blue-500/50 border-3 border-blue-400/60 backdrop-blur-sm text-white font-black text-xs uppercase tracking-wider active:bg-blue-500/70 active:scale-95 transition-transform shadow-lg shadow-blue-500/20"
            onTouchStart={handleBtnStart("drift")}
            onTouchEnd={handleBtnEnd("drift")}
            onTouchCancel={handleBtnEnd("drift")}
            style={{ touchAction: "none" }}
          >
            DRIFT
          </button>

          {/* ITEM button */}
          <button
            className={`w-16 h-16 rounded-full border-3 backdrop-blur-sm font-black text-xs uppercase tracking-wider active:scale-95 transition-all shadow-lg ${item !== "none"
                ? "bg-orange-500/60 border-orange-400/70 text-white shadow-orange-500/30 animate-pulse"
                : "bg-white/10 border-white/20 text-white/40"
              }`}
            onTouchStart={handleBtnStart("item")}
            onTouchEnd={handleBtnEnd("item")}
            onTouchCancel={handleBtnEnd("item")}
            style={{ touchAction: "none" }}
            disabled={item === "none"}
          >
            {itemEmoji ? (
              <span className="text-2xl">{itemEmoji}</span>
            ) : (
              "ITEM"
            )}
          </button>
        </div>
      </div>
    </div>
  );
});
