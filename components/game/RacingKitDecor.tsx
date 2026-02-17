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
  treeLarge: `${BASE}treeLarge.glb`,
  treeSmall: `${BASE}treeSmall.glb`,
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
  y?: number;       // height offset (default 0.0001)
}

// Layout inspired by the Kenney Racing Kit Sample.png
// Circuit goes: start straight → large right → back straight → large left →
// top straight → large right → bridge straight → large right → return to start
// Redesigned layout to match sample.png (Figure-8 with bridge)
// Bridge crosses at Y=6, Ground at Y=0.
const CIRCUIT_TILES: TileDef[] = [
  // ═══ BRIDGE SECTION (High, y=6) ═══
  // Crossing West-East over the center (Z=0)
  { model: "roadStraightBridge", gx: 0, gz: 0, rot: 90, y: 6 },
  { model: "roadStraightBridge", gx: -1, gz: 0, rot: 90, y: 6 },
  { model: "roadStraightBridge", gx: 1, gz: 0, rot: 90, y: 6 },

  // ═══ EAST RAMP & LOOP ═══
  // Ramp Down (East side) - High West -> Low East
  // Rot 270: Up-East (Right). Rot 90: Up-West (Left).
  // We want Up-West (to connect to bridge at gx=1).
  { model: "roadRampLong", gx: 2, gz: 0, rot: 90, y: 0 },

  // Turn South (Right Turn)
  // Enters from West (gx=3), Exits South (gz=2)
  { model: "roadCornerLarge", gx: 3, gz: 0, rot: 90, sx: 2, sz: 2, y: 0 },

  // South Straight (Heading South)
  { model: "roadStraightArrow", gx: 4, gz: 2, rot: 0, y: 0 },

  // Turn West (Right Turn)
  // Enters from North (gz=3), Exits West (gx=3)
  // Rot 180 (Ent +Z, Ex -X)
  { model: "roadCornerLarge", gx: 2, gz: 3, rot: 180, sx: 2, sz: 2, y: 0 },

  // West Straight (Bottom Leg)
  { model: "roadStraightLong", gx: 0, gz: 4, rot: 90, y: 0 },
  { model: "roadStraightLong", gx: -2, gz: 4, rot: 90, y: 0 },

  // Turn North (Right Turn)
  // Enters from East (gx=-1), Exits North (gz=3)
  // Rot 270 (Ent -X, Ex -Z)
  { model: "roadCornerLarge", gx: -4, gz: 2, rot: 270, sx: 2, sz: 2, y: 0 },

  // ═══ UNDERPASS (Northbound) ═══
  // Crossing Z=0 under the bridge
  { model: "roadStraightLong", gx: -3, gz: 0, rot: 0, y: 0 },
  // Start Line positioned before the bridge
  { model: "roadStartPositions", gx: -3, gz: -2, rot: 0, y: 0 },

  // ═══ WEST LOOP & RAMP ═══
  // Turn East (Right Turn)
  // Enters from South (gz=-3), Exits East (gx=-2)
  // Rot 0 (Ent -Z, Ex +X)
  { model: "roadCornerLarge", gx: -3, gz: -4, rot: 0, sx: 2, sz: 2, y: 0 },

  // Ramp Up (West side) - Low West -> High East
  // Rot 270: Up-East (Right).
  { model: "roadRampLong", gx: -2, gz: 0, rot: 270, y: 0 },
];

const DECOR_TILES: TileDef[] = [
  // Grandstands near the bridge and turns
  { model: "grandStand", gx: 1, gz: -2, rot: 180, y: 0 },
  { model: "grandStandRound", gx: 4, gz: -1, rot: 225, y: 0 },
  { model: "grandStand", gx: -4, gz: 0, rot: 90, y: 0 },

  // Pits along the underpass straight
  { model: "pitsGarage", gx: -5, gz: 0, rot: 90, y: 0 },
  { model: "pitsGarageClosed", gx: -5, gz: -1, rot: 90, y: 0 },
  { model: "pitsOffice", gx: -5, gz: 1, rot: 90, y: 0 },

  // Overheads
  { model: "overhead", gx: -3, gz: -2.5, rot: 0, y: 0 }, // Start Line Overhead

  // Billboards
  { model: "billboard", gx: 0, gz: 6, rot: 180, y: 0 },
  { model: "billboardLow", gx: 0, gz: -2, rot: 0, y: 6 }, // On the bridge?

  // Flags & Lights
  { model: "flagCheckers", gx: -3.5, gz: -2, rot: 0, y: 0 },
  { model: "flagCheckers", gx: -2.5, gz: -2, rot: 0, y: 0 },
  { model: "lightPost", gx: -1.5, gz: 0, rot: 90, y: 0 },
  { model: "lightPost", gx: -4.5, gz: 0, rot: 270, y: 0 },
  { model: "lightModern", gx: 0, gz: -1, rot: 0, y: 6 }, // Bridge light

  // Vegetation
  { model: "treeLarge", gx: 5, gz: 4, rot: 0, y: 0 },
  { model: "grass", gx: 5, gz: 4, rot: 45, y: 0 },
  { model: "grass", gx: -5, gz: 4, rot: 120, y: 0 },
  { model: "grass", gx: 2, gz: -3, rot: 10, y: 0 },

  // Fences
  { model: "fenceStraight", gx: -3, gz: 1.5, rot: 90, y: 0 },
  { model: "fenceStraight", gx: -3, gz: -3.5, rot: 90, y: 0 },
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
          tile.y ?? 0.0001,
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
      treeLarge: s * 0.5,
      treeSmall: s * 0.35,
    };

    for (const tile of DECOR_TILES) {
      const rad = (tile.rot * Math.PI) / 180;
      const ds = decorScales[tile.model] ?? s * 0.3;
      result.push({
        model: tile.model,
        position: [
          (tile.gx + 0.5) * s,
          tile.y ?? 0.0001,
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
