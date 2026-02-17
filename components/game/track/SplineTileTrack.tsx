"use client";

import React, { useMemo, useEffect } from "react";
import * as THREE from "three";
import { MapConfig } from "@/lib/game/maps";
import {
    createTrackSpline,
    PlacedTile,
    TileConfig,
    expandGrammar,
    interpretGrammar,
    TrackTemplate,
    generateTileGeometry,
    TEMPLATE_RAINBOW
} from "@/lib/game/track";
import { TileMesh } from "./TileMesh";
import { TerrainMesh } from "./TerrainMesh";
import { TileCollider } from "./TileCollider";
import { TerrainCollider } from "./TerrainCollider";

interface SplineTileTrackProps {
    map: MapConfig;
    showWaypoints?: boolean;
}

export function SplineTileTrack({ map, showWaypoints }: SplineTileTrackProps) {
    const { system, spline, tiles } = useMemo(() => {
        if (!map.trackSystem || map.trackSystem.type !== 'spline-tiles') return { system: null };

        // 1. Generate Logic Sequence (Grammar)
        let tileConfigs: any[] = [];

        // Check if pre-generated tiles exist
        if (map.trackSystem.tiles && map.trackSystem.tiles.length > 0) {
            // Already placed! Just need to extract control points from them if possible
            // But wait, our map config passes PlacedTile[] which ALREADY has transform/position.
            // We just need to rebuild the spline from them.

            // However, the current logic re-calculates positions from configs.
            // If we pass PlacedTile[], we can skip the turtle step OR we can reverse-engineer configs.

            // Let's assume for now we reuse the config if available, OR we trust the placed tiles.
            // To simplify integration with existing code below which uses 'tileConfigs', 
            // we will extract configs from placed tiles relative to a start.

            // ACTUALLY: The best way is to separate the path:
            // Path A: Generate from seed (grammar -> configs -> turtle -> tiles)
            // Path B: Use existing tiles (extract control points -> spline)

            // Let's modify the flow.
        }

        const preGeneratedTiles = map.trackSystem.tiles;
        const seedStr = map.trackSystem.seed || "default";
        const seed = seedStr.split('').reduce((a, b) => a + b.charCodeAt(0), 0);

        if (!preGeneratedTiles) {
            const grammarSymbols = expandGrammar(TEMPLATE_RAINBOW, seed);
            tileConfigs = interpretGrammar(grammarSymbols, { width: map.trackWidth }, seed);
        } else {
            // We have tiles. We can use their configs to re-turtle (ensures consistency) 
            // or just use their positions.
            // Since 'generateFromTemplate' returns PlacedTile[] with positions...
            // Let's just use the configs from them for now to let re-turtle happen purely
            // so this component controls the "turtle" logic centrally.
            // Ideally we shouldn't re-turtle if we passed positions.
            tileConfigs = preGeneratedTiles.map(t => t.config);
        }

        // 2. Build Physical Layout (Turtle Graphics style)
        // We need to generate the Control Points for the spline based on the tiles
        const controlPoints: THREE.Vector3[] = [];
        const placedTiles: PlacedTile[] = [];

        let currentPos = new THREE.Vector3(0, 0, 0);
        let currentDir = new THREE.Vector3(0, 0, 1); // Start facing +Z

        // Initial point
        controlPoints.push(currentPos.clone());
        let totalLength = 0;

        tileConfigs.forEach((config, i) => {
            const tileStart = currentPos.clone();
            const tileStartDir = currentDir.clone();

            let nextPos = currentPos.clone();
            let nextDir = currentDir.clone();

            if (config.type.includes('straight')) {
                nextPos.addScaledVector(currentDir, config.length);
            } else if (config.type.includes('curve_left')) {
                // 90 deg left turn approx
                // Move forward a bit, rotate, move forward
                const turnRadius = config.length / (Math.PI / 2);
                const axis = new THREE.Vector3(0, 1, 0);
                nextDir.applyAxisAngle(axis, Math.PI / 2); // Left = +90? standard is CCW
                // For simplicity in this jam: just move diagonal :)
                // Ideally: arc.

                // Let's just place a control point at the end
                nextPos.addScaledVector(currentDir, config.length * 0.6);
                nextPos.addScaledVector(nextDir, config.length * 0.6);
            } else if (config.type.includes('curve_right')) {
                const axis = new THREE.Vector3(0, 1, 0);
                nextDir.applyAxisAngle(axis, -Math.PI / 2);
                nextPos.addScaledVector(currentDir, config.length * 0.6);
                nextPos.addScaledVector(nextDir, config.length * 0.6);
            } else if (config.type.includes('hairpin')) {
                const axis = new THREE.Vector3(0, 1, 0);
                nextDir.applyAxisAngle(axis, Math.PI); // 180
                // Offset to side to avoid self-collision
                const side = new THREE.Vector3().crossVectors(currentDir, axis);
                nextPos.addScaledVector(side, 30);
            } else {
                // Default straight
                nextPos.addScaledVector(currentDir, config.length);
            }

            // Elevation
            nextPos.y += config.elevation;

            controlPoints.push(nextPos.clone());

            // Update state
            // We define the tile's range on the spline LATER after the full spline is built.
            // For now, we just store the config and provisional transforms.
            placedTiles.push({
                id: `tile-${i}`,
                config,
                transform: new THREE.Matrix4().compose(tileStart, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tileStartDir), new THREE.Vector3(1, 1, 1)),
                splineRange: { start: 0, end: 0 }, // Placeholder
                connections: {
                    entry: tileStart,
                    exit: nextPos.clone(),
                    entryTangent: tileStartDir,
                    exitTangent: nextDir.clone()
                }
            });

            currentPos = nextPos;
            currentDir = nextDir;
        });

        // 3. Create Spline
        // Closed loop? TEMPLATE_RAINBOW is open currently, but let's see.
        const spline = createTrackSpline("generated-spline", controlPoints, false);

        // 4. Map Tiles to Spline Ranges
        // We assume the spline length roughly matches sum of tile lengths (it won't exactly)
        // We map uniformly for this prototype or proportional to length.
        let currentT = 0;
        const totalSplineLen = spline.length;

        // Recalculate ranges based on actual spline geometry distance
        // This is tricky: spline distance != linear distance between control points.
        // But we simply divide t based on control point indices since CatmullRom passes through them.
        // With N points, we have N-1 segments (if open).

        const segmentCount = controlPoints.length - 1;

        placedTiles.forEach((tile, i) => {
            // Each tile corresponds to one segment between control points i and i+1
            tile.splineRange = {
                start: i / segmentCount,
                end: (i + 1) / segmentCount
            };
        });

        return { system: map.trackSystem, spline, tiles: placedTiles };
    }, [map]);

    if (!system || !spline) return null;

    return (
        <group>
            {/* Render Tiles Visuals */}
            {tiles?.map(tile => (
                <TileMesh key={`vis-${tile.id}`} tile={tile} spline={spline} debug={showWaypoints} />
            ))}

            {/* Render Tile Physics */}
            {tiles?.map(tile => (
                <TileCollider key={`col-${tile.id}`} tile={tile} spline={spline} />
            ))}

            {/* Render Terrain if enabled */}
            {(system.features?.terrain ?? true) && (
                <>
                    <TerrainMesh
                        spline={spline}
                        config={{
                            seed: system.seed || "terrain",
                            baseHeight: -20,
                            size: 1000,
                            resolution: 0.2,
                            splineInfluence: { flattenWidth: 20, blendDistance: 30 },
                            noiseLayers: [{ type: 'perlin', scale: 0.05, amplitude: 30, persistence: 0.5 }]
                        }}
                    />
                    <TerrainCollider
                        spline={spline}
                        config={{
                            seed: system.seed || "terrain",
                            baseHeight: -20,
                            size: 1000,
                            resolution: 0.2,
                            splineInfluence: { flattenWidth: 20, blendDistance: 30 },
                            noiseLayers: [{ type: 'perlin', scale: 0.05, amplitude: 30, persistence: 0.5 }]
                        }}
                    />
                </>
            )}

            {/* Debug Spline */}
            {showWaypoints && (
                <line>
                    <bufferGeometry>
                        <bufferAttribute
                            attach="attributes-position"
                            count={spline.curve.getPoints(200).length}
                            array={new Float32Array(spline.curve.getPoints(200).flatMap(v => [v.x, v.y + 2, v.z]))}
                            itemSize={3}
                            args={[new Float32Array(spline.curve.getPoints(200).flatMap(v => [v.x, v.y + 2, v.z])), 3]}
                        />
                    </bufferGeometry>
                    <lineBasicMaterial color="yellow" />
                </line>
            )}
        </group>
    );
}
