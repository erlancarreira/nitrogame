"use client";

import React, { useMemo } from "react";
import * as THREE from "three";
import { TerrainConfig, TrackSpline, generateHeightMap, createTerrainGeometry } from "@/lib/game/track";

interface TerrainMeshProps {
    config: TerrainConfig;
    spline: TrackSpline;
}

export function TerrainMesh({ config, spline }: TerrainMeshProps) {
    const { geometry, heightData, segments } = useMemo(() => {
        const data = generateHeightMap(config, spline);
        const geo = createTerrainGeometry(config, data);

        // Compute vertex colors based on height for simple shading
        const count = geo.attributes.position.count;
        const colors = new Float32Array(count * 3);
        const pos = geo.attributes.position;

        for (let i = 0; i < count; i++) {
            const y = pos.getY(i);
            // Simple gradient: low = dark, high = light/snow
            const t = Math.max(0, Math.min(1, (y + 10) / 40));
            const color = new THREE.Color().lerpColors(
                new THREE.Color("#2d5a27"), // Green
                new THREE.Color("#ffffff"), // Snow
                t
            );
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        return {
            geometry: geo,
            heightData: data,
            segments: Math.floor(config.size * config.resolution)
        };
    }, [config, spline]);

    return (
        <group>
            <mesh geometry={geometry} receiveShadow>
                <meshStandardMaterial vertexColors roughness={0.8} />
            </mesh>
        </group>
    );
}
