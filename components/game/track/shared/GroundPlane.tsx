"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { RigidBody, CuboidCollider } from "@react-three/rapier";

const GROUND_SUBDIVISIONS = 32;
const GROUND_COLOR_VARIATION = 0.3; // ±15% brightness
const GROUND_COLOR_BASE = 0.85;

// ── Seeded RNG ──────────────────────────────────────────────────────

function mulberry32(seed: number) {
    return function () {
        let t = (seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashSeed(str: string) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

interface GroundPlaneProps {
    grassColor: string;
    sizeX: number;
    sizeZ: number;
    seed?: string;
}

export function GroundPlane({ grassColor, sizeX, sizeZ, seed = "default" }: GroundPlaneProps) {
    const groundGeo = useMemo(() => {
        const geo = new THREE.PlaneGeometry(sizeX, sizeZ, GROUND_SUBDIVISIONS, GROUND_SUBDIVISIONS);
        const baseColor = new THREE.Color(grassColor);
        const count = geo.attributes.position.count;
        const colors = new Float32Array(count * 3);
        const rand = mulberry32(hashSeed(seed + "_ground"));

        for (let i = 0; i < count; i++) {
            const variation = GROUND_COLOR_BASE + rand() * GROUND_COLOR_VARIATION;
            colors[i * 3] = baseColor.r * variation;
            colors[i * 3 + 1] = baseColor.g * variation;
            colors[i * 3 + 2] = baseColor.b * variation;
        }

        geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        return geo;
    }, [sizeX, sizeZ, grassColor, seed]);

    return (
        <RigidBody type="fixed" colliders={false}>
            <CuboidCollider args={[sizeX / 2, 1, sizeZ / 2]} position={[0, -1, 0]} />
            <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow geometry={groundGeo}>
                <meshStandardMaterial vertexColors roughness={0.9} />
            </mesh>
        </RigidBody>
    );
}
