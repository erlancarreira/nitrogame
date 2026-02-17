"use client";

import React, { useMemo } from "react";
import * as THREE from "three";
import { RigidBody, HeightfieldCollider } from "@react-three/rapier";
import { TerrainConfig, TrackSpline, generateHeightMap } from "@/lib/game/track";

interface TerrainColliderProps {
    config: TerrainConfig;
    spline: TrackSpline;
}

export function TerrainCollider({ config, spline }: TerrainColliderProps) {
    const { heightData, segments } = useMemo(() => {
        const data = generateHeightMap(config, spline);
        return {
            heightData: data,
            segments: Math.floor(config.size * config.resolution)
        };
    }, [config, spline]);

    return (
        <RigidBody type="fixed" colliders={false}>
            <HeightfieldCollider
                args={[
                    segments,
                    segments,
                    heightData as unknown as number[],
                    new THREE.Vector3(config.size, 1, config.size)
                ]}
            />
        </RigidBody>
    );
}
