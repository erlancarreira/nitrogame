"use client";

import { useRef, useEffect, forwardRef, useImperativeHandle, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, CuboidCollider, RapierRigidBody, useRapier } from "@react-three/rapier";
import * as THREE from "three";
import type { Controls } from "@/lib/game/types";
import { CarModel } from "./CarModel";
import type { MapConfig } from "@/lib/game/maps";
import { TrackSpline } from "@/lib/game/track-path";
import { PRESET_STANDARD, type KartPhysicsConfig, type KartPresetId, KART_PRESETS } from "@/lib/game/physics-presets";
import { KartDriftSmoke, getRearWheelPositions } from "./KartEffects";
import { PlayerNameTag } from "./PlayerNameTag";
import { COLLIDER_HALF_EXTENTS, COLLIDER_OFFSET, MAX_DELTA, POSITION_UPDATE_INTERVAL, SPAWN_Y_OFFSET, KART_MODEL_OFFSET, PHYSICS_TIMESTEP } from '@/lib/game/engine-constants';
import { useNetworkPrediction } from "@/hooks/useNetworkPrediction";

// ── Types ───────────────────────────────────────────────────────────

interface KartProps {
    id: string;
    playerName?: string;
    playerColor?: string;
    position?: [number, number, number];
    initialRotation?: number;
    modelUrl?: string;
    modelScale?: number;
    controls: Controls;
    map?: MapConfig;
    raceStarted?: boolean;
    physicsPreset?: KartPresetId | KartPhysicsConfig;
    onSpeedChange?: (speed: number) => void;
    onPositionUpdate?: (
        id: string,
        position: [number, number, number],
        rotation: number,
        speed: number,
        lapProgress: number
    ) => void;
    onKartTransformChange?: (position: [number, number, number], rotation: number) => void;
    onEffectsUpdate?: (effects: {
        isDrifting: boolean;
        isBoosting: boolean;
        boostStrength: number;
        driftTier: number;
    }) => void;
    touchControlsRef?: React.RefObject<Controls>;
    /** Se este kart representa o jogador local (aplica prediction) */
    isLocalPlayer?: boolean;
}

