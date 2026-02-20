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
import { COLLIDER_HALF_EXTENTS, COLLIDER_OFFSET, POSITION_UPDATE_INTERVAL, KART_MODEL_OFFSET } from '@/lib/game/engine-constants';
import { useNetworkPrediction } from "@/hooks/useNetworkPrediction";
import { applyBoost as coreApplyBoost, applyStarPower as coreApplyStarPower, applyOilSlip as coreApplyOilSlip, spinOut as coreSpinOut } from "@/lib/game/kart-physics-core";

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
    getLinvel: () => { x: number; y: number; z: number } | null;
    getGroup: () => THREE.Group | null;
    applyBoost: (strength?: number, duration?: number) => void;
    applyStarPower: (duration?: number) => void;
    applyOilSlip: (duration?: number) => void;
    spinOut: () => void;
    /** [Fix 2.8] Returns true if the kart is currently invincible (star power active) */
    getIsInvincible?: () => boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Atualiza o lapProgress de forma monotônica — nunca deixa regredir durante
 * avanço normal. Colisões laterais com outros karts empurram o kart para a borda
 * da pista, fazendo a projeção no spline recuar levemente (ex: 0.52 → 0.49),
 * o que faz o jogador cair no ranking por um instante.
 *
 * Regras:
 * - Se `newProgress > prev` → aceita normalmente (avanço).
 * - Se `newProgress < prev` mas a diferença circular é > 0.3 → é cruzamento de volta
 *   legítimo (0.99→0.01); aceita e reseta maxProgress.
 * - Se `newProgress < prev` e diferença circular ≤ 0.3 → regressão espúria;
 *   mantém o valor máximo visto recentemente.
 */
