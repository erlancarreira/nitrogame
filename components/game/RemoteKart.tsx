import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, RapierRigidBody, CuboidCollider } from '@react-three/rapier';
import { CarModel } from './CarModel';
import { PlayerNameTag } from './PlayerNameTag';
import * as THREE from 'three';
import { COLLIDER_HALF_EXTENTS, COLLIDER_OFFSET, KART_MODEL_OFFSET } from '@/lib/game/engine-constants';
import { interpolator } from '@/lib/game/interpolator';
import { netClock } from '@/lib/netcode/netclock';
import { INTERPOLATION_DELAY_MS } from './NetworkInterpolationLoop';
import type { RacerState } from '@/hooks/use-race-state';

interface RemoteKartProps {
    id: string;
    playerName?: string;
    initialPosition: [number, number, number];
    initialRotation: number;
    modelUrl: string;
    modelScale: number;
    color: string;
    // We keep this prop if needed for non-positional data, but visuals come from interpolator
    racerStatesRef?: React.MutableRefObject<Map<string, RacerState>>;
}

/**
 * RemoteKart — Renders a remote player's kart.
 * 
 * DIRECT MODE: Reads directly from `interpolator` for maximum smoothness (60fps+),
 * bypassing React state or ref forwarding loops.
 */
export const RemoteKart = React.memo(function RemoteKart({
    id, playerName, initialPosition, initialRotation, modelUrl, modelScale, color
}: RemoteKartProps) {
    const mountPosition = useRef(initialPosition).current;
    const mountRotation = useRef(initialRotation).current;

    // Track if we have ever possessed valid data to avoid spawning at 0,0,0
    const hasReceivedData = useRef(false);

    const rigidBodyRef = useRef<RapierRigidBody>(null);

    // Reusable objects
    const _euler = useRef(new THREE.Euler());
    const _quat = useRef(new THREE.Quaternion());
    const _vec = useRef(new THREE.Vector3());

    useFrame(() => {
        if (!rigidBodyRef.current) return;

        const serverTime = netClock.now;
        if (serverTime <= 0) return;

        const renderTime = serverTime - INTERPOLATION_DELAY_MS;

        // Direct read from interpolator
        const state = interpolator.getInterpolatedState(id, renderTime);

        if (state) {
            hasReceivedData.current = true;

            // Apply visual transform
            _vec.current.set(state.position[0], state.position[1], state.position[2]);
            _euler.current.set(0, state.rotation, 0);
            _quat.current.setFromEuler(_euler.current);

            // Kinematic update is instant and smooth
            rigidBodyRef.current.setNextKinematicTranslation(_vec.current);
            rigidBodyRef.current.setNextKinematicRotation(_quat.current);
        }
    });

    return (
        <RigidBody
            ref={rigidBodyRef}
            type="kinematicPosition"
            name={id}
            position={mountPosition}
            rotation={[0, mountRotation, 0]}
            colliders={false}
        >
            <CuboidCollider
                args={COLLIDER_HALF_EXTENTS}
                position={COLLIDER_OFFSET}
            />
            <group position={KART_MODEL_OFFSET}>
                <CarModel url={modelUrl} scale={modelScale} color={color} />
                {playerName && <PlayerNameTag name={playerName} />}
            </group>
        </RigidBody>
    );
});
