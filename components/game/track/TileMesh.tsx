"use client";

import React, { useMemo } from "react";
import * as THREE from "three";
import { PlacedTile, generateTileGeometry } from "@/lib/game/track";
import { TrackSpline } from "@/lib/game/track/spline";

interface TileMeshProps {
    tile: PlacedTile;
    spline: TrackSpline;
    debug?: boolean;
}

export function TileMesh({ tile, spline, debug }: TileMeshProps) {
    const { geometry, meshGeometry } = useMemo(() => {
        // Generate raw vertex data
        const data = generateTileGeometry(tile, spline, 20); // 20 segments per tile

        // Create Three.js geometry for rendering
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
        geo.setIndex(data.indices);

        return {
            geometry: data,
            meshGeometry: geo
        };
    }, [tile, spline]);

    // Material depending on tile type/surface
    // Rainbow road style!
    const material = useMemo(() => {
        return new THREE.MeshStandardMaterial({
            color: new THREE.Color().setHSL(Math.random(), 0.8, 0.5),
            roughness: 0.2,
            metalness: 0.8,
            emissive: new THREE.Color().setHSL(Math.random(), 1, 0.5),
            emissiveIntensity: 0.2
        });
    }, []);

    return (
        <group>
            <mesh geometry={meshGeometry} material={material} castShadow receiveShadow />



            {debug && (
                <group position={[0, 5, 0]}>
                    <mesh>
                        <sphereGeometry args={[0.5]} />
                        <meshBasicMaterial color="red" />
                    </mesh>
                </group>
            )}
        </group>
    );
}
