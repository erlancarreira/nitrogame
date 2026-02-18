"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { useGLTF, Line } from "@react-three/drei";
import { MapConfig } from "@/lib/game/maps";
import { GroundPlane } from "./shared/GroundPlane";
import { TURBO_TILES, TURBO_DECOR } from "./turboLayout";

const TILE_SIZE = 20;
const KIT_BASE_PATH = "/assets/kart-map/racing-kit/Models/GLTF format/";

interface TileDef {
    model: string;
    gx: number;
    gz: number;
    rot: number;
    sx?: number;
    sz?: number;
    y?: number;
}

interface TileKitTrackProps {
    map: MapConfig;
    showArrows?: boolean;
    showCenterLine?: boolean;
}

// Tiles que são pista (usados para racing line / spline)
const ROAD_TILE_MODELS = new Set([
    'roadStraight', 'roadStraightLong', 'roadStraightArrow', 'roadStraightLongMid',
    'roadCornerSmall', 'roadCornerLarge', 'roadCornerLarger',
    'roadStart', 'roadStartPositions', 'roadEnd', 'roadBump',
    'roadCornerSmallBorder', 'roadCornerLargeBorder', 'roadCornerLargerBorder',
    'roadCurved', 'roadCurvedSplit', 'roadSplit', 'roadSplitLarge',
    'roadSplitLarger', 'roadSplitRound', 'roadSplitRoundLarge', 'roadSplitSmall',
    'roadPitEntry', 'roadCrossing', 'roadStraightSkew',
]);

export function TileKitTrack({ map, showArrows, showCenterLine }: TileKitTrackProps) {
    const layout = useMemo(() => generateCircuitLayout(map), [map]);

    const racingLine = useMemo(() => calculateRacingLine(layout, TILE_SIZE), [layout]);

    return (
        <group>
            {/* Tiles visuais da pista (sem colisor individual) */}
            {layout.tiles.map((tile, i) => (
                <RoadTileVisual
                    key={i}
                    tile={tile}
                    tileSize={TILE_SIZE}
                    basePath={KIT_BASE_PATH}
                />
            ))}

            {/* Colisor de chão único cobrindo toda a área da pista */}
            <TrackGroundCollider tiles={layout.tiles} tileSize={TILE_SIZE} />

            {/* Decoração (sem colisor) */}
            {layout.decor.map((tile, i) => (
                <DecorTile
                    key={`decor-${i}`}
                    tile={tile}
                    tileSize={TILE_SIZE}
                    basePath={KIT_BASE_PATH}
                />
            ))}

            {showCenterLine && (
                <Line
                    points={racingLine.getPoints(100)}
                    color="#ffff00"
                    lineWidth={2}
                />
            )}

            {/* Terreno base (grama) */}
            <GroundPlane
                grassColor={map.grassColor}
                sizeX={layout.bounds}
                sizeZ={layout.bounds}
            />
        </group>
    );
}

// Renderiza o tile visualmente, sem colisor (apenas visual)
function RoadTileVisual({ tile, tileSize, basePath }: {
    tile: TileDef;
    tileSize: number;
    basePath: string;
}) {
    const url = `${basePath}${tile.model}.glb`;
    const { scene } = useGLTF(url);

    const [position, rotation, scale] = useMemo(() => {
        const sx = tile.sx || 1;
        const sz = tile.sz || 1;
        const rad = (tile.rot * Math.PI) / 180;
        const pos: [number, number, number] = [
            (tile.gx + sx / 2) * tileSize,
            tile.y ?? 0,
            (tile.gz + sz / 2) * tileSize,
        ];
        const rot: [number, number, number] = [0, rad, 0];
        // Escalar X e Z proporcionalmente ao tamanho do tile em grid
        const scl: [number, number, number] = [sx * tileSize, tileSize, sz * tileSize];
        return [pos, rot, scl];
    }, [tile, tileSize]);

    const clonedScene = useMemo(() => {
        const clone = scene.clone(true);
        clone.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                mesh.castShadow = true;
                mesh.receiveShadow = true;
            }
        });
        return clone;
    }, [scene]);

    return (
        <primitive object={clonedScene} position={position} rotation={rotation} scale={scale} />
    );
}

