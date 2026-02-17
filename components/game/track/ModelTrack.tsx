"use client";

import { useGLTF } from "@react-three/drei";
import { RigidBody, CuboidCollider } from "@react-three/rapier";

interface ModelTrackProps {
    url: string;
    scale?: number;
}

export function ModelTrack({ url, scale }: ModelTrackProps) {
    const { scene } = useGLTF(url);
    const s = scale || 1;
    return (
        <group>
            <primitive object={scene} scale={[s, s, s]} />
            <RigidBody type="fixed" colliders={false}>
                <CuboidCollider args={[1000 * s, 1, 1000 * s]} position={[0, -1, 0]} />
            </RigidBody>
        </group>
    );
}
