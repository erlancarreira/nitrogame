"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { useGLTF, Line } from "@react-three/drei";
import { MapConfig } from "@/lib/game/maps";
import { GroundPlane } from "./shared/GroundPlane";

const TILE_SIZE = 20;
const KIT_BASE_PATH = "/assets/kart-map/racing-kit/Models/GLTF format/";

interface TileDef {
    model: string;
    gx: number;       // grid X
    gz: number;       // grid Z
    rot: number;      // graus
    sx?: number;      // tamanho em grid
    sz?: number;
}

interface TileKitTrackProps {
    map: MapConfig;
    showArrows?: boolean;
    showCenterLine?: boolean;
}

// Lista de tiles de estrada (precisam de colisor)
const ROAD_TILES = new Set([
    'roadStraight', 'roadStraightLong', 'roadStraightArrow', 'roadStraightLongMid',
    'roadCornerSmall', 'roadCornerLarge', 'roadCornerLarger',
    'roadStart', 'roadStartPositions', 'roadEnd', 'roadBump', 'roadSide',
    'roadCornerSmallBorder', 'roadCornerLargeBorder', 'roadCornerLargerBorder',
    'roadCornerSmallWall', 'roadCornerLargeWall', 'roadCornerLargerWall',
    'roadStraightBridge', 'roadStraightBridgeMid', 'roadStraightBridgeStart',
    'roadCornerBridgeSmall', 'roadRamp', 'roadRampLong', 'ramp',
    'roadCurved', 'roadCurvedSplit', 'roadSplit', 'roadSplitLarge',
    'roadSplitLarger', 'roadSplitRound', 'roadSplitRoundLarge', 'roadSplitSmall',
    'roadRampWall', 'roadRampLongCurved', 'roadRampLongCurvedWall',
    'roadRampLongWall', 'roadPitEntry', 'roadPitStraight', 'roadPitStraightLong',
    'roadPitGarage', 'roadCrossing', 'roadStraightSkew', 'roadSide'
]);

export function TileKitTrack({ map, showArrows, showCenterLine }: TileKitTrackProps) {
    // Layout da pista (pode vir do mapa ou hardcoded para teste)
    const layout = useMemo(() => {
        // TODO: futuramente carregar de map.tileLayout
        // Por enquanto, usar layout de circuito padrão
        return generateCircuitLayout(map.trackType || 'circuit');
    }, [map]);

    // Calcular spline para center line e checkpoints
    const racingLine = useMemo(() => {
        return calculateRacingLine(layout, TILE_SIZE);
    }, [layout]);

    return (
        <group>
            {/* Tiles com colisores */}
            {layout.tiles.map((tile, i) => (
                <TileWithCollider
                    key={i}
                    tile={tile}
                    tileSize={TILE_SIZE}
                    basePath={KIT_BASE_PATH}
                />
            ))}

            {/* Decoração (sem colisor) */}
            {layout.decor.map((tile, i) => (
                <DecorTile
                    key={`decor-${i}`}
                    tile={tile}
                    tileSize={TILE_SIZE}
                    basePath={KIT_BASE_PATH}
                />
            ))}

            {/* Center line para navegação */}
            {showCenterLine && (
                <Line
                    points={racingLine.getPoints(100)}
                    color="#ffffff"
                    lineWidth={1}
                />
            )}

            {/* Terreno base */}
            <GroundPlane
                grassColor={map.grassColor}
                sizeX={layout.bounds}
                sizeZ={layout.bounds}
            />
        </group>
    );
}

// Tile de estrada com colisor físico
function TileWithCollider({ tile, tileSize, basePath }: {
    tile: TileDef;
    tileSize: number;
    basePath: string;
}) {
    const url = `${basePath}${tile.model}.glb`;
    const { scene } = useGLTF(url);

    const [position, rotation, scale] = useMemo(() => {
        const rad = (tile.rot * Math.PI) / 180;
        const pos = [
            (tile.gx + (tile.sx || 1) / 2) * tileSize,
            0,
            (tile.gz + (tile.sz || 1) / 2) * tileSize,
        ] as [number, number, number];
        const rot = [0, rad, 0] as [number, number, number];
        const scl = [tileSize, tileSize, tileSize] as [number, number, number];
        return [pos, rot, scl];
    }, [tile, tileSize]);

    // Calcular colisor baseado no bounding box
    const colliderData = useMemo(() => {
        const box = new THREE.Box3().setFromObject(scene);
        const size = new THREE.Vector3();
        box.getSize(size);

        // Ajuste para o centro do modelo
        const center = new THREE.Vector3();
        box.getCenter(center);

        return {
            size: [
                size.x * scale[0] / 2,
                size.y * scale[1] / 2,
                size.z * scale[2] / 2
            ] as [number, number, number],
            center: [
                center.x * scale[0],
                center.y * scale[1],
                center.z * scale[2]
            ] as [number, number, number]
        };
    }, [scene, scale]);

    // Ajustar posição para compensar o centro do modelo
    const adjustedPosition = useMemo(() => {
        // This is tough. GLTF models origins vary.
        // For now, assume origin is relatively centered or handled by scene
        // Use standard Rapier auto-collider or manual box?
        // Manual box is safer if models are well behaved.
        return position;
    }, [position]);

    const clonedScene = useMemo(() => {
        const clone = scene.clone();
        scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                mesh.castShadow = true;
                mesh.receiveShadow = true;
            }
        });
        return clone;
    }, [scene]);

    return (
        <group position={adjustedPosition} rotation={rotation}>
            <primitive object={clonedScene} scale={scale} />

            {/* Colidor físico */}
            <RigidBody type="fixed" colliders={false}>
                <CuboidCollider
                    args={colliderData.size}
                    position={[0, colliderData.size[1], 0]} // Approx center up
                />
            </RigidBody>
        </group>
    );
}

