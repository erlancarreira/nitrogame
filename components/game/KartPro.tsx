"use client";

import { useRef, useEffect, forwardRef, useImperativeHandle, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, CuboidCollider, RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import type { Controls } from "@/lib/game/types";
import { CarModel } from "./CarModel";
import type { MapConfig } from "@/lib/game/maps";
import { TrackSpline } from "@/lib/game/track-path";
import { PRESET_STANDARD, type KartPhysicsConfig, type KartPresetId, KART_PRESETS } from "@/lib/game/physics-presets";
import { KartDriftSmoke, getRearWheelPositions } from "./KartEffects";
import { PlayerNameTag } from "./PlayerNameTag";
import { COLLIDER_HALF_EXTENTS, COLLIDER_OFFSET, MAX_DELTA, POSITION_UPDATE_INTERVAL, SPAWN_Y_OFFSET } from "@/lib/game/engine-constants";
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
    position = [0, 1, 0],
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
    const BODY_MASS = preset.mass;

    // Network prediction hook (usado apenas para o jogador local)
    const network = useNetworkPrediction(id, position, !!isLocalPlayer);

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

    useFrame((state, delta) => {
        const body = rigidBodyRef.current;
        if (!body) return;

        const dt = Math.min(delta, MAX_DELTA);

        // Pre-race: hold kart in place on the grid (prevent falling/floating)
        // Gravity still applies so the kart settles on the ground, but we kill
        // horizontal drift and limit downward velocity to prevent tunneling.
        if (!raceStarted) {
            const vel = body.linvel();
            // Allow gentle gravity settling but clamp to prevent launch/tunneling
            const clampedVy = Math.max(vel.y, -5);
            body.setLinvel({ x: 0, y: clampedVy, z: 0 }, true);
            body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            // Keep rotation locked to start direction
            _quat.current.setFromAxisAngle(_axis.current, currentRotation.current);
            body.setRotation(_quat.current, true);

            // Force-cancel drift if it was active when race stopped (prevents stuck drift sound)
            if (isDrifting.current) {
                isDrifting.current = false;
                driftTime.current = 0;
                driftDirection.current = 0;
                driftSlideAngle.current = 0;
                slipRatioRef.current = 0;
                onEffectsUpdate?.({ isDrifting: false, isBoosting: boostStrength.current > 1, boostStrength: boostStrength.current, driftTier: 0 });
            }

            // Still fire position updates so remote clients see us on the grid
            const t = body.translation();
            onKartTransformChange?.([t.x, t.y, t.z], currentRotation.current);
            if (state.clock.getElapsedTime() % POSITION_UPDATE_INTERVAL < dt) {
                if (trackSplineRef.current) {
                    progressRef.current = trackSplineRef.current.project(t.x, t.z, progressRef.current);
                }
                onPositionUpdate?.(id, [t.x, t.y, t.z], currentRotation.current, 0, progressRef.current);
            }
            return; // Skip all driving logic
        }

        const input = controlsRef.current;
        // Read fresh analog values from touch ref each frame (bypasses React state)
        if (touchControlsRef?.current) {
            input.steerX = touchControlsRef.current.steerX;
            input.throttleY = touchControlsRef.current.throttleY;
        }

        // 1. Read inputs (analog if available, else binary)
        let throttle = 0;
        let turn = 0;

        if (raceStarted) {
            // Throttle: analog joystick Y or binary keys
            if (input.throttleY !== undefined && input.throttleY !== 0) {
                throttle = input.throttleY; // -1..+1
            } else {
                if (input.forward) throttle = 1;
                if (input.backward) throttle = -1;
            }

            // Steering: analog joystick X or binary keys
            if (input.steerX !== undefined && input.steerX !== 0) {
                turn = -input.steerX; // negative = right in our system, steerX positive = right
            } else {
                if (input.left) turn = 1;
                if (input.right) turn = -1;
            }

            // Drift activation: need speed + turning + holding drift key
            const wantsDrift = input.drift && Math.abs(currentSpeed.current) > DRIFT_SPEED_THRESHOLD;

            if (wantsDrift && !isDrifting.current && Math.abs(turn) > 0) {
                // Initiate drift — lock direction based on turn input
                isDrifting.current = true;
                driftDirection.current = Math.sign(turn);
                driftTime.current = 0;
                driftSlideAngle.current = 0;
            } else if (!wantsDrift && isDrifting.current) {
                // Released drift — check for boost
                isDrifting.current = false;

                // Determine boost tier based on drift duration
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
                // Accumulate drift time
                driftTime.current += dt;
            }

            wasDrifting.current = isDrifting.current;
        }

        // Envia input normalizado para o sistema de prediction (apenas jogador local)
        if (isLocalPlayer) {
            network.processInput({
                throttle,
                steer: turn,
                brake: throttle < 0,
                useItem: false,
            });
        }

        // Block input during spin out — player is stunned
        if (isSpinningOut.current) {
            throttle = 0;
            turn = 0;
        }

        // 2. Speed calculation
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

        // 3. Turning
        if (Math.abs(turn) > 0 && Math.abs(currentSpeed.current) > MIN_TURN_SPEED) {
            const speedFactor = Math.min(Math.abs(currentSpeed.current) / SPEED_FACTOR_DIVISOR, 1.0);
            let driftBonus = 1.0;

            if (isDrifting.current) {
                driftBonus = DRIFT_TURN_BONUS;
                // During drift, the locked direction adds a constant turn bias
                // Player can still steer slightly against the drift direction
                const driftBias = driftDirection.current * 0.6 * TURN_SPEED * speedFactor * dt;
                currentRotation.current += driftBias * Math.sign(currentSpeed.current);
            }

            const turnAmount = turn * TURN_SPEED * speedFactor * driftBonus * dt;
            const direction = Math.sign(currentSpeed.current);
            currentRotation.current += turnAmount * direction;
        } else if (isDrifting.current && Math.abs(currentSpeed.current) > MIN_TURN_SPEED) {
            // No turn input during drift — still apply drift bias
            const speedFactor = Math.min(Math.abs(currentSpeed.current) / SPEED_FACTOR_DIVISOR, 1.0);
            const driftBias = driftDirection.current * 0.4 * TURN_SPEED * speedFactor * dt;
            currentRotation.current += driftBias * Math.sign(currentSpeed.current);
        }

        // Oil Slip Effect: Random steering noise
        if (isOilSlipping.current) {
            oilSlipTime.current += dt;
            // Oscillate steering wildly
            const slipNoise = Math.sin(oilSlipTime.current * 15) * 3.0; // Fast oscillation
            currentRotation.current += slipNoise * dt;
        }

        // Spin Out Effect: fast 360° spin + locked controls (Mario Kart style)
        if (isSpinningOut.current) {
            spinOutTime.current += dt;
            // Spin 2 full rotations over the duration (720°)
            const spinSpeed = (2 * Math.PI * 2) / spinOutDuration; // 2 rotations per spinOutDuration
            currentRotation.current += spinSpeed * dt;
            // During spin: heavily slow down, ignore player input
            currentSpeed.current *= Math.max(0, 1 - 3 * dt);

            if (spinOutTime.current >= spinOutDuration) {
                isSpinningOut.current = false;
                spinOutTime.current = 0;
            }
            // Skip turning logic below — player is stunned
        }

        // 4. Apply movement (kinematic-style on dynamic body)
        const forwardX = Math.sin(currentRotation.current);
        const forwardZ = Math.cos(currentRotation.current);
        const currentVel = body.linvel();

        // During drift, add lateral slide component (sideways motion)
        let vx = forwardX * currentSpeed.current;
        let vz = forwardZ * currentSpeed.current;

        if (isDrifting.current) {
            // Build up slide angle over time for satisfying drift feel
            driftSlideAngle.current = Math.min(driftSlideAngle.current + dt * 3.0, 1.0);
            const slideStrength = DRIFT_SLIDE_FACTOR * driftSlideAngle.current * currentSpeed.current;
            // Perpendicular to forward: rotate 90° -> (forwardZ, -forwardX) for right
            const slideDir = -driftDirection.current;
            vx += forwardZ * slideDir * slideStrength;
            vz += -forwardX * slideDir * slideStrength;
        } else {
            // Fade out slide angle when not drifting
            driftSlideAngle.current *= Math.max(0, 1 - 8 * dt);
        }

        // Stabilize vertical velocity to prevent micro-bouncing
        let vy = currentVel.y;
        if (Math.abs(vy) < 2.0) {
            vy *= 0.8;
        }
        vy = Math.max(vy, -30);

        body.setLinvel({ x: vx, y: vy, z: vz }, true);

        _quat.current.setFromAxisAngle(_axis.current, currentRotation.current);
        body.setRotation(_quat.current, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);

        // 5. Visual steering & feedback
        steeringValRef.current = turn;
        onSpeedChange?.(Math.abs(currentSpeed.current));

        // Camera transform — EVERY frame for smooth following
        let t = body.translation();
        let tx = t.x;
        let ty = t.y;
        let tz = t.z;
        let rot = currentRotation.current;

        // Integra prediction/reconciliation do hook no jogador local
        if (isLocalPlayer) {
            const phys = network.getPhysicsState();
            if (phys) {
                const blend = 0.10; // 0 = ignora prediction, 1 = segue 100%

                tx = THREE.MathUtils.lerp(tx, phys.position[0], blend);
                tz = THREE.MathUtils.lerp(tz, phys.position[2], blend);
                rot = THREE.MathUtils.lerp(rot, phys.rotation, blend);

                // Empurra o corpo de física para perto do estado previsto
                body.setTranslation({ x: tx, y: ty, z: tz }, true);
                _quat.current.setFromAxisAngle(_axis.current, rot);
                body.setRotation(_quat.current, true);
                currentRotation.current = rot;
            }
        }

        onKartTransformChange?.([tx, ty, tz], rot);

        // Throttled position update for network/minimap
        if (state.clock.getElapsedTime() % POSITION_UPDATE_INTERVAL < dt) {
            if (trackSplineRef.current) {
                progressRef.current = trackSplineRef.current.project(tx, tz, progressRef.current);
            }

            onPositionUpdate?.(id, [tx, ty, tz], rot, Math.abs(currentSpeed.current), progressRef.current);
        }

        // Slip ratio for smoke — fade out gradually when drift ends
        if (isDrifting.current) {
            slipRatioRef.current = Math.min(Math.abs(currentSpeed.current) / MAX_SPEED, 1);
        } else {
            slipRatioRef.current *= Math.max(0, 1 - 5 * dt); // fadeout
            if (slipRatioRef.current < 0.01) slipRatioRef.current = 0;
        }

        // Determine drift tier for UI feedback (could color the smoke)
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

        // Pass invincibility state up? Not for now, maybe visual later

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
            position={[position[0], position[1] + SPAWN_Y_OFFSET, position[2]]}
            rotation={[0, initialRotation, 0]}
            type="dynamic"
            colliders={false}
            mass={BODY_MASS}
            lockRotations
            linearDamping={0}
            angularDamping={0}
            friction={0}
            restitution={0}
        >
            <CuboidCollider
                args={COLLIDER_HALF_EXTENTS}
                position={COLLIDER_OFFSET}
                friction={0}
                restitution={0}
            />

            <group ref={groupRef}>
                <CarModel
                    url={modelUrl || ""}
                    scale={modelScale}
                    steeringRef={steeringValRef}
                />
                {/* Fumaça nos pneus traseiros durante drift */}
                <KartDriftSmoke
                    slipRatioRef={slipRatioRef}
                    rearWheelPositions={getRearWheelPositions(modelUrl)}
                />
                {/* Nome flutuante acima do kart */}
                {playerName && (
                    <PlayerNameTag name={playerName} color={playerColor} />
                )}
            </group>
        </RigidBody>
    );
});

KartPro.displayName = "KartPro";
