"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { KartRef } from "./KartPro";

interface RedShellProps {
    id: string;
    startPosition: [number, number, number];
    startRotation: number;
    ownerId: string; // The kart who fired it
    targetId: string | null; // ID of the kart to chase
    allKarts: Array<{ id: string; ref: React.RefObject<KartRef> }>;
    onCollide: (targetId: string, shellId: string) => void;
}

export function RedShell({ id, startPosition, startRotation, ownerId, targetId, allKarts, onCollide }: RedShellProps) {
    const groupRef = useRef<THREE.Group>(null);
    const positionRef = useRef<[number, number, number]>(startPosition);
    const rotationRef = useRef(startRotation);
    const speedRef = useRef(25); // Faster than base kart speed (usually)
    const activeRef = useRef(true);

    // Safety timer to despawn if it spins forever
    const lifeTimeRef = useRef(10);

    useFrame((state, delta) => {
        if (!activeRef.current) return;

        lifeTimeRef.current -= delta;
        if (lifeTimeRef.current <= 0) {
            onCollide("", id); // Just remove
            return;
        }

        const step = Math.min(delta, 0.05);

        // Find Target Reference
        let targetKart: KartRef | null = null;
        if (targetId) {
            const found = allKarts.find(k => k.id === targetId);
            if (found && found.ref.current) {
                targetKart = found.ref.current;
            }
        }

        // Homing Logic (Teleguiado)
        if (targetKart) {
            const targetPos = targetKart.getPosition();

            // Calculate direction to target
            const dx = targetPos[0] - positionRef.current[0];
            const dz = targetPos[2] - positionRef.current[2];
            const distSq = dx * dx + dz * dz;

            // Collision check (radius 2m → distSq < 4.0)
            if (distSq < 4.0) {
                onCollide(targetId!, id); // Hit!
                activeRef.current = false;
                return;
            }

            // Simple homing: Steer towards target
            const angleToTarget = Math.atan2(dx, dz);

            // Smooth rotation towards target (Turn speed)
            const turnSpeed = 4.0;
            let angleDiff = angleToTarget - rotationRef.current;

            // Normalize angle diff to -PI, PI
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

            const turnAmt = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), turnSpeed * step);
            rotationRef.current += turnAmt;

        } else {
            // No target? Just go straight and slow down
            speedRef.current *= 0.98;
        }

        // Move
        const dx = Math.sin(rotationRef.current) * speedRef.current * step;
        const dz = Math.cos(rotationRef.current) * speedRef.current * step;

        positionRef.current[0] += dx;
        positionRef.current[2] += dz;

        // Visual Updates
        if (groupRef.current) {
            groupRef.current.position.set(positionRef.current[0], positionRef.current[1], positionRef.current[2]);
            groupRef.current.rotation.y = rotationRef.current;

            // Spin the rocket body
            const rocketBody = groupRef.current.getObjectByName("rocket_body");
            if (rocketBody) {
                rocketBody.rotation.z += delta * 5;
            }

            // Pulse the flame
            const flame = groupRef.current.getObjectByName("rocket_flame");
            if (flame) {
                flame.scale.y = 1 + Math.sin(Date.now() * 0.01) * 0.3;
            }
        }
    });

    if (!activeRef.current) return null;

    return (
        <group ref={groupRef} position={startPosition}>
            {/* Rocket Body */}
            <mesh name="rocket_body" position={[0, 0.25, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.15, 0.2, 0.8, 8]} />
                <meshStandardMaterial color="#ff4444" roughness={0.3} metalness={0.6} />
            </mesh>
            {/* Rocket Nose Cone */}
            <mesh position={[0, 0.65, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <coneGeometry args={[0.15, 0.3, 8]} />
                <meshStandardMaterial color="#cc0000" roughness={0.2} metalness={0.8} />
            </mesh>
            {/* Rocket Fins */}
            <mesh position={[0.15, -0.1, 0]} rotation={[0, 0, Math.PI / 4]}>
                <boxGeometry args={[0.3, 0.02, 0.2]} />
                <meshStandardMaterial color="#ffffff" />
            </mesh>
            <mesh position={[-0.15, -0.1, 0]} rotation={[0, 0, -Math.PI / 4]}>
                <boxGeometry args={[0.3, 0.02, 0.2]} />
                <meshStandardMaterial color="#ffffff" />
            </mesh>
            {/* Rocket Flame/Exhaust */}
            <mesh name="rocket_flame" position={[0, -0.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <coneGeometry args={[0.12, 0.4, 6]} />
                <meshBasicMaterial color="#ff8800" transparent opacity={0.8} />
            </mesh>
        </group>
    );
}
