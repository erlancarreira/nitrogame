"use client";

import React, { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

const BASE = "/assets/kart-map/racing-kit/Models/GLTF format/";

// ── GLB model paths ─────────────────────────────────────────────────
const MODELS = {
  // Road
  roadStraight: `${BASE}roadStraight.glb`,
  roadStraightLong: `${BASE}roadStraightLong.glb`,
  roadStraightArrow: `${BASE}roadStraightArrow.glb`,
  roadStraightLongMid: `${BASE}roadStraightLongMid.glb`,
  roadCornerSmall: `${BASE}roadCornerSmall.glb`,
  roadCornerLarge: `${BASE}roadCornerLarge.glb`,
  roadCornerLarger: `${BASE}roadCornerLarger.glb`,
  roadStart: `${BASE}roadStart.glb`,
  roadStartPositions: `${BASE}roadStartPositions.glb`,
  roadEnd: `${BASE}roadEnd.glb`,
  roadBump: `${BASE}roadBump.glb`,
  roadSide: `${BASE}roadSide.glb`,
  // Borders (road piece + red/white curb)
  roadCornerSmallBorder: `${BASE}roadCornerSmallBorder.glb`,
  roadCornerLargeBorder: `${BASE}roadCornerLargeBorder.glb`,
  roadCornerLargerBorder: `${BASE}roadCornerLargerBorder.glb`,
  // Walls (road piece + concrete wall)
  roadCornerSmallWall: `${BASE}roadCornerSmallWall.glb`,
  roadCornerLargeWall: `${BASE}roadCornerLargeWall.glb`,
  roadCornerLargerWall: `${BASE}roadCornerLargerWall.glb`,
  // Barrier
  barrierRed: `${BASE}barrierRed.glb`,
  barrierWhite: `${BASE}barrierWhite.glb`,
  barrierWall: `${BASE}barrierWall.glb`,
  // Bridge
  roadStraightBridge: `${BASE}roadStraightBridge.glb`,
  roadStraightBridgeMid: `${BASE}roadStraightBridgeMid.glb`,
  roadStraightBridgeStart: `${BASE}roadStraightBridgeStart.glb`,
  roadCornerBridgeSmall: `${BASE}roadCornerBridgeSmall.glb`,
  // Ramp
  roadRamp: `${BASE}roadRamp.glb`,
  roadRampLong: `${BASE}roadRampLong.glb`,
  // Decoration
  grandStand: `${BASE}grandStandCovered.glb`,
  grandStandRound: `${BASE}grandStandCoveredRound.glb`,
  billboard: `${BASE}billboard.glb`,
  billboardLow: `${BASE}billboardLow.glb`,
  lightPost: `${BASE}lightPostLarge.glb`,
  lightModern: `${BASE}lightPostModern.glb`,
  flagCheckers: `${BASE}flagCheckers.glb`,
  flagGreen: `${BASE}flagGreen.glb`,
  flagRed: `${BASE}flagRed.glb`,
  pylon: `${BASE}pylon.glb`,
  bannerGreen: `${BASE}bannerTowerGreen.glb`,
  bannerRed: `${BASE}bannerTowerRed.glb`,
  overhead: `${BASE}overheadLights.glb`,
  overheadRound: `${BASE}overheadRound.glb`,
  pitsOffice: `${BASE}pitsOffice.glb`,
  pitsGarage: `${BASE}pitsGarage.glb`,
  pitsGarageClosed: `${BASE}pitsGarageClosed.glb`,
  grass: `${BASE}grass.glb`,
  fenceStraight: `${BASE}fenceStraight.glb`,
  rail: `${BASE}rail.glb`,
} as const;

type ModelKey = keyof typeof MODELS;

// ── Tile-based circuit layout ───────────────────────────────────────
// Each tile is placed on a grid. 1 grid unit = TILE_SIZE game units.
// Kenney pieces are 1x1 (straight, small corner), 2x2 (large corner), 3x3 (larger corner).
// Rotation: 0=default, 90=CW, 180=flip, 270=CCW (degrees → radians)

const TILE_SIZE = 20; // 1 grid unit = 20 game units

interface TileDef {
  model: ModelKey;
  gx: number;       // grid X
  gz: number;       // grid Z
  rot: number;      // rotation in degrees (0, 90, 180, 270)
  sx?: number;      // grid size X (default 1)
  sz?: number;      // grid size Z (default 1)
}

// Layout inspired by the Kenney Racing Kit Sample.png
// Circuit goes: start straight → large right → back straight → large left →
// top straight → large right → bridge straight → large right → return to start
const CIRCUIT_TILES: TileDef[] = [
  // ═══ START/FINISH STRAIGHT (bottom, going right +X) ═══
  { model: "roadStartPositions", gx: 0, gz: 0, rot: 90, sx: 1, sz: 2 },
  { model: "roadStraightLong", gx: 1, gz: 0, rot: 90, sx: 1, sz: 2 },
  { model: "roadStraightLongMid", gx: 2, gz: 0, rot: 90, sx: 1, sz: 2 },
  { model: "roadStraightLong", gx: 3, gz: 0, rot: 90, sx: 1, sz: 2 },
  { model: "roadStraightArrow", gx: 4, gz: 0, rot: 90 },
  { model: "roadStraight", gx: 4, gz: -1, rot: 90 },

  // ═══ TURN 1 — Bottom-right (large corner, right turn going up) ═══
  { model: "roadCornerLargeBorder", gx: 5, gz: -1, rot: 0, sx: 2, sz: 2 },

  // ═══ RIGHT STRAIGHT (going up -Z) ═══
  { model: "roadStraightLong", gx: 6, gz: -3, rot: 0, sx: 1, sz: 2 },
  { model: "roadStraight", gx: 6, gz: -5, rot: 0 },
  { model: "roadStraightArrow", gx: 6, gz: -6, rot: 0 },
  { model: "roadStraightLong", gx: 6, gz: -7, rot: 0, sx: 1, sz: 2 },

  // ═══ TURN 2 — Top-right (large corner) ═══
  { model: "roadCornerLargerBorder", gx: 3, gz: -9, rot: 270, sx: 3, sz: 3 },

  // ═══ TOP STRAIGHT (going left -X) ═══
  { model: "roadStraightLong", gx: 2, gz: -9, rot: 270, sx: 1, sz: 2 },
  { model: "roadStraightArrow", gx: 0, gz: -9, rot: 270 },
  { model: "roadStraight", gx: -1, gz: -9, rot: 270 },
  { model: "roadStraightLong", gx: -2, gz: -9, rot: 270, sx: 1, sz: 2 },

  // ═══ TURN 3 — Top-left (larger corner) ═══
  { model: "roadCornerLargerBorder", gx: -4, gz: -9, rot: 180, sx: 3, sz: 3 },

  // ═══ LEFT STRAIGHT (going down +Z) ═══
  { model: "roadStraightLong", gx: -4, gz: -6, rot: 180, sx: 1, sz: 2 },
  { model: "roadStraight", gx: -4, gz: -4, rot: 180 },
  { model: "roadStraightArrow", gx: -4, gz: -3, rot: 180 },
  { model: "roadStraightLong", gx: -4, gz: -2, rot: 180, sx: 1, sz: 2 },

  // ═══ TURN 4 — Bottom-left (large corner, back to start) ═══
  { model: "roadCornerLargeBorder", gx: -4, gz: 0, rot: 90, sx: 2, sz: 2 },

  // ═══ CONNECTING STRAIGHT back to start ═══
  { model: "roadStraightLong", gx: -2, gz: 0, rot: 90, sx: 1, sz: 2 },
  { model: "roadStraight", gx: -1, gz: 0, rot: 90 },
  { model: "roadStraight", gx: -1, gz: -1, rot: 90 },
];

// Decoration placements
const DECOR_TILES: TileDef[] = [
  // Grandstands
  { model: "grandStand", gx: 1, gz: 2, rot: 0 },
  { model: "grandStandRound", gx: 3, gz: 2, rot: 0 },
  { model: "grandStand", gx: -2, gz: -11, rot: 180 },

  // Pit area
  { model: "pitsGarage", gx: -2, gz: 2, rot: 0 },
  { model: "pitsGarageClosed", gx: -3, gz: 2, rot: 0 },
  { model: "pitsOffice", gx: -4, gz: 2, rot: 0 },

  // Billboards
  { model: "billboard", gx: 7.5, gz: -5, rot: 270 },
  { model: "billboardLow", gx: -5.5, gz: -5, rot: 90 },

  // Start/finish decorations
  { model: "overhead", gx: 0, gz: -0.5, rot: 90 },
  { model: "flagCheckers", gx: -0.3, gz: 1.2, rot: 0 },
  { model: "flagCheckers", gx: -0.3, gz: -2.2, rot: 0 },

  // Light posts around the circuit
  { model: "lightPost", gx: 5, gz: 1.3, rot: 0 },
  { model: "lightPost", gx: 5, gz: -2.3, rot: 0 },
  { model: "lightModern", gx: 7.5, gz: -2, rot: 0 },
  { model: "lightModern", gx: 7.5, gz: -7, rot: 0 },
  { model: "lightPost", gx: 3, gz: -12, rot: 0 },
  { model: "lightPost", gx: -1, gz: -12, rot: 0 },
  { model: "lightModern", gx: -5.5, gz: -8, rot: 0 },
  { model: "lightModern", gx: -5.5, gz: -3, rot: 0 },
  { model: "lightPost", gx: -5.5, gz: 1, rot: 0 },

  // Banners
  { model: "bannerGreen", gx: 2, gz: -2.3, rot: 90 },
  { model: "bannerRed", gx: 2, gz: 1.3, rot: 90 },
  { model: "bannerGreen", gx: 7.5, gz: -4.5, rot: 0 },
  { model: "bannerRed", gx: -5.5, gz: -6, rot: 0 },

  // Pylons on corners
  { model: "pylon", gx: 5, gz: -1.5, rot: 0 },
  { model: "pylon", gx: 5.5, gz: -1, rot: 0 },
  { model: "pylon", gx: 3, gz: -9.5, rot: 0 },
  { model: "pylon", gx: -4, gz: -9.5, rot: 0 },
  { model: "pylon", gx: -4.5, gz: 0, rot: 0 },
  { model: "pylon", gx: -4.5, gz: -0.5, rot: 0 },

  // Grass tufts around the outside
  { model: "grass", gx: 8, gz: 1, rot: 30 },
  { model: "grass", gx: 8.5, gz: -1, rot: 120 },
  { model: "grass", gx: 8, gz: -8, rot: 45 },
  { model: "grass", gx: 8.5, gz: -10, rot: 200 },
  { model: "grass", gx: 4, gz: -12.5, rot: 80 },
  { model: "grass", gx: 0, gz: -12.5, rot: 160 },
  { model: "grass", gx: -3, gz: -12.5, rot: 40 },
  { model: "grass", gx: -6, gz: -10, rot: 290 },
  { model: "grass", gx: -6.5, gz: -1, rot: 110 },
  { model: "grass", gx: -6, gz: 2, rot: 170 },
  { model: "grass", gx: 5.5, gz: 2.5, rot: 60 },
  { model: "grass", gx: 1, gz: 3, rot: 230 },
  { model: "grass", gx: -1, gz: 3, rot: 310 },

  // Fences
  { model: "fenceStraight", gx: 7.2, gz: 1, rot: 0 },
  { model: "fenceStraight", gx: 7.2, gz: 0, rot: 0 },
  { model: "fenceStraight", gx: -5.2, gz: 1, rot: 0 },
  { model: "fenceStraight", gx: -5.2, gz: 0, rot: 0 },
];

// ── GLB renderer ────────────────────────────────────────────────────

function TilePiece({ model, position, rotation, scale }: {
  model: ModelKey;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}) {
  const { scene } = useGLTF(MODELS[model]);

  const fixed = useMemo(() => {
    const root = new THREE.Group();
    const clone = scene.clone(true);

    // calcula bounding box real do conteúdo
    const box = new THREE.Box3().setFromObject(clone);
    const center = box.getCenter(new THREE.Vector3());

    // move conteúdo para centro
    clone.position.sub(center);

    root.add(clone);
    return root;
  }, [scene]);

  return (
    <primitive
      object={fixed}
      position={position}
      rotation={rotation}
      scale={scale}
    />
  );
}

// ── Main component ──────────────────────────────────────────────────

interface RacingKitDecorProps {
  sampledTrack: THREE.Vector3[];
  trackWidth: number;
}

export function RacingKitDecor({ sampledTrack: _sampledTrack, trackWidth: _trackWidth }: RacingKitDecorProps) {
  const s = TILE_SIZE;

  // Convert grid-based tile definitions to world positions
  const allTiles = useMemo(() => {
    const result: { model: ModelKey; position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }[] = [];

    // Circuit road pieces
    for (const tile of CIRCUIT_TILES) {
      const rad = (tile.rot * Math.PI) / 180;
      result.push({
        model: tile.model,
        position: [
          (tile.gx + (tile.sx ?? 1) / 2) * s,
          0.0001,
          (tile.gz + (tile.sz ?? 1) / 2) * s,
        ],
        rotation: [0, rad, 0],
        scale: [s, s, s],
      });
    }

    // Decoration pieces — scale relative to tile size
    // Most Kenney decor pieces are 0.5-1.5 units. At s=20, we want them
    // to be visually appropriate (a grandstand ~15m tall, light post ~8m, etc.)
    const decorScales: Partial<Record<ModelKey, number>> = {
      grandStand: s * 0.4,       // ~8m tall
      grandStandRound: s * 0.4,
      billboard: s * 0.35,
      billboardLow: s * 0.3,
      lightPost: s * 0.35,       // ~7m tall
      lightModern: s * 0.35,
      flagCheckers: s * 0.25,
      flagGreen: s * 0.25,
      flagRed: s * 0.25,
      overhead: s * 0.5,         // arch over road, needs to be wide
      overheadRound: s * 0.5,
      pitsOffice: s * 0.35,
      pitsGarage: s * 0.35,
      pitsGarageClosed: s * 0.35,
      bannerGreen: s * 0.3,
      bannerRed: s * 0.3,
      pylon: s * 0.2,            // small cone
      grass: s * 0.25,
      fenceStraight: s * 0.3,
      rail: s * 0.3,
      barrierRed: s * 0.3,
      barrierWhite: s * 0.3,
      barrierWall: s * 0.3,
    };

    for (const tile of DECOR_TILES) {
      const rad = (tile.rot * Math.PI) / 180;
      const ds = decorScales[tile.model] ?? s * 0.3;
      result.push({
        model: tile.model,
        position: [
          (tile.gx + 0.5) * s,
          0.0001,
          (tile.gz + 0.5) * s,
        ],
        rotation: [0, rad, 0],
        scale: [ds, ds, ds],
      });
    }

    return result;
  }, [s]);

  return (
    <group>
      {allTiles.map((tile, i) => (
        <TilePiece key={i} {...tile} />
      ))}
    </group>
  );
}

// ── Preload critical models ─────────────────────────────────────────
const preloadModels = [
  MODELS.roadStraight,
  MODELS.roadStraightLong,
  MODELS.roadStraightLongMid,
  MODELS.roadStraightArrow,
  MODELS.roadStartPositions,
  MODELS.roadCornerLargeBorder,
  MODELS.roadCornerLargerBorder,
  MODELS.barrierWall,
  MODELS.lightPost,
  MODELS.lightModern,
  MODELS.grass,
  MODELS.pylon,
  MODELS.flagCheckers,
  MODELS.overhead,
  MODELS.grandStand,
  MODELS.grandStandRound,
  MODELS.billboard,
  MODELS.billboardLow,
  MODELS.pitsGarage,
  MODELS.pitsGarageClosed,
  MODELS.pitsOffice,
  MODELS.fenceStraight,
  MODELS.bannerGreen,
  MODELS.bannerRed,
  MODELS.flagCheckers,
  MODELS.roadEnd,
];
preloadModels.forEach((url) => useGLTF.preload(url));
