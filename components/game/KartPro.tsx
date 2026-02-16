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
    const DRIFT_BOOST_TIERS = preset.driftBoostTiers;
    const DRIFT_BOOST_SPEEDS = preset.driftBoostSpeeds;
    const DRIFT_BOOST_DURATION = preset.driftBoostDuration;
    const REVERSE_SPEED_RATIO = preset.reverseSpeedRatio;
    const SPEED_FACTOR_DIVISOR = preset.speedFactorDivisor;
    const MIN_TURN_SPEED = preset.minTurnSpeed;
    const BODY_MASS = 1.0;

    // Network prediction hook (usado apenas para o jogador local)
    const network = useNetworkPrediction(id, position, !!isLocalPlayer);

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
        accumulator.current += Math.min(delta, 0.1); // Clamp to 100ms prevents death spiral

        // 2. Physics Steps Loop
        let numSteps = 0;
        while (accumulator.current >= PHYSICS_TIMESTEP && numSteps < 10) {
            accumulator.current -= PHYSICS_TIMESTEP;
            numSteps++;
            const dt = PHYSICS_TIMESTEP;

            // --- INPUT LOGIC ---
            let throttle = 0;
            let turn = 0;

            if (input.throttleY !== undefined && input.throttleY !== 0) {
                throttle = input.throttleY;
            } else {
                if (input.forward) throttle = 1;
                if (input.backward) throttle = -1;
            }

            if (input.steerX !== undefined && input.steerX !== 0) {
                turn = -input.steerX;
            } else {
                if (input.left) turn = 1;
                if (input.right) turn = -1;
            }

            // Drift
            const wantsDrift = input.drift && Math.abs(currentSpeed.current) > DRIFT_SPEED_THRESHOLD;
            if (wantsDrift && !isDrifting.current && Math.abs(turn) > 0) {
                isDrifting.current = true;
                driftDirection.current = Math.sign(turn);
                driftTime.current = 0;
                driftSlideAngle.current = 0;
            } else if (!wantsDrift && isDrifting.current) {
                isDrifting.current = false;
                let tier = -1;
                for (let i = DRIFT_BOOST_TIERS.length - 1; i >= 0; i--) {
                    if (driftTime.current >= DRIFT_BOOST_TIERS[i]) { tier = i; break; }
                }
                if (tier >= 0) {
                    boostStrength.current = DRIFT_BOOST_SPEEDS[tier];
                    const dur = DRIFT_BOOST_DURATION[tier];
                    safeTimeout(() => { boostStrength.current = 1; }, dur * 1000);
                }
                driftTime.current = 0;
                driftDirection.current = 0;
            } else if (isDrifting.current) {
                driftTime.current += dt;
            }
            wasDrifting.current = isDrifting.current;

            if (isLocalPlayer) {
                network.processInput({ throttle, steer: turn, brake: throttle < 0, useItem: false });
            }

            if (isSpinningOut.current) { throttle = 0; turn = 0; }

            // --- SPEED CALC ---
            if (throttle > 0) {
                currentSpeed.current += ACCEL * boostStrength.current * throttle * dt;
            } else if (throttle < 0) {
                currentSpeed.current -= BRAKE * Math.abs(throttle) * dt;
            } else if (Math.abs(currentSpeed.current) > 0.1) {
                const sign = Math.sign(currentSpeed.current);
                currentSpeed.current -= sign * DRAG * dt;
                if (Math.sign(currentSpeed.current) !== sign) currentSpeed.current = 0;
            } else {
                currentSpeed.current = 0;
            }

            const maxS = MAX_SPEED * boostStrength.current;
            currentSpeed.current = Math.max(Math.min(currentSpeed.current, maxS), -maxS * REVERSE_SPEED_RATIO);

            // --- TURNING & EFFECTS ---
            if (Math.abs(turn) > 0 && Math.abs(currentSpeed.current) > MIN_TURN_SPEED) {
                const speedFactor = Math.min(Math.abs(currentSpeed.current) / SPEED_FACTOR_DIVISOR, 1.0);
                let driftBonus = 1.0;
                if (isDrifting.current) {
                    driftBonus = DRIFT_TURN_BONUS;
                    const driftBias = driftDirection.current * 0.6 * TURN_SPEED * speedFactor * dt;
                    currentRotation.current += driftBias * Math.sign(currentSpeed.current);
                }
                const turnAmount = turn * TURN_SPEED * speedFactor * driftBonus * dt;
                currentRotation.current += turnAmount * Math.sign(currentSpeed.current);
            } else if (isDrifting.current && Math.abs(currentSpeed.current) > MIN_TURN_SPEED) {
                const speedFactor = Math.min(Math.abs(currentSpeed.current) / SPEED_FACTOR_DIVISOR, 1.0);
                const driftBias = driftDirection.current * 0.4 * TURN_SPEED * speedFactor * dt;
                currentRotation.current += driftBias * Math.sign(currentSpeed.current);
            }

            if (isOilSlipping.current) {
                oilSlipTime.current += dt;
                const slipNoise = Math.sin(oilSlipTime.current * 15) * 3.0;
                currentRotation.current += slipNoise * dt;
            }

            if (isSpinningOut.current) {
                spinOutTime.current += dt;
                const spinSpeed = (2 * Math.PI * 2) / spinOutDuration;
                currentRotation.current += spinSpeed * dt;
                currentSpeed.current *= Math.max(0, 1 - 3 * dt);
                if (spinOutTime.current >= spinOutDuration) {
                    isSpinningOut.current = false;
                    spinOutTime.current = 0;
                }
            }

            // Drift Slide Angle
            if (isDrifting.current) {
                driftSlideAngle.current = Math.min(driftSlideAngle.current + dt * 3.0, 1.0);
            } else {
                driftSlideAngle.current *= Math.max(0, 1 - 8 * dt);
            }

            // Smoke Ratio
            if (isDrifting.current) {
                slipRatioRef.current = Math.min(Math.abs(currentSpeed.current) / MAX_SPEED, 1);
            } else {
                slipRatioRef.current *= Math.max(0, 1 - 5 * dt);
                if (slipRatioRef.current < 0.01) slipRatioRef.current = 0;
            }

            // Visual Steering reference
            steeringValRef.current = turn;
        }

        // --- 3. Render / Visual Integration ---

        // Calculate Velocity for Rapier (using Final State)
        const forwardX = Math.sin(currentRotation.current);
        const forwardZ = Math.cos(currentRotation.current);
        const currentVel = body.linvel();

        let vx = forwardX * currentSpeed.current;
        let vz = forwardZ * currentSpeed.current;

        if (isDrifting.current || driftSlideAngle.current > 0.01) {
            const slideStrength = DRIFT_SLIDE_FACTOR * driftSlideAngle.current * currentSpeed.current;
            const slideDir = -driftDirection.current;
            // Only apply slide if we were drifting or fading out
            if (driftDirection.current !== 0) {
                vx += forwardZ * slideDir * slideStrength;
                vz += -forwardX * slideDir * slideStrength;
            }
        }

        // Vertical Damping (Visual only, per render frame)
        // Keep using render delta for damping to be smooth? Or fixed?
        // Using fixed step integration for vertical velocity requires storing `vy` state.
        // Currently `vy` is read from body.
        // Let's stick to dampStep based on render delta for suspension, as it reacts to terrain.
        const dampStep = Math.min(delta, 0.1);
        let vy = currentVel.y;
        if (vy > 0 && vy < 1.0) vy *= 0.5;
        vy = Math.max(vy, -30);

        body.setLinvel({ x: vx, y: vy, z: vz }, true);
        _quat.current.setFromAxisAngle(_axis.current, currentRotation.current);
        body.setRotation(_quat.current, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);

        onSpeedChange?.(Math.abs(currentSpeed.current));

        // Camera & Transform Broadcast
        let t = body.translation();
        let tx = t.x, ty = t.y, tz = t.z;
        let rot = currentRotation.current;

        // Prediction/Reconciliation (Visual Only)
        if (isLocalPlayer) {
            const phys = network.getPhysicsState();
            if (phys) {
                const blend = 0;
                tx = THREE.MathUtils.lerp(tx, phys.position[0], blend);
                tz = THREE.MathUtils.lerp(tz, phys.position[2], blend);
                rot = THREE.MathUtils.lerp(rot, phys.rotation, blend);
                body.setTranslation({ x: tx, y: ty, z: tz }, true);
                _quat.current.setFromAxisAngle(_axis.current, rot);
                body.setRotation(_quat.current, true);
                currentRotation.current = rot;
            }
        }

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
            for (let i = DRIFT_BOOST_TIERS.length - 1; i >= 0; i--) {
                if (driftTime.current >= DRIFT_BOOST_TIERS[i]) { currentTier = i + 1; break; }
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
        // <RigidBody
        //     ref={rigidBodyRef}
        //     name={id}
        //     position={[position[0], position[1] + SPAWN_Y_OFFSET, position[2]]}
        //     rotation={[0, initialRotation, 0]}
        //     type="dynamic"
        //     colliders={false}
        //     mass={BODY_MASS}
        //     lockRotations
        //     linearDamping={0}
        //     angularDamping={0}
        //     friction={0}
        //     restitution={0}
        // >
        //     <CuboidCollider
        //         args={COLLIDER_HALF_EXTENTS}
        //         position={COLLIDER_OFFSET}
        //         friction={0}
        //         restitution={0}
        //     />

        //     <group ref={groupRef}>
        //         <CarModel
        //             url={modelUrl || ""}
        //             scale={modelScale}
        //             steeringRef={steeringValRef}
        //         />
        //         {/* Fumaça nos pneus traseiros durante drift */}
        //         <KartDriftSmoke
        //             slipRatioRef={slipRatioRef}
        //             rearWheelPositions={getRearWheelPositions(modelUrl)}
        //         />
        //         {/* Nome flutuante acima do kart */}
        //         {playerName && (
        //             <PlayerNameTag name={playerName} color={playerColor} />
        //         )}
        //     </group>
        // </RigidBody>



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