// Colisor de chão único: um único RigidBody plano para cada tile de pista.
// Usa halfY=0.3 para ser um "tapete" fino — o kart anda em cima, não bate em paredes invisíveis.
function TrackGroundCollider({ tiles, tileSize }: { tiles: TileDef[]; tileSize: number }) {
    const colliders = useMemo(() => {
        return tiles.map((tile, i) => {
            const sx = tile.sx ?? 1;
            const sz = tile.sz ?? 1;
            const cx = (tile.gx + sx / 2) * tileSize;
            const cz = (tile.gz + sz / 2) * tileSize;
            const halfX = (sx * tileSize) / 2;
            const halfZ = (sz * tileSize) / 2;
            return { cx, cz, halfX, halfZ, i };
        });
    }, [tiles, tileSize]);

    return (
        <RigidBody type="fixed" colliders={false} friction={1} restitution={0}>
            {colliders.map(({ cx, cz, halfX, halfZ, i }) => (
                <CuboidCollider
                    key={i}
                    args={[halfX, 0.3, halfZ]}
                    position={[cx, 0.0, cz]}
                />
            ))}
        </RigidBody>
    );
}

// Tile de decoração (visual only, sem colisor)
function DecorTile({ tile, tileSize, basePath }: {
    tile: TileDef;
    tileSize: number;
    basePath: string;
}) {
    const url = `${basePath}${tile.model}.glb`;
    const { scene } = useGLTF(url);

    const [position, rotation, scale] = useMemo(() => {
        const rad = (tile.rot * Math.PI) / 180;
        const pos: [number, number, number] = [
            (tile.gx + 0.5) * tileSize,
            tile.y ?? 0,
            (tile.gz + 0.5) * tileSize,
        ];
        const rot: [number, number, number] = [0, rad, 0];

        // Escalas baseadas nas proporções do Kenney Racing Kit (TILE_SIZE=20m)
        const decorScales: Record<string, number> = {
            // Road tiles usados como decoração (pit lane)
            roadPitStraight:           tileSize,
            roadPitStraightLong:       tileSize,
            roadPitGarage:             tileSize,
            // Pits
            pitsGarage:                tileSize * 0.38,
            pitsGarageClosed:          tileSize * 0.38,
            pitsGarageCorner:          tileSize * 0.38,
            pitsOffice:                tileSize * 0.38,
            pitsOfficeCorner:          tileSize * 0.38,
            pitsOfficeRoof:            tileSize * 0.38,
            // Arquibancadas
            grandStand:                tileSize * 0.42,
            grandStandCovered:         tileSize * 0.42,
            grandStandCoveredRound:    tileSize * 0.42,
            grandStandAwning:          tileSize * 0.42,
            grandStandRound:           tileSize * 0.42,
            // Tendas
            tent:                      tileSize * 0.35,
            tentClosed:                tileSize * 0.35,
            tentClosedLong:            tileSize * 0.35,
            tentLong:                  tileSize * 0.35,
            tentRoof:                  tileSize * 0.35,
            tentRoofDouble:            tileSize * 0.35,
            // Iluminação
            lightPostLarge:            tileSize * 0.38,
            lightPostModern:           tileSize * 0.38,
            lightColored:              tileSize * 0.3,
            lightRed:                  tileSize * 0.3,
            lightRedDouble:            tileSize * 0.3,
            overhead:                  tileSize * 0.5,
            overheadLights:            tileSize * 0.5,
            overheadRound:             tileSize * 0.5,
            overheadRoundColored:      tileSize * 0.5,
            // Banners / placas
            bannerTowerRed:            tileSize * 0.32,
            bannerTowerGreen:          tileSize * 0.32,
            billboard:                 tileSize * 0.38,
            billboardDouble_exclusive: tileSize * 0.38,
            billboardLow:              tileSize * 0.32,
            billboardLower:            tileSize * 0.32,
            // Bandeiras
            flagCheckers:              tileSize * 0.28,
            flagCheckersSmall:         tileSize * 0.22,
            flagGreen:                 tileSize * 0.25,
            flagRed:                   tileSize * 0.25,
            flagTankco:                tileSize * 0.25,
            // Barreiras / cercas
            barrierRed:                tileSize * 0.32,
            barrierWhite:              tileSize * 0.32,
            barrierWall:               tileSize * 0.32,
            fenceStraight:             tileSize * 0.32,
            fenceCurved:               tileSize * 0.32,
            rail:                      tileSize * 0.32,
            railDouble:                tileSize * 0.32,
            pylon:                     tileSize * 0.22,
            // Carros
            raceCarRed:                tileSize * 0.45,
            raceCarOrange:             tileSize * 0.45,
            raceCarGreen:              tileSize * 0.45,
            raceCarWhite:              tileSize * 0.45,
            // Vegetação
            treeLarge:                 tileSize * 0.55,
            treeSmall:                 tileSize * 0.4,
            grass:                     tileSize * 0.28,
        };

        const ds = decorScales[tile.model] ?? (tileSize * 0.35);
        const scl: [number, number, number] = [ds, ds, ds];
        return [pos, rot, scl];
    }, [tile, tileSize]);

    return (
        <primitive
            object={scene.clone(true)}
            position={position}
            rotation={rotation}
            scale={scale}
        />
    );
}

