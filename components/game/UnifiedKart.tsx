"use client";

import { forwardRef, useRef, useImperativeHandle, useMemo } from "react";
import { RigidBody, CuboidCollider, RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import type { Controls } from "@/lib/game/types";
import type { MapConfig } from "@/lib/game/maps";
import { CarModel } from "./CarModel";
import { KartDriftSmoke, getRearWheelPositions } from "./KartEffects";
import { PlayerNameTag } from "./PlayerNameTag";
import { useLocalKartBehavior } from "@/hooks/useLocalKartBehavior";
import { useBotKartBehavior } from "@/hooks/useBotKartBehavior";
import { useRemoteKartBehavior } from "@/hooks/useRemoteKartBehavior";
import { type KartPresetId, type KartPhysicsConfig, PRESET_STANDARD, KART_PRESETS } from "@/lib/game/physics-presets";
import { useNetworkPrediction } from "@/hooks/useNetworkPrediction";



export const UnifiedKart = forwardRef<UnifiedKartRef, UnifiedKartProps>(function UnifiedKart(
    {
        id,
        mode,
        playerName,
        playerColor,
        startPosition,
        initialRotation = 0,
        modelUrl = "/assets/cars/kart.glb",
        modelScale = 1,
        controls,
        touchControlsRef,
        raceStarted = false,
        map,
        botDifficulty = "medium",
        remoteDataRef,
        physicsPreset,
        onSpeedChange,
        onPositionUpdate,
        onKartTransformChange,
        onEffectsUpdate,
    },
    ref
) {
    const bodyRef = useRef<RapierRigidBody>(null);
    const groupRef = useRef<THREE.Group>(null);

    const preset = useMemo(() => {
        if (!physicsPreset) return PRESET_STANDARD;
        if (typeof physicsPreset === "string") {
            return KART_PRESETS[physicsPreset] ?? PRESET_STANDARD;
        }
        return physicsPreset;
    }, [physicsPreset]);

    const network = useNetworkPrediction(id, startPosition, mode === "local");

    // Refs para callbacks expostos via imperative handle
    const boostRef = useRef<(strength?: number, duration?: number) => void>();
    const starRef  = useRef<(duration?: number) => void>();
    const oilRef   = useRef<(duration?: number) => void>();
    const spinRef  = useRef<() => void>();

    useImperativeHandle(ref, () => ({
        getPosition: () => {
            const body = bodyRef.current;
            if (!body) return [0, 0, 0];
            const t = body.translation();
            return [t.x, t.y, t.z];
        },
        getRotation: () => {
            const body = bodyRef.current;
            if (!body) return 0;
            const q = body.rotation();
            const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w), "YZX");
            return e.y;
        },
        getGroup: () => groupRef.current,
        applyBoost: (s, d) => boostRef.current?.(s, d),
        applyStarPower: (d) => starRef.current?.(d),
        applyOilSlip: (d) => oilRef.current?.(d),
        spinOut: () => spinRef.current?.(),
    }), []);

    // Behaviors
    useLocalKartBehavior({
        enabled: mode === "local",
        bodyRef,
        groupRef,
        startPosition,
        initialRotation,
        preset,
        controls,
        touchControlsRef,
        raceStarted,
        network,
        onSpeedChange,
        onPositionUpdate,
        onKartTransformChange,
        onEffectsUpdate,
        boostRef,
        starRef,
        oilRef,
        spinRef,
    });

    useBotKartBehavior({
        enabled: mode === "bot",
        bodyRef,
        groupRef,
        startPosition,
        initialRotation,
        preset,
        map,
        botDifficulty,
        raceStarted,
        onPositionUpdate,
        onKartTransformChange,
        onEffectsUpdate,
        boostRef,
        starRef,
        oilRef,
        spinRef,
    });

    useRemoteKartBehavior({
        enabled: mode === "remote",
        bodyRef,
        groupRef,
        startPosition,
        initialRotation,
        remoteDataRef,
        id,
        onKartTransformChange,
    });

    const isRemote = mode === "remote";

    return (
        <RigidBody
            ref={bodyRef}
            name={id}
            position={startPosition}
            rotation={[0, initialRotation, 0]}
            type={isRemote ? "kinematicPosition" : "dynamic"}
            colliders={false}
            mass={1.0}
            lockRotations
            gravityScale={0}
            linearDamping={2}
            angularDamping={5}
        >
            <CuboidCollider
                args={[0.5, 0.3, 0.8]}
                position={[0, 0.3, 0]}
                friction={0.5}
                restitution={0}
            />
            <group ref={groupRef}>
                <CarModel url={modelUrl} scale={modelScale} />
                <KartDriftSmoke
                    slipRatioRef={{ current: 0 }}
                    rearWheelPositions={getRearWheelPositions(modelUrl)}
                />
                {playerName && <PlayerNameTag name={playerName} color={playerColor} />}
            </group>
        </RigidBody>
    );
});