// Tile de decoração (sem colisor)
function DecorTile({ tile, tileSize, basePath }: {
    tile: TileDef;
    tileSize: number;
    basePath: string;
}) {
    const url = `${basePath}${tile.model}.glb`;
    const { scene } = useGLTF(url);

    const [position, rotation, scale] = useMemo(() => {
        const rad = (tile.rot * Math.PI) / 180;
        const pos = [
            (tile.gx + 0.5) * tileSize,
            0,
            (tile.gz + 0.5) * tileSize,
        ] as [number, number, number];
        const rot = [0, rad, 0] as [number, number, number];
        const scl = [tileSize * 0.3, tileSize * 0.3, tileSize * 0.3] as [number, number, number];
        return [pos, rot, scl];
    }, [tile, tileSize]);

    return (
        <primitive
            object={scene.clone()}
            position={position}
            rotation={rotation}
            scale={scale}
        />
    );
}

// Gerar layout de circuito padrão (PLACEHOLDER minimal)
function generateCircuitLayout(trackType: string): { tiles: TileDef[]; decor: TileDef[]; bounds: number } {
    const CIRCUIT_TILES: TileDef[] = [
        { model: 'roadStart', gx: 0, gz: 0, rot: 0 },
        { model: 'roadStraight', gx: 0, gz: 1, rot: 0 },
        { model: 'roadCornerLarge', gx: 0, gz: 2, rot: 0 },
        { model: 'roadStraight', gx: 1, gz: 2, rot: 90 },
        { model: 'roadCornerLarge', gx: 2, gz: 2, rot: 90 },
        { model: 'roadStraight', gx: 2, gz: 1, rot: 180 },
        { model: 'roadCornerLarge', gx: 2, gz: 0, rot: 180 },
        { model: 'roadStraight', gx: 1, gz: 0, rot: 270 },
        { model: 'roadCornerLarge', gx: 0, gz: 0, rot: 270 }, // wait this overlaps start
    ];

    // Simple simple loop
    const LOOP: TileDef[] = [
        { model: 'roadStart', gx: 0, gz: 0, rot: 0 },
        { model: 'roadStraight', gx: 0, gz: 1, rot: 0 },
        { model: 'roadCornerLarge', gx: 0, gz: 2, rot: 0 },
        { model: 'roadStraight', gx: 1, gz: 3, rot: 90 },
        { model: 'roadCornerLarge', gx: 2, gz: 3, rot: 90 },
        { model: 'roadStraight', gx: 3, gz: 2, rot: 180 },
        { model: 'roadCornerLarge', gx: 3, gz: 1, rot: 180 },
        { model: 'roadStraight', gx: 2, gz: 0, rot: 270 },
        { model: 'roadCornerLarge', gx: 1, gz: 0, rot: 270 },
    ];

    const DECOR_TILES: TileDef[] = [];

    return {
        tiles: LOOP,
        decor: DECOR_TILES,
        bounds: 400
    };
}

// Calcular racing line a partir dos tiles
function calculateRacingLine(layout: { tiles: TileDef[] }, tileSize: number): THREE.CatmullRomCurve3 {
    const points: THREE.Vector3[] = [];

    // Encontrar tiles de estrada e extrair pontos centrais
    for (const tile of layout.tiles) {
        if (!ROAD_TILES.has(tile.model)) continue;

        const x = (tile.gx + (tile.sx || 1) / 2) * tileSize;
        const z = (tile.gz + (tile.sz || 1) / 2) * tileSize;
        points.push(new THREE.Vector3(x, 0.1, z));
    }

    if (points.length < 2) {
        return new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 10)]);
    }

    return new THREE.CatmullRomCurve3(points, true);
}