// Gerar layout de circuito
function generateCircuitLayout(map: MapConfig): { tiles: TileDef[]; decor: TileDef[]; bounds: number } {
    if (map.id === 'turbo-speedway') {
        const tiles = TURBO_TILES;
        const decor = TURBO_DECOR;

        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        for (const t of [...tiles, ...decor]) {
            const sx = t.sx || 1;
            const sz = t.sz || 1;
            minX = Math.min(minX, t.gx);
            maxX = Math.max(maxX, t.gx + sx);
            minZ = Math.min(minZ, t.gz);
            maxZ = Math.max(maxZ, t.gz + sz);
        }
        const width = (maxX - minX) * TILE_SIZE;
        const depth = (maxZ - minZ) * TILE_SIZE;
        const bounds = Math.max(width, depth) + 500;

        return { tiles, decor, bounds };
    }

    // Fallback — circuito oval simples
    const LOOP: TileDef[] = [
        { model: 'roadStart',       gx: 1, gz: 0, rot: 90 },
        { model: 'roadStraight',    gx: 2, gz: 0, rot: 90 },
        { model: 'roadCornerLarge', gx: 3, gz: 0, rot: 270 },
        { model: 'roadStraight',    gx: 3, gz: 1, rot: 0 },
        { model: 'roadCornerLarge', gx: 3, gz: 2, rot: 90 },
        { model: 'roadStraight',    gx: 2, gz: 2, rot: 90 },
        { model: 'roadCornerLarge', gx: 1, gz: 2, rot: 180 },
        { model: 'roadStraight',    gx: 1, gz: 1, rot: 0 },
        { model: 'roadCornerLarge', gx: 1, gz: 0, rot: 0 },
    ];
    return { tiles: LOOP, decor: [], bounds: 400 };
}

// Calcular racing line a partir dos tiles (na ordem em que aparecem no array)
function calculateRacingLine(layout: { tiles: TileDef[] }, tileSize: number): THREE.CatmullRomCurve3 {
    const points: THREE.Vector3[] = [];

    for (const tile of layout.tiles) {
        if (!ROAD_TILE_MODELS.has(tile.model)) continue;
        const x = (tile.gx + (tile.sx || 1) / 2) * tileSize;
        const z = (tile.gz + (tile.sz || 1) / 2) * tileSize;
        points.push(new THREE.Vector3(x, 0.1, z));
    }

    if (points.length < 2) {
        return new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 10)]);
    }

    return new THREE.CatmullRomCurve3(points, true);
}