export interface KartRef {
    getPosition: () => [number, number, number];
    getRotation: () => number;
    getGroup: () => THREE.Group | null;
    applyBoost: (strength?: number, duration?: number) => void;
    applyStarPower: (duration?: number) => void;
    applyOilSlip: (duration?: number) => void;
    spinOut: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────

// ── Component ───────────────────────────────────────────────────────

export const KartPro = forwardRef<KartRef, KartProps>(({
    id,
    playerName,
    playerColor,
    position = [0, 0, 0],
    initialRotation = 0,
    modelUrl = "/assets/cars/kart.glb",
    modelScale = 1,
    physicsPreset,
    controls: controlsProp,
    map,
    raceStarted = false,
    onSpeedChange,
    onPositionUpdate,
    onKartTransformChange,
    onEffectsUpdate,
    touchControlsRef,
    isLocalPlayer,
}, ref) => {
    const rigidBodyRef = useRef<RapierRigidBody>(null);
    const groupRef = useRef<THREE.Group>(null);
    const controlsRef = useRef<Controls>({ ...controlsProp });

    // Physics state (manually simulated for full stability)
    const currentSpeed = useRef(0);
    const currentRotation = useRef(initialRotation);
    const boostStrength = useRef(1);
    const isDrifting = useRef(false);
    const slipRatioRef = useRef(0);
    const steeringValRef = useRef(0);

    // Drift state
    const driftTime = useRef(0);          // tempo acumulado em drift
    const driftDirection = useRef(0);     // -1=esquerda, +1=direita, 0=sem drift
    const driftSlideAngle = useRef(0);    // ângulo lateral acumulado do slide
    const wasDrifting = useRef(false);     // para detectar soltar drift

    // Item Effects
    const isInvincible = useRef(false);
    const isOilSlipping = useRef(false);
    const oilSlipTime = useRef(0);
    const isSpinningOut = useRef(false);
    const spinOutTime = useRef(0);
    const spinOutDuration = 1.2; // seconds — full spin animation length

    // Timer cleanup tracking
    const activeTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
    const boostTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const starTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const safeTimeout = (fn: () => void, ms: number) => {
        const id = setTimeout(() => {
            activeTimers.current.delete(id);
            fn();
        }, ms);
        activeTimers.current.add(id);
        return id;
    };

    // Reusable objects to avoid GC pressure in useFrame
    const _quat = useRef(new THREE.Quaternion());
    const _axis = useRef(new THREE.Vector3(0, 1, 0));
    // Track spline for lap progress (industry-standard spline projection)
    const trackSplineRef = useRef<TrackSpline | null>(null);
    const progressRef = useRef(0);

    // Resolve physics preset (per-vehicle tuning)
    const preset = useMemo<KartPhysicsConfig>(() => {
        if (!physicsPreset) return PRESET_STANDARD;
        if (typeof physicsPreset === "string") {
            return KART_PRESETS[physicsPreset] ?? PRESET_STANDARD;
        }
        return physicsPreset;
    }, [physicsPreset]);

    // Destructure constants for use inside tight loops
    const MAX_SPEED = preset.maxSpeed;
    const ACCEL = preset.acceleration;
    const BRAKE = preset.brakeForce;
    const TURN_SPEED = preset.turnSpeed;
    const DRAG = preset.drag;
    const DRIFT_SPEED_THRESHOLD = preset.driftSpeedThreshold;
    const DRIFT_TURN_BONUS = preset.driftTurnBonus;
    const DRIFT_SLIDE_FACTOR = preset.driftSlideFactor;
    const DRIFT_BOOST_Tiers = preset.driftBoostTiers;
    const DRIFT_BOOST_SPEEDS = preset.driftBoostSpeeds;
    const DRIFT_BOOST_DURATION = preset.driftBoostDuration;
    const REVERSE_SPEED_RATIO = preset.reverseSpeedRatio;
    const SPEED_FACTOR_DIVISOR = preset.speedFactorDivisor;
    const MIN_TURN_SPEED = preset.minTurnSpeed;
    const BODY_MASS = preset.mass;

    // Network prediction hook (usado apenas para o jogador local)
    const network = useNetworkPrediction(id, position, initialRotation, !!isLocalPlayer);

    // Raycast Suspension Constants
    const GROUND_RAY_OFFSET = 1.0;
    const GROUND_RAY_RANGE = 3.0;
    const HOVER_HEIGHT = 0.35; // Target height above ground (Collider center is at 0.3)
    const SPRING_STIFFNESS = 20.0;

    // Rapier World for Raycasting
    const { world, rapier } = useRapier();
    const rayRef = useRef<InstanceType<typeof rapier.Ray> | null>(null);
    const getRay = () => {
        if (!rayRef.current) rayRef.current = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
        return rayRef.current;
    };

    useEffect(() => {
        controlsRef.current = { ...controlsProp };
        // Merge analog values from touch ref (not synced via React state)
        if (touchControlsRef?.current) {
            controlsRef.current.steerX = touchControlsRef.current.steerX;
            controlsRef.current.throttleY = touchControlsRef.current.throttleY;
        }
    }, [controlsProp, touchControlsRef]);

    useEffect(() => {
        if (map) trackSplineRef.current = new TrackSpline(map);
    }, [map]);

    useImperativeHandle(ref, () => ({
        getPosition: () => {
            if (!rigidBodyRef.current) return [0, 0, 0];
            const t = rigidBodyRef.current.translation();
            return [t.x, t.y, t.z];
        },
        getRotation: () => currentRotation.current,
        getGroup: () => groupRef.current,
        applyBoost: (strength = 1.5, duration = 2) => {
            // Cancel previous boost timeout to prevent premature reset
            if (boostTimeoutRef.current) {
                clearTimeout(boostTimeoutRef.current);
                activeTimers.current.delete(boostTimeoutRef.current);
            }
            boostStrength.current = strength;
            boostTimeoutRef.current = safeTimeout(() => {
                boostStrength.current = 1;
                boostTimeoutRef.current = null;
            }, duration * 1000);
        },
        applyStarPower: (duration = 8) => {
            // Cancel previous star timeout to prevent premature reset
            if (starTimeoutRef.current) {
                clearTimeout(starTimeoutRef.current);
                activeTimers.current.delete(starTimeoutRef.current);
            }
            isInvincible.current = true;
            boostStrength.current = 1.3; // Speed boost constant
            starTimeoutRef.current = safeTimeout(() => {
                isInvincible.current = false;
                boostStrength.current = 1;
                starTimeoutRef.current = null;
            }, duration * 1000);
        },
        applyOilSlip: (duration = 2.5) => {
            if (isInvincible.current) return;
            isOilSlipping.current = true;
            oilSlipTime.current = 0;
            safeTimeout(() => { isOilSlipping.current = false; }, duration * 1000);
        },
        spinOut: () => {
            if (isInvincible.current || isSpinningOut.current) return;
            isSpinningOut.current = true;
            spinOutTime.current = 0;
            currentSpeed.current *= 0.1; // Kill most speed but not all (feels better than hard stop)
        },
    }));

    const accumulator = useRef(0);
    const lastUpdateTime = useRef(0);

    useFrame((state, delta) => {
        const body = rigidBodyRef.current;
        if (!body) return;

        // --- Network Prediction (Remote Ghost Mode) ---
        // If this component is somehow used for a remote player (not recommended), 
        // disable physics and rely on updates.
        if (!isLocalPlayer) {
            return;
        }

        // 0. Pre-race grid logic (keep simple, no physics loop needed)
        if (!raceStarted) {
            const vel = body.linvel();
            const clampedVy = Math.max(vel.y, -5);
            body.setLinvel({ x: 0, y: clampedVy, z: 0 }, true);
            body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            _quat.current.setFromAxisAngle(_axis.current, currentRotation.current);
            body.setRotation(_quat.current, true);

            if (isDrifting.current) {
                isDrifting.current = false;
                driftTime.current = 0;
                driftDirection.current = 0;
                driftSlideAngle.current = 0;
                slipRatioRef.current = 0;
                onEffectsUpdate?.({ isDrifting: false, isBoosting: boostStrength.current > 1, boostStrength: boostStrength.current, driftTier: 0 });
            }

            const t = body.translation();
            onKartTransformChange?.([t.x, t.y, t.z], currentRotation.current);

            // Send position updates for grid alignment (robust clock check)
            const elapsed = state.clock.getElapsedTime();
            if (elapsed - lastUpdateTime.current >= POSITION_UPDATE_INTERVAL) {
                lastUpdateTime.current = elapsed;
                if (trackSplineRef.current) {
                    progressRef.current = trackSplineRef.current.project(t.x, t.z, progressRef.current);
                }
                onPositionUpdate?.(id, [t.x, t.y, t.z], currentRotation.current, 0, progressRef.current);
            }
            return;
        }

        const input = controlsRef.current;
        if (touchControlsRef?.current) {
            input.steerX = touchControlsRef.current.steerX;
            input.throttleY = touchControlsRef.current.throttleY;
        }

        // 1. Accumulate Time
        accumulator.current += Math.min(delta, 0.1); // Clamp to 100ms

        // --- INPUT LOGIC (Read once per frame) ---
        let throttle = 0;
        let turn = 0;

        const inputState = controlsRef.current;
        if (touchControlsRef?.current) {
            inputState.steerX = touchControlsRef.current.steerX;
            inputState.throttleY = touchControlsRef.current.throttleY;
        }

        if (inputState.throttleY !== undefined && inputState.throttleY !== 0) {
            throttle = inputState.throttleY;
        } else {
            if (inputState.forward) throttle = 1;
            if (inputState.backward) throttle = -1;
        }

        if (inputState.steerX !== undefined && inputState.steerX !== 0) {
            turn = -inputState.steerX;
        } else {
            if (inputState.left) turn = 1;
            if (inputState.right) turn = -1;
        }

        // 2. Physics Steps Loop (Driven by Network Prediction)
        // 2. Network Input (Send Input Once Per Frame)
        // No loop needed; prediction engine handles tick-rate internally.
        if (isLocalPlayer) {
            // Safety check for spin-out (clamp input)
            const safeThrottle = isSpinningOut.current ? 0 : throttle;
            const safeTurn = isSpinningOut.current ? 0 : turn;

            network.processInput({
                throttle: safeThrottle,
                steer: safeTurn,
                brake: false, // We use 'drift' for drifting now. 'brake' is unused or for actual braking if implemented.
                drift: !!inputState.drift,
                useItem: false,
            });
        }

        // --- 3. Render / Visual Integration ---

        let tx = 0, ty = 0, tz = 0, rot = 0;

        // Single Source of Truth: Use predicted state directly
        if (isLocalPlayer) {
            const state = network.getPhysicsState();

            if (state) {
                // Sync local refs to predicted state for visuals/camera
                currentSpeed.current = state.speed;
                currentRotation.current = state.rotation;
                isDrifting.current = state.isDrifting;
                driftDirection.current = state.driftDirection;
                driftTime.current = state.driftTime;
                driftSlideAngle.current = state.driftSlideAngle;
                boostStrength.current = state.boostStrength;
                isOilSlipping.current = state.isOilSlipping;
                oilSlipTime.current = state.oilSlipTime;
                isSpinningOut.current = state.isSpinningOut;
                spinOutTime.current = state.spinOutTime;

                // Sync smoke effect intensity with core state
                if (state.isDrifting) {
                    slipRatioRef.current = Math.min(Math.abs(state.speed) / MAX_SPEED, 1);
                } else {
                    slipRatioRef.current = 0;
                }

                // Apply transform strictly from prediction
                // Apply transform strictly from prediction (XZ) + Rapier (Y)
                // No blending needed because this IS the simulation now
                const currentT = body.translation();
                const currentV = body.linvel();

                // Core controls X/Z (authoritative). Rapier controls Y (gravity/walls).
                body.setTranslation({ x: state.position[0], y: currentT.y, z: state.position[2] }, true);

                _quat.current.setFromAxisAngle(_axis.current, state.rotation);
                body.setRotation(_quat.current, true);

                // Keep vertical velocity from physics engine (gravity/jump), override horizontal
                body.setLinvel({ x: state.velocity[0], y: currentV.y, z: state.velocity[2] }, true);
                body.setAngvel({ x: 0, y: 0, z: 0 }, true);

                // Update local variables for camera/broadcast usage
                tx = state.position[0];
                ty = currentT.y; // Use Rapier's Y (actual height)
                tz = state.position[2];
                rot = state.rotation;
            } else {
                // Fallback if state is null (e.g. not initialized)
                // Just use current body position to avoid crashes
                const t = body.translation();
                tx = t.x; ty = t.y; tz = t.z;
                rot = currentRotation.current;
            }
        } else {
            // Remote players or fallback
            const t = body.translation();
            tx = t.x;
            ty = t.y;
            tz = t.z;
            rot = currentRotation.current;
        }

        // Clean up: Visual Steering reference
        steeringValRef.current = turn;

        onSpeedChange?.(Math.abs(currentSpeed.current));

        // Camera & Transform Broadcast
        onKartTransformChange?.([tx, ty, tz], rot);

        // Network Position Update (Robut Date Check)
        const elapsed = state.clock.getElapsedTime();
        if (elapsed - lastUpdateTime.current >= POSITION_UPDATE_INTERVAL) {
            lastUpdateTime.current = elapsed;
            if (trackSplineRef.current) {
                progressRef.current = trackSplineRef.current.project(tx, tz, progressRef.current);
            }
            onPositionUpdate?.(id, [tx, ty, tz], rot, Math.abs(currentSpeed.current), progressRef.current);
        }

        // Effects Update
        let currentTier = 0;
        if (isDrifting.current) {
            for (let i = DRIFT_BOOST_Tiers.length - 1; i >= 0; i--) {
                if (driftTime.current >= DRIFT_BOOST_Tiers[i]) { currentTier = i + 1; break; }
            }
        }
        onEffectsUpdate?.({
            isDrifting: isDrifting.current,
            isBoosting: boostStrength.current > 1,
            boostStrength: boostStrength.current,
            driftTier: currentTier,
        });

    });

    // Cleanup all pending timers on unmount
    useEffect(() => {
        return () => {
            for (const id of activeTimers.current) clearTimeout(id);
            activeTimers.current.clear();
        };
    }, []);

    return (
        <RigidBody
            ref={rigidBodyRef}
            name={id}
            position={[position[0], position[1], position[2]]}
            rotation={[0, initialRotation, 0]}
            type="dynamic"          // vamos manter dynamic para física completa
            colliders={false}       // collider explícito
            mass={BODY_MASS}
            lockRotations           // só gira em Y
            gravityScale={1}        // Enable gravity so it settles on track
            linearDamping={2}       // freio natural
            angularDamping={5}      // evita rodar demais
        >
            <CuboidCollider
                args={COLLIDER_HALF_EXTENTS}
                position={COLLIDER_OFFSET}
                friction={0.5}
                restitution={0}
            />

            <group ref={groupRef} position={KART_MODEL_OFFSET}>
                <CarModel
                    url={modelUrl || ""}
                    scale={modelScale}
                    steeringRef={steeringValRef}
                />
                <KartDriftSmoke
                    slipRatioRef={slipRatioRef}
                    rearWheelPositions={getRearWheelPositions(modelUrl)}
                />
                {playerName && (
                    <PlayerNameTag name={playerName} color={playerColor} />
                )}
            </group>
        </RigidBody>
    );
});

KartPro.displayName = "KartPro";
