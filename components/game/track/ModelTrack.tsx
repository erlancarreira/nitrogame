"use client";

import { useGLTF } from "@react-three/drei";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { useMemo } from "react";

// Definição de collider extra: [halfX, halfY, halfZ, posX, posY, posZ]
export type ExtraCollider = [number, number, number, number, number, number];

interface ModelTrackProps {
    url: string;
    scale?: number;
    // Collider de chão: [halfX, halfZ, centerX, centerY, centerZ]
    groundCollider?: [number, number, number, number, number];
    // Colliders extras para paredes/barreiras (independentes do chão)
    extraColliders?: ExtraCollider[];
}

export function ModelTrack({ url, scale, groundCollider, extraColliders }: ModelTrackProps) {
    const { scene } = useGLTF(url);
    const s = scale || 1;

    // Clonar cena para evitar mutação de instância compartilhada
    const clonedScene = useMemo(() => scene.clone(true), [scene]);

    // Default: plano grande em Y=0, centro Z=-160
    const [hx, hz, cx, cy, cz] = groundCollider || [400, 400, 0, 0, -160];

    return (
        <group>
            <primitive object={clonedScene} scale={[s, s, s]} />

            {/* Collider de chão */}
            <RigidBody type="fixed" colliders={false}>
                <CuboidCollider
                    args={[hx, 0.5, hz]}
                    position={[cx, cy - 0.5, cz]}
                />
            </RigidBody>

            {/* Colliders extras (paredes, barreiras) */}
            {extraColliders && extraColliders.map(([ehx, ehy, ehz, epx, epy, epz], i) => (
                <RigidBody key={`extra-${i}`} type="fixed" colliders={false}>
                    <CuboidCollider
                        args={[ehx, ehy, ehz]}
                        position={[epx, epy, epz]}
                    />
                </RigidBody>
            ))}
        </group>
    );
}