function updateMonotonicProgress(
    newProgress: number,
    prev: number,
    maxRef: React.MutableRefObject<number>
): number {
    const fwd = newProgress - prev;
    // Circular forward distance (handles wrap 0.99→0.01)
    const circFwd = fwd < 0 ? fwd + 1 : fwd;

    if (circFwd > 0.3) {
        // Cruzamento legítimo de volta — reset do máximo para nova volta
        maxRef.current = newProgress;
        return newProgress;
    }

    if (newProgress >= prev) {
        // Avanço normal — atualiza máximo
        if (newProgress > maxRef.current) maxRef.current = newProgress;
        return newProgress;
    }

    // Regressão espúria (colisão lateral ou jitter do spline):
    // retorna o maior entre newProgress e o máximo recente,
    // mas só se a regressão for pequena (< 0.05)
    const regression = prev - newProgress;
    if (regression < 0.05) {
        return maxRef.current > newProgress ? maxRef.current : newProgress;
    }

    // Regressão grande mas não-volta: aceita (pode ser reverso intencional)
    maxRef.current = newProgress;
    return newProgress;
}

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

    // Item Effects
    const isInvincible = useRef(false);
    const isOilSlipping = useRef(false);
    const oilSlipTime = useRef(0);
    const isSpinningOut = useRef(false);
    const spinOutTime = useRef(0);

    // Timer cleanup tracking
    const activeTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
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
    // Smoothed Y to filter Rapier ground contact solver micro-bounce
    const smoothedY = useRef(position[1]);
    // Track what speed we SET last frame, so collision detection compares against
    // last frame's target (not current frame's, which is always higher during acceleration).
    const prevSetSpeed = useRef(0);
    // Track spline for lap progress (industry-standard spline projection)
    const trackSplineRef = useRef<TrackSpline | null>(null);
    const progressRef = useRef(0);
    // Monotonic progress guard: lapProgress nunca regride durante avanço normal.
    // Regressão legítima (fim de volta) tem circularDelta < 0.05 (ex: 0.99→0.01).
    // Regressão espúria por colisão lateral tem circularDelta pequeno mas lapProgress recua.
    // Guardamos o maior valor RECENTE e só aceitamos recuo se for cruzamento de volta.
    const maxProgressRef = useRef(0);

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
    const DRIFT_BOOST_Tiers = preset.driftBoostTiers;
    const BODY_MASS = preset.mass;

    // Network prediction hook (usado apenas para o jogador local)
    const network = useNetworkPrediction(id, position, initialRotation, !!isLocalPlayer);

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
        getLinvel: () => {
            if (!rigidBodyRef.current) return null;
            const v = rigidBodyRef.current.linvel();
            return { x: v.x, y: v.y, z: v.z };
        },
        getGroup: () => groupRef.current,
        applyBoost: (strength = 1.5, duration = 2) => {
            // Write directly to core physics state — timer is handled by core's boostTimeRemaining decay
            const coreState = network.getPhysicsState();
            if (coreState) coreApplyBoost(coreState, strength, duration);
            boostStrength.current = strength;
        },
        applyStarPower: (duration = 8) => {
            const coreState = network.getPhysicsState();
            if (coreState) coreApplyStarPower(coreState, 1.3, duration);
            isInvincible.current = true;
            boostStrength.current = 1.3;
        },
        applyOilSlip: (duration = 2.5) => {
            const coreState = network.getPhysicsState();
            if (coreState) {
                coreApplyOilSlip(coreState);
                // Programa reset via timeout (core não tem timer embutido para oil)
                safeTimeout(() => {
                    const s = network.getPhysicsState();
                    if (s) { s.isOilSlipping = false; s.oilSlipTime = 0; }
                }, duration * 1000);
            } else {
                // Fallback para karts sem network prediction (ex: bots visualizados como remoto)
                if (isInvincible.current) return;
                isOilSlipping.current = true;
                oilSlipTime.current = 0;
                safeTimeout(() => { isOilSlipping.current = false; }, duration * 1000);
            }
        },
        spinOut: () => {
            const coreState = network.getPhysicsState();
            if (coreState) {
                coreSpinOut(coreState);
            } else {
                // Fallback para karts sem network prediction
                if (isInvincible.current || isSpinningOut.current) return;
                isSpinningOut.current = true;
                spinOutTime.current = 0;
                currentSpeed.current *= 0.1;
            }
        },
        // [Fix 2.8] Expose invincibility state so item system can skip broadcast when blocked
        getIsInvincible: () => {
            const coreState = network.getPhysicsState();
            return coreState ? coreState.isInvincible : isInvincible.current;
        },
    }));

    const lastUpdateTime = useRef(0);

    useFrame((state) => {
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
                    const raw = trackSplineRef.current.project(t.x, t.z, progressRef.current);
                    progressRef.current = updateMonotonicProgress(raw, progressRef.current, maxProgressRef);
                }
                onPositionUpdate?.(id, [t.x, t.y, t.z], currentRotation.current, 0, progressRef.current);
            }
            return;
        }

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

                // --- Physics Integration: Velocity Driving (Collision Friendly) ---
                // Instead of teleporting (setTranslation), we drive the body with target velocity.
                // This allows Rapier to resolve wall collisions naturally.
                const currentV = body.linvel();

                // Damp vertical micro-bounce: gravity + ground contact creates high-freq Y oscillation.
                // Without this, rear wheels visibly tremble. Only damp small Y velocities.
                let vy = currentV.y;
                if (Math.abs(vy) < 2.0) vy *= 0.8;

                // Target velocity from Core state
                // Use boosted max for clamp so boost speeds aren't artificially limited
                const boostedMax = MAX_SPEED * Math.max(state.boostStrength, 1);
                const clampedSpeed = THREE.MathUtils.clamp(state.speed, -boostedMax, boostedMax);
                const SPEED_DEAD_ZONE = 0.05;

                if (Math.abs(clampedSpeed) < SPEED_DEAD_ZONE) {
                    body.setLinvel({ x: 0, y: vy, z: 0 }, true);
                } else {
                    const forwardX = Math.sin(state.rotation);
                    const forwardZ = Math.cos(state.rotation);
                    let vx = forwardX * clampedSpeed;
                    let vz = forwardZ * clampedSpeed;

                    // Wall/kart collision: compare Rapier's actual speed against what
                    // we SET LAST FRAME (not current intended, which is always higher
                    // during acceleration — especially reverse with BRAKE=35).
                    const rapierSqXZ = currentV.x * currentV.x + currentV.z * currentV.z;
                    const lastSet = prevSetSpeed.current;

                    if (rapierSqXZ > 0.25 && lastSet > 1) {
                        const rapierMag = Math.sqrt(rapierSqXZ);

                        if (rapierMag < lastSet * 0.85) {
                            // Collision: Rapier couldn't maintain last frame's speed.
                            const rapierDirX = currentV.x / rapierMag;
                            const rapierDirZ = currentV.z / rapierMag;
                            const rapierForwardDot = rapierDirX * forwardX + rapierDirZ * forwardZ;

                            if (rapierForwardDot > 0) {
                                // Wall slide: use Rapier velocity as-is
                                vx = currentV.x;
                                vz = currentV.z;
                            } else {
                                // Head-on wall: stop
                                vx = 0;
                                vz = 0;
                            }

                            // Feed actual speed back to core → natural re-acceleration
                            const actualSpeed = Math.sqrt(vx * vx + vz * vz);
                            state.speed = Math.sign(state.speed) * actualSpeed;
                        }
                    }

                    // Remember what we're setting for next frame's comparison
                    prevSetSpeed.current = Math.sqrt(vx * vx + vz * vz);
                    body.setLinvel({ x: vx, y: vy, z: vz }, true);
                }

                // 4. Force Rotation (Visuals)
                // We still snap rotation because drifting visuals depend heavily on precise angle
                _quat.current.setFromAxisAngle(_axis.current, state.rotation);
                body.setRotation(_quat.current, true);

                // 5. Angular Velocity
                // Zero it out to prevent physics engine from spinning the kart uncontrollably on collision
                body.setAngvel({ x: 0, y: 0, z: 0 }, true);

                // --- Visual / Camera Sync ---
                // Use the REAL body position (Rapier) for camera and visuals.
                // This ensures the camera doesn't clip through walls if the physics body is stopped by one.
                const finalT = body.translation();
                tx = finalT.x;
                tz = finalT.z;
                rot = state.rotation;

                // Smooth Y for camera only (filters Rapier ground-contact solver micro-bounce).
                // The model stays at the raw body Y to avoid appearing suspended.
                smoothedY.current += (finalT.y - smoothedY.current) * 0.4;
                ty = smoothedY.current;
            } else {
                // Fallback if state is null (e.g. not initialized)
                const t = body.translation();
                tx = t.x; ty = t.y; tz = t.z;
                rot = currentRotation.current;

                // Fallback speed from body velocity
                const v = body.linvel();
                currentSpeed.current = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
            }
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
                const raw = trackSplineRef.current.project(tx, tz, progressRef.current);
                progressRef.current = updateMonotonicProgress(raw, progressRef.current, maxProgressRef);
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
            linearDamping={0}       // Velocity fully controlled via setLinvel; damping would fight it
            angularDamping={5}      // evita rodar demais
        >
            <CuboidCollider
                args={COLLIDER_HALF_EXTENTS}
                position={COLLIDER_OFFSET}
                friction={0}
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
