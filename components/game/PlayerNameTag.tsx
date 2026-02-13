"use client";

import { Billboard, Text } from "@react-three/drei";

// ── Constants ────────────────────────────────────────────────────────
const NAME_Y_OFFSET = 2.8;       // Height above kart origin
const FONT_SIZE = 0.45;
const OUTLINE_WIDTH = 0.06;
const MAX_OPACITY = 0.95;

// ── Component ────────────────────────────────────────────────────────

interface PlayerNameTagProps {
  name: string;
  color?: string;
  /** Y offset above the kart origin (default: 2.8) */
  yOffset?: number;
  /** Whether to show the name tag (hide for the local player if desired) */
  visible?: boolean;
}

/**
 * GPU-rendered billboard name tag that always faces the camera.
 * Uses @react-three/drei Text (troika-three-text) — no DOM elements,
 * no per-frame overhead. Like Mario Kart 8 / Forza Horizon name tags.
 *
 * Place inside a kart's <group> to inherit its world transform.
 */
export function PlayerNameTag({
  name,
  color = "#ffffff",
  yOffset = NAME_Y_OFFSET,
  visible = true,
}: PlayerNameTagProps) {
  if (!visible || !name) return null;

  return (
    <Billboard
      follow
      lockX={false}
      lockY={false}
      lockZ={false}
      position={[0, yOffset, 0]}
    >
      {/* Background shadow/outline for readability */}
      <Text
        font="/fonts/Inter.ttf"
        fontSize={FONT_SIZE}
        color="#000000"
        anchorX="center"
        anchorY="middle"
        outlineWidth={OUTLINE_WIDTH}
        outlineColor="#000000"
        fillOpacity={0}
        outlineOpacity={0.7}
      >
        {name}
      </Text>
      {/* Foreground colored text */}
      <Text
        font="/fonts/Inter.ttf"
        fontSize={FONT_SIZE}
        color={color}
        anchorX="center"
        anchorY="middle"
        fillOpacity={MAX_OPACITY}
        outlineWidth={0.02}
        outlineColor="#000000"
        outlineOpacity={0.9}
      >
        {name}
      </Text>
    </Billboard>
  );
}
