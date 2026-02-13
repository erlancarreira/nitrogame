"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { KartRef } from "./KartPro";

interface BoostPadProps {
    position: [number, number, number];
    rotation?: number;
    kartRef: React.RefObject<KartRef>;
    onBoost: () => void;
}

export function BoostPad({ position, rotation = 0, kartRef, onBoost }: BoostPadProps) {
    const meshRef = useRef<THREE.Group>(null);
    const arrowsRef = useRef<THREE.Group>(null);
    const activeRef = useRef(true);
    const cooldownRef = useRef(0);

    useFrame((state, delta) => {
        // Animation
        if (arrowsRef.current) {
            arrowsRef.current.position.z = (state.clock.elapsedTime * 2) % 1 - 0.5;
        }

        // Texture/Material pulse
        if (meshRef.current) {
            // simple visual effect
        }

        // Collision Detection
        if (activeRef.current && kartRef.current) {
            const kartPos = kartRef.current.getPosition();

            // Simple distance check (assume boost pad is roughly 2x2 units size)
            // Pad is flat on ground, check X/Z distance
            const dx = kartPos[0] - position[0];
            const dz = kartPos[2] - position[2];
            const distSq = dx * dx + dz * dz;

            // Trigger radius approx 1.5 units
            if (distSq < 2.25) {
                onBoost();
                activeRef.current = false;
                cooldownRef.current = 2.0; // 2 seconds cooldown
            }
        }

        // Cooldown management
        if (!activeRef.current) {
            cooldownRef.current -= delta;
            if (cooldownRef.current <= 0) {
                activeRef.current = true;
            }
        }
    });

    return (
        <group position={position} rotation={[0, rotation, 0]}>
            {/* Base Pad */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0.02, 0]}>
                <planeGeometry args={[2.5, 3]} />
                <meshStandardMaterial
                    color="#ffaa00"
                    emissive="#ff4400"
                    emissiveIntensity={2}
                    transparent
                    opacity={0.8}
                />
            </mesh>

            {/* Moving Arrows Container */}
            <group position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <group ref={arrowsRef} rotation={[0, 0, -Math.PI / 2]}>
                    {/* Arrow 1 */}
                    <mesh position={[-0.8, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
                        <coneGeometry args={[0.4, 0.6, 3]} /> {/* Triangle */}
                        <meshBasicMaterial color="white" />
                    </mesh>
                    {/* Arrow 2 */}
                    <mesh position={[0, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
                        <coneGeometry args={[0.4, 0.6, 3]} />
                        <meshBasicMaterial color="white" />
                    </mesh>
                    {/* Arrow 3 */}
                    <mesh position={[0.8, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
                        <coneGeometry args={[0.4, 0.6, 3]} />
                        <meshBasicMaterial color="white" />
                    </mesh>
                </group>
            </group>

            {/* Glow effect */}
            <pointLight distance={3} intensity={2} color="#ffaa00" position={[0, 0.5, 0]} />
        </group>
    );
}
