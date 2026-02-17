import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CarModel } from './CarModel';
import { PlayerNameTag } from './PlayerNameTag';
import * as THREE from 'three';
import { KART_MODEL_OFFSET } from '@/lib/game/engine-constants';
import { interpolator } from '@/lib/game/interpolator';

// Interpolation delay in ms — render remote entities this far behind real-time
// to ensure the buffer always has two snapshots to interpolate between.
// POS sent at 20Hz (50ms interval), so 150ms ≈ 3 packets of buffer.
const INTERPOLATION_DELAY_MS = 150;

interface RemoteKartProps {
    id: string;
    playerName?: string;
    initialPosition: [number, number, number];
    initialRotation: number;
    modelUrl: string;
    modelScale: number;
    color: string;
    onInterpolatedState?: (
        id: string,
        position: [number, number, number],
        rotation: number,
        speed: number,
        lapProgress: number
    ) => void;
}

/**
 * RemoteKart — Pure visual ghost for remote players.
 *
 * NO RigidBody, NO Rapier, NO netClock dependency.
 * Uses performance.now() as time source — the interpolator stores
 * `lt` (local receive time) on each snapshot, so interpolation is
 * fully independent of clock synchronization between clients.
 */
export const RemoteKart = React.memo(function RemoteKart({
    id,
    playerName,
    initialPosition,
    initialRotation,
    modelUrl,
    modelScale,
    color,
    onInterpolatedState,
}: RemoteKartProps) {
    const groupRef = useRef<THREE.Group>(null);
    const hasReceivedData = useRef(false);
    const _euler = useRef(new THREE.Euler(0, initialRotation, 0));

    useFrame(() => {
        if (!groupRef.current) return;

        // Use local monotonic time — no netClock dependency
        const renderTime = performance.now() - INTERPOLATION_DELAY_MS;

        const state = interpolator.getInterpolatedState(id, renderTime);

        if (state) {
            hasReceivedData.current = true;

            groupRef.current.position.set(
                state.position[0],
                state.position[1],
                state.position[2]
            );
            groupRef.current.rotation.set(0, state.rotation, 0);

            onInterpolatedState?.(
                id,
                [state.position[0], state.position[1], state.position[2]],
                state.rotation,
                state.speed,
                state.lapProgress
            );
        }
    });

    return (
        <group
            ref={groupRef}
            position={initialPosition}
            rotation={_euler.current}
        >
            <group position={KART_MODEL_OFFSET}>
                <CarModel url={modelUrl} scale={modelScale} color={color} />
                {playerName && <PlayerNameTag name={playerName} />}
            </group>
        </group>
    );
});
